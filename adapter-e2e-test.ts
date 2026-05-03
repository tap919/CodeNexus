/**
 * E2E test for the 5 new adapter factories (replacing stubs).
 * Run: npx tsx adapter-e2e-test.ts
 */

const PASS = 'PASS';
const FAIL = 'FAIL';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ${PASS} ${label}`); passed++; }
  else { console.error(`  ${FAIL} ${label}`); failed++; }
}

async function testDesignReviewerAdapter() {
  console.log('\n── DesignReviewerAdapter ──');
  const { createDefaultDesignReviewer } = await import('./control-plane/src/adapters/design-reviewer-adapter');
  const adapter = createDefaultDesignReviewer();

  assert(typeof adapter.auditCode === 'function', 'exports auditCode function');

  const result = await adapter.auditCode('<div style="color: #000">text</div>', 'html');
  assert(result !== null, 'auditCode returns result');
  assert(typeof result.score === 'number', 'result has numeric score');
  assert(Array.isArray(result.antiPatterns), 'result has antiPatterns array');
  assert(Array.isArray(result.recommendations), 'result has recommendations array');

  console.log(`    Score: ${result.score}, Anti-patterns: ${result.antiPatterns.length}`);

  return result;
}

async function testKnowledgeEngineAdapter() {
  console.log('\n── KnowledgeEngineAdapter ──');
  const { createDefaultKnowledgeEngine } = await import('./control-plane/src/adapters/knowledge-engine-adapter');
  const adapter = createDefaultKnowledgeEngine();

  assert(typeof adapter.search === 'function', 'exports search function');

  const synthesis = await adapter.search('test query', 10);
  assert(synthesis !== null, 'search returns synthesis');
  assert(typeof synthesis.confidence === 'number', 'synthesis has numeric confidence');
  assert(Array.isArray(synthesis.keyConcepts), 'synthesis has keyConcepts array');
  assert(Array.isArray(synthesis.sources), 'synthesis has sources array');

  console.log(`    Confidence: ${synthesis.confidence}, Concepts: ${synthesis.keyConcepts.length}`);

  return synthesis;
}

async function testAgentRuntimeAdapter() {
  console.log('\n── AgentRuntimeAdapter ──');
  const { createDefaultAgentRuntime } = await import('./control-plane/src/adapters/agent-runtime-adapter');
  const adapter = createDefaultAgentRuntime();

  assert(typeof adapter.createSession === 'function', 'exports createSession');
  assert(typeof adapter.executePrompt === 'function', 'exports executePrompt');
  assert(typeof adapter.streamEvents === 'function', 'exports streamEvents');
  assert(typeof adapter.spawnSandbox === 'function', 'exports spawnSandbox');

  // createSession
  const session = await adapter.createSession(
    { provider: 'test', model: 'test', lspEnabled: false, maxDepth: 5, systemPrompt: '', reasoningEffort: 'low' },
    'review this code',
    'review' as any,
  );
  assert(session !== null, 'createSession returns session');
  assert(typeof session.id === 'string', 'session has id string');

  // spawnSandbox
  const sandboxId = await adapter.spawnSandbox({ image: 'test', resources: { cpu: 1, memory: '1GB', disk: '1GB' }, preBuildCommands: [], environment: {} });
  assert(typeof sandboxId === 'string', 'spawnSandbox returns id string');

  console.log(`    Session ID: ${session.id.slice(0, 8)}..., Sandbox: ${sandboxId.slice(0, 8)}...`);
}

async function testAnalyticsAdapter() {
  console.log('\n── AnalyticsAdapter ──');
  const { createDefaultAnalytics } = await import('./control-plane/src/adapters/analytics-adapter');
  const adapter = createDefaultAnalytics();

  assert(typeof adapter.recordMetric === 'function', 'exports recordMetric');
  assert(typeof adapter.recordEvent === 'function', 'exports recordEvent');

  await adapter.recordMetric({
    prNumber: 1,
    repository: 'test/repo',
    totalComments: 5,
    botComments: 3,
    humanComments: 2,
    fixesApplied: 1,
    timeToFix: 120,
    confidence: 0.85,
    timestamp: new Date().toISOString(),
  });

  await adapter.recordEvent('test_event', { key: 'value' });

  console.log(`    recordMetric and recordEvent called OK`);
}

async function testAuthAdapter() {
  console.log('\n── AuthAdapter ──');
  const { createDefaultAuth } = await import('./control-plane/src/adapters/auth-adapter');
  const adapter = createDefaultAuth();

  assert(typeof adapter.validateWebhook === 'function', 'exports validateWebhook');
  assert(typeof adapter.authenticate === 'function', 'exports authenticate');
  assert(typeof adapter.checkAccess === 'function', 'exports checkAccess');

  // validateWebhook with valid HMAC
  const secret = 'test-secret';
  const payload = 'test-payload';
  const hmac = `sha256=${require('crypto').createHmac('sha256', secret).update(payload).digest('hex')}`;
  const valid = await adapter.validateWebhook(payload, hmac, secret);
  assert(valid === true, 'validateWebhook: valid signature passes');

  // validateWebhook with invalid HMAC
  const invalid = await adapter.validateWebhook(payload, 'sha256=bad', secret);
  assert(invalid === false, 'validateWebhook: invalid signature fails');

  // authenticate
  const session = await adapter.authenticate('token123');
  assert(session.username === 'codenexus-bot', 'authenticate returns bot session');

  // checkAccess with empty rules
  const accessOk = await adapter.checkAccess(session, []);
  assert(accessOk === true, 'checkAccess: empty rules → true');

  // checkAccess with deny rule
  const accessDenied = await adapter.checkAccess(session, [{ domain: '*', policy: 'deny' as any }]);
  assert(accessDenied === false, 'checkAccess: deny policy → false');

  console.log(`    HMAC validation, session creation, and access checks all pass`);
  console.log(`    Bot user: ${session.username}, groups: ${session.groups.join(', ')}`);
}

async function main() {
  console.log('=== CodeNexus Adapter Factory Tests ===\n');

  await testDesignReviewerAdapter();
  await testKnowledgeEngineAdapter();
  await testAgentRuntimeAdapter();
  await testAnalyticsAdapter();
  await testAuthAdapter();

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
