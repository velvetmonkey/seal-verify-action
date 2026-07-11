# Truth box (canonical)

<!-- Canonical copy of this action's truth-box: runtime profile, claim,
     non-claim — framed as INHERITANCE, not ownership. The action re-runs a
     vendored, sha256-pinned copy of `seal verify`; it inherits that verifier's
     profile and proofs and proves nothing new of its own. The README mirrors
     the three lines verbatim between the same markers. The per-repo "Map" line
     is NOT part of this block. Edit here first; scripts/claims-drift.mjs
     enforces equality. -->

<!-- truthbox:begin -->
> **Runtime profile: `compatible` (inherited).** This action re-runs a vendored, sha256-pinned copy of `seal verify`; it inherits that verifier's profile and proofs and adds none of its own. Strict `canonical-l0` is proved and modelled, not the deployed route yet.
> **Claim:** in CI, the action re-derives every matched receipt through the pinned vendored verifier; a receipt that no longer re-derives — tampered, bypassed, or stale — turns the build red.
> **Non-claim:** it does NOT re-prove the kernel — it inherits it from the pinned copy (see VENDORED.md) — and it trusts the receipt's producer (seal-host). A green build attests re-derivation of the receipts it was handed, not that the producing system is correct, nor that an unmediated effect left a receipt to check.
<!-- truthbox:end -->
