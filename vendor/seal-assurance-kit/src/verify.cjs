// SPDX-License-Identifier: Apache-2.0
// FORK DELTA (seal-verify-action, tracks kit@0aeb35a but is NOT a byte snapshot):
// this is the action's trust-anchor verifier, NOT kit's src/verify.cjs. It adds
// verifyReceipt + the expected-config-pubkey trust anchor -> authority_trusted
// (true / "unpinned" / false) -> the 0/4/3/1 exit-code contract, and requires a
// valid signed_config for an authorised outcome. Kit's own verify.cjs is
// trust-rootless (no expectedConfigPubkey, no unpinned state); this copy is the
// deliberate downstream-stricter one. Do NOT flatten to kit HEAD in a vendor-sync
// sweep. See VENDORED.md "Fork deltas".
// Independent df42 receipt verification, mirrored from seal-check@400079c.
// The verifier consumes the receipt's exact signed_config bytes and requires
// an independently provisioned public-key pin for an authorised outcome.
const { decideSigned, kernelSha, pinnedSha } = require("../kernel/runner.cjs");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// §11.1 helpers for unparseable-request receipts -----------------------------

// Ed25519 over the exact signed_config payload bytes — the same check
// seal_init performs, done directly because the kernel cannot be invoked
// without a parseable call.
function verifyConfigSignature(sc) {
  try {
    if (!sc || typeof sc.pubkey !== "string" || typeof sc.signature !== "string" ||
        typeof sc.payload !== "string") return false;
    const key = crypto.createPublicKey({
      key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(sc.pubkey, "hex")]),
      format: "der", type: "spki",
    });
    return crypto.verify(null, Buffer.from(sc.payload, "utf8"), key, Buffer.from(sc.signature, "hex"));
  } catch {
    return false;
  }
}

// The kernel material an unparseable-request receipt carries must at least
// agree with itself: the audit embedded in emitted_bytes names the same
// verdict and certs the receipt asserts. Consistency, not replay.
function auditConsistent(F, receipt) {
  try {
    const audit = JSON.parse(JSON.parse(receipt.emitted_bytes).audit);
    return F.HOST_AUDIT_VERDICT_MAP[audit.verdict] === receipt.verdict &&
      JSON.stringify(audit.certs) === JSON.stringify(receipt.certs);
  } catch {
    return false;
  }
}

// The kernel's own commitment to the bytes it judged: Host/Audit.lean puts
// sha256 of the exact judged line into the audit inside emitted_bytes. This
// is what makes the pairing of kernel material to request identity
// kernel-attested rather than host-asserted.
function auditRequestHash(emittedBytes) {
  try {
    const h = JSON.parse(JSON.parse(emittedBytes).audit).request_sha256;
    return typeof h === "string" && /^[0-9a-f]{64}$/.test(h) ? h : null;
  } catch {
    return null;
  }
}

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

