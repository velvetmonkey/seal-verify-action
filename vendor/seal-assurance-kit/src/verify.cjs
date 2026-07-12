// SPDX-License-Identifier: Apache-2.0
// Independent df42 receipt verification, mirrored from seal-check@400079c.
// The verifier consumes the receipt's exact signed_config bytes and requires
// an independently provisioned public-key pin for an authorised outcome.
const { decideSigned, kernelSha, pinnedSha } = require("../kernel/runner.cjs");
const fs = require("fs");
const path = require("path");

function blankResult(receipt = null) {
  return {
    receipt,
    signature_valid: false,
    kernel_replay_consistent: false,
    authority_trusted: false,
    config_freshness: null,
    outcome: "failure",
    allGood: false,
    bindingErrors: [],
    grantErrors: [],
  };
}

async function verifyReceipt(receipt, { expectedConfigPubkey } = {}) {
  const F = await import("file://" + path.resolve(__dirname, "../kernel/receipt-format.js"));
  const out = blankResult(receipt);

  const shape = F.validateReceipt(receipt);
  out.formatOk = shape.ok;
  out.formatVersion = shape.version;
  out.formatErrors = shape.errors;
  if (!shape.ok) { out.mediated = null; return out; }

  if (receipt.bypass) {
    out.mediated = false;
    out.notMediated = "bypass receipt — seal was removed from the path; no kernel verdict exists";
    return out;
  }
  out.mediated = true;

  const signedConfig = receipt.signed_config;
  const pinSupplied = expectedConfigPubkey !== undefined;
  if (pinSupplied && (typeof expectedConfigPubkey !== "string" || !/^[0-9a-f]{64}$/.test(expectedConfigPubkey))) {
    out.pinError = "expectedConfigPubkey must be 64 lowercase hex characters";
  } else if (!signedConfig || typeof signedConfig.pubkey !== "string") {
    out.authority_trusted = false;
  } else if (!pinSupplied) {
    out.authority_trusted = "unpinned";
  } else {
    out.authority_trusted = expectedConfigPubkey === signedConfig.pubkey;
    if (!out.authority_trusted) out.pinError = "unauthorised config signer";
  }

  const local = kernelSha();
  const pinned = await pinnedSha();
  out.kernelSha = local;
  out.kernelShaMatch = local === pinned && receipt.kernel_identity.wasm_sha256 === local;

  out.requestLine = F.canonicalRequest(receipt.tool, receipt.arguments);
  out.requestHash = F.canonicalRequestSha256(receipt.tool, receipt.arguments);
  out.requestHashMatch = out.requestHash === receipt.canonical_request_sha256;

  let signedPayload = null;
  let freshnessCandidate = null;
  if (!signedConfig || typeof signedConfig.payload !== "string") {
    out.bindingErrors.push("signed_config payload unavailable");
  } else {
    try {
      signedPayload = JSON.parse(signedConfig.payload);
      if (JSON.stringify(signedPayload) !== signedConfig.payload)
        out.bindingErrors.push("signed_config.payload is not its byte-identical compact reconstruction");
      if (JSON.stringify(receipt.kernel_config) !== signedConfig.payload)
        out.bindingErrors.push("kernel_config does not byte-equal signed_config.payload");
      if (receipt.approval && receipt.approval.policy_hash !==
          F.sha256Hex(new TextEncoder().encode(signedConfig.payload)))
        out.bindingErrors.push("approval.policy_hash does not equal sha256(signed_config.payload)");
      if (!signedPayload || !Number.isInteger(signedPayload.epoch) || signedPayload.epoch < 0) {
        out.bindingErrors.push("signed config requires a non-negative integer epoch");
      } else {
        freshnessCandidate = { field: "epoch", value: signedPayload.epoch, rollback_enforced: false };
      }
    } catch (error) {
      out.bindingErrors.push("signed_config.payload is not valid JSON: " + error.message);
    }
  }
  out.bindingOk = out.bindingErrors.length === 0;

  const grants = F.capabilityTargetsFromPolicy(signedPayload, receipt.granted_capabilities);
  out.opaqueGrants = grants.opaque;
  out.grantErrors = grants.errors;
  out.rederived = null;
  out.verdictMatch = null;
  out.emittedBytesMatch = null;
  if (out.bindingOk && grants.errors.length === 0) {
    try {
      const red = await decideSigned(signedConfig, {
        tool: receipt.tool, args: receipt.arguments, approvals: grants.approvals,
        now: receipt.now ?? 1000,
      });
      out.signature_valid = red.signature_valid;
      if (!red.signature_valid) {
        out.rederiveError = "seal_init failed: " + red.initError;
      } else {
        out.config_freshness = freshnessCandidate;
        out.rederived = red.parsed.verdict === "DENY" ? "BLOCK" : red.parsed.verdict;
        out.verdictMatch = out.rederived === receipt.verdict;
        out.emittedBytesMatch = typeof receipt.emitted_bytes === "string"
          ? red.raw === receipt.emitted_bytes : null;
        out.kernel_replay_consistent = out.verdictMatch === true && out.emittedBytesMatch === true;
      }
    } catch (error) {
      out.rederiveError = error.message;
    }
  }

  out.verificationCore = out.formatOk && out.kernelShaMatch && out.requestHashMatch &&
    out.bindingOk && out.grantErrors.length === 0 && out.signature_valid &&
    out.kernel_replay_consistent;
  out.outcome = !out.verificationCore || out.authority_trusted === false
    ? "failure"
    : out.authority_trusted === true ? "authorised" : "unpinned";
  out.allGood = out.outcome === "authorised";
  return out;
}

