// SPDX-License-Identifier: Apache-2.0
//
// Uniformity catalogue vector #4 — pathological JSON number, fail-closed.
//
// A wire line carrying a monster-exponent number (1e9999999999) used to split
// the fleet: the OLD d3067bc0 wasm returned classify-default passthrough — a
// mediation bypass. The ff1bfd68 repin (guard carried forward by the current d7d81e27 kernel) refuses it BEFORE Json.parse
// (Seal.JsonUtil.wireNumbersSafe) and the refuse route is `block`. This drives
// the VENDORED wasm the action actually loads and pins: block, never
// passthrough, no crash — same input, same verdict as every fleet copy.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { load } = require("../vendor/seal-assurance-kit/kernel/runner.cjs");

const PATHOLOGICAL = "1e9999999999";

const _keys = crypto.generateKeyPairSync("ed25519");
const _pub = Buffer.from(_keys.publicKey.export({ type: "spki", format: "der" }))
  .subarray(-32).toString("hex");
function initSession(M, cfg) {
  const payload = JSON.stringify(cfg.CFG_STANDARD);
  const signature = crypto.sign(null, Buffer.from(payload, "utf8"), _keys.privateKey).toString("hex");
  const ir = JSON.parse(M.ccall("seal_init", "string", ["string", "string"],
    [JSON.stringify({ payload, signature }), _pub]));
  assert.equal(ir.ok, true, `seal_init failed: ${JSON.stringify(ir)}`);
}
function decideLine(M, line) {
  const step = JSON.stringify({ line, now: 1000, approvals: [], votes: "", grants: "", forecasts: "" });
  return JSON.parse(M.ccall("seal_decide", "string", ["string"], [step]));
}

test("pathological number on a tools/call is BLOCKED (fail-closed), never passthrough", async () => {
  const { M, cfg } = await load();
  initSession(M, cfg);
  const line =
    `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"db.execute",` +
    `"arguments":{"database":"prod","sql":"drop table users","x":${PATHOLOGICAL}}}}`;
  const v = decideLine(M, line);
  assert.equal(v.route, "block", `expected fail-closed block, got ${JSON.stringify(v)}`);
  assert.notEqual(v.route, "passthrough", "the OLD d3067bc0 fail-open: must never recur");
  assert.ok(!v.error, `verifier must not error/crash: ${v.error || ""}`);
});

test("pathological number is refused even on a would-be-passthrough line", async () => {
  const { M, cfg } = await load();
  initSession(M, cfg);
  const line = `{"jsonrpc":"2.0","method":"notifications/progress","params":{"x":${PATHOLOGICAL}}}`;
  const v = decideLine(M, line);
  assert.equal(v.route, "block", `refuse must dominate passthrough, got ${JSON.stringify(v)}`);
});

test("control: a benign notification still passes through (no blanket block)", async () => {
  const { M, cfg } = await load();
  initSession(M, cfg);
  const v = decideLine(M, `{"jsonrpc":"2.0","method":"notifications/progress","params":{"x":1}}`);
  assert.equal(v.route, "passthrough", `benign lines still pass through, got ${JSON.stringify(v)}`);
});
