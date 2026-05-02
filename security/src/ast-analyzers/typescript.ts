/**
 * TypeScript/JavaScript AST Analyzer
 *
 * Regex-based pattern matching for 15 security, quality, and
 * correctness rules covering TS/JS source.
 */

import { registerAnalyzer, type ASTAnalyzer, type ASTFinding } from './index';

class TypeScriptAnalyzer implements ASTAnalyzer {
  language = 'typescript';

  private rules = [
    {
      id: 'TS001',
      msg: 'Use === instead of == to avoid type coercion',
      sev: 'high' as const,
      test: (_s: string, lines: string[]) => this.matchLine(lines, /[^=!<>]==[^=]/),
    },
    {
      id: 'TS002',
      msg: 'Avoid `any` — use `unknown` for type safety',
      sev: 'medium' as const,
      test: (_s: string, lines: string[]) => this.matchLine(lines, /:\s*any\b/),
    },
    {
      id: 'TS003',
      msg: 'Console.log left in production code',
      sev: 'low' as const,
      test: (_s: string, lines: string[]) => this.matchLine(lines, /console\.(log|debug|info|warn)\b/),
    },
    {
      id: 'TS004',
      msg: 'Empty catch block suppresses all errors',
      sev: 'high' as const,
      test: (_s: string, lines: string[]) => this.matchLine(lines, /catch\s*\(\s*\w*\s*\)\s*\{\s*\}/),
    },
    {
      id: 'TS005',
      msg: 'eval() is a security risk',
      sev: 'critical' as const,
      test: (_s: string, lines: string[]) => this.matchLine(lines, /\beval\s*\(/),
    },
    {
      id: 'TS006',
      msg: 'innerHTML may enable XSS — use textContent',
      sev: 'high' as const,
      test: (_s: string, lines: string[]) => this.matchLine(lines, /\.innerHTML\s*=/),
    },
    {
      id: 'TS007',
      msg: 'setTimeout with string argument is like eval()',
      sev: 'high' as const,
      test: (_s: string, lines: string[]) => this.matchLine(lines, /setTimeout\s*\(\s*['"`]/),
    },
    {
      id: 'TS008',
      msg: 'Avoid var — use const or let',
      sev: 'low' as const,
      test: (_s: string, lines: string[]) => this.matchLine(lines, /\bvar\s+\w/),
    },
    {
      id: 'TS009',
      msg: 'Unused parameter detected (underscore-prefixed)',
      sev: 'low' as const,
      test: (_s: string, lines: string[]) => this.matchLine(lines, /\(\s*_\w+\s*[),]/),
    },
    {
      id: 'TS010',
      msg: 'Hardcoded credentials in code',
      sev: 'critical' as const,
      test: (_s: string, lines: string[]) =>
        this.matchLine(lines, /(password|secret|apiKey|token)\s*[:=]\s*['"`][^'"`]{8,}['"`]/i),
    },
    {
      id: 'TS011',
      msg: 'Missing error handling — await without .catch() or try/catch',
      sev: 'medium' as const,
      test: (source: string, _lines: string[]) => {
        const hasAwait = /\bawait\b/.test(source);
        const hasCatch = /\.catch\s*\(/.test(source);
        const hasTryCatch = /try\s*\{/.test(source);
        return hasAwait && !hasCatch && !hasTryCatch;
      },
    },
    {
      id: 'TS012',
      msg: 'JSON.parse without try/catch may crash',
      sev: 'medium' as const,
      test: (_s: string, lines: string[]) => this.matchLine(lines, /JSON\.parse/),
    },
    {
      id: 'TS013',
      msg: 'fs.readFileSync blocks event loop — use async',
      sev: 'medium' as const,
      test: (_s: string, lines: string[]) => this.matchLine(lines, /\.readFileSync\b/),
    },
    {
      id: 'TS014',
      msg: 'new Function() is like eval()',
      sev: 'critical' as const,
      test: (_s: string, lines: string[]) => this.matchLine(lines, /new\s+Function\s*\(/),
    },
    {
      id: 'TS015',
      msg: 'process.env accessed without fallback',
      sev: 'low' as const,
      test: (_s: string, lines: string[]) => this.matchLine(lines, /process\.env\.\w+(?!\s*\|\|)/),
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
      TS001: /[^=!<>]==[^=]/,
      TS002: /:\s*any\b/,
      TS003: /console\.(log|debug|info|warn)\b/,
      TS004: /catch\s*\(\s*\w*\s*\)\s*\{\s*\}/,
      TS005: /\beval\s*\(/,
      TS006: /\.innerHTML\s*=/,
      TS007: /setTimeout\s*\(\s*['"`]/,
      TS008: /\bvar\s+\w/,
      TS009: /\(\s*_\w+\s*[),]/,
      TS010: /(password|secret|apiKey|token)\s*[:=]\s*['"`][^'"`]{8,}['"`]/i,
      TS011: /\bawait\b/,
      TS012: /JSON\.parse/,
      TS013: /\.readFileSync\b/,
      TS014: /new\s+Function\s*\(/,
      TS015: /process\.env\.\w+(?!\s*\|\|)/,
    };

    const regex = patterns[ruleId];
    if (!regex) return 1;

    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) return i + 1;
    }
    return 1;
  }
}

registerAnalyzer(new TypeScriptAnalyzer());
