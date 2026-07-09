// SPDX-License-Identifier: Apache-2.0
// Runs the vendored verify() with console output captured. Receipts are
// verified strictly sequentially: the vendored kernel is a module-level wasm
// singleton (runner.cjs `_M`) and its loader mutates globalThis — parallel
// runs would race. Capture (not streaming) also lets us extract the failure
// detail and keeps receipt-derived text from being parsed as `::` commands.
"use strict";

async function captureConsole(fn) {
  const buf = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a) => buf.push(a.join(" "));
  console.error = (...a) => buf.push(a.join(" "));
  try {
    const result = await fn();
    return { result, output: buf.join("\n") };
  } catch (thrown) {
    return { thrown, output: buf.join("\n") };
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
}

function firstFailLine(output) {
  for (const line of output.split("\n")) {
    const m = line.match(/^\s*FAIL\s+(.*\S)\s*$/);
    if (m) return m[1];
  }
  return "";
}

// -> { status: 'verified'|'not-verified'|'not-mediated'|'error', output, detail }
async function runVerify(verifyFn, receiptPath) {
  const { result, thrown, output } = await captureConsole(() => verifyFn(receiptPath));
  if (thrown) {
    return {
      status: "error",
      output,
      detail: `verifier internal error: ${thrown.message}`,
    };
  }
  if (result === true) return { status: "verified", output, detail: "" };
  if (/NOT MEDIATED/.test(output)) {
    return { status: "not-mediated", output, detail: firstFailLine(output) || "NOT MEDIATED (bypass receipt)" };
  }
  return { status: "not-verified", output, detail: firstFailLine(output) || "NOT VERIFIED" };
}

module.exports = { captureConsole, firstFailLine, runVerify };
