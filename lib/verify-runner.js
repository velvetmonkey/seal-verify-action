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

// -> { status, output, detail, signature_valid, kernel_replay_consistent,
//      authority_trusted, outcome, verificationCore }
async function runVerify(verifyFn, receiptPath, options = {}) {
  const { result, thrown, output } = await captureConsole(() => verifyFn(receiptPath, options));
  if (thrown) {
    return {
      status: "error",
      output,
      detail: `verifier internal error: ${thrown.message}`,
      signature_valid: false,
      kernel_replay_consistent: false,
      authority_trusted: false,
    };
  }
  const dimensions = {
    signature_valid: result?.signature_valid === true,
    kernel_replay_consistent: result?.kernel_replay_consistent === true,
    authority_trusted: result?.authority_trusted ?? false,
    outcome: result?.outcome || "failure",
    verificationCore: result?.verificationCore === true,
  };
  if (result?.outcome === "authorised") return { status: "verified", output, detail: "", ...dimensions };
  // §11.1 unparseable-request receipt: verified at reduced scope (raw line
  // identity; no canonical replay possible). Rejecting it would restore to the
  // verifier the veto the producer was deliberately stripped of (schema §11.2).
  if (result?.outcome === "authorised-unparseable") return {
    status: "verified", output,
    detail: "unparseable request — verified by raw line identity; no canonical replay possible",
    ...dimensions,
  };
  if (result?.outcome === "unpinned") return {
    status: "unpinned", output, detail: firstFailLine(output) || "UNPINNED", ...dimensions,
  };
  if (result?.notMediated || /NOT MEDIATED/.test(output)) return {
    status: "not-mediated", output, detail: firstFailLine(output) || "NOT MEDIATED (bypass receipt)", ...dimensions,
  };
  return { status: "not-verified", output, detail: firstFailLine(output) || result?.readError || "NOT VERIFIED", ...dimensions };
}

module.exports = { captureConsole, firstFailLine, runVerify };
