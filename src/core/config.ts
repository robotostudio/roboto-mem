import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

// Global library model (Phase 2): bumped 1 -> 2 so the version-gate ceiling
// is already correct before Phase 6 splices v2 handling into loadConfig —
// see docs/design-specs/2026-07-17-global-library-model.md.
export const CONFIG_VERSION = 2;
export const CONFIG_FILE = ".roboto-mem.json";

export interface RepoConfig {
  configVersion: 1;
  commons: string;
  overlays: string[];
  project: string;
  squads: string[];
  workspaces: Record<string, string[]>;
}

export type ConfigResult =
  | { ok: true; config: RepoConfig; raw: Record<string, unknown> }
  | {
      ok: false;
      reason: "missing" | "invalid" | "newer-config";
      detail: string;
    };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

export function validateConfig(raw: Record<string, unknown>): ConfigResult {
  const version = raw.configVersion;

  if (typeof version !== "number") {
    return {
      ok: false,
      reason: "invalid",
      detail: "configVersion must be a number",
    };
  }

  if (version > CONFIG_VERSION) {
    return {
      ok: false,
      reason: "newer-config",
      detail: `config is version ${version}; this roboto-mem understands ${CONFIG_VERSION}. Upgrade roboto-mem (/mem-upgrade).`,
    };
  }

  // Global library model (Phase 2): this v1-only loader only ever executes
  // configVersion:1. A configVersion:2 file — even a hand-edited hybrid
  // that also carries legacy project/squads/workspaces/overlays fields —
  // is something this path can't run; treat it the same as "newer than
  // this path understands" rather than silently validating it as v1.
  // See docs/design-specs/2026-07-17-global-library-model.md.
  if (version === CONFIG_VERSION) {
    return {
      ok: false,
      reason: "newer-config",
      detail: `config is version ${version}; this roboto-mem understands ${CONFIG_VERSION}. Upgrade roboto-mem (/mem-upgrade).`,
    };
  }

  if (typeof raw.commons !== "string") {
    return { ok: false, reason: "invalid", detail: "commons must be a string" };
  }

  if (!isStringArray(raw.overlays)) {
    return {
      ok: false,
      reason: "invalid",
      detail: "overlays must be an array of strings",
    };
  }

  if (typeof raw.project !== "string") {
    return { ok: false, reason: "invalid", detail: "project must be a string" };
  }

  if (!isStringArray(raw.squads)) {
    return {
      ok: false,
      reason: "invalid",
      detail: "squads must be an array of strings",
    };
  }

  if (!isRecord(raw.workspaces)) {
    return {
      ok: false,
      reason: "invalid",
      detail: "workspaces must be an object",
    };
  }

  const workspacesValid = Object.values(raw.workspaces).every(isStringArray);
  if (!workspacesValid) {
    return {
      ok: false,
      reason: "invalid",
      detail: "workspaces values must each be an array of strings",
    };
  }

  const config: RepoConfig = {
    configVersion: 1,
    commons: raw.commons,
    overlays: raw.overlays,
    project: raw.project,
    squads: raw.squads,
    workspaces: raw.workspaces as Record<string, string[]>,
  };

  return { ok: true, config, raw };
}

/** Reads + JSON-parses a config file, shared by the v1, v2, and global
 * loaders below. Returns the raw parsed object; callers run version-specific
 * validation on it. */
export async function readConfigFile(
  dir: string,
  fileName: string,
): Promise<
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: "missing" | "invalid"; detail: string }
> {
  const filePath = path.join(dir, fileName);

  const text = await fs
    .readFile(filePath, "utf8")
    .catch((err: unknown): null | { __unreadable: string } => {
      if (isNodeError(err) && err.code === "ENOENT") return null;
      const message = err instanceof Error ? err.message : String(err);
      return { __unreadable: `config file unreadable: ${message}` };
    });

  if (text !== null && typeof text === "object" && "__unreadable" in text) {
    return { ok: false, reason: "invalid", detail: text.__unreadable };
  }

  if (text === null) {
    return {
      ok: false,
      reason: "missing",
      detail: `${fileName} not found in ${dir}`,
    };
  }

  const parsed = tryParseJson(text);
  if (!parsed.ok) {
    return { ok: false, reason: "invalid", detail: parsed.detail };
  }

  return { ok: true, value: parsed.value };
}

export const loadConfig = async (dir: string): Promise<ConfigResult> => {
  const read = await readConfigFile(dir, CONFIG_FILE);
  return read.ok ? validateConfig(read.value) : read;
};

export const saveConfig = async (
  dir: string,
  config: RepoConfig,
  preserve?: Record<string, unknown>,
): Promise<void> => {
  const merged = { ...(preserve ?? {}), ...config };
  await fs.writeFile(
    path.join(dir, CONFIG_FILE),
    `${JSON.stringify(merged, null, 2)}\n`,
    "utf8",
  );
};

// ─── v2 config (global library model) ──────────────────────────────────────
// Phase 1 scaffolding: a self-contained parallel schema, not yet wired into
// loadConfig/CONFIG_VERSION. CONFIG_VERSION stays 1 until Phase 2 bumps it —
// until then, loadConfig's existing `version > CONFIG_VERSION` gate already
// routes any configVersion:2 file to "newer-config" (old-CLI-safe stale
// cache), so loadConfigV2 exists purely to be unit-tested now and spliced
// into loadConfig once Phase 2 lands.
// See docs/design-specs/2026-07-17-global-library-model.md

