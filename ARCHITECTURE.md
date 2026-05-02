# CodeNexus Architecture — The Complete Fusion

> **Where 13 open-source projects become one unified agentic code review and fix platform.**

---

## 1. Fusion Map — Which Project Became What

```
┌────────────────────────────────────────────────────────────────────┐
│                      CODENEXUS FUSION MAP                           │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌──────────────────┐     ┌─────────────────────────────────────┐  │
│  │   agent-reviews  │ ──▶ │  PR Manager Module                  │  │
│  │   (Paul Bakaus)  │     │  └─ GitHub comment fetching         │  │
│  │                  │     │  └─ Bot/Human classification        │  │
│  │                  │     │  └─ Meta-comment filtering          │  │
│  │                  │     │  └─ Reply & resolve threads         │  │
│  │                  │     │  └─ Watch mode polling              │  │
│  └──────────────────┘     └─────────────────────────────────────┘  │
│                                                                    │
│  ┌──────────────────┐     ┌─────────────────────────────────────┐  │
│  │    authelia      │ ──▶ │  Auth Service Module                │  │
│  │   (Auth Server)  │     │  └─ SSO + 2FA (TOTP)              │  │
│  │                  │     │  └─ OIDC Provider                  │  │
│  │                  │     │  └─ RBAC Authorization             │  │
│  │                  │     │  └─ Rate Limiting / Brute-Force    │  │
│  │                  │     │  └─ Session Management (Redis)     │  │
│  └──────────────────┘     └─────────────────────────────────────┘  │
│                                                                    │
│  ┌──────────────────┐     ┌─────────────────────────────────────┐  │
│  │ background-agents│ ──▶ │  Control Plane Module               │  │
│  │ (Open-Inspect)   │     │  └─ Durable Object Sessions         │  │
│  │                  │     │  └─ WebSocket Real-Time Hub         │  │
│  │                  │     │  └─ Sandbox Lifecycle Manager       │  │
│  │                  │     │  └─ FIFO Prompt Queue               │  │
│  │                  │     │  └─ Child Session Spawning          │  │
│  │                  │     │  └─ GitHub App Integration          │  │
│  └──────────────────┘     └─────────────────────────────────────┘  │
│                                                                    │
│  ┌──────────────────┐     ┌─────────────────────────────────────┐  │
│  │  Book Synthesis  │ ──▶ │  Knowledge Engine                   │  │
│  │  + BookBridge    │     │  └─ Multi-format document ingest    │  │
│  │                  │     │  └─ TF-IDF + FTS5 Hybrid Search     │  │
│  │                  │     │  └─ Cross-source synthesis          │  │
│  │                  │     │  └─ Confidence scoring              │  │
│  │                  │     │  └─ Citation generation (6 styles)  │  │
│  └──────────────────┘     └─────────────────────────────────────┘  │
│                                                                    │
│  ┌──────────────────┐     ┌─────────────────────────────────────┐  │
│  │ Business-Logic   │ ──▶ │  MCP Server - Business Logic       │  │
│  │ MCP             │     │  └─ Entity definitions + footguns    │  │
│  │                  │     │  └─ State machines + transitions    │  │
│  │                  │     │  └─ Decision tables + evaluation    │  │
│  │                  │     │  └─ Permission checking             │  │
│  └──────────────────┘     └─────────────────────────────────────┘  │
│                                                                    │
│  ┌──────────────────┐     ┌─────────────────────────────────────┐  │
│  │  CLI-Anything    │ ──▶ │  MCP Server - CLI Generator        │  │
│  │  (HKUDS)         │     │  └─ 7-phase generation pipeline    │  │
│  │                  │     │  └─ Click/Python CLI output        │  │
│  │                  │     │  └─ REPL + subcommand modes        │  │
│  │                  │     │  └─ Agent-native --json output     │  │
│  └──────────────────┘     └─────────────────────────────────────┘  │
│                                                                    │
│  ┌──────────────────┐     ┌─────────────────────────────────────┐  │
│  │   impeccable     │ ──▶ │  Design Reviewer Module             │  │
│  │   (Paul Bakaus)  │     │  └─ 24 anti-pattern detection rules│  │
│  │                  │     │  └─ HTML/CSS regex scanning         │  │
│  │                  │     │  └─ Design token extraction         │  │
│  │                  │     │  └─ Critique / Audit / Polish       │  │
│  └──────────────────┘     └─────────────────────────────────────┘  │
│                                                                    │
│  ┌──────────────────┐     ┌─────────────────────────────────────┐  │
│  │    superset      │ ──▶ │  Analytics Module                   │  │
│  │  (Apache)        │     │  └─ Review metric collection        │  │
│  │                  │     │  └─ Dashboard data aggregation      │  │
│  │                  │     │  └─ Time-series analytics           │  │
│  │                  │     │  └─ Bot vs Human ratio tracking     │  │
│  └──────────────────┘     └─────────────────────────────────────┘  │
│                                                                    │
│  ┌──────────────────┐     ┌─────────────────────────────────────┐  │
│  │    Tiz554        │ ──▶ │  Plugin System Module               │  │
│  │  ("Big Homie")   │     │  └─ Plugin registry + loader        │  │
│  │                  │     │  └─ Skill keyword routing            │  │
│  │                  │     │  └─ Trigger-based dispatch           │  │
│  │                  │     │  └─ Lazy loading + health checks    │  │
│  └──────────────────┘     └─────────────────────────────────────┘  │
│                                                                    │
│  ┌──────────────────┐     ┌─────────────────────────────────────┐  │
│  │    opencode      │ ──▶ │  Agent Runtime Module               │  │
│  │  (AI Coding)     │     │  └─ Multi-provider LLM support      │  │
│  │                  │     │  └─ LSP integration (TS, Py, Rust)  │  │
│  │                  │     │  └─ Build/Plan dual agent modes     │  │
│  │                  │     │  └─ TUI + WebSocket remote control  │  │
│  └──────────────────┘     └─────────────────────────────────────┘  │
│                                                                    │
│  ┌──────────────────┐     ┌─────────────────────────────────────┐  │
│  │  Claw-Protect    │ ──▶ │  Security Module                    │  │
│  │  (Agent Sec)     │     │  └─ Prompt injection detection      │  │
│  │                  │     │  └─ Data exfiltration monitoring    │  │
│  │                  │     │  └─ Behavioral drift detection      │  │
│  │                  │     │  └─ Secrets scanning (35+ patterns) │  │
│  │                  │     │  └─ Trust scoring engine            │  │
│  └──────────────────┘     └─────────────────────────────────────┘  │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

---

## 2. System Architecture — Layer Diagram

```
                                    ┌──────────────┐
                                    │   Internet   │
                                    │ (GitHub, Web)│
                                    └──────┬───────┘
                                           │
                                    ┌──────▼───────┐
                                    │  Cloudflare  │
                                    │   Workers    │
                           ┌────────┤  (Control    ├────────┐
                           │        │   Plane)     │        │
                           │        └──────────────┘        │
                           ▼                                ▼
                    ┌──────────────┐               ┌──────────────┐
                    │   Auth       │               │  WebSocket   │
                    │   Service    │               │    Hub       │
                    │  (authelia)  │               │              │
                    └──────┬───────┘               └──────┬───────┘
                           │                              │
                    ┌──────▼───────┐               ┌──────▼───────┐
                    │   Durable    │               │   Sandbox    │
                    │   Objects    │               │  (Modal)     │
                    │  (Sessions)  │               │              │
                    └──────┬───────┘               └──────┬───────┘
                           │                              │
                    ┌──────▼───────┐               ┌──────▼───────┐
                    │   D1 SQLite  │               │   OpenCode   │
                    │ (Shared DB)  │               │   Agent      │
                    └──────────────┘               └──────────────┘
