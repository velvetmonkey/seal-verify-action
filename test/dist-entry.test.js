// SPDX-License-Identifier: Apache-2.0
// dist == source. This action is a node20 JS action whose entry (action.yml
// `main: dist/index.js`) is NOT a bundle: it is a thin loader that require()s
// ../lib/main.js and runs it. A bundler is deliberately avoided (the vendored
// verifier loads its wasm + sibling modules from disk via __dirname / file://
// paths, which bundling would break). This test pins that dist stays that thin
// loader — so it can never become a stale, silently-divergent copy of the logic.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO = path.resolve(__dirname, "..");
const dist = fs.readFileSync(path.join(REPO, "dist/index.js"), "utf8");

test("dist/index.js delegates to lib/main.js (thin loader, not a bundle)", () => {
  assert.match(dist, /require\(["']\.\.\/lib\/main\.js["']\)/,
    "dist entry must require ../lib/main.js — the single source of truth");
});

test("dist/index.js inlines no vendored logic (no stale bundle)", () => {
  assert.doesNotMatch(dist, /vendor\/seal-assurance-kit/,
    "dist must not reach into the vendor directly — it goes through lib");
  assert.ok(dist.length < 2048, `dist entry must stay a thin loader; got ${dist.length} bytes (a bundle would be far larger)`);
});

test("action.yml runs the dist entry on node20", () => {
  const action = fs.readFileSync(path.join(REPO, "action.yml"), "utf8");
  assert.match(action, /using:\s*["']node20["']/);
  assert.match(action, /main:\s*["']dist\/index\.js["']/);
});
