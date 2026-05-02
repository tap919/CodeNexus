import {
  RiskLevel,
} from '../../shared/src/types';

// ─── Pattern Definitions ─────────────────────────────────────────

/**
 * Defines a risk-detection pattern with its associated file path matchers
 * and diff-content heuristics.
 */
interface RiskPattern {
  readonly level: RiskLevel;
  readonly filePatterns: readonly string[];
  readonly contentSignals: readonly RegExp[];
  readonly label: string;
}

/**
 * Registry of all risk patterns ordered by precedence.
 * The first matching pattern determines the overall risk level.
 */
const RISK_PATTERNS: readonly RiskPattern[] = Object.freeze([
  // ── CRITICAL patterns ──────────────────────────────────────────
  {
    level: RiskLevel.Critical,
    filePatterns: [
      '**/auth/**', '**/authentication/**', '**/login/**', '**/oauth/**',
      '**/billing/**', '**/payment/**', '**/subscription/**',
      '**/permissions/**', '**/rbac/**', '**/authorization/**',
      '**/.github/workflows/**', '**/ci/**', '**/cd/**',
    ],
    contentSignals: [
      /password\s*=/im,
      /token\s*=/im,
      /api[_-]?key/im,
      /secret\s*=/im,
      /credential/i,
      /jwt\.(sign|verify|decode)/i,
      /stripe\./i,
      /charge|capture|refund/i,
      /price|pricing|plan/i,
      /role\s*[:=]/i,
      /can(_|\s)access/i,
      /permission_check/i,
      /github\.protect/i,
      /needs:\s*\[/m,
      /secrets:\s*\{/m,
    ],
    label: 'Authentication, Billing, Permissions, or CI/CD Workflows',
  },

  // ── HIGH patterns ──────────────────────────────────────────────
  {
    level: RiskLevel.High,
    filePatterns: [
      '**/migrations/**', '**/migrate/**', '**/schema/**',
      '**/middleware/**', '**/middlewares/**',
      '**/pii/**', '**/gdpr/**', '**/ccpa/**', '**/privacy/**',
      '**/dto/**', '**/validator/**',
    ],
    contentSignals: [
      /alter\s+table/i,
      /create\s+(table|index|unique)/i,
      /drop\s+(table|column)/i,
      /addColumn|removeColumn/i,
      /app\.(use|get|post|put|delete|patch)\s*\([^)]*middleware/i,
      /pii|personally_identifiable/i,
      /email|phone|ssn|social_security/i,
      /encrypt|decrypt|hash/i,
    ],
    label: 'Database Migrations, Middleware, or PII Handling',
  },

  // ── MEDIUM patterns ────────────────────────────────────────────
  {
    level: RiskLevel.Medium,
    filePatterns: [
      '**/api/**', '**/routes/**', '**/controllers/**',
      '**/services/**', '**/usecases/**', '**/use-cases/**',
      '**/handlers/**', '**/resolvers/**',
      '**/server/**', '**/endpoints/**',
    ],
    contentSignals: [
      /router\.(get|post|put|delete|patch)/i,
      /req\.(body|params|query)/i,
      /res\.(json|send|status)/i,
      /async\s+\w+Handler/i,
      /throw\s+new\s+(Error|HttpException)/i,
      /try\s*\{[\s\S]*?catch/i,
    ],
    label: 'Standard Business Logic or API Updates',
  },
]);

/**
 * Glob patterns whose sole presence guarantees a LOW classification
 * regardless of other matches (unless a more specific CRITICAL/HIGH
 * file-path match also exists — in which case the higher severity wins).
 */
const LOW_FILE_PATTERNS: readonly string[] = Object.freeze([
  '**/*.css', '**/*.scss', '**/*.less', '**/*.styl',
  '**/*.html', '**/*.hbs', '**/*.ejs', '**/*.pug',
  '**/*.md', '**/*.mdx', '**/*.txt', '**/*.adoc',
  '**/*.svg', '**/*.png', '**/*.jpg', '**/*.jpeg', '**/*.gif', '**/*.ico',
  '**/*.woff', '**/*.woff2', '**/*.ttf', '**/*.eot',
  '**/docs/**', '**/documentation/**',
  '**/scripts/**', '**/tooling/**', '**/dev-tools/**',
  '**/*.config.*',
]);

// ─── Minimatcher helpers ─────────────────────────────────────────

/**
 * Very simple glob-match against a single pattern.
 * Supports `**` (any number of directory levels), `*` (single segment),
 * and literal characters.  Not a full minimatch — sufficient for the
 * known pattern set.
 *
 * @internal
 */
function globMatch(filePath: string, pattern: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '___DOUBLESTAR___')
    .replace(/\*/g, '[^/]*')
    .replace(/___DOUBLESTAR___/g, '.*');
  return new RegExp(`^${regexStr}$`, 'i').test(normalizedPath);
}

/**
 * Returns `true` when at least one pattern from `patterns` matches the
 * given `filePath`.
 *
 * @internal
 */
function matchesAnyPattern(filePath: string, patterns: readonly string[]): boolean {
  return patterns.some((pat) => globMatch(filePath, pat));
}

/**
 * Returns `true` when the diff content contains at least one signal
 * regex match.
 *
 * @internal
 */
function hasAnySignal(content: string, signals: readonly RegExp[]): boolean {
  return signals.some((re) => re.test(content));
}

// ─── Risk Classification Result ──────────────────────────────────

/**
 * Outcome of a single risk-classification run.
 */
export interface RiskClassification {
  /** The computed risk level. */
  readonly level: RiskLevel;

  /** Human-readable justification explaining *why* this level was chosen. */
  readonly justification: string;

  /**
   * The specific patterns (file or content) that triggered this
   * classification.  Empty for fully-automatic LOW classifications.
   */
  readonly triggers: readonly string[];
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Classifies the risk level of a pull request based on the set of
 * changed file paths and the unified diff content.
 *
 * **Algorithm:**
 *
 * 1. Scan `changedFiles` against the CRITICAL and HIGH file-pattern
 *    lists.  A match immediately assigns that risk level.
 * 2. If no high-severity file-path match exists, scan the diff content
 *    for CRITICAL and HIGH content signals.  A hit promotes the
 *    classification to that level.
 * 3. If only MEDIUM or LOW file-path matches remain:
 *    - MEDIUM file hits → MEDIUM.
 *    - LOW-only file hits → LOW.
 * 4. If the changed-files list is empty or only unrecognised paths
 *    exist, fall back to LOW with an appropriate justification.
 *
 * @param changedFiles  Absolute or relative file paths touched by the PR.
 * @param diffContent   Unified diff string (can include header lines).
 * @returns A `RiskClassification` with the final level, justification,
 *          and trigger list.
 *
 * @example
 * ```ts
 * const result = classifyRisk(
 *   ['src/auth/login.ts', 'src/styles/button.css'],
 *   'diff --git a/src/auth/login.ts b/…'
 * );
 * // → { level: RiskLevel.Critical, justification: '…', triggers: […] }
 * ```
 */
export function classifyRisk(
  changedFiles: readonly string[],
  diffContent: string,
): RiskClassification {
  const triggers: string[] = [];

  // ── Step 1: CRITICAL / HIGH file-path matches ─────────────────
  for (const pattern of RISK_PATTERNS) {
    const matchingFiles = changedFiles.filter((f) =>
      matchesAnyPattern(f, pattern.filePatterns),
    );
    if (matchingFiles.length > 0) {
      triggers.push(
        `File patterns [${pattern.label}]: ${matchingFiles.join(', ')}`,
      );
      return {
        level: pattern.level,
        justification: buildJustification(pattern.level, triggers, diffContent),
        triggers: [...triggers],
      };
    }
  }

  // ── Step 2: Content-signal matches for CRITICAL / HIGH ────────
  for (const pattern of RISK_PATTERNS.slice(0, 2)) {
    // Only CRITICAL and HIGH (indices 0, 1)
    if (hasAnySignal(diffContent, pattern.contentSignals)) {
      triggers.push(`Content signals matched [${pattern.label}]`);
      return {
        level: pattern.level,
        justification: buildJustification(pattern.level, triggers, diffContent),
        triggers: [...triggers],
      };
    }
  }

  // ── Step 3: MEDIUM / LOW file-path matches ────────────────────
  const mediumPattern = RISK_PATTERNS[2]; // MEDIUM
  const mediumFiles = changedFiles.filter((f) =>
    matchesAnyPattern(f, mediumPattern.filePatterns),
  );

  const allLow = changedFiles.length > 0
    && changedFiles.every((f) => matchesAnyPattern(f, LOW_FILE_PATTERNS));

  if (mediumFiles.length > 0) {
    triggers.push(
      `Business logic / API file patterns: ${mediumFiles.join(', ')}`,
    );
    return {
      level: RiskLevel.Medium,
      justification: buildJustification(RiskLevel.Medium, triggers, diffContent),
      triggers: [...triggers],
    };
  }

  if (allLow) {
    triggers.push('Changes limited to UI/styles/documentation/configuration');
    return {
      level: RiskLevel.Low,
      justification: buildJustification(RiskLevel.Low, triggers, diffContent),
      triggers: [...triggers],
    };
  }

  // ── Fallback ───────────────────────────────────────────────────
  if (changedFiles.length === 0) {
    return {
      level: RiskLevel.Low,
      justification: 'No files changed — no risk to assess.',
      triggers: [],
    };
  }

  triggers.push(
    `Unrecognised file paths — defaulting to LOW: ${changedFiles.join(', ')}`,
  );
  return {
    level: RiskLevel.Low,
    justification: buildJustification(RiskLevel.Low, triggers, diffContent),
    triggers: [...triggers],
  };
}

// ─── Internal Helpers ────────────────────────────────────────────

/**
 * Builds a human-readable justification string.
 *
 * @internal
 */
function buildJustification(
  level: RiskLevel,
  triggers: readonly string[],
  _diffContent: string,
): string {
  const parts: string[] = [
    `Risk level determined as **${level}**.`,
  ];

  if (triggers.length > 0) {
    parts.push('Trigger(s):');
    for (const t of triggers) {
      parts.push(`  - ${t}`);
    }
  }

  switch (level) {
    case RiskLevel.Critical:
      parts.push(
        'REQUIRED ACTIONS: Layer 3 knowledge retrieval MUST be performed. '
        + 'Dual-human sign-off MANDATORY before merge.',
      );
      break;
    case RiskLevel.High:
      parts.push(
        'REQUIRED ACTIONS: Deep E2E race-condition testing MUST be executed. '
        + 'Source review and runtime behavior lenses are mandatory.',
      );
      break;
    case RiskLevel.Medium:
      parts.push(
        'REQUIRED ACTIONS: Invariant documentation SHOULD be updated. '
        + 'Negative-path testing is recommended.',
      );
      break;
    case RiskLevel.Low:
      parts.push(
        'REQUIRED ACTIONS: Standard source review only. '
        + 'No mandatory additional gates.',
      );
      break;
  }

  return parts.join('\n');
}