```

---

## 3. The 13-Step Review-Fix Cycle (Detailed)

```
STEP 1:  WEBHOOK VALIDATION
         └─ HMAC-SHA256 verification of GitHub webhook payload
         └─ Constant-time comparison to prevent timing attacks
         └─ Source: Claw-Protect (security validation)

STEP 2:  PR DETECTION & PARSING
         └─ Extract PR number, head/base refs, author info
         └─ Classify PR type: bugfix, feature, security, refactor
         └─ Source: background-agents (webhook parsing)

STEP 3:  AUTHENTICATION & AUTHORIZATION
         └─ Validate user session via JWT or OIDC token
         └─ Check RBAC permissions for repository access
         └─ Verify 2FA if policy requires it
         └─ Source: authelia (SSO, OIDC, RBAC)

STEP 4:  COMMENT FETCHING
         └─ Fetch PR diff, review comments, issue comments, reviews
         └─ Paginate all API requests via Link header
         └─ Detect PR from current branch if not specified
         └─ Source: agent-reviews (GitHub API client)

STEP 5:  COMMENT CLASSIFICATION
         └─ Bot vs Human detection (25+ known bots + pattern matching)
         └─ Meta-comment filtering (Vercel, CI/CD, coverage, etc.)
         └─ Body cleaning (HTML comments, Fix buttons, etc.)
         └─ Reply chain construction (parent-child threading)
         └─ Source: agent-reviews (comment processor)

