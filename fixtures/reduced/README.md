# Reduced-scope fixtures

Every file here is a VALID receipt that nonetheless does **not** pass the gate:
it lands on the distinct reduced-scope state, not on VERIFIED and not on a hard
failure. INVALID != REDUCED-SCOPE != VERIFIED.

- `unparseable.receipt.json` — a §11.1 unparseable-request receipt (a real
  seal-host receipt whose wire line the producer could not re-parse). The
  Ed25519-signed config and the kernel-attested request binding verify, but no
  independent replay is possible, so it is **NOT independently verified**. The
  action reports it `reduced-scope` (⚠️), counts it in `failed`, and the step
  fails (exit 4) — it is deliberately kept out of `fixtures/pass/`, where every
  receipt must reach `verified`.
