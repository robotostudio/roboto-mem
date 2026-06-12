import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface CachedDigest {
  date: string;
  digest: string;
}

const cacheKey = (projectPath: string): string =>
  createHash("sha256").update(projectPath).digest("hex").slice(0, 12);

const cacheFilePath = (home: string, projectPath: string): string =>
  join(home, "cache", `${cacheKey(projectPath)}.json`);

const isValidShape = (v: unknown): v is CachedDigest =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as Record<string, unknown>).date === "string" &&
  typeof (v as Record<string, unknown>).digest === "string";

export const writeCache = async (
  home: string,
  projectPath: string,
  cached: CachedDigest,
): Promise<void> => {
  try {
    const filePath = cacheFilePath(home, projectPath);
    await mkdir(join(home, "cache"), { recursive: true });
    await writeFile(filePath, JSON.stringify(cached, null, 2), "utf8");
  } catch {
    // best-effort — a blocked or unwritable cache dir must never crash the hook
  }
};

export const readCache = async (
  home: string,
  projectPath: string,
): Promise<CachedDigest | undefined> => {
  try {
    const raw = await readFile(cacheFilePath(home, projectPath), "utf8");
    const parsed: unknown = JSON.parse(raw);
    return isValidShape(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};
