#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = path.join(REPO, "scripts", "vendored-files.json");
const VENDORED_ROOT = path.join(REPO, "vendor", "seal-assurance-kit");
const VENDORED_DOC = path.join(REPO, "VENDORED.md");
const SECTION_HEADING = "## Files and checksums";

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

function parseMode(argv) {
  if (argv.length === 0) return "write";
  if (argv.length === 1 && argv[0] === "--check") return "check";
  if (argv.length === 1 && argv[0] === "--print") return "print";
  throw new Error("usage: gen-vendored-pins.mjs [--check|--print]");
}

async function loadManifest() {
  let files;
  try {
    files = JSON.parse(await readFile(MANIFEST, "utf8"));
  } catch (error) {
    throw new Error(`cannot read ${path.relative(REPO, MANIFEST)}: ${error.message}`);
  }

  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("scripts/vendored-files.json must be a non-empty JSON array");
  }

  const seen = new Set();
  for (const file of files) {
    if (typeof file !== "string" || file.length === 0 || path.isAbsolute(file) ||
        file !== file.replaceAll("\\", "/") || file.split("/").includes("..")) {
      throw new Error(`invalid vendored path in manifest: ${JSON.stringify(file)}`);
    }
    if (seen.has(file)) throw new Error(`duplicate vendored path in manifest: ${file}`);
    seen.add(file);
  }
  return files;
}

async function sha256File(file) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const input = createReadStream(file);
    input.on("error", reject);
    input.on("data", chunk => hash.update(chunk));
    input.on("end", resolve);
  });
  return hash.digest("hex");
}

async function measure(files) {
  const measured = [];
  for (const file of files) {
    const absolute = path.join(VENDORED_ROOT, ...file.split("/"));
    let stat;
    try {
      stat = await lstat(absolute);
    } catch (error) {
      if (error.code === "ENOENT") throw new Error(`${file}: listed vendored file is missing`);
      throw new Error(`${file}: cannot inspect listed vendored file: ${error.message}`);
    }
    if (!stat.isFile()) throw new Error(`${file}: listed vendored path is not a regular file`);
    measured.push({ file, hash: await sha256File(absolute) });
  }
  return measured;
}

function locatePinBlock(document) {
  const heading = document.indexOf(SECTION_HEADING);
  if (heading === -1 || document.indexOf(SECTION_HEADING, heading + 1) !== -1) {
    throw new Error(`VENDORED.md must contain exactly one ${JSON.stringify(SECTION_HEADING)} heading`);
  }
  const open = document.indexOf("```\n", heading);
  if (open === -1) throw new Error("VENDORED.md checksum section has no opening fenced block");
  const start = open + 4;
  const end = document.indexOf("\n```", start);
  if (end === -1) throw new Error("VENDORED.md checksum section has no closing fenced block");
  return { start, end, block: document.slice(start, end) };
}

function emitBlock(measured) {
  return measured.map(({ hash, file }) => `${hash}  ${file}`).join("\n");
}

function diagnoseBlock(actualBlock, measured) {
  const actualLines = actualBlock.split("\n");
  const claimedLines = new Set();

  for (const { file, hash } of measured) {
    const suffix = `  ${file}`;
    const line = actualLines.find(candidate => candidate.endsWith(suffix));
    if (line === undefined) {
      fail(`${file}: committed pin line is missing`);
    } else if (line !== `${hash}${suffix}`) {
      claimedLines.add(line);
      const committed = line.slice(0, -suffix.length);
      fail(`${file}: committed pin ${committed} does not match measured sha256 ${hash}`);
    } else {
      claimedLines.add(line);
    }
  }

  for (const line of actualLines) {
    if (!claimedLines.has(line)) fail(`unexpected or malformed checksum line: ${JSON.stringify(line)}`);
  }
}

async function writeAtomically(file, contents) {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  try {
    await writeFile(temporary, contents, { encoding: "utf8", mode: 0o644, flag: "wx" });
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch(error => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

async function main() {
  const mode = parseMode(process.argv.slice(2));
  const files = await loadManifest();
  const measured = await measure(files);
  const generatedBlock = emitBlock(measured);

  if (mode === "print") {
    process.stdout.write(`${generatedBlock}\n`);
    return;
  }

  const document = await readFile(VENDORED_DOC, "utf8");
  const pinBlock = locatePinBlock(document);
  const generatedDocument = document.slice(0, pinBlock.start) + generatedBlock +
    document.slice(pinBlock.end);

  if (mode === "check") {
    if (document !== generatedDocument) {
      diagnoseBlock(pinBlock.block, measured);
      fail(`VENDORED.md checksum block is stale; run npm run gen:pins`);
      return;
    }
    console.log(`PASS VENDORED.md pins match ${files.length} measured vendored files`);
    return;
  }

  if (document === generatedDocument) {
    console.log(`PASS VENDORED.md already contains all ${files.length} measured pins`);
    return;
  }
  await writeAtomically(VENDORED_DOC, generatedDocument);
  console.log(`UPDATED VENDORED.md with ${files.length} measured pins`);
}

main().catch(error => {
  fail(error.message);
});
