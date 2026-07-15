# Limitations

These limits are part of the Seal claim. They are not footnotes.

This is the canonical claims block for seal-verify-action. README.md mirrors it
verbatim between the same markers; `scripts/claims-drift.mjs` enforces equality,
so edit here first, then mirror.

The action **inherits** the Seal family's non-claims (it re-runs a vendored,
sha256-pinned copy of the verifier and strengthens none of them) and adds a few
that are specific to being a CI wrapper.

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
- A green build attests that matched receipts authenticated, matched the configured authority, and that every replay-applicable receipt replayed consistently (unparseable-request receipts verify at raw-line-identity scope; coverage is disclosed as `kernel_replay_scope`); it is NOT evidence that the operator chose a good policy, that seal-host is bug-free, or that an unmediated effect left a receipt to check.
- The action adds no theorem about itself; its trust rests on the pinned verifier bytes and the independently provisioned operator public key, not on receipt-supplied authority claims.
<!-- claims:end -->
