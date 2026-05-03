# Changelog

All notable changes to CodeNexus are documented in this file.

## [1.0.5] - 2026-05-03

### Added
- **ApplyFixes executor** (`control-plane/src/adapters/fix-executor.ts`): Real fix pipeline with clone → patch → verify → push
  - Clone PR head to temp workspace
  - Apply LLM-generated patches
  - Run test/lint/build verification
  - Push only on success
  - Return structured result with branch/SHA
- **CI integration job**: Runs `test:integration` after unit tests
- **pnpm-workspace.yaml**: Workspace configuration
- **turbo.json**: Pipeline orchestration

### Changed
- Root `package.json`: Updated `packageManager`, scripts use `turbo run`, `bin` points to `dist/index.js`
- **README.md**: Honest status section with Verified/In Progress/Planned

### Fixed
- CLI packaging: bin now points to built JS, not raw TypeScript

## [1.0.4] - 2026-05-03

### Fixed
- 22 pre-launch bugs across pr-manager, agent-runtime, cli-generator, security, session-manager, auth-service

## [1.0.3] - 2026-05-03

### Fixed
- Flaky test: tokenLimiter isTestMode guard
- sessionStore.destroy in afterAll
- Math.max(1000, PX) TTL guard

## [1.0.2] - 2026-05-03

### Fixed
- Plugin path.resolve base
- refresh_token RS256 id_token
- getSessionAsync live session validation

## [1.0.1] - 2026-05-03

### Fixed
- Plugin loader restrict to plugins/ dir
- jose auth in register
- OIDC state CSRF
- RS256 id_token signing
- authorizationCodes Redis note

## [1.0.0] - 2026-05-01

### Added
- Competitive build with Semgrep SAST, LLM provider (DeepSeek/OpenCode/OpenRouter), AST analyzers (TS/Python/Java), Node.js adapter, GitHub App PR decoration, PR stack detection
- 250+ tests (111 E2E + 130 unit + 10 integration)
- Initial architecture and modules