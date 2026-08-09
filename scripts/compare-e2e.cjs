// SPDX-License-Identifier: Apache-2.0
"use strict";

const fs = require("node:fs");
const linux = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const windows = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const a = JSON.stringify(linux.original);
const b = JSON.stringify(windows.original);
if (a !== b) {
  console.error(`FAIL Linux and Windows original verdicts differ\nLinux: ${a}\nWindows: ${b}`);
  process.exitCode = 1;
} else {
  console.log(`PASS Linux and Windows original verdicts are byte-identical: ${a}`);
}
