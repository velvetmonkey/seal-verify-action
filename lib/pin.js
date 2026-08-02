// SPDX-License-Identifier: Apache-2.0
// The vendored verifier pin. Must match VENDORED.md; update both together.
//
// KIT_COMMIT is the BASE kit revision this vendor tracks — NOT a byte-identical
// snapshot. The vendor is a deliberate downstream-stricter FORK of that revision
// (signed_config + trust-anchor enforcement); see VENDORED.md "Fork deltas" for
// the exact divergences and kit's own signed-config-known-gap acknowledgment.
//
// VERIFY_PROFILE is the declared verification profile of this fork (kit
// docs/VERIFY-PROFILES.md): P-ENFORCE — the production receipt gate.
// signed_config binding required, top verdict requires the trust-anchor pin,
// exits 0/4/3/1. The base kit's own verifier is P-REF; that profile split IS
// the fork (the cross-copy differential derives its expected divergences from
// these two declarations). Changing it is a design decision, not a refactor.
"use strict";

module.exports = {
  KIT_NAME: "seal-assurance-kit",
  KIT_VERSION: "0.0.1",
  KIT_COMMIT: "0aeb35a60adfa4c50b6bfcf761967b1c6280fde7",
  SEAL_CHECK_COMMIT: "400079cb5ac5d86908095a6f0d26a4ba2d7b0d01",
  KERNEL_WASM_SHA256: "0b5e792500592b56847f70b1e27e47aecdc65023c7c59fd79695102c465f26ec",
  VERIFY_PROFILE: "P-ENFORCE",
};
