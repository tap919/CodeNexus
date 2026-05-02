import { describe, it, expect } from 'vitest';
import { buildReviewPrompt, buildBlindSpotPrompt, buildFixPrompt, type ReviewContext } from './review-prompts';

const baseContext: ReviewContext = {
  diff: '--- a/file.ts\n+++ b/file.ts\n@@ -1,1 +1,1 @@\n-const x = 1;\n+const x = 2;',
  findings: [
    { type: 'TS001-eq-eq', severity: 'high', description: 'Use === instead of ==', file: 'file.ts', line: 1 },
    { type: 'SECRETS-leak', severity: 'critical', description: 'Hardcoded secret found', file: 'config.ts', line: 5 },
  ],
  mode: 'engineer',
  prTitle: 'Fix type coercion bug',
  prDescription: 'Changed == to === for safety',
  language: 'typescript',
};

describe('buildReviewPrompt', () => {
  it('returns messages array with system and user roles', () => {
    const { messages, stopTokens } = buildReviewPrompt(baseContext);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    expect(stopTokens).toBeGreaterThan(0);
  });

  it('includes findings in user message', () => {
    const { messages } = buildReviewPrompt(baseContext);
    expect(messages[1].content).toContain('TS001-eq-eq');
    expect(messages[1].content).toContain('SECRETS-leak');
    expect(messages[1].content).toContain('Fix type coercion bug');
  });

  it('truncates diffs over 8000 characters', () => {
    const longDiff = 'x'.repeat(10000);
    const { messages } = buildReviewPrompt({ ...baseContext, diff: longDiff });
    expect(messages[1].content).toContain('(truncated)');
    expect(messages[1].content.length).toBeLessThan(longDiff.length + 500);
  });

  it('vibe mode uses friendly system prompt', () => {
    const { messages } = buildReviewPrompt({ ...baseContext, mode: 'vibe' });
    expect(messages[0].content).toContain('plain language');
    expect(messages[0].content).toContain('business impact');
  });

  it('engineer mode uses technical system prompt', () => {
    const { messages } = buildReviewPrompt({ ...baseContext, mode: 'engineer' });
    expect(messages[0].content).toContain('root causes');
    expect(messages[0].content).toContain('concrete fix');
  });

  it('security mode uses security-focused system prompt', () => {
    const { messages } = buildReviewPrompt({ ...baseContext, mode: 'security' });
    expect(messages[0].content).toContain('trust boundary');
    expect(messages[0].content).toContain('CWE');
  });

  it('handles empty findings', () => {
    const { messages } = buildReviewPrompt({ ...baseContext, findings: [] });
    expect(messages[1].content).toContain('No automated scanner findings');
  });

  it('calculates stopTokens based on diff length', () => {
    const { stopTokens: s1 } = buildReviewPrompt({ ...baseContext, diff: 'a'.repeat(100) });
    const { stopTokens: s2 } = buildReviewPrompt({ ...baseContext, diff: 'a'.repeat(5000) });
    expect(s2).toBeGreaterThan(s1);
  });
});

describe('buildBlindSpotPrompt', () => {
  it('returns messages about missed findings', () => {
    const messages = buildBlindSpotPrompt(baseContext);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('missed');
    expect(messages[1].content).toContain('Fix type coercion bug');
  });
});

describe('buildFixPrompt', () => {
  it('generates fix prompt for a specific finding', () => {
    const messages = buildFixPrompt(baseContext.findings[0], 'const x = 1;');
    expect(messages).toHaveLength(2);
    expect(messages[1].content).toContain('TS001-eq-eq');
    expect(messages[1].content).toContain('const x = 1;');
    expect(messages[1].content).toContain('code change');
  });
});
