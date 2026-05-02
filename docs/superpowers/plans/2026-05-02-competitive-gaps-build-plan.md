# CodeNexus Competitive Build Plan — 7 Components

> **Goal:** Close the gap with CodeRabbit, SonarQube, DeepSource, and Graphite by adding SAST scanning, GitHub App delivery, LLM-powered review, CI/CD integration, stacked PR detection, Node.js orchestrator adapter, and Tree-sitter AST analysis.

---

## Component 1: Semgrep SAST Integration

**Effort:** Low | **Impact:** Very High | **Target:** DeepSource/SonarQube on static analysis

### What
Integrate Semgrep OSS as a SAST detector in the security module. Semgrep provides 2,600+ deterministic rules across 30+ languages. It runs locally, outputs JSON/SARIF, and catches SQL injection, XSS, path traversal, crypto misuse, etc.

### Files to create
- `security/src/detectors/semgrep.ts` — Semgrep CLI wrapper
- `security/src/rules/` — Custom Semgrep rules directory

### Implementation

```typescript
// security/src/detectors/semgrep.ts
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Severity } from '../../../shared/src/types';

export interface SemgrepFinding {
  checkId: string;
  message: string;
  severity: Severity;
  path: string;
  line: number;
  column: number;
  language: string;
  fix?: string;
}

export class SemgrepScanner {
  private available: boolean;

  constructor() {
    this.available = this.checkSemgrep();
    this.available = false; // Remove this line after installation
  }

  private checkSemgrep(): boolean {
    try {
      execSync('semgrep --version', { stdio: 'ignore', timeout: 10000 });
      return true;
    } catch {
      console.warn('[Security] semgrep not found — install with: pip install semgrep');
      return false;
    }
  }

  scan(targetPath: string, rules?: string[]): SemgrepFinding[] {
    if (!this.available) return [];

    const rulesFlag = rules?.length
      ? rules.map(r => `--config=${r}`).join(' ')
      : '--config=auto';

    try {
      const output = execSync(
        `semgrep scan --json${rulesFlag ? ' ' + rulesFlag : ''} "${targetPath}" 2>/dev/null`,
        { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: 60000 }
      );

      const result = JSON.parse(output);
      return (result.results || []).map((r: any) => ({
        checkId: r.check_id,
        message: r.extra?.message || r.check_id,
        severity: this.mapSeverity(r.extra?.severity || 'INFO'),
        path: r.path,
        line: r.start?.line || 0,
        column: r.start?.col || 0,
        language: r.extra?.language || '',
        fix: r.extra?.fix,
      }));
    } catch {
      return [];
    }
  }

  private mapSeverity(s: string): Severity {
    switch (s.toUpperCase()) {
      case 'ERROR': return 'critical';
      case 'WARNING': return 'high';
      case 'INFO': return 'medium';
      default: return 'low';
    }
  }
}
```

### Wire into SecurityManager
In `security/src/index.ts`, add SemgrepScanner to the detector pipeline. Run scans on file paths from the PR diff.

### Verification
```bash
pip install semgrep
echo 'x = input()' > /tmp/test.py
semgrep scan --config=auto /tmp/test.py | grep 'taint-backend'
```
Expected: detects user-controlled input sink.

---

## Component 2: GitHub App + PR Decoration

**Effort:** Medium | **Impact:** Very High | **Target:** CodeRabbit/Copilot CR on delivery

### What
Convert the PR Manager from a PAT-based client into a GitHub App that can post inline review comments on PRs. This enables CodeNexus to decorate diffs with findings.

### Files to modify
- `pr-manager/src/github-client.ts` — Add App auth flow (partially done)
- `pr-manager/src/index.ts` — Add `postReview()` method
- `control-plane/src/index.ts` — Wire webhook handler to create review

### Implementation

