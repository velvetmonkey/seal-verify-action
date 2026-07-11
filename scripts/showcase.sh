#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
# Luxury onboarding showcase: run the SAME vendored verifier the action runs,
# over the bundled fixtures, so you see the real PASS / FAIL before wiring CI.
set -euo pipefail
cd "$(dirname "$0")/.."

exec node - "$@" <<'NODE'
const { verify } = require("./vendor/seal-assurance-kit/src/verify.cjs");

const cases = [
  { file: "fixtures/pass/allow.receipt.json", expect: true,  note: "a good ALLOW receipt -> PASS VERIFIED" },
  { file: "fixtures/fail/bypass.receipt.json", expect: false, note: "a bypass receipt -> NOT MEDIATED, fails the step" },
];

(async () => {
  let ok = true;
  for (const c of cases) {
    console.log("\n================================================================");
    console.log(`# ${c.file}  (${c.note})`);
    console.log("================================================================");
    let passed;
    try {
      passed = await verify(c.file);
    } catch (e) {
      console.error("verifier error:", e.message);
      passed = "error";
    }
    if (passed !== c.expect) {
      console.error(`SHOWCASE MISMATCH: ${c.file} expected ${c.expect}, got ${passed}`);
      ok = false;
    }
  }
  console.log("\n================================================================");
  console.log(ok
    ? "showcase OK: good receipt VERIFIED, bypass receipt FAILED — exactly what the CI gate does."
    : "showcase FAILED: fixtures did not verify as documented.");
  console.log("In CI, `bypass.receipt.json` failing is a RED build. That is the point.");
  process.exit(ok ? 0 : 1);
})();
NODE
