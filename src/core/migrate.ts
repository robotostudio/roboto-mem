import {
  CONFIG_VERSION_V2,
  LEGACY_V1_FIELDS,
  type RepoConfig,
} from "./config.js";

/** v1 keys `buildMigratedConfig` already accounts for explicitly (mapped into
 * a v2 field, or intentionally dropped) — anything else on the raw v1 JSON is
 * a genuinely unknown/custom key that must round-trip untouched. */
const KNOWN_V1_KEYS = new Set<string>([
  "configVersion",
  "commons",
  ...LEGACY_V1_FIELDS,
]);

const unknownKeys = (raw: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(raw).filter(([key]) => !KNOWN_V1_KEYS.has(key)),
  );

/**
 * Pure v1 -> v2 config transform (no I/O — see commands/migrate.ts for the
 * file read/write wrapper). Lossless: every v1 field either maps into a v2
 * field or is preserved under a migration-only key for human review — see
 * "Migration: configVersion 1 -> 2" in
 * docs/design-specs/2026-07-17-global-library-model.md.
 *
 * - `workspaces` stack arrays flatten + union into `libraries`.
 * - `squads` fold into that same `libraries` union, verbatim: once commons-
 *   side migration retags `entries/squads/{name}/...` to
 *   `scope: library:{name}`, a project that doesn't also declare that
 *   library would silently stop seeing those entries. Reviewed by the team
 *   like any other library name (same as the commons-side retag itself).
 * - `overlays` (extra synced repos) have no v2 equivalent — v2 is single-
 *   commons only — so they're preserved verbatim under `librariesLocal`
 *   instead of being silently dropped; not a validated v2 field, flagged in
 *   the CLI output for manual review.
 * - `project` carries no information `libraries` doesn't already capture and
 *   has no v2 equivalent — dropped.
 * - Anything else on the raw JSON (hand-added custom keys) round-trips
 *   unchanged.
 */
export const buildMigratedConfig = (
  v1: RepoConfig,
  raw: Record<string, unknown>,
): Record<string, unknown> => {
  const stacks = Object.values(v1.workspaces).flat();
  const libraries = [...new Set([...stacks, ...v1.squads])];

  const migrated: Record<string, unknown> = {
    configVersion: CONFIG_VERSION_V2,
    commons: v1.commons,
    libraries,
  };

  if (v1.overlays.length > 0) {
    migrated.librariesLocal = v1.overlays;
  }

  return { ...migrated, ...unknownKeys(raw) };
};
