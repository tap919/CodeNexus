/**
 * Prompt Injection Detector
 *
 * Detects 20+ classes of prompt injection attacks targeting LLM-based
 * agents. Uses pattern matching with signature-based detection and
 * severity classification.
 *
 * Fused from Claw-Protect's injection analysis engine.
 */

import { Severity } from '../../../shared/src/types';

// ─── Pattern Categories ───────────────────────────────────────

export interface InjectionPattern {
  /** Unique pattern identifier */
  id: string;
  /** Human-readable description */
  description: string;
  /** Regex patterns to match against */
  patterns: RegExp[];
  /** Base severity if pattern triggers */
  severity: Severity;
  /** Category grouping */
  category: InjectionCategory;
  /** Weight used for aggregate scoring (0.0 – 1.0) */
  weight: number;
}

export type InjectionCategory =
  | 'sql_injection'
  | 'command_injection'
  | 'jailbreak'
  | 'role_playing'
  | 'system_prompt_override'
  | 'information_disclosure'
  | 'prompt_leak'
  | 'logic_manipulation';

// ─── Detection Result ─────────────────────────────────────────

export interface InjectionDetectionResult {
  detected: boolean;
  matchedPatterns: MatchedPattern[];
  riskScore: number; // 0.0 – 1.0 normalized
  maxSeverity: Severity;
}

export interface MatchedPattern {
  patternId: string;
  description: string;
  category: InjectionCategory;
  severity: Severity;
  match: string;
}

// ─── 20+ Injection Signatures ─────────────────────────────────

/**
 * The authoritative pattern catalogue. Every signature is designed
 * to catch a specific variant of injection without drowning in
 * false positives.
 */
