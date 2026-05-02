/**
 * Java AST Analyzer
 *
 * Regex-based pattern matching for 8 security, quality, and
 * correctness rules covering Java source.
 */

import { registerAnalyzer, type ASTAnalyzer, type ASTFinding } from './index';

class JavaAnalyzer implements ASTAnalyzer {
  language = 'java';

  private rules = [
    {
      id: 'JV001',
      msg: '== on Strings — use .equals() instead',
      sev: 'high' as const,
      test: (_s: string, lines: string[]) =>
        this.matchLine(lines, /String\b/) && this.matchLine(lines, /\b\w+\s*==\s*"/),
    },
    {
      id: 'JV002',
      msg: 'System.out.println left in production code',
      sev: 'low' as const,
      test: (_s: string, lines: string[]) => this.matchLine(lines, /System\.out\.print/),
    },
    {
      id: 'JV003',
      msg: 'Hardcoded credentials in code',
      sev: 'critical' as const,
      test: (_s: string, lines: string[]) =>
        this.matchLine(lines, /(password|secret|apiKey|token)\s*[:=]\s*"[^"]{8,}"/i),
    },
    {
      id: 'JV004',
      msg: 'Runtime.exec() may allow command injection',
      sev: 'high' as const,
      test: (_s: string, lines: string[]) => this.matchLine(lines, /Runtime\.getRuntime\(\)\.exec\s*\(/),
    },
    {
      id: 'JV005',
      msg: 'Empty catch block suppresses all errors',
      sev: 'high' as const,
      test: (_s: string, lines: string[]) => this.matchLine(lines, /catch\s*\([^)]*\)\s*\{\s*\}/),
    },
    {
      id: 'JV006',
      msg: 'Thread.sleep() in main thread — consider refactoring',
      sev: 'low' as const,
      test: (_s: string, lines: string[]) => this.matchLine(lines, /Thread\.sleep\s*\(/),
    },
    {
      id: 'JV007',
      msg: 'Raw type usage — specify generic type parameter',
      sev: 'medium' as const,
      test: (_s: string, lines: string[]) => this.matchLine(lines, /(List|Map|Set|ArrayList|HashMap|HashSet)\s+\w+\s*=/),
    },
    {
      id: 'JV008',
      msg: '@SuppressWarnings("unchecked") suppresses important warnings',
      sev: 'low' as const,
      test: (_s: string, lines: string[]) =>
        this.matchLine(lines, /@SuppressWarnings\s*\(\s*"unchecked"\s*\)/),
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
      JV001: /\b\w+\s*==\s*"/,
      JV002: /System\.out\.print/,
      JV003: /(password|secret|apiKey|token)\s*[:=]\s*"[^"]{8,}"/i,
      JV004: /Runtime\.getRuntime\(\)\.exec\s*\(/,
      JV005: /catch\s*\([^)]*\)\s*\{\s*\}/,
      JV006: /Thread\.sleep\s*\(/,
      JV007: /(List|Map|Set|ArrayList|HashMap|HashSet)\s+\w+\s*=/,
      JV008: /@SuppressWarnings\s*\(\s*"unchecked"\s*\)/,
    };

    const regex = patterns[ruleId];
    if (!regex) return 1;

    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) return i + 1;
    }
    return 1;
  }
}

registerAnalyzer(new JavaAnalyzer());
