// SPDX-License-Identifier: Apache-2.0
// Orchestration. run() returns the process exit code; dist/index.js is the
// only caller that touches real process globals.
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const gh = require("./gh.js");
const pin = require("./pin.js");
const { resolveReceipts } = require("./glob.js");
const { runVerify } = require("./verify-runner.js");
const { summarize, toMarkdown } = require("./report.js");

const VENDORED_VERIFY = path.resolve(__dirname, "../vendor/seal-assurance-kit/src/verify.cjs");

function relLabel(file, workDir) {
  const rel = path.relative(workDir, file).split(path.sep).join("/");
  return rel.startsWith("..") ? file : rel;
}

async function run({ env = process.env, cwd = process.cwd(), stdout = process.stdout } = {}) {
  const setEmptyOutputs = () => {
    for (const [name, value] of [["verified", 0], ["failed", 0],
      ["signature_valid", false], ["kernel_replay_consistent", false],
      ["kernel_replay_scope", "0/0"], ["authority_trusted", false]])
      gh.setOutput(env, name, value);
  };
  const receiptsInput = gh.getInput(env, "receipts", "**/*.receipt.json");
  const workingDirectory = gh.getInput(env, "working-directory", ".");
  const verifierVersion = gh.getInput(env, "verifier-version", "");
  const expectedConfigPubkeyInput = gh.getInput(env, "expected-config-pubkey", "");
  const expectedConfigPubkey = expectedConfigPubkeyInput || undefined;

  if (expectedConfigPubkey !== undefined && !/^[0-9a-f]{64}$/.test(expectedConfigPubkey)) {
    gh.error(stdout, "expected-config-pubkey must be 64 lowercase hex characters");
    setEmptyOutputs();
    return 2;
  }

  const workDir = path.resolve(cwd, workingDirectory);
  let workDirOk = false;
  try {
    workDirOk = fs.statSync(workDir).isDirectory();
  } catch {
    workDirOk = false;
  }
  if (!workDirOk) {
    gh.error(stdout, `working-directory does not exist: ${workingDirectory}`);
    setEmptyOutputs();
    return 2;
  }

  let resolved;
  try {
    resolved = resolveReceipts(receiptsInput, workDir);
  } catch (e) {
    gh.error(stdout, `bad receipts input: ${e.message}`);
    setEmptyOutputs();
    return 2;
  }
  const { files, missingLiterals, patterns } = resolved;

  // Fail closed on zero matches: a glob that matches nothing is a
  // misconfiguration, not a passing verification.
  if (files.length === 0 && missingLiterals.length === 0) {
    gh.warning(stdout, `no receipts matched: ${patterns.join(", ")} (working-directory: ${workingDirectory})`);
    gh.error(stdout, "seal-verify: no receipts matched — failing closed");
    setEmptyOutputs();
    gh.appendSummary(
      env,
      toMarkdown([], { pin, verifierVersion, patterns, workingDirectory })
    );
    return 2;
  }

  const { verify } = require(VENDORED_VERIFY);
  const results = [];

  for (const missing of missingLiterals) {
    results.push({ relPath: missing, status: "not-found", detail: "file not found",
      signature_valid: false, kernel_replay_consistent: false, replay_applicable: true,
      authority_trusted: false });
  }

  for (const file of files) {
    const relPath = relLabel(file, workDir);
    const verified = await runVerify(verify, file, { expectedConfigPubkey });
    const { status, output, detail } = verified;
    gh.group(stdout, `seal verify ${relPath}`);
    gh.log(stdout, output);
    gh.endgroup(stdout);
    results.push({ relPath, ...verified, output: undefined });
  }

  for (const r of results) {
    if (r.status === "verified") continue;
    gh.error(stdout, r.detail || r.status, {
      file: r.relPath,
      title: "Seal receipt not verified",
    });
  }

  const { verified, failed } = summarize(results);
  gh.setOutput(env, "verified", verified);
  gh.setOutput(env, "failed", failed);
  const signatureValid = results.length > 0 && results.every((r) => r.signature_valid === true);
  // Replay consistency is aggregated over the receipts replay APPLIES to:
  // §11.1 unparseable-request receipts carry no (tool, arguments) and are out
  // of replay scope rather than replay failures. The length guard is the
  // vacuity check — [].every() is true, and a set with nothing replayable
  // must never claim replay consistency. kernel_replay_scope discloses the
  // coverage (applicable/matched) alongside the boolean.
  const replayApplicable = results.filter((r) => r.replay_applicable !== false);
  const replayConsistent = replayApplicable.length > 0 &&
    replayApplicable.every((r) => r.kernel_replay_consistent === true);
  const replayScope = `${replayApplicable.length}/${results.length}`;
  const authorityTrusted = results.length > 0 && results.every((r) => r.authority_trusted === true)
    ? true
    : results.length > 0 && results.every((r) => r.verificationCore === true && r.authority_trusted === "unpinned")
      ? "unpinned" : false;
  gh.setOutput(env, "signature_valid", signatureValid);
  gh.setOutput(env, "kernel_replay_consistent", replayConsistent);
  gh.setOutput(env, "kernel_replay_scope", replayScope);
  gh.setOutput(env, "authority_trusted", authorityTrusted);
  gh.appendSummary(env, toMarkdown(results, { pin, verifierVersion, patterns, workingDirectory }));
  gh.log(
    stdout,
    `seal-verify: ${verified} verified, ${failed} failed (verifier ${pin.KIT_NAME} ${pin.KIT_VERSION} @ ${pin.KIT_COMMIT.slice(0, 7)})`
  );

  if (failed === 0) return 0;
  return authorityTrusted === "unpinned" ? 3 : 1;
}

module.exports = { run };
