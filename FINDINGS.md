# seal-verify-action — Claim Audit Findings

Sampled from README, "What this checks", usage, outputs, non-claims.

Backed by: lib/verify-runner.js + main.js + test/, fixtures/ (pass/fail), vendored kit.

All "fails the build", "zero matched = fail", "pinned" preserved.

## Sampled

| Claim | Backed? | Evidence | Action |
|-------|---------|----------|--------|
| Re-derives verdict from receipt's policy+call via pinned kernel; fails build on bad receipt. | Yes (runnable in CI) | lib/ + action.yml + test/main.test.js + fixtures/fail/ | keep |
| Zero matched receipts fails the step (misconfig). | Yes (tested) | lib/main.js + test | keep |
| Deterministic, hermetic, vendored+sha256-pinned from assurance-kit as a maintained downstream-stricter fork (signed-config trust anchor; five named delta files). | Yes (documented + VENDORED.md) | VENDORED.md + package | keep |

## NEEDS BEN
- Actual GH Actions run (fixtures + code + vendored provide the verification).

See VENDORED.md + family.