# seal-verify-action

**Add this to CI. A receipt that no longer re-derives turns the build red.**

For every matched receipt the action re-derives the verdict from the receipt's own policy and call through the pinned, audited Seal kernel. Tampered, bypassed, or stale = fail the step (with annotations on the PR).

![Action](https://img.shields.io/badge/type-JS%20action%20(node20)-black)
![Domain](https://img.shields.io/badge/domain-MCP%20mediation-informational)
![License](https://img.shields.io/badge/license-Apache--2.0-blue)

<!-- truthbox:begin -->
> **Runtime profile: `compatible` (inherited).** This action re-runs a vendored, sha256-pinned copy of `seal verify`; it inherits that verifier's profile and proofs and adds none of its own. Strict `canonical-l0` is proved and modelled, not the deployed route yet.
> **Claim:** in CI, the action re-derives every matched receipt through the pinned vendored verifier; a receipt that no longer re-derives — tampered, bypassed, or stale — turns the build red.
> **Non-claim:** it does NOT re-prove the kernel — it inherits it from the pinned copy (see VENDORED.md) — and it trusts the receipt's producer (seal-host). A green build attests re-derivation of the receipts it was handed, not that the producing system is correct, nor that an unmediated effect left a receipt to check.
<!-- truthbox:end -->
> Map: canonical claims in [docs/LIMITATIONS.md](docs/LIMITATIONS.md) · truth box in [docs/TRUTH-BOX.md](docs/TRUTH-BOX.md) · family: [seal](https://github.com/velvetmonkey/seal). Inheritance, not ownership — the verifier's home is [seal-assurance-kit](https://github.com/velvetmonkey/seal-assurance-kit) (see [VENDORED.md](VENDORED.md)).

## Luxury 10-second onboarding (copy-paste)

```bash
bash scripts/showcase.sh
```

Runs the **same vendored verifier the action runs**, over the bundled fixtures:
`fixtures/pass/allow.receipt.json` prints `PASS VERIFIED`; `fixtures/fail/bypass.receipt.json`
prints `NOT MEDIATED` and fails — exactly the receipt that would turn a build red. Exit 0
when both behave as documented.

Verify a single receipt yourself (no CI, no network):

```bash
node -e 'require("./vendor/seal-assurance-kit/src/verify.cjs").verify("fixtures/pass/allow.receipt.json")'
# -> receipt verdict: ALLOW ... PASS VERIFIED
```

Then in CI:

```yaml
- uses: velvetmonkey/seal-verify-action@v1
  with:
    receipts: "**/*.receipt.json"
```

Bad receipt = red build. Visible in terminal.

## Trust boundaries

These are the four explicit places where Seal's proofs stop. They are strengths because the boundaries are known and each is closed by a named, auditable mechanism outside the kernel.

1. Byzantine / non-participating replica — non-bypass proven for replicas that RUN the gate; a replica not running seal is outside the TCB by definition. Closes via: attestation of the sealed core.
2. Egress after allow (P6) — seal mediates the DECISION and records it, not the downstream effect. Closes via: compose with an egress proxy; decision gate by design. (Already in RUST_BRIDGE.md.)
3. Model vs compiled binary — proofs bind the routing core the code delegates to (Ffi.stepImpl → composed kernels), not a byte-for-byte proof of the compiled wasm; strongest in category. Closes via: the binary differential (Lane C), a wasm-vs-Lean-decide oracle.
4. Partition liveness — safety (no double-spend) holds unconditionally under partition; liveness is conditional, inherited from crdt-lean. The correct safety-over-availability tradeoff.

## Usage

A complete workflow that fails the build on any receipt that no longer re-derives:

```yaml
name: verify-receipts
on: [push, pull_request]
jobs:
  seal-verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: velvetmonkey/seal-verify-action@v1
        with:
          receipts: "**/*.receipt.json"   # glob(s) or newline-separated paths
          # working-directory: .          # where patterns resolve
          # fail-on: any                  # 'never' to report without failing
```

Every matched receipt is re-derived through the pinned, vendored verifier; a tampered,
bypassed, or stale receipt gets an `::error` annotation on its file and fails the step.
A glob that matches nothing fails closed. Full knobs in [Inputs](#inputs) below; the exact
checks in [What this checks — and what it does not](#what-this-checks--and-what-it-does-not).

## Inputs

| input | default | meaning |
|---|---|---|
| `receipts` | `**/*.receipt.json` | Glob pattern(s) or newline-separated paths, resolved under `working-directory`. Supports `**`, `*`, `?` and literal paths; no character classes. |
| `working-directory` | `.` | Directory patterns are resolved against. |
| `fail-on` | `any` | `any`: fail the step if any receipt fails. `never`: report only (annotations, summary, and outputs are still produced). |
| `verifier-version` | `""` | Optional label echoed in the step summary next to the vendored pin. Informational only. |

## Outputs

| output | meaning |
|---|---|
| `verified` | Count of receipts that verified (PASS VERIFIED). |
| `failed` | Count that failed: NOT VERIFIED, NOT MEDIATED (bypass receipt), verifier error, or a listed file that does not exist. |

## Behaviour

- Each failing receipt gets a `::error` annotation on the file, so failures
  land on the PR diff.
- A grouped pass/fail table is written to the job's step summary, including
  the exact vendored verifier version and commit.
- **Zero matched receipts fails the step regardless of `fail-on`** — a glob
  that matches nothing is a misconfiguration, and a gate that silently passes
  on a typo is worse than no gate. Missing literal paths likewise count as
  failures rather than being dropped.
- Deterministic and hermetic: no network, no clock, receipts processed in
  sorted order. The verifier is a vendored, sha256-pinned copy of
  `seal verify` from seal-assurance-kit (see [VENDORED.md](VENDORED.md)) —
  consumers install nothing.

## What this checks — and what it does not

For each receipt, the vendored verifier checks the receipt is **well-formed**
(schema-valid), **canonical** (stored canonical request equals the line
re-derived from the receipt's own tool + arguments, hashes match), and
**re-derivable** (the same pinned kernel, fed the receipt's own policy and
call, reproduces the verdict and the emitted decision bytes). Bypass receipts
are reported NOT MEDIATED, never "verified".

It does **not**:

- prove the policy in the receipt is a *good* policy — only that the verdict
  follows from it;
- prove the receipt's field set is *sufficient* to authorize the effect
  (that analysis is witness-check's job);
- tell you whether two receipts authorize the same thing — that comparison
  is `seal receipt-diff`'s job (in seal-assurance-kit);
- prove anything about effects that produced **no receipt at all** — an
  unmediated call leaves nothing for this action to inspect;
- extend the Seal proof story: the Lean theorems cover the mediation kernel;
  this action is packaging around the conformance-tested verifier, tied to
  the proof by the pinned kernel hash, not by a theorem about this repo.

## Mandatory non-claims (inherited)

This action **inherits** the Seal family's non-claims — it re-runs a vendored,
sha256-pinned copy of the verifier and strengthens none of them — and adds a few
specific to being a CI wrapper. Canonical copy: [docs/LIMITATIONS.md](docs/LIMITATIONS.md);
`scripts/claims-drift.mjs` fails the build if this mirror drifts.

<!-- claims:begin -->
- Seal proves properties of the mediation KERNEL, not of the whole deployed system.
- Seal does NOT prove SHA-256 collision resistance in Lean; it is a named, scoped cryptographic assumption (A-CR).
- The deployed Rust / wasm / JS are NOT proven bug-free; they are tied to the proof by byte-exact conformance testing over a corpus, not for every possible input.
- Seal guarantees AUTHORIZATION match, not INTENT match: if a human approves a malicious-but-valid request, Seal will execute it.
- Seal does NOT prevent compromise of hosts, browsers, build systems, keys, operators, or downstream tools.
- Seal's audit chain is tamper-EVIDENT, not tamper-IMPOSSIBLE.
- Seal does NOT make the AI smarter or prevent hallucinations; it stops an unapproved effect.
- Axiom footprint {propext, Classical.choice, Quot.sound} is the minimal classical fragment; no extra axioms.
- seal-verify-action does NOT re-prove the kernel: it re-runs a vendored, sha256-pinned copy of `seal verify` (see VENDORED.md) and inherits exactly that verifier's guarantees and limits — no more.
- A green build attests only that the matched receipts re-derived through the pinned verifier; it is NOT evidence that the producing system (seal-host) is correct, nor that any unmediated effect left a receipt to check.
- The action adds no theorem about itself; its trust rests on the pin (the sha256 of the vendored verifier) and the receipt's producer, not on this repo.
<!-- claims:end -->

## Where this sits in the receipt toolset

| question | tool |
|---|---|
| Is this receipt well-formed, canonical, and re-derivable? | `seal verify` (seal-assurance-kit) — what this action runs |
| Does the field set carry **enough** to justify the claim? | `witness-check` — the sufficiency analyzer (private) |
| What changed between two receipts — does it touch what is **authorized**? | `seal receipt-diff` (seal-assurance-kit) |
| Gate receipts in CI | `seal-verify-action` — this action (the sufficiency and diff checks are local tools today) |

Receipts are produced by [seal-host](https://github.com/velvetmonkey/seal-host), the
deployable gate this action's checks sit downstream of; the vendored verifier's home is
[seal-assurance-kit](https://github.com/velvetmonkey/seal-assurance-kit). Family map:
[seal](https://github.com/velvetmonkey/seal).

## Why the action is not bundled

`dist/index.js` is a plain entry, not an ncc/esbuild bundle. The vendored
verifier loads its wasm kernel from disk, hashes the actual binary, and
resolves sibling modules via `__dirname` / `file://` dynamic import — all of
which bundling would break. JS actions run from the fully checked-out action
repository, so plain `require()` is sufficient and there is no build step at
all.

## Development

```sh
npm test          # node --test: glob, reporting, plumbing, end-to-end on fixtures
```

The `selftest` workflow runs the action against the bundled fixture corpus:
three receipts that must verify, one bypass receipt that must fail the step,
a zero-match misconfiguration that must fail closed, and a report-only run.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE) (the verifier and
kernel are vendored from seal-assurance-kit / seal-check, also Apache-2.0).
