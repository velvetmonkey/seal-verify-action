#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo 'Luxury 10s showcase for seal-verify-action:'
cat action.yml | head -20
echo '--- fixtures ---'
ls fixtures/ | cat
echo 'To run in CI: uses: velvetmonkey/seal-verify-action@v1 with receipts glob'
