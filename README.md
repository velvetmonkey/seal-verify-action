# seal-verify-action

[![CI](https://github.com/velvetmonkey/seal-verify-action/actions/workflows/ci.yml/badge.svg)](https://github.com/velvetmonkey/seal-verify-action/actions/workflows/ci.yml)
[![selftest](https://github.com/velvetmonkey/seal-verify-action/actions/workflows/selftest.yml/badge.svg)](https://github.com/velvetmonkey/seal-verify-action/actions/workflows/selftest.yml)

**Add this to CI. Green means the signed config is authentic, replay-consistent where replay applies, and authorised by your independently provisioned operator-key pin.**

For every matched receipt the action verifies its exact Ed25519 `signed_config` and requires the signer to match `expected-config-pubkey`; every replay-applicable receipt is replayed through the pinned kernel (`28bb3ae7…`, see VENDORED.md) (§11.1 unparseable-request receipts verify by raw line identity instead, and the coverage is reported as `kernel_replay_scope`). Tampered, bypassed, stale, unpinned, or wrongly signed = fail the step.

## 10-second onboarding (copy-paste)

```bash
bash scripts/showcase.sh
```

Runs the **same vendored verifier the action runs**, over the bundled fixtures:
`fixtures/pass/allow.receipt.json` prints `PASS AUTHORISED`; `fixtures/fail/bypass.receipt.json`
prints `NOT MEDIATED` and fails — exactly the receipt that would turn a build red. Exit 0
when both behave as documented.

Verify a single receipt yourself (no CI, no network):

```bash
node -e 'require("./vendor/seal-assurance-kit/src/verify.cjs").verify("fixtures/pass/allow.receipt.json", {expectedConfigPubkey:"d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"})'
# -> receipt verdict: ALLOW ... PASS AUTHORISED
```

Then in CI:

```yaml
- uses: velvetmonkey/seal-verify-action@v1
  with:
    receipts: "**/*.receipt.json"
    expected-config-pubkey: ${{ vars.SEAL_CONFIG_PUBKEY }}
```

Bad receipt = red build. Visible in terminal.

## Trust boundaries

![Action](https://img.shields.io/badge/type-JS%20action%20(node20)-black)
![Domain](https://img.shields.io/badge/domain-MCP%20mediation-informational)
![License](https://img.shields.io/badge/license-Apache--2.0-blue)

<!-- truthbox:begin -->
> **Runtime profile: `compatible`.** Strict `canonical-l0` is proved and modelled, not the deployed route yet.
> **Claim:** policy-covered request-effects recognised by the compatible MCP boundary reach the downstream child MCP server only after every applicable Lean kernel returns Allow. Effects configured as guarded additionally require a matching live approval record. Seam failures block; every mediated decision emits replayable evidence.
> **Non-claim:** the deployed host is not proved end to end, and canonical parser rejection is not currently the runtime gate. Host `ApprovalRecord` tokens are a separate signed channel from the v2 kernel-defined approval tuple. “Canonical” in Seal names the pinned kernel byte rule, not RFC 8785/JCS. Seal verifies the configured authorization evidence. Whether that evidence represents the intended human, device or service is an identity and key-custody assumption, not a proved property.
<!-- truthbox:end -->
> Map: canonical claims in [docs/LIMITATIONS.md](docs/LIMITATIONS.md) · truth box in [docs/TRUTH-BOX.md](docs/TRUTH-BOX.md) · family: [seal](https://github.com/velvetmonkey/seal). Inheritance, not ownership — the verifier's home is [seal-assurance-kit](https://github.com/velvetmonkey/seal-assurance-kit) (see [VENDORED.md](VENDORED.md)).

These are the four explicit places where Seal's proofs stop. They are strengths because the boundaries are known and each has a named closure path outside the kernel — closed where stated, still open where stated.

1. Byzantine / non-participating replica — non-bypass proven for replicas that RUN the gate; a replica not running seal is outside the TCB by definition. Named closure path (not yet implemented): attestation of the sealed core.
2. Egress after allow (P6) — seal mediates the DECISION and records it, not the downstream effect. Closes via: compose with an egress proxy; decision gate by design. (Already in seal-host's RUST_BRIDGE.md.)
3. Model vs compiled binary — proofs bind the routing core the code delegates to (Ffi.stepImpl → composed kernels), not a byte-for-byte proof of the compiled wasm. Closure path (Lane C, still open): a wasm-vs-Lean-decide binary differential.
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
          expected-config-pubkey: ${{ vars.SEAL_CONFIG_PUBKEY }}
          # working-directory: .          # where patterns resolve
```

Every matched receipt is authenticated and re-derived through the pinned verifier; a tampered,
bypassed, stale, unpinned, or unauthorised receipt gets an annotation and fails the step.
A glob that matches nothing fails closed. Full knobs in [Inputs](#inputs) below; the exact
checks in [What this checks — and what it does not](#what-this-checks--and-what-it-does-not).

## Inputs

| input | default | meaning |
|---|---|---|
| `receipts` | `**/*.receipt.json` | Glob pattern(s) or newline-separated paths, resolved under `working-directory`. Supports `**`, `*`, `?` and literal paths; no character classes. |
| `working-directory` | `.` | Directory patterns are resolved against. |
| `expected-config-pubkey` | required | Independently provisioned 64-lowercase-hex Ed25519 operator public key. Never copy it from the receipt. |
| `verifier-version` | `""` | Optional label echoed in the step summary next to the vendored pin. Informational only. |

## Outputs

| output | meaning |
|---|---|
| `verified` | Count of receipts that are fully authorised. |
| `failed` | Count that failed: NOT VERIFIED, NOT MEDIATED (bypass receipt), verifier error, a listed file that does not exist, or a reduced-scope receipt (also counted in `reduced_scope`). |
| `reduced_scope` | Count at REDUCED SCOPE (schema §11.1 authorised-unparseable): signed config and kernel-attested request binding verify, but the wire line is not re-parseable, so no independent replay — NOT independently verified. Counted within `failed`; the step never passes while this is nonzero. |
| `signature_valid` | `true` only when every matched receipt has a valid Ed25519 config signature. |
| `kernel_replay_consistent` | `true` only when at least one matched receipt is replay-applicable AND every replay-applicable receipt replays byte-identically. §11.1 unparseable-request receipts are out of replay scope, not replay failures; a set with nothing replayable reports `false`, never a vacuous `true`. Read alongside `kernel_replay_scope`. |
| `kernel_replay_scope` | Replay coverage as `applicable/matched` (e.g. `3/4`): how many matched receipts the replay claim actually covered. |
| `authority_trusted` | `true` only when every signer matches the operator pin; otherwise `false` or `unpinned`. |

## Behaviour

- Each failing receipt gets a `::error` annotation on the file, so failures
  land on the PR diff.
- A grouped pass/fail table is written to the job's step summary, including
  the exact vendored verifier version and commit.
- **Zero matched receipts fails the step** — a glob
  that matches nothing is a misconfiguration, and a gate that silently passes
  on a typo is worse than no gate. Missing literal paths likewise count as
  failures rather than being dropped.
- Deterministic and hermetic: no network, no clock, receipts processed in
  sorted order. The verifier is a vendored, sha256-pinned, downstream-stricter
  fork of `seal verify` from seal-assurance-kit (see [VENDORED.md](VENDORED.md)) —
  consumers install nothing.

There is deliberately no report-only success mode. If a workflow wants to observe an honest red result without stopping later jobs, use GitHub's native `continue-on-error: true` on the step and read the tri-state outputs. The action itself never turns failed verification green.

## What this checks — and what it does not

For each receipt, the verifier checks the receipt is **well-formed**
(schema-valid), **canonical** (stored canonical request equals the line
re-derived from the receipt's own tool + arguments, hashes match), and
**authenticated and re-derivable** (the pinned kernel accepts the receipt’s exact signed bytes,
the signed payload byte-binds `kernel_config`, and the same call reproduces the
verdict and emitted bytes), and **authorised** (the signer matches the independent pin). Bypass receipts
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
  this action is a pinned, downstream-stricter fork of the conformance-tested
  verifier, tied to the proof by the pinned kernel hash, not by a theorem
  about this repo.

## Mandatory non-claims (inherited)

This action **inherits** the Seal family's non-claims — it re-runs a vendored,
sha256-pinned, downstream-stricter fork of the verifier and weakens none of them;
the fork's one delta is stricter (a required `signed_config` trust anchor, see
[VENDORED.md](VENDORED.md)) — and adds a few
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
- The axiom-footprint line is a per-theorem ceiling for theorems named in the family's axiom-pin gates; it is not a repository-wide census. Pin scope and named exceptions are indexed in the seal claims matrix (seal/docs/CLAIMS-MATRIX.md).
- seal-verify-action does NOT re-prove the kernel: it re-runs a vendored, sha256-pinned, downstream-stricter fork of `seal verify` (see VENDORED.md); it inherits that verifier's guarantees and limits and adds exactly one stricter requirement — a valid `signed_config` trust anchor for any authorised outcome — nothing weaker.
- A green build attests that matched receipts authenticated, matched the configured authority, and that every replay-applicable receipt replayed consistently (unparseable-request receipts verify at raw-line-identity scope; coverage is disclosed as `kernel_replay_scope`); it is NOT evidence that the operator chose a good policy, that seal-host is bug-free, or that an unmediated effect left a receipt to check.
- The action adds no theorem about itself; its trust rests on the pinned verifier bytes and the independently provisioned operator public key, not on receipt-supplied authority claims.
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

_All Seal-family repositories, this one included, are currently private: the links above —
and `uses: velvetmonkey/seal-verify-action@v1` itself — resolve only for authorised
evaluators with repository access._

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
three receipts that must authorise, plus bypass, forged-binding, unpinned,
zero-match, reduced-scope (§11.1), and working-directory paths, each asserted
to land on its documented outcome. Report-only workflows use step-level
`continue-on-error`.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE) (the verifier and
kernel are vendored from seal-assurance-kit / seal-check, also Apache-2.0).
