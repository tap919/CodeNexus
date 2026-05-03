import type { DesignAudit } from '../../../shared/src/types';
import type { ModuleAdapters } from '../orchestrator';
import { DesignReviewer } from '@codenexus/design-reviewer';

const reviewer = new DesignReviewer();

function mapLanguage(language: string): 'html' | 'css' | 'both' {
  if (language === 'css' || language === 'scss' || language === 'less') return 'css';
  if (language === 'html' || language === 'markdown') return 'html';
  return 'html';
}

export function createDefaultDesignReviewer(): ModuleAdapters['designReviewer'] {
  return {
    async auditCode(code: string, language: string): Promise<DesignAudit> {
      const format = mapLanguage(language);
      const result = reviewer.audit(code, format);

      return {
        url: '',
        timestamp: new Date().toISOString(),
        antiPatterns: result.antiPatterns?.map(ap => ({
          name: ap.name,
          severity: ap.severity,
          element: ap.element,
          description: ap.description,
          fix: ap.fix,
          lineNumber: ap.lineNumber,
        })) ?? [],
        score: result.score ?? 100,
        recommendations: result.recommendations ?? [],
      };
    },
  };
}
