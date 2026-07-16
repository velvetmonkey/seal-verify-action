// SPDX-License-Identifier: Apache-2.0
// End-to-end: run() against the in-repo fixtures with fake GitHub env.
// This is where the vendored verify closure is exercised in-tree.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { run, aggregateVerdicts } = require("../lib/main.js");

const REPO = path.resolve(__dirname, "..");
const TEST_PUBKEY = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";

function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seal-main-"));
  const env = {
    GITHUB_OUTPUT: path.join(dir, "out"),
    GITHUB_STEP_SUMMARY: path.join(dir, "sum"),
    "INPUT_EXPECTED-CONFIG-PUBKEY": TEST_PUBKEY,
  };
  const stdout = {
    buf: "",
    write(s) {
      this.buf += s;
    },
  };
  const outputs = () =>
    Object.fromEntries(
      fs
        .readFileSync(env.GITHUB_OUTPUT, "utf8")
        .trim()
        .split("\n")
        .map((l) => l.split("="))
    );
  const summary = () => fs.readFileSync(env.GITHUB_STEP_SUMMARY, "utf8");
  return { env, stdout, outputs, summary };
}

test("pass fixtures all verify with honest replay scope, exit 0", async () => {
  const h = harness();
  h.env.INPUT_RECEIPTS = "fixtures/pass/**/*.receipt.json";
  const code = await run({ env: h.env, cwd: REPO, stdout: h.stdout });
  assert.equal(code, 0);
  // fixtures/pass/ holds only fully-verifiable receipts (the §11.1 unparseable
  // one now lives in fixtures/reduced/ — it is not a pass). All three are
  // parseable and replay-applicable: 3/3.
  assert.deepEqual(h.outputs(), { verified: "3", reduced_scope: "0", failed: "0", signature_valid: "true",
    kernel_replay_consistent: "true", kernel_replay_scope: "3/3", authority_trusted: "true" });
  assert.match(h.stdout.buf, /::group::seal verify fixtures\/pass\/allow\.receipt\.json/);
  assert.doesNotMatch(h.stdout.buf, /REDUCED SCOPE/);
  assert.doesNotMatch(h.stdout.buf, /::error/);
  assert.match(h.summary(), /\*\*3 verified, 0 failed \(0 at reduced scope\)\.\*\* Replay scope: 3\/3 applicable\./);
});

test("VACUITY GUARD (direct): aggregateVerdicts over an EMPTY set claims nothing", () => {
  // [].every() is true. Without the `length > 0` prefix on each aggregate, a
  // zero-receipt set would report signature_valid / kernel_replay_consistent /
  // authority_trusted all true — "everything verified" over nothing verified.
  // This pins ALL THREE length guards at once (lib/main.js aggregateVerdicts);
  // drop any one and this goes RED. The e2e path fails closed on zero matches
  // upstream, so this direct unit test is the only place the guards are reachable.
  const out = aggregateVerdicts([]);
  assert.equal(out.signatureValid, false, "signature_valid must not be vacuously true over []");
  assert.equal(out.replayConsistent, false, "kernel_replay_consistent must not be vacuously true over []");
  assert.equal(out.authorityTrusted, false, "authority_trusted must not be vacuously true over []");
  assert.equal(out.replayScope, "0/0");
});

test("VACUITY GUARD (direct): all-unparseable (replay-inapplicable) set is replay-vacuous, not consistent", () => {
  // A non-empty set where every receipt is OUT of replay scope: signature and
  // authority still aggregate over the real receipts (true), but replay has
  // nothing applicable and must NOT claim consistency.
  const unparseable = [
    { signature_valid: true, authority_trusted: true, replay_applicable: false },
    { signature_valid: true, authority_trusted: true, replay_applicable: false },
  ];
  const out = aggregateVerdicts(unparseable);
  assert.equal(out.signatureValid, true);
  assert.equal(out.authorityTrusted, true);
  assert.equal(out.replayConsistent, false, "zero replay-applicable => never consistent");
  assert.equal(out.replayScope, "0/2");
});