async function verifyReceipt(input, { expectedConfigPubkey } = {}) {
  const F = await import("file://" + path.resolve(__dirname, "../kernel/receipt-format.js"));
  const fromDocument = typeof input === "string";
  const shape = F.validateReceipt(input);
  const receipt = fromDocument ? (shape.record ?? null) : input;
  const out = blankResult(receipt);
  out.document_checked = shape.document_checked === true;

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

  // §11.1 unparseable-request receipt: the kernel judged a wire line the
  // producer could not re-parse (seal-host main @ 3a74dbf). request_sha256
  // (SHA-256 of the raw line) is the only request commitment; canonical
  // re-derivation and kernel replay both need the (tool, arguments) the
  // receipt honestly does not carry. Everything else is still verified and
  // the outcome is its own reduced-scope state — never a bare PASS.
  out.unparseableRequest = typeof receipt.request_parse_error === "string";

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

  if (out.unparseableRequest) {
    // Not a match, not a mismatch — its own state (undefined === undefined is
    // not verification).
    out.requestLine = null;
    out.requestHash = null;
    out.requestHashMatch = null;
    out.rawLineIdentity = receipt.request_sha256;
    out.requestIdentityNote = "no canonical re-derivation possible; request identity is the raw line hash (request_sha256), kernel-attested via the audit's own commitment";
  } else {
    out.requestLine = F.canonicalRequest(receipt.tool, receipt.arguments);
    out.requestHash = F.canonicalRequestSha256(receipt.tool, receipt.arguments);
    out.requestHashMatch = out.requestHash === receipt.canonical_request_sha256;
  }

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
  if (out.unparseableRequest) {
    out.replayUnavailable = "unparseable-request receipt — no (tool, arguments) to replay";
    if (out.bindingOk && grants.errors.length === 0) {
      out.signature_valid = verifyConfigSignature(signedConfig);
      if (out.signature_valid) out.config_freshness = freshnessCandidate;
    }
    out.kernelMaterialConsistent = auditConsistent(F, receipt);
    // The kernel-attested request binding: the audit's request_sha256 (the
    // kernel's own hash of the judged bytes) must equal the receipt's
    // request_sha256. The pairing is kernel-attested now, no longer
    // host-asserted. Honest residual that remains: without replay, the
    // authenticity of the kernel blob itself still rests on the producing
    // host's transcript.
    const kernelHash = auditRequestHash(receipt.emitted_bytes);
    out.kernelRequestBinding = kernelHash !== null && kernelHash === receipt.request_sha256;
  } else if (out.bindingOk && grants.errors.length === 0) {
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
        // Kernel-attested request binding, parseable side. A native-host
        // receipt carries the hash of the ACTUAL wire line (request_sha256);
        // kit-minted receipts carry no top-level request_sha256 and the
        // judged line IS the canonical line.
        const expectedHash = typeof receipt.request_sha256 === "string"
          ? receipt.request_sha256 : out.requestHash;
        const storedKernelHash = typeof receipt.emitted_bytes === "string"
          ? auditRequestHash(receipt.emitted_bytes) : null;
        out.kernelRequestBinding = storedKernelHash !== null && storedKernelHash === expectedHash;
        // Replay reconstructs the CANONICAL id=1 line, so the replayed
        // audit's request commitment legitimately differs whenever the
        // actual wire line differed. Compare byte-identical MODULO that one
        // kernel-derived token (pinned independently just above); the token
        // must occur exactly once for the substitution to be byte-safe.
        // Strictly stronger than plain equality, which this degenerates to
        // when the hashes agree.
        if (typeof receipt.emitted_bytes === "string") {
          const replayedHash = auditRequestHash(red.raw);
          const substitutable = replayedHash !== null && storedKernelHash !== null &&
            red.raw.split(replayedHash).length === 2;
          out.emittedBytesMatch = substitutable &&
            red.raw.replace(replayedHash, storedKernelHash) === receipt.emitted_bytes;
        } else {
          out.emittedBytesMatch = null;
        }
        out.kernel_replay_consistent = out.verdictMatch === true && out.emittedBytesMatch === true;
      }
    } catch (error) {
      out.rederiveError = error.message;
    }
  }

  // Reduced-scope core for unparseable-request receipts: everything the
  // receipt carries is verified; what it honestly cannot carry (canonical
  // request re-derivation, kernel replay) is excluded rather than failed.
  const checksPassed = out.unparseableRequest
    ? out.formatOk && out.kernelShaMatch && out.bindingOk &&
      out.grantErrors.length === 0 && out.signature_valid &&
      out.kernelMaterialConsistent === true && out.kernelRequestBinding === true
    : out.formatOk && out.kernelShaMatch && out.requestHashMatch &&
      out.bindingOk && out.grantErrors.length === 0 && out.signature_valid &&
      out.kernel_replay_consistent && out.kernelRequestBinding === true;
  out.verificationCore = out.document_checked && checksPassed;
  out.outcome = !checksPassed || out.authority_trusted === false
    ? "failure"
    : !out.document_checked ? "unverified-document"
    : out.authority_trusted !== true ? "unpinned"
    : out.unparseableRequest ? "authorised-unparseable" : "authorised";
  out.allGood = out.outcome === "authorised";
  return out;
}

