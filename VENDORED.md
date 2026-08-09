# Vendored verifier

This action vendors the `seal verify` implementation from
**seal-assurance-kit** so consumer workflows need nothing installed and every
run is hermetic (no network, no npm install, no version drift at run time).

## Pin — a tracked fork, NOT a byte snapshot

| field | value |
|---|---|
| upstream | `velvetmonkey/seal-assurance-kit` |
| version | `0.0.1` |
| **base kit revision this fork tracks** | `0aeb35a60adfa4c50b6bfcf761967b1c6280fde7` |
| signed-config semantics | `seal-check@400079cb5ac5d86908095a6f0d26a4ba2d7b0d01` |
| receipt-format validator body | `seal-check@9ba9db4` (byte-identical after stripping this fork's comment-only header) |
| exact `kernel/kernel.js` source | `seal-assurance-kit@8323bcdaf30407fdd3a9ca3d9b7664684434b756` (file last changed at `8946ec2a81e0e3e25b8920a9f7506ff4b37219f9`) |
| kernel wasm (byte-identical to the current fleet build) | `28bb3ae71985357163e3b651791e2a70c462ea5d1313a59b4967d4c20ea77657` |
| verify profile (kit `docs/VERIFY-PROFILES.md`) | `P-ENFORCE` (the base kit's verifier is `P-REF` — that profile split IS the fork) |

`KIT_COMMIT` (here and in `lib/pin.js`) is the **base kit revision this vendor
tracks**, not a byte-identical snapshot. The vendored verifier is a **deliberate
downstream-stricter fork** of that revision. Do not "sync vendor to kit" by
flattening the declared fork-delta files to kit HEAD — that would silently regress the action's
load-bearing exit-code contract and the forged-receipt P0. Every fork-delta file
carries a `FORK DELTA` header saying so.

`kernel/kernel.js` is the deliberate exception: it is an exact audited-kit
artifact from `8323bcdaf30407fdd3a9ca3d9b7664684434b756`. The action's
`signed_config` producer adaptation lives in the already-forked `runner.cjs`,
outside that exact-copy file.

## Fork deltas (deliberate, load-bearing — do NOT flatten)

Kit HEAD (`0aeb35a`) moved config signing out of the kernel into
`src/policy-sign.cjs` and **dropped `signed_config` from the receipt** — its
`buildReceipt` emits none, `V2_KEY_ORDER` has no `signed_config` slot, and its
`validateReceipt` neither emits nor requires it. Kit's own reference
`kernel/receipt-format.js` documents this as an **intentional divergence it does
not port** — its `signed-config-known-gap` (pinned in kit
`test/red-corpus.test.cjs` / `test/corpus/red-corpus.json`, id `copy-drift`):
"this reference kernel path emits no signed_config … requiring it would make this
validator reject its own producer's output. That divergence is fail-CLOSED (kit
receipts bounce off stricter verifiers, no bad ALLOW)."

This action IS one of those stricter downstream verifiers. It keeps the
`signed_config` + trust-anchor behavior because the action's verdicts depend on
it:

| file | fork delta vs kit@0aeb35a | why it is load-bearing |
|---|---|---|
| `src/verify.cjs` | action trust-anchor verifier (`verifyReceipt` + `expected-config-pubkey` → `authority_trusted` ∈ {true, "unpinned", false}); requires valid `signed_config` for an authorised outcome. Kit's `verify.cjs` is trust-rootless. | drives the `0 / 4 / 3 / 1` exit-code contract and the config-less-forge hard fail (P0 `e0f3b2f`) |
| `kernel/receipt-format.js` | keeps `signed_config` in `V2_KEY_ORDER` + `SIGNED_CONFIG_KEY_ORDER`; `validateReceipt` **requires** a well-formed `signed_config` when mediated, forbids it on bypass | a receipt with no/broken `signed_config` is rejected — the stricter-than-kit property |
| `kernel/runner.cjs` | signs with the FIXED RFC-8032 test key (not kit's ephemeral key), adds the `signed_config` object after exact-kit `kernel.js` builds a receipt, and adds `decideSigned` (verify path: init from the receipt's own `signed_config` envelope, report `signature_valid`) | deterministic verifiable fixtures + the signature-check the verifier performs, while `kernel.js` remains byte-identical to the audited kit artifact |
| `kernel/seal-config.js` | `buildSignedConfig` does real Ed25519 signing with the fixed test key (kit HEAD ships a `demo-pk` stub) | same |

The fork remains based on kit `0aeb35a`, but `kernel/receipt-format.js` now
tracks the canonical `seal-check@9ba9db4` validator body modulo its mandatory
comment-only `FORK DELTA` header. This carries the conflicting-discriminator
refusal, raw-document validation, and current v3 format support without
flattening the action's P-ENFORCE behavior. `src/verify.cjs` carries the matching
raw-document and `unverified-document` outcome contract.

## Files and checksums

Paths are relative to `vendor/seal-assurance-kit/`. CI re-checks these hashes
against the working tree on every run (`sha256sum -c`), so a stale or edited
vendored file fails the build.

```
f429d2ddcce6af0df3b7d6b9b1ed502c0658adac9c2b7c1e6a7903d2de43c3bb  src/verify.cjs
151d35af30e98a69064715bcdd590fc1197ab926741241e1a7d1eeef6080cf09  kernel/runner.cjs
3f665245abb8fb23405fb16eecf3e569387d53b3cc5c8f3be279b2f93c0910ca  kernel/receipt-format.js
94c283b153c00135d04f9a2ed6915596ef0a183c89af034a8ee68eaa959f9a0d  kernel/kernel.js
f8dcd7f39bc77151a6433c81ddf0e3c175772550ab30344c0788a5cf33ed45e1  kernel/seal-config.js
5a065fe7d8eab2a582f428e11c2ea63aaf70607a54f69cfd5c711b5c53d91b32  kernel/package.json
801417decfbc49b926a16c9968aa3e77e792abf05eb782ec8ed530325fb8c6c5  kernel/wasm/seal.js
28bb3ae71985357163e3b651791e2a70c462ea5d1313a59b4967d4c20ea77657  kernel/wasm/seal.wasm
```

These eight files are the complete dependency closure of `seal verify`
(traced, not assumed): `verify.cjs` requires `runner.cjs` and dynamically
imports `receipt-format.js`; `runner.cjs` imports `seal-config.js` and
`kernel.js`, eval-loads the Emscripten glue `wasm/seal.js`, and reads
`wasm/seal.wasm` from disk. Deliberately **excluded** (kit HEAD has them, the
action does not need them): `kernel/corpus.js` and `src/{adequacy,connect,
gen-receipt,init,policy-sign,receipt-diff,recipes,scan,test,trusted-config}.cjs`
— kit's scan/test/adequacy/policy-signing CLIs and their support files. The
action verifies receipts; it does not sign policies or run the kit's dev tooling.

`kernel/kernel.js`, the wasm, and the Emscripten glue are byte-identical to
kit `8323bcd`; the wasm is the current fleet build (`28bb3ae7…`). They are
copied, never rebuilt here.
They supersede the base kit revision's `ff1bfd68…` / `4197af01…` pair; the
fleet repin moves the kernel ahead of kit `0aeb35a`, under the same
mixed-provenance contract. The four fork-delta
JS files differ from kit by the Fork deltas above; the receipt-format
body additionally tracks canonical `seal-check@9ba9db4` and carries a
`FORK DELTA` header. The cross-copy differential
(`test/cross-copy-differential.test.js`) pins the vendored verifier against the
kit-`0aeb35a` verifier over the pass / reduced-scope / forged / pathological
receipts: identical verdicts where they must agree, and the one **named pinned
divergence** (a config-less / unpinned receipt: kit accepts, this action holds it
below "verified") asserted in both directions.

## Re-vendoring / re-basing procedure

1. In the kit checkout, note the exact audited commit and `package.json` version.
2. Copy `kernel/kernel.js`, `kernel/package.json`, `kernel/wasm/seal.js`, and
   `kernel/wasm/seal.wasm` byte-for-byte from that revision. Never rebuild them.
3. Rebase the four declared fork-delta files above separately, preserving the
   `src/` + `kernel/` sibling layout and each `FORK DELTA` header. Confirm every
   difference from kit is one of the documented P-ENFORCE deltas.
4. Run `npm run gen:fixtures`; never hand-edit receipt verdicts. Keep the §11.1
   fixture byte-identical with its kit + seal-check homes.
5. Regenerate the checksum block from the resulting eight vendored files. Update
   `lib/pin.js` `KIT_COMMIT` only when the base fork revision changes, and re-run
   the cross-copy differential.
6. Run `npm test` and the fixture selftest.
