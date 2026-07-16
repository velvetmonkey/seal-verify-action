// SPDX-License-Identifier: Apache-2.0
// Cross-copy differential — the vendored (fork) verifier vs the kit@0aeb35a
// (trust-rootless upstream) verifier over one receipt set.
//
// PROFILE-KEYED (kit docs/VERIFY-PROFILES.md): the fork DECLARES its profile
// in lib/pin.js (P-ENFORCE); the hermetic kit reference is pinned P-REF (it is
// kit@0aeb35a, which predates declarations — the spec roster names kit P-REF).
// Every expected verdict below is LOOKED UP from the spec's per-profile table,
// not hand-named: where the two profiles agree the copies must agree (a
// genuine pass, a §11.1 reduced-scope receipt, a pathological-number receipt,
// a config-less UNPARSEABLE forge), and where the profiles differ (a
// config-less parseable receipt, an unpinned receipt) the divergence is
// asserted IN BOTH DIRECTIONS — each side must land EXACTLY on its own
// profile's class, so an accidental convergence (the action loosening, or kit
// tightening) goes RED, not silently green. The fork is a DELIBERATE
// downstream-stricter divergence (VENDORED.md "Fork deltas"); the profile
// split P-ENFORCE-vs-P-REF IS the fork.
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

const pin = require(path.join(REPO, "lib/pin.js"));
const fork = require(path.join(REPO, "vendor/seal-assurance-kit/src/verify.cjs"));
const kit = require(path.join(REPO, "test/reference-kit-0aeb35a/verify.cjs"));

// The fork's LIVE declared profile, and the reference's roster-pinned one.
const FORK_PROFILE = pin.VERIFY_PROFILE;
const REF_PROFILE = "P-REF"; // kit@0aeb35a predates declarations; spec roster.

// Expected verdict class per (profile, input class) — the P-REF / P-ENFORCE
// rows of kit docs/VERIFY-PROFILES.md §7 (machine mirror:
// seal-assurance-kit/test/corpus/verify-profiles.json). Inlined here because
// this test is hermetic (no sibling checkout); keep in sync with the spec —
// changing a cell is a design decision, not a refactor.
const TABLE = {
  "P-REF": {
    "pass-pinned": "PASS",
    "pass-unpinned": "PASS",
    "configless-parseable": "PASS",
    "configless-unparseable-forge": "FAIL",
    "legit-unparseable": "REDUCED",
  },
  "P-ENFORCE": {
    "pass-pinned": "PASS",
    "pass-unpinned": "UNPINNED",
    "configless-parseable": "FAIL",
    "configless-unparseable-forge": "FAIL",
    "legit-unparseable": "REDUCED",
  },
};

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

// Look up both sides' expectations for one input class.
function expect(inputClass) {
  return { fork: TABLE[FORK_PROFILE][inputClass], kit: TABLE[REF_PROFILE][inputClass] };
}

// ---- the declarations themselves --------------------------------------------

test("declarations: the fork declares P-ENFORCE (lib/pin.js, spec grammar) and the profiles genuinely differ", () => {
  assert.equal(FORK_PROFILE, "P-ENFORCE", "lib/pin.js VERIFY_PROFILE");
  // Extractable by the spec regex (the fleet tools read it without importing).
  const src = fs.readFileSync(path.join(REPO, "lib/pin.js"), "utf8");
  const m = src.match(/VERIFY_PROFILE[^"']*["'](P-[A-Z]+)["']/);
  assert.ok(m && m[1] === "P-ENFORCE", "declaration not extractable per the spec grammar");
  assert.ok(TABLE[FORK_PROFILE] && TABLE[REF_PROFILE], "both profiles present in the table");
  // Non-vacuity: if the two declared profiles expected the SAME class on every
  // input, the fork would be decorative and this differential vacuous.
  const divergent = Object.keys(TABLE[REF_PROFILE])
    .filter((k) => TABLE[REF_PROFILE][k] !== TABLE[FORK_PROFILE][k]);
  assert.ok(divergent.length >= 2,
    `expected >=2 divergent rows between ${REF_PROFILE} and ${FORK_PROFILE}, got ${divergent}`);
});

