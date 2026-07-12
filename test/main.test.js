// SPDX-License-Identifier: Apache-2.0
// End-to-end: run() against the in-repo fixtures with fake GitHub env.
// This is where the vendored verify closure is exercised in-tree.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { run } = require("../lib/main.js");

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

test("pass fixtures all verify, exit 0", async () => {
  const h = harness();
  h.env.INPUT_RECEIPTS = "fixtures/pass/**/*.receipt.json";
  const code = await run({ env: h.env, cwd: REPO, stdout: h.stdout });
  assert.equal(code, 0);
  assert.deepEqual(h.outputs(), { verified: "3", failed: "0", signature_valid: "true",
    kernel_replay_consistent: "true", authority_trusted: "true" });
  assert.match(h.stdout.buf, /::group::seal verify fixtures\/pass\/allow\.receipt\.json/);
  assert.doesNotMatch(h.stdout.buf, /::error/);
  assert.match(h.summary(), /\*\*3 verified, 0 failed\.\*\*/);
});

test("bypass receipt fails with annotation, exit 1", async () => {
  const h = harness();
  h.env.INPUT_RECEIPTS = "fixtures/fail/bypass.receipt.json";
  const code = await run({ env: h.env, cwd: REPO, stdout: h.stdout });
  assert.equal(code, 1);
  assert.deepEqual(h.outputs(), { verified: "0", failed: "1", signature_valid: "false",
    kernel_replay_consistent: "false", authority_trusted: "false" });
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
  assert.deepEqual(h.outputs(), { verified: "0", failed: "0", signature_valid: "false",
    kernel_replay_consistent: "false", authority_trusted: "false" });
  assert.match(h.stdout.buf, /::warning::no receipts matched/);
  assert.match(h.stdout.buf, /::error::seal-verify: no receipts matched — failing closed/);
});

test("missing authority pin reports authentic-but-unpinned and exits 3", async () => {
  const h = harness();
  delete h.env["INPUT_EXPECTED-CONFIG-PUBKEY"];
  h.env.INPUT_RECEIPTS = "fixtures/pass/**/*.receipt.json";
  const code = await run({ env: h.env, cwd: REPO, stdout: h.stdout });
  assert.equal(code, 3);
  assert.deepEqual(h.outputs(), { verified: "0", failed: "3", signature_valid: "true",
    kernel_replay_consistent: "true", authority_trusted: "unpinned" });
  assert.match(h.stdout.buf, /::error file=/);
});

test("working-directory + newline multi-pattern", async () => {
  const h = harness();
  h.env["INPUT_WORKING-DIRECTORY"] = "fixtures";
  h.env.INPUT_RECEIPTS = "pass/**/*.receipt.json\nfail/bypass.receipt.json";
  const code = await run({ env: h.env, cwd: REPO, stdout: h.stdout });
  assert.equal(code, 1);
  assert.deepEqual(h.outputs(), { verified: "3", failed: "1", signature_valid: "false",
    kernel_replay_consistent: "false", authority_trusted: "false" });
  assert.match(h.stdout.buf, /::group::seal verify pass\/allow\.receipt\.json/);
});

test("unreadable receipt counts as failed with cannot-read detail", async () => {
  const h = harness();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seal-garbage-"));
  fs.writeFileSync(path.join(dir, "junk.receipt.json"), "not json {");
  h.env.INPUT_RECEIPTS = path.join(dir, "junk.receipt.json");
  const code = await run({ env: h.env, cwd: REPO, stdout: h.stdout });
  assert.equal(code, 1);
  assert.deepEqual(h.outputs(), { verified: "0", failed: "1", signature_valid: "false",
    kernel_replay_consistent: "false", authority_trusted: "false" });
  assert.match(h.summary(), /cannot read receipt/);
});

test("missing literal path fails closed as not-found", async () => {
  const h = harness();
  h.env.INPUT_RECEIPTS = "fixtures/pass/allow.receipt.json\nfixtures/nope.receipt.json";
  const code = await run({ env: h.env, cwd: REPO, stdout: h.stdout });
  assert.equal(code, 1);
  assert.deepEqual(h.outputs(), { verified: "1", failed: "1", signature_valid: "false",
    kernel_replay_consistent: "false", authority_trusted: "false" });
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
  assert.deepEqual(h.outputs(), { verified: "0", failed: "1", signature_valid: "true",
    kernel_replay_consistent: "true", authority_trusted: "false" });
  assert.match(h.stdout.buf, /unauthorised config signer/);
});
