#!/usr/bin/env bash
# Capture a StackProof scan as NDJSON and convert to Rescue Room trace format.
#
# Usage:
#   ./scripts/capture-stackproof-scan.sh <github-repo-url> [cookie-file]
#
# The cookie file should contain a valid next-auth session cookie.
# If omitted, tries to read from ~/.stackproof-cookie
#
# Output:
#   data/traces/stackproof-scan-raw.ndjson   (raw NDJSON stream)
#   data/traces/stackproof-scan.json          (Rescue Room trace format)

set -euo pipefail

REPO_URL="${1:?Usage: $0 <github-repo-url> [cookie-file]}"
COOKIE_FILE="${2:-$HOME/.stackproof-cookie}"
API_URL="${STACKPROOF_URL:-http://localhost:3000}/api/analysis/scan"
OUTPUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/data/traces"

mkdir -p "$OUTPUT_DIR"
RAW_FILE="$OUTPUT_DIR/stackproof-scan-raw.ndjson"
TRACE_FILE="$OUTPUT_DIR/stackproof-scan.json"

if [[ ! -f "$COOKIE_FILE" ]]; then
  echo "Cookie file not found: $COOKIE_FILE"
  echo ""
  echo "To create it:"
  echo "  1. Open StackProof in your browser and log in"
  echo "  2. Open DevTools > Application > Cookies"
  echo "  3. Copy the full Cookie header value"
  echo "  4. Save it to $COOKIE_FILE"
  echo ""
  echo "Or paste the cookie value now (Ctrl-C to cancel):"
  read -r COOKIE_VALUE
  echo "$COOKIE_VALUE" > "$COOKIE_FILE"
fi

COOKIE="$(cat "$COOKIE_FILE")"

echo "Scanning: $REPO_URL"
echo "API: $API_URL"
echo "Output: $RAW_FILE"
echo ""

# Fire the scan and capture NDJSON stream
curl -sS -N \
  -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d "{\"repoUrl\": \"$REPO_URL\"}" \
  | tee "$RAW_FILE"

echo ""
echo "Raw NDJSON saved to: $RAW_FILE"
echo "Lines captured: $(wc -l < "$RAW_FILE")"
