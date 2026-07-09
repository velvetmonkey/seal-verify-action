// SPDX-License-Identifier: Apache-2.0
// GitHub Actions plumbing with zero dependencies: INPUT_* env vars, the
// GITHUB_OUTPUT / GITHUB_STEP_SUMMARY files, and `::` workflow commands.
// All functions take injected { env, stdout } so tests never touch process.*.
"use strict";

const fs = require("node:fs");

// The runner exposes `fail-on` as INPUT_FAIL-ON (spaces -> _, uppercased,
// dashes preserved) — hence bracket access, never dot access.
function getInput(env, name, def = "") {
  const v = env["INPUT_" + name.replace(/ /g, "_").toUpperCase()];
  return v === undefined || v === "" ? def : v;
}

function escapeData(s) {
  return String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function escapeProperty(s) {
  return escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

function issue(stdout, command, properties, message) {
  let props = "";
  const entries = Object.entries(properties || {});
  if (entries.length > 0) {
    props = " " + entries.map(([k, v]) => `${k}=${escapeProperty(v)}`).join(",");
  }
  stdout.write(`::${command}${props}::${escapeData(message || "")}\n`);
}

function error(stdout, message, properties) {
  issue(stdout, "error", properties, message);
}

function warning(stdout, message, properties) {
  issue(stdout, "warning", properties, message);
}

function group(stdout, title) {
  issue(stdout, "group", {}, title);
}

function endgroup(stdout) {
  stdout.write("::endgroup::\n");
}

// Raw log text inside a group. Any line that could itself be parsed as a
// workflow command is neutralised with a leading space.
function log(stdout, text) {
  const safe = String(text)
    .split("\n")
    .map((l) => (l.startsWith("::") ? " " + l : l))
    .join("\n");
  stdout.write(safe.endsWith("\n") ? safe : safe + "\n");
}

function setOutput(env, name, value) {
  const file = env.GITHUB_OUTPUT;
  if (!file) return;
  fs.appendFileSync(file, `${name}=${value}\n`);
}

function appendSummary(env, markdown) {
  const file = env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  fs.appendFileSync(file, markdown.endsWith("\n") ? markdown : markdown + "\n");
}

module.exports = {
  getInput,
  escapeData,
  escapeProperty,
  error,
  warning,
  group,
  endgroup,
  log,
  setOutput,
  appendSummary,
};
