/**
 * @file Evidence Storage System — Artifact Management with Tamper
 * Detection, Trace Indexing, Review Sign-off Records, and Canary
 * Token Detection.
 *
 * Implements the evidence-storage backbone for the CodeNexus platform.
 * Every piece of evidence is content-hashed (SHA-256) for tamper
 * detection, tagged with a retention policy based on finding severity,
 * and made searchable through trace indexing.
 *
 * Canary token detection is Rebuff-inspired: unique canary tokens are
 * injected into retrieval contexts, and any leak into output/logs
 * triggers automatic source blacklisting.
 *
 * @packageDocumentation
 */

import { randomUUID, createHash } from 'node:crypto';
import {
  RiskLevel,
  EvidenceType,
} from '../../shared-types/src/types.js';

// ─── Domain Types ─────────────────────────────────────────────────

/**
 * The concrete severity used for retention policy decisions.
 */
export type FindingSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * Decision a reviewer can make on a PR.
 */
export type SignoffDecision = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT' | 'WAIVE';

/**
 * Status of a canary token.
 */
export type CanaryTokenStatus = 'active' | 'leaked' | 'expired' | 'revoked';

/**
 * Status of a source after canary checks.
 */
export type SourceStatus = 'trusted' | 'suspicious' | 'blacklisted';

// ─── Artifact Types ───────────────────────────────────────────────

/**
 * A stored evidence artifact with full metadata.
 *
 * Extended from the shared-types `EvidenceArtifact` with storage-level
 * fields for tamper detection, compression, and retention.
 */
export interface StoredArtifact {
  /** Unique artifact identifier. */
  readonly id: string;

  /** Evidence type categorisation. */
  readonly type: EvidenceType | string;

  /** Human-readable description. */
  readonly description: string;

  /** Original MIME type (preserved for accurate replay). */
  readonly mimeType: string;

  /** Size in bytes (before compression). */
  readonly originalSize: number;

  /** Size in bytes (after compression, if applicable). */
  readonly storedSize: number;

  /** SHA-256 hash of the uncompressed content for tamper detection. */
  readonly contentHash: string;

  /** SHA-256 hash of the stored (possibly compressed) content. */
  readonly storedHash: string;

  /** Whether the content has been compressed. */
  readonly compressed: boolean;

  /** Compression algorithm used (if compressed). */
  readonly compressionAlgorithm?: 'gzip' | 'brotli' | 'deflate';

  /** The actual artifact content (may be compressed at rest). */
  readonly content: Buffer | string;

  /** Retention policy applied to this artifact. */
  readonly retentionPolicy: RetentionPolicy;

  /** Associated PR number. */
  readonly prNumber: number;

  /** Associated run ID (from the runtime verifier). */
  readonly runId?: string;

  /** Risk level at time of storage. */
  readonly riskLevel: RiskLevel;

  /** Arbitrary metadata tags for querying. */
  readonly metadata: Readonly<Record<string, unknown>>;

  /** ISO 8601 creation timestamp. */
  readonly createdAt: string;

  /** ISO 8601 expiration timestamp (based on retention policy). */
  readonly expiresAt: string;

  /** Whether the artifact has passed integrity verification. */
  readonly integrityVerified: boolean;

  /** Timestamp of last integrity check. */
  readonly lastVerifiedAt?: string;
}

/**
 * Retention policy for an evidence artifact.
 *
 * Based on finding severity:
 * - CRITICAL → 2 years
 * - HIGH     → 1 year
 * - MEDIUM   → 6 months
 * - LOW      → 3 months
 * - Waived   → Permanent retention
 */
export interface RetentionPolicy {
  /** The severity that determined this policy. */
  readonly severity: FindingSeverity;

  /** Whether the finding has been waived (enables permanent retention). */
  readonly waived: boolean;

  /** Duration in milliseconds this artifact should be retained. */
  readonly retentionPeriodMs: number;

  /** Human-readable retention description. */
  readonly description: string;
}

// ─── Artifact Filter ──────────────────────────────────────────────

/**
 * Query filter for `listArtifacts`.
 */
export interface ArtifactFilter {
  /** Filter by evidence type. */
  readonly type?: EvidenceType | string;

  /** Filter by PR number. */
  readonly prNumber?: number;

  /** Filter by risk level. */
  readonly riskLevel?: RiskLevel;

  /** Filter by run ID. */
  readonly runId?: string;

  /** Filter by creation date range (ISO 8601). */
  readonly createdAfter?: string;
  readonly createdBefore?: string;

  /** Filter by expiration status. */
  readonly expired?: boolean;

  /** Maximum number of results. */
  readonly limit?: number;

  /** Offset for pagination. */
  readonly offset?: number;
}

// ─── Trace Types ──────────────────────────────────────────────────

/**
 * A Playwright trace indexed for search.
 */
export interface IndexedTrace {
  /** Unique trace identifier. */
  readonly traceId: string;

  /** Source artifact ID. */
  readonly artifactId: string;

  /** PR number context. */
  readonly prNumber: number;

  /** Run ID context. */
  readonly runId?: string;

  /** Extracted key events in chronological order. */
  readonly events: readonly IndexedTraceEvent[];

