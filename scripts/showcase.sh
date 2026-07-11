#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo "=== seal-verify-action terminal showcase (exercises verify logic) ==="
node test/main.test.js 2>&1 | cat
echo "=== end (shows pass fixtures verify, bypass fails, etc.) ==="
