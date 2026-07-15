# Vendored verifier

This action vendors the `seal verify` implementation from
**seal-assurance-kit** so consumer workflows need nothing installed and every
run is hermetic (no network, no npm install, no version drift at run time).

## Pin

| field | value |
|---|---|
| upstream | `velvetmonkey/seal-assurance-kit` |
| version | `0.0.1` |
| assurance-kit base | `b76027c9c8bb5c838e7fc571085a8127d4b33dc8` |
| signed-config semantics | `seal-check@400079cb5ac5d86908095a6f0d26a4ba2d7b0d01` |
| kernel wasm | `d3067bc07e74977dedf6bb96d79a710c4b61143f6e8db151655bc88ece8b9d66` |

The same pin is hard-coded in `lib/pin.js` and echoed in every step summary.
Update both together.

## Files and checksums

Paths are relative to `vendor/seal-assurance-kit/`. CI re-checks these hashes
against the working tree on every run (`sha256sum -c`), so a stale or edited
vendored file fails the build.

```
f0865d4360229c0ccd6eefbe683fba97fe274696d5c2058f724eae5d5ad51c1d  src/verify.cjs
e8a0148e3803cbf68bfd46a0fc272945deb970f5c3e85ac55bee6f6666efb67b  kernel/runner.cjs
fe702d0b4d971a4fe16d649d2016b1e14cda6672d92d0a0a190656809279b2d2  kernel/receipt-format.js
97a8aee1660584ff3cd0f169a2db823bb3685d8ed0b35503bd726daef3946a01  kernel/kernel.js
9ef462c22ad85e539d2170a4d43965d45a35def8878246649bbc6534f1607929  kernel/seal-config.js
5a065fe7d8eab2a582f428e11c2ea63aaf70607a54f69cfd5c711b5c53d91b32  kernel/package.json
5a017fa4a71db7c214323c1dd1db415a96ec0afececf84f74ac1f4fc95dd972e  kernel/wasm/seal.js
d3067bc07e74977dedf6bb96d79a710c4b61143f6e8db151655bc88ece8b9d66  kernel/wasm/seal.wasm
```

These eight files are the complete dependency closure of `seal verify`
(traced, not assumed): `verify.cjs` requires `runner.cjs` and dynamically
imports `receipt-format.js`; `runner.cjs` imports `seal-config.js` and
`kernel.js`, eval-loads the Emscripten glue `wasm/seal.js`, and reads
`wasm/seal.wasm` from disk. The kit's scan/test/adequacy commands and their
support files are deliberately not vendored.

The wasm and Emscripten glue are byte-identical to the assurance-kit base.
The JS receipt seam overlays the already-shipped `seal-check@400079c`
`signed_config` consumption, byte bindings, Ed25519, and tri-state authority
behavior. The checksums above pin the resulting hermetic closure explicitly.

## Re-vendoring procedure

1. In the kit checkout, note `git rev-parse HEAD` and `package.json` version.
2. Copy the eight files listed above, preserving the `src/` + `kernel/`
   sibling layout (the code resolves siblings via `__dirname`; a flattened
   layout breaks at runtime).
3. Re-apply only the signed-config behavior already shipped by the pinned
   seal-check reference; do not invent a third verifier dialect.
4. Run `npm run gen:fixtures`; never hand-edit receipt verdicts.
5. Replace the checksum block and update `lib/pin.js`.
6. Run `npm test` and the fixture selftest.
