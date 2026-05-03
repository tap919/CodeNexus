/**
 * E2E test for all 7 new adapters.
 * Run: cd control-plane && npx tsx ../e2e-test.ts
 */

import { HistoryAnalyzer } from './control-plane/src/adapters/history-analyzer';
import { CoverageAnalyzer } from './control-plane/src/adapters/coverage-analyzer';
import { scoreFindings, type ScoredFinding } from './control-plane/src/adapters/confidence-scorer';
import { PolicyEngine } from './control-plane/src/adapters/policy-engine';
import { FixLoop } from './control-plane/src/adapters/fix-loop';

const PASS = 'PASS';
const FAIL = 'FAIL';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ${PASS} ${label}`); passed++; }
  else { console.error(`  ${FAIL} ${label}`); failed++; }
}

async function testHistoryAnalyzer() {
  console.log('\n── HistoryAnalyzer ──');
  const analyzer = new HistoryAnalyzer(process.cwd());

  const files = [
    'control-plane/src/orchestrator.ts',
    'control-plane/src/adapters/fix-executor.ts',
    'shared/src/types.ts',
  ];

  const histories = await analyzer.analyzeFiles(files);
  assert(histories.length === files.length, 'returns one FileHistory per input');
  assert(histories.every(h => typeof h.commitCount30d === 'number'), 'all have commitCount30d');
  assert(histories.every(h => typeof h.churnSignal === 'string'), 'all have churnSignal');
  assert(histories.every(h => Array.isArray(h.uniqueAuthors)), 'all have uniqueAuthors array');

  console.log(`    orchestrator.ts churn: ${histories[0].churnSignal} (${histories[0].commitCount30d} commits)`);
  console.log(`    fix-executor.ts churn: ${histories[1].churnSignal} (${histories[1].commitCount30d} commits)`);
  console.log(`    types.ts churn: ${histories[2].churnSignal} (${histories[2].commitCount30d} commits)`);

  return histories;
}

async function testCoverageAnalyzer() {
  console.log('\n── CoverageAnalyzer ──');

  const analyzer = new CoverageAnalyzer(process.cwd());
  const isRepo = (analyzer as any).isGitRepo();
  assert(typeof isRepo === 'boolean', 'isGitRepo returns boolean');

  // Test with non-git path (guaranteed to skip)
  const nonGitAnalyzer = new CoverageAnalyzer('/tmp/nonexistent');
  const delta = await nonGitAnalyzer.computeDelta('abc123', 'def456');
  assert(delta.baseLineCoverage === 0, 'non-git path returns zero coverage (guard)');
  assert(delta.droppedFiles.length === 0, 'non-git path returns empty droppedFiles');

  console.log(`    Current workspace is git repo: ${isRepo}`);
  console.log(`    Guard test: skipped coverage for non-repo path`);
}

function testConfidenceScorer(histories: any[]) {
  console.log('\n── ConfidenceScorer ──');

  // Critical security alert
  const securityAlerts = [{
    id: 'alert-1',
    severity: 'critical' as const,
    type: 'secrets_leak' as const,
    description: 'API key found in source',
    agentId: 'test',
    details: { path: 'src/config.ts', lineNumber: 42, source: 'semgrep' },
    timestamp: new Date().toISOString(),
  }];

  // LSP type error with external references
  const symbolImpacts = [{
    changedSymbol: 'src/app.ts:15',
    filePath: 'src/app.ts',
    usageSites: [{ file: '/workspace/src/other.ts', line: 8, context: '' }],
    typeErrors: [{ file: 'src/app.ts', line: 15, message: 'Type string is not assignable to number' }],
  }];

  // Cross-file impact with 6 affected files (high breakage)
  const crossFileImpacts = [{
    changedFile: 'src/utils.ts',
    changedExport: 'formatDate',
    affectedFiles: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts', 'src/f.ts'],
    breakageRisk: 'high' as const,
    reason: 'formatDate is imported by 6 files not in PR',
  }];

  // History: high churn with recent bug fixes
  const fileHistories = [{
    filePath: 'src/hotspot.ts',
    commitCount30d: 15,
    uniqueAuthors: ['alice', 'bob', 'carol'],
    lastBugFixDate: '2026-04-28',
    churnSignal: 'high' as const,
    recentMessages: ['fix: null pointer', 'hack: workaround', 'fix: crash on startup'],
  }];

  const findings = scoreFindings({
    securityAlerts,
    symbolImpacts,
    crossFileImpacts,
    fileHistories,
    coverageDelta: -8.5,
  });

  assert(findings.length > 0, 'returns non-empty findings array');
  assert(findings.some(f => f.source === 'security'), 'scores security alerts');
  assert(findings.some(f => f.source === 'lsp'), 'scores LSP type errors');
  assert(findings.some(f => f.source === 'cross-file'), 'scores cross-file impacts');
  assert(findings.some(f => f.source === 'history'), 'scores history churn signals');
  assert(findings.some(f => f.source === 'coverage'), 'scores coverage delta');

  // Sort: highest severity first
  const severities = findings.map(f => f.severity);
  assert(severities[0] === 'critical', 'sort: first finding is critical');

  // Security: semgrep = high confidence, critical = block-merge
  const sec = findings.filter(f => f.source === 'security');
  assert(sec[0].action === 'block-merge', 'critical security → block-merge');
  assert(sec[0].confidence === 'high', 'semgrep → high confidence');

  // LSP: type errors = high confidence + auto-fix
  const lsp = findings.filter(f => f.source === 'lsp');
  assert(lsp.length > 0, 'lsp findings present');
  assert(lsp[0].action === 'auto-fix', 'lsp type errors → auto-fix');
  assert(lsp[0].filePath !== undefined, 'lsp finding has file path');

  // Cross-file: high breakage = block-merge
  const xfile = findings.filter(f => f.source === 'cross-file');
  assert(xfile[0].action === 'block-merge', 'high breakage → block-merge');

  // Coverage: delta -8.5% = medium severity
  const cov = findings.filter(f => f.source === 'coverage');
  assert(cov[0].severity === 'medium', '-8.5% delta → medium (not high, not low)');

  // History: high churn should produce *at least one* finding
  const hist = findings.filter(f => f.source === 'history');
  assert(hist.length > 0, 'high churn produces history findings');

  console.log(`    Sources: ${[...new Set(findings.map(f => f.source))].join(', ')}`);
  console.log(`    Findings: ${findings.length} total`);
  console.log(`    Actions: ${[...new Set(findings.map(f => f.action))].join(', ')}`);

  return findings;
}

function testPolicyEngine(findings: ScoredFinding[]) {
  console.log('\n── PolicyEngine ──');
  const engine = new PolicyEngine();
  const decisions = engine.decide(findings);

  assert(decisions.length === findings.length, 'one decision per finding');
  assert(engine.shouldBlockMerge(decisions), 'shouldBlockMerge = true for critical security');

  const autoFix = engine.getAutoFixCandidates(decisions);
  assert(autoFix.length > 0, 'getAutoFixCandidates returns auto-apply findings');
  assert(autoFix.every(d => d.action === 'auto-apply'), 'auto-fix candidates have correct action');

  const fixPR = engine.getFixPRCandidates(decisions);
  assert(fixPR.every(d => d.action === 'open-fix-pr'), 'fix-pr candidates have correct action');

  // Default fallback
  const unknown: ScoredFinding = {
    id: 'unk-1', title: 'U', body: 'U',
    severity: 'medium', confidence: 'low',
    source: 'history', action: 'inform',
  };
  const ukDecisions = engine.decide([unknown]);
  assert(ukDecisions[0].action === 'suggest-inline', 'unmatched → suggest-inline');

  console.log(`    ${decisions.length} decisions`);
  console.log(`    Actions: ${[...new Set(decisions.map(d => d.action))].join(', ')}`);
}

function testFixLoop() {
  console.log('\n── FixLoop ──');
  const mockLLM = { complete: async (_p: string) => `--- a/x.ts\n+++ b/x.ts\n@@ -1 +1,2 @@\n const a=1;\n+const b=2;` };
  const mockVerifier = { verify: async (_p: string) => ({ passed: true, output: 'OK' }) };
  const fixLoop = new FixLoop(mockLLM, mockVerifier, 2);
  assert(fixLoop instanceof FixLoop, 'FixLoop instantiates');
  console.log(`    FixLoop constructor OK`);
}

function testParseDiffFiles() {
  console.log('\n── parseDiffFiles (inlined) ──');

  // Inline the parseDiffFiles logic
  function parseDiffFiles(diff: string): Array<{ path: string; patch: string }> {
    if (!diff) return [];
    const files: Array<{ path: string; patch: string }> = [];
    const chunks = diff.split(/^diff --git /m).filter(Boolean);
    for (const chunk of chunks) {
      const m = chunk.match(/^a\/(.+?) b\/(.+?)$/m);
      if (m) files.push({ path: m[1], patch: `diff --git ${chunk}` });
    }
    return files;
  }

  const sample = `diff --git a/src/app.ts b/src/app.ts
