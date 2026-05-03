import type { ScoredFinding } from './confidence-scorer';

export type PolicyAction = 'auto-apply' | 'open-fix-pr' | 'suggest-inline' | 'block-merge' | 'inform-only';

export interface PolicyDecision {
  finding: ScoredFinding;
  action: PolicyAction;
  reason: string;
  requiresHumanApproval: boolean;
}

const DEFAULT_POLICY_TABLE: Array<{
  severity: string[];
  confidence: string[];
  source: string[];
  action: PolicyAction;
  requiresHumanApproval: boolean;
}> = [
  {
    severity: ['critical'],
    confidence: ['high', 'medium', 'low'],
    source: ['security'],
    action: 'block-merge',
    requiresHumanApproval: true,
  },
  {
    severity: ['high'],
    confidence: ['high'],
    source: ['lsp', 'security'],
    action: 'auto-apply',
    requiresHumanApproval: false,
  },
  {
    severity: ['high'],
    confidence: ['medium'],
    source: ['lsp', 'cross-file', 'coverage'],
    action: 'open-fix-pr',
    requiresHumanApproval: true,
  },
  {
    severity: ['medium'],
    confidence: ['high', 'medium'],
    source: ['lsp', 'security', 'coverage'],
    action: 'suggest-inline',
    requiresHumanApproval: false,
  },
  {
    severity: ['low', 'info'],
    confidence: ['high', 'medium', 'low'],
    source: ['history', 'cross-file'],
    action: 'inform-only',
    requiresHumanApproval: false,
  },
];

export class PolicyEngine {
  decide(findings: ScoredFinding[]): PolicyDecision[] {
    return findings.map(finding => {
      const rule = DEFAULT_POLICY_TABLE.find(r =>
        r.severity.includes(finding.severity) &&
        r.confidence.includes(finding.confidence) &&
        r.source.includes(finding.source),
      );

      if (!rule) {
        return {
          finding,
          action: 'suggest-inline',
          reason: 'No matching policy rule — defaulting to suggest',
          requiresHumanApproval: false,
        };
      }

      return {
        finding,
        action: rule.action,
        reason: `Policy: ${finding.severity} severity + ${finding.confidence} confidence from ${finding.source}`,
        requiresHumanApproval: rule.requiresHumanApproval,
      };
    });
  }

  shouldBlockMerge(decisions: PolicyDecision[]): boolean {
    return decisions.some(d => d.action === 'block-merge');
  }

  getAutoFixCandidates(decisions: PolicyDecision[]): PolicyDecision[] {
    return decisions.filter(d => d.action === 'auto-apply');
  }

  getFixPRCandidates(decisions: PolicyDecision[]): PolicyDecision[] {
    return decisions.filter(d => d.action === 'open-fix-pr');
  }
}