```typescript
// Add to pr-manager/src/index.ts
async postReview(
  owner: string,
  repo: string,
  prNumber: number,
  commitId: string,
  body: string,
  comments: Array<{ path: string; position: number; body: string }>
): Promise<void> {
  const mutation = `
    mutation($input: SubmitPullRequestReviewInput!) {
      submitPullRequestReview(input: $input) {
        pullRequestReview { id }
      }
    }
  `;

  await this.client.graphqlQuery(mutation, {
    input: {
      pullRequestId: `PR_${owner}_${repo}_${prNumber}`,
      commitOID: commitId,
      body,
      event: 'COMMENT',
      comments: comments.map(c => ({
        path: c.path,
        position: c.position,
        body: c.body,
      })),
    },
  });
}
```

### GitHub App registration
In `docs/github-app-setup.md`, document:
1. Register App at GitHub Settings > Developer settings > GitHub Apps
2. Set webhook URL: `https://codenexus.dev/api/webhooks/github`
3. Permissions: Pull requests (read/write), Checks (write), Contents (read), Issues (read/write)
4. Subscribe to events: Pull request, Pull request review, Issue comment
5. Generate private key → set `GITHUB_APP_PRIVATE_KEY` env var

### Wire into webhook handler
In `control-plane/src/index.ts`, after the analysis completes, call:
```typescript
await prManager.postReview(owner, repo, prNumber, headSha, summary, findings);
```

### Verification
Create a PR in a test repo. Trigger webhook. Verify CodeNexus comments appear inline on the PR diff.

---

## Component 3: Wire LLM for AI-Powered Code Review

**Effort:** Medium | **Impact:** Very High | **Target:** CodeRabbit/DeepSource on AI review quality

### What
Wire the AgentRuntime to an actual LLM API (OpenAI or Anthropic) for semantic code understanding. Currently the agent-runtime is a session manager with no LLM integration. Add a code review prompt that feeds findings context to the LLM for explanation, fix generation, and blind spot detection.

### Files to create/modify
- `agent-runtime/src/llm-provider.ts` — Provider abstraction (OpenAI + Anthropic)
- `agent-runtime/src/review-prompt.ts` — Code review prompt templates
- `agent-runtime/src/index.ts` — Add `executeReviewPrompt()` method

### Provider abstraction

```typescript
// agent-runtime/src/llm-provider.ts
export interface LLMConfig {
  provider: 'openai' | 'anthropic';
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage: { promptTokens: number; completionTokens: number };
}

export class LLMProvider {
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    if (this.config.provider === 'openai') {
      return this.callOpenAI(messages);
    }
    return this.callAnthropic(messages);
  }

  private async callOpenAI(messages: LLMMessage[]): Promise<LLMResponse> {
    // POST https://api.openai.com/v1/chat/completions
    // Authorization: Bearer ${config.apiKey}
  }

  private async callAnthropic(messages: LLMMessage[]): Promise<LLMResponse> {
    // POST https://api.anthropic.com/v1/messages
    // x-api-key: ${config.apiKey}
    // anthropic-version: 2023-06-01
  }
}
```

### Review prompt

```
You are reviewing a pull request for the CodeNexus platform.
Analyze the provided diff and classification results.

Findings detected by security scanners:
${findings}

Diff:
${diff}

For each finding:
1. Explain *why* this matters (business impact, not just technical)
2. Suggest a concrete fix
3. Flag anything the scanners might have missed (blind spots)
4. Estimate confidence (high/medium/low) with reasoning
```

### Execution
```typescript
// Add to AgentRuntime
async executeReviewPrompt(context: {
  diff: string;
  findings: SecurityFinding[];
  mode: 'vibe' | 'engineer' | 'security';
}): Promise<LLMResponse> {
  const prompt = buildReviewPrompt(context.diff, context.findings, context.mode);
  return this.llm.chat(prompt);
}
```

### Verification
```bash
export OPENAI_API_KEY=sk-...
# Create a test diff + findings, call executeReviewPrompt
node -e "
const { AgentRuntime, LLMProvider } = require('./agent-runtime/src');
const llm = new LLMProvider({ provider: 'openai', apiKey: process.env.OPENAI_API_KEY, model: 'gpt-4o' });
const result = await llm.chat([{ role: 'user', content: 'Explain what a race condition is in 2 sentences.' }]);
console.log(result.content);
"
```
Expected: clear explanation with model info and token usage.