// ---- profile-derived AGREE rows ---------------------------------------------

test("AGREE (derived): a genuine pass receipt — both profiles expect PASS", async () => {
  const e = expect("pass-pinned");
  assert.equal(await forkVerdict(path.join(REPO, PASS)), e.fork, `fork[${FORK_PROFILE}]`);
  assert.equal(await kitVerdict(path.join(REPO, PASS)), e.kit, `kit[${REF_PROFILE}]`);
});

test("AGREE (derived): the §11.1 reduced-scope receipt — both profiles expect REDUCED, neither a false pass", async () => {
  const e = expect("legit-unparseable");
  assert.equal(await forkVerdict(path.join(REPO, REDUCED)), e.fork, `fork[${FORK_PROFILE}]`);
  assert.equal(await kitVerdict(path.join(REPO, REDUCED)), e.kit, `kit[${REF_PROFILE}]`);
});

test("AGREE (universal U1): a pathological-number receipt — neither verifier crashes, both refuse", async () => {
  // A monster-exponent JSON number literal injected into the receipt's
  // `arguments` — the field both verifiers re-derive the canonical request from.
  // JSON.parse yields Infinity (JS), which must not blow up either verifier; the
  // re-derived request no longer matches the stored hash, so both refuse (never
  // PASS), identically. This is invariant U1 — it holds in EVERY profile, so the
  // expectation here is profile-independent by spec.
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

test("AGREE (derived): a config-less UNPARSEABLE forge — both profiles expect FAIL (the §11.1 P0 holds in both)", async () => {
  // kit's reduced-scope path also requires an Ed25519-signed config (REF-4),
  // so a config-less unparseable ALLOW is refused by BOTH — this is NOT a
  // divergence row (that is the PARSEABLE config-less receipt below).
  const e = expect("configless-unparseable-forge");
  const r = load(REDUCED);
  delete r.signed_config;
  delete r.kernel_config;
  const file = tmp("configless-unparseable.receipt.json", r);
  assert.equal(await forkVerdict(file), e.fork, `fork[${FORK_PROFILE}]`);
  assert.equal(await kitVerdict(file), e.kit, `kit[${REF_PROFILE}]`);
});

// ---- profile-derived DIVERGENCE rows (both directions by construction) ------

test("DIVERGENCE (derived): config-less PARSEABLE receipt — P-REF verifies, P-ENFORCE hard-fails", async () => {
  // The load-bearing fork property, now a table row: P-ENFORCE requires
  // signed_config (ENF-1); P-REF is trust-rootless and accepts (REF-2). Same
  // receipt, opposite verdict — each side asserted EXACTLY, so a future
  // flatten-to-kit (action accepts) OR kit-tighten (kit rejects) trips this.
  const e = expect("configless-parseable");
  assert.notEqual(e.kit, e.fork, "spec table says this row diverges");
  const r = load(PASS);
  delete r.signed_config;
  const file = tmp("configless.receipt.json", r);
  assert.equal(await kitVerdict(file), e.kit, `kit[${REF_PROFILE}] (trust-rootless) accepts a config-less receipt`);
  assert.equal(await forkVerdict(file), e.fork, `fork[${FORK_PROFILE}] REQUIRES signed_config — config-less is a hard fail`);
});

test("DIVERGENCE (derived): unpinned receipt (no expected-config-pubkey) — P-REF verifies, P-ENFORCE holds UNPINNED", async () => {
  // Verified WITHOUT supplying expected-config-pubkey: P-REF has no trust
  // anchor and verifies; P-ENFORCE's ceiling without a pin is UNPINNED
  // (ENF-2), below "verified". Each side asserted exactly — both directions.
  const e = expect("pass-unpinned");
  assert.notEqual(e.kit, e.fork, "spec table says this row diverges");
  assert.equal(await kitVerdict(path.join(REPO, PASS)), e.kit, `kit[${REF_PROFILE}] has no trust anchor — verifies unpinned`);
  assert.equal(await forkVerdict(path.join(REPO, PASS), { pin: false }), e.fork,
    `fork[${FORK_PROFILE}] holds an unpinned-but-authentic receipt at UNPINNED, never a bare pass`);
});
