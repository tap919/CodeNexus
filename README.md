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

### 🟡 In Development
- Run context propagation between steps
- Integration test vertical slice
- CI pipeline enforcement

### 📋 Planned
- Full autonomous fix with PR creation
- Multi-repo support
- Analytics dashboard

## Verified Workflow

```
Webhook → Validate signature → Fetch PR diff → Security scan → Generate comment → Post to PR
                                              ↓
                                    ApplyFixes (optional)
                                              ↓
                                    Test/Lint/Build → Push on success
```

## Architecture

```
┌─────────────────────────────────────┐
│    Control Plane (Orchestrator)     │
│  Session management, step execution │
└─────────────────┬───────────────────┘
                  │
      ┌───────────┼───────────┐
      ▼           ▼           ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│PR Manager│ │Security  │ │Fix      │
│ Adapter │ │ Adapter │ │Executor │
└──────────┘ └──────────┘ └──────────┘
     │           │           │
     ▼           ▼           ▼
 GitHub API   Diff scan   Workspace
```

For more architecture details, see `ARCHITECTURE.md`.

## Influences

CodeNexus draws architectural inspiration from:

| System | Area |
|--------|------|
| agent-reviews | PR comment patterns |
| Claw-Protect | Security scanning patterns |
| opencode | Agent runtime patterns |

## Quick Start

```bash
# 1. Clone and install (requires pnpm)
git clone https://github.com/tap919/CodeNexus.git
cd CodeNexus
pnpm install

# 2. Build workspace
pnpm run build

# 3. Configure environment
export CNX_GITHUB_TOKEN=your_github_token
export CNX_GITHUB_WEBHOOK_SECRET=your_webhook_secret

# 4. Run tests
pnpm run test:integration
```

## Module Structure

```
codenexus/
├── control-plane/       # Orchestration, webhook server
├── auth-service/        # Authentication service
├── agent-runtime/       # AI agent runtime
├── security/           # Security scanning
├── pr-manager/          # GitHub PR operations
├── design-reviewer/     # Design reviewing
├── knowledge-engine/    # Knowledge retrieval
├── analytics/           # Analytics
├── plugin-system/       # Plugin system
├── cli-generator/      # CLI generation
├── shared/              # Shared types
├── packages/            # Shared packages
├── mcp-servers/        # MCP servers
└── apps/              # Applications
```

## Configuration

Set these environment variables:

```bash
# Required
export CNX_GITHUB_TOKEN=github_pat_xxx

# Webhook (for server mode)
export CNX_GITHUB_WEBHOOK_SECRET=your_secret

# Optional
export CNX_AUTH_JWT_SECRET=min_16_char_secret
export CNX_AGENT_PROVIDER=openai
export CNX_AGENT_MODEL=gpt-4o
```

## Development

```bash
# Build entire workspace
pnpm run build

# Run all tests
pnpm run test

# Run integration tests
pnpm run test:integration

# Lint
pnpm run lint

# Development server (control-plane node adapter)
cd control-plane && pnpm run dev:node
```

## License

Apache 2.0 — CodeNexus is an original implementation.