function report(result, receiptPath) {
  const receipt = result.receipt || {};
  console.log(`seal verify  ${receiptPath}`);
  console.log(`  receipt verdict: ${receipt.verdict || "?"}   kernel: ${(receipt.kernel_identity?.wasm_sha256 || "?").slice(0, 12)}`);
  if (result.formatErrors?.length) console.log(`  FAIL  schema valid   (${result.formatErrors.join("; ")})`);
  console.log(`  kernel_sha_match: ${result.kernelShaMatch === true}`);
  console.log(`  request_hash_match: ${result.requestHashMatch === true}`);
  console.log(`  binding_ok: ${result.bindingOk === true}`);
  console.log(`  signature_valid: ${result.signature_valid}`);
  console.log(`  kernel_replay_consistent: ${result.kernel_replay_consistent}`);
  console.log(`  authority_trusted: ${result.authority_trusted}`);
  if (result.config_freshness) console.log(
    `  config_freshness: ${result.config_freshness.field}=${result.config_freshness.value}; rollback_enforced=${result.config_freshness.rollback_enforced}`);
  if (result.outcome === "authorised") {
    console.log("  PASS  AUTHORISED (signed by pinned operator key)");
  } else if (result.outcome === "unpinned") {
    console.log(`  FAIL  UNPINNED (authentic + replay-consistent; independently pin ${receipt.signed_config.pubkey})`);
  } else if (result.notMediated) {
    console.log("  FAIL  NOT MEDIATED (bypass receipt)");
  } else {
    const detail = result.pinError || result.formatErrors?.join("; ") ||
      (result.kernelShaMatch === false ? "kernel binary identity mismatch" : "") ||
      (result.requestHashMatch === false ? "canonical request hash mismatch" : "") ||
      result.bindingErrors?.join("; ") || result.grantErrors?.join("; ") ||
      result.rederiveError ||
      (result.verdictMatch === false ? "verdict does not match replay" : "") ||
      (result.emittedBytesMatch === false ? "emitted decision bytes differ" : "") || "NOT VERIFIED";
    console.log(`  FAIL  ${detail}`);
  }
  return result;
}

async function verify(receiptPath, options = {}) {
  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  } catch (error) {
    const result = blankResult();
    result.readError = `cannot read receipt: ${error.message}`;
    console.error(`FAIL  ${result.readError}`);
    return result;
  }
  return report(await verifyReceipt(receipt, options), receiptPath);
}

module.exports = { verify, verifyReceipt };
