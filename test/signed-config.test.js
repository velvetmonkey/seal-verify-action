// SPDX-License-Identifier: Apache-2.0
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { verifyReceipt } = require("../vendor/seal-assurance-kit/src/verify.cjs");
const { CONFIG_PUBKEY } = require("../vendor/seal-assurance-kit/kernel/runner.cjs");

const genuine = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, "../fixtures/pass/allow.receipt.json"), "utf8"));
const clone = () => JSON.parse(JSON.stringify(genuine));
const flip = (s) => (s[0] === "0" ? "1" : "0") + s.slice(1);
const verify = (receipt, pin = CONFIG_PUBKEY) =>
  verifyReceipt(JSON.stringify(receipt), pin === null ? {} : { expectedConfigPubkey: pin });

test("object input is capped at unverified-document", async () => {
  const result = await verifyReceipt(clone(), { expectedConfigPubkey: CONFIG_PUBKEY });
  assert.equal(result.outcome, "unverified-document");
  assert.equal(result.verificationCore, false);
  assert.equal(result.allGood, false);
  assert.equal(result.document_checked, false);
});

test("genuine signed_config is authorised only with the independent pin", async () => {
  const authorised = await verify(clone());
  assert.equal(authorised.signature_valid, true);
  assert.equal(authorised.kernel_replay_consistent, true);
  assert.equal(authorised.authority_trusted, true);
  assert.equal(authorised.outcome, "authorised");
  const unpinned = await verify(clone(), null);
  assert.equal(unpinned.signature_valid, true);
  assert.equal(unpinned.kernel_replay_consistent, true);
  assert.equal(unpinned.authority_trusted, "unpinned");
  assert.equal(unpinned.outcome, "unpinned");
  const wrong = await verify(clone(), "0".repeat(64));
  assert.equal(wrong.signature_valid, true);
  assert.equal(wrong.kernel_replay_consistent, true);
  assert.equal(wrong.authority_trusted, false);
  assert.equal(wrong.outcome, "failure");
});

test("signature and signed payload tampering fail before a trusted replay", async () => {
  const badSignature = clone();
  badSignature.signed_config.signature = flip(badSignature.signed_config.signature);
  const sig = await verify(badSignature);
  assert.equal(sig.signature_valid, false);
  assert.equal(sig.kernel_replay_consistent, false);

  const badPayload = clone();
  badPayload.signed_config.payload = badPayload.signed_config.payload.replace('"epoch":1', '"epoch":2');
  const payload = await verify(badPayload);
  assert.equal(payload.bindingOk, false);
  assert.equal(payload.kernel_replay_consistent, false);

  const swappedConfig = clone();
  swappedConfig.kernel_config.epoch = 2;
  const swap = await verify(swappedConfig);
  assert.equal(swap.formatOk === false || swap.bindingOk === false, true);
  assert.equal(swap.kernel_replay_consistent, false);
});

test("receipt bindings and replay claims are fail-closed", async () => {
  for (const mutate of [
    (r) => { r.approval.policy_hash = "0".repeat(64); },
    (r) => { r.verdict = "BLOCK"; },
    (r) => { r.emitted_bytes += " "; },
    (r) => { r.kernel_identity.wasm_sha256 = "0".repeat(64); },
    (r) => { r.canonical_request_sha256 = "0".repeat(64); },
    (r) => { r.authority_trusted = true; },
  ]) {
    const receipt = clone();
    mutate(receipt);
    const result = await verify(receipt);
    assert.equal(result.outcome, "failure");
    assert.equal(result.allGood, false);
  }
});
