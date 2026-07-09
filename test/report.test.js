// SPDX-License-Identifier: Apache-2.0
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { summarize, toMarkdown } = require("../lib/report.js");
const pin = require("../lib/pin.js");

const RESULTS = [
  { relPath: "a.receipt.json", status: "verified", detail: "" },
  { relPath: "b.receipt.json", status: "not-verified", detail: "verdict re-derives identically" },
  { relPath: "c.receipt.json", status: "not-mediated", detail: "NOT MEDIATED (bypass receipt)" },
  { relPath: "d.receipt.json", status: "error", detail: "verifier internal error: boom" },
  { relPath: "e.receipt.json", status: "not-found", detail: "file not found" },
];

test("summarize counts verified vs everything else", () => {
  assert.deepEqual(summarize(RESULTS), { verified: 1, failed: 4 });
  assert.deepEqual(summarize([]), { verified: 0, failed: 0 });
});

test("markdown carries pin, patterns, one row per result, counts", () => {
  const md = toMarkdown(RESULTS, {
    pin,
    verifierVersion: "",
    patterns: ["**/*.receipt.json"],
    workingDirectory: ".",
  });
  assert.match(md, /seal-assurance-kit 0\.0\.1/);
  assert.match(md, new RegExp(pin.KIT_COMMIT.slice(0, 7)));
  assert.match(md, /\*\*1 verified, 4 failed\.\*\*/);
  assert.match(md, /✅ VERIFIED/);
  assert.match(md, /❌ NOT MEDIATED \(bypass\)/);
  assert.match(md, /❌ NOT FOUND/);
  const rows = md.split("\n").filter((l) => l.startsWith("| `"));
  assert.equal(rows.length, RESULTS.length);
});

test("markdown escapes pipes and newlines in details", () => {
  const md = toMarkdown(
    [{ relPath: "x.json", status: "not-verified", detail: "a|b\nc" }],
    { pin, verifierVersion: "", patterns: ["x.json"], workingDirectory: "." }
  );
  assert.match(md, /a\\\|b c/);
});

test("declared verifier-version is echoed alongside the pin", () => {
  const md = toMarkdown([], {
    pin,
    verifierVersion: "0.0.1-team-label",
    patterns: ["x"],
    workingDirectory: ".",
  });
  assert.match(md, /declared: `0\.0\.1-team-label`/);
});
