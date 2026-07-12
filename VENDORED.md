# Vendored verifier

This action vendors the `seal verify` implementation from
**seal-assurance-kit** so consumer workflows need nothing installed and every
run is hermetic (no network, no npm install, no version drift at run time).

## Pin

| field | value |
|---|---|
| upstream | `velvetmonkey/seal-assurance-kit` |
| version | `0.0.1` |
| assurance-kit base | `0db03efd27fc3775988d5e4bd527d8e6206b6c47` |
| signed-config semantics | `seal-check@400079cb5ac5d86908095a6f0d26a4ba2d7b0d01` |
| kernel wasm | `df42cbada2297741bfeab99f222b96ac02e43a4ce8695b24922b425b8d66b1e8` |

The same pin is hard-coded in `lib/pin.js` and echoed in every step summary.
Update both together.

## Files and checksums

Paths are relative to `vendor/seal-assurance-kit/`. CI re-checks these hashes
against the working tree on every run (`sha256sum -c`), so a stale or edited
vendored file fails the build.

```
322d2b0d8be8c2f0ff5464b15d51003c36e56aad194320a49816716c11ff51af  src/verify.cjs
e8a0148e3803cbf68bfd46a0fc272945deb970f5c3e85ac55bee6f6666efb67b  kernel/runner.cjs
5ad6567b4c161a185eb9d23d51e6dafd23bdb823ea2e142c45070a07ecd80bcb  kernel/receipt-format.js
d93c26b75adf40c9d60a10079fe92f666777fe69729b006abe7aba60685fb8e8  kernel/kernel.js
9ef462c22ad85e539d2170a4d43965d45a35def8878246649bbc6534f1607929  kernel/seal-config.js
5a065fe7d8eab2a582f428e11c2ea63aaf70607a54f69cfd5c711b5c53d91b32  kernel/package.json
2ba21824248a66751d31a2f778e21b866805dc7ca517ae84af4ab1bc597cb14f  kernel/wasm/seal.js
df42cbada2297741bfeab99f222b96ac02e43a4ce8695b24922b425b8d66b1e8  kernel/wasm/seal.wasm
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
