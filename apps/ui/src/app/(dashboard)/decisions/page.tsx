'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { BuildImpactPanel } from '@/components/decisions/build-impact-panel';
import { BlastRadiusCard } from '@/components/decisions/blast-radius-card';
import { DecisionOptionsCard } from '@/components/decisions/decision-options-card';
import { DecisionLog } from '@/components/decisions/decision-log';
import { WhatThisMeansCard } from '@/components/decisions/what-this-means-card';

const MOCK_IMPACT = {
  findingId: 'FN-2026-0472',
  technicalSummary:
    'Static analysis detected a missing JWT signature verification in the auth-service token refresh flow. The `verifyToken()` call at `auth/service.ts:142` bypasses signature check when `skipVerification` flag is set, which occurs during token refresh under certain race conditions. This creates a window where forged tokens with valid-looking payloads can be accepted.',
  laymanSummary:
    'Your authentication service has a timing bug that could let attackers forge login tokens. During token refresh, the signature check is skipped, which means someone could craft a fake token and gain access to any user account.',
  impactPercentages: {
    buildStability: 34,
    securityPosture: 91,
    userTrust: 82,
    operationalOverhead: 45,
  },
  severity: 'critical' as const,
  recommendedAction: 'Immediately apply the JWT verification fix and backport to all active release branches. Engage security team for post-fix audit.',
};

const MOCK_BLAST_RADIUS = {
  affectedServices: ['auth-service', 'api-gateway', 'session-manager', 'user-provisioning'],
  affectedUserJourneys: ['Login', 'Token Refresh', 'SSO Federation', 'Password Reset'],
  downstreamFailurePath: 'JWT Verify Skip → Token Forgery → Unauthorized Access → Data Exfiltration → Compliance Violation',
  trustBoundaryCrossed: true,
};

const MOCK_OPTIONS = [
  {
    action: 'approve_fix' as const,
    label: 'Approve Immediate Fix',
    consequence: 'The fix will be applied and backported to all active release branches. Security audit will be triggered post-deployment.',
    requiredFollowUp: 'Security team review within 24 hours',
    riskReduction: 95,
    requiresEvidence: false,
  },
  {
    action: 'approve_ticket' as const,
    label: 'Create Prioritized Ticket',
    consequence: 'A high-priority ticket is created for the next sprint. The issue remains unresolved until the ticket is picked up.',
    requiredFollowUp: 'Ticket grooming and sprint assignment',
    riskReduction: 50,
    requiresEvidence: true,
  },
  {
    action: 'escalate' as const,
    label: 'Escalate to Security Team',
    consequence: 'The finding is escalated to the security engineering team for manual triage and remediation planning.',
    requiredFollowUp: 'Security team acknowledgment within 4 hours',
    riskReduction: 75,
    requiresEvidence: true,
  },
  {
    action: 'reject' as const,
    label: 'Reject as False Positive',
    consequence: 'The finding is dismissed. No remediation action will be taken. Policy override is required.',
    requiredFollowUp: 'Documented justification and policy override approval',
    riskReduction: 0,
    requiresEvidence: true,
  },
];

const MOCK_DECISION_LOG = [
  {
    id: 'DL-001',
    action: 'escalate',
    reviewer: 'Sarah Chen',
    timestamp: new Date(Date.now() - 3600000).toISOString(),
    comment: 'Escalating to security team due to trust boundary crossing. Auth service needs immediate attention.',
    evidenceAttached: true,
    policyOverridden: false,
  },
  {
    id: 'DL-002',
    action: 'approve_ticket',
    reviewer: 'Marcus Webb',
    timestamp: new Date(Date.now() - 86400000).toISOString(),
    comment: 'Created ticket SEC-2841 for the JWT verification fix. Marked as P0.',
    evidenceAttached: false,
    policyOverridden: false,
  },
  {
    id: 'DL-003',
    action: 'reject',
    reviewer: 'David Kim',
    timestamp: new Date(Date.now() - 172800000).toISOString(),
    comment: 'Initial auto-finding was flagged as false positive. Manual review confirms this is a real vulnerability.',
    evidenceAttached: true,
    policyOverridden: true,
  },
];

const MOCK_WHAT_THIS_MEANS = {
  laymanSummary:
    'An attacker could exploit a timing window during token refresh to bypass your authentication system entirely. This affects every user who can trigger a token refresh.',
  technicalDetail:
    'The `TokenRefresher.refresh()` method in `auth/service.ts` sets `skipVerification: true` when the previous verification attempt fails with a network error. However, it does not clear this flag before retrying, causing all subsequent verification attempts to be silently skipped. An attacker can trigger this path by sending a malformed token that causes a parse failure followed by a retry.',
  blastRadiusSummary:
    'This vulnerability affects 4 services across the authentication pipeline. The blast radius extends to all user sessions that rely on JWT-based authentication, including SSO federation and password reset flows.',
  confidenceScore: 87,
};

export default function DecisionsPage() {
  const [selectedAction, setSelectedAction] = useState<string | undefined>();
  const hasPending = true;

  if (!hasPending) {
    return (
      <div className="max-w-5xl mx-auto">
        <h1 className="text-lg font-semibold text-fg-primary tracking-tight">Decision Center</h1>
        <p className="text-xs text-fg-muted mt-1">Make human-in-the-loop choices with blast radius context.</p>
        <div className="mt-8 p-8 rounded-xl bg-surface border border-border-subtle text-center">
          <AlertTriangle className="w-8 h-8 text-fg-disabled mx-auto mb-3" />
          <p className="text-sm text-fg-muted">No pending decisions. Escalate findings from review to create decision tasks.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-fg-primary tracking-tight">Decision Center</h1>
        <p className="text-xs text-fg-muted mt-1">Make human-in-the-loop choices with blast radius context.</p>
      </div>

      <BuildImpactPanel {...MOCK_IMPACT} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BlastRadiusCard {...MOCK_BLAST_RADIUS} />
        <WhatThisMeansCard {...MOCK_WHAT_THIS_MEANS} />
      </div>

      <DecisionOptionsCard
        options={MOCK_OPTIONS}
        onSelect={setSelectedAction}
        selectedAction={selectedAction}
      />

      <DecisionLog entries={MOCK_DECISION_LOG} />
    </div>
  );
}
