/**
 * CodeNexus — Shared Type Definitions
 *
 * These types are used across all CodeNexus modules.
 * Fused from: agent-reviews, authelia, background-agents, BookBridge,
 * Business-Logic-MCP, CLI-Anything, impeccable, superset, Tiz554, opencode
 */

// ─── Core Enums ───────────────────────────────────────────────

export enum AuthLevel {
  NotAuthenticated = 0,
  OneFactor = 1,
  TwoFactor = 2,
}

export enum CommentType {
  Code = "CODE",
  Issue = "COMMENT",
  Review = "REVIEW",
}

export enum ConfidenceLevel {
  High = "HIGH", // >= 80%
  Moderate = "MODERATE", // 60-79%
  Low = "LOW", // < 60%
}

export enum AgentMode {
  Build = "build",
  Plan = "plan",
  Review = "review",
  Fix = "fix",
}

export enum Policy {
  Bypass = "bypass",
  OneFactor = "one_factor",
  TwoFactor = "two_factor",
  Deny = "deny",
}

export enum SessionStatus {
  Pending = "pending",
  Running = "running",
  Completed = "completed",
  Failed = "failed",
  Cancelled = "cancelled",
}

export enum Severity {
  Critical = "critical",
  High = "high",
  Medium = "medium",
  Low = "low",
  Info = "info",
}

export enum FixStatus {
  Pending = "pending",
  InProgress = "in_progress",
  Applied = "applied",
  Verified = "verified",
  Failed = "failed",
  Skipped = "skipped",
}

// ─── Core Interfaces ──────────────────────────────────────────

export interface ReviewComment {
  id: number;
  pullRequestUrl: string;
  diffHunk: string | null;
  path: string | null;
  body: string;
  author: CommentAuthor;
  createdAt: string;
  type: CommentType;
  isResolved: boolean;
  isReply: boolean;
  replyToId: number | null;
  replies: ReviewComment[];
}

export interface CommentAuthor {
  login: string;
  isBot: boolean;
  avatarUrl: string;
}

export interface ProcessedComments {
  comments: ReviewComment[];
  stats: CommentStats;
}

export interface CommentStats {
  total: number;
  code: number;
  issue: number;
  review: number;
  bot: number;
  human: number;
  unresolved: number;
  unanswered: number;
}

// ─── Auth Types (authelia) ────────────────────────────────────

export interface UserSession {
  id: string;
  username: string;
  groups: string[];
  emails: string[];
  authenticationLevel: AuthLevel;
  authenticationMethods: string[];
  createdAt: string;
  expiresAt: string;
}

export interface AccessControlRule {
  domain: string;
  resources?: string[];
  methods?: string[];
  networks?: string[];
  subjects?: string[];
  policy: Policy;
}

export interface OIDCClient {
  clientId: string;
  clientSecret?: string;
  redirectUris: string[];
  grantTypes: string[];
  scopes: string[];
  codeChallenge?: string;
  codeChallengeMethod?: string;
}

// ─── Agent Runtime Types (opencode) ───────────────────────────

export interface AgentConfig {
  provider: string;
  model: string;
  lspEnabled: boolean;
  maxDepth: number;
  systemPrompt: string;
  reasoningEffort: "none" | "low" | "medium" | "high" | "xhigh" | "max";
}

export interface AgentSession {
  id: string;
  status: SessionStatus;
  mode: AgentMode;
  repository: RepositoryInfo;
  prompt: string;
  events: AgentEvent[];
  startedAt: string;
  completedAt: string | null;
}

export interface RepositoryInfo {
  owner: string;
  repo: string;
  branch: string;
  prNumber: number | null;
  cloneUrl: string;
}

export interface AgentEvent {
  type: "tool_call" | "token_stream" | "status" | "error" | "completion";
  timestamp: string;
  data: Record<string, unknown>;
}

// ─── Business Logic Types (Business-Logic-MCP) ───────────────

export interface BusinessEntity {
  name: string;
  fields: EntityField[];
  stateMachine: string | null;
  footguns: Footgun[];
  validationRules: ValidationRule[];
}

export interface EntityField {
  name: string;
  type: string;
  required: boolean;
  semantic: string;
  validationRules: string[];
  footguns: string[];
}

export interface StateMachine {
  name: string;
  states: string[];
  transitions: StateTransition[];
}

export interface StateTransition {
  from: string;
  to: string;
  condition: string;
  sideEffects: string[];
}

export interface Footgun {
  description: string;
  severity: Severity;
  mitigation: string;
}

export interface ValidationRule {
  name: string;
  expression: string;
  message: string;
}

