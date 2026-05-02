# CodeNexus — Agentic Code Review & Fix Platform

> **Fusing**: agent-reviews, authelia, background-agents, Book Synthesis, BookBridge, Business Logic MCP, CLI-Anything, impeccable, superset, Tiz554, opencode, and Claw-Protect into a unified agentic system.

## What It Is

CodeNexus is an **end-to-end, autonomous code review and fix platform** that combines 13 open-source projects into a single cohesive system. It detects PR review comments, analyzes code with full business and design context, applies fixes autonomously, and provides rich analytics — all secured by enterprise-grade authentication and threat detection.

```
                    ┌──────────────────────────────────────┐
                    │           CodeNexus System            │
                    ├──────────────────────────────────────┤
                    │  Auth ║ Control ║ Agent ║  Security  │
                    │  Plane ║ Plane   ║ Runtime║  Layer    │
                    ├──────────────────────────────────────┤
                    │  MCP Servers  ║  Knowledge Engine    │
                    │  (Business    ║  (Book Synthesis +   │
                    │   Logic,      ║   BookBridge)        │
                    │   CLI Gen)    ║                      │
                    ├──────────────────────────────────────┤
                    │  PR Mgmt ║ Design ║ Analytics║Plugin │
                    │  (reviews)║(review)║(superset)║System │
                    └──────────────────────────────────────┘
```

## Fused Projects

| # | Project | Role in CodeNexus |
|---|---------|-------------------|
| 1 | **agent-reviews** | GitHub PR comment fetching, bot detection, reply/resolve workflow |
| 2 | **authelia** | SSO authentication, 2FA, OIDC, role-based access control |
| 3 | **background-agents** | Async sandbox orchestration, control plane, Durable Objects |
| 4 | **Book-Synthesis** | Multi-source document synthesis with confidence scoring |
| 5 | **BookBridge** | Local knowledge library with hybrid search + MCP server |
| 6 | **Business-Logic-MCP** | Business rules, state machines, decision tables via MCP |
| 7 | **CLI-Anything** | Auto-generates CLI interfaces for any tool/app |
| 8 | **impeccable** | Design quality review with anti-pattern detection |
| 9 | **superset** | Analytics dashboard, data visualization, BI metrics |
| 10 | **Tiz554** | Plugin architecture, 24/7 worker, 1000+ skills |
| 11 | **opencode** | Core AI coding agent with TUI, LSP, multi-provider |
| 12 | **Claw-Protect** | Enterprise security: prompt injection, data exfil, monitoring |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CodeNexus Control Plane                       │
│  (Cloudflare Workers + Durable Objects + D1)                        │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │ Session │ │ WebSocket│ │ Sandbox  │ │ Scheduler│ │ Queue    │  │
│  │ Manager │ │ Hub      │ │ Lifecycle│ │          │ │ Manager  │  │
│  └─────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘  │
└─────────────────────────────────────────────────────────────────────┘
         │               │               │               │
         ▼               ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ Auth Service │ │ Agent Runtime│ │  MCP Servers │ │   Security   │
│  (authelia)  │ │  (opencode)  │ │  (×3 MCPs)   │ │  (Claw)     │
├──────────────┤ ├──────────────┤ ├──────────────┤ ├──────────────┤
│ • SSO/2FA    │ │ • LSP Client │ │ • Biz Logic  │ │ • Prompt Inj │
│ • OIDC       │ │ • Multi-LLM  │ │ • BookBridge │ │ • Exfil Det  │
│ • RBAC       │ │ • TUI        │ │ • CLI Gen    │ │ • Agent Mon  │
│ • Session    │ │ • Build/Plan │ │              │ │ • Zero Trust │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
         │               │               │               │
         ▼               ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  PR Manager  │ │  Design      │ │  Knowledge   │ │  Plugin Sys  │
