// SPDX-License-Identifier: Apache-2.0
// Minimal glob subset over the local filesystem: `**` (any depth, incl. zero),
// `*` (within a path segment), `?` (one non-separator char), and literal paths.
// No braces, extglobs, or character classes — `[` is rejected loudly rather
// than mis-matched. Zero dependencies; the node20 action runtime has no fs.glob.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SKIP_DIRS = new Set([".git", "node_modules"]);

function splitPatterns(input) {
  return String(input)
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function isGlob(pattern) {
  return /[*?]/.test(pattern);
}

function segmentToRegExp(segment) {
  let re = "";
  for (const ch of segment) {
    if (ch === "*") re += "[^/]*";
    else if (ch === "?") re += "[^/]";
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + re + "$");
}

function compile(pattern) {
  if (pattern.includes("[")) {
    throw new Error(
      `unsupported pattern "${pattern}": character classes ([...]) are not supported; use *, ?, ** or literal paths`
    );
  }
  if (path.isAbsolute(pattern)) {
    throw new Error(
      `unsupported pattern "${pattern}": glob patterns must be relative to working-directory`
    );
  }
  const segments = pattern.split("/").filter((s) => s !== "" && s !== ".");
  if (segments.some((s) => s === "..")) {
    throw new Error(
      `unsupported pattern "${pattern}": glob patterns must not escape working-directory (..)`
    );
  }
  if (segments.length === 0) {
    throw new Error(`unsupported pattern "${pattern}": empty pattern`);
  }
  return segments.map((s) =>
    s === "**" ? { type: "globstar" } : { type: "re", re: segmentToRegExp(s), raw: s }
  );
}

function isFileish(entry, fullPath) {
  if (entry.isFile()) return true;
  if (entry.isSymbolicLink()) {
    try {
      return fs.statSync(fullPath).isFile();
    } catch {
      return false;
    }
  }
  return false;
}

function readdirSafe(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

// Expand compiled segments under rootDir. Returns absolute file paths.
// During `**` descent: .git and node_modules are skipped and directory
// symlinks are never followed (cycle safety). An explicit non-globstar
// segment may still name those directories literally.
function expand(rootDir, segments) {
  const out = new Set();
  const walk = (dir, i) => {
    const seg = segments[i];
    const last = i === segments.length - 1;
    const entries = readdirSafe(dir);
    if (seg.type === "globstar") {
      if (last) {
        for (const e of entries) {
          const p = path.join(dir, e.name);
          if (isFileish(e, p)) out.add(p);
        }
      } else {
        walk(dir, i + 1); // ** consumes zero directories
      }
      for (const e of entries) {
        if (!e.isDirectory() || e.isSymbolicLink()) continue;
        if (SKIP_DIRS.has(e.name)) continue;
        walk(path.join(dir, e.name), i);
      }
      return;
    }
    for (const e of entries) {
      if (!seg.re.test(e.name)) continue;
      const p = path.join(dir, e.name);
      if (last) {
        if (isFileish(e, p)) out.add(p);
      } else if (e.isDirectory() && !e.isSymbolicLink()) {
        walk(p, i + 1);
      }
    }
  };
  walk(rootDir, 0);
  return [...out];
}

// Resolve the `receipts` input against rootDir. Glob patterns expand under
// rootDir (and cannot escape it); literal paths may be absolute or contain
// `..` (the consumer's own runner) and are checked for existence — a missing
// literal is reported, never silently dropped (fail closed).
function resolveReceipts(input, rootDir) {
  const patterns = splitPatterns(input);
  const files = new Set();
  const missingLiterals = [];
  for (const pattern of patterns) {
    if (isGlob(pattern)) {
      for (const f of expand(rootDir, compile(pattern))) files.add(f);
    } else {
      const p = path.resolve(rootDir, pattern);
      let ok = false;
      try {
        ok = fs.statSync(p).isFile();
      } catch {
        ok = false;
      }
      if (ok) files.add(p);
      else missingLiterals.push(pattern);
    }
  }
  const sorted = [...files].sort((a, b) => {
    const ra = path.relative(rootDir, a).split(path.sep).join("/");
    const rb = path.relative(rootDir, b).split(path.sep).join("/");
    return ra < rb ? -1 : ra > rb ? 1 : 0;
  });
  return { files: sorted, missingLiterals, patterns };
}

module.exports = { splitPatterns, isGlob, compile, expand, resolveReceipts };
