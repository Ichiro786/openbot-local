#!/usr/bin/env bash
# Runs only the protected migration fixtures and the disposable process E2E.
set -euo pipefail
SOURCE=${1:?patched upstream source directory}
REPORT_DIR=${OUT_DIR:?engine output directory}/upgrade-checks
NODE=${NODE_BIN:-node}
export PATH="$(dirname "$(command -v "$NODE")"):$PATH"
mkdir -p "$REPORT_DIR"
cd "$SOURCE"
"${BUN_BIN:-bun}" run typecheck:node
for test in openbot-database-schema-parity browser-proxy-migration routine-run-place-migration agent-skill-loads-migration messaging-pings-migration agent-memory-site-migration; do
  "${BUN_BIN:-bun}" run test:desktop -- "src/backend/$test.test.ts" --maxWorkers=1 \
    --reporter=json --outputFile="$REPORT_DIR/$test.json"
done
"$NODE" --import tsx scripts/openbot-local-engine-upgrade-e2e.ts "$REPORT_DIR"
