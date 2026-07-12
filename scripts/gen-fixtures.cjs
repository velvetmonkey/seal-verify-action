// SPDX-License-Identifier: Apache-2.0
// Canonical producer for the action's mediated receipt fixtures.
const fs = require("node:fs");
const path = require("node:path");
const { decide } = require("../vendor/seal-assurance-kit/kernel/runner.cjs");

const OUT = path.resolve(__dirname, "../fixtures/pass");

(async () => {
  const cfg = await import("file://" + path.resolve(__dirname,
    "../vendor/seal-assurance-kit/kernel/seal-config.js"));
  const block = (await decide(cfg.CFG_STANDARD, {
    tool: "db.execute", args: { database: "prod", sql: "drop table users" }, approvals: [],
  })).receipt;
  const allow = (await decide(cfg.CFG_STANDARD, {
    tool: "store.update", args: { op: "orset.add", key: "k1" },
    approvals: [cfg.stableHash(["store.update", "store"])],
  })).receipt;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "block.receipt.json"), JSON.stringify(block, null, 2) + "\n");
  fs.writeFileSync(path.join(OUT, "allow.receipt.json"), JSON.stringify(allow, null, 2) + "\n");
  fs.writeFileSync(path.join(OUT, "crosstool.receipt.json"), JSON.stringify(allow, null, 2) + "\n");
  console.log(`wrote signed fixtures: block=${block.verdict} allow=${allow.verdict}`);
})().catch((error) => { console.error("ERR", error.message); process.exit(1); });
