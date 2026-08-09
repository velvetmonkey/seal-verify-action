// SPDX-License-Identifier: Apache-2.0
// Cross-platform receipt probe used by CI. It copies the input, mutates one
// receipt byte, and records only deterministic verdict fields.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { verify } = require("../vendor/seal-assurance-kit/src/verify.cjs");

const source = path.resolve(__dirname, "../fixtures/pass/allow.receipt.json");
const outputPath = path.resolve(process.argv[2] || "e2e-verdict.json");
const expectedConfigPubkey = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";

function failLines(output) {
  return output.split("\n").filter((line) => /FAIL\s+/.test(line)).map((line) => line.trim());
}

async function run(file) {
  const lines = [];
  const log = console.log;
  const error = console.error;
  console.log = (...args) => lines.push(args.join(" "));
  console.error = (...args) => lines.push(args.join(" "));
  try {
    const result = await verify(file, { expectedConfigPubkey });
    const receipt = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      outcome: result?.outcome || "failure",
      verdict: receipt?.verdict || null,
      signature_valid: result?.signature_valid === true,
      kernel_replay_consistent: result?.kernel_replay_consistent === true,
      authority_trusted: result?.authority_trusted ?? false,
      fail_lines: failLines(lines.join("\n")),
    };
  } finally {
    console.log = log;
    console.error = error;
  }
}

async function main() {
  const scratch = fs.mkdtempSync(path.join(process.cwd(), ".winverify-e2e-"));
  try {
    const tampered = path.join(scratch, "tampered.receipt.json");
    fs.copyFileSync(source, tampered);
    const bytes = fs.readFileSync(tampered);
    const marker = Buffer.from('"verdict": "ALLOW"');
    const at = bytes.indexOf(marker);
    if (at < 0) throw new Error("fixture verdict marker not found");
    bytes[at + marker.length - 5] = "X".charCodeAt(0);
    fs.writeFileSync(tampered, bytes);

    const original = await run(source);
    const tamper = await run(tampered);
    if (original.outcome !== "authorised") throw new Error(`original receipt did not authorise: ${JSON.stringify(original)}`);
    if (tamper.outcome === "authorised" || tamper.fail_lines.length === 0) {
      throw new Error(`tampered receipt did not go RED with a named failure: ${JSON.stringify(tamper)}`);
    }
    const report = { original, tamper };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(report)}\n`);
    console.log(`ORIGINAL verdict=${original.verdict} outcome=${original.outcome}`);
    console.log(`TAMPER verdict=${tamper.verdict} outcome=${tamper.outcome} failure=${tamper.fail_lines[0]}`);
    console.log(`E2E report=${outputPath}`);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
});
