#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# CodeNexus - Deploy Script
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

ENVIRONMENT="${1:-development}"
echo "🚀 Deploying CodeNexus to $ENVIRONMENT"

# Build all modules first
echo "🔨 Building all modules..."
./scripts/build.sh

# Deploy control plane to Cloudflare Workers
if command -v wrangler &>/dev/null; then
  echo "☁️  Deploying control plane to Cloudflare Workers..."
  cd "$PROJECT_DIR/control-plane"

  if [ "$ENVIRONMENT" = "production" ]; then
    npx wrangler deploy --env production
  else
    npx wrangler deploy --env development
  fi

  cd "$PROJECT_DIR"
  echo "   ✓ Control plane deployed"
else
  echo "   ⚠ wrangler CLI not found, skipping Cloudflare deployment"
fi

# Deploy auth service
echo "🔐 Deploying auth service..."
cd "$PROJECT_DIR/auth-service"
if [ "$ENVIRONMENT" = "production" ]; then
  NODE_ENV=production npm run build
  # Deploy to your hosting platform (Docker, VPS, etc.)
  docker build -t codenexus/auth-service:latest .
  echo "   ✓ Auth service image built"
else
  echo "   ✓ Auth service ready for development"
fi
cd "$PROJECT_DIR"

echo ""
echo "✅ Deployment complete!"
