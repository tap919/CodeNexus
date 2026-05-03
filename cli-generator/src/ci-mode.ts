/**
 * CodeNexus CI SARIF Output Mode
 *
 * Runs SemgrepScanner + SecretsScanner + GitleaksScanner against a
 * target path and produces SARIF 2.1.0 JSON output suitable for
 * ingestion by GitHub Code Scanning, GitLab SAST, or any SARIF-
 * compatible CI/CD platform.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { SemgrepScanner } from '../../security/src/detectors/semgrep';
import type { SemgrepFinding } from '../../security/src/detectors/semgrep';
import { SecretsScanner } from '../../security/src/detectors/secrets-scanner';
import type { SecretMatch } from '../../security/src/detectors/secrets-scanner';
import { GitleaksScanner } from '../../security/src/detectors/gitleaks';
import type { GitleaksFinding } from '../../security/src/detectors/gitleaks';
import { Severity } from '../../shared/src/types';

export interface SARIFOutput {
  version: string;
  runs: SARIFRun[];
}

export interface SARIFRun {
  tool: {
    driver: {
      name: string;
      informationUri: string;
      rules: SARIFRule[];
    };
  };
  results: SARIFResult[];
}

export interface SARIFRule {
  id: string;
  shortDescription: { text: string };
  fullDescription: { text: string };
  helpUri: string;
}

export interface SARIFResult {
  ruleId: string;
  level: 'error' | 'warning' | 'note' | 'none';
  message: { text: string };
  locations: SARIFLocation[];
}

export interface SARIFLocation {
  physicalLocation: {
    artifactLocation: { uri: string };
    region: {
      startLine: number;
      startColumn: number;
    };
  };
}

const TOOL_DRIVER_NAME = 'CodeNexus Security Scanner';
const TOOL_INFORMATION_URI = 'https://github.com/anomalyco/CodeNexus';
const TARGET_FILES = /\.(ts|tsx|js|jsx|py|go|java|rs|cpp|c|h|rb|php|swift|kt|sh|yaml|yml|json|tf|dockerfile|dockerignore)$/i;
const EXCLUDE_DIRS = /(node_modules|\.git|dist|build|\.next|vendor|__pycache__|\.venv|venv|target)$/;

function walkFiles(dir: string, collected: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return collected;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.test(entry.name)) continue;
      walkFiles(fullPath, collected);
    } else if (entry.isFile() && TARGET_FILES.test(entry.name)) {
      collected.push(fullPath);
    }
  }
  return collected;
}

function severityToResultLevel(s: Severity): SARIFResult['level'] {
  switch (s) {
    case Severity.Critical:
      return 'error';
    case Severity.High:
      return 'warning';
    case Severity.Medium:
    case Severity.Low:
    case Severity.Info:
      return 'note';
    default:
      return 'note';
  }
}

function buildSarifLocation(filePath: string, line: number, column: number): SARIFLocation {
  return {
    physicalLocation: {
      artifactLocation: { uri: filePath.replace(/\\/g, '/') },
      region: { startLine: line, startColumn: column },
    },
  };
}

export async function runCIScan(targetPath: string): Promise<SARIFOutput> {
  const resolvedPath = path.resolve(targetPath);
  const files = walkFiles(resolvedPath);

  const semgrep = new SemgrepScanner();
  const secrets = new SecretsScanner();
  const gitleaks = new GitleaksScanner();

  const semgrepFindings = await semgrep.scan(resolvedPath);

  const secretMatches: SecretMatch[] = [];
  const MAX_SECRET_FILES = 2000;
  for (const file of files.slice(0, MAX_SECRET_FILES)) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const result = secrets.scan(content);
      for (const match of result.secrets) {
        if (!match.filePath) {
          (match as Record<string, unknown>).filePath = file;
        }
        secretMatches.push(match);
      }
    } catch {
      // skip unreadable files
    }
  }

  const gitleaksFindings: GitleaksFinding[] = [];
  for (const file of files.slice(0, 500)) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const findings = await gitleaks.scan(content, file);
      gitleaksFindings.push(...findings);
    } catch {
      // skip unreadable files
    }
  }

  const sastRuleIds = new Set(semgrepFindings.map((f) => f.checkId));
  const secretRuleIds = new Set(secretMatches.map((s) => s.patternName));

  const rules: SARIFRule[] = [];
  for (const id of sastRuleIds) {
    rules.push({
      id,
      shortDescription: { text: id },
      fullDescription: { text: id },
      helpUri: `${TOOL_INFORMATION_URI}#${id}`,
    });
  }
  for (const id of secretRuleIds) {
    rules.push({
      id,
      shortDescription: { text: id },
      fullDescription: { text: id },
      helpUri: `${TOOL_INFORMATION_URI}#secrets-${id}`,
    });
  }

  const results: SARIFResult[] = [];

  for (const f of semgrepFindings) {
    results.push({
      ruleId: f.checkId,
      level: severityToResultLevel(f.severity),
      message: { text: f.message },
      locations: [buildSarifLocation(f.path, f.line, f.column)],
    });
  }

  for (const s of secretMatches) {
    if (s.likelyFalsePositive) continue;
    results.push({
      ruleId: s.patternName,
      level: severityToResultLevel(s.severity),
      message: { text: `Secret detected: ${s.patternName}` },
      locations: [buildSarifLocation((s as Record<string, unknown>).filePath as string || '<unknown>', s.lineNumber, s.position)],
    });
  }

  for (const g of gitleaksFindings) {
    results.push({
      ruleId: g.rule,
      level: severityToResultLevel(g.severity),
      message: { text: `Secret detected: ${g.rule}` },
      locations: [buildSarifLocation(g.file, g.line, 1)],
    });
  }

  return {
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: TOOL_DRIVER_NAME,
            informationUri: TOOL_INFORMATION_URI,
            rules,
          },
        },
        results,
      },
    ],
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const pathIndex = args.indexOf('--path');
  const outputIndex = args.indexOf('--output');

  const targetPath = pathIndex >= 0 ? args[pathIndex + 1] : '.';

  if (!targetPath) {
    console.error('Usage: npx tsx ci-mode.ts --path <target> [--output <file>]');
    process.exit(1);
  }

  const outputFile = outputIndex >= 0 ? args[outputIndex + 1] : 'results.sarif';

  const result = await runCIScan(targetPath);
  fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
  console.log(`SARIF output written to ${outputFile}`);
}

if (process.argv[1]?.includes('ci-mode.ts') || process.argv[1]?.endsWith('ci-mode')) {
  main().catch((err) => {
    console.error('CI scan failed:', err);
    process.exit(1);
  });
}
