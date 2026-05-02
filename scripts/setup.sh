#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# CodeNexus - Setup Script
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║            CodeNexus - Setup                             ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

# ─── Check prerequisites ─────────────────────────────────────
echo "🔍 Checking prerequisites..."

command -v node &>/dev/null || { echo "❌ Node.js is required. Install from https://nodejs.org"; exit 1; }
command -v npm &>/dev/null || { echo "❌ npm is required."; exit 1; }

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
echo "   Node.js version: $(node -v)"
echo "   npm version: $(npm -v)"

if [ "$NODE_VERSION" -lt 18 ]; then
  echo "❌ Node.js 18+ required (found: $(node -v))"
  exit 1
fi

# Optional tools
if command -v git &>/dev/null; then
  echo "   ✓ git detected"
else
  echo "   ⚠ git not found (optional, some features will be unavailable)"
fi

if command -v wrangler &>/dev/null; then
  echo "   ✓ wrangler CLI detected (Cloudflare Workers)"
else
  echo "   ⚠ wrangler CLI not found (install with: npm install -g wrangler)"
fi

# ─── Install dependencies ────────────────────────────────────
echo ""
echo "📦 Installing dependencies..."

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
  echo ""
  echo "   → Installing $module..."
  cd "$PROJECT_DIR/$module"

  if [ -f "package.json" ]; then
    npm install --loglevel=warn 2>&1 | sed 's/^/     /'
    echo "   ✓ $module installed"
  else
    echo "   ⚠ No package.json found in $module, skipping"
  fi

  cd "$PROJECT_DIR"
done

# ─── Build TypeScript modules ────────────────────────────────
echo ""
echo "🔨 Building TypeScript modules..."

for module in "${MODULES[@]}"; do
  if [ -f "$PROJECT_DIR/$module/package.json" ]; then
    echo "   → Building $module..."
    cd "$PROJECT_DIR/$module"
    npx tsc --noEmit --pretty 2>&1 | sed 's/^/     /' || {
      echo "  WARNING: TypeScript compilation has errors in $module"
    }
    cd "$PROJECT_DIR"
  fi
done

# ─── Configuration ───────────────────────────────────────────
echo ""
echo "⚙ Configuring..."

if [ ! -f "$PROJECT_DIR/config.yml" ]; then
  cp "$PROJECT_DIR/config.example.yml" "$PROJECT_DIR/config.yml"
  echo "   ✓ Created config.yml from config.example.yml"
  echo "   ⚠ Edit config.yml with your tokens and settings"
else
  echo "   ✓ config.yml already exists"
fi

# ─── Create data directories ────────────────────────────────
echo ""
echo "📁 Creating data directories..."

mkdir -p "$PROJECT_DIR/data"
mkdir -p "$PROJECT_DIR/books"
mkdir -p "$PROJECT_DIR/plugins"
mkdir -p "$PROJECT_DIR/generated-clis"
mkdir -p "$PROJECT_DIR/logs"

echo "   ✓ Data directories created"

# ─── Summary ─────────────────────────────────────────────────
echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║            Setup Complete!                               ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""
echo "   Next steps:"
echo "   1. Edit config.yml with your credentials"
echo "   2. Run 'codenexus auth --login' to authenticate"
echo "   3. Run 'codenexus review --pr 42 --repo owner/repo'"
echo ""
echo "   Module status:"
for module in "${MODULES[@]}"; do
  if [ -f "$PROJECT_DIR/$module/package.json" ]; then
    echo "   ✓ $module"
  else
    echo "   - $module (not installed)"
  fi
done
echo ""
echo "   Happy reviewing! 🚀"
