#!/usr/bin/env bash
# Runs the end-to-end test on a fresh local database:
#   stand-in services (Razorpay, Zoho, Resend, Google) + `wrangler dev` + test/e2e.mjs
# Needs .dev.vars (copy .dev.vars.example). Usage: bash test/run-e2e.sh
set -euo pipefail
cd "$(dirname "$0")/.."
WRANGLER="${WRANGLER:-npx wrangler}"
export NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost WRANGLER_SEND_METRICS=false CI=1
[ -f .dev.vars ] || cp .dev.vars.example .dev.vars

# A dev server left over from an interrupted run would answer with old code.
pkill -f "wrangler dev --port 8787" 2>/dev/null || true; pkill -f "mock-services.mjs 8899" 2>/dev/null || true; sleep 1
rm -rf .wrangler/state
mkdir -p .wrangler   # no migration step: the Worker creates its own tables (src/schema.js)

node test/mock-services.mjs 8899 > .wrangler/mock.log 2>&1 & MOCK=$!
$WRANGLER dev --port 8787 --ip 127.0.0.1 --test-scheduled > .wrangler/dev.log 2>&1 & DEV=$!
cleanup() { kill $MOCK $DEV 2>/dev/null || true; pkill -P $DEV 2>/dev/null || true; pkill -f "wrangler dev --port 8787" 2>/dev/null || true; }
trap cleanup EXIT

for i in $(seq 1 60); do curl -s -o /dev/null http://127.0.0.1:8787/api/products && break; sleep 1; done
node test/e2e.mjs http://127.0.0.1:8787 http://127.0.0.1:8899