function report(result, receiptPath) {
  const receipt = result.receipt || {};
  console.log(`seal verify  ${receiptPath}`);
  console.log(`  receipt verdict: ${receipt.verdict || "?"}   kernel: ${(receipt.kernel_identity?.wasm_sha256 || "?").slice(0, 12)}`);
  if (result.formatErrors?.length) console.log(`  FAIL  schema valid   (${result.formatErrors.join("; ")})`);
  console.log(`  kernel_sha_match: ${result.kernelShaMatch === true}`);
  if (result.unparseableRequest) {
    console.log(`  request_binding: kernel-attested — audit sha256(judged bytes) matches request_sha256 (${String(result.rawLineIdentity || "").slice(0, 12)}…): ${result.kernelRequestBinding === true}; canonical re-derivation n/a (unparseable)`);
  } else {
    console.log(`  request_hash_match: ${result.requestHashMatch === true}`);
  }
  console.log(`  binding_ok: ${result.bindingOk === true}`);
  console.log(`  signature_valid: ${result.signature_valid}`);
  if (result.unparseableRequest) {
    console.log(`  kernel_replay_consistent: n/a — no (tool, arguments) to replay; kernel material self-consistent: ${result.kernelMaterialConsistent === true}; kernel-bound to request_sha256: ${result.kernelRequestBinding === true}`);
  } else {
    console.log(`  kernel_replay_consistent: ${result.kernel_replay_consistent}`);
  }
  console.log(`  authority_trusted: ${result.authority_trusted}`);
  if (result.config_freshness) console.log(
    `  config_freshness: ${result.config_freshness.field}=${result.config_freshness.value}; rollback_enforced=${result.config_freshness.rollback_enforced}`);
  if (result.outcome === "authorised") {
    console.log("  PASS  AUTHORISED (signed by pinned operator key)");
  } else if (result.outcome === "authorised-unparseable") {
    console.log(`  REDUCED SCOPE (authorised-unparseable): kernel-attested request binding (the kernel's audit commits to sha256 of the exact bytes it judged and it matches request_sha256) and Ed25519-signed policy; wire line not re-parseable — ${receipt.request_parse_error}; no canonical replay — NOT independently verified`);
  } else if (result.outcome === "unpinned") {
    console.log(result.unparseableRequest
      ? `  FAIL  UNPINNED (authentic, kernel-attested request binding — no replay possible; independently pin ${receipt.signed_config.pubkey})`
      : `  FAIL  UNPINNED (authentic + replay-consistent; independently pin ${receipt.signed_config.pubkey})`);
  } else if (result.outcome === "unverified-document") {
    console.log("  FAIL  UNVERIFIED DOCUMENT (object input; no received bytes were checked)");
  } else if (result.notMediated) {
    console.log("  FAIL  NOT MEDIATED (bypass receipt)");
  } else {
    const detail = result.pinError || result.formatErrors?.join("; ") ||
      (result.kernelShaMatch === false ? "kernel binary identity mismatch" : "") ||
      (result.requestHashMatch === false ? "canonical request hash mismatch" : "") ||
      result.bindingErrors?.join("; ") || result.grantErrors?.join("; ") ||
      result.rederiveError ||
      (result.verdictMatch === false ? "verdict does not match replay" : "") ||
      (result.emittedBytesMatch === false ? "emitted decision bytes differ" : "") ||
      (result.kernelRequestBinding === false
        ? "kernel-attested request hash does not match request_sha256 (host and kernel disagree about the judged line)" : "") || "NOT VERIFIED";
    console.log(`  FAIL  ${detail}`);
  }
  return result;
}

async function verify(receiptPath, options = {}) {
  let receiptDocument;
  try {
    receiptDocument = fs.readFileSync(receiptPath, "utf8");
    JSON.parse(receiptDocument);
  } catch (error) {
    const result = blankResult();
    result.readError = `cannot read receipt: ${error.message}`;
    console.error(`FAIL  ${result.readError}`);
    return result;
  }
  return report(await verifyReceipt(receiptDocument, options), receiptPath);
}

module.exports = { verify, verifyReceipt };
