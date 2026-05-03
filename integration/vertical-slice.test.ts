/**
 * Integration Tests — Vertical Slice
 *
 * Tests the full flow: webhook event → orchestrator →
 * PR diff fetch → security scan → PR comment generation.
 *
 * Uses mock GitHub responses to avoid external dependencies.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { GitHubWebhookEvent, ProcessedComments, SecurityAlert } from '../../shared/src/types';
import { Orchestrator } from '../src/orchestrator';
import { SessionStatus } from '../../shared/src/types';

vi.mock('../src/adapters/pr-manager-adapter', () => ({
  createDefaultPRManager: () => mockPRManagerAdapter(),
}));

vi.mock('../src/adapters/security-adapter', () => ({
  createDefaultSecurity: () => mockSecurityAdapter(),
}));

function mockPRManagerAdapter() {
  return {
    async getDiff(_repo: { owner: string; repo: string; prNumber: number | null }) {
      return `--- a/src/index.ts
+++ b/src/index.ts
@@ -1,5 +1,6 @@
+// NEW LINE: const API_KEY = 'sk-abc123';
 export function hello() {
   return 'hello';
 }
+// Another new line
`;
    },

    async getComments(_repo: { owner: string; repo: string; prNumber: number | null }): Promise<ProcessedComments> {
      return {
        comments: [
          {
            id: 1,
            pullRequestUrl: 'https://github.com/test/repo/pull/1',
            diffHunk: '@@ -1,3 +1,5 @@',
            path: 'src/index.ts',
            body: 'Fix this bug',
            author: { login: 'testuser', isBot: false, avatarUrl: '' },
            createdAt: new Date().toISOString(),
            type: 'COMMENT' as const,
            isResolved: false,
            isReply: false,
            replyToId: null,
            replies: [],
          },
        ],
        stats: {
          total: 1,
          code: 0,
          issue: 1,
          review: 0,
          bot: 0,
          human: 1,
          unresolved: 1,
          unanswered: 1,
        },
      };
    },

    async postComment() {},
    async postReview() {},
    async updatePR() {},
  };
}

function mockSecurityAdapter() {
  return {
    async scanDiff(diff: string): Promise<SecurityAlert[]> {
      const alerts: SecurityAlert[] = [];

      if (diff.includes('sk-') || diff.includes('api_key')) {
        alerts.push({
          id: 'alert-1',
          type: 'secrets_leak',
          severity: 'critical' as const,
          description: 'Potential API key detected in diff',
          agentId: 'test',
          details: { pattern: 'api_key', line: 2 },
          timestamp: new Date().toISOString(),
        });
      }

      if (diff.includes('[INST]') || diff.includes('###instructions')) {
        alerts.push({
          id: 'alert-2',
          type: 'prompt_injection',
          severity: 'medium' as const,
          description: 'Potential prompt injection pattern',
          agentId: 'test',
          details: {},
          timestamp: new Date().toISOString(),
        });
      }

      return alerts;
    },

    async assessTrust() {
      return 0.9;
    },
  };
}

const mockWebhookEvent: GitHubWebhookEvent = {
  action: 'opened',
  pullRequest: {
    number: 1,
    state: 'open',
    title: 'Test PR with secret',
    body: 'This PR adds some code',
    head: { ref: 'feature/test', sha: 'abc123' },
    base: { ref: 'main', sha: 'def456' },
    user: { login: 'testuser' },
  },
  repository: {
    fullName: 'testowner/testrepo',
    owner: { login: 'testowner' },
    name: 'testrepo',
    cloneUrl: 'https://github.com/testowner/testrepo.git',
  },
  sender: { login: 'testuser' },
};

describe('Vertical Slice Integration', () => {
  let orchestrator: Orchestrator;

  beforeEach(() => {
    orchestrator = new Orchestrator();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should complete full review cycle with mocked GitHub', async () => {
    const run = await orchestrator.executeCycle({
      event: mockWebhookEvent,
      sessionId: 'test-session-123',
    });

    expect(run.id).toBeDefined();
    expect(run.sessionId).toBe('test-session-123');
    expect(run.startedAt).toBeDefined();
    expect(run.completedAt).toBeDefined();

    const prComment = run.prCommentBody;
    expect(prComment.length).toBeGreaterThan(0);

    const status = run.overallStatus;
    expect(status).toBeDefined();
    expect([SessionStatus.Completed, SessionStatus.Running]).toContain(status);
  });

  it('should fetch real diff into run context', async () => {
    const run = await orchestrator.executeCycle({
      event: mockWebhookEvent,
      sessionId: 'test-session-diff',
    });

    const fetchResult = run.results.find((r) => r.step === 'fetch_pr');
    expect(fetchResult).toBeDefined();
    expect(fetchResult?.status).toBe('success');

    const diffLength = fetchResult?.data?.['diffLength'] as number | undefined;
    expect(diffLength).toBeGreaterThan(0);

    const hasSecret = (fetchResult?.data?.['diff'] as string)?.includes('API_KEY');
    expect(hasSecret).toBe(true);
  });

  it('should feed real diff to security scanner', async () => {
    const run = await orchestrator.executeCycle({
      event: mockWebhookEvent,
      sessionId: 'test-session-sec',
    });

    const securityResult = run.results.find((r) => r.step === 'security_scan');
    expect(securityResult).toBeDefined();
    expect(securityResult?.status).toBe('success');

    const alerts = securityResult?.data?.['alerts'] as SecurityAlert[] | undefined;
    expect(alerts).toBeDefined();
    expect(alerts?.length).toBeGreaterThan(0);

    const hasSecretAlert = alerts?.some((a) => a.type === 'secrets_leak');
    expect(hasSecretAlert).toBe(true);
  });

  it('should produce PR comment with findings', async () => {
    const run = await orchestrator.executeCycle({
      event: mockWebhookEvent,
      sessionId: 'test-session-comment',
    });

    const prComment = run.prCommentBody;
    expect(prComment).toContain('CodeNexus Review');
    expect(prComment).toContain('Security');
  });

  it('should track run status and metrics', async () => {
    const run = await orchestrator.executeCycle({
      event: mockWebhookEvent,
      sessionId: 'test-session-metrics',
    });

    expect(run.results.length).toBeGreaterThan(0);
    expect(run.blindSpots).toBeDefined();

    if (run.overallStatus === SessionStatus.Completed) {
      const hasFindings = run.escalations.length > 0 || run.prCommentBody.includes('finding');
      expect(hasFindings).toBe(true);
    }
  });
});

describe('Parallel runs', () => {
  it('should handle multiple concurrent reviews', async () => {
    const orchestrator = new Orchestrator();

    const events = [
      { ...mockWebhookEvent, pullRequest: { ...mockWebhookEvent.pullRequest, number: 1 } },
      { ...mockWebhookEvent, pullRequest: { ...mockWebhookEvent.pullRequest, number: 2 } },
    ];

    const runs = await Promise.all(
      events.map((event, i) =>
        orchestrator.executeCycle({
          event,
          sessionId: `parallel-session-${i}`,
        }),
      ),
    );

    expect(runs).toHaveLength(2);
    expect(runs[0].id).not.toBe(runs[1].id);
  });
});