#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "Cleaning build artifacts..."
find "$PROJECT_DIR" -name "node_modules" -type d -prune -exec echo "  Removing {}" \; -exec rm -rf {} \; 2>/dev/null || true
find "$PROJECT_DIR" -name "dist" -type d -not -path "*/node_modules/*" -prune -exec echo "  Removing {}" \; -exec rm -rf {} \; 2>/dev/null || true
find "$PROJECT_DIR" -name "*.tsbuildinfo" -type f -delete 2>/dev/null || true
echo "Clean complete"
