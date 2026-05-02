/**
 * Semgrep SAST Integration
 *
 * Wraps the `semgrep` CLI for static analysis security testing.
 * Falls back gracefully with a console warning if semgrep is not
 * installed. Maps semgrep severity levels to the CodeNexus
 * Severity enum.
 */

import { execSync } from 'node:child_process';
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

export interface SemgrepResult {
  findings: SemgrepFinding[];
  errors: string[];
}

export class SemgrepScanner {
  private semgrepAvailable: boolean;

  constructor() {
    this.semgrepAvailable = this.checkSemgrep();
  }

  private checkSemgrep(): boolean {
    try {
      execSync('semgrep --version', { stdio: 'ignore', timeout: 5000 });
      return true;
    } catch {
      console.warn('[Security] semgrep not found — SAST scanning unavailable. Install with: pip install semgrep');
      return false;
    }
  }

  async scan(targetPath: string, rules?: string): Promise<SemgrepFinding[]> {
    if (!this.semgrepAvailable) {
      return [];
    }

    try {
      const config = rules ?? 'auto';
      const cmd = `semgrep --config="${config}" --json --quiet --no-git-ignore "${targetPath}" 2>nul`;
      const output = execSync(cmd, {
        timeout: 120000,
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024,
      });

      if (!output.trim()) return [];

      const parsed = JSON.parse(output);
      const results = parsed.results ?? [];

      return results.map((r: any) => ({
        checkId: r.check_id,
        message: r.extra?.message ?? r.check_id,
        severity: this.mapSeverity(r.extra?.severity),
        path: r.path,
        line: r.start?.line ?? 1,
        column: r.start?.col ?? 1,
        language: r.extra?.metadata?.language ?? '',
        fix: r.extra?.fix ?? undefined,
      }));
    } catch (err) {
      console.error('[Security] semgrep scan failed:', (err as Error).message);
      return [];
    }
  }

  private mapSeverity(semgrepSeverity: string | undefined): Severity {
    switch (semgrepSeverity?.toUpperCase()) {
      case 'ERROR':
        return Severity.Critical;
      case 'WARNING':
        return Severity.High;
      case 'INFO':
        return Severity.Medium;
      default:
        return Severity.Low;
    }
  }
}
