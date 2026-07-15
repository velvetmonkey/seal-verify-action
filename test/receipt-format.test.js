// SPDX-License-Identifier: Apache-2.0
// Unit tests for the vendored kernel/receipt-format.js against the §11.1
// unparseable-request rule (normative: seal-host docs/DECISION-RECEIPT-SCHEMA.md,
// producer: seal-host main @ 3a74dbf). Lines exist that the kernel mediates and
// serde cannot re-parse; their receipts carry request_sha256 +
// request_parse_error and omit the structured request fields.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const load = () =>
  import("file://" + path.resolve(__dirname, "../vendor/seal-assurance-kit/kernel/receipt-format.js"));

const unparseableFields = (F) => ({
  now: 1000,
  request_sha256: "c".repeat(64),
  request_parse_error: "cannot parse mediated request for receipt: number out of range at line 1 column 145",
  bypass: false, verdict: "BLOCK", reason: "safety kernel: cert", deny_kernel: "safety",
  certs: [], emitted_bytes: "{}",
  kernel_identity: { wasm_sha256: "0".repeat(64), self_verified: true },
  signed_config: { payload: "{\"epoch\":1}", signature: "a".repeat(128), pubkey: "b".repeat(64) },
  kernel_config: { epoch: 1 }, granted_capabilities: [],
});

test("assembleReceiptV2 preserves request_sha256 + request_parse_error (§11.5)", async () => {
  const F = await load();
  const asm = F.assembleReceiptV2(unparseableFields(F));
  assert.deepEqual(Object.keys(asm),
    ["seal_receipt", "now", "request_sha256", "request_parse_error", "bypass",
      "verdict", "reason", "deny_kernel", "certs", "emitted_bytes", "kernel_identity",
      "signed_config", "kernel_config", "granted_capabilities"]);
  assert.equal(JSON.stringify(F.assembleReceiptV2(JSON.parse(JSON.stringify(asm)))),
    JSON.stringify(asm));
});

test("request_sha256 sits between canonical_request_sha256 and bypass (§11.5 order)", async () => {
  const F = await load();
  const args = { database: "prod", sql: "select 1" };
  const asm = F.assembleReceiptV2({
    tool: "db.execute", arguments: args, now: 1000,
    canonical_request_sha256: F.canonicalRequestSha256("db.execute", args),
    request_sha256: "c".repeat(64),
    bypass: false, verdict: "BLOCK", reason: "r", deny_kernel: "safety",
    certs: [], emitted_bytes: "{}",
    kernel_identity: { wasm_sha256: "0".repeat(64), self_verified: true },
    signed_config: { payload: "{\"epoch\":1}", signature: "a".repeat(128), pubkey: "b".repeat(64) },
    kernel_config: { epoch: 1 }, granted_capabilities: [],
  });
  const keys = Object.keys(asm);
  assert.deepEqual(
    keys.slice(keys.indexOf("canonical_request_sha256"), keys.indexOf("bypass") + 1),
    ["canonical_request_sha256", "request_sha256", "bypass"]);
});
