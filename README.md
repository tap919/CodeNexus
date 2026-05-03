# CodeNexus — Agentic PR Review and Fix Platform

> A modular PR review and fix platform with webhook ingestion, security scanning, and autonomous fix execution.

## What It Is

CodeNexus is a **PR review and remediation platform** that provides a verified vertical slice:

- **Webhook ingestion** — accepts GitHub PR events via HTTP
- **PR diff retrieval** — fetches real unified diffs from GitHub API
- **Security analysis** — scans diffs for secrets, prompt injection, supply chain issues
- **Design review** — anti-pattern detection for code quality
- **PR comments** — generates structured review reports
- **Automated fixes** — applies LLM-suggested patches with verification before push

```
                    ┌──────────────────────────────────────┐
                    │         CodeNexus System              │
                    ├──────────────────────────────────────┤
                    │  Webhook → Diff → Security → Comment │
                    │          → Fix → Verify → Push      │
                    ├──────────────────────────────────────┤
                    │  Adapters: PR, Security, Execution  │
                    └──────────────────────────────────────┘
```

## Current Status

### ✅ Verified (Working End-to-End)
- Webhook server with HMAC signature verification
- PR diff fetching via GitHub API
- Security scanning (secrets, prompt injection)
- PR comment generation
- ApplyFixes executor with test/lint/build verification

### 🟡 In Progress
- Design review anti-pattern detection
- Knowledge engine integration
- MCP server business logic validation

### 📋 Planned
- Full autonomous fix with PR creation
- Multi-repo support
- Analytics dashboard

## Influences and Integrated Concepts

CodeNexus draws inspiration from multiple open-source systems for its modular architecture:

| Inspiration | Area |
|------------|------|
| **agent-reviews** | PR comment fetching and processing |
| **Claw-Protect** | Security scanning (secrets, injection) |
| **opencode** | Agent runtime patterns |
| **impeccable** | Design review patterns |
| **background-agents** | Orchestration patterns |
| **superset** | Analytics patterns |

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
