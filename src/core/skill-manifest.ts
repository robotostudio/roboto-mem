import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { glob } from "tinyglobby";
import { PROVENANCE_FILE } from "./skill.js";

export interface SkillManifest {
  formatVersion: 1;
  materializedAt?: string;
  skills: Record<string, { hash: string }>;
}

const manifestPath = (home: string): string =>
  path.join(home, "skills-manifest.json");

const isValidShape = (v: unknown): v is SkillManifest =>
  typeof v === "object" &&
  v !== null &&
  (v as Record<string, unknown>).formatVersion === 1 &&
  ((v as Record<string, unknown>).materializedAt === undefined ||
    typeof (v as Record<string, unknown>).materializedAt === "string") &&
  typeof (v as Record<string, unknown>).skills === "object" &&
  (v as Record<string, unknown>).skills !== null &&
  !Array.isArray((v as Record<string, unknown>).skills) &&
  Object.values((v as SkillManifest).skills).every(
    (s) => typeof s === "object" && s !== null && typeof s.hash === "string",
  );

export const readSkillManifest = async (
  home: string,
): Promise<SkillManifest> => {
  try {
    const text = await readFile(manifestPath(home), "utf8");
    const parsed: unknown = JSON.parse(text);
    return isValidShape(parsed) ? parsed : { formatVersion: 1, skills: {} };
  } catch {
    // missing or corrupt — treat as empty: unknown dirs become "personal", never deleted
    return { formatVersion: 1, skills: {} };
  }
};

export const writeSkillManifest = async (
  home: string,
  manifest: SkillManifest,
): Promise<void> => {
  await mkdir(home, { recursive: true });
  await writeFile(
    manifestPath(home),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
};

export const hashSkillDir = async (dir: string): Promise<string> => {
  const files = (
    await glob(["**/*"], {
      cwd: dir,
      dot: true,
      followSymbolicLinks: false,
    })
  ).filter((f) => path.basename(f) !== PROVENANCE_FILE);
  files.sort();

  const h = createHash("sha256");
  for (const f of files) {
    h.update(f);
    h.update("\0");
    h.update(await readFile(path.join(dir, f)));
    h.update("\0");
  }
  return h.digest("hex");
};