STEP 6:  CODE ANALYSIS (LSP)
         └─ Open LSP for detected languages (TS, Python, Rust, Go)
         └─ Symbol resolution, type checking, diagnostics
         └─ Code understanding for context-aware fixes
         └─ Source: opencode (LSP integration)

STEP 7:  BUSINESS LOGIC VALIDATION
         └─ Query MCP server for entity definitions
         └─ Check state machine transition validity
         └─ Evaluate decision tables for logic paths
         └─ Identify known footguns in the codebase
         └─ Source: Business-Logic-MCP (domain rules)

STEP 8:  KNOWLEDGE RETRIEVAL
         └─ Hybrid search (FTS5 + TF-IDF) across documentation
         └─ Cross-source synthesis with confidence scoring
         └─ Citation generation for traceable references
         └─ Reading plan generation for research tasks
         └─ Source: BookBridge + Book-Synthesis (knowledge engine)

STEP 9:  DESIGN REVIEW
         └─ Scan HTML/CSS for 24+ anti-patterns
         └─ Check typography, colors, spacing, layout, a11y
         └─ Extract design system tokens for consistency
         └─ Score and severity classification
         └─ Source: impeccable (design quality audit)

STEP 10: SECURITY SCAN
         └─ Scan code for secrets (35+ API key patterns)
         └─ Detect prompt injection in agent inputs
         └─ Monitor data exfiltration patterns
         └─ Calculate trust score from all security factors
         └─ Source: Claw-Protect (security framework)

STEP 11: FIX APPLICATION
         └─ Spawn isolated sandbox (Modal or Daytona)
         └─ Agent implements fixes (opencode mode: fix)
         └─ Apply git commits with proper attribution
         └─ Run build/lint/test verification
         └─ Create/update PR with fixes
         └─ Sources: background-agents, opencode, agent-reviews

STEP 12: REPLY & RESOLVE
         └─ Post replies to each review comment thread
         └─ Resolve threads via GraphQL API
         └─ Watch for new comments (configurable polling)
         └─ Loop until no new comments for inactivity timeout
         └─ Source: agent-reviews (reply + resolve + watch)

STEP 13: ANALYTICS LOGGING
         └─ Record metrics (PRs, comments, fixes, times)
         └─ Update bot vs human ratio
         └─ Generate dashboard data
         └─ Track trends over time
         └─ Source: superset (analytics engine)
```

---

## 4. Data Flow — End-to-End Sequence

```
User/GitHub                     CodeNexus                       MCP Servers
    │                               │                               │
    │  PR Opened / Comment Added     │                               │
    │──────────────────────────────▶│                               │
    │                               │                               │
    │                          ┌────┴────┐                         │
    │                          │ Control │                         │
    │                          │  Plane  │                         │
    │                          │ (Worker)│                         │
    │                          └────┬────┘                         │
    │                               │                               │
    │                     ┌─────────┴──────────┐                   │
    │                     │ Durable Object (DO) │                   │
    │                     │  Session Manager    │                   │
    │                     └─────────┬──────────┘                   │
    │                               │                               │
    │          ┌────────────────────┼────────────────────┐          │
    │          ▼                    ▼                    ▼          │
    │   ┌────────────┐     ┌──────────────┐    ┌──────────────┐    │
    │   │  Auth      │     │  PR Manager  │    │  Analyzer    │    │
    │   │  Service   │     │ (agent-      │    │  Pipeline    │    │
    │   │ (authelia) │     │  reviews)    │    │              │    │
    │   └─────┬──────┘     └──────┬───────┘    └──────┬───────┘    │
    │         │                  │                    │            │
    │         │                  │           ┌────────┼────────┐   │
    │         │                  │           ▼        ▼        ▼   │
    │         │                  │    ┌────────┐┌────────┐┌────────┐│
    │         │                  │    │ Biz    ││  Book  ││  CLI   ││
    │         │                  │    │ Logic  ││ Bridge ││ Gen    ││
    │         │                  │    │ (MCP)  ││ (MCP)  ││ (MCP)  ││
    │         │                  │    └────────┘└────────┘└────────┘│
    │         │                  │                    │            │
    │         │                  │           ┌────────┴────────┐   │
    │         │                  │           │  Agent Runtime  │   │
    │         │                  │           │   (opencode)    │   │
    │         │                  │           └────────┬────────┘   │
    │         │                  │                    │            │
    │         │                  │           ┌────────┴────────┐   │
    │         │                  │           │    Sandbox      │   │
    │         │                  │           │   (Modal)       │   │
    │         │                  │           └─────────────────┘   │
    │         │                  │                               │
    │         │                  │           ┌────────────┐       │
    │         │                  │           │  Security  │       │
    │         │                  │           │  (Claw)    │       │
    │         │                  │           └────────────┘       │
    │                               │                               │
    │  Fixes Applied + Replies      │                               │
    │◀──────────────────────────────│                               │
    │                               │                               │
    │  Analytics Dashboard          │                               │
    │◀──────────────────────────────│                               │
