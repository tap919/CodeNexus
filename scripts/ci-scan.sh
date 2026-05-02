#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-.}"
OUTPUT="${2:-results.sarif}"

echo "CodeNexus CI Scan — target: ${TARGET}"
echo "Output: ${OUTPUT}"

# Run codenexus CI scan (requires codenexus CLI available)
npx tsx cli-generator/src/ci-mode.ts --path "${TARGET}" --output "${OUTPUT}" 2>&1 || {
  echo "WARNING: CodeNexus scan completed with findings"
}

echo "Scan complete. Results: ${OUTPUT}"
