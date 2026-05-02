/**
 * Gitleaks Integration — secrets scanning
 * Falls back to built-in SecretsScanner if gitleaks CLI is not available.
 */

import { execSync } from 'node:child_process';
import { SecretsScanner } from './secrets-scanner';
import type { Severity } from '../../../shared/src/types';

export interface GitleaksFinding {
  line: number;
  rule: string;
  secret: string;
  match: string;
  file: string;
  severity: Severity;
}

export class GitleaksScanner {
  private gitleaksAvailable: boolean;
  private fallback: SecretsScanner;

  constructor() {
    this.gitleaksAvailable = this.checkGitleaks();
    this.fallback = new SecretsScanner();
  }

  private checkGitleaks(): boolean {
    try {
      execSync('gitleaks version', { stdio: 'ignore', timeout: 5000 });
      return true;
    } catch {
      console.warn('[Security] gitleaks not found — falling back to built-in scanner');
      return false;
    }
  }

  async scan(content: string, filePath?: string): Promise<GitleaksFinding[]> {
    if (!this.gitleaksAvailable) {
      const results = this.fallback.scan(content);
      return results.map(r => ({
        line: r.lineNumber || 0,
        rule: r.patternName || 'unknown',
        secret: r.match.substring(0, 20) + '...',
        match: r.match,
        file: filePath || '<inline>',
        severity: r.severity,
      }));
    }

    try {
      // Use gitleaks detect with --no-git to scan raw content
      const cmd = `gitleaks detect --no-git --source="${filePath || '.'}" --format=json --report-format=json --exit-code=0 2>/dev/null`;
      const output = execSync(cmd, { timeout: 30000, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
      if (!output.trim()) return [];
      
      const findings: any[] = JSON.parse(output);
      return findings.map((f: any) => ({
        line: f.StartLine || 0,
        rule: f.RuleID,
        secret: f.Secret ? f.Secret.substring(0, 20) + '...' : '[redacted]',
        match: f.Match,
        file: f.File,
        severity: f.RuleID?.includes('generic') ? 'low' : 'high' as Severity,
      }));
    } catch (err) {
      console.error('[Security] gitleaks scan failed:', (err as Error).message);
      return [];
    }
  }
}
