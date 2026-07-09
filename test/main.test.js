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

function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seal-main-"));
  const env = {
    GITHUB_OUTPUT: path.join(dir, "out"),
    GITHUB_STEP_SUMMARY: path.join(dir, "sum"),
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
  assert.deepEqual(h.outputs(), { verified: "3", failed: "0" });
  assert.match(h.stdout.buf, /::group::seal verify fixtures\/pass\/allow\.receipt\.json/);
  assert.doesNotMatch(h.stdout.buf, /::error/);
  assert.match(h.summary(), /\*\*3 verified, 0 failed\.\*\*/);
});

test("bypass receipt fails with annotation, exit 1", async () => {
  const h = harness();
  h.env.INPUT_RECEIPTS = "fixtures/fail/bypass.receipt.json";
  const code = await run({ env: h.env, cwd: REPO, stdout: h.stdout });
  assert.equal(code, 1);
  assert.deepEqual(h.outputs(), { verified: "0", failed: "1" });
  assert.match(
    h.stdout.buf,
    /::error file=fixtures\/fail\/bypass\.receipt\.json,title=Seal receipt not verified::/
  );
  assert.match(h.summary(), /NOT MEDIATED/);
});

test("zero matches fails closed regardless of fail-on", async () => {
  const h = harness();
  h.env.INPUT_RECEIPTS = "no/such/dir/**/*.receipt.json";
  h.env["INPUT_FAIL-ON"] = "never";
  const code = await run({ env: h.env, cwd: REPO, stdout: h.stdout });
  assert.equal(code, 1);
  assert.deepEqual(h.outputs(), { verified: "0", failed: "0" });
  assert.match(h.stdout.buf, /::warning::no receipts matched/);
  assert.match(h.stdout.buf, /::error::seal-verify: no receipts matched — failing closed/);
});

test("fail-on=never reports failures but exits 0", async () => {
  const h = harness();
  h.env.INPUT_RECEIPTS = "fixtures/**/*.receipt.json";
  h.env["INPUT_FAIL-ON"] = "never";
  const code = await run({ env: h.env, cwd: REPO, stdout: h.stdout });
  assert.equal(code, 0);
  assert.deepEqual(h.outputs(), { verified: "3", failed: "1" });
  assert.match(h.stdout.buf, /::error file=/);
});

test("working-directory + newline multi-pattern", async () => {
  const h = harness();
  h.env["INPUT_WORKING-DIRECTORY"] = "fixtures";
  h.env.INPUT_RECEIPTS = "pass/**/*.receipt.json\nfail/bypass.receipt.json";
  h.env["INPUT_FAIL-ON"] = "never";
  const code = await run({ env: h.env, cwd: REPO, stdout: h.stdout });
  assert.equal(code, 0);
  assert.deepEqual(h.outputs(), { verified: "3", failed: "1" });
  assert.match(h.stdout.buf, /::group::seal verify pass\/allow\.receipt\.json/);
});

test("unreadable receipt counts as failed with cannot-read detail", async () => {
  const h = harness();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seal-garbage-"));
  fs.writeFileSync(path.join(dir, "junk.receipt.json"), "not json {");
  h.env.INPUT_RECEIPTS = path.join(dir, "junk.receipt.json");
  const code = await run({ env: h.env, cwd: REPO, stdout: h.stdout });
  assert.equal(code, 1);
  assert.deepEqual(h.outputs(), { verified: "0", failed: "1" });
  assert.match(h.summary(), /cannot read receipt/);
});

test("missing literal path fails closed as not-found", async () => {
  const h = harness();
  h.env.INPUT_RECEIPTS = "fixtures/pass/allow.receipt.json\nfixtures/nope.receipt.json";
  const code = await run({ env: h.env, cwd: REPO, stdout: h.stdout });
  assert.equal(code, 1);
  assert.deepEqual(h.outputs(), { verified: "1", failed: "1" });
  assert.match(h.summary(), /NOT FOUND/);
});

test("invalid fail-on is a config error", async () => {
  const h = harness();
  h.env["INPUT_FAIL-ON"] = "sometimes";
  const code = await run({ env: h.env, cwd: REPO, stdout: h.stdout });
  assert.equal(code, 1);
  assert.match(h.stdout.buf, /invalid fail-on/);
});

test("missing working-directory is a config error", async () => {
  const h = harness();
  h.env["INPUT_WORKING-DIRECTORY"] = "no/such/dir";
  const code = await run({ env: h.env, cwd: REPO, stdout: h.stdout });
  assert.equal(code, 1);
  assert.match(h.stdout.buf, /working-directory does not exist/);
});
