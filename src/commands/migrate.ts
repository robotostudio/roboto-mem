import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  CONFIG_FILE,
  CONFIG_VERSION_V2,
  type RepoConfig,
  readConfigFile,
  validateConfig,
} from "../core/config.js";
import { buildMigratedConfig } from "../core/migrate.js";
import type { CommandResult } from "../core/types.js";

export interface MigrateOptions {
  cwd: string;
}

/** Never written in-place over the original — see the "v1 config safety"
 * requirement in docs/design-specs/2026-07-17-global-library-model.md's
 * migration section: the source .roboto-mem.json is never deleted or
 * modified, so a bad migration is always recoverable by just deleting this
 * file and re-running. The user reviews the diff and renames it manually. */
export const MIGRATED_CONFIG_FILE = `${CONFIG_FILE}.migrated`;

const migrationNotes = (v1: RepoConfig): string[] =>
  [
    `entries still carrying legacy scopes (org, squad/*, stack/*, project/*) won't appear in the digest until the commons itself is migrated to untagged or "library:<name>" tags`,
    v1.squads.length > 0 &&
      `squad names (${v1.squads.join(", ")}) were folded into "libraries" verbatim — verify each matches (or will match, once commons-side migration retags entries) an actual library`,
    v1.overlays.length > 0 &&
      `overlays were preserved under "librariesLocal" for review — v2 supports a single commons only; promote their content into a library, or drop the field, before renaming`,
  ].filter((note): note is string => Boolean(note));

export const runMigrate = async (
  options: MigrateOptions,
): Promise<CommandResult> => {
  const { cwd } = options;
  const read = await readConfigFile(cwd, CONFIG_FILE);

  if (!read.ok) {
    const output =
      read.reason === "missing"
        ? "no .roboto-mem.json found — run roboto-mem init"
        : read.detail;
    return { exitCode: 1, output };
  }

  const { value: raw } = read;
  const version = raw.configVersion;

  if (version === CONFIG_VERSION_V2) {
    return {
      exitCode: 0,
      output: "Already migrated (configVersion: 2). Nothing to do.",
    };
  }

  if (version !== 1) {
    return {
      exitCode: 1,
      output: `Cannot migrate: configVersion is ${JSON.stringify(version)}, expected 1.`,
    };
  }

  const validated = validateConfig(raw);
  if (!validated.ok) {
    return { exitCode: 1, output: `Invalid v1 config: ${validated.detail}` };
  }

  const { config: v1 } = validated;
  const migrated = buildMigratedConfig(v1, raw);

  await fs.writeFile(
    path.join(cwd, MIGRATED_CONFIG_FILE),
    `${JSON.stringify(migrated, null, 2)}\n`,
    "utf8",
  );

  const notes = migrationNotes(v1);
  const lines = [
    `Migrated ${CONFIG_FILE} (configVersion 1) -> configVersion 2.`,
    `Wrote ${MIGRATED_CONFIG_FILE} — the original ${CONFIG_FILE} is unchanged.`,
    "",
    JSON.stringify(migrated, null, 2),
    ...(notes.length > 0
      ? ["", "Notes:", ...notes.map((n) => `  - ${n}`)]
      : []),
    "",
    "Review the new config, then replace the original:",
    `  mv ${MIGRATED_CONFIG_FILE} ${CONFIG_FILE}`,
  ];

  return { exitCode: 0, output: lines.join("\n") };
};
