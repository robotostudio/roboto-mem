#!/usr/bin/env node
// Asserts the three version sources agree, and optionally that they match a
// release tag passed as the first argument. Run by CI (ci.yml + release.yml)
// and locally before tagging a release.
//
//   node scripts/check-version-sync.mjs          # the three files must agree
//   node scripts/check-version-sync.mjs v0.1.2   # ...and equal this tag
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const readJson = async (rel) =>
  JSON.parse(await readFile(new URL(rel, root), "utf8"));

const [pkg, marketplace, plugin] = await Promise.all([
  readJson("package.json"),
  readJson(".claude-plugin/marketplace.json"),
  readJson(".claude-plugin/plugin.json"),
]);

const sources = {
  "package.json": pkg.version,
  ".claude-plugin/marketplace.json": marketplace.plugins?.[0]?.version,
  ".claude-plugin/plugin.json": plugin.version,
};

const tag = process.argv[2]?.replace(/^v/, "");
const target = tag ?? sources["package.json"];
const entries = Object.entries(sources);
const drift = entries.filter(([, value]) => value !== target);

if (drift.length === 0) {
  console.log(`✓ versions in sync at ${target}${tag ? " (matches tag)" : ""}`);
  process.exit(0);
}

console.error(
  `✗ version drift — expected ${target}${tag ? " (from tag)" : ""}:`,
);
for (const [file, value] of entries) {
  console.error(
    `    ${value === target ? "ok" : "→ "} ${file}: ${value ?? "(missing)"}`,
  );
}
console.error("\nFix with: pnpm bump <version>");
process.exit(1);
