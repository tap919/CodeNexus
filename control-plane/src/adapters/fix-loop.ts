import { spawnSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import type { ScoredFinding } from './confidence-scorer';

export interface FixAttempt {
  attempt: number;
  patch: string;
  verificationOutput: string;
  passed: boolean;
  failureReason?: string;
}

export interface FixLoopResult {
  finding: ScoredFinding;
  status: 'fixed' | 'suggested' | 'failed';
  attempts: FixAttempt[];
  finalPatch?: string;
  suggestedComment?: string;
}

export class FixLoop {
  constructor(
    private llmProvider: { complete: (prompt: string) => Promise<string> },
    private verifier: { verify: (workspacePath: string) => Promise<{ passed: boolean; output: string }> },
    private maxAttempts = 3,
  ) {}

  async fix(
    finding: ScoredFinding,
    workspacePath: string,
    diffContext: string,
  ): Promise<FixLoopResult> {
    const attempts: FixAttempt[] = [];
    let lastError = '';

    for (let i = 1; i <= this.maxAttempts; i++) {
      const prompt = this.buildPrompt(finding, diffContext, lastError, i);
      const patch = await this.llmProvider.complete(prompt);

      const applied = this.applyPatch(patch, workspacePath);
      if (!applied.success) {
        attempts.push({
          attempt: i,
          patch,
          verificationOutput: applied.error ?? 'Patch failed to apply',
          passed: false,
          failureReason: 'patch_apply_failed',
        });
        lastError = `Patch application failed: ${applied.error}`;
        continue;
      }

      const verification = await this.verifier.verify(workspacePath);

      attempts.push({
        attempt: i,
        patch,
        verificationOutput: verification.output,
        passed: verification.passed,
        failureReason: verification.passed ? undefined : 'verification_failed',
      });

      if (verification.passed) {
        return { finding, status: 'fixed', attempts, finalPatch: patch };
      }

      lastError = `Tests/types failed after applying patch:\n${verification.output.slice(0, 500)}`;
      this.revertPatch(workspacePath);
    }

    const suggestionPrompt = this.buildSuggestionPrompt(finding, diffContext, attempts);
    const suggestedComment = await this.llmProvider.complete(suggestionPrompt);

    return { finding, status: 'suggested', attempts, suggestedComment };
  }

  private buildPrompt(
    finding: ScoredFinding,
    diffContext: string,
    lastError: string,
    attempt: number,
  ): string {
    return `You are an expert code fixer. Generate a unified diff patch to fix the following issue.

FINDING:
Title: ${finding.title}
Severity: ${finding.severity}
File: ${finding.filePath ?? 'unknown'}
Line: ${finding.line ?? 'unknown'}
Description: ${finding.body}

PR DIFF CONTEXT:
${diffContext.slice(0, 3000)}

${lastError ? `PREVIOUS ATTEMPT ${attempt - 1} FAILED WITH:
${lastError}

Generate a corrected patch that avoids this failure.` : ''}

Output ONLY a valid unified diff patch. No explanation. No markdown fences.`;
  }

  private buildSuggestionPrompt(
    finding: ScoredFinding,
    diffContext: string,
    attempts: FixAttempt[],
  ): string {
    return `You attempted to fix the following issue ${attempts.length} times but could not produce a passing patch.

FINDING: ${finding.title}
DESCRIPTION: ${finding.body}

Write a clear, actionable PR comment explaining:
1. What the issue is
2. Why it needs to be fixed
3. A specific code suggestion (use GitHub suggestion syntax)

Be concise and technical. Address the PR author directly.`;
  }

  private applyPatch(
    patch: string,
    workspacePath: string,
  ): { success: boolean; error?: string } {
    const patchFile = `${workspacePath}/.codenexus-patch-${Date.now()}.diff`;

    try {
      writeFileSync(patchFile, patch);

      const check = spawnSync('git', ['-C', workspacePath, 'apply', '--check', patchFile], {
        stdio: 'pipe',
        encoding: 'utf8',
      });
      if (check.status !== 0) {
        return { success: false, error: check.stderr?.toString() ?? 'apply --check failed' };
      }

      const apply = spawnSync('git', ['-C', workspacePath, 'apply', patchFile], {
        stdio: 'pipe',
        encoding: 'utf8',
      });
      if (apply.status !== 0) {
        return { success: false, error: apply.stderr?.toString() ?? 'apply failed' };
      }

      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.stderr?.toString() ?? String(e) };
    } finally {
      try { unlinkSync(patchFile); } catch {}
    }
  }

  private revertPatch(workspacePath: string): void {
    try {
      spawnSync('git', ['-C', workspacePath, 'apply', '-R', '.codenexus-patch-*'], {
        stdio: 'pipe',
        encoding: 'utf8',
        shell: true,
      });
    } catch {}
  }
}
