/**
 * Semgrep SAST Integration
 *
 * Wraps the `semgrep` CLI for static analysis security testing.
 * Falls back gracefully with a console warning if semgrep is not
 * installed. Maps semgrep severity levels to the CodeNexus
 * Severity enum.
 */

import { execFileSync } from 'node:child_process';
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
      execFileSync('semgrep', ['--version'], { stdio: 'ignore', timeout: 5000 });
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

    const config = rules ?? 'auto';
    const args = ['--config', config, '--json', '--quiet', '--no-git-ignore', targetPath];

    let output: string;
    try {
      output = execFileSync('semgrep', args, {
        timeout: 120000,
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024,
      });
    } catch (err) {
      // semgrep exits non-zero when findings are detected, but stdout still
      // contains valid JSON with the results
      const execErr = err as { stdout?: string; stderr?: string; message?: string };
      if (execErr.stdout) {
        output = execErr.stdout;
      } else {
        console.error('[Security] semgrep scan failed:', execErr.message);
        return [];
      }
    }

    if (!output!.trim()) return [];

    try {
      const parsed = JSON.parse(output!);
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
      console.error('[Security] semgrep scan parse failed:', (err as Error).message);
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
