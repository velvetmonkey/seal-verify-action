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

test("unparseable-request receipt validates clean; fabrication rejected (§11.2)", async () => {
  const F = await load();
  const unp = F.assembleReceiptV2(unparseableFields(F));
  const v = F.validateReceipt(unp);
  assert.deepEqual([v.ok, v.version, v.errors], [true, "v2", []]);
  const current = { ...unp, record_type: "seal.authorization-decision", record_version: 2 };
  delete current.seal_receipt;
  assert.deepEqual(F.validateReceipt(current), { ok: true, version: "v2", errors: [], document_checked: false });
  assert.equal(F.validateReceipt({ ...current, request_sha256: "nothex" }).ok, false);
  for (const [k, vv] of [["tool", "db.execute"], ["arguments", {}],
    ["args_hash", "0".repeat(64)], ["canonical_request", "{}"],
    ["canonical_request_sha256", "0".repeat(64)]]) {
    assert.equal(F.validateReceipt({ ...unp, [k]: vv }).ok, false,
      `${k} alongside request_parse_error must be rejected as fabrication`);
  }
  assert.equal(F.validateReceipt({ ...unp, request_sha256: "nothex" }).ok, false);
  const noRaw = { ...unp };
  delete noRaw.request_sha256;
  assert.equal(F.validateReceipt(noRaw).ok, false);
  assert.equal(F.validateReceipt({ ...unp, bypass: true }).errors
    .some((e) => e.includes("only a mediated receipt")), true);
});

test("both vendored copies refuse discriminator conflicts and duplicate discriminator documents", async () => {
  const copies = [
    await load(),
    await import("file://" + path.resolve(__dirname, "reference-kit-0aeb35a/receipt-format.js")),
  ];
  for (const F of copies) {
    const receipt = F.assembleReceiptV2(unparseableFields(F));
    const conflict = F.validateReceipt({
      ...receipt, record_type: "seal.authorization-decision", record_version: 2,
    });
    assert.equal(conflict.ok, false);
    assert.match(conflict.errors.join("; "), /conflicting version discriminators: seal_receipt \+ record_type\/record_version/);

    const document = JSON.stringify(receipt).replace(
      '"seal_receipt":"v2"', '"seal_receipt":"v2","seal_receipt":"v2"');
    const duplicate = F.validateReceipt(document);
    assert.equal(duplicate.ok, false);
    assert.equal(duplicate.document_checked, true);
    assert.match(duplicate.errors.join("; "), /version discriminator "seal_receipt" occurs 2 times/);
  }
});

test("verifyReceipt reports the distinct reduced-scope state, never a false match", async () => {
  const F = await load();
  const crypto = require("node:crypto");
  const { verifyReceipt } = require("../vendor/seal-assurance-kit/src/verify.cjs");
  const { kernelSha, CONFIG_PUBKEY } = require("../vendor/seal-assurance-kit/kernel/runner.cjs");
  // Synthetic-from-real: the exact field set seal-host main @ 3a74dbf emits on
  // an argument-less call, signed with the fleet's public test seed (RFC 8032 vector 1).
  const seed = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
  const key = crypto.createPrivateKey({
    key: Buffer.from("302e020100300506032b657004220420" + seed, "hex"),
    format: "der", type: "pkcs8",
  });
  const payload = JSON.stringify({ epoch: 1, safety: { approval: { control_file: "X", ttl_seconds: 120 }, tools: [] } });
  const signedConfig = {
    payload,
    signature: crypto.sign(null, Buffer.from(payload, "utf8"), key).toString("hex"),
    pubkey: CONFIG_PUBKEY,
  };
  const certs = [{ certHash: "1", kernel: "safety", reason: "cert", verdict: "deny" }];
  const receipt = F.assembleReceiptV2({
    now: 1000,
    request_sha256: "c".repeat(64),
    request_parse_error: "cannot parse mediated request for receipt: number out of range at line 1 column 145",
    bypass: false, verdict: "BLOCK", reason: "safety kernel: cert", deny_kernel: "safety",
    certs,
    // The audit carries the kernel's request commitment (Host/Audit.lean
    // request_sha256) — the kernel-attested binding the verifier now checks.
    emitted_bytes: JSON.stringify({ audit: JSON.stringify({ certs, epoch: 1, request_sha256: "c".repeat(64), verdict: "deny" }), route: "block" }),
    kernel_identity: { wasm_sha256: kernelSha(), self_verified: true },
    signed_config: signedConfig, kernel_config: JSON.parse(payload), granted_capabilities: [],
  });
  const r = await verifyReceipt(JSON.stringify(receipt), { expectedConfigPubkey: CONFIG_PUBKEY });
  assert.equal(r.formatOk, true, (r.formatErrors || []).join("; "));
  assert.equal(r.requestHashMatch, null, "must be a distinct state, never undefined === undefined -> true");
  assert.equal(r.rawLineIdentity, receipt.request_sha256);
  assert.equal(typeof r.replayUnavailable, "string");
  assert.equal(r.kernel_replay_consistent, false);
  assert.equal(r.signature_valid, true, "Ed25519 config signature verified directly");
  assert.equal(r.kernelMaterialConsistent, true);
  assert.equal(r.outcome, "authorised-unparseable");
  assert.equal(r.allGood, false, "never a bare PASS");
  // tamper: verdict no longer agrees with the carried kernel material
  const bad = await verifyReceipt(JSON.stringify({ ...receipt, verdict: "ALLOW", authorization: "explicit_policy_allow" }),
    { expectedConfigPubkey: CONFIG_PUBKEY });
  assert.equal(bad.formatOk && bad.outcome !== "failure", false);
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
