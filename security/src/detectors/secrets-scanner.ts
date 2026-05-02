/**
 * Secrets Scanner
 *
 * Detects leaked secrets (API keys, tokens, credentials) in agent
 * inputs, outputs, and file contents. Uses regex pattern matching
 * for known secret formats and entropy-based detection for
 * high-entropy strings that look like secrets.
 *
 * Fused from Claw-Protect's credential leak detector.
 */

import { Severity } from '../../../shared/src/types';

// ─── Types ────────────────────────────────────────────────────

export interface SecretMatch {
  /** Name of the secret pattern */
  patternName: string;
  /** Matched text (truncated) */
  match: string;
  /** Character position in source text */
  position: number;
  /** Line number (1-based) */
  lineNumber: number;
  /** Detection method */
  method: 'regex' | 'entropy';
  /** Severity */
  severity: Severity;
  /** Shannon entropy score (only for entropy-based matches) */
  entropy?: number;
  /** Whether this is likely a false positive (heuristic) */
  likelyFalsePositive: boolean;
}

export interface ScanResult {
  detected: boolean;
  secrets: SecretMatch[];
  riskScore: number; // 0.0 – 1.0
  totalSecrets: number;
  criticalSecrets: number;
  highSecrets: number;
}

// ─── Secret Patterns ──────────────────────────────────────────

interface SecretPattern {
  name: string;
  regex: RegExp;
  severity: Severity;
  /** Context keywords that must be nearby to reduce false positives */
  requiredContext?: RegExp;
  /** Keywords that, if nearby, indicate a false positive */
  falsePositiveIndicators?: RegExp[];
}

/**
 * Curated secret patterns optimised for low false-positive rates.
 * Each pattern is scoped tightly to known formats and validated
 * against common FP sources (example.com, placeholder text, etc.).
 */
