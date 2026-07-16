// SPDX-License-Identifier: Apache-2.0
// The vendored verifier pin. Must match VENDORED.md; update both together.
//
// KIT_COMMIT is the BASE kit revision this vendor tracks — NOT a byte-identical
// snapshot. The vendor is a deliberate downstream-stricter FORK of that revision
// (signed_config + trust-anchor enforcement); see VENDORED.md "Fork deltas" for
// the exact divergences and kit's own signed-config-known-gap acknowledgment.
"use strict";

module.exports = {
  KIT_NAME: "seal-assurance-kit",
  KIT_VERSION: "0.0.1",
  KIT_COMMIT: "0aeb35a60adfa4c50b6bfcf761967b1c6280fde7",
  SEAL_CHECK_COMMIT: "400079cb5ac5d86908095a6f0d26a4ba2d7b0d01",
  KERNEL_WASM_SHA256: "ff1bfd68d7be51b6a395f94dfc46b2fb27ed11dc5833af6a84675f42f9730546",
};
