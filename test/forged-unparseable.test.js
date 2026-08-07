// SPDX-License-Identifier: Apache-2.0
// Fleet P0 teeth (parity with seal-assurance-kit 706d644): a kernel-less forged
// unparseable ALLOW must NEVER be reported verified / exit 0 by the ACTION.
// It maps to the distinct reduced-scope status (exit 4). The forge reuses a
// real Ed25519-signed signed_config from a fixture and pins its pubkey — so the
// signature layer passes and the ONLY thing standing between the forge and a
// green CI gate is the reduced-scope-is-not-success rule this test enforces.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const { run } = require("../lib/main.js");
const { verifyReceipt } = require("../vendor/seal-assurance-kit/src/verify.cjs");
const { assembleReceiptV2 } = require("../vendor/seal-assurance-kit/kernel/receipt-format.js");

const REPO = path.resolve(__dirname, "..");
const TEST_PUBKEY = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
const FIX = JSON.parse(fs.readFileSync(
  path.join(REPO, "fixtures/reduced/unparseable.receipt.json"), "utf8"));

// Kernel-less forged unparseable ALLOW: attacker-chosen, internally
// self-consistent (audit maps allow->ALLOW, certs match, audit request_sha256
// == receipt request_sha256), reusing the fixture's real signed_config.
function forgedUnparseableAllow() {
  const H = crypto.createHash("sha256")
    .update('{"attacker":"chosen raw line the kernel never judged"}').digest("hex");
  const certs = [{ certHash: "111", kernel: "safety", reason: "forged", verdict: "allow" }];
  const audit = { certs, epoch: 1, request_sha256: H, tool: "db.execute", verdict: "allow" };
  const emitted = JSON.stringify({
    audit: JSON.stringify(audit),
    response: '{"id":1,"jsonrpc":"2.0","result":{"content":[],"isError":false}}\n',
    route: "forward",
  });
  return assembleReceiptV2({
    seal_receipt: "v2", now: 1784110716264, request_sha256: H,
    request_parse_error: "cannot parse mediated request for receipt: attacker-crafted unparseable line",
    bypass: false, verdict: "ALLOW", authorization: "explicit_policy_allow",
    reason: "forged explicit policy allow", deny_kernel: null, certs, emitted_bytes: emitted,
    kernel_identity: FIX.kernel_identity,
    host_identity: FIX.host_identity,
    asserted_provenance: FIX.asserted_provenance,
    signed_config: FIX.signed_config,
    kernel_config: FIX.kernel_config,
    granted_capabilities: [],
  });
}

function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seal-forge-"));
  const env = {
    GITHUB_OUTPUT: path.join(dir, "out"),
    GITHUB_STEP_SUMMARY: path.join(dir, "sum"),
    "INPUT_EXPECTED-CONFIG-PUBKEY": TEST_PUBKEY,
  };
  const stdout = { buf: "", write(s) { this.buf += s; } };
  const outputs = () => Object.fromEntries(
    fs.readFileSync(env.GITHUB_OUTPUT, "utf8").trim().split("\n").map((l) => l.split("=")));
  const summary = () => fs.readFileSync(env.GITHUB_STEP_SUMMARY, "utf8");
  return { env, stdout, outputs, summary, dir };
}

test("forge non-vacuity: reaches the reporting seam as authorised-unparseable", async () => {
  // If the forge were rejected at shape, the exit-code leg would prove nothing.
  const r = await verifyReceipt(JSON.stringify(forgedUnparseableAllow()), { expectedConfigPubkey: TEST_PUBKEY });
  assert.equal(r.formatOk, true, (r.formatErrors || []).join("; "));
  assert.equal(r.outcome, "authorised-unparseable");
  assert.equal(r.signature_valid, true);
  assert.equal(r.allGood, false);
});

test("P0: config-reusing forge is REDUCED SCOPE (exit 4), never verified/AUTHORISED", async () => {
  const h = harness();
  const file = path.join(h.dir, "forge.receipt.json");
  fs.writeFileSync(file, JSON.stringify(forgedUnparseableAllow(), null, 2) + "\n");
  h.env.INPUT_RECEIPTS = file;
  const code = await run({ env: h.env, cwd: REPO, stdout: h.stdout });
  assert.equal(code, 4);
  assert.deepEqual(h.outputs(), { verified: "0", reduced_scope: "1", failed: "1", signature_valid: "true",
    kernel_replay_consistent: "false", kernel_replay_scope: "0/1", authority_trusted: "true" });
  assert.doesNotMatch(h.stdout.buf, /PASS {2}AUTHORISED|✅ AUTHORISED/);
  assert.match(h.stdout.buf, /REDUCED SCOPE \(authorised-unparseable\)/);
  assert.match(h.summary(), /⚠️ REDUCED SCOPE \(authorised-unparseable\)/);
  fs.rmSync(h.dir, { recursive: true, force: true });
});

test("config-less forge is a HARD FAIL (exit 1), not reduced scope", async () => {
  const h = harness();
  const configless = { ...forgedUnparseableAllow() };
  delete configless.signed_config;
  delete configless.kernel_config;
  const file = path.join(h.dir, "configless.receipt.json");
  fs.writeFileSync(file, JSON.stringify(assembleReceiptV2(configless), null, 2) + "\n");
  h.env.INPUT_RECEIPTS = file;
  const code = await run({ env: h.env, cwd: REPO, stdout: h.stdout });
  assert.equal(code, 1);
  const out = h.outputs();
  assert.equal(out.verified, "0");
  assert.equal(out.reduced_scope, "0");
  assert.equal(out.failed, "1");
  fs.rmSync(h.dir, { recursive: true, force: true });
});

test("legit unparseable fixture stays honest reduced-scope (exit 4), not a hard failure", async () => {
  const h = harness();
  h.env.INPUT_RECEIPTS = "fixtures/reduced/unparseable.receipt.json";
  const code = await run({ env: h.env, cwd: REPO, stdout: h.stdout });
  assert.equal(code, 4);
  assert.equal(h.outputs().reduced_scope, "1");
  assert.match(h.stdout.buf, /REDUCED SCOPE \(authorised-unparseable\)/);
  assert.doesNotMatch(h.stdout.buf, /NOT VERIFIED/);
  fs.rmSync(h.dir, { recursive: true, force: true });
});

test("blue control: a genuine parseable receipt still verifies (exit 0)", async () => {
  const h = harness();
  h.env.INPUT_RECEIPTS = "fixtures/pass/allow.receipt.json";
  const code = await run({ env: h.env, cwd: REPO, stdout: h.stdout });
  assert.equal(code, 0);
  assert.deepEqual(h.outputs(), { verified: "1", reduced_scope: "0", failed: "0", signature_valid: "true",
    kernel_replay_consistent: "true", kernel_replay_scope: "1/1", authority_trusted: "true" });
  fs.rmSync(h.dir, { recursive: true, force: true });
});
