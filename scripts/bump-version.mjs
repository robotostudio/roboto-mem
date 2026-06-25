#!/usr/bin/env node
// Bumps the version in all three sources at once so they cannot drift:
// package.json, .claude-plugin/marketplace.json, .claude-plugin/plugin.json.
// Does NOT commit or tag — review the diff, then commit, tag, and push.
//
//   node scripts/bump-version.mjs 0.1.2
import { readFile, writeFile } from "node:fs/promises";

const version = process.argv[2]?.replace(/^v/, "");
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version)) {
  console.error(
    `usage: pnpm bump <semver>   (got: ${process.argv[2] ?? "nothing"})`,
  );
  process.exit(1);
}

const root = new URL("../", import.meta.url);
const files = [
  "package.json",
  ".claude-plugin/marketplace.json",
  ".claude-plugin/plugin.json",
];

const bump = async (rel) => {
  const url = new URL(rel, root);
  const text = await readFile(url, "utf8");
  // Replace the first `"version": "..."` only — top-level for package/plugin,
  // the single plugin entry for the marketplace — which preserves formatting.
  const re = /("version":\s*")[^"]+(")/;
  if (!re.test(text)) throw new Error(`no version field found in ${rel}`);
  await writeFile(url, text.replace(re, `$1${version}$2`));
};

await Promise.all(files.map(bump));
console.log(`✓ bumped to ${version} in ${files.length} files:`);
for (const file of files) console.log(`    ${file}`);
console.log(
  `\nNext:\n    git commit -am "chore(release): v${version}"\n    git tag v${version}\n    git push && git push origin v${version}`,
);
