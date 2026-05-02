'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils';
import { Play, AlertTriangle, Clock } from 'lucide-react';
import { ArtifactTabs } from '@/components/runtime/artifact-tabs';
import { TraceTimeline } from '@/components/runtime/trace-timeline';
import type { TraceStep } from '@/components/runtime/trace-timeline';
import { ScreenshotGrid } from '@/components/runtime/screenshot-grid';
import { NetworkTimeline } from '@/components/runtime/network-timeline';
import type { NetworkEntry } from '@/components/runtime/network-timeline';
import { InvariantFailurePanel } from '@/components/runtime/invariant-failure-panel';
import { ExpectedVsActualCard } from '@/components/runtime/expected-vs-actual-card';
import { LikelyRootCauseCard } from '@/components/runtime/likely-root-cause-card';

const MOCK_TRACE_STEPS: TraceStep[] = [
  {
    id: 'step-1',
    stepNumber: 1,
    action: 'Checkout branch',
    status: 'passed',
    timestamp: new Date(Date.now() - 600000).toISOString(),
    duration: 1200,
    attachedArtifacts: ['log'],
  },
  {
    id: 'step-2',
    stepNumber: 2,
    action: 'Lint & typecheck',
    status: 'passed',
    timestamp: new Date(Date.now() - 540000).toISOString(),
    duration: 8400,
    attachedArtifacts: ['log'],
  },
  {
    id: 'step-3',
    stepNumber: 3,
    action: 'Build container',
    status: 'passed',
    timestamp: new Date(Date.now() - 480000).toISOString(),
    duration: 15200,
    attachedArtifacts: ['log'],
  },
  {
    id: 'step-4',
    stepNumber: 4,
    action: 'Deploy to staging',
    status: 'passed',
    timestamp: new Date(Date.now() - 420000).toISOString(),
    duration: 8600,
    attachedArtifacts: ['log', 'network'],
  },
  {
    id: 'step-5',
    stepNumber: 5,
    action: 'Run E2E auth',
    status: 'passed',
    timestamp: new Date(Date.now() - 360000).toISOString(),
    duration: 12400,
    attachedArtifacts: ['screenshot', 'network', 'log'],
  },
  {
    id: 'step-6',
    stepNumber: 6,
    action: 'Run E2E checkout',
    status: 'failed',
    timestamp: new Date(Date.now() - 300000).toISOString(),
    duration: 9800,
    attachedArtifacts: ['screenshot', 'network', 'log'],
  },
  {
    id: 'step-7',
    stepNumber: 7,
    action: 'Run E2E dashboard',
    status: 'skipped',
    timestamp: new Date(Date.now() - 240000).toISOString(),
    duration: 0,
    attachedArtifacts: [],
  },
  {
    id: 'step-8',
    stepNumber: 8,
    action: 'Collect evidence',
    status: 'running',
    timestamp: new Date(Date.now() - 120000).toISOString(),
    duration: 3400,
    attachedArtifacts: ['log'],
  },
];

const MOCK_NETWORK_ENTRIES: NetworkEntry[] = [
  {
    id: 'net-1',
    method: 'GET',
    url: '/api/auth/session',
    status: 200,
    duration: 45,
    correlationId: 'corr_a1b2c3',
    failed: false,
  },
  {
    id: 'net-2',
    method: 'POST',
    url: '/api/auth/token/refresh',
    status: 200,
    duration: 120,
    correlationId: 'corr_d4e5f6',
    failed: false,
  },
  {
    id: 'net-3',
    method: 'GET',
    url: '/api/checkout/cart',
    status: 200,
    duration: 180,
    correlationId: 'corr_g7h8i9',
    failed: false,
  },
  {
    id: 'net-4',
    method: 'POST',
    url: '/api/checkout/submit',
    status: 500,
    duration: 2300,
    correlationId: 'corr_j0k1l2',
    failed: true,
  },
  {
    id: 'net-5',
    method: 'POST',
    url: '/api/checkout/validate',
    status: 422,
    duration: 85,
    correlationId: 'corr_m3n4o5',
    failed: true,
  },
  {
    id: 'net-6',
    method: 'GET',
    url: '/api/products/search',
    status: 200,
    duration: 340,
    correlationId: 'corr_p6q7r8',
    failed: false,
  },
  {
    id: 'net-7',
    method: 'PUT',
    url: '/api/customer/profile',
    status: 200,
    duration: 210,
    correlationId: 'corr_s9t0u1',
    failed: false,
  },
  {
    id: 'net-8',
    method: 'GET',
    url: '/api/dashboard/metrics',
    status: 200,
    duration: 1340,
    correlationId: 'corr_v2w3x4',
    failed: false,
  },
  {
    id: 'net-9',
    method: 'DELETE',
    url: '/api/cart/items/42',
    status: 403,
    duration: 65,
    correlationId: 'corr_y5z6a7',
    failed: true,
  },
];

