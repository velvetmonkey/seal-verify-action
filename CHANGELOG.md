# Changelog

## Unreleased

- **Breaking:** require `expected-config-pubkey`; green now means every receipt is cryptographically valid, replay-consistent, and signed by that independently provisioned authority.
- **Breaking:** remove `fail-on`. Report-only consumers must use GitHub's step-level `continue-on-error: true` and may read `signature_valid`, `kernel_replay_consistent`, and `authority_trusted` outputs.
- Re-vendor the df42 kernel and consume canonical v2 `signed_config` receipts with real Ed25519 verification.
