# Deliberate-failure fixtures

Every file here is a FORGERY or a degenerate case that the action must
refuse. A green run on this directory is a broken verifier.

- `bypass.receipt.json` — mediation was skipped; NOT MEDIATED, never
  "verified".
- `forged-binding.receipt.json` — the pass-set unparseable receipt with one
  hex digit of `request_sha256` flipped: authentic kernel material paired
  with a request the kernel did not judge. The kernel-attested request
  binding (the audit's own sha256 of the judged bytes) catches it. Before
  the kernel committed to its judged bytes, this forgery VERIFIED.
