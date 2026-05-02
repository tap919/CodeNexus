'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Shield, Filter } from 'lucide-react';

import { GovernanceSummaryStrip } from '@/components/governance/governance-summary-strip';
import { PolicyStatusGrid } from '@/components/governance/policy-status-grid';
import type { PolicyStatus } from '@/components/governance/policy-status-grid';
import { WorkflowPermissionTable } from '@/components/governance/workflow-permission-table';
import type { WorkflowPerm } from '@/components/governance/workflow-permission-table';
import { ReviewerCoverageTable } from '@/components/governance/reviewer-coverage-table';
import type { ReviewerCoverage } from '@/components/governance/reviewer-coverage-table';
import { SensitivePathsPanel } from '@/components/governance/sensitive-paths-panel';
import type { SensitivePath } from '@/components/governance/sensitive-paths-panel';
import { ComplianceTimeline } from '@/components/governance/compliance-timeline';
import type { ComplianceEvent } from '@/components/governance/compliance-timeline';
import { TopRisksCard } from '@/components/governance/top-risks-card';
import type { TopRisk } from '@/components/governance/top-risks-card';
import { PolicyDriftCard } from '@/components/governance/policy-drift-card';

const REPOS = ['All Repos', 'CodeNexus/backend', 'CodeNexus/frontend', 'CodeNexus/infra', 'CodeNexus/shared'];
const SEVERITIES = ['All', 'Critical', 'High'];

const mockPolicies: PolicyStatus[] = [
  {
    id: '1',
    name: 'Branch Protection',
    description: 'Require status checks, up-to-date branches, and minimum reviewer count before merging.',
    status: 'compliant',
    lastChecked: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    details: 'All 12 protected branches enforce required checks and minimum 1 reviewer.',
  },
  {
    id: '2',
    name: 'Required Reviews',
    description: 'Mandatory pull request reviews with minimum approvals before merge.',
    status: 'partial',
    lastChecked: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    details: '8 of 12 repositories require reviews. 4 repos (shared libs) need CODEOWNERS review rules.',
  },
  {
    id: '3',
    name: 'CODEOWNERS',
    description: 'Code ownership rules ensuring qualified reviewers for sensitive paths.',
    status: 'partial',
    lastChecked: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    details: 'Auth and config paths have owners. 3 new service directories lack CODEOWNERS entries.',
  },
  {
    id: '4',
    name: 'Token Permissions',
    description: 'GitHub Actions workflow tokens scoped to minimum required permissions.',
    status: 'noncompliant',
    lastChecked: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    details: '2 workflows use write-all token scope. Must be restricted to contents: read.',
  },
  {
    id: '5',
    name: 'Secret Scanning',
    description: 'Push protection and secret scanning alerts across all repositories.',
    status: 'compliant',
    lastChecked: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
    details: 'Secret scanning enabled on all repos. 0 active alerts, 2 dismissed false positives.',
  },
  {
    id: '6',
    name: 'Merge Blockers',
    description: 'Required checks that must pass before merging pull requests.',
    status: 'partial',
    lastChecked: new Date(Date.now() - 50 * 60 * 1000).toISOString(),
    details: 'Build, lint, and test checks required. Type check only enforced on 4 of 6 repos.',
  },
];

const mockWorkflows: WorkflowPerm[] = [
  {
    workflow: 'CI / Build & Test',
    fileName: '.github/workflows/ci.yml',
    tokenScope: 'contents: read',
    untrustedInput: false,
    pinnedActions: true,
    severity: 'low',
    status: 'pass',
  },
  {
    workflow: 'Deploy / Production',
    fileName: '.github/workflows/deploy.yml',
    tokenScope: 'write-all',
    untrustedInput: true,
    pinnedActions: false,
    severity: 'critical',
    status: 'fail',
  },
  {
    workflow: 'Release / Publish',
    fileName: '.github/workflows/release.yml',
    tokenScope: 'contents: write, packages: write',
    untrustedInput: false,
    pinnedActions: true,
    severity: 'medium',
    status: 'warn',
  },
  {
    workflow: 'Security / Scan',
    fileName: '.github/workflows/security.yml',
    tokenScope: 'contents: read',
    untrustedInput: false,
    pinnedActions: true,
    severity: 'low',
    status: 'pass',
  },
  {
    workflow: 'PR / Labeler',
    fileName: '.github/workflows/pr-labeler.yml',
    tokenScope: 'pull-requests: write',
    untrustedInput: true,
    pinnedActions: false,
    severity: 'high',
    status: 'fail',
  },
  {
    workflow: 'Staging / Deploy',
    fileName: '.github/workflows/staging-deploy.yml',
    tokenScope: 'write-all',
    untrustedInput: true,
    pinnedActions: false,
    severity: 'critical',
    status: 'fail',
  },
];

const mockReviewerCoverage: ReviewerCoverage[] = [
  {
    path: 'src/auth/**',
    requiredOwner: '@security-team',
    assignedReviewers: ['@alice', '@bob'],
    coverageStatus: 'covered',
    lastReviewed: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  },
  {
    path: 'src/config/secrets.ts',
    requiredOwner: '@security-team',
    assignedReviewers: ['@security-team'],
    coverageStatus: 'covered',
    lastReviewed: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
  },
  {
    path: 'src/api/routes/**',
    requiredOwner: '@backend-leads',
    assignedReviewers: ['@charlie'],
    coverageStatus: 'partial',
    lastReviewed: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
  },
  {
    path: 'src/shared/utils.ts',
    requiredOwner: '@core-team',
    assignedReviewers: [],
    coverageStatus: 'uncovered',
    lastReviewed: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
  },
  {
    path: 'src/infra/terraform/**',
    requiredOwner: '@infra-team',
    assignedReviewers: ['@dave', '@eve'],
    coverageStatus: 'covered',
    lastReviewed: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
  },
  {
    path: 'src/security/policies.ts',
    requiredOwner: '@security-team',
    assignedReviewers: ['@security-team', '@cto'],
    coverageStatus: 'covered',
    lastReviewed: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
  },
];

