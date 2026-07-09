# Vendored verifier

This action vendors the `seal verify` implementation from
**seal-assurance-kit** so consumer workflows need nothing installed and every
run is hermetic (no network, no npm install, no version drift at run time).

## Pin

| field | value |
|---|---|
| upstream | `velvetmonkey/seal-assurance-kit` (private during build phase) |
| version | `0.0.1` |
| commit | `f08bda854a44e2064283a92cdd648b8176a0b992` |

The same pin is hard-coded in `lib/pin.js` and echoed in every step summary.
Update both together.

## Files and checksums

Paths are relative to `vendor/seal-assurance-kit/`. CI re-checks these hashes
against the working tree on every run (`sha256sum -c`), so a stale or edited
vendored file fails the build.

```
4d52523f10a303ec2bb16646ee5e8b43d809e2528000c3d7870dc840476f6b9d  src/verify.cjs
f8d3f596ecd7fcc71ae17a7493dd35c955ac61962bf0987cb81b227742fbb5b1  kernel/runner.cjs
6806be40b03b4c102ba801f5c1407cf4f434360753e86d7df921180bc8f2a677  kernel/receipt-format.js
1c15a0ac8e83b978afc7f1a972569ff1effde8d740a010078d81c9b4c6c37d46  kernel/kernel.js
77f050d2bc57624e3b4c50aaac068758710eeaa547729ca282273330584ec3e9  kernel/seal-config.js
2ba21824248a66751d31a2f778e21b866805dc7ca517ae84af4ab1bc597cb14f  kernel/wasm/seal.js
ebd17c14668176612c49f6e2940b23df82a2c1a7cdef6759f0d6276ae997e9d0  kernel/wasm/seal.wasm
```

These seven files are the complete dependency closure of `seal verify`
(traced, not assumed): `verify.cjs` requires `runner.cjs` and dynamically
imports `receipt-format.js`; `runner.cjs` imports `seal-config.js` and
`kernel.js`, eval-loads the Emscripten glue `wasm/seal.js`, and reads
`wasm/seal.wasm` from disk. The kit's scan/test/adequacy commands and their
support files are deliberately not vendored.

Vendored files are byte-identical to upstream — never edit them here. Fix
upstream, then re-vendor.

## Re-vendoring procedure

1. In the kit checkout, note `git rev-parse HEAD` and `package.json` version.
2. Copy the seven files listed above, preserving the `src/` + `kernel/`
   sibling layout (the code resolves siblings via `__dirname`; a flattened
   layout breaks at runtime).
3. `sha256sum` the copies, replace the checksum block above.
4. Update `lib/pin.js` (version + commit).
5. `npm test` and rerun the fixture selftest; refresh `fixtures/` if the
   receipt schema moved.
