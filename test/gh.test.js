// SPDX-License-Identifier: Apache-2.0
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const gh = require("../lib/gh.js");

function fakeStdout() {
  return {
    buf: "",
    write(s) {
      this.buf += s;
    },
  };
}

test("getInput reads INPUT_* incl. dashed names, applies default on empty", () => {
  const env = { "INPUT_WORKING-DIRECTORY": "never", INPUT_RECEIPTS: "" };
  assert.equal(gh.getInput(env, "working-directory", "."), "never");
  assert.equal(gh.getInput(env, "receipts", "**/*.receipt.json"), "**/*.receipt.json");
  assert.equal(gh.getInput(env, "missing", "dflt"), "dflt");
});

test("error annotation escapes properties and data", () => {
  const out = fakeStdout();
  gh.error(out, "line1\nline2 100%", { file: "a,b:c.json", title: "T" });
  assert.equal(
    out.buf,
    "::error file=a%2Cb%3Ac.json,title=T::line1%0Aline2 100%25\n"
  );
});

test("group/endgroup emit workflow commands", () => {
  const out = fakeStdout();
  gh.group(out, "seal verify x.json");
  gh.endgroup(out);
  assert.equal(out.buf, "::group::seal verify x.json\n::endgroup::\n");
});

test("log neutralises lines that look like workflow commands", () => {
  const out = fakeStdout();
  gh.log(out, "ok\n::error::sneaky\nend");
  assert.equal(out.buf, "ok\n ::error::sneaky\nend\n");
});

test("setOutput and appendSummary append to the named files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seal-gh-"));
  const env = {
    GITHUB_OUTPUT: path.join(dir, "out"),
    GITHUB_STEP_SUMMARY: path.join(dir, "sum"),
  };
  gh.setOutput(env, "verified", 3);
  gh.setOutput(env, "failed", 1);
  gh.appendSummary(env, "# hi");
  assert.equal(fs.readFileSync(env.GITHUB_OUTPUT, "utf8"), "verified=3\nfailed=1\n");
  assert.equal(fs.readFileSync(env.GITHUB_STEP_SUMMARY, "utf8"), "# hi\n");
});

test("setOutput/appendSummary are no-ops without the env files", () => {
  gh.setOutput({}, "x", 1);
  gh.appendSummary({}, "y");
});
