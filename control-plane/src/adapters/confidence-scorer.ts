import type { SecurityAlert, Severity } from '../../../shared/src/types';
import type { SymbolImpact } from './lsp-adapter';
import type { CrossFileImpact } from './impact-analyzer';
import type { FileHistory } from './history-analyzer';

export type ConfidenceLevel = 'high' | 'medium' | 'low';
export type SeverityLevel = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface ScoredFinding {
  id: string;
  title: string;
  body: string;
  severity: SeverityLevel;
  confidence: ConfidenceLevel;
  filePath?: string;
  line?: number;
  action: 'block-merge' | 'auto-fix' | 'suggest' | 'inform';
  source: 'security' | 'lsp' | 'cross-file' | 'coverage' | 'history';
}

export function scoreFindings(input: {
  securityAlerts: SecurityAlert[];
  symbolImpacts: SymbolImpact[];
  crossFileImpacts: CrossFileImpact[];
  fileHistories?: FileHistory[];
  coverageDelta?: number;
}): ScoredFinding[] {
  const findings: ScoredFinding[] = [];

  for (const alert of input.securityAlerts) {
    const detailPath = alert.details?.path as string | undefined;
    const detailLine = alert.details?.lineNumber as number | undefined
      ?? alert.details?.line as number | undefined;
    const detailSource = alert.details?.source as string | undefined;

    findings.push({
      id: `sec-${alert.id}`,
      title: alert.description,
      body: alert.description,
      severity: alert.severity as SeverityLevel,
      confidence: detailSource === 'semgrep' ? 'high' : 'medium',
      filePath: detailPath,
      line: detailLine,
      action: alert.severity === ('critical' as Severity) ? 'block-merge' : 'suggest',
      source: 'security',
    });
  }

  for (const impact of input.symbolImpacts) {
    for (const typeError of impact.typeErrors) {
      findings.push({
        id: `lsp-${typeError.file}-${typeError.line}`,
        title: `Type error in ${impact.changedSymbol}`,
        body: typeError.message,
        severity: 'high',
        confidence: 'high',
        filePath: typeError.file,
        line: typeError.line,
        action: 'auto-fix',
        source: 'lsp',
      });
    }
  }

  for (const impact of input.crossFileImpacts) {
    findings.push({
      id: `xfile-${impact.changedFile}-${impact.changedExport}`,
      title: `Breaking change risk: ${impact.changedExport}`,
      body: impact.reason,
      severity: impact.breakageRisk === 'high' ? 'high' : 'medium',
      confidence: 'medium',
      filePath: impact.changedFile,
      action: impact.breakageRisk === 'high' ? 'block-merge' : 'suggest',
      source: 'cross-file',
    });
  }

  if (input.fileHistories) {
    for (const history of input.fileHistories) {
      if (history.churnSignal === 'high') {
        findings.push({
          id: `hist-${history.filePath}`,
          title: `High churn file: ${history.filePath}`,
          body: `${history.commitCount30d} commits in 30 days by ${history.uniqueAuthors.length} author(s)${history.lastBugFixDate ? `, last fix: ${history.lastBugFixDate}` : ''}. Recent: ${history.recentMessages.slice(0, 3).join('; ')}`,
          severity: 'medium',
          confidence: 'medium',
          filePath: history.filePath,
          action: 'inform',
          source: 'history',
        });
      }
      if (history.lastBugFixDate) {
        findings.push({
          id: `hist-bug-${history.filePath}`,
          title: `Recent bug fix activity in ${history.filePath}`,
          body: `Last bug fix: ${history.lastBugFixDate}. Recent messages: ${history.recentMessages.slice(0, 3).join('; ')}`,
          severity: 'low',
          confidence: 'medium',
          filePath: history.filePath,
          action: 'inform',
          source: 'history',
        });
      }
    }
  }

  if (input.coverageDelta !== undefined && input.coverageDelta < -5) {
    findings.push({
      id: 'coverage-drop',
      title: `Coverage dropped ${Math.abs(input.coverageDelta).toFixed(1)}%`,
      body: 'This PR reduces test coverage by more than 5%. Consider adding tests.',
      severity: input.coverageDelta < -10 ? 'high' : 'medium',
      confidence: 'high',
      action: input.coverageDelta < -10 ? 'block-merge' : 'suggest',
      source: 'coverage',
    });
  }

  return findings.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

function severityRank(s: SeverityLevel): number {
  return { critical: 5, high: 4, medium: 3, low: 2, info: 1 }[s] ?? 0;
}
