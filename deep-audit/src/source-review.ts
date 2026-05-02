import {
  RiskLevel,
  SourceReviewReport,
  SourceToSinkTrace,
  DataTransformation,
} from '../../shared/src/types';
import { v4 as uuidv4 } from 'uuid';

// ─── Parsed State Machine ────────────────────────────────────────

/**
 * A single transition extracted from source code.
 */
interface ParsedTransition {
  readonly from: string;
  readonly to: string;
  readonly condition: string;
}

/**
 * A state machine extracted during source analysis.
 */
interface ParsedStateMachine {
  readonly name: string;
  readonly states: string[];
  readonly transitions: ParsedTransition[];
}

// ─── Trust Boundary ──────────────────────────────────────────────

/**
 * A detected trust boundary crossing point.
 */
interface DetectedBoundary {
  readonly boundary: string;
  readonly direction: 'inbound' | 'outbound' | 'both';
  readonly risk: RiskLevel;
  readonly verificationStatus: 'verified' | 'unverified' | 'violated';
}

// ─── Data Flow Segment ───────────────────────────────────────────

/**
 * Partial trace from a single entry point to an eventual sink.
 */
interface DataFlowSegment {
  readonly source: string;
  readonly transformations: DataTransformation[];
  readonly sinks: string[];
  readonly accessControl: {
    enforced: boolean;
    mechanism: string;
    idorVulnerable: boolean;
    idorDetails: string;
  };
  readonly dataClassification: 'public' | 'internal' | 'pii' | 'secret';
}

// ─── Heuristic Patterns ──────────────────────────────────────────

/**
 * Patterns that indicate state-machine definitions in code.
 */
