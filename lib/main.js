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
  const receiptsInput = gh.getInput(env, "receipts", "**/*.receipt.json");
  const workingDirectory = gh.getInput(env, "working-directory", ".");
  const failOn = gh.getInput(env, "fail-on", "any");
  const verifierVersion = gh.getInput(env, "verifier-version", "");

  if (failOn !== "any" && failOn !== "never") {
    gh.error(stdout, `invalid fail-on value "${failOn}": must be "any" or "never"`);
    return 1;
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
    return 1;
  }

  let resolved;
  try {
    resolved = resolveReceipts(receiptsInput, workDir);
  } catch (e) {
    gh.error(stdout, `bad receipts input: ${e.message}`);
    return 1;
  }
  const { files, missingLiterals, patterns } = resolved;

  // Fail closed on zero matches regardless of fail-on: a glob that matches
  // nothing is a misconfiguration, not a passing verification.
  if (files.length === 0 && missingLiterals.length === 0) {
    gh.warning(stdout, `no receipts matched: ${patterns.join(", ")} (working-directory: ${workingDirectory})`);
    gh.error(stdout, "seal-verify: no receipts matched — failing closed");
    gh.setOutput(env, "verified", 0);
    gh.setOutput(env, "failed", 0);
    gh.appendSummary(
      env,
      toMarkdown([], { pin, verifierVersion, patterns, workingDirectory })
    );
    return 1;
  }

  const { verify } = require(VENDORED_VERIFY);
  const results = [];

  for (const missing of missingLiterals) {
    results.push({ relPath: missing, status: "not-found", detail: "file not found" });
  }

  for (const file of files) {
    const relPath = relLabel(file, workDir);
    const { status, output, detail } = await runVerify(verify, file);
    gh.group(stdout, `seal verify ${relPath}`);
    gh.log(stdout, output);
    gh.endgroup(stdout);
    results.push({ relPath, status, detail });
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
  gh.appendSummary(env, toMarkdown(results, { pin, verifierVersion, patterns, workingDirectory }));
  gh.log(
    stdout,
    `seal-verify: ${verified} verified, ${failed} failed (verifier ${pin.KIT_NAME} ${pin.KIT_VERSION} @ ${pin.KIT_COMMIT.slice(0, 7)})`
  );

  return failed > 0 && failOn === "any" ? 1 : 0;
}

module.exports = { run };
