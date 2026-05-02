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
    echo "SKIP: $module (no package.json)"
    continue
  fi
  echo "=== Testing: $module ==="
  pushd "$PROJECT_DIR/$module" > /dev/null
  if grep -q '"test"' package.json 2>/dev/null; then
    npm test || FAILED=$((FAILED + 1))
  else
    echo "  No test script defined"
  fi
  popd > /dev/null
  echo ""
done

if [ "$FAILED" -gt 0 ]; then
  echo "$FAILED module(s) failed tests"
  exit 1
fi
echo "All tests passed"
