# seal-verify-action

Verify [Seal](https://github.com/velvetmonkey/seal) decision receipts in CI.
For every matched receipt the action re-derives the verdict from the receipt's
own policy and call through the pinned, audited Seal kernel, and fails the
build when a receipt does not re-derive.

![Action](https://img.shields.io/badge/type-JS%20action%20(node20)-black)
![Domain](https://img.shields.io/badge/domain-MCP%20mediation-informational)
![License](https://img.shields.io/badge/license-Apache--2.0-blue)

## Usage

```yaml
jobs:
  receipts:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: velvetmonkey/seal-verify-action@v1
        with:
          receipts: "**/*.receipt.json"
```

That is the whole integration: a PR that changes a mediated tool must ship
receipts that still re-derive, or the check goes red.

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
