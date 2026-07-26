// SPDX-License-Identifier: Apache-2.0
// Generate the deliberate request-binding forgery from a real current-kernel
// unparseable receipt. Never edit the receipt's kernel identity or signed
// config: the sole mutation is the request hash the negative test is meant to
// make disagree with the kernel-attested hash in emitted_bytes.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { KERNEL_WASM_SHA256 } = require("../lib/pin.js");

const [sourceArg, outputArg] = process.argv.slice(2);
if (!sourceArg || !outputArg) {
  console.error("usage: node scripts/gen-forged-binding-fixture.cjs <minted-receipt> <output>");
  process.exit(2);
}

const source = path.resolve(sourceArg);
const output = path.resolve(outputArg);
const receipt = JSON.parse(fs.readFileSync(source, "utf8"));
const audit = JSON.parse(JSON.parse(receipt.emitted_bytes).audit);

if (receipt.kernel_identity?.wasm_sha256 !== KERNEL_WASM_SHA256) {
  throw new Error(`minted receipt kernel is not current: ${receipt.kernel_identity?.wasm_sha256}`);
}
if (receipt.request_sha256 !== audit.request_sha256) {
  throw new Error("source receipt is not genuinely kernel-bound");
}
if (!/^[0-9a-f]{64}$/.test(receipt.request_sha256)) {
  throw new Error("source receipt has no valid request_sha256");
}

const last = receipt.request_sha256.at(-1);
receipt.request_sha256 =
  receipt.request_sha256.slice(0, -1) + (last === "0" ? "1" : "0");

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(receipt, null, 2) + "\n");
console.log(`generated deliberate binding forgery: ${output}`);
console.log(`  kernel identity preserved: ${receipt.kernel_identity.wasm_sha256}`);
console.log(`  request_sha256: ${audit.request_sha256} -> ${receipt.request_sha256}`);