  /** Summary statistics. */
  readonly statistics: TraceStatistics;

  /** Full-text searchable content. */
  readonly searchableText: string;

  /** ISO 8601 indexing timestamp. */
  readonly indexedAt: string;
}

/**
 * A single extracted event from a Playwright trace.
 */
export interface IndexedTraceEvent {
  /** Millisecond offset from trace start. */
  readonly timestamp: number;

  /** Event type. */
  readonly type: 'navigation' | 'click' | 'input' | 'assertion' | 'network' | 'error' | 'console' | 'screenshot';

  /** Human-readable description. */
  readonly description: string;

  /** Target element or URL. */
  readonly target: string;

  /** Associated data (URL, selector, value, etc.). */
  readonly data: Readonly<Record<string, unknown>>;

  /** Whether this event indicates a failure. */
  readonly isFailure: boolean;
}

/**
 * Summary statistics for a trace.
 */
export interface TraceStatistics {
  /** Total number of events. */
  readonly totalEvents: number;

  /** Total trace duration in milliseconds. */
  readonly durationMs: number;

  /** Number of navigation events. */
  readonly navigations: number;

  /** Number of click events. */
  readonly clicks: number;

  /** Number of network requests. */
  readonly networkRequests: number;

  /** Number of errors. */
  readonly errors: number;

  /** Number of failed assertions. */
  readonly failedAssertions: number;
}

/**
 * A timeline view of trace events grouped by type.
 */
export interface TraceTimeline {
  /** Trace identifier. */
  readonly traceId: string;

  /** Events grouped into time windows. */
  readonly windows: readonly TimelineWindow[];

  /** Overall trace duration. */
  readonly totalDurationMs: number;

  /** Start time of the trace. */
  readonly startTime: string;

  /** End time of the trace. */
  readonly endTime: string;
}

/**
 * A time window within a trace timeline.
 */
export interface TimelineWindow {
  /** Start offset in ms. */
  readonly startMs: number;

  /** End offset in ms. */
  readonly endMs: number;

  /** Events within this window. */
  readonly events: readonly IndexedTraceEvent[];

  /** Summary of this window. */
  readonly summary: string;
}

// ─── Sign-off Types ───────────────────────────────────────────────

/**
 * A cryptographically verifiable review sign-off record.
 */
export interface ReviewSignoff {
  /** Unique sign-off identifier. */
  readonly id: string;

  /** Reviewer's identity (GitHub login). */
  readonly reviewer: string;

  /** PR number. */
  readonly prNumber: number;

  /** Review decision. */
  readonly decision: SignoffDecision;

  /** Reviewer's notes. */
  readonly notes: string;

  /** SHA-256 hash of the sign-off payload (tamper detection). */
  readonly payloadHash: string;

  /** HMAC signature of the payload hash (tamper-proofing). */
  readonly signature: string;

  /** The signing key identifier used. */
  readonly keyId: string;

  /** ISO 8601 sign-off timestamp. */
  readonly signedAt: string;

  /** Whether the sign-off has been verified. */
  readonly verified: boolean;

  /** When the sign-off was last verified. */
  readonly lastVerifiedAt?: string;
}

/**
 * A full sign-off chain (audit trail) for a PR.
 */
export interface SignoffChain {
  /** PR number. */
  readonly prNumber: number;

  /** All sign-offs in chronological order. */
  readonly signoffs: readonly ReviewSignoff[];

  /** Whether the chain represents a complete review. */
  readonly isComplete: boolean;

  /** Summary of the chain's state. */
  readonly summary: string;

  /** ISO 8601 when the chain was assembled. */
  readonly assembledAt: string;
}

// ─── Canary Token Types ───────────────────────────────────────────

/**
 * A canary token for leak detection (Rebuff-inspired).
 *
 * Format: `CNX-CANARY-{contextId}-{nonce}-{secret}`
 */
export interface CanaryToken {
  /** Unique token identifier. */
  readonly id: string;

  /** The token string to be injected into content. */
  readonly token: string;

  /** Where the token was injected. */
  readonly contextId: string;

  /** Current status of the token. */
  readonly status: CanaryTokenStatus;

  /** When the token was created. */
  readonly createdAt: string;

  /** When the token was last checked. */
  readonly lastCheckedAt?: string;

  /** Where the token leaked (if status is `leaked`). */
  readonly leakLocation?: string;

  /** ISO 8601 leak detection timestamp. */
  readonly leakedAt?: string;
}

/**
 * A source that can be blacklisted if canary tokens leak.
 */
export interface TrackedSource {
  /** Unique source identifier. */
  readonly id: string;

  /** Source description (e.g., URL, system name). */
  readonly description: string;

  /** Current trust status. */
  readonly status: SourceStatus;

  /** Active canary tokens injected into this source. */
  readonly activeCanaries: readonly string[];

  /** History of canary leaks from this source. */
  readonly leakHistory: readonly CanaryLeakRecord[];

  /** When the source was blacklisted (if applicable). */
  readonly blacklistedAt?: string;

  /** Reason for blacklisting. */
  readonly blacklistReason?: string;
}

/**
 * A record of a canary token leak.
 */
export interface CanaryLeakRecord
