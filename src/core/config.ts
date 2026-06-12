import * as fs from "node:fs/promises";
import * as path from "node:path";

export const CONFIG_VERSION = 1;
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

function validateConfig(raw: Record<string, unknown>): ConfigResult {
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

export const loadConfig = async (dir: string): Promise<ConfigResult> => {
  const filePath = path.join(dir, CONFIG_FILE);

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
      detail: `${CONFIG_FILE} not found in ${dir}`,
    };
  }

  const parsed = tryParseJson(text);
  if (!parsed.ok) {
    return { ok: false, reason: "invalid", detail: parsed.detail };
  }

  return validateConfig(parsed.value);
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
