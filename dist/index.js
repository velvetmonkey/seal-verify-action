// SPDX-License-Identifier: Apache-2.0
// Entry point for the node20 action runtime. Not bundled on purpose: the
// vendored verifier loads its wasm kernel and sibling modules from disk via
// __dirname / file:// paths, which a bundler would break — and JS actions run
// from the fully checked-out action repo, so plain require() just works.
"use strict";

const { run } = require("../lib/main.js");

run()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    process.stdout.write(
      `::error::seal-verify-action internal error: ${String(err && err.message ? err.message : err).replace(/[%\r\n]/g, " ")}\n`
    );
    process.exitCode = 1;
  });
