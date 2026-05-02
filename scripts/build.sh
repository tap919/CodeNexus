#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# CodeNexus - Build Script
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

echo "🔨 Building CodeNexus modules..."

MODULES=(
  "shared"
  "control-plane"
  "auth-service"
  "agent-runtime"
  "mcp-servers"
  "security"
  "knowledge-engine"
  "pr-manager"
  "design-reviewer"
  "analytics"
  "plugin-system"
  "cli-generator"
)

for module in "${MODULES[@]}"; do
  if [ -f "$PROJECT_DIR/$module/package.json" ]; then
    echo "   → Building $module..."
    cd "$PROJECT_DIR/$module"

    if grep -q '"build"' package.json 2>/dev/null; then
      npm run build 2>&1 | sed 's/^/     /'
    else
      npx tsc --noEmit --pretty 2>&1 | sed 's/^/     /' || {
        echo "  WARNING: TypeScript compilation has errors in $module"
      }
    fi

    cd "$PROJECT_DIR"
    echo "   ✓ $module built"
  fi
done

echo ""
echo "✅ Build complete!"
