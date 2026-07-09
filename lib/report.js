// SPDX-License-Identifier: Apache-2.0
// Pure aggregation + rendering. No filesystem, no GitHub env — testable alone.
"use strict";

const STATUS_LABEL = {
  verified: "✅ VERIFIED",
  "not-verified": "❌ NOT VERIFIED",
  "not-mediated": "❌ NOT MEDIATED (bypass)",
  error: "❌ ERROR",
  "not-found": "❌ NOT FOUND",
};

function summarize(results) {
  let verified = 0;
  let failed = 0;
  for (const r of results) {
    if (r.status === "verified") verified += 1;
    else failed += 1;
  }
  return { verified, failed };
}

function mdEscape(s) {
  return String(s).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function toMarkdown(results, { pin, verifierVersion, patterns, workingDirectory }) {
  const { verified, failed } = summarize(results);
  const lines = [];
  lines.push("### Seal receipt verification");
  lines.push("");
  const shortCommit = pin.KIT_COMMIT.slice(0, 7);
  let verifierLine = `Verifier: \`${pin.KIT_NAME} ${pin.KIT_VERSION}\` (vendored @ \`${shortCommit}\`)`;
  if (verifierVersion) verifierLine += ` — declared: \`${mdEscape(verifierVersion)}\``;
  lines.push(verifierLine);
  lines.push(
    `Patterns: \`${mdEscape(patterns.join(", "))}\` in \`${mdEscape(workingDirectory)}\``
  );
  lines.push("");
  lines.push("| Receipt | Result | Detail |");
  lines.push("|---|---|---|");
  for (const r of results) {
    lines.push(
      `| \`${mdEscape(r.relPath)}\` | ${STATUS_LABEL[r.status] || r.status} | ${mdEscape(r.detail || "")} |`
    );
  }
  lines.push("");
  lines.push(`**${verified} verified, ${failed} failed.**`);
  lines.push("");
  return lines.join("\n");
}

module.exports = { summarize, toMarkdown, STATUS_LABEL };
