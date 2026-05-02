'use client';

import { useState } from 'react';
import { KnowledgeSearchBar } from '@/components/knowledge/knowledge-search-bar';
import { TrustFilterCard } from '@/components/knowledge/trust-filter-card';
import { EvidenceGroupList } from '@/components/knowledge/evidence-group-list';
import { CitationPreviewPanel } from '@/components/knowledge/citation-preview-panel';
import { RelatedIncidentsPanel } from '@/components/knowledge/related-incidents-panel';
import { SourceTierLegend } from '@/components/knowledge/source-tier-legend';
import type { EvidenceResult, EvidenceGroup } from '@/components/knowledge/evidence-group-list';

const MOCK_RESULTS: EvidenceResult[] = [
  {
    id: 'ev-1',
    title: 'JWT Expiration Handling in Auth Middleware',
    source: 'internal-auth-spec.md',
    trustTier: 'internal',
    whyMatched: 'Reference implementation for token refresh during auth-service initialization',
    citation: 'auth-service/docs/architecture.md § 4.2.3',
    freshness: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    snippet: `export function createAuthMiddleware(options: AuthOptions) {\n  return async (req: Request) => {\n    const token = extractBearerToken(req);\n    if (!token) return unauthorized();\n    /* Token refresh: must handle expiration within grace period */\n    const decoded = await verifyAndRefresh(token, options.jwtSecret);\n    if (!decoded) return unauthorized();\n    req.auth = decoded;\n  };\n}`,
  },
  {
    id: 'ev-2',
    title: 'RFC 7519 - JSON Web Token Best Current Practices',
    source: 'ietf-rfc7519.txt',
    trustTier: 'standard',
    whyMatched: 'Defines JWT claim validation order and clock skew tolerance',
    citation: 'RFC 7519 § 4.1.4 exp claim processing',
    freshness: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    snippet: `4.1.4. "exp" (Expiration Time) Claim\n   The "exp" (expiration time) claim identifies the expiration time on\n   or after which the JWT MUST NOT be accepted for processing. The\n   processing of the "exp" claim requires that the current date/time\n   MUST be before the expiration date/time listed in the "exp" claim.\n   Implementers MAY provide for some small leeway, usually no more than\n   a few minutes, to account for clock skew.`,
    supportedFinding: 'Clock skew tolerance should be configured per RFC guidance',
  },
  {
    id: 'ev-3',
    title: 'Auth0 JWT Best Practices - Token Refresh Patterns',
    source: 'auth0-docs',
    trustTier: 'vendor',
    whyMatched: 'Vendor-recommended pattern for silent token refresh in SPAs',
    citation: 'auth0.com/docs/secure/tokens/refresh-tokens',
    freshness: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    snippet: `Silent authentication lets you get new access tokens without\nredirecting the user. Use checkSession() or getAccessTokenSilently()\nto request tokens behind the scenes. If the refresh fails (e.g., the\nsession expired), catch the error and redirect to login.`,
  },
  {
    id: 'ev-4',
    title: 'JWT Secret Rotation Causes Mass Logout',
    source: 'incident-2024-03-17',
    trustTier: 'internal',
    whyMatched: 'Same auth-service; prior incident caused by missing grace period during key rotation',
    citation: 'Incident Report #INC-2024-0317',
    freshness: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    snippet: `Root cause: Rolling JWT signing key without overlap period\ninvalidated all existing sessions. Impact: 12,400 users logged out\nwithin a 3-minute window. Resolution: Implemented key rotation with\n30-minute grace period where both old and new keys accept tokens.`,
    supportedFinding: 'Key rotation without grace period is the root cause of this incident',
  },
  {
    id: 'ev-5',
    title: 'Community Discussion: JWT Expiry - Short vs Long',
    source: 'stackoverflow/q/40281012',
    trustTier: 'community',
    whyMatched: 'Discussion on trade-offs between security and UX for JWT expiry times',
    citation: 'StackOverflow #40281012',
    freshness: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString(),
    snippet: `Short-lived tokens (5-15 min) are more secure but require refresh\nmechanisms. Long-lived tokens (days) are convenient but increase\nrisk if stolen. The industry consensus is short-lived access tokens\nwith longer-lived refresh tokens stored securely in httpOnly cookies.`,
  },
  {
    id: 'ev-6',
    title: 'OWASP JWT Cheat Sheet - Expiration Validation',
    source: 'owasp-cheatsheets',
    trustTier: 'standard',
    whyMatched: 'Security guidelines contradict current auth-service implementation',
    citation: 'OWASP JWT Cheat Sheet § Token Expiration',
    freshness: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
    snippet: `Always validate the expiration time (exp claim). Reject tokens\nthat are past their expiration. Do not use clock skew values larger\nthan 30-60 seconds. Failing to validate expiration is a critical\nvulnerability (OWASP Top 10 A01:2021 - Broken Access Control).`,
  },
  {
    id: 'ev-7',
    title: 'Incident: auth-service JWT Validation Failure During DST',
    source: 'incident-2024-10-27',
    trustTier: 'internal',
    whyMatched: 'Similar clock-skew issue caused auth failures during daylight saving transition',
    citation: 'Incident Report #INC-2024-1027',
    freshness: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(),
    snippet: `During DST switch, auth-service rejected all tokens due to a 1-hour\nclock skew in the expiration check. The system compared UTC server\ntime against token expiry that was computed with local time.\nResolution: All time comparisons now use UTC exclusively.`,
  },
  {
    id: 'ev-8',
    title: 'Next.js Auth Helper - JWT Middleware Setup',
    source: 'next-auth-docs',
    trustTier: 'vendor',
    whyMatched: 'Next.js middleware pattern for JWT validation in server components',
    citation: 'next-auth.js.org/configuration/nextjs#middleware',
    freshness: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    snippet: `import { getToken } from "next-auth/jwt";\nexport async function middleware(req: NextRequest) {\n  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });\n  if (!token) return NextResponse.redirect(new URL('/login', req.url));\n}`,
  },
  {
    id: 'ev-9',
    title: 'Reddit Discussion: JWT in Microservices - Pain Points',
    source: 'reddit/r/node',
    trustTier: 'community',
    whyMatched: 'Community reports of token sync issues across distributed services',
    citation: 'reddit.com/r/node/comments/jwt_microservices',
    freshness: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    snippet: `We had a nightmare with JWT across 12 microservices. The main issue\nwas inconsistent clock sync between containers. Tokens would expire\non service B while still valid on service A. Solved by centralizing\ntoken issuance and adding NTP sync to all containers.`,
  },
];