const SECRET_PATTERNS: SecretPattern[] = [
  // ── GitHub ─────────────────────────────────────────────────
  {
    name: 'GitHub PAT (classic)',
    regex: /\bghp_[0-9a-zA-Z]{36}\b/,
    severity: Severity.Critical,
    falsePositiveIndicators: [/example/i, /placeholder/i, /your_token/i],
  },
  {
    name: 'GitHub PAT (fine-grained)',
    regex: /\bgithub_pat_[0-9a-zA-Z]{22,}\b/,
    severity: Severity.Critical,
    falsePositiveIndicators: [/example/i, /placeholder/i],
  },
  {
    name: 'GitHub OAuth Access Token',
    regex: /\bgho_[0-9a-zA-Z]{36}\b/,
    severity: Severity.Critical,
  },
  {
    name: 'GitHub App Installation Token',
    regex: /\bghs_[0-9a-zA-Z]{36}\b/,
    severity: Severity.Critical,
  },
  {
    name: 'GitHub Refresh Token',
    regex: /\bghr_[0-9a-zA-Z]{36}\b/,
    severity: Severity.High,
  },

  // ── AWS ─────────────────────────────────────────────────────
  {
    name: 'AWS Access Key ID',
    regex: /\bAKIA[0-9A-Z]{16}\b/,
    severity: Severity.High,
    requiredContext: /aws|amazon|s3|ec2|iam/i,
    falsePositiveIndicators: [/example/i, /placeholder/i, /YOUR_ACCESS_KEY/i],
  },
  {
    name: 'AWS Secret Access Key',
    regex: /(?:['"]?(?:(?i)aws[_-]?(?:secret|access)[_-]?key|secret[_-]?access[_-]?key)['"]?\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}['"]?)/,
    severity: Severity.Critical,
    falsePositiveIndicators: [/example/i, /placeholder/i, /your_secret/i],
  },

  // ── Google Cloud ────────────────────────────────────────────
  {
    name: 'Google API Key',
    regex: /\bAIza[0-9A-Za-z\-_]{35}\b/,
    severity: Severity.High,
    falsePositiveIndicators: [/example/i, /placeholder/i, /YOUR_API_KEY/i],
  },
  {
    name: 'GCP OAuth Client ID',
    regex: /\b\d{12,20}-[a-zA-Z0-9_]{32}\.apps\.googleusercontent\.com\b/,
    severity: Severity.High,
  },
  {
    name: 'GCP Service Account',
    regex: /["']?type["']?\s*:\s*["']service_account["']?/,
    severity: Severity.Critical,
    requiredContext: /private_key|client_email|project_id/i,
    falsePositiveIndicators: [/example/i, /placeholder/i],
  },

  // ── Slack ───────────────────────────────────────────────────
  {
    name: 'Slack Bot Token',
    regex: /\bxoxb-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24}\b/,
    severity: Severity.Critical,
    falsePositiveIndicators: [/example/i, /placeholder/i],
  },
  {
    name: 'Slack Webhook URL',
    regex: /hooks\.slack\.com\/services\/[A-Za-z0-9/]{44}/,
    severity: Severity.High,
    falsePositiveIndicators: [/example/i, /placeholder\.slack/i],
  },
  {
    name: 'Slack User Token',
    regex: /\bxoxp-[0-9]{10,13}-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{32}\b/,
    severity: Severity.High,
  },
  {
    name: 'Slack App-Level Token',
    regex: /\bxoxa-[0-9A-Za-z\-]{142}\b/,
    severity: Severity.Critical,
  },

  // ── Stripe ──────────────────────────────────────────────────
  {
    name: 'Stripe Live Secret Key',
    regex: /\bsk_live_[0-9a-zA-Z]{24,}\b/,
    severity: Severity.Critical,
    falsePositiveIndicators: [/example/i, /placeholder/i],
  },
  {
    name: 'Stripe Live Publishable Key',
    regex: /\bpk_live_[0-9a-zA-Z]{24,}\b/,
    severity: Severity.Medium,
  },
  {
    name: 'Stripe Restricted Key',
    regex: /\brk_live_[0-9a-zA-Z]{24,}\b/,
    severity: Severity.High,
  },

  // ── OpenAI ──────────────────────────────────────────────────
  {
    name: 'OpenAI API Key',
    regex: /\bsk-[A-Za-z0-9]{20,}(?:T3BlbkFJ[A-Za-z0-9]{20,})?\b/,
    severity: Severity.Critical,
    falsePositiveIndicators: [/example/i, /placeholder/i, /your-api-key/i],
  },

  // ── Anthropic ───────────────────────────────────────────────
  {
    name: 'Anthropic API Key',
    regex: /\bsk-ant-[A-Za-z0-9]{32,}\b/,
    severity: Severity.Critical,
    falsePositiveIndicators: [/example/i, /placeholder/i],
  },

  // ── Azure / Microsoft ───────────────────────────────────────
  {
    name: 'Azure Connection String',
    regex: /DefaultEndpointsProtocol=https;AccountName=[^;]+;AccountKey=[^;]+;/,
    severity: Severity.Critical,
    falsePositiveIndicators: [/example/i, /placeholder/i],
  },
  {
    name: 'Azure DevOps PAT',
    regex: /(?:(?i)pat)\s*[:=]\s*['"]?[a-z0-9]{52}['"]?/,
    severity: Severity.High,
  },
  {
    name: 'Azure Storage Account Key',
    regex: /\b(?:AccountKey|accountKey)\s*=\s*[A-Za-z0-9+/=]{86,88}\b/,
    severity: Severity.Critical,
  },

  // ── Docker / Container Registries ───────────────────────────
  {
    name: 'Docker Config Auth',
    regex: /["']auth["']\s*:\s*["'][A-Za-z0-9+/=]{20,}["']/,
    severity: Severity.Medium,
    requiredContext: /auths|credsStore|docker/i,
  },

  // ── npm / Node ──────────────────────────────────────────────
  {
    name: 'npm Auth Token',
    regex: /\/\/registry\.npmjs\.org\/:_authToken=[A-Za-z0-9\-]{36}/,
    severity: Severity.High,
  },
  {
    name: 'npmRC Auth Token',
    regex: /_authToken\s*=\s*[A-Za-z0-9\-]{36}/,
    severity: Severity.High,
    requiredContext: /registry|npm/i,
  },

  // ── Private Keys (PEM) ──────────────────────────────────────
  {
    name: 'RSA Private Key',
    regex: /-----BEGIN\s+RSA\s+PRIVATE\s+KEY-----/,
    severity: Severity.Critical,
    falsePositiveIndicators: [/example/i, /placeholder/i],
  },
  {
    name: 'EC Private Key',
    regex: /-----BEGIN\s+EC\s+PRIVATE\s+KEY-----/,
    severity: Severity.Critical,
  },
  {
    name: 'OpenSSH Private Key',
    regex: /-----BEGIN\s+OPENSSH\s+PRIVATE\s+KEY-----/,
    severity: Severity.Critical,
  },
  {
    name: 'DSA Private Key',
    regex: /-----BEGIN\s+DSA\s+PRIVATE\s+KEY-----/,
    severity: Severity.Critical,
  },
  {
    name: 'Generic Private Key (PEM)',
    regex: /-----BEGIN\s+PRIVATE\s+KEY-----/,
    severity: Severity.Critical,
    requiredContext: /ssh|rsa|ec|dsa|ed25519/i,
  },

  // ── JWT ─────────────────────────────────────────────────────
  {
    name: 'JSON Web Token (JWT)',
    regex: /eyJ[A-Za-z0-9_\-=]+\.eyJ[A-Za-z0-9_\-=]+\.[A-Za-z0-9_\-+/=]+/,
    severity: Severity.High,
    falsePositiveIndicators: [/example\.jwt/i, /placeholder/i],
  },

  // ── Discord ─────────────────────────────────────────────────
  {
    name: 'Discord Bot Token',
    regex: /\b[MN][A-Za-z\d]{23}\.[Xx][A-Za-z\d]{6}\.[A-Za-z\d]{27}\b/,
    severity: Severity.High,
  },

  // ── Telegram ────────────────────────────────────────────────
  {
    name: 'Telegram Bot Token',
    regex: /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/,
    severity: Severity.High,
  },

  // ── Twilio ──────────────────────────────────────────────────
  {
    name: 'Twilio Account SID',
    regex: /\bAC[a-zA-Z0-9]{32}\b/,
    severity: Severity.High,
  },
  {
    name: 'Twilio Auth Token',
    regex: /\b(?:TWILIO_AUTH_TOKEN|twilio_auth_token)['"]?\s*[:=]\s*['"]?[a-zA-Z0-9]{32}['"]?/,
    severity: Severity.Critical,
  },

  // ── HashiCorp Vault ─────────────────────────────────────────
  {
    name: 'Vault Token',
    regex: /\bhvs\.[A-Za-z0-9_-]{90,}\b/,
    severity: Severity.Critical,
  },

  // ── SendGrid ────────────────────────────────────────────────
  {
    name: 'SendGrid API Key',
    regex: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/,
    severity: Severity.High,
  },

  // ── Heroku ──────────────────────────────────────────────────
  {
    name: 'Heroku API Key',
    regex: /\b[hH][eE][rR][oO][kK][uU].*\b[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\b/,
    severity: Severity.High,
    falsePositiveIndicators: [/example/i, /placeholder/i],
  },

  // ── Generic Tokens ──────────────────────────────────────────
  {
    name: 'Authorization Bearer Token',
    regex: /(?:Bearer\s+)[A-Za-z0-9_\-=.]{20,}/,
    severity: Severity.High,
    falsePositiveIndicators: [/example/i, /placeholder/i, /your_token/i, /null/i, /undefined/i],
  },
  {
    name: 'Basic Auth Credentials',
    regex: /(?:Basic\s+)[A-Za-z0-9+/=]{10,}(?:\s|$)/,
    severity: Severity.Critical,
    falsePositiveIndicators: [/example/i, /placeholder/i],
  },
];

// ─── Configuration ────────────────────────────────────────────

export interface SecretsScannerConfig {
  /** Enable regex-based pattern matching */
  enableRegexScanning: boolean;
  /** Enable entropy-based detection */
  enableEntropyDetection: boolean;
  /** Minimum Shannon entropy to flag a string */
  entropyThreshold: number;
  /** Minimum token length for entropy check */
  entropyMinLength: number;
  /** Maximum results to return */
  maxResults: number;
  /** Minimum severity to report */
  minSeverity: Severity;
  /** Strings to always ignore (e.g., test tokens) */
  ignoreList: string[];
}

const DEFAULT_CONFIG: SecretsScannerConfig = {
  enableRegexScanning: true,
  enableEntropyDetection: true,
  entropyThreshold: 4.2,
  entropyMinLength: 24,
  maxResults: 100,
  minSeverity: Severity.Low,
  ignoreList: [
    'ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    'sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    'YOUR_API_KEY',
    'YOUR_SECRET_KEY',
    'your-github-token',
    'your-api-key-here',
  ],
};

// ─── Scanner Class ────────────────────────────────────────────

export class SecretsScanner {
  private config: SecretsScannerConfig;

  constructor(config: Partial<SecretsScannerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Scan a string for secrets. Returns all matches sorted by
   * severity (most critical first).
   */
  scan(text: string): ScanResult {
    const secrets: SecretMatch[] = [];
    const lines = text.split('\n');

    // ── Regex-based detection ──
    if (this.config.enableRegexScanning) {
      for (const pattern of SECRET_PATTERNS) {
        if (this.severityLevel(pattern.severity) < this.severityLevel(this.config.minSeverity)) {
          continue;
        }

        let match: RegExpExecArray | null;
        const re = new RegExp(pattern.regex.source, pattern.regex.flags + 'g');
        while ((match = re.exec(text)) !== null) {
          // Check ignore list
          if (this.config.ignoreList.some((ig) => match![0].includes(ig))) {
            continue;
          }

          // Context validation
          if (pattern.requiredContext) {
            const contextWindow = text.substring(
              Math.max(0, match.index - 200),
              Math.min(text.length, match.index + match[0].length + 200),
            );
            if (!pattern.requiredContext.test(contextWindow)) {
              continue;
            }
          }

          // False positive heuristic
          const fp = this.isFalsePositive(match[0], match.index, text, pattern);

          const lineNumber = this.getLineNumber(lines, match.index);
          secrets.push({
            patternName: pattern.name,
            match: match[0].substring(0, 60),
            position: match.index,
            lineNumber,
            method: 'regex',
            severity: pattern.severity,
            likelyFalsePositive: fp,
          });

          if (secrets.length >= this.config.maxResults) break;
        }
        if (secrets.length >= this.config.maxResults) break;
      }
    }

    // ── Entropy-based detection ──
    if (this.config.enableEntropyDetection && secrets.length < this.config.maxResults) {
      const entropyMatches = this.scanByEntropy(text, lines);
      secrets.push(...entropyMatches);
    }

    // ── Aggregate ──
    secrets.sort((a, b) => this.severityLevel(b.severity) - this.severityLevel(a.severity));

    const nonFpSecrets = secrets.filter((s) => !s.likelyFalsePositive);
    const detected = nonFpSecrets.length > 0;
    const riskScore = this.calculateRiskScore(secrets);
    const criticalSecrets = nonFpSecrets.filter((s) => s.severity === Severity.Critical).length;
    const highSecrets = nonFpSecrets.filter((s) => s.severity === Severity.High).length;

    return {
      detected,
      secrets: secrets.slice(0, this.config.maxResults),
      riskScore,
      totalSecrets: nonFpSecrets.length,
      criticalSecrets,
      highSecrets,
    };
  }

  /**
   * Scan a batch of texts in a single pass.
   */
  scanBatch(texts: string[]): Map<string, ScanResult> {
    const results = new Map<string, ScanResult>();
    for (let i = 0; i < texts.length; i++) {
      results.set(`text_${i}`, this.scan(texts[i]));
    }
    return results;
  }

  /**
   * Determine the Shannon entropy of a string.
   */
  static shannonEntropy(s: string): number {
    const len = s.length;
    if (len === 0) return 0;
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

  updateConfig(partial: Partial<SecretsScannerConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  // ── Private ──────────────────────────────────────────────

  private scanByEntropy(text: string, lines: string[]): SecretMatch[] {
    const matches: SecretMatch[] = [];

    // Tokenize: split on whitespace and common delimiters
    const tokens = text.split(/[\s,;(){}[\]<>"'=:|/\\]+/);

    for (const token of tokens) {
      if (token.length < this.config.entropyMinLength) continue;
      if (this.config.ignoreList.some((ig) => token.includes(ig))) continue;

      // Skip purely numeric tokens and hex values (likely not secrets)
      if (/^\d+$/.test(token)) continue;
      if (/^[0-9a-fA-F]+$/.test(token) && token.length < 40) continue;

      // Skip URLs
      if (/^https?:\/\//.test(token)) continue;

      // Skip tokens that look like file paths
      if (/^[\w.\-/]+$/.test(token) && token.includes('.') && !token.includes('_')) continue;

      // Skip common non-secret tokens
      if (['true', 'false', 'null', 'undefined', 'NaN'].includes(token)) continue;

      const entropy = SecretsScanner.shannonEntropy(token);
      if (entropy >= this.config.entropyThreshold) {
        // Additional heuristic: mix of character classes suggests a secret
        const hasUpper = /[A-Z]/.test(token);
        const hasLower = /[a-z]/.test(token);
        const hasDigit = /\d/.test(token);
        const hasSpecial = /[^A-Za-z0-9]/.test(token);
        const classCount = [hasUpper, hasLower, hasDigit, hasSpecial].filter(Boolean).length;

        if (classCount >= 2) {
          const pos = text.indexOf(token);
          const lineNumber = pos >= 0 ? this.getLineNumber(lines, pos) : 0;
          matches.push({
            patternName: 'High-Entropy String',
            match: token.substring(0, 40),
            position: pos,
            lineNumber,
            method: 'entropy',
            severity: Severity.Medium,
            entropy,
            likelyFalsePositive: false,
          });
        }
      }
    }

    return matches;
  }

  private isFalsePositive(
    matchText: string,
    matchIndex: number,
    fullText: string,
    pattern: SecretPattern,
  ): boolean {
    // Check built-in FP indicators
    if (pattern.falsePositiveIndicators) {
      // Check within 100 chars before the match
      const before = fullText.substring(
        Math.max(0, matchIndex - 100),
        matchIndex,
      );
      for (const fp of pattern.falsePositiveIndicators) {
        if (fp.test(before)) return true;
      }
    }

    // Common FP patterns
    const surrounding = fullText.substring(
      Math.max(0, matchIndex - 50),
      Math.min(fullText.length, matchIndex + matchText.length + 50),
    ).toLowerCase();

    if (
      surrounding.includes('example') ||
      surrounding.includes('placeholder') ||
      surrounding.includes('your_') ||
      surrounding.includes('xxxxxxxx')
    ) {
      return true;
    }

    return false;
  }

  private getLineNumber(lines: string[], position: number): number {
    let charCount = 0;
    for (let i = 0; i < lines.length; i++) {
      charCount += lines[i].length + 1; // +1 for newline
      if (charCount > position) return i + 1;
    }
    return lines.length;
  }

  private calculateRiskScore(secrets: SecretMatch[]): number {
    if (secrets.length === 0) return 0;

    const severityScores: Record<Severity, number> = {
      [Severity.Critical]: 1.0,
      [Severity.High]: 0.7,
      [Severity.Medium]: 0.4,
      [Severity.Low]: 0.2,
      [Severity.Info]: 0.05,
    };

    let score = 0;
    for (const secret of secrets) {
      if (secret.likelyFalsePositive) continue;
      score += severityScores[secret.severity] ?? 0;
    }

    // Diminishing returns for many secrets
    return Math.min(score, 1.0);
  }

  private severityLevel(s: Severity): number {
    const levels: Record<Severity, number> = {
      [Severity.Critical]: 5,
      [Severity.High]: 4,
      [Severity.Medium]: 3,
      [Severity.Low]: 2,
      [Severity.Info]: 1,
    };
    return levels[s] ?? 0;
  }
}
