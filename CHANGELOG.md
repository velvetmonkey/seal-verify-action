# Changelog

## Unreleased

- **Changed:** `kernel_replay_consistent` now aggregates over replay-applicable receipts only: it is `true` when at least one matched receipt is replay-applicable and every replay-applicable receipt replays byte-identically through df42. Schema §11.1 unparseable-request receipts carry no `(tool, arguments)`, verify at raw-line-identity scope, and no longer drag the aggregate to `false` as if replay had run and diverged. A set with nothing replayable reports `false`, never a vacuous `true`.
- Added the `kernel_replay_scope` output (`applicable/matched`, e.g. `3/4`) so `kernel_replay_consistent: true` is always read alongside how many receipts it covered; the step summary renders `n/a` (not `false`) in the Replay column for receipts replay does not apply to, plus the same scope line.

- **Breaking:** require `expected-config-pubkey`; green now means every receipt is cryptographically valid, replay-consistent, and signed by that independently provisioned authority.
- **Breaking:** remove `fail-on`. Report-only consumers must use GitHub's step-level `continue-on-error: true` and may read `signature_valid`, `kernel_replay_consistent`, and `authority_trusted` outputs.
- Re-vendor the df42 kernel and consume canonical v2 `signed_config` receipts with real Ed25519 verification.
