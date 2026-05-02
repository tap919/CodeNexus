/**
 * @file §4.2 Authorization and Source-to-Sink Analysis
 *
 * Traces the path from user input through transformations to final
 * sinks (logs, databases, caches, external API calls), verifies
 * Insecure Direct Object Reference (IDOR) protections, and assesses
 * server-side access control enforcement.
 *
 * Conforms to OWASP ASVS V4 (especially V2 Authentication, V4 Access
 * Control) and OWASP Top 10 2021 (A01 Broken Access Control, A04
 * Insecure Design).
 *
 * @packageDocumentation
 */

import {
  SourceToSinkTrace,
  DataTransformation,
  RiskLevel,
  AuditFindingSeverity,
  ValidationLens,
} from '../../shared/src/types';

// ─── Public Interfaces ───────────────────────────────────────────

/**
 * Direction of data flow for a trace segment.
 */
export type FlowDirection = 'inbound' | 'internal' | 'outbound';

/**
 * Result of an IDOR (Insecure Direct Object Reference) verification
 * scan against a set of changed files and their corresponding routes.
 */
export interface IDORVerification {
  /** The specific route or endpoint inspected. */
  readonly route: string;

  /** Whether server-side access control is enforced for this route. */
  readonly enforced: boolean;

  /**
   * The mechanism used for access control, e.g.
   * "RBAC middleware", "ownership check", "attribute-based policy".
   */
  readonly mechanism: string;

  /** Whether the object reference appears to be modifiable by the client. */
  readonly idorVulnerable: boolean;

  /** Human-readable explanation of the IDOR assessment. */
  readonly idorDetails: string;

  /** Severity assigned to this finding. */
  readonly severity: AuditFindingSeverity;
}

/**
 * Overall assessment of access-control posture for the analysed
 * code changes.
 */
export interface AccessControlAssessment {
  /** List of IDOR-verification results per route. */
  readonly idorFindings: readonly IDORVerification[];

  /**
   * Overall access-control status.
   * - `PASS`: All routes enforce server-side checks.
   * - `WARN`: Some routes lack checks or have weak mechanisms.
   * - `FAIL`: Critical routes expose IDOR vulnerabilities.
   */
  readonly status: 'PASS' | 'WARN' | 'FAIL';

  /** Human-readable summary. */
  readonly summary: string;
}

/**
 * Complete source-to-sink analysis output, combining tracing,
 * IDOR verification, and access-control assessment.
 */
export interface SourceToSinkAnalysis {
  readonly traces: readonly SourceToSinkTrace[];
  readonly idorVerifications: readonly IDORVerification[];
  readonly accessControl: AccessControlAssessment;
}

// ─── Internal Pattern Constants ──────────────────────────────────

/**
 * Regex patterns that identify user-input sources.
 *
 * @internal
 */
const INPUT_SOURCE_PATTERNS: readonly RegExp[] = Object.freeze([
  /\breq\.(body|params|query|headers|cookies)\b/i,
  /\brequest\.(body|params|query|headers|cookies)\b/i,
  /\bctx\.(body|params|query|headers|cookies)\b/i,
  /\bevent\.(body|data|records?)\b/i, // Lambda / webhook handlers
  /\binput\b/i,
  /\bpayload\b/i,
  /\bformData\b|\bFormData\b/,
  /\bsearchParams\b|\bURLSearchParams\b/,
  /\b(readBody|readFormData|parseBody|parseForm)\b/i,
]);

/**
 * Regex patterns that identify data-transformation operations.
 *
 * @internal
 */