export const INJECTION_PATTERNS: InjectionPattern[] = [
  // ── SQL Injection ───────────────────────────────────────────
  {
    id: 'SQLI_001',
    description: 'Classic SQL injection via UNION or stacked queries',
    category: 'sql_injection',
    severity: Severity.Critical,
    weight: 1.0,
    patterns: [
      /(\bUNION\b\s+\bSELECT\b)/i,
      /(\bDROP\b\s+\bTABLE\b)/i,
      /(\bDELETE\b\s+\bFROM\b)/i,
      /(\bINSERT\b\s+\bINTO\b)/i,
      /(\bALTER\b\s+\bTABLE\b)/i,
      /('?\s*OR\s+['"]?\d+['"]?\s*=\s*['"]?\d+['"]?)/i,
      /(\bEXEC\b\s*\(?\s*['"])/i,
      /(\bxp_cmdshell\b)/i,
    ],
  },
  {
    id: 'SQLI_002',
    description: 'SQL tautology / always-true condition injection',
    category: 'sql_injection',
    severity: Severity.High,
    weight: 0.9,
    patterns: [
      /(['"])\s*OR\s+1\s*=\s*1\s*--/i,
      /(['"])\s*OR\s+'1'\s*=\s*'1'/i,
      /(['"])\s*OR\s*"1"\s*=\s*"1"/i,
      /;\s*DROP\s+TABLE/i,
    ],
  },

  // ── Command Injection ───────────────────────────────────────
  {
    id: 'CMD_001',
    description: 'Shell command injection via backticks or $()',
    category: 'command_injection',
    severity: Severity.Critical,
    weight: 1.0,
    patterns: [
      /`.*\b(rm|curl|wget|bash|sh|exec|eval|sudo|chmod|chown)\b.*`/i,
      /\$\(.*\b(rm|curl|wget|bash|sh|exec|eval|sudo)\b.*\)/i,
    ],
  },
  {
    id: 'CMD_002',
    description: 'Shell command injection via piped or chained commands',
    category: 'command_injection',
    severity: Severity.Critical,
    weight: 1.0,
    patterns: [
      /;\s*(rm|curl|wget|bash|sh|exec|eval|sudo|chmod|chown|cat|nc|ncat)\s/i,
      /\|\s*(bash|sh|exec|eval|curl|wget)\s/i,
      /&&\s*(rm|curl|wget|bash|sh|exec|eval|sudo)\s/i,
      /\|\|\s*(rm|curl|wget|bash|sh|exec|eval|sudo)\s/i,
    ],
  },
  {
    id: 'CMD_003',
    description: 'Base64-encoded command execution attempts',
    category: 'command_injection',
    severity: Severity.High,
    weight: 0.9,
    patterns: [
      /(echo|printf)\s+['"]?[A-Za-z0-9+/=]{20,}['"]?\s*\|\s*(base64|base64\s*-d|decode)/i,
      /['"][A-Za-z0-9+/=]{40,}['"]\s*\|\s*(base64|decode)/i,
    ],
  },

  // ── Jailbreak Attacks ───────────────────────────────────────
  {
    id: 'JAIL_001',
    description: 'DAN (Do Anything Now) jailbreak variant',
    category: 'jailbreak',
    severity: Severity.Critical,
    weight: 1.0,
    patterns: [
      /(DAN|do\s+anything\s+now|jailbreak|jail\s*break)/i,
      /(ignore\s+(all\s+)?(prior|previous|above|the\s+above)\s+(instructions|directives|rules|constraints))/i,
    ],
  },
  {
    id: 'JAIL_002',
    description: '"Ignore previous instructions" override attempts',
    category: 'jailbreak',
    severity: Severity.Critical,
    weight: 1.0,
    patterns: [
      /(ignore|disregard|override|bypass)\s+(all\s+)?(previous|prior|above|the\s+above)\s+(instructions|directives|rules|prompts?|commands)/i,
      /(forget|discard|undo|clear)\s+(all\s+)?(previous|prior|above|the\s+above)\s+(context|instructions|prompts?)/i,
    ],
  },
  {
    id: 'JAIL_003',
    description: 'Persona override / hypothetical role-play escape',
    category: 'jailbreak',
    severity: Severity.High,
    weight: 0.9,
    patterns: [
      /(act\s+as\s+|pretend\s+(to\s+be|you\s+are)|from\s+now\s+on\s+you\s+are|you\s+are\s+now\s+)\s*(an?\s+)?(unfiltered|uncensored|unrestricted|unconstrained|limitless|unbounded|free|evil|malicious|hacker)/i,
    ],
  },
  {
    id: 'JAIL_004',
    description: 'GPT / model role boundary escape',
    category: 'jailbreak',
    severity: Severity.High,
    weight: 0.85,
    patterns: [
      /(your\s+(rules|guidelines|restrictions|limitations|safeguards|protocols?|ethics|boundaries))\s+(are|no\s+longer|don't|do\s+not)\s+(apply|matter|exist|bind|constrain|limit)/i,
      /(you\s+are\s+(no\s+longer|not\s+bound\s+by|free\s+from|released\s+from|exempt\s+from))\s+(your\s+)?(rules|restrictions|guidelines|constraints|limitations)/i,
    ],
  },
  {
    id: 'JAIL_005',
    description: 'Output formatting bypass / token manipulation attacks',
    category: 'jailbreak',
    severity: Severity.Medium,
    weight: 0.7,
    patterns: [
      /(output\s+(without|with\s+no)\s+(filter|restriction|filters|censorship|moderation))/i,
      /(don't\s+(filter|censor|moderate|restrict|limit)\s+(the\s+)?(output|response|answer))/i,
      /(repeat\s+(the\s+)?(entire|full|complete)\s+(prompt|system\s+prompt|instructions|initial\s+instructions))/i,
    ],
  },

  // ── Role-Playing Attacks ────────────────────────────────────
  {
    id: 'RP_001',
    description: 'Hypothetical security scenario used to extract dangerous content',
    category: 'role_playing',
    severity: Severity.Medium,
    weight: 0.6,
    patterns: [
      /(this\s+is\s+(a\s+)?(hypothetical|fictional|academic|educational|theoretical)\s+(scenario|situation|question|exercise))/i,
      /(for\s+(educational|research|academic|scientific)\s+purposes?\s+(only|solely))/i,
    ],
  },
  {
    id: 'RP_002',
    description: 'Character impersonation / "you are now" redirection',
    category: 'role_playing',
    severity: Severity.Medium,
    weight: 0.6,
    patterns: [
      /(you\s+are\s+now|now\s+you\s+are|pretend\s+you\s+are|imagine\s+you\s+are|act\s+as\s+if\s+you\s+are)\s+(an?\s+)?(AI|assistant|chatbot|model|agent)\s+(with(out|out\s+of)\s+)?(no\s+)?(limits|restrictions|boundaries|rules|filters|safeguards)/i,
      /(you\s+are\s+now)\s+(an?\s+)?(unfiltered|uncensored|unrestricted|evil|malicious|dangerous|harmful)\s+(version|instance|mode|AI|assistant|entity)/i,
    ],
  },
  {
    id: 'RP_003',
    description: 'Simulated API / terminal role-play to leak system prompt',
    category: 'role_playing',
    severity: Severity.Medium,
    weight: 0.55,
    patterns: [
      /(simulate|emulate|mimic|act\s+as)\s+(an?\s+)?(API|terminal|shell|console|command\s+line)\s+(response|output|endpoint|session)/i,
    ],
  },

  // ── System Prompt Override ──────────────────────────────────
  {
    id: 'SPO_001',
    description: 'Direct system prompt modification request',
    category: 'system_prompt_override',
    severity: Severity.Critical,
    weight: 1.0,
    patterns: [
      /(update|change|modify|replace|override|set|define|new)\s+(your\s+)?(system\s+)?(prompt|instructions|directive|guidelines|configuration|config)\s*(:|=|to|as)/i,
      /(system\s+prompt|initial\s+prompt|base\s+instructions|core\s+directives)\s*(is|should\s+be|:|=)/i,
    ],
  },
  {
    id: 'SPO_002',
    description: 'Reveal / print / output system prompt attempts',
    category: 'system_prompt_override',
    severity: Severity.High,
    weight: 0.9,
    patterns: [
      /(print|show|display|output|reveal|leak|spill|echo|dump)\s+(your\s+)?(system\s+)?(prompt|instructions|directives|guidelines|configuration|initial\s+prompt|base\s+prompt)/i,
      /(what\s+(is|are|were)\s+(your\s+)?(system\s+)?(prompt|instructions|directives|guidelines|initial\s+(prompt|instructions)))/i,
    ],
  },

  // ── Information Disclosure / "DO NOT REVEAL" ────────────────
  {
    id: 'INFO_001',
    description: 'DO NOT REVEAL — attempts to extract secrets, keys, or internal info',
    category: 'information_disclosure',
    severity: Severity.High,
    weight: 0.85,
    patterns: [
      /(what\s+(is|are)\s+(your\s+|the\s+)?(API\s*key|token|secret|password|credential|private\s+key|auth\s+token|access\s+key))/i,
      /(give\s+me|tell\s+me|provide|share|send|leak|expose|output)\s+(your\s+|the\s+)?(API\s*key|token|secret|password|credential|private\s+key|auth\s+token|access\s+key|encryption\s+key)/i,
      /(show|reveal|display|print|dump|echo|expose)\s+(your\s+|the\s+)?(API\s*key|token|secret|password|credential|private\s+key)/i,
    ],
  },
  {
    id: 'INFO_002',
    description: 'Attempt to extract environment variables or configuration',
    category: 'information_disclosure',
    severity: Severity.High,
    weight: 0.8,
    patterns: [
      /(what\s+(is|are)\s+(your\s+|the\s+)?(environment|env|env\s+var|environment\s+variable|config|configuration))/i,
      /(list|show|print|display|dump|echo|output)\s+(your\s+|the\s+)?(environment|env|env\s+var|env\s+vars|environment\s+variable|environment\s+variables|config|configuration)/i,
    ],
  },
  {
    id: 'INFO_003',
    description: 'DO NOT REVEAL — internal system prompt extraction via encoding tricks',
    category: 'information_disclosure',
    severity: Severity.High,
    weight: 0.75,
    patterns: [
      /(translate|encode|convert|format)\s+(your\s+)?(system\s+)?(prompt|instructions)\s+(into|as|to)\s+(JSON|base64|hex|binary|XML|YAML|rot13|leetspeak)/i,
      /(render|serialize|stringify|dump)\s+(your\s+|the\s+)?(system\s+)?(prompt|instructions|initial\s+text)/i,
    ],
  },

  // ── Prompt Leakage ──────────────────────────────────────────
  {
    id: 'LEAK_001',
    description: 'Token-by-token output extraction',
    category: 'prompt_leak',
    severity: Severity.Medium,
    weight: 0.6,
    patterns: [
      /(repeat|say\s+again|output\s+again|start\s+from\s+the\s+beginning)\s+(your\s+|the\s+)?(first|initial|opening|starting)\s+(word|sentence|line|paragraph|token|character)/i,
      /(word\s+by\s+word|character\s+by\s+character|token\s+by\s+token)\s+(output|write|say|repeat|print)/i,
    ],
  },
  {
    id: 'LEAK_002',
    description: 'Indirect prompt leak via continuation / completion',
    category: 'prompt_leak',
    severity: Severity.Low,
    weight: 0.4,
    patterns: [
      /(complete|finish|continue|fill\s+in)\s+(the\s+)?(sentence|phrase|paragraph|text)\s*(:|=|with|for)/i,
      /^(and|then|so|but|however|therefore)\s+/i,
    ],
  },

  // ── Logic Manipulation ──────────────────────────────────────
  {
    id: 'LOGIC_001',
    description: 'Token limit evasion / "continue generating" loops',
    category: 'logic_manipulation',
    severity: Severity.Low,
    weight: 0.3,
    patterns: [
      /(continue|go\s+on|keep\s+going|don't\s+stop|never\s+mind\s+the\s+limit|ignore\s+the\s+limit)\s+(generating|writing|outputting|responding)/i,
      /(output|generate|write)\s+(more|longer|further|beyond|without\s+limit|without\s+stopping)/i,
    ],
  },
  {
    id: 'LOGIC_002',
    description: 'Multi-step / chained instruction manipulation',
    category: 'logic_manipulation',
    severity: Severity.Medium,
    weight: 0.5,
    patterns: [
      /(first\s+(do|perform|execute|run|complete)\s+(this|the\s+following|X).*then\s+(do|perform|execute|run)\s+(that|the\s+next|Y))/i,
      /(step\s+1:.*step\s+2:.*step\s+3:)/i,
      /(before\s+you\s+(do|answer|respond|start|begin)|as\s+a\s+(first|preliminary)\s+step)/i,
    ],
  },
];

// ─── Detector Class ───────────────────────────────────────────

export interface PromptInjectionConfig {
  /** Minimum severity level to report */
  minSeverity: Severity;
  /** Score threshold above which an injection is considered detected (0.0 – 1.0) */
  threshold: number;
  /** Enable entropy-based heuristics for obfuscated injections */
  enableEntropyCheck: boolean;
  /** Patterns to skip (IDs) */
  ignorePatterns: string[];
}

const DEFAULT_CONFIG: PromptInjectionConfig = {
  minSeverity: Severity.Low,
  threshold: 0.3,
  enableEntropyCheck: true,
  ignorePatterns: [],
};

export class PromptInjectionDetector {
  private config: PromptInjectionConfig;
  private activePatterns: InjectionPattern[];

  constructor(config: Partial<PromptInjectionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.activePatterns = INJECTION_PATTERNS.filter(
      (p) => !this.config.ignorePatterns.includes(p.id),
    );
  }

  /**
   * Run the full detection pipeline on a piece of text.
   * Applies Unicode normalization (NFKC) to defeat homoglyph bypasses.
   */
  analyze(input: string): InjectionDetectionResult {
    const normalized = input.normalize('NFKC');
    const matchedPatterns: MatchedPattern[] = [];

    for (const pattern of this.activePatterns) {
      for (const regex of pattern.patterns) {
        const match = normalized.match(regex);
        if (match) {
          matchedPatterns.push({
            patternId: pattern.id,
            description: pattern.description,
            category: pattern.category,
            severity: pattern.severity,
            match: match[0].substring(0, 120), // cap to prevent huge blobs
          });
          break; // one match per pattern is enough
        }
      }
    }

    // Entropy-based heuristic: catch obfuscated payloads
    if (this.config.enableEntropyCheck) {
      const entropyResult = this.checkEntropy(input);
      if (entropyResult) {
        matchedPatterns.push(entropyResult);
      }
    }

    const riskScore = this.calculateRiskScore(matchedPatterns);
    const maxSeverity = this.getMaxSeverity(matchedPatterns);

    return {
      detected: riskScore >= this.config.threshold,
      matchedPatterns,
      riskScore,
      maxSeverity,
    };
  }

  /**
   * Reconfigure at runtime.
   */
  updateConfig(partial: Partial<PromptInjectionConfig>): void {
    this.config = { ...this.config, ...partial };
    this.activePatterns = INJECTION_PATTERNS.filter(
      (p) => !this.config.ignorePatterns.includes(p.id),
    );
  }

  getConfig(): Readonly<PromptInjectionConfig> {
    return { ...this.config };
  }

  // ── Private ──────────────────────────────────────────────

  /**
   * Aggregate matched patterns into a normalised 0.0–1.0 risk score.
   * Uses the highest-weight pattern as a base and adds diminishing returns
   * for additional matches.
   */
  private calculateRiskScore(matches: MatchedPattern[]): number {
    if (matches.length === 0) return 0;

    const severityWeights: Record<Severity, number> = {
      [Severity.Critical]: 1.0,
      [Severity.High]: 0.75,
      [Severity.Medium]: 0.5,
      [Severity.Low]: 0.25,
      [Severity.Info]: 0.05,
    };

    const scores = matches
      .map((m) => {
        const pattern = INJECTION_PATTERNS.find((p) => p.id === m.patternId);
        const baseWeight = pattern?.weight ?? 0.5;
        const sevWeight = severityWeights[m.severity] ?? 0.5;
        return baseWeight * sevWeight;
      })
      .sort((a, b) => b - a);

    // Primary score from the highest match
    let score = scores[0];

    // Diminishing additive bonus for additional matches
    for (let i = 1; i < scores.length; i++) {
      score += scores[i] * (0.5 / i);
    }

    return Math.min(score, 1.0);
  }

  /**
   * Shannon entropy approximation — catches high-entropy strings that
   * are likely obfuscated injection payloads.
   */
  private checkEntropy(text: string): MatchedPattern | null {
    // Only scan reasonably long tokens
    const tokens = text.split(/[\s,;(){}[\]<>]+/).filter((t) => t.length > 20);
    for (const token of tokens) {
      const e = this.shannonEntropy(token);
      if (e > 4.5) {
        return {
          patternId: 'ENTROPY_HIGH',
          description: 'High-entropy token suggesting obfuscated injection payload',
          category: 'logic_manipulation',
          severity: Severity.Medium,
          match: token.substring(0, 80),
        };
      }
    }
    return null;
  }

  private shannonEntropy(s: string): number {
    const len = s.length;
    const freq: Record<string, number> = {};
    for (const ch of s) {
      freq[ch] = (freq[ch] || 0) + 1;
    }
    let entropy = 0;
    for (const count of Object.values(freq)) {
      const p = count / len;
      entropy -= p * Math.log2(p);
    }
    return entropy;
  }

  private getMaxSeverity(matches: MatchedPattern[]): Severity {
    const order: Severity[] = [
      Severity.Critical,
      Severity.High,
      Severity.Medium,
      Severity.Low,
      Severity.Info,
    ];
    for (const sev of order) {
      if (matches.some((m) => m.severity === sev)) return sev;
    }
    return Severity.Info;
  }
}
