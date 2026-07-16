// SPDX-License-Identifier: Apache-2.0
// Cross-copy differential — the vendored (fork) verifier vs the kit@0aeb35a
// (trust-rootless upstream) verifier over one receipt set.
//
// The fork is a DELIBERATE downstream-stricter divergence (VENDORED.md "Fork
// deltas"): it enforces signed_config + a trust anchor. This test pins that the
// two verifiers AGREE where they must (a genuine pass, a §11.1 reduced-scope
// receipt, a pathological-number receipt, a config-less UNPARSEABLE forge) and
// diverge ONLY in the named, expected way (a config-less parseable receipt and
// an unpinned receipt: kit accepts, the action holds it below "verified").
// Asserted in BOTH directions — an accidental convergence (the action loosening,
// or kit tightening) goes RED, not silently green.
//
// The kit-HEAD verifier is the test-only reference under
// test/reference-kit-0aeb35a/ (kit's own verify.cjs + receipt-format.js,
// re-pointed at the byte-identical vendored kernel). No network, no sibling
// checkout — hermetic in CI.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO = path.resolve(__dirname, "..");
const TEST_PUBKEY = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";

const fork = require(path.join(REPO, "vendor/seal-assurance-kit/src/verify.cjs"));
const kit = require(path.join(REPO, "test/reference-kit-0aeb35a/verify.cjs"));

// Canonical verdicts: PASS | REDUCED | UNPINNED | FAIL | NOT_MEDIATED | THREW.
async function forkVerdict(file, { pin = true } = {}) {
  const opts = pin ? { expectedConfigPubkey: TEST_PUBKEY } : {};
  let r;
  try { r = await captureThen(() => fork.verify(file, opts)); }
  catch (e) { return "THREW:" + e.message; }
  if (r?.notMediated) return "NOT_MEDIATED";
  return { authorised: "PASS", "authorised-unparseable": "REDUCED", unpinned: "UNPINNED", failure: "FAIL" }[r?.outcome] || "FAIL";
}

async function kitVerdict(file) {
  let summary;
  try {
    summary = await captureThen(async () => {
      await kit.verify(file);
      return null;
    }, true);
  } catch (e) { return "THREW:" + e.message; }
  if (/PASS {2}VERIFIED/.test(summary)) return "PASS";
  if (/REDUCED SCOPE/.test(summary)) return "REDUCED";
  if (/NOT MEDIATED/.test(summary)) return "NOT_MEDIATED";
  return "FAIL";
}

// Run fn with console captured; return fn's result, or (wantOutput) the captured text.
async function captureThen(fn, wantOutput = false) {
  const buf = [];
  const ol = console.log, oe = console.error;
  console.log = (...a) => buf.push(a.join(" "));
  console.error = (...a) => buf.push(a.join(" "));
  try {
    const result = await fn();
    return wantOutput ? buf.join("\n") : result;
  } finally {
    console.log = ol;
    console.error = oe;
  }
}

function tmp(name, obj) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xcopy-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) + "\n");
  return file;
}
function load(rel) { return JSON.parse(fs.readFileSync(path.join(REPO, rel), "utf8")); }

const PASS = "fixtures/pass/allow.receipt.json";
const REDUCED = "fixtures/reduced/unparseable.receipt.json";

// ---- AGREE rows ------------------------------------------------------------

test("AGREE: a genuine pass receipt — both verify", async () => {
  assert.equal(await forkVerdict(path.join(REPO, PASS)), "PASS");
  assert.equal(await kitVerdict(path.join(REPO, PASS)), "PASS");
});

test("AGREE: the §11.1 reduced-scope receipt — both reduced, neither a false pass", async () => {
  const f = await forkVerdict(path.join(REPO, REDUCED));
  const k = await kitVerdict(path.join(REPO, REDUCED));
  assert.equal(f, "REDUCED");
  assert.equal(k, "REDUCED");
});

test("AGREE: a pathological-number receipt — neither verifier crashes, both refuse", async () => {
  // A monster-exponent JSON number literal injected into the receipt's
  // `arguments` — the field both verifiers re-derive the canonical request from.
  // JSON.parse yields Infinity (JS), which must not blow up either verifier; the
  // re-derived request no longer matches the stored hash, so both refuse (never
  // PASS), identically.
  const raw = fs.readFileSync(path.join(REPO, PASS), "utf8")
    .replace('"arguments": {', '"arguments": {\n    "x": 1e9999999999,', 1);
  const file = tmp("patho.receipt.json", raw);
  const f = await forkVerdict(file);
  const k = await kitVerdict(file);
  assert.ok(!f.startsWith("THREW"), `fork threw on pathological number: ${f}`);
  assert.ok(!k.startsWith("THREW"), `kit threw on pathological number: ${k}`);
  assert.notEqual(f, "PASS");
  assert.notEqual(k, "PASS");
  assert.equal(f, k, `pathological verdict must agree: fork=${f} kit=${k}`);
});

test("AGREE: a config-less UNPARSEABLE forge — both refuse (the §11.1 P0 holds in both)", async () => {
  // kit's reduced-scope path also requires an Ed25519-signed config, so a
  // config-less unparseable ALLOW is refused by BOTH — this is NOT the named
  // divergence (that is the PARSEABLE config-less receipt below).
  const r = load(REDUCED);
  delete r.signed_config;
  delete r.kernel_config;
  const file = tmp("configless-unparseable.receipt.json", r);
  const f = await forkVerdict(file);
  const k = await kitVerdict(file);
  assert.notEqual(f, "PASS");
  assert.notEqual(k, "PASS");
});

// ---- NAMED PINNED DIVERGENCES (both directions) ----------------------------

test("DIVERGENCE (named): config-less PARSEABLE receipt — kit VERIFIES, the action HARD-FAILS", async () => {
  // The load-bearing fork property: the action requires signed_config; kit's
  // trust-rootless verifier does not. Same receipt, opposite verdict — pinned in
  // both directions so a future flatten-to-kit (action accepts) OR kit-tighten
  // (kit rejects) trips this test.
  const r = load(PASS);
  delete r.signed_config;
  const file = tmp("configless.receipt.json", r);
  assert.equal(await kitVerdict(file), "PASS", "kit HEAD (trust-rootless) accepts a config-less receipt");
  assert.equal(await forkVerdict(file), "FAIL", "the action REQUIRES signed_config — config-less is a hard fail");
});

test("DIVERGENCE (named): unpinned receipt (no expected-config-pubkey) — kit VERIFIES, the action holds UNPINNED", async () => {
  // Verified WITHOUT supplying expected-config-pubkey: kit has no trust anchor
  // and verifies; the action holds the authentic-but-unpinned receipt at UNPINNED
  // (exit 3), below "verified". Both directions pinned.
  assert.equal(await kitVerdict(path.join(REPO, PASS)), "PASS", "kit has no trust anchor — verifies unpinned");
  assert.equal(await forkVerdict(path.join(REPO, PASS), { pin: false }), "UNPINNED",
    "the action holds an unpinned-but-authentic receipt at UNPINNED, never a bare pass");
});
