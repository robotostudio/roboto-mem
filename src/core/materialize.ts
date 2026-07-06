import { access, cp, mkdir, readFile, rename, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { FORMAT_VERSION } from "./memory-repo.js";
import { loadSkills, PROVENANCE_FILE } from "./skill.js";
import {
  hashSkillDir,
  readSkillManifest,
  writeSkillManifest,
} from "./skill-manifest.js";

export interface MaterializeReport {
  materialized: string[];
  updated: string[];
  removed: string[];
  shadowed: string[];
  restored: string[];
  failed: { name: string; error: string }[];
}

export interface MaterializeOptions {
  commonsDir: string;
  home: string;
  targetDir?: string;
}

export const defaultSkillsTarget = (): string =>
  path.join(os.homedir(), ".claude", "skills");

const exists = (p: string): Promise<boolean> =>
  access(p).then(
    () => true,
    () => false,
  );

const copySkill = async (src: string, dest: string): Promise<void> => {
  const tmp = `${dest}.tmp-${process.pid}`;
  await mkdir(path.dirname(dest), { recursive: true });
  try {
    await rm(tmp, { recursive: true, force: true });
    await cp(src, tmp, {
      recursive: true,
      filter: (s) => path.basename(s) !== PROVENANCE_FILE,
    });
    await rm(dest, { recursive: true, force: true });
    await rename(tmp, dest);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
};

const errText = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

/** true when memory.json explicitly declares a formatVersion newer than this tool understands */
const declaresNewerFormat = async (commonsDir: string): Promise<boolean> => {
  try {
    const raw: unknown = JSON.parse(
      await readFile(path.join(commonsDir, "memory.json"), "utf8"),
    );
    const version =
      raw !== null && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>).formatVersion
        : undefined;
    return typeof version === "number" && version > FORMAT_VERSION;
  } catch {
    return false; // missing/corrupt manifest is reported elsewhere (digest/lint)
  }
};

export const materializeSkills = async (
  options: MaterializeOptions,
): Promise<MaterializeReport> => {
  const targetDir = options.targetDir ?? defaultSkillsTarget();
  const report: MaterializeReport = {
    materialized: [],
    updated: [],
    removed: [],
    shadowed: [],
    restored: [],
    failed: [],
  };

  try {
    if (await declaresNewerFormat(options.commonsDir)) {
      report.failed.push({
        name: "(format)",
        error:
          "commons format is newer than this roboto-mem understands — run /mem-upgrade",
      });
      return report;
    }

    const load = await loadSkills(options.commonsDir);
    const manifest = await readSkillManifest(options.home);

    for (const { dir, error } of load.errors) {
      report.failed.push({ name: dir, error });
    }

    for (const skill of load.skills) {
      try {
        const source = path.join(options.commonsDir, skill.dir);
        const target = path.join(targetDir, skill.name);
        const managed = manifest.skills[skill.name];
        const sourceHash = await hashSkillDir(source);

        if (!managed) {
          if (await exists(target)) {
            report.shadowed.push(skill.name);
            continue;
          }
          await copySkill(source, target);
          manifest.skills[skill.name] = { hash: sourceHash };
          await writeSkillManifest(options.home, manifest);
          report.materialized.push(skill.name);
          continue;
        }

        if (!(await exists(target))) {
          await copySkill(source, target);
          manifest.skills[skill.name] = { hash: sourceHash };
          await writeSkillManifest(options.home, manifest);
          report.restored.push(skill.name);
          continue;
        }

        const targetHash = await hashSkillDir(target);
        if (targetHash !== managed.hash) {
          await copySkill(source, target);
          manifest.skills[skill.name] = { hash: sourceHash };
          await writeSkillManifest(options.home, manifest);
          report.restored.push(skill.name);
          continue;
        }
        if (sourceHash !== managed.hash) {
          await copySkill(source, target);
          manifest.skills[skill.name] = { hash: sourceHash };
          await writeSkillManifest(options.home, manifest);
          report.updated.push(skill.name);
        }
      } catch (e: unknown) {
        report.failed.push({ name: skill.name, error: errText(e) });
      }
    }

    const present = new Set(load.dirNames);
    for (const name of Object.keys(manifest.skills)) {
      if (present.has(name)) continue;
      try {
        await rm(path.join(targetDir, name), { recursive: true, force: true });
        delete manifest.skills[name];
        await writeSkillManifest(options.home, manifest);
        report.removed.push(name);
      } catch (e: unknown) {
        report.failed.push({ name, error: errText(e) });
      }
    }

    manifest.materializedAt = new Date().toISOString().slice(0, 10);
    await writeSkillManifest(options.home, manifest);
  } catch (e: unknown) {
    // never throw — sync and the SessionStart hook must survive any failure here
    report.failed.push({ name: "(materialize)", error: errText(e) });
  }

  return report;
};

export const formatReport = (report: MaterializeReport): string | undefined => {
  const parts = [
    ...(report.materialized.length
      ? [`${report.materialized.length} materialized`]
      : []),
    ...(report.updated.length ? [`${report.updated.length} updated`] : []),
    ...(report.removed.length ? [`${report.removed.length} removed`] : []),
    ...(report.shadowed.length
      ? [`shadowed by personal: ${report.shadowed.join(", ")}`]
      : []),
    ...(report.restored.length
      ? [`restored: ${report.restored.join(", ")}`]
      : []),
    ...(report.failed.length
      ? [
          `failed: ${report.failed.map((f) => `${f.name} (${f.error})`).join(", ")}`,
        ]
      : []),
  ];
  return parts.length ? `skills: ${parts.join(", ")}` : undefined;
};