test("unparseable receipt is REDUCED SCOPE (exit 4), never verified, and replay is not vacuously true", async () => {
  const h = harness();
  h.env.INPUT_RECEIPTS = "fixtures/reduced/unparseable.receipt.json";
  const code = await run({ env: h.env, cwd: REPO, stdout: h.stdout });
  // Fleet P0: an unparseable receipt maps to the DISTINCT reduced-scope state
  // (exit 4), never verified (exit 0) and never a hard failure (exit 1). It is
  // counted in `failed` so a `failed==0` gate fails closed. The vacuity guard
  // still holds: zero replay-applicable receipts => replay is false, not a
  // vacuous true over nothing replayed.
  assert.equal(code, 4);
  const out = h.outputs();
  assert.notEqual(out.kernel_replay_consistent, "true");
  assert.deepEqual(out, { verified: "0", reduced_scope: "1", failed: "1", signature_valid: "true",
    kernel_replay_consistent: "false", kernel_replay_scope: "0/1", authority_trusted: "true" });
  assert.match(h.stdout.buf, /REDUCED SCOPE \(authorised-unparseable\)/);
  assert.doesNotMatch(h.stdout.buf, /PASS {2}AUTHORISED|✅ AUTHORISED/);
  assert.match(h.stdout.buf, /::error file=fixtures\/reduced\/unparseable\.receipt\.json,title=Seal receipt at reduced scope/);
  assert.match(h.summary(), /⚠️ REDUCED SCOPE \(authorised-unparseable\)/);
});

test("genuinely inconsistent replay still reports false with full scope", async () => {
  const h = harness();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seal-divergent-"));
  const receipt = JSON.parse(fs.readFileSync(
    path.join(REPO, "fixtures/pass/allow.receipt.json"), "utf8"));
  receipt.emitted_bytes = receipt.emitted_bytes.slice(0, -1) + " ";
  fs.writeFileSync(path.join(dir, "divergent.receipt.json"), JSON.stringify(receipt));
  h.env.INPUT_RECEIPTS = path.join(dir, "divergent.receipt.json");
  const code = await run({ env: h.env, cwd: REPO, stdout: h.stdout });
  assert.equal(code, 1);
  assert.deepEqual(h.outputs(), { verified: "0", reduced_scope: "0", failed: "1", signature_valid: "true",
    kernel_replay_consistent: "false", kernel_replay_scope: "1/1", authority_trusted: "true" });
  assert.match(h.summary(), /emitted decision bytes differ/);
});

test("unparseable fixture keeps proving the §11.1 rule at the verifier layer", async () => {
  const { verifyReceipt } = require("../vendor/seal-assurance-kit/src/verify.cjs");
  const receipt = JSON.parse(fs.readFileSync(
    path.join(REPO, "fixtures/reduced/unparseable.receipt.json"), "utf8"));
  const r = await verifyReceipt(receipt, { expectedConfigPubkey: TEST_PUBKEY });
  assert.equal(r.outcome, "authorised-unparseable");
  assert.equal(r.unparseableRequest, true);
  // Not a match, not a mismatch — its own state.
  assert.equal(r.requestHashMatch, null);
  assert.equal(r.kernelMaterialConsistent, true);
  // The binding is kernel-attested now: the audit's own sha256 of the judged
  // bytes matches the receipt's request_sha256.
  assert.equal(r.kernelRequestBinding, true);
});

test("RED: forged request pairing on an unparseable receipt fails closed", async () => {
  // Kernel material from the real judged line presented with a DIFFERENT
  // request_sha256. Before the kernel committed to the judged bytes this
  // forgery VERIFIED — nothing tied request_sha256 to the kernel material.
  const { verifyReceipt } = require("../vendor/seal-assurance-kit/src/verify.cjs");
  const receipt = JSON.parse(fs.readFileSync(
    path.join(REPO, "fixtures/fail/forged-binding.receipt.json"), "utf8"));
  const r = await verifyReceipt(receipt, { expectedConfigPubkey: TEST_PUBKEY });
  assert.equal(r.kernelRequestBinding, false);
  assert.equal(r.outcome, "failure");

  const h = harness();
  h.env.INPUT_RECEIPTS = "fixtures/fail/forged-binding.receipt.json";
  const code = await run({ env: h.env, cwd: REPO, stdout: h.stdout });
  assert.equal(code, 1);
  assert.match(h.summary(), /kernel-attested request hash does not match request_sha256/);
});

test("bypass receipt fails with annotation, exit 1", async () => {
  const h = harness();
  h.env.INPUT_RECEIPTS = "fixtures/fail/bypass.receipt.json";
  const code = await run({ env: h.env, cwd: REPO, stdout: h.stdout });
  assert.equal(code, 1);
  assert.deepEqual(h.outputs(), { verified: "0", reduced_scope: "0", failed: "1", signature_valid: "false",
    kernel_replay_consistent: "false", kernel_replay_scope: "1/1", authority_trusted: "false" });
  assert.match(
    h.stdout.buf,
    /::error file=fixtures\/fail\/bypass\.receipt\.json,title=Seal receipt not verified::/
  );
  assert.match(h.summary(), /NOT MEDIATED/);
});

