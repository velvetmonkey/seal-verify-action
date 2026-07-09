# seal-verify-action: reusable GitHub Action wrapping `seal verify`

Distribution move: Seal receipt verification as a three-line CI step. Pure
packaging — no new verification logic; the action wraps the existing
`seal verify` from seal-assurance-kit.

## What's here

- `action.yml` — JS action, `node20`, `main: dist/index.js`, Marketplace-shaped
  (branding, honest description) but **not** published to Marketplace.
- `dist/index.js` + `lib/` — input parsing, hand-rolled glob subset
  (`**`/`*`/`?`; node20 has no `fs.glob` and the repo is zero-dep), sequential
  in-process verification (the wasm kernel is a module singleton), `::error`
  annotations, step-summary table, `verified`/`failed` outputs.
- `vendor/seal-assurance-kit/` — the seven-file dependency closure of
  `seal verify`, byte-identical to upstream, sha256-pinned in VENDORED.md and
  re-checked by CI on every run.
- `fixtures/` — the kit's receipt corpus: allow/block/crosstool must verify,
  bypass must fail.
- Workflows: `ci.yml` (unit tests, no-mutation guard, vendor drift guard) and
  `selftest.yml` (runs the action against the fixtures, asserting both the
  passing and the failing paths, zero-match fail-closed, and report-only mode).

## Load-bearing decision 1: vendored pin, not npx

The action **vendors** the verifier rather than `npx`-ing a published package:

- seal-assurance-kit is not published to npm (version 0.0.1), so a
  published-version route does not currently exist;
- vendoring makes runs hermetic — no network, no install step, no risk that a
  registry outage or a mutated dist-tag changes what a CI gate executes;
- cost: staleness. When the kit or kernel bumps, this copy does not move.
  Mitigations: the pin (version + commit + per-file sha256) is recorded in
  VENDORED.md and `lib/pin.js`, echoed in every step summary, and CI fails if
  the vendored bytes drift from the recorded hashes. Re-vendoring is a
  documented five-step procedure.

If/when the kit is published to npm, an `npx`-based mode can be revisited; the
default should likely remain vendored for the hermeticity argument above.

## Load-bearing decision 2: licensing of the vendored verifier

Apache-2.0 → Apache-2.0, obligations discharged in-repo:

- LICENSE: full Apache-2.0 text (§4a);
- NOTICE: this repo's copyright plus the kit's NOTICE reproduced verbatim,
  because the kit itself vendors the kernel + glue from seal-check and we
  redistribute those transitively (§4d);
- per-file `SPDX-License-Identifier: Apache-2.0` headers retained on all
  vendored files;
- zero modifications to vendored files (so no §4b changed-file notices are
  needed) — enforced by the CI sha256 drift guard.

Substantively the vendored code is first-party to the Seal family, so the
ceremony is belt-and-braces.

**Emscripten footnote for the public-flip review:**
`kernel/wasm/seal.js` is Emscripten-generated glue and may contain Emscripten
runtime snippets (MIT, Apache-compatible). The upstream kit NOTICE does not
currently acknowledge Emscripten — a pre-existing gap there, not one created
by this vendoring. This repo's NOTICE adds the Emscripten provenance line;
the kit may want the same line upstream.

## Honest scope (stated in README + action description)

The action checks each receipt is well-formed, canonical, and re-derivable
from its own policy and call through the pinned audited kernel. It does NOT
prove the policy is correct, nor that the receipt's field set is sufficient
to authorize the effect (witness-check's job), nor anything about effects
that produced no receipt.

## Verification

- `npm test`: 30/30 (`node --test`) — glob subset, aggregation, annotation
  escaping, plumbing, and end-to-end runs over the fixture corpus with fake
  `GITHUB_OUTPUT`/`GITHUB_STEP_SUMMARY`.
- Local simulated-action runs (real `dist/index.js` entry): pass corpus →
  exit 0, 3/0; bypass → exit 1, 0/1 + `::error file=`; zero-match with
  `fail-on: never` → still exit 1; full corpus report-only → exit 0, 3/1.
- Vendored files byte-identical to kit @ `f08bda85` (sha256-compared at copy
  time and on every CI run).
- `selftest` workflow green (see Actions tab).
