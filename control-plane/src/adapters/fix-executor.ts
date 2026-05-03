/**
 * Fix Executor — Wires orchestrator's ApplyFixes step to real sandbox + patch execution.
 *
 * Pipeline:
 * 1. Create isolated workspace (clone/checkout PR head)
 * 2. Apply suggested fixes
 * 3. Run verification (test/lint/build)
 * 4. Commit + push on success
 * 5. Return structured result
 */

import { execSync, exec } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export interface FixExecutionInput {
  /** Repository info */
  owner: string;
  repo: string;
  prNumber: number;
  headBranch: string;
  baseBranch: string;
  /** Authentication */
  token: string;
  /** LLM-generated patches to apply */
  patches: Array<{
    path: string;
    content: string;
  }>;
  /** Verification commands (repo-specific) */
  verifyCommands?: {
    test?: string;
    lint?: string;
    build?: string;
  };
}

export interface FixExecutionResult {
  success: boolean;
  workspace?: string;
  branchName?: string;
  commitSha?: string;
  patchSummary?: {
    attempted: number;
    applied: number;
    failed: number;
  };
  testResults?: {
    passed: boolean;
    output: string;
    durationMs: number;
  };
  lintResults?: {
    passed: boolean;
    output: string;
    durationMs: number;
  };
  buildResults?: {
    passed: boolean;
    output: string;
    durationMs: number;
  };
  error?: string;
  timestamp: string;
}

function execCommand(cmd: string, cwd: string): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execSync(cmd, { cwd, encoding: 'utf-8', timeout: 120000 });
    return { stdout, stderr: '', status: 0 };
  } catch (err) {
    const execErr = err as { stdout?: string; stderr?: string; status?: number; message: string };
    return {
      stdout: execErr.stdout ?? '',
      stderr: execErr.stderr ?? execErr.message,
      status: execErr.status ?? 1,
    };
  }
}

function execCommandAsync(
  cmd: string,
  cwd: string,
): Promise<{ stdout: string; stderr: string; status: number }> {
  return new Promise((resolve) => {
    exec(cmd, { cwd, timeout: 120000 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ stdout, stderr: stderr || err.message, status: (err as { status?: number }).status ?? 1 });
      } else {
        resolve({ stdout, stderr, status: 0 });
      }
    });
  });
}

