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
> **Claim:** in CI, green means every matched receipt has a valid signed config, replayed byte-identically through df42, and its signer matched the independently configured operator pin.
> **Non-claim:** it does NOT re-prove the kernel or establish that the pinned operator chose a good policy. It cannot say anything about an effect that produced no receipt.
<!-- truthbox:end -->
