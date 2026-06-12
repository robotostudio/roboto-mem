import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { glob } from "tinyglobby";
import type { Entry } from "./entry.js";
import { parseEntry } from "./entry.js";
import { exec } from "./exec.js";

export const FORMAT_VERSION = 1;

export type RepoSync =
  | { ok: true; dir: string; stale: boolean }
  | { ok: false; error: string };

export interface MemoryData {
  formatVersion: number;
  /** budgets with defaults merged in — for internal consumers (compile, lint) */
  budgets: Record<string, number>;
  /** only the numeric budget keys actually present in memory.json — no defaults */
  declaredBudgets: Record<string, number>;
  entries: Entry[];
  errors: { file: string; error: string }[];
}

export type MemoryLoad =
  | ({ ok: true } & MemoryData)
  | { ok: false; reason: "newer-format"; formatVersion: number }
  | { ok: false; reason: "missing-manifest"; detail: string };

export const repoDirFor = (url: string, home: string): string => {
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 12);
  return path.join(home, "repos", hash);
};

export const ensureRepo = async (
  url: string,
  home: string,
): Promise<RepoSync> => {
  const dir = repoDirFor(url, home);

  const exists = await readFile(path.join(dir, ".git", "HEAD"))
    .then(() => true)
    .catch(() => false);

  if (!exists) {
    const cloneResult = await exec("git", ["clone", url, dir]);
    if (!cloneResult.ok) {
      return { ok: false, error: cloneResult.stderr };
    }
    return { ok: true, dir, stale: false };
  }

  const pullResult = await exec("git", ["pull", "--ff-only"], {
    cwd: dir,
    timeoutMs: 20_000,
  });

  return pullResult.ok
    ? { ok: true, dir, stale: false }
    : { ok: true, dir, stale: true };
};

interface RawManifest {
  formatVersion?: unknown;
  budgets?: unknown;
}

const DEFAULT_BUDGETS: Record<string, number> = { default: 2000, org: 4000 };

const parseBudgets = (raw: unknown): Record<string, number> => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_BUDGETS };
  }
  const merged: Record<string, number> = { ...DEFAULT_BUDGETS };
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "number") {
      merged[k] = v;
    }
  }
  return merged;
};

/** Returns only the numeric budget keys that are actually present in the raw manifest — no defaults injected. */
const parseDeclaredBudgets = (raw: unknown): Record<string, number> => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const declared: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "number") declared[k] = v;
  }
  return declared;
};

export const loadMemory = async (dir: string): Promise<MemoryLoad> => {
  const manifestPath = path.join(dir, "memory.json");

  const manifestText = await readFile(manifestPath, "utf8").catch(
    (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      return { error: msg };
    },
  );

  if (typeof manifestText !== "string") {
    return {
      ok: false,
      reason: "missing-manifest",
      detail: manifestText.error,
    };
  }

  const manifest = ((): RawManifest | { parseError: string } => {
    try {
      const parsed: unknown = JSON.parse(manifestText);
      return parsed !== null &&
        typeof parsed === "object" &&
        !Array.isArray(parsed)
        ? (parsed as RawManifest)
        : { parseError: "manifest is not a JSON object" };
    } catch (e) {
      return { parseError: e instanceof Error ? e.message : String(e) };
    }
  })();

  if ("parseError" in manifest) {
    return {
      ok: false,
      reason: "missing-manifest",
      detail: manifest.parseError,
    };
  }

  if (typeof manifest.formatVersion !== "number") {
    return {
      ok: false,
      reason: "missing-manifest",
      detail: "formatVersion is missing or not a number",
    };
  }

  if (manifest.formatVersion > FORMAT_VERSION) {
    return {
      ok: false,
      reason: "newer-format",
      formatVersion: manifest.formatVersion,
    };
  }

  const relPaths = await glob(["entries/**/*.md"], { cwd: dir });
  relPaths.sort();

  const entries: Entry[] = [];
  const errors: { file: string; error: string }[] = [];

  for (const relPath of relPaths) {
    const abs = path.join(dir, relPath);
    const content = await readFile(abs, "utf8").catch((e: unknown) => {
      errors.push({
        file: relPath,
        error: e instanceof Error ? e.message : String(e),
      });
      return null;
    });

    if (content === null) continue;

    const parsed = parseEntry(content, relPath);
    if (parsed.ok) {
      entries.push(parsed.entry);
    } else {
      errors.push({ file: parsed.file, error: parsed.error });
    }
  }

  return {
    ok: true,
    formatVersion: manifest.formatVersion,
    budgets: parseBudgets(manifest.budgets),
    declaredBudgets: parseDeclaredBudgets(manifest.budgets),
    entries,
    errors,
  };
};

export const memoryHome = (): string =>
  process.env.ROBOTO_MEM_HOME ?? path.join(os.homedir(), ".roboto-mem");