---

## Component 4: CI/CD Mode + SARIF Output

**Effort:** Low | **Impact:** High | **Target:** SonarQube quality gates

### What
Add a CI mode to CodeNexus that outputs SARIF (Static Analysis Results Interchange Format). SARIF is supported by GitHub, GitLab, Azure DevOps, and most CI systems. This enables CodeNexus to act as a CI check that blocks merges on quality failures.

### Files to create
- `cli-generator/src/ci-mode.ts` — CI mode runner
- `scripts/ci-scan.sh` — CI entrypoint script

### CLI mode

```typescript
// cli-generator/src/ci-mode.ts
import { SemgrepScanner } from '../../security/src/detectors/semgrep';
import { SecretsScanner } from '../../security/src/detectors/secrets-scanner';
import { GitleaksScanner } from '../../security/src/detectors/gitleaks';

interface SARIFOutput {
  version: '2.1.0';
  runs: Array<{
    tool: { driver: { name: string; version: string } };
    results: Array<{
      ruleId: string;
      level: 'error' | 'warning' | 'note';
      message: { text: string };
      locations: Array<{
        physicalLocation: {
          artifactLocation: { uri: string };
          region: { startLine: number };
        };
      }>;
    }>;
  }>;
}

export async function runCIScan(targetPath: string): Promise<SARIFOutput> {
  const semgrep = new SemgrepScanner();
  const semgrepResults = semgrep.scan(targetPath);

  return {
    version: '2.1.0',
    runs: [{
      tool: { driver: { name: 'CodeNexus', version: '1.0.0' } },
      results: semgrepResults.map(f => ({
        ruleId: f.checkId,
        level: f.severity === 'critical' ? 'error' : f.severity === 'high' ? 'warning' : 'note',
        message: { text: f.message },
        locations: [{
          physicalLocation: {
            artifactLocation: { uri: f.path },
            region: { startLine: f.line },
          },
        }],
      })),
    }],
  };
}
```

### Workflow
Create `.github/workflows/codenexus-ci.yml`:
```yaml
name: CodeNexus CI
on: [pull_request]
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npx codenexus ci-scan --output results.sarif --path .
      - uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: results.sarif
```

### Verification
```bash
echo 'password = "sk-abc123"' > test_leak.py
npx codenexus ci-scan --output /tmp/results.sarif --path .
cat /tmp/results.sarif | grep -c '"results"'
```
Expected: finds hardcoded secret.

---

## Component 5: Tree-sitter AST Language Analysis

**Effort:** High | **Impact:** High | **Target:** SonarQube per-language rule depth

