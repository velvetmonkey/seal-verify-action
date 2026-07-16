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
| kernel wasm (byte-identical to base) | `ff1bfd68d7be51b6a395f94dfc46b2fb27ed11dc5833af6a84675f42f9730546` |

`KIT_COMMIT` (here and in `lib/pin.js`) is the **base kit revision this vendor
tracks**, not a byte-identical snapshot. The vendored verifier is a **deliberate
downstream-stricter fork** of that revision. Do not "sync vendor to kit" by
flattening these files to kit HEAD — that would silently regress the action's
load-bearing exit-code contract and the forged-receipt P0. Every fork-delta file
carries a `FORK DELTA` header saying so.

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
| `kernel/kernel.js` | `buildReceipt({…, signedConfig})` emits the `signed_config` object | the action's fixtures carry `signed_config` for the verifier to check |
| `kernel/runner.cjs` | signs with the FIXED RFC-8032 test key (not kit's ephemeral key); adds `decideSigned` (verify path: init from the receipt's own `signed_config` envelope, report `signature_valid`) | deterministic verifiable fixtures + the signature-check the verifier performs |
| `kernel/seal-config.js` | `buildSignedConfig` does real Ed25519 signing with the fixed test key (kit HEAD ships a `demo-pk` stub) | same |

Everything else in these files is at kit `0aeb35a`: the `authority_trusted`-
forbidden `validateReceipt` guard, the V2 key-order/helper additions, the
reduced-scope §11.1 handling and kernel-attested request binding are all present
(no lag). The pin bump to `0aeb35a` records that this fork is now re-based on the
current kit main; the deltas above are the only intended divergences.

## Files and checksums

Paths are relative to `vendor/seal-assurance-kit/`. CI re-checks these hashes
against the working tree on every run (`sha256sum -c`), so a stale or edited
vendored file fails the build.

```
27a475556c6ccf8c18e505457570509879187def01cbba550d941b6da678b45e  src/verify.cjs
9397adcdc423ce03940040339eace39d06a529f514b978a82ebd83419a48c247  kernel/runner.cjs
5c05c12f1c96454b7ece8705f6891b8ebcfa9500d49f012935c48f428577888e  kernel/receipt-format.js
ab2a1c458fefa87f7ee3f23f4ac82a767f51066b55af274545d3075922018849  kernel/kernel.js
bc073812b30fe120aeeb533360a0440f2d482da65d7c89a272b09fe3786cb524  kernel/seal-config.js
5a065fe7d8eab2a582f428e11c2ea63aaf70607a54f69cfd5c711b5c53d91b32  kernel/package.json
4197af01de976c18399570be33cc53e6e704f3fc2129da4f0d16cb27313f3df2  kernel/wasm/seal.js
ff1bfd68d7be51b6a395f94dfc46b2fb27ed11dc5833af6a84675f42f9730546  kernel/wasm/seal.wasm
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

The `wasm` + Emscripten glue are byte-identical to the base kit revision
(`ff1bfd68…` / `4197af01…`; unchanged by this re-vendor — no rebuild). The five
JS files differ from kit `0aeb35a` only by the Fork deltas above (each carries a
`FORK DELTA` header). The cross-copy differential
(`test/cross-copy-differential.test.js`) pins the vendored verifier against the
kit-`0aeb35a` verifier over the pass / reduced-scope / forged / pathological
receipts: identical verdicts where they must agree, and the one **named pinned
divergence** (a config-less / unpinned receipt: kit accepts, this action holds it
below "verified") asserted in both directions.

## Re-vendoring / re-basing procedure

1. In the kit checkout, note `git rev-parse HEAD` and `package.json` version.
2. For each of the eight files, start from kit at that revision and RE-APPLY the
   Fork deltas above (or diff the current vendored file against kit to confirm
   only the Fork deltas differ). Preserve the `src/` + `kernel/` sibling layout
   (the code resolves siblings via `__dirname`; a flattened layout breaks at
   runtime). Keep each `FORK DELTA` header.
3. The vendored `seal.wasm` / `seal.js` stay byte-identical to the base — never
   rebuilt here (`sha256sum` before and after).
4. Run `npm run gen:fixtures`; never hand-edit receipt verdicts. Keep the §11.1
   fixture byte-identical with its kit + seal-check homes.
5. Replace the checksum block, update `lib/pin.js` `KIT_COMMIT`, and re-run the
   cross-copy differential.
6. Run `npm test` and the fixture selftest.