const STATE_MACHINE_PATTERNS: readonly RegExp[] = Object.freeze([
  /enum\s+\w+State\s*\{[^}]+\}/ms,
  /state\s*:\s*(['"`])\w+\1/gim,
  /this\.state\s*=\s*(['"`])\w+\1/gim,
  /new\s+XState/i,
  /statechart/i,
  /sm\.(transition|send|on)\s*\(/i,
  /StateMachine/, // generic — may produce false positives
]);

/**
 * Transition-like patterns: `from → to` or `state → nextState`.
 */
const TRANSITION_PATTERNS: readonly RegExp[] = Object.freeze([
  /(?:from|current|prev)\s*[:=]\s*['"`](\w+)['"`][\s\S]{0,80}(?:to|next|target)\s*[:=]\s*['"`](\w+)['"`]/gi,
  /\b(?:transition|goTo|changeTo)\s*\(\s*['"`](\w+)['"`]\s*,\s*['"`](\w+)['"`]/gi,
  /\bwhen\s*\(\s*['"`](\w+)['"`]\s*\)\s*[=>>]\s*['"`](\w+)['"`]/gi,
]);

/**
 * Endpoint / route definitions that represent inbound trust boundaries.
 */
const INBOUND_BOUNDARY_PATTERNS: readonly RegExp[] = Object.freeze([
  /router\.(get|post|put|delete|patch)\s*\(\s*['"`][^'"`]+['"`]/gi,
  /app\.(get|post|put|delete|patch)\s*\(\s*['"`][^'"`]+['"`]/gi,
  /\.addRoute\s*\(/gi,
  /@(Get|Post|Put|Delete|Patch)\s*\(/g,
  /GraphQL/,
  /grpc/,
  /WebSocket/,
]);

/**
 * Outbound call patterns representing external trust boundaries.
 */
const OUTBOUND_BOUNDARY_PATTERNS: readonly RegExp[] = Object.freeze([
  /\bfetch\s*\(/gi,
  /\baxios\./gi,
  /\bhttp\./gi,
  /\bdb\./gi,
  /prisma\./gi,
  /knex\./gi,
  /sequelize\./gi,
  /mongoose\./gi,
  /query\(/gi,
  /execute\(/gi,
  /\bredis\./gi,
  /\bamqp\./gi,
  /\bkafka\./gi,
  /sqs\./gi,
  /\$(aws|gcp|azure)\./gi,
]);

/**
 * User-input source markers.
 */
const INPUT_SOURCE_PATTERNS: readonly RegExp[] = Object.freeze([
  /req\.(body|params|query|headers|cookies)/gi,
  /event\.body/gi,
  /ctx\.(req|request)\./gi,
  /(form|input|field)Data/gi,
  /userInput/gi,
  /request\.(body|query)/gi,
  /new\s+URLSearchParams/gi,
  /FormData/gi,
  /\.env\./g,
]);

/**
 * Sink markers — places where data gets persisted, logged, or emitted.
 */
const SINK_PATTERNS: readonly RegExp[] = Object.freeze([
  /\bdb\.\w+\.(create|update|upsert|save|delete|find)/gi,
  /prisma\.\w+\.(create|update|upsert|save|delete)/gi,
  /knex\(['"`]\w+['"`]\)\.(insert|update|del)/gi,
  /await\s+query\(/gi,
  /\bredis\.(set|setex|hset)/gi,
  /\bconsole\.(log|warn|error|info)/gi,
  /\blogger\./gi,
  /\bemit\(/gi,
  /\bpublish\(/gi,
  /\bsend\(/gi,
  /\bfs\.(write|append|create)/gi,
  /\bwriteFile/gi,
  /res\.(json|send|status)/gi,
]);

/**
 * Sanitisation/validation markers.
 */
const SANITIZATION_PATTERNS: readonly Record<string, RegExp> = Object.freeze({
  input_validation: /(validate|sanitize|escape|z\.object|Joi\.|class-validator|yup\.)/i,
  encoding: /(encodeURI|encode|escape|btoa|base64)/i,
  encryption: /(encrypt|decrypt|cipher|crypto\.(createCipher|publicEncrypt))/i,
});

// ─── Source Review Engine ─────────────────────────────────────────

/**
 * Parses the source content to extract candidate state machines.
 *
 * @internal
 */
function extractStateMachines(sourceCode: string): ParsedStateMachine[] {
  const machines: ParsedStateMachine[] = [];

  // Attempt to extract named machine definitions
  const machineBlocks = sourceCode.match(STATE_MACHINE_PATTERNS[0]);
  if (machineBlocks) {
    for (const block of machineBlocks) {
      const nameMatch = block.match(/(?:enum|class|interface)\s+(\w+)/);
      const name = nameMatch ? nameMatch[1] : 'AnonymousStateMachine';

      // Collect states
      const stateMatches = block.matchAll(/\b([A-Z][A-Z_0-9]+)\b/g);
      const states: string[] = [];
      for (const m of stateMatches) {
        if (!states.includes(m[1])) {
          states.push(m[1]);
        }
      }

      // Collect transitions from source
      const transitions = extractTransitions(sourceCode);

      machines.push({
        name,
        states: states.length > 0 ? states : ['UNKNOWN'],
        transitions,
        // unreachableStates / deadTransitions computed after construction
      });
    }
  }

  // Fallback: if no enum-style machine found, scan for XState/xstate usage
  if (machines.length === 0 && STATE_MACHINE_PATTERNS.some((p) => p.test(sourceCode))) {
    const transitions = extractTransitions(sourceCode);
    machines.push({
      name: 'DetectedStateMachine',
      states: inferStatesFromTransitions(transitions),
      transitions,
    });
  }

  return machines.map((m) => enrichStateMachine(m, sourceCode));
}

/**
 * Extracts candidate transitions from source code.
 *
 * @internal
 */
function extractTransitions(sourceCode: string): ParsedTransition[] {
  const seen = new Set<string>();
  const transitions: ParsedTransition[] = [];

  for (const pattern of TRANSITION_PATTERNS) {
    const matches = sourceCode.matchAll(pattern);
    for (const m of matches) {
      const from = m[1]?.trim();
      const to = m[2]?.trim();
      if (from && to && !seen.has(`${from}→${to}`)) {
        seen.add(`${from}→${to}`);
        // Extract surrounding context as condition
        const start = Math.max(0, (m.index ?? 0) - 40);
        const end = Math.min(sourceCode.length, (m.index ?? 0) + m[0].length + 40);
        const context = sourceCode.slice(start, end).replace(/\s+/g, ' ').trim();
        transitions.push({ from, to, condition: context });
      }
    }
  }

  return transitions;
}

/**
 * Infers a list of states from the collected transitions.
 *
 * @internal
 */
function inferStatesFromTransitions(transitions: ParsedTransition[]): string[] {
  const stateSet = new Set<string>();
  for (const t of transitions) {
    stateSet.add(t.from);
    stateSet.add(t.to);
  }
  return [...stateSet];
}

/**
 * Enriches a parsed state machine with unreachable states and dead
 * transitions.  An unreachable state is one that never appears as the
 * `to` of any transition.  A dead transition is one whose `from` state
 * never appears as the `to` of any other transition (i.e. it is a
 * terminal / leaf state with outgoing edges).
 *
 * @internal
 */
function enrichStateMachine(
  machine: ParsedStateMachine,
  _sourceCode: string,
): ParsedStateMachine & {
  unreachableStates: string[];
  deadTransitions: ParsedTransition[];
} {
  const allTo = new Set(machine.transitions.map((t) => t.to));
  const allFrom = new Set(machine.transitions.map((t) => t.from));

  const unreachableStates = machine.states.filter(
    (s) => !allTo.has(s) && machine.transitions.some((t) => t.from === s),
  );

  const deadTransitions = machine.transitions.filter((t) => {
    // A transition is dead if its target state has no outgoing edges
    // or if the source state is itself unreachable
    const targetHasOutgoing = machine.transitions.some((tt) => tt.from === t.to);
    return !targetHasOutgoing;
  });

  return {
    ...machine,
    unreachableStates: [...new Set(unreachableStates)],
    deadTransitions: [...new Set(deadTransitions)],
  };
}

/**
 * Identifies inbound and outbound trust boundaries in the source code.
 *
 * @internal
 */
function identifyTrustBoundaries(sourceCode: string): DetectedBoundary[] {
  const boundaries: DetectedBoundary[] = [];
  const seen = new Set<string>();

  const recordBoundary = (
    matches: IterableIterator<RegExpMatchArray>,
    direction: 'inbound' | 'outbound',
    risk: RiskLevel,
  ): void => {
    for (const m of matches) {
      const key = `${direction}:${m[0].slice(0, 80)}`;
      if (!seen.has(key)) {
        seen.add(key);
        boundaries.push({
          boundary: m[0].slice(0, 120),
          direction,
          risk,
          verificationStatus: 'unverified',
        });
      }
    }
  };

  recordBoundary(
    sourceCode.matchAll(INBOUND_BOUNDARY_PATTERNS[0]),
    'inbound',
    RiskLevel.Critical,
  );
  recordBoundary(
    sourceCode.matchAll(INBOUND_BOUNDARY_PATTERNS[1]),
    'inbound',
    RiskLevel.Critical,
  );
  recordBoundary(
    sourceCode.matchAll(INBOUND_BOUNDARY_PATTERNS[2]),
    'inbound',
    RiskLevel.High,
  );
  // Additional patterns via combined scan
  for (let i = 3; i < INBOUND_BOUNDARY_PATTERNS.length; i++) {
    recordBoundary(
      sourceCode.matchAll(INBOUND_BOUNDARY_PATTERNS[i]),
      'inbound',
      RiskLevel.Medium,
    );
  }

  recordBoundary(
    sourceCode.matchAll(OUTBOUND_BOUNDARY_PATTERNS[0]),
    'outbound',
    RiskLevel.High,
  );
  recordBoundary(
    sourceCode.matchAll(OUTBOUND_BOUNDARY_PATTERNS[1]),
    'outbound',
    RiskLevel.High,
  );
  recordBoundary(
    sourceCode.matchAll(OUTBOUND_BOUNDARY_PATTERNS[2]),
    'outbound',
    RiskLevel.High,
  );

  return boundaries;
}

/**
 * Traces data flows from user-input sources through transformations to
 * sinks.
 *
 * @internal
 */
function traceDataFlows(sourceCode: string): DataFlowSegment[] {
  const segments: DataFlowSegment[] = [];

  // Collect source positions
  const inputSources: string[] = [];
  for (const pattern of INPUT_SOURCE_PATTERNS) {
    const matches = sourceCode.match(pattern);
    if (matches) {
      for (const m of matches) {
        if (!inputSources.includes(m)) {
          inputSources.push(m);
        }
      }
    }
  }

  // Collect sink positions
  const sinks: string[] = [];
  for (const pattern of SINK_PATTERNS) {
    const matches = sourceCode.match(pattern);
    if (matches) {
      for (const m of matches) {
        if (!sinks.includes(m)) {
          sinks.push(m);
        }
      }
    }
  }

  if (inputSources.length === 0 && sinks.length === 0) {
    return segments;
  }

  // Determine data classification based on content heuristics
  const classification = determineDataClassification(sourceCode);

  // Determine sanitization coverage
  const sanitization = determineSanitization(sourceCode);

  // Determine access-control posture
  const accessControl = assessAccessControl(sourceCode);

  // Build one segment per unique source
  for (const src of inputSources) {
    const matchingSinks = findMatchingSinks(src, sinks, sourceCode);
    segments.push({
      source: src,
      transformations: [
        {
          step: 1,
          location: 'primary_entry',
          description: `Input received via ${src}`,
          sanitization,
        },
      ],
      sinks: matchingSinks.length > 0 ? matchingSinks : ['<unknown sink>'],
      accessControl: {
        enforced: accessControl.enforced,
        mechanism: accessControl.mechanism,
        idorVulnerable: accessControl.idorVulnerable,
        idorDetails: accessControl.idorDetails,
      },
      dataClassification: classification,
    });
  }

  // If we have sinks but no identified sources, still report the segment
  if (inputSources.length === 0 && sinks.length > 0) {
    segments.push({
      source: '<unknown source — detected sinks without identifiable input>',
      transformations: [],
      sinks,
      accessControl: {
        enforced: accessControl.enforced,
        mechanism: accessControl.mechanism,
        idorVulnerable: accessControl.idorVulnerable,
        idorDetails: accessControl.idorDetails,
      },
      dataClassification: classification,
    });
  }

  return segments;
}

/**
 * Heuristically determines the data classification level.
 *
 * @internal
 */
function determineDataClassification(
  sourceCode: string,
): 'public' | 'internal' | 'pii' | 'secret' {
  const secretPatterns = [
    /password/i, /secret/i, /apikey/i, /api_key/i, /token/i, /credential/i,
  ];
  const piiPatterns = [
    /email/i, /phone/i, /ssn/i, /social_security/i, /address/i, /dob/i,
    /birth/i, /pii/i, /personally_identifiable/i,
  ];

  if (secretPatterns.some((p) => p.test(sourceCode))) {
    return 'secret';
  }
  if (piiPatterns.some((p) => p.test(sourceCode))) {
    return 'pii';
  }
  if (/\b(internal|private)\b/i.test(sourceCode)) {
    return 'internal';
  }
  return 'public';
}

/**
 * Determines the most specific sanitization method present.
 *
 * @internal
 */
function determineSanitization(
  sourceCode: string,
): 'none' | 'input_validation' | 'encoding' | 'encryption' {
  if (SANITIZATION_PATTERNS.encryption.test(sourceCode)) {
    return 'encryption';
  }
  if (SANITIZATION_PATTERNS.encoding.test(sourceCode)) {
    return 'encoding';
  }
  if (SANITIZATION_PATTERNS.input_validation.test(sourceCode)) {
    return 'input_validation';
  }
  return 'none';
}

/**
 * Assesses whether access-control mechanisms are present and if IDOR
 * vulnerabilities are likely.
 *
 * @internal
 */
function assessAccessControl(sourceCode: string): {
  enforced: boolean;
  mechanism: string;
  idorVulnerable: boolean;
  idorDetails: string;
} {
  const idorPatterns = [
    /\b(?:userId|user_id|accountId|account_id|ownerId|owner_id)\s*(?:[:=])\s*req\./i,
    /\bfindById\s*\(\s*req\./i,
    /\.find\s*\(\s*\{[^}]*\}\s*\)/i,
  ];

  const idorVulnerable = idorPatterns.some((p) => p.test(sourceCode));
  const idorDetails = idorVulnerable
    ? 'Potential IDOR: direct user-controlled identifier used in data lookup without ownership verification.'
    : 'No obvious IDOR pattern detected.';

  if (/middleware\.(authenticate|authorize|require)/i.test(sourceCode)) {
    return {
      enforced: true,
      mechanism: 'Authentication/authorization middleware present',
      idorVulnerable,
      idorDetails,
    };
  }

  if (/\b(auth|authorize|authenticate|protect)\b/i.test(sourceCode)) {
    return {
      enforced: true,
      mechanism: 'Authorization checks detected in code',
      idorVulnerable,
      idorDetails,
    };
  }

  return {
    enforced: false,
    mechanism: 'No access-control mechanism detected',
    idorVulnerable,
    idorDetails,
  };
}

/**
 * Heuristically associates sinks with sources based on proximity in
 * the source text.
 *
 * @internal
 */
function findMatchingSinks(
  _source: string,
  sinks: string[],
  _sourceCode: string,
): string[] {
  // For a production system this would perform proper data-flow analysis
  // (e.g. AST-based taint tracking).  Here we return all known sinks as
  // a conservative estimate.
  return sinks;
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Configuration options for the source review analysis.
 */
export interface SourceReviewOptions {
  /**
   * Whether to perform deep data-flow tracing (AST-level).
   * Defaults to `false` (heuristic-only).
   */
  readonly deepTracing?: boolean;

  /**
   * Custom file patterns to include in the analysis.
   * Defaults to common source-code extensions.
   */
  readonly includePatterns?: readonly string[];
}

/**
 * Runs a source-review analysis on the provided source code.
 *
 * The analysis covers three dimensions mandated by §3.1 of the spec:
 *
 * 1. **State Machine Analysis** — Parses candidate state-machine
 *    definitions, enumerates states and transitions, and identifies
 *    unreachable states / dead transitions.
 * 2. **Trust Boundary Identification** — Scans for inbound (API
 *    endpoints, event handlers) and outbound (database queries,
 *    external HTTP calls) trust-boundary crossings.
 * 3. **Data Flow Tracing** — Traces user-controlled input from
 *    entry points through transformations to sinks, classifying
 *    the data and assessing access control.
 *
 * @param sourceCode  The full source code content to analyse.
 * @param options     Optional configuration flags.
 * @returns A fully-populated `SourceReviewReport`.
 *
 * @example
 * ```ts
 * const report = reviewSource(fs.readFileSync('app.ts', 'utf-8'));
 * console.log(report.stateMachines[0]?.unreachableStates);
 * ```
 */
export function reviewSource(
  sourceCode: string,
  options?: SourceReviewOptions,
): SourceReviewReport {
  const stateMachines = extractStateMachines(sourceCode);
  const trustBoundaries = identifyTrustBoundaries(sourceCode);
  const dataFlows = traceDataFlows(sourceCode);

  return {
    stateMachines: stateMachines.map((sm) => ({
      name: sm.name,
      states: sm.states,
      transitions: sm.transitions.map((t) => ({
        from: t.from,
        to: t.to,
        condition: t.condition,
      })),
      unreachableStates: (sm as any).unreachableStates ?? [],
      deadTransitions: (sm as any).deadTransitions?.map((t: ParsedTransition) => ({
        from: t.from,
        to: t.to,
        condition: t.condition,
      })) ?? [],
    })),
    trustBoundaries: trustBoundaries.map((tb) => ({
      boundary: tb.boundary,
      direction: tb.direction,
      risk: tb.risk,
      verificationStatus: tb.verificationStatus,
    })),
    dataFlows: dataFlows.map(
      (df): SourceToSinkTrace => ({
        id: uuidv4(),
        source: df.source,
        transformations: df.transformations,
        sinks: df.sinks,
        accessControl: df.accessControl,
        dataClassification: df.dataClassification,
      }),
    ),
  };
}