export const CONFIG_VERSION_V2 = 2;

/** v1-only fields; presence on a configVersion:2 file means a hand-edited
 * hybrid config that must be cleaned up (distinct from a pure v1 file). */
export const LEGACY_V1_FIELDS = [
  "project",
  "squads",
  "workspaces",
  "overlays",
] as const;

export const CONFIG_V1_DEPRECATED_MESSAGE =
  "Config format v1 is deprecated. Run: `roboto-mem migrate` to upgrade.";

export const CONFIG_LEGACY_FIELDS_MESSAGE =
  "Config has legacy fields (project, squads, workspaces, overlays). Remove them or run `roboto-mem migrate` to clean up.";

export interface RepoConfigV2 {
  configVersion: 2;
  commons: string;
  libraries: string[];
}

export type ConfigV2Result =
  | { ok: true; config: RepoConfigV2; raw: Record<string, unknown> }
  | {
      ok: false;
      reason: "missing" | "invalid" | "newer-config";
      detail: string;
    };

function validateConfigV2(raw: Record<string, unknown>): ConfigV2Result {
  const version = raw.configVersion;

  if (typeof version !== "number") {
    return {
      ok: false,
      reason: "invalid",
      detail: "configVersion must be a number",
    };
  }

  if (version > CONFIG_VERSION_V2) {
    return {
      ok: false,
      reason: "newer-config",
      detail: `config is version ${version}; this roboto-mem understands ${CONFIG_VERSION_V2}. Upgrade roboto-mem (/mem-upgrade).`,
    };
  }

  if (version !== CONFIG_VERSION_V2) {
    return {
      ok: false,
      reason: "invalid",
      detail:
        version === 1
          ? CONFIG_V1_DEPRECATED_MESSAGE
          : `configVersion must be ${CONFIG_VERSION_V2}`,
    };
  }

  if (LEGACY_V1_FIELDS.some((key) => key in raw)) {
    return {
      ok: false,
      reason: "invalid",
      detail: CONFIG_LEGACY_FIELDS_MESSAGE,
    };
  }

  if (typeof raw.commons !== "string") {
    return { ok: false, reason: "invalid", detail: "commons must be a string" };
  }

  if (raw.libraries !== undefined && !isStringArray(raw.libraries)) {
    return {
      ok: false,
      reason: "invalid",
      detail: "libraries must be an array of strings",
    };
  }

  const config: RepoConfigV2 = {
    configVersion: 2,
    commons: raw.commons,
    libraries: isStringArray(raw.libraries) ? raw.libraries : [],
  };

  return { ok: true, config, raw };
}

export const loadConfigV2 = async (dir: string): Promise<ConfigV2Result> => {
  const read = await readConfigFile(dir, CONFIG_FILE);
  return read.ok ? validateConfigV2(read.value) : read;
};

/** Writes a fresh v2 config (global library model init, Phase 3). Unlike
 * `saveConfig`, there is no `preserve` param — a v2 config is only ever
 * written once for a brand-new project (init's own "config already exists"
 * gate blocks a second write; refreshing a v2 config's libraries will be a
 * future update-libraries command's job, not init's). */
export const saveConfigV2 = async (
  dir: string,
  config: RepoConfigV2,
): Promise<void> => {
  await fs.writeFile(
    path.join(dir, CONFIG_FILE),
    `${JSON.stringify(config, null, 2)}\n`,
    "utf8",
  );
};

// ─── Global config (~/.config/roboto-mem/config.json) ──────────────────────
// Consumed only by `roboto-mem init` as a suggested default `commons` URL.
// Never falls back into loadConfig/loadConfigV2 — a missing project config
// stays silent (no libraries, no auto-activation) regardless of whether a
// global config exists.

export const GLOBAL_CONFIG_FILE = "config.json";

export interface GlobalConfig {
  commons?: string;
}

export type GlobalConfigResult =
  | { ok: true; config: GlobalConfig }
  | { ok: false; reason: "missing" | "invalid"; detail: string };

export const globalConfigHome = (): string =>
  process.env.ROBOTO_MEM_CONFIG_HOME ??
  path.join(os.homedir(), ".config", "roboto-mem");

function validateGlobalConfig(
  raw: Record<string, unknown>,
): GlobalConfigResult {
  if (raw.commons !== undefined && typeof raw.commons !== "string") {
    return { ok: false, reason: "invalid", detail: "commons must be a string" };
  }
  return { ok: true, config: { commons: raw.commons as string | undefined } };
}

export const loadGlobalConfig = async (
  home: string,
): Promise<GlobalConfigResult> => {
  const read = await readConfigFile(home, GLOBAL_CONFIG_FILE);
  return read.ok ? validateGlobalConfig(read.value) : read;
};

function tryParseJson(
  text: string,
):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; detail: string } {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) {
      return { ok: false, detail: "config must be a JSON object" };
    }
    return { ok: true, value: parsed };
  } catch (err: unknown) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : "JSON parse error",
    };
  }
}

interface NodeError extends Error {
  code: string;
}

function isNodeError(err: unknown): err is NodeError {
  return err instanceof Error && "code" in err;
}
