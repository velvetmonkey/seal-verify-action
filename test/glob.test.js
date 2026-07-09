// SPDX-License-Identifier: Apache-2.0
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { splitPatterns, isGlob, compile, resolveReceipts } = require("../lib/glob.js");

function makeTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "seal-glob-"));
  const mk = (p) => fs.mkdirSync(path.join(root, p), { recursive: true });
  const touch = (p) => fs.writeFileSync(path.join(root, p), "{}");
  mk("sub/deep");
  mk("node_modules");
  mk(".git");
  touch("a.receipt.json");
  touch("other.txt");
  touch("sub/b.receipt.json");
  touch("sub/deep/c.receipt.json");
  touch("node_modules/x.receipt.json");
  touch(".git/y.receipt.json");
  try {
    fs.symlinkSync(path.join(root, "sub"), path.join(root, "linkdir"), "dir");
  } catch {
    // symlink unavailable (unlikely on linux runners); ** test still valid
  }
  return root;
}

function rels(root, files) {
  return files.map((f) => path.relative(root, f).split(path.sep).join("/"));
}

test("splitPatterns trims and drops blanks", () => {
  assert.deepEqual(splitPatterns("  a.json \n\n b/*.json\n"), ["a.json", "b/*.json"]);
});

test("isGlob detects wildcards", () => {
  assert.equal(isGlob("**/*.receipt.json"), true);
  assert.equal(isGlob("x?.json"), true);
  assert.equal(isGlob("plain/path.json"), false);
});

test("compile rejects character classes, absolute and escaping patterns", () => {
  assert.throws(() => compile("a[bc].json"), /character classes/);
  assert.throws(() => compile("/abs/*.json"), /relative to working-directory/);
  assert.throws(() => compile("../up/*.json"), /must not escape/);
  assert.throws(() => compile("."), /empty pattern/);
});

test("globstar matches any depth, skips .git and node_modules, no symlink descent", () => {
  const root = makeTree();
  const { files } = resolveReceipts("**/*.receipt.json", root);
  assert.deepEqual(rels(root, files), [
    "a.receipt.json",
    "sub/b.receipt.json",
    "sub/deep/c.receipt.json",
  ]);
});

test("single star stays within one segment", () => {
  const root = makeTree();
  const { files } = resolveReceipts("*.receipt.json", root);
  assert.deepEqual(rels(root, files), ["a.receipt.json"]);
});

test("question mark matches exactly one character", () => {
  const root = makeTree();
  const { files } = resolveReceipts("sub/?.receipt.json", root);
  assert.deepEqual(rels(root, files), ["sub/b.receipt.json"]);
});

test("trailing globstar collects all files below", () => {
  const root = makeTree();
  const { files } = resolveReceipts("sub/**", root);
  assert.deepEqual(rels(root, files), ["sub/b.receipt.json", "sub/deep/c.receipt.json"]);
});

test("explicit segment may name skip-listed dirs", () => {
  const root = makeTree();
  const { files } = resolveReceipts("node_modules/*.receipt.json", root);
  assert.deepEqual(rels(root, files), ["node_modules/x.receipt.json"]);
});

test("missing literal is reported, not dropped", () => {
  const root = makeTree();
  const { files, missingLiterals } = resolveReceipts(
    "a.receipt.json\nno/such/file.json",
    root
  );
  assert.deepEqual(rels(root, files), ["a.receipt.json"]);
  assert.deepEqual(missingLiterals, ["no/such/file.json"]);
});

test("union is deduped and sorted deterministically", () => {
  const root = makeTree();
  const { files } = resolveReceipts(
    "sub/**\n**/*.receipt.json\na.receipt.json",
    root
  );
  assert.deepEqual(rels(root, files), [
    "a.receipt.json",
    "sub/b.receipt.json",
    "sub/deep/c.receipt.json",
  ]);
});

test("zero matches yields empty result, no throw", () => {
  const root = makeTree();
  const { files, missingLiterals } = resolveReceipts("nope/**/*.json", root);
  assert.deepEqual(files, []);
  assert.deepEqual(missingLiterals, []);
});