export default function RuntimePage() {
  const [selectedStepId, setSelectedStepId] = useState('step-6');
  const [networkFilter, setNetworkFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState('trace');

  const selectedStep = MOCK_TRACE_STEPS.find((s) => s.id === selectedStepId);
  const isFailed = selectedStep?.status === 'failed';

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-fg-primary tracking-tight">
          Runtime Inspection
        </h1>
        <p className="text-xs text-fg-muted mt-0.5">
          PR #142 · codenexus/checkout-service · Session 3 of 5
        </p>
      </div>

      <ArtifactTabs
        traceAvailable={true}
        screenshotAvailable={true}
        logsAvailable={true}
        networkAvailable={true}
        reviewLinkAvailable={true}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      <div className="p-3 rounded-xl bg-surface border border-border-subtle">
        <div className="flex items-center justify-between mb-1 px-1">
          <span className="text-[11px] text-fg-muted uppercase tracking-wider">Execution Trace</span>
          <div className="flex items-center gap-3 text-[10px] text-fg-disabled">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-intent-success" /> Passed
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-intent-critical" /> Failed
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-intent-action animate-pulse" /> Running
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-fg-disabled" /> Skipped
            </span>
          </div>
        </div>
        <TraceTimeline
          steps={MOCK_TRACE_STEPS}
          selectedStepId={selectedStepId}
          onSelectStep={setSelectedStepId}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ScreenshotGrid
          primaryUrl="/screenshots/checkout-failure.png"
          secondaryUrl="/screenshots/checkout-before.png"
          stepLabel={
            selectedStep
              ? `Step ${selectedStep.stepNumber}: ${selectedStep.action}`
              : 'Select a step'
          }
          hasBeforeAfter={isFailed}
        />

        {isFailed && (
          <InvariantFailurePanel
            invariantName="checkout:payment-intent-status"
            expectedState="status: 'requires_capture', amount: 2999, currency: 'usd'"
            actualState="status: 'requires_payment_method', amount: 0, currency: null"
            failurePoint="submitOrderFlow.ts:247"
            affectedSubsystem="Payment Gateway Integration"
            linkedFindingId="FND-482"
            severity="critical"
          />
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="p-3 rounded-xl bg-surface border border-border-subtle">
          <h3 className="text-sm font-medium text-fg-primary mb-2">Network Requests</h3>
          <NetworkTimeline
            entries={MOCK_NETWORK_ENTRIES}
            filter={networkFilter as 'all' | 'failed' | 'auth' | 'mutation' | 'slow'}
            onFilterChange={setNetworkFilter}
          />
        </div>

        {isFailed && (
          <ExpectedVsActualCard
            invariantName="checkout:payment-intent-status"
            expected="Payment intent must have status 'requires_capture' with a valid amount and currency before order confirmation."
            actual="Payment intent was reset to 'requires_payment_method' with zero amount during checkout submission, indicating a race condition in the payment gateway callback."
          />
        )}
      </div>

      {isFailed && (
        <LikelyRootCauseCard
          causes={[
            'Race condition in PaymentIntent webhook handler causing state reset between confirmation and capture phases.',
            'Redis cache invalidation during checkout flow leads to stale payment intent being re-fetched from Stripe.',
            'Missing idempotency key on the /api/checkout/submit endpoint allows duplicate submissions to corrupt payment state.',
            'Retry logic in the payment gateway adapter does not preserve the original intent status on transient failures.',
          ]}
          confidence={87}
        />
      )}
    </div>
  );
}
