// SPDX-License-Identifier: Apache-2.0
// Node runner for the vendored seal kernel (wasm/seal.js + seal.wasm).
// Loads the SAME public wasm the browser seal-check uses, runs one decision,
// and builds the canonical receipt. Trusts nothing: hashes the binary itself.
// The load pattern mirrors seal-check/test/receipt-harness.cjs (proven working).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname);
const WASM_DIR = path.join(ROOT, "wasm");
let _M = null, _cfg = null, _K = null;
const CONFIG_PUBKEY = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
const CONFIG_PRIVATE_KEY = crypto.createPrivateKey({
  key: Buffer.from(
    "302e020100300506032b657004220420" +
    "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "hex"),
  format: "der", type: "pkcs8",
});

function signConfig(config) {
  const payload = JSON.stringify(config);
  const signature = crypto.sign(null, Buffer.from(payload, "utf8"), CONFIG_PRIVATE_KEY).toString("hex");
  return { payload, signature, pubkey: CONFIG_PUBKEY,
    envelope: JSON.stringify({ payload, signature }) };
}

async function load() {
  if (_M) return { M: _M, cfg: _cfg, K: _K };
  globalThis.require = require;            // wasm glue's NODE branch needs these
  globalThis.__dirname = WASM_DIR;
  (0, eval)(fs.readFileSync(path.join(WASM_DIR, "seal.js"), "utf8")); // -> globalThis.SealModule
  _M = await globalThis.SealModule({
    locateFile: (p) => path.join(WASM_DIR, p), print() {}, printErr() {},
  });
  _cfg = await import("file://" + path.join(ROOT, "seal-config.js"));
  _K = await import("file://" + path.join(ROOT, "kernel.js"));
  return { M: _M, cfg: _cfg, K: _K };
}

// sha256 of the ACTUAL kernel binary on disk — the only thing self-verified.
function kernelSha() {
  const bytes = fs.readFileSync(path.join(WASM_DIR, "seal.wasm"));
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

// One self-contained decision. Returns { raw, verdict, receipt } — receipt
// is schema v1 (seal-host/docs/DECISION-RECEIPT-SCHEMA.md) via the vendored
// kernel.js buildReceipt.
async function decide(config, { tool, args = {}, approvals = [], now = 1000 }) {
  const { M, cfg, K } = await load();
  const signedConfig = signConfig(config);
  const ir = JSON.parse(M.ccall("seal_init", "string", ["string", "string"],
    [signedConfig.envelope, signedConfig.pubkey]));
  if (ir.ok !== true) throw new Error("seal_init failed: " + JSON.stringify(ir));
  const step = cfg.buildStepInput({ tool, args, approvals, now });
  const raw = M.ccall("seal_decide", "string", ["string"], [step]);
  const parsed = cfg.parseVerdict(raw, tool);
  const computed = kernelSha();
  const sha = { computed, pinned: K.KERNEL_WASM_SHA256, match: computed === K.KERNEL_WASM_SHA256 };
  const base = JSON.parse(K.canonicalReceiptJson(K.buildReceipt({
    call: { tool, args, approvals, now }, config, parsed, raw, sha, signedConfig,
  })));
  return { raw, verdict: base.verdict, receipt: base };
}

// Verification path: consume the receipt's exact authenticated bytes. Never
// signs, substitutes a policy, or trusts a receipt-supplied authority claim.
async function decideSigned(signedConfig, { tool, args = {}, approvals = [], now = 1000 }) {
  const { M, cfg } = await load();
  const envelope = JSON.stringify({ payload: signedConfig.payload, signature: signedConfig.signature });
  const ir = JSON.parse(M.ccall("seal_init", "string", ["string", "string"],
    [envelope, signedConfig.pubkey]));
  if (ir.ok !== true) return { signature_valid: false, initError: ir.error || JSON.stringify(ir) };
  const step = cfg.buildStepInput({ tool, args, approvals, now });
  const raw = M.ccall("seal_decide", "string", ["string"], [step]);
  return { signature_valid: true, raw, parsed: cfg.parseVerdict(raw, tool) };
}

// Ordered multi-step session in ONE init (stateful kernels: temporal/budget/linear
// only fire across a trace). Returns the LAST step's verdict.
async function decideSeq(config, steps, tool) {
  const { M, cfg } = await load();
  const signedConfig = signConfig(config);
  const ir = JSON.parse(M.ccall("seal_init", "string", ["string", "string"],
    [signedConfig.envelope, signedConfig.pubkey]));
  if (ir.ok !== true) throw new Error("seal_init failed: " + JSON.stringify(ir));
  let raw, step;
  steps.forEach((s, i) => {
    step = cfg.buildStepInput({ ...s, id: i + 1 });
    raw = M.ccall("seal_decide", "string", ["string"], [step]);
  });
  const parsed = cfg.parseVerdict(raw, tool);
  const verdict = parsed.verdict === "DENY" ? "BLOCK" : parsed.verdict;
  return { raw, verdict, parsed };
}

async function pinnedSha() { const { K } = await load(); return K.KERNEL_WASM_SHA256; }

module.exports = { load, decide, decideSigned, decideSeq, kernelSha, pinnedSha, CONFIG_PUBKEY };
