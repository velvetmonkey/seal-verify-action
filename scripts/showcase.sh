#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
exec node test/main.test.js 2>&1