```

---

## 5. Module Boundaries & Contracts

### Control Plane → All Modules

```
interface ModuleAdapter {
  name: string;
  initialize(config: Partial<CodeNexusConfig>): Promise<void>;
  healthCheck(): Promise<HealthStatus>;
  shutdown(): Promise<void>;
}
```

### Control Plane → Auth Service

```
interface AuthAdapter extends ModuleAdapter {
  authenticate(request: AuthRequest): Promise<UserSession>;
  authorize(session: UserSession, context: AuthContext): Promise<AuthDecision>;
  validateToken(token: string): Promise<UserSession>;
}
```

### Control Plane → PR Manager

```
interface PRAdapter extends ModuleAdapter {
  fetchAndProcess(options: FetchOptions): Promise<ProcessedComments>;
  postReply(commentId: number, body: string, resolve: boolean): Promise<void>;
  resolveThread(threadId: string): Promise<void>;
  fetchDiff(prNumber: number): Promise<string>;
  startWatching(cb: WatchCallback, opts: WatchOptions): void;
}
```

### Control Plane → Agent Runtime

```
interface AgentAdapter extends ModuleAdapter {
  execute(session: AgentSession, prompt: string): AsyncIterable<AgentEvent>;
  spawnChildSession(parentId: string, task: string): Promise<string>;
  getSessionStatus(sessionId: string): Promise<SessionStatus>;
  cancelSession(sessionId: string): Promise<void>;
}
```

### Control Plane → MCP Servers

```
interface MCPAdapter extends ModuleAdapter {
  callTool(toolName: string, args: unknown): Promise<unknown>;
  listTools(): Promise<string[]>;
}
```

### Control Plane → Security

```
interface SecurityAdapter extends ModuleAdapter {
  processTelemetry(payload: TelemetryPayload): Promise<SecurityAssessment>;
  getAlerts(filter: AlertFilter): Promise<SecurityAlert[]>;
  getTrustScore(agentId: string): Promise<TrustScore>;
  middleware(): RequestHandler;
}
```

### Control Plane → Knowledge Engine

```
interface KnowledgeAdapter extends ModuleAdapter {
  ingestDocument(path: string, format: string): Promise<BookSource>;
  synthesize(): KnowledgeSynthesis;
  search(query: string, opts?: SearchOptions): SearchResult[];
  generateCitation(source: BookSource, style: CitationStyle): Citation;
}
```

### Control Plane → Design Reviewer

```
interface DesignAdapter extends ModuleAdapter {
  critique(html: string, css: string): Promise<DesignAudit>;
  audit(filePath: string): Promise<DesignAudit>;
  polish(input: string): Promise<string>;
  extractDesignTokens(html: string, css: string): DesignSystem;
}
```

### Control Plane → Analytics

```
interface AnalyticsAdapter extends ModuleAdapter {
  recordMetric(metric: ReviewMetric): Promise<void>;
  getDashboardData(): Promise<DashboardData>;
  getTimeSeries(interval: string, since: string): Promise<TimeSeriesData[]>;
  getBotHumanRatio(repo?: string): Promise<RatioData>;
}
```

### Control Plane → Plugin System

```
interface PluginAdapter extends ModuleAdapter {
  dispatch(trigger: string, context: unknown): Promise<void>;
  registerPlugin(plugin: PluginMetadata): Promise<void>;
  findSkills(keywords: string[]): Promise<Skill[]>;
  getHealth(): Promise<PluginHealthReport>;
}
```

---

## 6. Security Model

CodeNexus implements a **defense-in-depth** security model:

| Layer | Protection | Source |
|-------|-----------|--------|
| Transport | TLS 1.3, HMAC webhook verification | Claw-Protect |
| Authentication | SSO, TOTP 2FA, OIDC | authelia |
| Authorization | RBAC, ACL rules, policy enforcement | authelia |
| Agent Security | Prompt injection, data exfiltration, behavioral drift | Claw-Protect |
| Secrets | Entropy scanning, 35+ pattern detection | Claw-Protect |
| Trust | Dynamic trust scoring with exponential decay | Claw-Protect |
| Sandbox | Isolated Modal containers, per-session boundaries | background-agents |
| Audit | Immutable audit logs, telemetry trail | Claw-Protect + Analytics |

### Trust Score Calculation

```
TrustScore = Σ(weight_i × factor_i) / Σ(weight_i)