export interface DecisionTable {
  name: string;
  inputs: string[];
  outputs: string[];
  rules: DecisionRule[];
}

export interface DecisionRule {
  conditions: Record<string, string>;
  result: string;
  priority: number;
}

// ─── Knowledge Engine Types (Book-Synthesis + BookBridge) ─────

export interface BookSource {
  path: string;
  title: string;
  format: "pdf" | "epub" | "docx" | "txt";
  content: string;
}

export interface KnowledgeSynthesis {
  overview: string;
  keyConcepts: KeyConcept[];
  crossSourceInsights: CrossSourceInsight[];
  confidence: number;
  sources: string[];
}

export interface KeyConcept {
  name: string;
  frequency: number;
  sourceCount: number;
  supportingQuotes: string[];
  confidence: ConfidenceLevel;
}

export interface CrossSourceInsight {
  theme: string;
  sources: string[];
  representativeText: string;
}

export interface SearchResult {
  bookId: string;
  title: string;
  chunk: string;
  relevance: number;
  pageRange: [number, number];
}

export interface Citation {
  style: "APA" | "MLA" | "Chicago" | "BibTeX" | "Vancouver" | "IEEE";
  text: string;
}

// ─── Design Review Types (impeccable) ─────────────────────────

export interface DesignAudit {
  url: string;
  timestamp: string;
  antiPatterns: AntiPattern[];
  score: number;
  recommendations: string[];
}

export interface AntiPattern {
  name: string;
  severity: Severity;
  element: string;
  description: string;
  fix: string;
  lineNumber: number;
}

export interface DesignSystem {
  colors: Record<string, string>;
  typography: TypographyTokens;
  spacing: SpacingTokens;
  components: ComponentTokens;
}

export interface TypographyTokens {
  fontFamilies: string[];
  fontSizes: Record<string, string>;
  lineHeights: Record<string, string>;
  fontWeights: Record<string, number>;
}

export interface SpacingTokens {
  unit: number;
  scale: number[];
}

export interface ComponentTokens {
  button: Record<string, string>;
  input: Record<string, string>;
  card: Record<string, string>;
}

// ─── Security Types (Claw-Protect) ────────────────────────────

export interface TelemetryPayload {
  agentId: string;
  sessionId: string;
  timestamp: string;
  events: TelemetryEvent[];
  metrics: AgentMetrics;
}

export interface TelemetryEvent {
  type: string;
  input: string;
  output: string;
  toolCalls: ToolCallInfo[];
  duration: number;
}

export interface ToolCallInfo {
  toolName: string;
  arguments: Record<string, unknown>;
  result: string;
  timestamp: string;
}

export interface AgentMetrics {
  cpu: number;
  memory: number;
  networkOutbound: number;
  processCount: number;
}

export interface SecurityAlert {
  id: string;
  severity: Severity;
  type: AlertType;
  description: string;
  agentId: string;
  details: Record<string, unknown>;
  timestamp: string;
}

export type AlertType =
  | "prompt_injection"
  | "data_exfiltration"
  | "behavioral_drift"
  | "shadow_agent"
  | "secrets_leak"
  | "supply_chain"
  | "permission_violation"
  | "resource_exhaustion";

export interface TrustScore {
  agentId: string;
  score: number; // 0.0 - 1.0
  factors: Record<string, number>;
  lastUpdated: string;
}

// ─── Plugin System Types (Tiz554) ─────────────────────────────

export interface PluginPermissions {
  filesystem?: { read?: string[]; write?: string[] };
  network?: { allowOutbound?: string[]; allowLocalhost?: boolean };
  execution?: { allowChildProcess?: boolean; allowEval?: boolean };
  environment?: { allowVars?: string[] };
  maxMemoryMB?: number;
  maxCpuSeconds?: number;
}

export interface PluginMetadata {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  entrypoint: string;
  dependencies: string[];
  triggers: string[];
  permissions?: PluginPermissions;
}

export interface PluginInstance {
  metadata: PluginMetadata;
  enabled: boolean;
  loaded: boolean;
  instance: unknown; // Runtime plugin instance
  permissions?: PluginPermissions;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  handler: string;
  pluginId: string;
}

// ─── CLI Generator Types (CLI-Anything) ───────────────────────

export interface CLIDefinition {
  name: string;
  version: string;
  description: string;
  commands: CLICommand[];
}

export interface CLICommand {
  name: string;
  description: string;
  arguments: CLIArgument[];
  options: CLIOption[];
  subcommands: CLICommand[];
  examples: CLIExample[];
}

