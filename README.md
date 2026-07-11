# seal-verify-action

**Add this to CI. A receipt that no longer re-derives turns the build red.**

For every matched receipt the action re-derives the verdict from the receipt's own policy and call through the pinned, audited Seal kernel. Tampered, bypassed, or stale = fail the step (with annotations on the PR).

![Action](https://img.shields.io/badge/type-JS%20action%20(node20)-black)
![Domain](https://img.shields.io/badge/domain-MCP%20mediation-informational)
![License](https://img.shields.io/badge/license-Apache--2.0-blue)

## Luxury 10-second onboarding (copy-paste)

```bash
bash scripts/showcase.sh
```

(Shows usage + fixtures.) In CI:

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

... (rest unchanged)

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