const MOCK_GROUPS: EvidenceGroup[] = [
  {
    group: 'supports',
    label: 'Supports Finding',
    results: [MOCK_RESULTS[0], MOCK_RESULTS[1], MOCK_RESULTS[3]],
  },
  {
    group: 'contradicts',
    label: 'Contradicts',
    results: [MOCK_RESULTS[5]],
  },
  {
    group: 'similar_incident',
    label: 'Similar Incident',
    results: [MOCK_RESULTS[6]],
  },
  {
    group: 'background',
    label: 'Background',
    results: [MOCK_RESULTS[2], MOCK_RESULTS[4], MOCK_RESULTS[7], MOCK_RESULTS[8]],
  },
];

const INITIAL_TRUST_TIERS = [
  { id: 'internal', label: 'Internal Only', count: 3, enabled: true },
  { id: 'standard', label: 'Standards', count: 2, enabled: true },
  { id: 'vendor', label: 'Vendor Docs', count: 2, enabled: true },
  { id: 'community', label: 'Community', count: 2, enabled: true },
];

const MOCK_RELATED_INCIDENTS = [
  { id: 'inc-1', title: 'auth-service JWT Secret Rotation Outage', similarity: 94, date: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(), status: 'resolved' as const },
  { id: 'inc-2', title: 'DST Clock Skew - Auth Token Rejection', similarity: 87, date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), status: 'monitoring' as const },
  { id: 'inc-3', title: 'Session Timeout Inconsistency Across Pods', similarity: 72, date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), status: 'open' as const },
  { id: 'inc-4', title: 'Token Refresh Loop - Rate Limit Exhaustion', similarity: 58, date: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString(), status: 'resolved' as const },
];

export default function KnowledgePage() {
  const [query, setQuery] = useState('auth-service JWT fix');
  const [scope, setScope] = useState('All');
  const [trustTiers, setTrustTiers] = useState(INITIAL_TRUST_TIERS);
  const [selectedResult, setSelectedResult] = useState<EvidenceResult | null>(null);
  const [pinned, setPinned] = useState<string[]>([]);

  const handleToggleTier = (id: string) => {
    setTrustTiers((prev) =>
      prev.map((t) => (t.id === id ? { ...t, enabled: !t.enabled } : t))
    );
  };

  const handlePin = (id: string) => {
    setPinned((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  const filteredGroups = MOCK_GROUPS.map((group) => ({
    ...group,
    results: group.results.filter((r) => {
      const tier = trustTiers.find((t) => t.id === r.trustTier);
      return tier?.enabled;
    }),
  })).filter((group) => group.results.length > 0);

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-semibold text-fg-primary tracking-tight">Knowledge Hub</h1>
          <p className="text-xs text-fg-muted mt-0.5">Search trusted docs, prior incidents, and sources with provenance.</p>
        </div>
        <SourceTierLegend />
      </div>

      <div className="mb-4">
        <KnowledgeSearchBar
          query={query}
          onQueryChange={setQuery}
          scope={scope}
          onScopeChange={setScope}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4">
        <div className="space-y-4">
          <EvidenceGroupList
            groups={filteredGroups}
            onResultClick={setSelectedResult}
            pinned={pinned}
            onPin={handlePin}
          />

          {selectedResult && (
            <CitationPreviewPanel
              title={selectedResult.title}
              citation={selectedResult.citation}
              snippet={selectedResult.snippet}
              provenance={
                selectedResult.trustTier === 'internal'
                  ? ['Auth Service', 'Architecture Docs', 'auth-service/docs']
                  : selectedResult.trustTier === 'standard'
                  ? ['Standards Body', 'RFC/Official Spec', selectedResult.source]
                  : selectedResult.trustTier === 'vendor'
                  ? ['Vendor Portal', 'Documentation', selectedResult.source]
                  : ['Community', 'Discussion Forum', selectedResult.source]
              }
              matchedSection={selectedResult.whyMatched}
              onClose={() => setSelectedResult(null)}
            />
          )}

          <RelatedIncidentsPanel incidents={MOCK_RELATED_INCIDENTS} />
        </div>

        <div className="space-y-4">
          <TrustFilterCard tiers={trustTiers} onToggleTier={handleToggleTier} />
        </div>
      </div>
    </div>
  );
}