test("zero matches fails closed as action configuration error", async () => {
  const h = harness();
  h.env.INPUT_RECEIPTS = "no/such/dir/**/*.receipt.json";
  const code = await run({ env: h.env, cwd: REPO, stdout: h.stdout });
  assert.equal(code, 2);
  assert.deepEqual(h.outputs(), { verified: "0", reduced_scope: "0", failed: "0", signature_valid: "false",
    kernel_replay_consistent: "false", kernel_replay_scope: "0/0", authority_trusted: "false" });
  assert.match(h.stdout.buf, /::warning::no receipts matched/);
  assert.match(h.stdout.buf, /::error::seal-verify: no receipts matched — failing closed/);
});

test("missing authority pin reports authentic-but-unpinned and exits 3", async () => {
  const h = harness();
  delete h.env["INPUT_EXPECTED-CONFIG-PUBKEY"];
  h.env.INPUT_RECEIPTS = "fixtures/pass/**/*.receipt.json";
  const code = await run({ env: h.env, cwd: REPO, stdout: h.stdout });
  assert.equal(code, 3);
  assert.deepEqual(h.outputs(), { verified: "0", reduced_scope: "0", failed: "3", signature_valid: "true",
    kernel_replay_consistent: "true", kernel_replay_scope: "3/3", authority_trusted: "unpinned" });
  assert.match(h.stdout.buf, /::error file=/);
});

test("working-directory + newline multi-pattern", async () => {
  const h = harness();
  h.env["INPUT_WORKING-DIRECTORY"] = "fixtures";
  h.env.INPUT_RECEIPTS = "pass/**/*.receipt.json\nfail/bypass.receipt.json";
  const code = await run({ env: h.env, cwd: REPO, stdout: h.stdout });
  assert.equal(code, 1);
  assert.deepEqual(h.outputs(), { verified: "3", reduced_scope: "0", failed: "1", signature_valid: "false",
    kernel_replay_consistent: "false", kernel_replay_scope: "4/4", authority_trusted: "false" });
  assert.match(h.stdout.buf, /::group::seal verify pass\/allow\.receipt\.json/);
});

test("unreadable receipt counts as failed with cannot-read detail", async () => {
  const h = harness();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seal-garbage-"));
  fs.writeFileSync(path.join(dir, "junk.receipt.json"), "not json {");
  h.env.INPUT_RECEIPTS = path.join(dir, "junk.receipt.json");
  const code = await run({ env: h.env, cwd: REPO, stdout: h.stdout });
  assert.equal(code, 1);
  assert.deepEqual(h.outputs(), { verified: "0", reduced_scope: "0", failed: "1", signature_valid: "false",
    kernel_replay_consistent: "false", kernel_replay_scope: "1/1", authority_trusted: "false" });
  assert.match(h.summary(), /cannot read receipt/);
});

test("missing literal path fails closed as not-found", async () => {
  const h = harness();
  h.env.INPUT_RECEIPTS = "fixtures/pass/allow.receipt.json\nfixtures/nope.receipt.json";
  const code = await run({ env: h.env, cwd: REPO, stdout: h.stdout });
  assert.equal(code, 1);
  assert.deepEqual(h.outputs(), { verified: "1", reduced_scope: "0", failed: "1", signature_valid: "false",
    kernel_replay_consistent: "false", kernel_replay_scope: "2/2", authority_trusted: "false" });
  assert.match(h.summary(), /NOT FOUND/);
});

test("malformed authority pin is a config error", async () => {
  const h = harness();
  h.env["INPUT_EXPECTED-CONFIG-PUBKEY"] = "bad";
  const code = await run({ env: h.env, cwd: REPO, stdout: h.stdout });
  assert.equal(code, 2);
  assert.match(h.stdout.buf, /expected-config-pubkey/);
});

test("missing working-directory is a config error", async () => {
  const h = harness();
  h.env["INPUT_WORKING-DIRECTORY"] = "no/such/dir";
  const code = await run({ env: h.env, cwd: REPO, stdout: h.stdout });
  assert.equal(code, 2);
  assert.match(h.stdout.buf, /working-directory does not exist/);
});

test("wrong authority pin fails despite valid signature and replay", async () => {
  const h = harness();
  h.env["INPUT_EXPECTED-CONFIG-PUBKEY"] = "0".repeat(64);
  h.env.INPUT_RECEIPTS = "fixtures/pass/allow.receipt.json";
  const code = await run({ env: h.env, cwd: REPO, stdout: h.stdout });
  assert.equal(code, 1);
  assert.deepEqual(h.outputs(), { verified: "0", reduced_scope: "0", failed: "1", signature_valid: "true",
    kernel_replay_consistent: "true", kernel_replay_scope: "1/1", authority_trusted: "false" });
  assert.match(h.stdout.buf, /unauthorised config signer/);
});
