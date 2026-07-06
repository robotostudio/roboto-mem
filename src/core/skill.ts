import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { glob } from "tinyglobby";
import { parse } from "yaml";
import { DATE_RE } from "./entry.js";
import { SCOPE_ID_RE } from "./scopes.js";

export const PROVENANCE_FILE = ".provenance.json";

export interface Provenance {
  source: string;
  ref: string;
  path: string;
  vendoredAt: string;
  vendoredBy: string;
}

export interface Skill {
  name: string;
  description: string;
  /** repo-relative directory, e.g. "skills/grill-me" */
  dir: string;
  provenance?: Provenance;
}

export interface SkillsLoad {
  skills: Skill[];
  errors: { dir: string; error: string }[];
  /** every skills/<x>/ directory seen, valid or not — deletion safety line */
  dirNames: string[];
}

export type FrontmatterResult =
  | { ok: true; name: string; description: string }
  | { ok: false; error: string };

export type ProvenanceResult =
  | { ok: true; provenance: Provenance }
  | { ok: false; error: string };

const SHA_RE = /^[0-9a-f]{40}$/;

export const parseSkillFrontmatter = (raw: string): FrontmatterResult => {
  if (!raw.startsWith("---\n")) {
    return { ok: false, error: "missing YAML frontmatter" };
  }
  const closeIdx = raw.indexOf("\n---", 4);
  if (closeIdx === -1) {
    return { ok: false, error: "unclosed YAML frontmatter" };
  }

  const fm = ((): Record<string, unknown> | null => {
    try {
      const parsed: unknown = parse(raw.slice(4, closeIdx));
      return parsed !== null &&
        typeof parsed === "object" &&
        !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  })();

  if (!fm) return { ok: false, error: "malformed YAML frontmatter" };
  if (typeof fm.name !== "string" || !SCOPE_ID_RE.test(fm.name)) {
    return { ok: false, error: 'frontmatter "name" must be kebab-case' };
  }
  if (typeof fm.description !== "string" || !fm.description.trim()) {
    return { ok: false, error: 'frontmatter "description" is required' };
  }
  return { ok: true, name: fm.name, description: fm.description };
};

export const parseProvenance = (text: string): ProvenanceResult => {
  const raw = ((): Record<string, unknown> | null => {
    try {
      const parsed: unknown = JSON.parse(text);
      return parsed !== null &&
        typeof parsed === "object" &&
        !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  })();

  if (!raw) return { ok: false, error: "provenance is not a JSON object" };
  if (typeof raw.source !== "string" || !raw.source) {
    return { ok: false, error: "provenance source must be a string" };
  }
  if (typeof raw.ref !== "string" || !SHA_RE.test(raw.ref)) {
    return { ok: false, error: "provenance ref must be a 40-char commit sha" };
  }
  if (typeof raw.path !== "string" || !raw.path) {
    return { ok: false, error: "provenance path must be a string" };
  }
  if (typeof raw.vendoredAt !== "string" || !DATE_RE.test(raw.vendoredAt)) {
    return { ok: false, error: "provenance vendoredAt must be YYYY-MM-DD" };
  }
  if (typeof raw.vendoredBy !== "string" || !raw.vendoredBy) {
    return { ok: false, error: "provenance vendoredBy must be a string" };
  }
  return {
    ok: true,
    provenance: {
      source: raw.source,
      ref: raw.ref,
      path: raw.path,
      vendoredAt: raw.vendoredAt,
      vendoredBy: raw.vendoredBy,
    },
  };
};

export const loadSkills = async (repoDir: string): Promise<SkillsLoad> => {
  const dirs = await glob(["skills/*"], {
    cwd: repoDir,
    onlyDirectories: true,
    followSymbolicLinks: false,
  });
  dirs.sort();

  const skills: Skill[] = [];
  const errors: { dir: string; error: string }[] = [];
  const dirNames: string[] = [];

  for (const dirPath of dirs) {
    const dirName = dirPath.split("/")[1] ?? "";
    if (!dirName) continue;
    dirNames.push(dirName);
    const dir = `skills/${dirName}`;

    const raw = await readFile(
      path.join(repoDir, dir, "SKILL.md"),
      "utf8",
    ).catch((e: unknown) => ({
      error: e instanceof Error ? e.message : String(e),
    }));
    if (typeof raw !== "string") {
      errors.push({
        dir: dirName,
        error: `SKILL.md is missing or unreadable: ${raw.error}`,
      });
      continue;
    }

    const fm = parseSkillFrontmatter(raw);
    if (!fm.ok) {
      errors.push({ dir: dirName, error: fm.error });
      continue;
    }
    if (fm.name !== dirName) {
      errors.push({
        dir: dirName,
        error: `frontmatter name "${fm.name}" must match directory "${dirName}"`,
      });
      continue;
    }

    const provText = await readFile(
      path.join(repoDir, dir, PROVENANCE_FILE),
      "utf8",
    ).catch(() => undefined);

    if (provText === undefined) {
      skills.push({ name: fm.name, description: fm.description, dir });
      continue;
    }

    const prov = parseProvenance(provText);
    if (!prov.ok) {
      errors.push({ dir: dirName, error: `${PROVENANCE_FILE}: ${prov.error}` });
      continue;
    }
    skills.push({
      name: fm.name,
      description: fm.description,
      dir,
      provenance: prov.provenance,
    });
  }

  return { skills, errors, dirNames };
};

/**
 * Finds the first symlink anywhere under `dir` (recursively), ignoring
 * anything nested inside a `.git` directory. Returns its path relative to
 * `dir`, or `undefined` when the tree contains no symlinks.
 */
export const findSymlink = async (dir: string): Promise<string | undefined> => {
  const entries = await readdir(dir, {
    recursive: true,
    withFileTypes: true,
  });
  const hit = entries.find(
    (e) =>
      e.isSymbolicLink() &&
      !`${e.parentPath ?? ""}`.includes(`${path.sep}.git`),
  );
  return hit
    ? path.relative(dir, path.join(hit.parentPath, hit.name))
    : undefined;
};
