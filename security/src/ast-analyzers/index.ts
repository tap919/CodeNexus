/**
 * CodeNexus AST Analyzer Registry
 *
 * Language-agnostic AST analysis framework. Individual analyzers
 * register themselves via `registerAnalyzer()` and the registry
 * dispatches source files based on file extension.
 */

export interface ASTFinding {
  ruleId: string;
  message: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  path: string;
  line: number;
  column?: number;
}

export interface ASTAnalyzer {
  language: string;
  analyze(sourceCode: string, filePath: string): ASTFinding[];
}

const analyzers = new Map<string, ASTAnalyzer>();

export function registerAnalyzer(analyzer: ASTAnalyzer): void {
  analyzers.set(analyzer.language, analyzer);
}

export function analyzeFile(filePath: string, content: string): ASTFinding[] {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'typescript',
    jsx: 'typescript',
    py: 'python',
    java: 'java',
    go: 'golang',
    rs: 'rust',
  };
  const language = langMap[ext];
  const analyzer = language ? analyzers.get(language) : null;
  return analyzer?.analyze(content, filePath) || [];
}

export function getSupportedLanguages(): string[] {
  return [...analyzers.keys()];
}