const mockSensitivePaths: SensitivePath[] = [
  {
    path: '.github/workflows/deploy.yml',
    risk: 'critical',
    unmetControls: ['Token scope is write-all', 'Untrusted input from PR body', 'No pinned action SHAs'],
  },
  {
    path: 'src/config/production-secrets.ts',
    risk: 'critical',
    unmetControls: ['No codeowner assigned', 'Last reviewed > 30 days ago'],
  },
  {
    path: '.github/workflows/pr-labeler.yml',
    risk: 'high',
    unmetControls: ['Uses untrusted PR labels', 'Missing action pinning'],
  },
];

const mockTopRisks: TopRisk[] = [
  { id: '1', title: 'Write-all token scope in production workflows', severity: 'critical', count: 2 },
  { id: '2', title: 'Untrusted input handling in CI workflows', severity: 'critical', count: 3 },
  { id: '3', title: 'Missing CODEOWNERS for new services', severity: 'high', count: 3 },
  { id: '4', title: 'Unpinned Actions in GitHub workflows', severity: 'high', count: 4 },
  { id: '5', title: 'Type check not enforced on all repos', severity: 'medium', count: 2 },
];

const mockTimelineEvents: ComplianceEvent[] = [
  {
    id: '1',
    date: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    event: 'Branch protection audit passed',
    type: 'audit',
    details: 'All 12 protected branches verified compliant. No configuration drift detected.',
  },
  {
    id: '2',
    date: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    event: 'Deploy workflow token scope widened',
    type: 'policy_change',
    details: 'Production deploy workflow changed from contents:read to write-all. Triggers noncompliance.',
  },
  {
    id: '3',
    date: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
    event: 'New service directory created without CODEOWNERS',
    type: 'regression',
    details: 'Three new service paths added to src/services/ without corresponding CODEOWNERS entries.',
  },
  {
    id: '4',
    date: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
    event: 'Fixed unpinned actions in CI workflow',
    type: 'fix',
    details: 'All actions in ci.yml pinned to commit SHAs. Dependency review workflow now compliant.',
  },
  {
    id: '5',
    date: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
    event: 'Secret scanning enabled on all repos',
    type: 'fix',
    details: 'Push protection and secret scanning alerts configured across all 6 repositories.',
  },
  {
    id: '6',
    date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    event: 'Quarterly governance audit completed',
    type: 'audit',
    details: 'Full policy review: 4 compliant, 2 partial, 0 noncompliant at audit time. Report filed.',
  },
];

export default function GovernancePage() {
  const [selectedRepo, setSelectedRepo] = useState('All Repos');
  const [selectedSeverity, setSelectedSeverity] = useState('All');

  const protectedTotal = 12;
  const protectedCompliant = 12;
  const dangerousWorkflows = 3;
  const missingReviewers = 1;
  const failingChecks = 2;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-fg-primary tracking-tight">Governance Console</h1>
          <p className="text-xs text-fg-muted mt-1">
            Branch protection, workflow safety, and policy compliance.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-fg-muted" />
            <select
              value={selectedRepo}
              onChange={(e) => setSelectedRepo(e.target.value)}
              className="text-[11px] bg-surface border border-border-subtle rounded-lg px-2.5 py-1.5 text-fg-primary focus:outline-none focus:border-intent-action"
            >
              {REPOS.map((repo) => (
                <option key={repo} value={repo}>
                  {repo}
                </option>
              ))}
            </select>
            <select
              value={selectedSeverity}
              onChange={(e) => setSelectedSeverity(e.target.value)}
              className="text-[11px] bg-surface border border-border-subtle rounded-lg px-2.5 py-1.5 text-fg-primary focus:outline-none focus:border-intent-action"
            >
              {SEVERITIES.map((sev) => (
                <option key={sev} value={sev}>
                  {sev}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <GovernanceSummaryStrip
          protectedBranchesCompliant={protectedCompliant}
          totalProtectedBranches={protectedTotal}
          dangerousWorkflows={dangerousWorkflows}
          missingReviewers={missingReviewers}
          failingChecks={failingChecks}
          stalePolicies={2}
        />

        <PolicyStatusGrid policies={mockPolicies} />

        <div className="grid grid-cols-[1fr_280px] gap-4">
          <WorkflowPermissionTable workflows={mockWorkflows} />
          <TopRisksCard risks={mockTopRisks} />
        </div>

        <ReviewerCoverageTable paths={mockReviewerCoverage} />

        <div className="grid grid-cols-2 gap-4">
          <SensitivePathsPanel paths={mockSensitivePaths} />
          <PolicyDriftCard
            driftDetected={true}
            lastStableDate={new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()}
            changesSinceStable={5}
            affectedPolicies={[
              'Deploy workflow token scope',
              'New service CODEOWNERS',
              'PR labeler untrusted input',
              'Staging workflow write-all',
            ]}
          />
        </div>

        <ComplianceTimeline events={mockTimelineEvents} />
      </div>
    </div>
  );
}
