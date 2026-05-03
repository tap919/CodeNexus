import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export interface CoverageDelta {
  baseLineCoverage: number;
  headLineCoverage: number;
  delta: number;
  droppedFiles: Array<{ file: string; basePct: number; headPct: number }>;
  newUncoveredLines: number;
}

export class CoverageAnalyzer {
  constructor(private workspacePath: string) {}

  async computeDelta(baseSha: string, headSha: string): Promise<CoverageDelta> {
    // Guard: ensure workspace is a git repo
    if (!this.isGitRepo()) {
      return { baseLineCoverage: 0, headLineCoverage: 0, delta: 0, droppedFiles: [], newUncoveredLines: 0 };
    }

    const originalSha = this.currentSha();

    try {
      const baseCoverage = await this.runCoverage(baseSha);
      const headCoverage = await this.runCoverage(headSha);

      const droppedFiles = Object.keys(headCoverage.files)
        .filter(f => {
          const base = baseCoverage.files[f]?.pct ?? 100;
          const head = headCoverage.files[f]?.pct ?? 0;
          return head < base - 2;
        })
        .map(f => ({
          file: f,
          basePct: baseCoverage.files[f]?.pct ?? 100,
          headPct: headCoverage.files[f]?.pct ?? 0,
        }));

      return {
        baseLineCoverage: baseCoverage.total,
        headLineCoverage: headCoverage.total,
        delta: headCoverage.total - baseCoverage.total,
        droppedFiles,
        newUncoveredLines: Math.max(0,
          (headCoverage.uncoveredLines ?? 0) - (baseCoverage.uncoveredLines ?? 0),
        ),
      };
    } finally {
      // Restore original state
      this.restoreCheckout(originalSha);
    }
  }

  private isGitRepo(): boolean {
    try {
      const result = spawnSync('git', ['-C', this.workspacePath, 'rev-parse', '--git-dir'], { stdio: 'pipe' });
      return result.status === 0;
    } catch {
      return false;
    }
  }

  private currentSha(): string {
    try {
      const result = spawnSync('git', ['-C', this.workspacePath, 'rev-parse', 'HEAD'], {
        encoding: 'utf8',
        stdio: 'pipe',
      });
      return result.stdout?.trim() ?? '';
    } catch {
      return '';
    }
  }

  private gitCheckout(sha: string): boolean {
    try {
      const result = spawnSync('git', ['-C', this.workspacePath, 'checkout', sha, '--quiet'], { stdio: 'pipe' });
      return result.status === 0;
    } catch {
      return false;
    }
  }

  private restoreCheckout(sha: string): void {
    if (!sha) return;
    this.gitCheckout(sha);
  }

  private async runCoverage(sha: string): Promise<{
    total: number;
    files: Record<string, { pct: number }>;
    uncoveredLines: number;
  }> {
    if (!this.gitCheckout(sha)) {
      return { total: 0, files: {}, uncoveredLines: 0 };
    }

    try {
      spawnSync('pnpm', ['run', 'test', '--', '--coverage', '--reporter=json'], {
        cwd: this.workspacePath,
        timeout: 120_000,
        stdio: 'pipe',
      });
    } catch {
      // coverage may still be written even on test failure
    }

    const coveragePath = path.join(this.workspacePath, 'coverage/coverage-summary.json');
    if (!fs.existsSync(coveragePath)) {
      return { total: 0, files: {}, uncoveredLines: 0 };
    }

    const raw = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
    const total = raw.total?.lines?.pct ?? 0;
    const files: Record<string, { pct: number }> = {};

    for (const [file, data] of Object.entries(raw)) {
      if (file === 'total') continue;
      files[file] = { pct: (data as any).lines?.pct ?? 0 };
    }

    return { total, files, uncoveredLines: raw.total?.lines?.skipped ?? 0 };
  }
}