Factors:
  prompt_injection_risk  (weight: 0.25)  ← Claw-Protect
  data_exfiltration_risk (weight: 0.20)  ← Claw-Protect
  behavioral_drift_risk  (weight: 0.15)  ← Claw-Protect
  secrets_leak_risk      (weight: 0.20)  ← Claw-Protect
  session_volume_risk    (weight: 0.05)  ← background-agents
  anomaly_frequency      (weight: 0.07)  ← Claw-Protect
  error_rate             (weight: 0.05)  ← opencode
  response_quality       (weight: 0.03)  ← opencode

Decay: value(t) = value(0) × exp(-λ × t)
Alert threshold: score < 0.4
Block threshold: score < 0.2
```

---

## 7. How Each Fused Project Contributes

```
agent-reviews     → PR comment lifecycle management
                    (fetch → classify → reply → resolve → watch)

authelia          → Enterprise-grade authentication
                    (SSO → 2FA → OIDC → RBAC → rate limiting)

background-agents → Async orchestration infrastructure
                    (Durable Objects → WebSockets → sandboxes → queue)

Book-Synthesis    → Multi-document knowledge synthesis
                    (extract → analyze → cross-reference → score)

BookBridge        → Local knowledge library with agent access
                    (ingest → embed → search → cite → MCP tools)

Business-Logic-MCP→ Domain-aware code generation
                    (entities → state machines → decisions → footguns)

CLI-Anything      → Agent-native CLI generation
                    (analyze → design → implement → test → package)

impeccable        → Design quality assurance
                    (typography → color → spacing → a11y → motion)

superset          → Analytics and visualization
                    (metrics → aggregation → dashboards → trends)

Tiz554            → Plugin ecosystem and skills
                    (registry → loader → triggers → dispatch)

opencode          → Core AI coding agent
                    (LSP → multi-LLM → build/plan → TUI)

Claw-Protect      → AI agent security framework
                    (injection → exfil → drift → secrets → trust)
```

---

## 8. Deployment Topology

```
                         ┌─────────────────────┐
                         │   Cloudflare (CDN)   │
                         └──────────┬──────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
           ┌────────┴────────┐          ┌───────────┴───────────┐
           │  Cloudflare     │          │  Cloudflare Workers    │
           │  D1 (SQLite)    │          │  (Control Plane)       │
           └─────────────────┘          └───────────┬───────────┘
                                                     │
                    ┌────────────────────────────────┼──────────────────┐
                    │                │                               │
           ┌────────┴────────┐     ┌─┴──────────────┐     ┌─────────┴─────────┐
           │  Node.js VPS    │     │  Modal Sandbox  │     │  Superset Server  │
           │  (Auth Service) │     │  (Agent Runtime)│     │  (Analytics)      │
           └─────────────────┘     └────────────────┘     └───────────────────┘
```

---

## 9. Extensibility

CodeNexus is designed to be extended through:

1. **MCP Servers** — Add new MCP servers for domain-specific tools
2. **Plugins** — Register plugins via the PluginSystem for custom triggers
3. **Skills** — Add skills to the skill registry for specialized tasks
4. **Detectors** — Add security detectors to Claw-Protect's detection engine
5. **Adapters** — Implement new module adapters for the orchestrator
6. **CLIs** — Generate agent-friendly CLIs for any application via CLI-Anything

> *"CodeNexus is not just a tool — it's an ecosystem where autonomous agents review, understand, fix, and learn from code."*