export interface CLIArgument {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export interface CLIOption {
  name: string;
  flag: string;
  type: string;
  default?: unknown;
  description: string;
  required: boolean;
}

export interface CLIExample {
  command: string;
  description: string;
}

// ─── Analytics Types (superset) ───────────────────────────────

export interface ReviewMetric {
  prNumber: number;
  repository: string;
  totalComments: number;
  botComments: number;
  humanComments: number;
  fixesApplied: number;
  timeToFix: number; // seconds
  confidence: number;
  timestamp: string;
}

export interface DashboardData {
  totalPRsReviewed: number;
  totalFixesApplied: number;
  averageFixTime: number;
  botVsHumanRatio: number;
  topRepositories: string[];
  recentActivity: ReviewMetric[];
  securityAlerts: number;
}

// ─── Session & Orchestration Types (background-agents) ────────

export interface OrchestrationSession {
  id: string;
  repository: RepositoryInfo;
  comments: ReviewComment[];
  mode: AgentMode;
  status: SessionStatus;
  sandboxId: string | null;
  childSessions: string[];
  events: AgentEvent[];
  metrics: ReviewMetric;
  createdAt: string;
  updatedAt: string;
}

export interface SandboxSpec {
  image: string;
  resources: {
    cpu: number;
    memory: string;
    disk: string;
  };
  preBuildCommands: string[];
  environment: Record<string, string>;
}

// ─── Webhook Event Types ──────────────────────────────────────

export interface GitHubWebhookEvent {
  action: string;
  pullRequest: {
    number: number;
    state: string;
    title: string;
    body: string;
    head: { ref: string; sha: string };
    base: { ref: string; sha: string };
    user: { login: string };
  };
  repository: {
    fullName: string;
    owner: { login: string };
    name: string;
    cloneUrl: string;
  };
  sender: { login: string };
}

// ─── Configuration Types ──────────────────────────────────────

export interface CodeNexusConfig {
  auth: {
    provider: string;
    jwtSecret: string;
    oidc: {
      issuer: string;
      clients: OIDCClient[];
    };
  };
  github: {
    token: string;
    appId: string;
    webhookSecret: string;
  };
  agent: {
    provider: string;
    model: string;
    lspEnabled: boolean;
    maxDepth: number;
  };
  security: {
    promptInjection: boolean;
    dataExfiltration: boolean;
    agentMonitoring: boolean;
  };
  knowledge: {
    bookDirectory: string;
    maxSources: number;
    minConfidence: number;
  };
  analytics: {
    provider: string;
    dashboardUrl: string;
  };
}

// ─── Deep Audit Types (OWASP WSTG/ASVS + OpenSSF Scorecard) ─────

export enum RiskLevel {
  Critical = "CRITICAL",
  High = "HIGH",
  Medium = "MEDIUM",
  Low = "LOW",
}

export enum ValidationLens {
  SourceReview = "SOURCE_REVIEW",
  PipelineReview = "PIPELINE_REVIEW",
  RuntimeBehavior = "RUNTIME_BEHAVIOR",
}

export enum SourceTrustTier {
  Tier1 = "TIER_1", // Local repo, internal docs, approved books
  Tier2 = "TIER_2", // Vendor docs, OWASP, OpenSSF
  Tier3 = "TIER_3", // Community forums, Discord, unverified web
}

export enum AuditFindingSeverity {
  Critical = "CRITICAL",
  High = "HIGH",
  Medium = "MEDIUM",
  Low = "LOW",
  Info = "INFO",
}

export enum MergeBlockerType {
  MissingHumanReview = "MISSING_HUMAN_REVIEW",
  UnresolvedDisputedFindings = "UNRESOLVED_DISPUTED_FINDINGS",
  InsecureWorkflowPermissions = "INSECURE_WORKFLOW_PERMISSIONS",
  TransactionIntegrityFailure = "TRANSACTION_INTEGRITY_FAILURE",
}

// ─── Deep Audit Core Interfaces ────────────────────────────────

export interface DeepAuditReport {
  auditId: string;
  prNumber: number;
  repository: string;
  riskLevel: RiskLevel;
  lenses: LensResult[];
  findings: AuditFinding[];
  blockers: MergeBlocker[];
  evidence: EvidenceArtifact[];
  invariants: BusinessInvariant[];
  sourceToSinkTraces: SourceToSinkTrace[];
  raceConditionAnalyses: RaceConditionAnalysis[];
  knowledgeSafety: KnowledgeSafetyAssessment;
  overallStatus: "PASS" | "FAIL" | "BLOCKED";
  timestamp: string;
  reviewer?: string;
}

export interface LensResult {
  lens: ValidationLens;
  status: "PASS" | "FAIL" | "NOT_RUN";
  findings: string[];
  coverage: number; // 0.0 - 1.0
  duration: number; // ms
  details: string;
}

export interface AuditFinding {
  id: string;
  severity: AuditFindingSeverity;
  lens: ValidationLens;
  category: string;
  title: string;
  description: string;
  location: string; // file path or endpoint
  recommendation: string;
  evidence: string[]; // references to evidence artifact IDs
  disputed: boolean;
  resolved: boolean;
}

export interface MergeBlocker {
  type: MergeBlockerType;
  active: boolean;
  description: string;
  details: string;
  blockedBy: string; // reviewer or system
  createdAt: string;
  resolvedAt?: string;
}

export interface EvidenceArtifact {
  id: string;
  type:
    | "playwright_trace"
    | "screenshot"
    | "network_snapshot"
    | "audit_log"
    | "invariant_doc"
    | "trace_output"
    | "signoff";
  description: string;
  filePath: string;
  mimeType: string;
  size: number;
  hash: string;
  createdAt: string;
}

export interface BusinessInvariant {
  id: string;
  statement: string; // "What must always be true"
  category:
    | "data_integrity"
    | "state_transition"
    | "authorization"
    | "business_rule"
    | "compliance";
  riskLevel: RiskLevel;
  verifiedBy: ValidationLens[];
  verified: boolean;
  lastVerifiedAt?: string;
}

export interface SourceToSinkTrace {
  id: string;
  source: string; // user input / external entry point
  transformations: DataTransformation[];
  sinks: string[]; // logs, databases, caches, external APIs
  accessControl: {
    enforced: boolean;
    mechanism: string;
    idorVulnerable: boolean;
    idorDetails: string;
  };
  dataClassification: "public" | "internal" | "pii" | "secret";
}

export interface DataTransformation {
  step: number;
  location: string;
  description: string;
  sanitization: "none" | "input_validation" | "encoding" | "encryption";
}

export interface RaceConditionAnalysis {
  id: string;
  hotspot: string; // code location
  resource: string; // e.g., "inventory count", "account balance"
  risk: RiskLevel;
  concurrentOperations: string[];
  timingWindow: string; // e.g., "read-commit cycle"
  invariantAtRisk: string;
  recommendedTest: string;
  testGenerated: boolean;
}

export interface KnowledgeSafetyAssessment {
  tier1Sources: string[];
  tier2Sources: string[];
  tier3Sources: string[];
  tier3UsedForDecisions: boolean;
  policyOverrideDetected: boolean;
  overrideDetails: string;
  assessment: "SAFE" | "CAUTION" | "VIOLATION";
}

export interface PlaywrightTestDefinition {
  id: string;
  name: string;
  riskLevel: RiskLevel;
  category:
    | "business_invariant"
    | "race_condition"
    | "authorization"
    | "negative_path"
    | "workflow_integrity"
    | "idempotency";
  description: string;
  testCode: string; // Generated Playwright test code
  assertions: string[]; // Retryable assertions (business invariants)
  concurrentUsers: number;
  iterations: number;
  requiredArtifacts: string[];
}

export interface SourceReviewReport {
  stateMachines: {
    name: string;
    states: string[];
    transitions: { from: string; to: string; condition: string }[];
    unreachableStates: string[];
    deadTransitions: string[];
  }[];
  trustBoundaries: {
    boundary: string;
    direction: "inbound" | "outbound" | "both";
    risk: RiskLevel;
    verificationStatus: "verified" | "unverified" | "violated";
  }[];
  dataFlows: SourceToSinkTrace[];
}

export interface PipelineReviewReport {
  branchProtections: {
    requiredReviews: number;
    dismissStaleReviews: boolean;
    requiresStatusChecks: boolean;
    requiresSignedCommits: boolean;
    enforcesAdmins: boolean;
    compliant: boolean;
  };
  ciCdGates: {
    gate: string;
    status: "passing" | "failing" | "not_found";
    required: boolean;
  }[];
  openssfScorecard: {
    score: number; // 0-10
    checks: { name: string; score: number; reason: string }[];
  };
}

export interface RuntimeReviewReport {
  playwrightTests: PlaywrightTestResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    flaky: number;
  };
}

export interface PlaywrightTestResult {
  testId: string;
  name: string;
  status: "passed" | "failed" | "flaky" | "skipped";
  duration: number;
  traces: EvidenceArtifact[];
  screenshots: EvidenceArtifact[];
  networkSnapshots: EvidenceArtifact[];
  error?: string;
}
