#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

MODULES=(
  "shared" "auth-service" "control-plane" "security" "pr-manager"
  "knowledge-engine" "mcp-servers" "design-reviewer" "analytics"
  "plugin-system" "cli-generator" "agent-runtime"
)

FAILED=0
for module in "${MODULES[@]}"; do
  if [ ! -f "$PROJECT_DIR/$module/package.json" ]; then
    continue
  fi
  echo "=== Linting: $module ==="
  pushd "$PROJECT_DIR/$module" > /dev/null
  npx tsc --noEmit --pretty 2>&1 || FAILED=$((FAILED + 1))
  if grep -q '"lint"' "$PROJECT_DIR/$module/package.json" 2>/dev/null; then
    npm run lint || FAILED=$((FAILED + 1))
  fi
  popd > /dev/null
  echo ""
done

if [ "$FAILED" -gt 0 ]; then
  echo "WARNING: $FAILED module(s) have lint/type errors (non-blocking)"
fi
echo "Lint check complete"