export async function executeFixes(input: FixExecutionInput): Promise<FixExecutionResult> {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  const {
    owner,
    repo,
    prNumber,
    headBranch,
    baseBranch,
    token,
    patches,
    verifyCommands,
  } = input;

  const branchName = `codenexus/fix/pr-${prNumber}-${Date.now()}`;
  let workspace: string | undefined;
  let result: FixExecutionResult = {
    success: false,
    branchName,
    timestamp,
    error: 'Execution did not complete',
  };

  try {
    workspace = mkdtempSync(join(tmpdir(), 'codenexus-fix-'));
    console.log(`[fix-executor] Workspace: ${workspace}`);

    // 1. Clone the repository at PR head
    const cloneUrl = `https://${token}@github.com/${owner}/${repo}.git`;
    const cloneResult = execCommand(
      `git clone --depth 1 --branch ${headBranch} ${cloneUrl} .`,
      workspace,
    );
    if (cloneResult.status !== 0) {
      throw new Error(`Clone failed: ${cloneResult.stderr}`);
    }

    // 2. Create fix branch
    execCommand(`git checkout -b ${branchName}`, workspace);

    // 3. Apply patches
    let applied = 0;
    let failed = 0;
    const patchSummary: FixExecutionResult['patchSummary'] = {
      attempted: patches.length,
      applied: 0,
      failed: 0,
    };

    for (const patch of patches) {
      const patchPath = join(workspace, patch.path);
      console.log(`[fix-executor] Applying patch to: ${patch.path}`);

      try {
        // Write the patched content
        const dir = patchPath.substring(0, patchPath.lastIndexOf('/'));
        if (dir && !existsSync(dir)) {
          execSync(`mkdir -p ${dir}`, { cwd: workspace });
        }
        writeFileSync(patchPath, patch.content, { encoding: 'utf-8' });
        patchSummary.applied++;
      } catch (err) {
        console.error(`[fix-executor] Patch failed: ${patch.path}`, err);
        patchSummary.failed++;
      }
    }

    patchSummary.applied = applied;
    patchSummary.failed = failed;
    result.patchSummary = patchSummary;

    // Stage changes
    execCommand('git add -A', workspace);

    // Check if there are changes to commit
    const diffResult = execCommand('git diff --cached --stat', workspace);
    if (!diffResult.stdout.trim() || diffResult.stdout === '') {
      console.log('[fix-executor] No changes to commit');
      result.success = true;
      result.testResults = { passed: true, output: 'No changes needed', durationMs: 0 };
      result.lintResults = { passed: true, output: 'No changes needed', durationMs: 0 };
      result.buildResults = { passed: true, output: 'No changes needed', durationMs: 0 };
      return result;
    }

    // 4. Run verification commands
    const testCmd = verifyCommands?.test ?? 'npm test';
    const lintCmd = verifyCommands?.lint ?? 'npm run lint';
    const buildCmd = verifyCommands?.build ?? 'npm run build';

    // Test
    const testStart = Date.now();
    const testResult = execCommand(testCmd, workspace);
    result.testResults = {
      passed: testResult.status === 0,
      output: testResult.stdout + testResult.stderr,
      durationMs: Date.now() - testStart,
    };

    if (testResult.status !== 0) {
      console.log('[fix-executor] Tests failed, not pushing');
      result.error = `Tests failed: ${testResult.stderr}`;
      return result;
    }

    // Lint
    const lintStart = Date.now();
    const lintResult = execCommand(lintCmd, workspace);
    result.lintResults = {
      passed: lintResult.status === 0,
      output: lintResult.stdout + lintResult.stderr,
      durationMs: Date.now() - lintStart,
    };

    if (lintResult.status !== 0) {
      console.log('[fix-executor] Lint failed, not pushing');
      result.error = `Lint failed: ${lintResult.stderr}`;
      return result;
    }

    // Build
    const buildStart = Date.now();
    const buildResult = execCommand(buildCmd, workspace);
    result.buildResults = {
      passed: buildResult.status === 0,
      output: buildResult.stdout + buildResult.stderr,
      durationMs: Date.now() - buildStart,
    };

    if (buildResult.status !== 0) {
      console.log('[fix-executor] Build failed, not pushing');
      result.error = `Build failed: ${buildResult.stderr}`;
      return result;
    }

    // 5. Commit and push
    execCommand(
      `git config user.email "codenexus@agent.local" && git config user.name "CodeNexus"`,
      workspace,
    );
    execCommand(
      `git commit -m "CodeNexus auto-fix: Apply ${patchSummary.applied} fix patch(es)"`,
      workspace,
    );

    // Push to remote
    const pushResult = execCommand(
      `git push -u https://${token}@github.com/${owner}/${repo}.git ${branchName}`,
      workspace,
    );
    if (pushResult.status !== 0) {
      throw new Error(`Push failed: ${pushResult.stderr}`);
    }

    result.success = true;
    result.workspace = workspace;

    // Get commit SHA
    const shaResult = execCommand('git rev-parse HEAD', workspace);
    result.commitSha = shaResult.stdout.trim();

    console.log(`[fix-executor] Successfully pushed fix to ${branchName}`);
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    console.error('[fix-executor] Fix execution failed:', result.error);
  }

  // Cleanup workspace (optional - keep for debugging)
  // if (workspace) {
  //   try { rmSync(workspace, { recursive: true, force: true }); } catch {}
  // }

  return result;
}

/**
 * Create a default ApplyFixes adapter for the orchestrator.
 */
export function createDefaultFixExecutor(): ModuleAdapters['fixExecutor'] {
  return {
    async executeFixes(input: {
      repo: { owner: string; repo: string; prNumber: number; branch: string };
      patches: Array<{ path: string; content: string }>;
    }): Promise<FixExecutionResult> {
      const token = process.env.CNX_GITHUB_TOKEN;
      if (!token) {
        return {
          success: false,
          timestamp: new Date().toISOString(),
          error: 'CNX_GITHUB_TOKEN not set',
        };
      }

      return executeFixes({
        owner: input.repo.owner,
        repo: input.repo.repo,
        prNumber: input.repo.prNumber,
        headBranch: input.repo.branch,
        baseBranch: 'main',
        token,
        patches: input.patches,
      });
    },
  };
}

import type { ModuleAdapters } from '../orchestrator';
import type { RepositoryInfo } from '../../../shared/src/types';

export interface ModuleAdapters {
  fixExecutor?: {
    executeFixes: (input: {
      repo: RepositoryInfo;
      patches: Array<{ path: string; content: string }>;
    }) => Promise<FixExecutionResult>;
  };
}