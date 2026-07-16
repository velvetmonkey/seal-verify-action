// SPDX-License-Identifier: Apache-2.0
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { summarize, toMarkdown } = require("../lib/report.js");
const pin = require("../lib/pin.js");

const RESULTS = [
  { relPath: "a.receipt.json", status: "verified", detail: "", signature_valid: true, kernel_replay_consistent: true, authority_trusted: true },
  { relPath: "b.receipt.json", status: "not-verified", detail: "verdict re-derives identically" },
  { relPath: "c.receipt.json", status: "not-mediated", detail: "NOT MEDIATED (bypass receipt)" },
  { relPath: "d.receipt.json", status: "error", detail: "verifier internal error: boom" },
  { relPath: "e.receipt.json", status: "not-found", detail: "file not found" },
];

test("summarize counts verified vs everything else", () => {
  assert.deepEqual(summarize(RESULTS), { verified: 1, reducedScope: 0, failed: 4 });
  assert.deepEqual(summarize([]), { verified: 0, reducedScope: 0, failed: 0 });
});

test("reduced-scope is counted in failed AND surfaced separately", () => {
  const withReduced = [
    { relPath: "a.receipt.json", status: "verified" },
    { relPath: "u.receipt.json", status: "reduced-scope" },
    { relPath: "b.receipt.json", status: "not-verified" },
  ];
  // fail-closed: reduced-scope is inside `failed` (a `failed==0` gate refuses
  // it), and also reported on its own so VERIFIED != REDUCED-SCOPE != failure.
  assert.deepEqual(summarize(withReduced), { verified: 1, reducedScope: 1, failed: 2 });
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
  assert.match(md, /\*\*1 verified, 4 failed \(0 at reduced scope\)\.\*\*/);
  assert.match(md, /✅ AUTHORISED/);
  assert.match(md, /❌ NOT MEDIATED \(bypass\)/);
  assert.match(md, /❌ NOT FOUND/);
  const rows = md.split("\n").filter((l) => l.startsWith("| `"));
  assert.equal(rows.length, RESULTS.length);
});

test("replay column renders n/a when replay does not apply, never false", () => {
  const md = toMarkdown(
    [
      { relPath: "u.receipt.json", status: "reduced-scope", detail: "REDUCED SCOPE — unparseable request: kernel-attested request binding (audit sha256 = request_sha256), Ed25519-signed config; no canonical replay — NOT independently verified", signature_valid: true, kernel_replay_consistent: false, replay_applicable: false, authority_trusted: true },
      { relPath: "a.receipt.json", status: "verified", detail: "", signature_valid: true, kernel_replay_consistent: true, replay_applicable: true, authority_trusted: true },
    ],
    { pin, verifierVersion: "", patterns: ["**/*.receipt.json"], workingDirectory: "." }
  );
  assert.match(md, /\| `u\.receipt\.json` \| ⚠️ REDUCED SCOPE \(authorised-unparseable\) — NOT independently verified \| true \| n\/a \|/);
  assert.match(md, /\| `a\.receipt\.json` \| ✅ AUTHORISED \| true \| true \|/);
  assert.match(md, /Replay scope: 1\/2 applicable\./);
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