│  (reviews)   │ │  Reviewer    │ │  Engine      │ │  (Tiz554)    │
├──────────────┤ ├──────────────┤ ├──────────────┤ ├──────────────┤
│ • Fetch PRs  │ │ • UI Audit   │ │ • Doc Synth  │ │ • Registry   │
│ • Bot Detect │ │ • Anti-pat   │ │ • TF-IDF    │ │ • Loader     │
│ • Reply      │ │ • Critique   │ │ • FTS5       │ │ • Skills     │
│ • Resolve    │ │ • Polish     │ │ • Citations  │ │ • Extensions │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
```

## The Review-Fix Cycle

```
┌──────────────────────────────────────────────────────────────┐
│                   Complete Review-Fix Cycle                    │
│                                                               │
│  1. PR DETECTED ──► GitHub webhook triggers CodeNexus        │
│  2. AUTH CHECK  ──► authelia validates user/permissions       │
│  3. FETCH PR    ──► agent-reviews gets all comments           │
│  4. CLASSIFY    ──► Bot vs Human, meta filtering              │
│  5. ANALYZE     ──► opencode reads code with LSP              │
│  6. CONTEXT     ──► Business-Logic-MCP provides domain rules  │
│  7. KNOWLEDGE   ──► BookBridge + Book-Synthesis search docs   │
│  8. DESIGN      ──► impeccable audits UI/UX quality           │
│  9. SECURITY    ──► Claw-Protect scans for vulnerabilities    │
│ 10. APPLY FIX   ──► Agent implements, tests, commits, pushes  │
│ 11. REPLY       ──► agent-reviews replies & resolves threads  │
│ 12. REPEAT      ──► Watch mode until no new comments          │
│ 13. LOG         ──► superset tracks metrics & analytics       │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# 1. Clone and install
git clone <repo-url> codenexus
cd codenexus

# 2. Install dependencies
./scripts/setup.sh

# 3. Configure
cp config.example.yml config.yml
# Edit config.yml with your GitHub tokens, auth settings, etc.

# 4. Run
codenexus review --pr 42 --repo owner/repo
```

## Module Structure

```
codenexus/
├── control-plane/       # Session management, orchestration (bg-agents)
├── auth-service/        # SSO, 2FA, OIDC, RBAC (authelia)
├── agent-runtime/       # AI coding agent (opencode)
├── mcp-servers/         # MCP protocol servers (×3)
│   ├── business-logic/  # Domain rules, state machines (Biz-Logic-MCP)
│   ├── bookbridge/      # Knowledge library search (BookBridge)
│   └── cli-generator/   # Auto-CLI generation (CLI-Anything)
├── security/            # Threat detection, monitoring (Claw-Protect)
├── knowledge-engine/    # Document synthesis (Book-Synthesis + BookBridge)
├── pr-manager/          # PR review management (agent-reviews)
├── design-reviewer/     # UI/UX quality auditing (impeccable)
├── analytics/           # BI dashboard, metrics (superset)
├── plugin-system/       # Plugin registry & loader (Tiz554)
├── cli-generator/       # CLI interface generation (CLI-Anything)
├── shared/              # Shared types, utilities, config
└── scripts/             # Build, deploy, setup scripts
```

## Configuration

All modules are configured through a unified `config.yml`:

```yaml
auth:
  provider: authelia
  jwt_secret: ${AUTH_JWT_SECRET}
  oidc:
    issuer: https://auth.codenexus.dev
    clients:
      - id: codenexus-cli
        secret: ${OIDC_CLIENT_SECRET}

github:
  token: ${GITHUB_TOKEN}
  app_id: ${GITHUB_APP_ID}
  webhook_secret: ${WEBHOOK_SECRET}

agent:
  provider: opencode
  model: claude-sonnet-4-20250514
  lsp_enabled: true
  max_depth: 2

security:
  prompt_injection: true
  data_exfiltration: true
  agent_monitoring: true

knowledge:
  book_directory: ./books
  max_sources: 5
  min_confidence: 0.7

analytics:
  provider: superset
  dashboard_url: https://analytics.codenexus.dev
```

## Development

```bash
# Run all tests
./scripts/test.sh

# Run specific module
cd control-plane && npm run dev

# Build for production
./scripts/build.sh

# Deploy
./scripts/deploy.sh
```

## Security

CodeNexus inherits the **15 critical AI agent protections** from Claw-Protect:
- **Prompt Injection Detection** — 20+ injection pattern signatures
- **Data Exfiltration Monitoring** — Outbound transfer analysis
- **Behavioral Drift Detection** — Baselining + anomaly detection
- **Least-Privilege Permission Tracking** — Role-based enforcement
- **Supply Chain Verification** — MCP tool source validation
- **Shadow Agent Discovery** — Unregistered process detection

## License

Apache 2.0 — Each fused project retains its original license.