### What
Integrate Tree-sitter for AST-level code analysis per language. Tree-sitter provides a concrete syntax tree parseable into structured queries. This enables language-specific findings (e.g., Python's `except: pass`, JavaScript's `==` vs `===`, TypeScript's `any` types).

### Files to create
- `security/src/ast-analyzers/typescript.ts` — TS-specific rules
- `security/src/ast-analyzers/python.ts` — Py-specific rules  
- `security/src/ast-analyzers/java.ts` — Java-specific rules
- `security/src/ast-analyzers/index.ts` — Analyzer registry

### Architecture
```typescript
// security/src/ast-analyzers/index.ts
import type { Finding } from '../types';

export interface ASTAnalyzer {
  language: string;
  analyze(sourceCode: string, filePath: string): Finding[];
}

const analyzers: Map<string, ASTAnalyzer> = new Map();

export function registerAnalyzer(analyzer: ASTAnalyzer): void {
  analyzers.set(analyzer.language, analyzer);
}

export function analyzeFile(filePath: string, content: string): Finding[] {
  const ext = filePath.split('.').pop() || '';
  const langMap: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'typescript', jsx: 'typescript',
    py: 'python', java: 'java', go: 'golang', rs: 'rust',
  };
  const language = langMap[ext];
  const analyzer = language ? analyzers.get(language) : null;
  return analyzer?.analyze(content, filePath) || [];
}
```

### TypeScript rules example
```typescript
// security/src/ast-analyzers/typescript.ts
export class TypeScriptAnalyzer implements ASTAnalyzer {
  language = 'typescript';
  private rules: Array<{
    name: string;
    description: string;
    severity: 'critical' | 'high' | 'medium';
    test: (source: string) => boolean;
  }> = [
    {
      name: 'TS001-eq-eq',
      description: 'Use === instead of == to avoid type coercion bugs',
      severity: 'high',
      test: (src) => /[^=]==[^=]/.test(src) && !/==='.test(src),
    },
    {
      name: 'TS002-any-type',
      description: 'Avoid `any` type — use `unknown` for better type safety',
      severity: 'medium',
      test: (src) => /:\s*any(\s|\)|,)/.test(src),
    },
    {
      name: 'TS003-console-log',
      description: 'Console.log left in production code',
      severity: 'low',
      test: (src) => /console\.(log|debug|info)/.test(src),
    },
  ];

  analyze(sourceCode: string, filePath: string): Finding[] {
    return this.rules
      .filter(rule => rule.test(sourceCode))
      .map(rule => ({
        ruleId: rule.name,
        message: rule.description,
        severity: rule.severity,
        path: filePath,
        line: 0,
      }));
  }
}
```

### Verification
Create a test file with `==`, `any`, `console.log` — run the analyzer, verify all three findings are returned.

---

## Component 6: Node.js Orchestrator Adapter

**Effort:** Medium | **Impact:** Medium | **Target:** Self-hosted deployments

### What
Add a Node.js Express adapter for the control-plane orchestrator so it can run without Cloudflare Workers. Currently the orchestrator uses itty-router + Durable Objects which only works on Workers.

### Files to create
- `control-plane/src/node-adapter.ts` — Express-based HTTP routes
- `control-plane/src/in-memory-session.ts` — In-memory session store

### Implementation
```typescript
// control-plane/src/node-adapter.ts
import express from 'express';
import { WorkflowEngine } from '../../packages/workflow-engine/src/index';
import { createReviewWorkflow } from '../../packages/workflow-engine/src/review-workflow';
import { Orchestrator } from './orchestrator';

export function createNodeApp(orchestrator: Orchestrator): express.Application {
  const app = express();
  app.use(express.json());

  // Health
  app.get('/health', (_, res) => res.json({ status: 'ok', version: '0.1.0' }));

  // Webhook
  app.post('/api/webhooks/github', async (req, res) => {
    const signature = req.headers['x-hub-signature-256'] as string;
    const body = JSON.stringify(req.body);

    // Verify signature
    if (!verifyWebhookSignature(body, signature)) {
      res.status(401).json({ error: 'invalid_signature' });
      return;
    }

    // Execute workflow
    const run = await orchestrator.executeReview(createReviewWorkflow, {
      payload: req.body,
      signature,
    });

    res.status(202).json({
      message: 'Webhook received, review initiated',
      sessionId: run.id,
      deliveryId: req.headers['x-github-delivery'],
    });
  });

  // Workflow runs
  app.get('/api/workflows/runs', (_, res) => {
    res.json({ count: orchestrator.workflowEngine.listRuns().length, runs: orchestrator.workflowEngine.listRuns() });
  });

  app.get('/api/workflows/runs/:runId', (req, res) => {
    const run = orchestrator.workflowEngine.getRun(req.params.runId);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    res.json(run);
  });

  return app;
}
```

### Verification
```bash
node -e "
const express = require('express');
const { createNodeApp } = require('./control-plane/src/node-adapter');
const app = createNodeApp();
const server = app.listen(3001, () => console.log('Control plane running on :3001'));
"
curl http://localhost:3001/health
# Expected: {"status":"ok","version":"0.1.0"}
```

---

## Component 7: PR Stack Detection

**Effort:** Low | **Impact:** Medium | **Target:** Graphite on stacked PRs

### What
Add PR stack detection to the PR Manager. A "stack" is a chain of dependent PRs where one PR targets another PR's branch instead of main. Detecting this enables CodeNexus to show stacked context in reviews.

### Files to modify
- `pr-manager/src/github-client.ts` — Add PR stack discovery
- `pr-manager/src/index.ts` — Add `getPRStack()` method

### Implementation
```typescript
// Add to GitHubClient class
async getPRStack(owner: string, repo: string, prNumber: number): Promise<PRStackInfo> {
  const pr = await this.fetchPRInfo(owner, repo, prNumber);

  // If base branch is not main/master/default, check if it belongs to another PR
  const defaultBranch = 'main'; // Could also fetch from repo
  if (pr.base.ref === defaultBranch) {
    return { current: pr, parent: null, children: await this.findChildPRs(owner, repo, pr.head.ref) };
  }

  // Find the parent PR (the PR whose head matches our base)
  const parentPR = await this.discoverPR(owner, repo, pr.base.ref);
  const children = await this.findChildPRs(owner, repo, pr.head.ref);

  return {
    current: pr,
    parent: parentPR || null,
    children,
    stackHeight: parentPR ? await this.getStackHeight(owner, repo, parentPR.number) + 1 : 0,
  };
}

private async findChildPRs(owner: string, repo: string, branch: string): Promise<StackInfo[]> {
  // Search for PRs whose base branch matches this branch
  const result = await this.graphqlQuery(`
    query($owner: String!, $repo: String!, $branch: String!) {
      repository(owner: $owner, name: $repo) {
        pullRequests(baseRefName: $branch, states: OPEN) {
          nodes { number, title, headRefName }
        }
      }
    }
  `, { owner, repo, branch });

  return result?.repository?.pullRequests?.nodes?.map((n: any) => ({
    number: n.number,
    title: n.title,
    branch: n.headRefName,
  })) || [];
}
```

### Verification
Create two PRs where PR #2 targets PR #1's branch:
```bash
git checkout -b feature/part-1
# commit changes
gh pr create --base main --head feature/part-1  # PR #1

git checkout feature/part-1 -b feature/part-2
# commit more changes
gh pr create --base feature/part-1 --head feature/part-2  # PR #2

node -e "
const { GitHubClient } = require('./pr-manager/src/github-client');
const client = new GitHubClient(process.env.GITHUB_TOKEN);
const stack = await client.getPRStack('owner', 'repo', 2);
console.log('Stack height:', stack.stackHeight);
console.log('Parent PR:', stack.parent?.number);
"
```
Expected: stackHeight = 1, parent PR number = 1.

---

## Execution Order

| Phase | Components | Rationale |
|-------|-----------|-----------|
| **Phase 1** | 1 (Semgrep) + 4 (CI/CD SARIF) | Drop-in additions, no existing code changes, immediate SAST value |
| **Phase 2** | 2 (GitHub App) + 7 (PR Stack) | Full PR lifecycle integration, enables diff decoration |
| **Phase 3** | 3 (LLM Integration) | Requires Phase 2 to have diff access for prompt context |
| **Phase 4** | 5 (Tree-sitter AST) | Parallel to Phase 3, independent |
| **Phase 5** | 6 (Node.js Adapter) | Packaging for self-hosted deployment |

## Total Effort Estimate

| Component | Files | Lines | Deps | Time |
|-----------|-------|-------|------|------|
| 1. Semgrep | 1 | ~80 | `semgrep` pip | 1h |
| 2. GitHub App | 2 | ~100 | None | 3h |
| 3. LLM Provider | 3 | ~250 | `openai` or `@anthropic-ai/sdk` | 3h |
| 4. CI/CD SARIF | 2 | ~120 | None | 1h |
| 5. Tree-sitter | 5 | ~300 | `web-tree-sitter` | 4h |
| 6. Node Adapter | 2 | ~150 | `express` | 2h |
| 7. PR Stack | 2 | ~80 | None | 1h |
| **Total** | **17** | **~1080** | — | **~15h** |