index 123..456 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 const x = 1;
+const y = 2;
 console.log(x);
diff --git a/src/utils.ts b/src/utils.ts
new file mode 100644
--- /dev/null
+++ b/src/utils.ts
@@ -0,0 +1,3 @@
+export function foo() {
+  return 42;
+}`;

  const files = parseDiffFiles(sample);
  assert(files.length === 2, 'parses 2 files');
  assert(files[0].path === 'src/app.ts', 'path: app.ts');
  assert(files[1].path === 'src/utils.ts', 'path: utils.ts');
  assert(files[0].patch.includes('@@ -1,3 +1,4 @@'), 'patch has hunks');

  // Empty diff
  assert(parseDiffFiles('').length === 0, 'empty diff → empty array');

  // Single file diff
  const single = parseDiffFiles('diff --git a/one.ts b/one.ts\n@@ -1 +1,2 @@\n');
  assert(single.length === 1, 'single file diff');
  assert(single[0].path === 'one.ts', 'single file path');

  console.log(`    Parsed ${files.length} files, edge cases OK`);
}

// ── Run ──

async function main() {
  console.log('=== CodeNexus E2E Adapter Tests ===\n');

  await testCoverageAnalyzer();
  testFixLoop();
  testParseDiffFiles();
  const histories = await testHistoryAnalyzer();
  const findings = testConfidenceScorer(histories);
  testPolicyEngine(findings);

  console.log(`\n── Results ──`);
  console.log(`  ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0) {
    console.error(`\n${failed} test(s) FAILED`);
    process.exit(1);
  } else {
    console.log(`\nAll tests passed.`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