const TRANSFORMATION_PATTERNS: readonly {
  readonly description: string;
  readonly regex: RegExp;
}[] = Object.freeze([
  { description: 'JSON parse/serialize', regex: /\bJSON\.(parse|stringify)\b/ },
  { description: 'Type coercion', regex: /\b(parseInt|parseFloat|Number|String|Boolean|toString)\s*\(/ },
  { description: 'Data mapping', regex: /\b(map|reduce|filter|flatMap|transform)\s*\(/ },
  { description: 'Validation / sanitisation', regex: /\b(validate|sanitize|sanitise|escape|encode)\b/i },
  { description: 'Encryption / hashing', regex: /\b(encrypt|decrypt|hash|bcrypt|argon2|aes|sha256|hmac)\b/i },
  { description: 'Database ORM call', regex: /\b(prisma|typeorm|drizzle|knex|mongoose|sequelize)\b/i },
  { description: 'Object assignment / spread', regex: /\b(Object\.assign|spread|\.\.\.)\b/ },
]);

/**
 * Regex patterns that identify final sinks.
 *
 * @internal
 */
const SINK_PATTERNS: readonly { readonly label: string; readonly regex: RegExp }[] =
  Object.freeze([
    { label: 'Database write', regex: /\b(create|update|upsert|save|insert|delete|remove)\s*\(/i },
    { label: 'Log output', regex: /\b(console\.log|logger\.|log\.info|log\.error|log\.warn)\b/i },
    { label: 'HTTP response', regex: /\bres\.(json|send|status|redirect|render)\b/i },
    { label: 'Cache store', regex: /\b(cache|redis|memcached|setex|set\(|put\s*\()/i },
    { label: 'External API call', regex: /\b(fetch|axios|got|superagent|request)\s*\(/i },
    { label: 'Message queue publish', regex: /\b(publish|send|emit|produce|enqueue)\s*\(/i },
    { label: 'File write', regex: /\b(writeFile|writeFileSync|appendFile|createWriteStream)\b/i },
    { label: 'WebSocket send', regex: /\b(ws\.send|socket\.emit|broadcast|io\.emit)\b/i },
  ]);

/**
 * Regex patterns that signal IDOR vulnerabilities in route handlers.
 *
 * @internal
 */
const IDOR_VULNERABLE_PATTERNS: readonly RegExp[] = Object.freeze([
  /\b(params|query)\.\w*id\b/i,           // req.params.id / req.query.userId
  /\b\.find(One|Unique|ById)?\s*\(/i,      // .findById() / .findUnique()
  /\b\.findFirst\s*\(/i,
  /\bwhere\s*:\s*\{\s*\w+\s*:\s*(params|query)\./i, // Prisma-style where clause
  /\bget\s*\(\s*(params|query)\./i,
  /\:id\b/,                                 // Route param capture
  /\bobjectId\b|\bObjectId\b/i,             // MongoDB ObjectId
]);

/**
 * Regex patterns for access-control middleware detection.
 *
 * @internal
 */
const ACCESS_CONTROL_PATTERNS: readonly { readonly label: string; readonly regex: RegExp }[] =
  Object.freeze([
    { label: 'User / owner check', regex: /\b(owner|ownership|belongsTo|user\.id\s*(===|==|!==))\b/i },
    { label: 'Role guard', regex: /\b(role|roles|isAdmin|hasRole|requireRole|authorize)\b/i },
    { label: 'Policy engine', regex: /\b(policy|policies|casl|casbin|opa|permission)\b/i },
    { label: 'Middleware guard', regex: /\b(authMiddleware|authenticate|protect|requireAuth)\b/i },
    { label: 'Attribute check', regex: /\b(tenant|organization|org|account)\s*Id.*\b(user|session|req)\b/i },
  ]);

// ─── Public API ──────────────────────────────────────────────────

/**
 * Traces the path from user-input sources through transformations to
 * final sinks within a unified diff or set of source files.
 *
 * This function scans the provided diff content to identify:
 * 1. **Sources** — where external / user input enters the system
 * 2. **Transformations** — how data is modified between source and sink
 * 3. **Sinks** — where data finally lands (DB, logs, caches, APIs)
 *
 * Each trace includes an access-control assessment and a data
 * classification based on the content of the diff.
 *
 * @param diffContent - Unified diff string or concatenated source code.
 * @returns An ordered array of `SourceToSinkTrace` objects.
 *
 * @example
 * ```ts
 * const traces = traceSourceToSink(diff);
 * traces.filter(t => t.accessControl.idorVulnerable);
 * // → traces where the caller could modify object references client-side
 * ```
 */
export function traceSourceToSink(diffContent: string): SourceToSinkTrace[] {
  const traces: SourceToSinkTrace[] = [];
  const lines = diffContent.split('\n');

  let currentSource: string | null = null;
  let transformations: DataTransformation[] = [];
  let stepCounter = 0;
  let currentLineOffset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    // Check if this line introduces a new input source.
    const sourceMatch = matchFirst(line, INPUT_SOURCE_PATTERNS);
    if (sourceMatch !== null) {
      // Finalise any previous trace before starting a new one.
      if (currentSource !== null) {
        const sinks = findSinksInRange(lines, currentLineOffset, i);
        if (sinks.length > 0) {
          traces.push(buildTrace(
            currentSource,
            transformations,
            sinks,
            diffContent,
          ));
        }
      }

      currentSource = `Input source at line ${lineNumber}: "${sourceMatch}"`;
      transformations = [];
      stepCounter = 0;
      currentLineOffset = i;
      continue;
    }

    // Accumulate transformations.
    if (currentSource !== null) {
      for (const t of TRANSFORMATION_PATTERNS) {
        if (t.regex.test(line)) {
          const description = `${t.description} at line ${lineNumber}`;
          // Avoid duplicate consecutive transformations.
          if (
            transformations.length === 0
            || transformations[transformations.length - 1].description !== description
          ) {
            transformations.push({
              step: ++stepCounter,
              location: `line ${lineNumber}`,
              description,
              sanitization: classifySanitization(line),
            });
          }
        }
      }
    }
  }

  // Finalise the last trace.
  if (currentSource !== null) {
    const sinks = findSinksInRange(lines, currentLineOffset, lines.length);
    if (sinks.length > 0) {
      traces.push(buildTrace(currentSource, transformations, sinks, diffContent));
    }
  }

  // If no traces were found, create a single trace documenting the gap.
  if (traces.length === 0) {
    traces.push({
      id: 'S2S-0',
      source: 'No explicit user-input sources detected in diff content.',
      transformations: [],
      sinks: ['No explicit sinks detected.'],
      accessControl: {
        enforced: true,
        mechanism: 'No input paths found — no access control to enforce.',
        idorVulnerable: false,
        idorDetails: 'No detectable IDOR risk in the provided diff.',
      },
      dataClassification: 'public',
    });
  }

  return traces;
}

/**
 * Verifies IDOR (Insecure Direct Object Reference) vulnerabilities
 * across a set of changed files and their associated API routes.
 *
 * Scans each route definition for object-reference patterns and
 * checks whether corresponding server-side access control exists.
 *
 * @param changedFiles - List of file paths that were changed in the PR.
 * @param routes       - List of route strings (e.g. `/api/users/:id`).
 * @returns An array of `IDORVerification` results, one per route.
 *
 * @example
 * ```ts
 * const idorResults = verifyIDOR(
 *   ['src/routes/users.ts'],
 *   ['GET /api/users/:id', 'DELETE /api/users/:id'],
 * );
 * idorResults.filter(r => r.idorVulnerable);
 * // → routes where object references can be tampered with
 * ```
 */
export function verifyIDOR(
  changedFiles: readonly string[],
  routes: readonly string[],
): IDORVerification[] {
  const results: IDORVerification[] = [];

  for (const route of routes) {
    const hasObjectRef = IDOR_VULNERABLE_PATTERNS.some((re) => re.test(route));
    const hasAccessControl = ACCESS_CONTROL_PATTERNS.some(({ regex }) =>
      changedFiles.some((file) => regex.test(file)),
    );

    // Also check the route string itself for access-control keywords.
    const routeHasGuard = /\b(auth|protect|secure|authorize|check)\b/i.test(route);

    const enforced = hasAccessControl || routeHasGuard;
    const idorVulnerable = hasObjectRef && !enforced;

    const mechanism = idorVulnerable
      ? 'No server-side access control detected for this route.'
      : enforced
        ? 'Access control enforced via middleware or route guard.'
        : 'No object reference found — access control is N/A.';

    const severity = idorVulnerable
      ? AuditFindingSeverity.Critical
      : hasObjectRef && enforced
        ? AuditFindingSeverity.Info
        : AuditFindingSeverity.Low;

    results.push({
      route,
      enforced,
      mechanism,
      idorVulnerable,
      idorDetails: idorVulnerable
        ? `ROUTE ${route} accepts an object reference but no server-side `
          + 'validation or ownership check was detected. An attacker could '
          + 'modify the identifier to access unauthorised records.'
        : `Route ${route} is adequately protected.`,
      severity,
    });
  }

  return results;
}

/**
 * Analyzes source code for server-side access-control enforcement.
 *
 * Checks that user-supplied identifiers (IDs in URLs, request bodies,
 * parameters) cannot be modified to access unauthorised records.
 *
 * @param sourceCode - Full source code to analyse (concatenated or per-file).
 * @returns An `AccessControlAssessment` describing the overall posture.
 *
 * @example
 * ```ts
 * const assessment = analyzeAccessControl(code);
 * if (assessment.status === 'FAIL') {
 *   console.error(assessment.summary);
 * }
 * ```
 */
export function analyzeAccessControl(sourceCode: string): AccessControlAssessment {
  const routes = extractRoutes(sourceCode);
  const idorResults = verifyIDOR([sourceCode], routes);

  const vulnerableCount = idorResults.filter((r) => r.idorVulnerable).length;
  const totalRoutes = idorResults.length;

  let status: AccessControlAssessment['status'];
  if (vulnerableCount === 0 && totalRoutes > 0) {
    status = 'PASS';
  } else if (vulnerableCount > 0 && vulnerableCount <= totalRoutes / 2) {
    status = 'WARN';
  } else if (vulnerableCount > 0) {
    status = 'FAIL';
  } else {
    // No routes found at all.
    status = 'PASS';
  }

  const summary = buildAccessSummary(status, vulnerableCount, totalRoutes);

  return {
    idorFindings: Object.freeze(idorResults),
    status,
    summary,
  };
}

/**
 * Runs the full source-to-sink analysis pipeline:
 * trace → IDOR verify → access-control assessment.
 *
 * @param diffContent   - Unified diff string or source code for tracing.
 * @param changedFiles  - List of changed file paths for IDOR verification.
 * @param routes        - API routes to verify for IDOR.
 * @returns A `SourceToSinkAnalysis` containing all results.
 */
export function analyzeSourceToSink(
  diffContent: string,
  changedFiles: readonly string[],
  routes: readonly string[],
): SourceToSinkAnalysis {
  const traces = traceSourceToSink(diffContent);
  const idorVerifications = verifyIDOR(changedFiles, routes);
  const accessControl = analyzeAccessControl(diffContent);

  return {
    traces: Object.freeze(traces),
    idorVerifications: Object.freeze(idorVerifications),
    accessControl,
  };
}

// ─── Internal Helpers ────────────────────────────────────────────

/**
 * Finds all sink labels that appear within a range of lines.
 *
 * @internal
 */
function findSinksInRange(
  lines: readonly string[],
  start: number,
  end: number,
): string[] {
  const sinks: string[] = [];
  const seen = new Set<string>();

  for (let i = start; i < end && i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of SINK_PATTERNS) {
      if (pattern.regex.test(line) && !seen.has(pattern.label)) {
        seen.add(pattern.label);
        sinks.push(`${pattern.label} (line ${i + 1})`);
      }
    }
  }

  return sinks;
}

/**
 * Builds a single `SourceToSinkTrace` from the collected data.
 *
 * @internal
 */
function buildTrace(
  source: string,
  transformations: DataTransformation[],
  sinks: string[],
  diffContent: string,
): SourceToSinkTrace {
  const dataClassification = classifyData(diffContent);

  const accessControlAssessed = assessAccessControlForSource(
    source,
    transformations,
    diffContent,
  );

  const traceId = `S2S-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  return {
    id: traceId,
    source,
    transformations: Object.freeze([...transformations]),
    sinks: Object.freeze(sinks),
    accessControl: accessControlAssessed,
    dataClassification,
  };
}

/**
 * Determines the data classification of content.
 *
 * @internal
 */
function classifyData(content: string): SourceToSinkTrace['dataClassification'] {
  const secretPatterns = [
    /\b(password|secret|token|apikey|api_key|private_key)\b/i,
    /\bjwt\.(sign|verify)\b/i,
    /\b(encrypt|decrypt)\b.*\b(key|secret)\b/i,
  ];

  const piiPatterns = [
    /\b(email|ssn|phone|address|dob|birth_date|credit_card|passport)\b/i,
    /\b(gdpr|pii|personally_identifiable)\b/i,
  ];

  const internalPatterns = [
    /\binternal\b/i,
    /\bstaging|development|test\b/i,
    /\b(config|conf|settings)\b.*\b(internal|private)\b/i,
  ];

  if (secretPatterns.some((re) => re.test(content))) {
    return 'secret';
  }
  if (piiPatterns.some((re) => re.test(content))) {
    return 'pii';
  }
  if (internalPatterns.some((re) => re.test(content))) {
    return 'internal';
  }
  return 'public';
}

/**
 * Classifies the sanitization level of a transformation line.
 *
 * @internal
 */
function classifySanitization(line: string): DataTransformation['sanitization'] {
  if (/encrypt|hash|bcrypt|argon2|aes|sha/i.test(line)) {
    return 'encryption';
  }
  if (/escape|encode|sanitize|sanitise/i.test(line)) {
    return 'encoding';
  }
  if (/validate|isValid|schema|zod|yup|joi|assert/i.test(line)) {
    return 'input_validation';
  }
  return 'none';
}

/**
 * Assesses access-control enforcement for a given source trace.
 *
 * @internal
 */
function assessAccessControlForSource(
  source: string,
  _transformations: DataTransformation[],
  content: string,
): SourceToSinkTrace['accessControl'] {
  const enforced = ACCESS_CONTROL_PATTERNS.some(({ regex }) => regex.test(content));

  const matchingMechanisms = ACCESS_CONTROL_PATTERNS
    .filter(({ regex }) => regex.test(content))
    .map((m) => m.label);

  let mechanism: string;
  if (matchingMechanisms.length > 0) {
    mechanism = matchingMechanisms.join(', ');
  } else {
    mechanism = 'No explicit access-control mechanism detected.';
  }

  const idorVulnerable = IDOR_VULNERABLE_PATTERNS.some((re) => re.test(content))
    && !enforced;

  const idorDetails = idorVulnerable
    ? 'Object references found but no server-side access control was detected. '
      + 'An attacker could enumerate or modify identifiers to access unauthorised records.'
    : enforced
      ? 'Access control is enforced. Object references are protected server-side.'
      : 'No object references detected — IDOR risk is minimal.';

  return { enforced, mechanism, idorVulnerable, idorDetails };
}

/**
 * Extracts API route definitions from source code.
 *
 * @internal
 */
function extractRoutes(sourceCode: string): string[] {
  const routeRegexes = [
    /(?:router|route|app)\.(?:get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
    /@(?:Get|Post|Put|Delete|Patch)\(\s*['"`]([^'"`]+)['"`]\)/g,
    /(?:get|post|put|delete|patch)\s*:\s*['"`]([^'"`]+)['"`]/gi,
  ];

  const routes = new Set<string>();

  for (const regex of routeRegexes) {
    const matches = sourceCode.matchAll(regex);
    for (const match of matches) {
      const path = match[1];
      if (path && !path.startsWith('/:')) {
        routes.add(path);
      } else if (path) {
        routes.add(path);
      }
    }
  }

  return [...routes];
}

/**
 * Returns the first match of any pattern against the given line.
 *
 * @internal
 */
function matchFirst(line: string, patterns: readonly RegExp[]): string | null {
  for (const re of patterns) {
    const match = line.match(re);
    if (match) {
      return match[0];
    }
  }
  return null;
}

/**
 * Builds a human-readable access-control summary.
 *
 * @internal
 */
function buildAccessSummary(
  status: AccessControlAssessment['status'],
  vulnerableCount: number,
  totalRoutes: number,
): string {
  switch (status) {
    case 'PASS':
      return totalRoutes === 0
        ? 'No API routes detected. Access-control assessment is N/A.'
        : `All ${totalRoutes} route(s) have adequate access controls. No IDOR risks detected.`;
    case 'WARN':
      return `${vulnerableCount} of ${totalRoutes} route(s) may have IDOR vulnerabilities. `
        + 'Server-side ownership checks or middleware guards SHOULD be added.';
    case 'FAIL':
      return `FAIL: ${vulnerableCount} of ${totalRoutes} route(s) are vulnerable to IDOR. `
        + 'Server-side access control MUST be implemented before merge.';
    default:
      return 'Unknown access-control status.';
  }
}
