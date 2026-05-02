/**
 * Python AST Analyzer
 *
 * Regex-based pattern matching for 12 security, quality, and
 * correctness rules covering Python source.
 */

import { registerAnalyzer, type ASTAnalyzer, type ASTFinding } from './index';

class PythonAnalyzer implements ASTAnalyzer {
  language = 'python';

  private rules = [
    {
      id: 'PY001',
      msg: 'except: pass suppresses all errors silently',
      sev: 'high' as const,
      test: (_s: string, lines: string[]) => this.matchLine(lines, /except\s*:\s*$/),
    },
    {
      id: 'PY002',
      msg: 'Bare except: clause catches too broadly',
      sev: 'medium' as const,
      test: (_s: string, lines: string[]) => this.matchLine(lines, /except\s*:/),
    },
    {
      id: 'PY003',
      msg: 'eval() is a security risk',
      sev: 'critical' as const,
      test: (_s: string, lines: string[]) => this.matchLine(lines, /\beval\s*\(/),
    },
    {
      id: 'PY004',
      msg: 'Hardcoded credentials in code',
      sev: 'critical' as const,
      test: (_s: string, lines: string[]) =>
        this.matchLine(lines, /(password|secret|api_key|token)\s*[:=]\s*['"`][^'"`]{8,}['"`]/i),
    },
    {
      id: 'PY005',
      msg: 'subprocess with shell=True is dangerous',
      sev: 'high' as const,
      test: (_s: string, lines: string[]) => this.matchLine(lines, /shell\s*=\s*True/),
    },
    {
      id: 'PY006',
      msg: 'os.system() allows command injection',
      sev: 'high' as const,
      test: (_s: string, lines: string[]) => this.matchLine(lines, /os\.system\s*\(/),
    },
    {
      id: 'PY007',
      msg: 'pickle.loads() on untrusted data is unsafe',
      sev: 'high' as const,
      test: (_s: string, lines: string[]) => this.matchLine(lines, /pickle\.(load|loads)\s*\(/),
    },
    {
      id: 'PY008',
      msg: 'yaml.load() without SafeLoader may be unsafe',
      sev: 'medium' as const,
      test: (_s: string, lines: string[]) => this.matchLine(lines, /yaml\.load\s*\(/),
    },
    {
      id: 'PY009',
      msg: 'assert should not be used in production code',
      sev: 'low' as const,
      test: (_s: string, lines: string[]) => this.matchLine(lines, /\bassert\b/),
    },
    {
      id: 'PY010',
      msg: 'Mutable default argument can cause bugs',
      sev: 'medium' as const,
      test: (_s: string, lines: string[]) =>
        this.matchLine(lines, /def\s+\w+\s*\([^)]*=\s*\{\s*\}\s*\)/),
    },
    {
      id: 'PY011',
      msg: 'print() left in production code',
      sev: 'low' as const,
      test: (_s: string, lines: string[]) => this.matchLine(lines, /print\s*\(/),
    },
    {
      id: 'PY012',
      msg: 'input() in Python 2 style may evaluate arbitrary code',
      sev: 'medium' as const,
      test: (_s: string, lines: string[]) =>
        this.matchLine(lines, /(input\s*\(|raw_input\s*\()/) && !this.matchLine(lines, /import\s+sys/),
    },
  ];

  analyze(sourceCode: string, filePath: string): ASTFinding[] {
    const lines = sourceCode.split('\n');
    return this.rules
      .filter((rule) => rule.test(sourceCode, lines))
      .map((rule) => {
        const lineIdx = this.findLine(lines, rule.id);
        return {
          ruleId: rule.id,
          message: rule.msg,
          severity: rule.sev,
          path: filePath,
          line: lineIdx,
        };
      });
  }

  private matchLine(lines: string[], regex: RegExp): boolean {
    for (const line of lines) {
      if (regex.test(line)) return true;
    }
    return false;
  }

  private findLine(lines: string[], ruleId: string): number {
    const patterns: Record<string, RegExp> = {
      PY001: /except\s*:\s*$/,
      PY002: /except\s*:/,
      PY003: /\beval\s*\(/,
      PY004: /(password|secret|api_key|token)\s*[:=]\s*['"`][^'"`]{8,}['"`]/i,
      PY005: /shell\s*=\s*True/,
      PY006: /os\.system\s*\(/,
      PY007: /pickle\.(load|loads)\s*\(/,
      PY008: /yaml\.load\s*\(/,
      PY009: /\bassert\b/,
      PY010: /def\s+\w+\s*\([^)]*=\s*\{\s*\}\s*\)/,
      PY011: /print\s*\(/,
      PY012: /(input\s*\(|raw_input\s*\()/,
    };

    const regex = patterns[ruleId];
    if (!regex) return 1;

    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) return i + 1;
    }
    return 1;
  }
}

registerAnalyzer(new PythonAnalyzer());
