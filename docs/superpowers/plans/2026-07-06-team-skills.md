# Team Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Team-shared Claude Code skills in the Commons — vendored from skills.sh/GitHub or promoted from personal memory via reviewed PRs, and materialized into `~/.claude/skills/` by sync.

**Architecture:** Skills live at `skills/<name>/` in the Commons (SKILL.md + support files; vendored ones carry a `.provenance.json` sidecar pinned to an upstream commit). Acquisition reuses the promote pipeline (validate → secret-scan → branch → push → `gh pr create`). Distribution rides the existing sync: a reconcile engine compares the Commons against a manifest at `<home>/skills-manifest.json` and only ever creates/updates/deletes directories it recorded — personal skills always win.

**Tech Stack:** TypeScript ESM (Node ≥20), citty, tinyglobby, yaml, vitest, biome. No new dependencies (`fs.cp`, `node:crypto` cover copying/hashing).

**Spec:** `docs/superpowers/specs/2026-07-06-team-skills-design.md`

## Global Constraints

- **NEVER run `git commit` / `git push` / open PRs.** Every task ends at a green gate (`pnpm typecheck && pnpm lint && pnpm test`). Commit messages are prepared in each task's final step but execution is **HELD** until Hrithik explicitly types "commit"/"push"/"ship". No subagent may commit. (Overrides the usual TDD commit cadence.)
- No `let`, no `var` — anywhere, including tests. Restructure with `const`, ternaries, `reduce`, early returns.
- Commands return `CommandResult` (`{ exitCode: number; output: string }` from `src/core/types.ts`); only `src/cli.ts` prints.
- The SessionStart hook path (`digest --hook`) must never exit nonzero and never print non-JSON. Materialization inside digest must be failure-proof.
- Secret scan is never bypassable (no `--force` escape).
- ESM imports use `.js` suffixes (`../core/skill.js`). Strict TS — guard indexed access (`noUncheckedIndexedAccess` style, as in `entry.ts`).
- All 185 existing tests stay green; coverage thresholds are 80% lines/functions/branches/statements (`src/cli.ts` excluded).
- Follow existing file idioms: arrow-function exports, discriminated unions keyed on `ok`, `fail`/`ok` helpers, section comments.
- Existing exports you will consume (do not redefine): `exec(cmd, args, opts): Promise<ExecResult>` (`src/core/exec.ts`), `ensureRepo(url, home): Promise<RepoSync>` / `repoDirFor(url, home)` / `memoryHome()` (`src/core/memory-repo.ts`), `loadConfig(cwd): Promise<ConfigResult>` (`src/core/config.ts`), `scanEntry(text): ScanFinding[]` (`src/core/scan.ts`), `SCOPE_ID_RE` (`src/core/scopes.ts`), `DATE_RE` (`src/core/entry.ts`), `compareUrl(commonsUrl, branch)` (`src/commands/promote.ts`), test helpers `tmpDirFactory` (`tests/helpers/tmp.ts`) and `makeCommonsFixture` (`tests/helpers/git.ts`).

## File Structure

| File | Responsibility |
|---|---|
| Create `src/core/skill.ts` | Skill + Provenance types, SKILL.md frontmatter parsing, `loadSkills(repoDir)` |
| Create `src/core/skill-manifest.ts` | Manifest read/write at `<home>/skills-manifest.json`, `hashSkillDir` |
| Create `src/core/materialize.ts` | Reconcile engine: Commons skills → `~/.claude/skills/`, report + formatter |
| Create `src/commands/skill.ts` | `runSkillAdd` (vendor) + `runSkillPromote` (personal) + shared PR submission |
| Modify `src/commands/lint.ts` | Validate `skills/` + secret-scan skill files |
| Modify `src/commands/sync.ts` | Trigger materialization, print report line |
| Modify `src/commands/digest.ts` | Trigger materialization at session start; warning lines for restored/failed |
| Modify `src/commands/status.ts` | Skills section (materialized/shadowed/pending) |
| Modify `src/commands/init.ts` + `src/commands/commons-templates.ts` | Scaffold `skills/`, CODEOWNERS line, README section |
| Modify `src/cli.ts` | `skill add` / `skill promote` subcommands |
| Create `commands/skill-add.md` | `/skill-add` plugin slash command |
| Modify `CONTEXT.md`, `README.md` | New terms, Sync definition touch-up, commands table |
| Create tests | `tests/core/skill.test.ts`, `tests/core/skill-manifest.test.ts`, `tests/core/materialize.test.ts`, `tests/commands/skill.test.ts`, `tests/integration/skills-e2e.test.ts` + additions to lint/sync/digest/status/init/cli tests |

Tasks 1→3 are sequential (each consumes the previous). Tasks 4–9 depend on 1–3 but not on each other. Task 10 (e2e) comes last.

---

### Task 1: Skill parsing and loading (`src/core/skill.ts`)

**Files:**
- Create: `src/core/skill.ts`
- Test: `tests/core/skill.test.ts`

**Interfaces:**
- Consumes: `SCOPE_ID_RE` from `src/core/scopes.ts`, `DATE_RE` from `src/core/entry.ts`, `glob` from tinyglobby, `parse` from yaml.
- Produces (later tasks rely on these exact names):
  - `PROVENANCE_FILE = ".provenance.json"` (const string)
  - `interface Provenance { source: string; ref: string; path: string; vendoredAt: string; vendoredBy: string }`
  - `interface Skill { name: string; description: string; dir: string; provenance?: Provenance }` — `dir` is repo-relative, e.g. `"skills/grill-me"`
  - `parseSkillFrontmatter(raw: string): { ok: true; name: string; description: string } | { ok: false; error: string }`
  - `parseProvenance(text: string): { ok: true; provenance: Provenance } | { ok: false; error: string }`
  - `loadSkills(repoDir: string): Promise<SkillsLoad>` where `interface SkillsLoad { skills: Skill[]; errors: { dir: string; error: string }[]; dirNames: string[] }` — `dirNames` lists every `skills/<x>/` directory found (valid or not; materialization uses it so a parse error upstream never triggers deletion on teammates' machines).

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/core/skill.test.ts
import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadSkills,
  parseProvenance,
  parseSkillFrontmatter,
} from "../../src/core/skill.js";
import { tmpDirFactory } from "../helpers/tmp.js";

const SKILL_MD = `---
name: grill-me
description: Interview the user relentlessly about a plan.
---

Interview me relentlessly about every aspect of this plan.`;

const PROVENANCE = JSON.stringify({
  source: "github:obra/skills",
  ref: "a".repeat(40),
  path: "skills/grill-me",
  vendoredAt: "2026-07-06",
  vendoredBy: "hrithik",
});

describe("parseSkillFrontmatter", () => {
  it("parses name and description", () => {
    const result = parseSkillFrontmatter(SKILL_MD);
    expect(result).toEqual({
      ok: true,
      name: "grill-me",
      description: "Interview the user relentlessly about a plan.",
    });
  });

  it("fails without frontmatter", () => {
    const result = parseSkillFrontmatter("just text");
    expect(result.ok).toBe(false);
  });

  it("fails when name is missing or not kebab-case", () => {
    const noName = parseSkillFrontmatter(
      "---\ndescription: d\n---\nbody",
    );
    expect(noName.ok).toBe(false);
    const badName = parseSkillFrontmatter(
      "---\nname: Bad_Name\ndescription: d\n---\nbody",
    );
    expect(badName.ok).toBe(false);
  });

  it("fails when description is missing", () => {
    const result = parseSkillFrontmatter("---\nname: ok-name\n---\nbody");
    expect(result.ok).toBe(false);
  });

  it("tolerates extra frontmatter fields", () => {
    const result = parseSkillFrontmatter(
      "---\nname: ok-name\ndescription: d\nlicense: MIT\n---\nbody",
    );
    expect(result.ok).toBe(true);
  });
});

describe("parseProvenance", () => {
  it("parses a valid provenance file", () => {
    const result = parseProvenance(PROVENANCE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.provenance.source).toBe("github:obra/skills");
      expect(result.provenance.ref).toBe("a".repeat(40));
    }
  });

  it("rejects non-JSON, missing fields, and bad ref/date", () => {
    expect(parseProvenance("nope").ok).toBe(false);
    expect(parseProvenance("{}").ok).toBe(false);
    const badRef = JSON.parse(PROVENANCE) as Record<string, unknown>;
    badRef.ref = "short";
    expect(parseProvenance(JSON.stringify(badRef)).ok).toBe(false);
    const badDate = JSON.parse(PROVENANCE) as Record<string, unknown>;
    badDate.vendoredAt = "July 6";
    expect(parseProvenance(JSON.stringify(badDate)).ok).toBe(false);
  });
});

describe("loadSkills", () => {
  const tmp = tmpDirFactory("rm-skill-");
  afterEach(tmp.cleanup);

  const writeSkill = async (
    repo: string,
    dir: string,
    files: Record<string, string>,
  ): Promise<void> => {
    const abs = path.join(repo, "skills", dir);
    await mkdir(abs, { recursive: true });
    await Promise.all(
      Object.entries(files).map(([f, c]) =>
        writeFile(path.join(abs, f), c, "utf8"),
      ),
    );
  };

  it("loads valid skills with and without provenance", async () => {
    const repo = await tmp.make();
    await writeSkill(repo, "grill-me", {
      "SKILL.md": SKILL_MD,
      ".provenance.json": PROVENANCE,
    });
    await writeSkill(repo, "deploy-checklist", {
      "SKILL.md":
        "---\nname: deploy-checklist\ndescription: Our deploy steps.\n---\nSteps.",
    });

    const load = await loadSkills(repo);
    expect(load.errors).toEqual([]);
    expect(load.skills.map((s) => s.name).sort()).toEqual([
      "deploy-checklist",
      "grill-me",
    ]);
    const grill = load.skills.find((s) => s.name === "grill-me");
    expect(grill?.dir).toBe("skills/grill-me");
    expect(grill?.provenance?.ref).toBe("a".repeat(40));
    expect(
      load.skills.find((s) => s.name === "deploy-checklist")?.provenance,
    ).toBeUndefined();
  });

  it("reports frontmatter/dir mismatch and invalid provenance as errors, keeps dirNames", async () => {
    const repo = await tmp.make();
    await writeSkill(repo, "wrong-dir", { "SKILL.md": SKILL_MD });
    await writeSkill(repo, "bad-prov", {
      "SKILL.md":
        "---\nname: bad-prov\ndescription: d\n---\nbody",
      ".provenance.json": "not json",
    });

    const load = await loadSkills(repo);
    expect(load.skills).toEqual([]);
    expect(load.errors).toHaveLength(2);
    expect(load.dirNames.sort()).toEqual(["bad-prov", "wrong-dir"]);
  });

  it("returns empty load for a repo without skills/", async () => {
    const repo = await tmp.make();
    const load = await loadSkills(repo);
    expect(load).toEqual({ skills: [], errors: [], dirNames: [] });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/core/skill.test.ts`
Expected: FAIL — `Cannot find module '../../src/core/skill.js'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/core/skill.ts
import { readFile } from "node:fs/promises";
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
      return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
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
      return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
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
  const skillFiles = await glob(["skills/*/SKILL.md"], { cwd: repoDir });
  skillFiles.sort();

  const skills: Skill[] = [];
  const errors: { dir: string; error: string }[] = [];
  const dirNames: string[] = [];

  for (const relFile of skillFiles) {
    const dirName = relFile.split("/")[1] ?? "";
    if (!dirName) continue;
    dirNames.push(dirName);
    const dir = `skills/${dirName}`;

    const raw = await readFile(path.join(repoDir, relFile), "utf8").catch(
      (e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }),
    );
    if (typeof raw !== "string") {
      errors.push({ dir: dirName, error: raw.error });
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/core/skill.test.ts`
Expected: PASS (all)

- [ ] **Step 5: Green gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: clean, 185 + new tests green.
Prepared commit (HELD — do not run): `feat: skill parsing and loading for team skills`

---

### Task 2: Manifest and content hashing (`src/core/skill-manifest.ts`)

**Files:**
- Create: `src/core/skill-manifest.ts`
- Test: `tests/core/skill-manifest.test.ts`

**Interfaces:**
- Consumes: `PROVENANCE_FILE` from `src/core/skill.js`.
- Produces:
  - `interface SkillManifest { formatVersion: 1; materializedAt?: string; skills: Record<string, { hash: string }> }` — `materializedAt` is a YYYY-MM-DD stamp set by materialization (Task 3), shown by status (Task 8)
  - `readSkillManifest(home: string): Promise<SkillManifest>` — missing or corrupt file returns `{ formatVersion: 1, skills: {} }` (safe direction: unknown dirs are treated as personal and never deleted)
  - `writeSkillManifest(home: string, manifest: SkillManifest): Promise<void>` — writes `<home>/skills-manifest.json`, creating `<home>` if needed
  - `hashSkillDir(dir: string): Promise<string>` — sha256 hex over sorted relative paths + file bytes, dotfiles included, `PROVENANCE_FILE` excluded (so the hash of a Commons skill dir equals the hash of its materialized copy)

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/core/skill-manifest.test.ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  hashSkillDir,
  readSkillManifest,
  writeSkillManifest,
} from "../../src/core/skill-manifest.js";
import { tmpDirFactory } from "../helpers/tmp.js";

describe("skill manifest", () => {
  const tmp = tmpDirFactory("rm-manifest-");
  afterEach(tmp.cleanup);

  it("round-trips a manifest", async () => {
    const home = await tmp.make();
    const manifest = { formatVersion: 1 as const, skills: { "grill-me": { hash: "abc" } } };
    await writeSkillManifest(home, manifest);
    expect(await readSkillManifest(home)).toEqual(manifest);
    const onDisk = await readFile(path.join(home, "skills-manifest.json"), "utf8");
    expect(JSON.parse(onDisk)).toEqual(manifest);
  });

  it("returns an empty manifest when the file is missing or corrupt", async () => {
    const home = await tmp.make();
    expect(await readSkillManifest(home)).toEqual({ formatVersion: 1, skills: {} });
    await writeFile(path.join(home, "skills-manifest.json"), "{corrupt", "utf8");
    expect(await readSkillManifest(home)).toEqual({ formatVersion: 1, skills: {} });
  });
});

describe("hashSkillDir", () => {
  const tmp = tmpDirFactory("rm-hash-");
  afterEach(tmp.cleanup);

  const makeSkill = async (files: Record<string, string>): Promise<string> => {
    const dir = await tmp.make();
    await Promise.all(
      Object.entries(files).map(async ([f, c]) => {
        await mkdir(path.dirname(path.join(dir, f)), { recursive: true });
        await writeFile(path.join(dir, f), c, "utf8");
      }),
    );
    return dir;
  };

  it("is deterministic and content-sensitive", async () => {
    const a = await makeSkill({ "SKILL.md": "body", "ref/EXTRA.md": "x" });
    const b = await makeSkill({ "SKILL.md": "body", "ref/EXTRA.md": "x" });
    const c = await makeSkill({ "SKILL.md": "changed", "ref/EXTRA.md": "x" });
    expect(await hashSkillDir(a)).toBe(await hashSkillDir(b));
    expect(await hashSkillDir(a)).not.toBe(await hashSkillDir(c));
  });

  it("is path-sensitive (same bytes, different file name)", async () => {
    const a = await makeSkill({ "SKILL.md": "body", "A.md": "x" });
    const b = await makeSkill({ "SKILL.md": "body", "B.md": "x" });
    expect(await hashSkillDir(a)).not.toBe(await hashSkillDir(b));
  });

  it("ignores .provenance.json but includes other dotfiles", async () => {
    const a = await makeSkill({ "SKILL.md": "body" });
    const b = await makeSkill({ "SKILL.md": "body", ".provenance.json": "{}" });
    const c = await makeSkill({ "SKILL.md": "body", ".hidden": "x" });
    expect(await hashSkillDir(a)).toBe(await hashSkillDir(b));
    expect(await hashSkillDir(a)).not.toBe(await hashSkillDir(c));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/core/skill-manifest.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// src/core/skill-manifest.ts
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

const EMPTY: SkillManifest = { formatVersion: 1, skills: {} };

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
  Object.values((v as SkillManifest).skills).every(
    (s) => typeof s === "object" && s !== null && typeof s.hash === "string",
  );

export const readSkillManifest = async (
  home: string,
): Promise<SkillManifest> => {
  try {
    const text = await readFile(manifestPath(home), "utf8");
    const parsed: unknown = JSON.parse(text);
    return isValidShape(parsed)
      ? parsed
      : { formatVersion: 1, skills: {} };
  } catch {
    // missing or corrupt — treat as empty: unknown dirs become "personal", never deleted
    return { ...EMPTY, skills: {} };
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
  const files = (await glob(["**/*"], { cwd: dir, dot: true })).filter(
    (f) => f !== PROVENANCE_FILE,
  );
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/core/skill-manifest.test.ts`
Expected: PASS

- [ ] **Step 5: Green gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: clean.
Prepared commit (HELD): `feat: skills manifest and content hashing`

---

### Task 3: Materialization engine (`src/core/materialize.ts`)

**Files:**
- Create: `src/core/materialize.ts`
- Test: `tests/core/materialize.test.ts`

**Interfaces:**
- Consumes: `loadSkills`, `PROVENANCE_FILE` (Task 1); `hashSkillDir`, `readSkillManifest`, `writeSkillManifest` (Task 2).
- Produces:
  - `interface MaterializeReport { materialized: string[]; updated: string[]; removed: string[]; shadowed: string[]; restored: string[]; failed: { name: string; error: string }[] }`
  - `interface MaterializeOptions { commonsDir: string; home: string; targetDir?: string }`
  - `defaultSkillsTarget(): string` — `path.join(os.homedir(), ".claude", "skills")`
  - `materializeSkills(options: MaterializeOptions): Promise<MaterializeReport>` — never throws; stamps `manifest.materializedAt` (YYYY-MM-DD); **format gate**: if the commons `memory.json` declares `formatVersion > FORMAT_VERSION`, touches nothing and reports one failed entry `{ name: "(format)", … }` — the tool never acts on a repo format it doesn't understand
  - `formatReport(report: MaterializeReport): string | undefined` — one `skills: …` summary line, `undefined` when nothing happened and nothing is shadowed/failed

- [ ] **Step 1: Write the failing tests** (the spec's reconcile matrix, one `it` per row)

```typescript
// tests/core/materialize.test.ts
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatReport,
  materializeSkills,
} from "../../src/core/materialize.js";
import { readSkillManifest } from "../../src/core/skill-manifest.js";
import { tmpDirFactory } from "../helpers/tmp.js";

const SKILL = (name: string, body = "body"): string =>
  `---\nname: ${name}\ndescription: d\n---\n${body}`;

describe("materializeSkills", () => {
  const tmp = tmpDirFactory("rm-mat-");
  afterEach(tmp.cleanup);

  const exists = (p: string): Promise<boolean> =>
    access(p).then(() => true, () => false);

  const writeCommonsSkill = async (
    commons: string,
    name: string,
    files: Record<string, string>,
  ): Promise<void> => {
    const dir = path.join(commons, "skills", name);
    await mkdir(dir, { recursive: true });
    await Promise.all(
      Object.entries(files).map(([f, c]) =>
        writeFile(path.join(dir, f), c, "utf8"),
      ),
    );
  };

  const setup = async (): Promise<{
    commons: string;
    home: string;
    target: string;
  }> => ({
    commons: await tmp.make(),
    home: await tmp.make(),
    target: await tmp.make(),
  });

  it("materializes a new skill, excluding .provenance.json, and records it", async () => {
    const { commons, home, target } = await setup();
    await writeCommonsSkill(commons, "grill-me", {
      "SKILL.md": SKILL("grill-me"),
      ".provenance.json": "{}",
    });

    const report = await materializeSkills({ commonsDir: commons, home, targetDir: target });

    expect(report.materialized).toEqual(["grill-me"]);
    expect(await exists(path.join(target, "grill-me", "SKILL.md"))).toBe(true);
    expect(await exists(path.join(target, "grill-me", ".provenance.json"))).toBe(false);
    const manifest = await readSkillManifest(home);
    expect(Object.keys(manifest.skills)).toEqual(["grill-me"]);
  });

  it("skips and reports a shadowing personal skill", async () => {
    const { commons, home, target } = await setup();
    await writeCommonsSkill(commons, "grill-me", { "SKILL.md": SKILL("grill-me") });
    await mkdir(path.join(target, "grill-me"), { recursive: true });
    await writeFile(path.join(target, "grill-me", "SKILL.md"), "personal", "utf8");

    const report = await materializeSkills({ commonsDir: commons, home, targetDir: target });

    expect(report.shadowed).toEqual(["grill-me"]);
    expect(report.materialized).toEqual([]);
    expect(await readFile(path.join(target, "grill-me", "SKILL.md"), "utf8")).toBe("personal");
    expect((await readSkillManifest(home)).skills["grill-me"]).toBeUndefined();
  });

  it("updates a managed skill when commons content changed", async () => {
    const { commons, home, target } = await setup();
    await writeCommonsSkill(commons, "s", { "SKILL.md": SKILL("s", "v1") });
    await materializeSkills({ commonsDir: commons, home, targetDir: target });
    await writeCommonsSkill(commons, "s", { "SKILL.md": SKILL("s", "v2") });

    const report = await materializeSkills({ commonsDir: commons, home, targetDir: target });

    expect(report.updated).toEqual(["s"]);
    expect(await readFile(path.join(target, "s", "SKILL.md"), "utf8")).toContain("v2");
  });

  it("restores a managed skill the user edited, and reports it", async () => {
    const { commons, home, target } = await setup();
    await writeCommonsSkill(commons, "s", { "SKILL.md": SKILL("s") });
    await materializeSkills({ commonsDir: commons, home, targetDir: target });
    await writeFile(path.join(target, "s", "SKILL.md"), "local edits", "utf8");

    const report = await materializeSkills({ commonsDir: commons, home, targetDir: target });

    expect(report.restored).toEqual(["s"]);
    expect(await readFile(path.join(target, "s", "SKILL.md"), "utf8")).toContain("name: s");
  });

  it("recreates a managed skill whose directory vanished", async () => {
    const { commons, home, target } = await setup();
    await writeCommonsSkill(commons, "s", { "SKILL.md": SKILL("s") });
    await materializeSkills({ commonsDir: commons, home, targetDir: target });
    await rm(path.join(target, "s"), { recursive: true, force: true });

    const report = await materializeSkills({ commonsDir: commons, home, targetDir: target });
    expect(report.restored).toEqual(["s"]);
    expect(await exists(path.join(target, "s", "SKILL.md"))).toBe(true);
  });

  it("removes a managed skill deleted from the commons", async () => {
    const { commons, home, target } = await setup();
    await writeCommonsSkill(commons, "s", { "SKILL.md": SKILL("s") });
    await materializeSkills({ commonsDir: commons, home, targetDir: target });
    await rm(path.join(commons, "skills", "s"), { recursive: true, force: true });

    const report = await materializeSkills({ commonsDir: commons, home, targetDir: target });

    expect(report.removed).toEqual(["s"]);
    expect(await exists(path.join(target, "s"))).toBe(false);
    expect((await readSkillManifest(home)).skills.s).toBeUndefined();
  });

  it("does NOT remove a managed skill whose commons dir merely fails to parse", async () => {
    const { commons, home, target } = await setup();
    await writeCommonsSkill(commons, "s", { "SKILL.md": SKILL("s") });
    await materializeSkills({ commonsDir: commons, home, targetDir: target });
    await writeCommonsSkill(commons, "s", { "SKILL.md": "no frontmatter" });

    const report = await materializeSkills({ commonsDir: commons, home, targetDir: target });

    expect(report.removed).toEqual([]);
    expect(report.failed.map((f) => f.name)).toEqual(["s"]);
    expect(await exists(path.join(target, "s"))).toBe(true);
  });

  it("is a no-op on a second identical run", async () => {
    const { commons, home, target } = await setup();
    await writeCommonsSkill(commons, "s", { "SKILL.md": SKILL("s") });
    await materializeSkills({ commonsDir: commons, home, targetDir: target });

    const report = await materializeSkills({ commonsDir: commons, home, targetDir: target });
    expect(report).toEqual({
      materialized: [], updated: [], removed: [], shadowed: [], restored: [], failed: [],
    });
    expect(formatReport(report)).toBeUndefined();
  });

  it("stamps materializedAt in the manifest", async () => {
    const { commons, home, target } = await setup();
    await writeCommonsSkill(commons, "s", { "SKILL.md": SKILL("s") });
    await materializeSkills({ commonsDir: commons, home, targetDir: target });
    const manifest = await readSkillManifest(home);
    expect(manifest.materializedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("format gate: touches nothing when memory.json declares a newer formatVersion", async () => {
    const { commons, home, target } = await setup();
    await writeFile(
      path.join(commons, "memory.json"),
      JSON.stringify({ formatVersion: 99 }),
      "utf8",
    );
    await writeCommonsSkill(commons, "s", { "SKILL.md": SKILL("s") });

    const report = await materializeSkills({ commonsDir: commons, home, targetDir: target });

    expect(report.materialized).toEqual([]);
    expect(report.failed.map((f) => f.name)).toEqual(["(format)"]);
    expect(await exists(path.join(target, "s"))).toBe(false);
  });
});

describe("formatReport", () => {
  it("names shadowed/restored/failed skills, counts the rest", () => {
    const line = formatReport({
      materialized: ["a", "b"],
      updated: ["c"],
      removed: ["d"],
      shadowed: ["grill-me"],
      restored: ["e"],
      failed: [{ name: "f", error: "boom" }],
    });
    expect(line).toBe(
      "skills: 2 materialized, 1 updated, 1 removed, shadowed by personal: grill-me, restored: e, failed: f (boom)",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/core/materialize.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// src/core/materialize.ts
import { access, cp, mkdir, readFile, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { FORMAT_VERSION } from "./memory-repo.js";
import {
  hashSkillDir,
  readSkillManifest,
  writeSkillManifest,
} from "./skill-manifest.js";
import { loadSkills, PROVENANCE_FILE } from "./skill.js";

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
  await rm(dest, { recursive: true, force: true });
  await mkdir(path.dirname(dest), { recursive: true });
  await cp(src, dest, {
    recursive: true,
    filter: (s) => path.basename(s) !== PROVENANCE_FILE,
  });
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
          report.materialized.push(skill.name);
          continue;
        }

        if (!(await exists(target))) {
          await copySkill(source, target);
          manifest.skills[skill.name] = { hash: sourceHash };
          report.restored.push(skill.name);
          continue;
        }

        const targetHash = await hashSkillDir(target);
        if (targetHash !== managed.hash) {
          await copySkill(source, target);
          manifest.skills[skill.name] = { hash: sourceHash };
          report.restored.push(skill.name);
          continue;
        }
        if (sourceHash !== managed.hash) {
          await copySkill(source, target);
          manifest.skills[skill.name] = { hash: sourceHash };
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

export const formatReport = (
  report: MaterializeReport,
): string | undefined => {
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
      ? [`failed: ${report.failed.map((f) => `${f.name} (${f.error})`).join(", ")}`]
      : []),
  ];
  return parts.length ? `skills: ${parts.join(", ")}` : undefined;
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/core/materialize.test.ts`
Expected: PASS (all 9)

- [ ] **Step 5: Green gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: clean.
Prepared commit (HELD): `feat: skill materialization engine with manifest ownership`

---

### Task 4: Lint covers `skills/`

**Files:**
- Modify: `src/commands/lint.ts`
- Test: `tests/commands/lint.test.ts` (add cases; existing assertions must keep passing)

**Interfaces:**
- Consumes: `loadSkills` (Task 1), `scanEntry`, existing lint structure.
- Produces: `runLint` output gains skill findings; summary becomes `✓ N entries, M skills, 0 problems` **only when M > 0** (existing `✓ 3 entries` assertions untouched).

- [ ] **Step 1: Write the failing tests** — append to `tests/commands/lint.test.ts` (imports for `mkdir`/`writeFile`/`path` already exist in that file; reuse its fixture helper style):

```typescript
  const writeManifestAndSkill = async (
    dir: string,
    skillDir: string,
    skillMd: string,
  ): Promise<void> => {
    await writeFile(
      path.join(dir, "memory.json"),
      JSON.stringify({ formatVersion: 1, budgets: { default: 2000, org: 4000 } }),
      "utf8",
    );
    await mkdir(path.join(dir, "skills", skillDir), { recursive: true });
    await writeFile(path.join(dir, "skills", skillDir, "SKILL.md"), skillMd, "utf8");
  };

  it("skills: valid skill counts in the summary", async () => {
    const dir = await makeDir();
    await writeManifestAndSkill(
      dir,
      "grill-me",
      "---\nname: grill-me\ndescription: d\n---\nbody",
    );

    const result = await runLint({ dir });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("1 skills");
  });

  it("skills: frontmatter mismatch and secrets fail the lint", async () => {
    const dir = await makeDir();
    await writeManifestAndSkill(
      dir,
      "bad-skill",
      "---\nname: other-name\ndescription: d\n---\nbody",
    );
    await mkdir(path.join(dir, "skills", "leaky"), { recursive: true });
    await writeFile(
      path.join(dir, "skills", "leaky", "SKILL.md"),
      `---\nname: leaky\ndescription: d\n---\ntoken: "ghp_${"a".repeat(36)}"`,
      "utf8",
    );

    const result = await runLint({ dir });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("bad-skill");
    expect(result.output).toContain("github-token");
  });
```

(`makeDir`, `mkdir`, `writeFile`, `path`, and `runLint` follow the file's existing imports — add any that are missing. If `lint.test.ts` already has a memory.json fixture helper, reuse it instead of `writeManifestAndSkill`'s inline manifest write.)

- [ ] **Step 2: Run to verify the new cases fail**

Run: `pnpm vitest run tests/commands/lint.test.ts`
Expected: the two new tests FAIL (no skill output); existing ones PASS.

- [ ] **Step 3: Implement in `src/commands/lint.ts`**

Add imports and two collectors, then wire into `runLint`:

```typescript
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { glob } from "tinyglobby";
import { loadSkills, PROVENANCE_FILE, type Skill } from "../core/skill.js";

// ─── Skill finding collectors ────────────────────────────────────────────────

const skillErrorFindings = (
  errors: { dir: string; error: string }[],
): string[] =>
  errors.map(({ dir, error }) => `skills/${dir}/SKILL.md: ${error}`);

const skillSecretFindings = async (
  repoDir: string,
  skills: Skill[],
): Promise<SecretResult> => {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const skill of skills) {
    const abs = path.join(repoDir, skill.dir);
    const files = (await glob(["**/*"], { cwd: abs, dot: true })).filter(
      (f) => f !== PROVENANCE_FILE,
    );
    files.sort();
    for (const f of files) {
      const text = await readFile(path.join(abs, f), "utf8").catch(() => "");
      for (const finding of scanEntry(text)) {
        const line = `${skill.dir}/${f}: [${finding.rule}] ${finding.match}`;
        if (finding.severity === "error") errors.push(line);
        else warnings.push(line);
      }
    }
  }
  return { errors, warnings };
};
```

In `runLint`, after the entry collectors:

```typescript
  const skillsLoad = await loadSkills(options.dir);
  errorLines.push(...skillErrorFindings(skillsLoad.errors));

  const skillSecrets = await skillSecretFindings(options.dir, skillsLoad.skills);
  errorLines.push(...skillSecrets.errors);
```

Merge `skillSecrets.warnings` into the warnings section alongside `secretWarnings`, and change the success line to:

```typescript
  const skillSuffix =
    skillsLoad.skills.length > 0 ? `, ${skillsLoad.skills.length} skills` : "";
  return {
    exitCode: 0,
    output: `✓ ${entries.length} entries${skillSuffix}, 0 problems${warningsSection}`,
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/commands/lint.test.ts`
Expected: PASS, including all pre-existing cases.

- [ ] **Step 5: Green gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Prepared commit (HELD): `feat: lint validates team skills and scans their files`

---

### Task 5: Vendoring — `runSkillAdd` (`src/commands/skill.ts`)

**Files:**
- Create: `src/commands/skill.ts`
- Test: `tests/commands/skill.test.ts`

**Interfaces:**
- Consumes: `exec`/`ExecResult`, `loadConfig`, `ensureRepo`, `memoryHome`, `scanEntry`, `compareUrl` (from `./promote.js`), `parseSkillFrontmatter`, `PROVENANCE_FILE`, `Provenance` (Task 1), `SCOPE_ID_RE`, `DATE_RE`.
- Produces:
  - `type GhRunner = (args: string[], cwd: string) => Promise<ExecResult>`
  - `interface SkillAddOptions { cwd: string; source: string; skill?: string; ref?: string; author: string; date: string; home?: string; ghRunner?: GhRunner }`
  - `runSkillAdd(options: SkillAddOptions): Promise<CommandResult>`
  - `normalizeSource(source: string): { url: string; label: string } | undefined` — `"owner/repo"` → `{ url: "https://github.com/owner/repo.git", label: "github:owner/repo" }`; full `https://…` URL passes through (`label` = URL without trailing `.git`); anything else → `undefined`
  - Internal shared helper `submitSkillPr` reused by Task 6 — signature: `submitSkillPr(args: { name: string; sourceDir: string; provenance?: Provenance; commonsUrl: string; home: string; ghRunner: GhRunner; commitLabel: string }): Promise<CommandResult>`

Behavioral contract (each is a test):
1. Happy path: clones upstream fixture, finds the single `skills/<x>/SKILL.md`, copies it into the Commons clone at `skills/<name>/` (name from frontmatter), writes `.provenance.json` with the upstream HEAD sha, pushes branch `skill/<name>`, calls gh with title `skill(<name>): vendor <label>`, exits 0 with the PR URL.
2. `--skill` disambiguates when the upstream has multiple skills; without it, multi-skill upstreams fail listing candidates.
3. Update path: when `skills/<name>` already exists on the Commons main, a changed upstream produces a successful "Skill updated" PR; an identical upstream exits 0 with "already up to date" and pushes nothing (no empty PRs).
4. Secret in any upstream skill file → exit 1, nothing pushed.
5. Root-level `SKILL.md` (repo root is the skill) → only `SKILL.md` is vendored, output notes it.
6. Invalid source string → exit 1 mentioning expected forms.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/commands/skill.test.ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeSource, runSkillAdd } from "../../src/commands/skill.js";
import { saveConfig } from "../../src/core/config.js";
import type { ExecResult } from "../../src/core/exec.js";
import { exec } from "../../src/core/exec.js";
import { makeCommonsFixture } from "../helpers/git.js";
import { tmpDirFactory } from "../helpers/tmp.js";

const VALID_CONFIG = {
  configVersion: 1 as const,
  commons: "",
  overlays: [] as string[],
  project: "my-project",
  squads: [] as string[],
  workspaces: {},
};

const SKILL = (name: string): string =>
  `---\nname: ${name}\ndescription: A ${name} skill.\n---\nDo the ${name} thing.`;

const ghStubFactory = (): { calls: string[][]; run: (a: string[], c: string) => Promise<ExecResult> } => {
  const calls: string[][] = [];
  return {
    calls,
    run: async (args: string[], _cwd: string): Promise<ExecResult> => {
      calls.push(args);
      return { ok: true, stdout: "https://github.com/roboto/team-memory/pull/7" };
    },
  };
};

describe("normalizeSource", () => {
  it("expands owner/repo to a github https url", () => {
    expect(normalizeSource("obra/skills")).toEqual({
      url: "https://github.com/obra/skills.git",
      label: "github:obra/skills",
    });
  });
  it("passes https urls through", () => {
    expect(normalizeSource("https://example.com/x/y.git")?.url).toBe(
      "https://example.com/x/y.git",
    );
  });
  it("rejects garbage", () => {
    expect(normalizeSource("not a source")).toBeUndefined();
  });
});

describe("runSkillAdd", () => {
  const tmp = tmpDirFactory("rm-skilladd-");
  afterEach(tmp.cleanup);

  const run = async (cmd: string, args: string[], cwd: string): Promise<void> => {
    const r = await exec(cmd, args, { cwd });
    if (!r.ok) throw new Error(`${cmd} ${args.join(" ")}: ${r.stderr}`);
  };

  /** bare upstream repo containing the given files */
  const makeUpstream = async (
    files: Record<string, string>,
  ): Promise<string> => {
    const root = await tmp.make();
    const bare = path.join(root, "upstream.git");
    const work = path.join(root, "work");
    await run("git", ["init", "--bare", "--initial-branch=main", bare], root);
    await run("git", ["clone", bare, work], root);
    await run("git", ["config", "user.email", "t@e.com"], work);
    await run("git", ["config", "user.name", "T"], work);
    await Promise.all(
      Object.entries(files).map(async ([f, c]) => {
        await mkdir(path.dirname(path.join(work, f)), { recursive: true });
        await writeFile(path.join(work, f), c, "utf8");
      }),
    );
    await run("git", ["add", "."], work);
    await run("git", ["commit", "-m", "skills"], work);
    await run("git", ["push", "origin", "main"], work);
    return bare;
  };

  const setup = async (): Promise<{ cwd: string; home: string; fixture: Awaited<ReturnType<typeof makeCommonsFixture>> }> => {
    const fixture = await makeCommonsFixture(await tmp.make());
    const cwd = await tmp.make();
    await saveConfig(cwd, { ...VALID_CONFIG, commons: fixture.remoteUrl });
    return { cwd, home: await tmp.make(), fixture };
  };

  it("vendors a single-skill upstream: branch, provenance, gh call", async () => {
    const { cwd, home, fixture } = await setup();
    const upstream = await makeUpstream({ "skills/grill-me/SKILL.md": SKILL("grill-me") });
    const gh = ghStubFactory();

    const result = await runSkillAdd({
      cwd, source: upstream, author: "hrithik", date: "2026-07-06", home, ghRunner: gh.run,
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("pull/7");

    const lsRemote = await exec("git", ["ls-remote", fixture.remoteUrl, "refs/heads/skill/grill-me"]);
    expect(lsRemote.ok && lsRemote.stdout).toMatch(/skill\/grill-me/);

    // provenance landed on the branch with a 40-char sha
    await run("git", ["fetch", "origin", "skill/grill-me"], fixture.workdir);
    await run("git", ["checkout", "skill/grill-me"], fixture.workdir);
    const prov = JSON.parse(
      await readFile(path.join(fixture.workdir, "skills", "grill-me", ".provenance.json"), "utf8"),
    ) as { ref: string; vendoredBy: string };
    expect(prov.ref).toMatch(/^[0-9a-f]{40}$/);
    expect(prov.vendoredBy).toBe("hrithik");

    const title = gh.calls[0] ?? [];
    expect(title[title.indexOf("--title") + 1]).toContain("skill(grill-me)");
  });

  it("multi-skill upstream requires --skill; with it, vendors the named one", async () => {
    const { cwd, home } = await setup();
    const upstream = await makeUpstream({
      "skills/a-one/SKILL.md": SKILL("a-one"),
      "skills/b-two/SKILL.md": SKILL("b-two"),
    });
    const gh = ghStubFactory();

    const bare = await runSkillAdd({
      cwd, source: upstream, author: "h", date: "2026-07-06", home, ghRunner: gh.run,
    });
    expect(bare.exitCode).toBe(1);
    expect(bare.output).toContain("--skill");
    expect(bare.output).toContain("a-one");

    const picked = await runSkillAdd({
      cwd, source: upstream, skill: "b-two", author: "h", date: "2026-07-06", home, ghRunner: gh.run,
    });
    expect(picked.exitCode).toBe(0);
    expect(picked.output).toContain("b-two");
  });

  it("re-vendoring a merged skill: update path when upstream changed, no-op when identical", async () => {
    const { cwd, home, fixture } = await setup();
    const root = await tmp.make();
    const upstreamBare = path.join(root, "upstream.git");
    const upstreamWork = path.join(root, "work");
    await run("git", ["init", "--bare", "--initial-branch=main", upstreamBare], root);
    await run("git", ["clone", upstreamBare, upstreamWork], root);
    await run("git", ["config", "user.email", "t@e.com"], upstreamWork);
    await run("git", ["config", "user.name", "T"], upstreamWork);
    await mkdir(path.join(upstreamWork, "skills", "grill-me"), { recursive: true });
    await writeFile(
      path.join(upstreamWork, "skills", "grill-me", "SKILL.md"),
      SKILL("grill-me"),
      "utf8",
    );
    await run("git", ["add", "."], upstreamWork);
    await run("git", ["commit", "-m", "v1"], upstreamWork);
    await run("git", ["push", "origin", "main"], upstreamWork);

    const gh = ghStubFactory();
    const opts = { cwd, source: upstreamBare, author: "h", date: "2026-07-06", home, ghRunner: gh.run };

    expect((await runSkillAdd(opts)).exitCode).toBe(0);

    // "review + merge" the first PR so the skill exists on main
    await run("git", ["fetch", "origin", "skill/grill-me"], fixture.workdir);
    await run("git", ["merge", "origin/skill/grill-me", "--no-edit"], fixture.workdir);
    await run("git", ["push", "origin", "main"], fixture.workdir);

    // identical upstream → nothing to submit
    const noop = await runSkillAdd(opts);
    expect(noop.exitCode).toBe(0);
    expect(noop.output).toContain("already up to date");

    // upstream moves → re-vendor is the update path
    await writeFile(
      path.join(upstreamWork, "skills", "grill-me", "SKILL.md"),
      `${SKILL("grill-me")}\n\nNew guidance.`,
      "utf8",
    );
    await run("git", ["commit", "-am", "v2"], upstreamWork);
    await run("git", ["push", "origin", "main"], upstreamWork);

    const second = await runSkillAdd(opts);
    expect(second.exitCode).toBe(0);
    expect(second.output).toContain("Skill updated");
  });

  it("blocks vendoring when a skill file contains a secret", async () => {
    const { cwd, home, fixture } = await setup();
    const upstream = await makeUpstream({
      "skills/leaky/SKILL.md": SKILL("leaky"),
      "skills/leaky/notes.md": `token: "ghp_${"a".repeat(36)}"`,
    });
    const gh = ghStubFactory();

    const result = await runSkillAdd({
      cwd, source: upstream, author: "h", date: "2026-07-06", home, ghRunner: gh.run,
    });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("github-token");
    const lsRemote = await exec("git", ["ls-remote", fixture.remoteUrl, "refs/heads/skill/leaky"]);
    expect(lsRemote.ok && lsRemote.stdout).toBe("");
  });

  it("root-level SKILL.md vendors only that file", async () => {
    const { cwd, home } = await setup();
    const upstream = await makeUpstream({
      "SKILL.md": SKILL("root-skill"),
      "src/code.ts": "export const x = 1;",
    });
    const gh = ghStubFactory();

    const result = await runSkillAdd({
      cwd, source: upstream, author: "h", date: "2026-07-06", home, ghRunner: gh.run,
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("only SKILL.md");
  });

  it("rejects an unusable source string", async () => {
    const { cwd, home } = await setup();
    const result = await runSkillAdd({
      cwd, source: "???", author: "h", date: "2026-07-06", home,
    });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("owner/repo");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/commands/skill.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// src/commands/skill.ts
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { glob } from "tinyglobby";
import { loadConfig } from "../core/config.js";
import { DATE_RE } from "../core/entry.js";
import { type ExecResult, exec } from "../core/exec.js";
import { ensureRepo, memoryHome } from "../core/memory-repo.js";
import { scanEntry } from "../core/scan.js";
import {
  parseSkillFrontmatter,
  PROVENANCE_FILE,
  type Provenance,
} from "../core/skill.js";
import type { CommandResult } from "../core/types.js";
import { compareUrl } from "./promote.js";

export type GhRunner = (args: string[], cwd: string) => Promise<ExecResult>;

export interface SkillAddOptions {
  cwd: string;
  source: string;
  skill?: string;
  ref?: string;
  author: string;
  date: string;
  home?: string;
  ghRunner?: GhRunner;
}

const fail = (output: string): CommandResult => ({ exitCode: 1, output });
const ok = (output: string): CommandResult => ({ exitCode: 0, output });

const defaultGhRunner: GhRunner = (args, cwd) => exec("gh", args, { cwd });

const OWNER_REPO_RE = /^[\w.-]+\/[\w.-]+$/;

export const normalizeSource = (
  source: string,
): { url: string; label: string } | undefined => {
  if (/^https:\/\/\S+$/.test(source)) {
    return { url: source, label: source.replace(/\.git$/, "") };
  }
  // absolute path or file:// — local remotes (tests, mirrors, non-GitHub hosts)
  if (source.startsWith("/") || source.startsWith("file://")) {
    return { url: source, label: source };
  }
  if (OWNER_REPO_RE.test(source)) {
    return {
      url: `https://github.com/${source}.git`,
      label: `github:${source}`,
    };
  }
  return undefined;
};

// ─── Upstream fetch + skill location ─────────────────────────────────────────

interface Upstream {
  dir: string;
  sha: string;
  cleanup: () => Promise<void>;
}

const fetchUpstream = async (
  url: string,
  ref: string | undefined,
): Promise<Upstream | { error: string }> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "rm-vendor-"));
  const cleanup = (): Promise<void> =>
    rm(dir, { recursive: true, force: true });

  const cloneArgs = ref
    ? ["clone", url, dir]
    : ["clone", "--depth", "1", url, dir];
  const clone = await exec("git", cloneArgs, { timeoutMs: 60_000 });
  if (!clone.ok) {
    await cleanup();
    return { error: `git clone failed: ${clone.stderr}` };
  }

  if (ref) {
    const checkout = await exec("git", ["checkout", ref], { cwd: dir });
    if (!checkout.ok) {
      await cleanup();
      return { error: `git checkout ${ref} failed: ${checkout.stderr}` };
    }
  }

  const revParse = await exec("git", ["rev-parse", "HEAD"], { cwd: dir });
  if (!revParse.ok) {
    await cleanup();
    return { error: `git rev-parse failed: ${revParse.stderr}` };
  }

  return { dir, sha: revParse.stdout.trim(), cleanup };
};

type Located =
  | { ok: true; relDir: string; rootOnly: boolean }
  | { ok: false; error: string };

const locateSkillDir = async (
  cloneDir: string,
  skillArg: string | undefined,
): Promise<Located> => {
  const hasSkillMd = async (rel: string): Promise<boolean> =>
    readFile(path.join(cloneDir, rel, "SKILL.md"), "utf8").then(
      () => true,
      () => false,
    );

  if (skillArg) {
    const candidates = [`skills/${skillArg}`, skillArg];
    for (const rel of candidates) {
      if (await hasSkillMd(rel)) return { ok: true, relDir: rel, rootOnly: false };
    }
    return {
      ok: false,
      error: `no SKILL.md found at skills/${skillArg}/ or ${skillArg}/ in the upstream repo`,
    };
  }

  const found = await glob(["**/SKILL.md"], {
    cwd: cloneDir,
    ignore: [".git/**", "node_modules/**"],
  });
  found.sort();

  if (found.length === 0) {
    return { ok: false, error: "no SKILL.md found in the upstream repo" };
  }
  if (found.length > 1) {
    const names = found.map((f) => path.dirname(f)).slice(0, 10);
    return {
      ok: false,
      error: [
        "multiple skills found — pass --skill <name>:",
        ...names.map((n) => `  ${n}`),
      ].join("\n"),
    };
  }

  const relDir = path.dirname(found[0] ?? "");
  return relDir === "."
    ? { ok: true, relDir: ".", rootOnly: true }
    : { ok: true, relDir, rootOnly: false };
};

// ─── Scanning ────────────────────────────────────────────────────────────────

interface SkillScan {
  errors: string[];
  warnings: string[];
}

const scanSkillFiles = async (absDir: string): Promise<SkillScan> => {
  const files = (
    await glob(["**/*"], { cwd: absDir, dot: true, ignore: [".git/**"] })
  ).filter((f) => f !== PROVENANCE_FILE);
  files.sort();

  const errors: string[] = [];
  const warnings: string[] = [];
  for (const f of files) {
    const text = await readFile(path.join(absDir, f), "utf8").catch(() => "");
    for (const finding of scanEntry(text)) {
      const line = `  ${f}: [${finding.rule}] ${finding.match}`;
      if (finding.severity === "error") errors.push(line);
      else warnings.push(line);
    }
  }
  return { errors, warnings };
};

// ─── Shared PR submission (used by add + promote) ────────────────────────────

export interface SubmitSkillArgs {
  name: string;
  /** absolute dir holding the skill files to vendor (never contains .git we want) */
  sourceDir: string;
  /** copy only SKILL.md (root-level upstream skill) */
  skillMdOnly?: boolean;
  provenance?: Provenance;
  commonsUrl: string;
  home: string;
  ghRunner: GhRunner;
  commitLabel: string;
}

export const submitSkillPr = async (
  args: SubmitSkillArgs,
): Promise<CommandResult> => {
  const repoSync = await ensureRepo(args.commonsUrl, args.home);
  if (!repoSync.ok) {
    return fail(`Failed to sync commons repo: ${repoSync.error}`);
  }
  const cloneDir = repoSync.dir;
  const relDir = `skills/${args.name}`;
  const absTarget = path.join(cloneDir, relDir);

  const scan = await scanSkillFiles(args.sourceDir);
  if (scan.errors.length > 0) {
    return fail(["Secret scan failed:", ...scan.errors].join("\n"));
  }

  const existing = await readFile(
    path.join(absTarget, "SKILL.md"),
    "utf8",
  ).then(
    () => true,
    () => false,
  );

  const branch = `skill/${args.name}`;
  const gitCleanup = (): Promise<ExecResult> =>
    exec("git", ["checkout", "main"], { cwd: cloneDir });

  const checkout = await exec("git", ["checkout", "-B", branch, "main"], {
    cwd: cloneDir,
  });
  if (!checkout.ok) return fail(`git checkout failed: ${checkout.stderr}`);

  await rm(absTarget, { recursive: true, force: true });
  await mkdir(absTarget, { recursive: true });
  if (args.skillMdOnly) {
    await cp(
      path.join(args.sourceDir, "SKILL.md"),
      path.join(absTarget, "SKILL.md"),
    );
  } else {
    await cp(args.sourceDir, absTarget, {
      recursive: true,
      filter: (s) => path.basename(s) !== ".git",
    });
  }
  if (args.provenance) {
    await writeFile(
      path.join(absTarget, PROVENANCE_FILE),
      `${JSON.stringify(args.provenance, null, 2)}\n`,
      "utf8",
    );
  }

  const add = await exec("git", ["add", relDir], { cwd: cloneDir });
  if (!add.ok) {
    await gitCleanup();
    return fail(`git add failed: ${add.stderr}`);
  }

  // re-vendoring an unchanged upstream stages nothing — succeed without an empty PR
  const staged = await exec("git", ["diff", "--cached", "--quiet"], {
    cwd: cloneDir,
  });
  if (staged.ok) {
    await gitCleanup();
    return ok(`${relDir} is already up to date — nothing to submit.`);
  }

  const commitMsg = `skill(${args.name}): ${args.commitLabel}`;
  const commit = await exec("git", ["commit", "-m", commitMsg], {
    cwd: cloneDir,
  });
  if (!commit.ok) {
    await gitCleanup();
    return fail(`git commit failed: ${commit.stderr}`);
  }

  const push = await exec("git", ["push", "-u", "origin", branch], {
    cwd: cloneDir,
  });
  if (!push.ok) {
    await gitCleanup();
    return fail(`git push failed: ${push.stderr}`);
  }

  const prResult = await args.ghRunner(
    [
      "pr",
      "create",
      "--title",
      commitMsg,
      "--body",
      `Team skill ${existing ? "update" : "addition"} via roboto-mem.`,
      "--head",
      branch,
    ],
    cloneDir,
  );

  await gitCleanup();

  const modeLine = existing
    ? `Skill updated: ${relDir} (existing team skill replaced in this PR)`
    : `Skill added: ${relDir}`;
  const rootNote = args.skillMdOnly
    ? ["Note: upstream skill lives at the repo root — only SKILL.md was vendored."]
    : [];
  const warningLines = scan.warnings.length
    ? ["", "Warnings (non-blocking):", ...scan.warnings]
    : [];

  if (prResult.ok) {
    return ok(
      [modeLine, ...rootNote, `Branch: ${branch}`, `PR: ${prResult.stdout.trim()}`, ...warningLines].join(
        "\n",
      ),
    );
  }

  const fallback =
    compareUrl(args.commonsUrl, branch) ??
    `open a PR for branch ${branch} on your git host`;
  return ok(
    [modeLine, ...rootNote, `Branch: ${branch}`, `gh unavailable — ${fallback}`, ...warningLines].join(
      "\n",
    ),
  );
};

// ─── skill add (vendor) ──────────────────────────────────────────────────────

export const runSkillAdd = async (
  options: SkillAddOptions,
): Promise<CommandResult> => {
  const {
    cwd,
    source,
    skill,
    ref,
    author,
    date,
    home = memoryHome(),
    ghRunner = defaultGhRunner,
  } = options;

  if (!author.trim()) return fail("author must not be empty.");
  if (!DATE_RE.test(date)) return fail(`Invalid date "${date}". Must be YYYY-MM-DD.`);

  const normalized = normalizeSource(source);
  if (!normalized) {
    return fail(
      `Unusable source "${source}" — expected owner/repo or an https git URL.`,
    );
  }

  const configResult = await loadConfig(cwd);
  if (!configResult.ok) {
    const detail =
      configResult.reason === "missing"
        ? `No .roboto-mem.json found in ${cwd}. Run roboto-mem init first.`
        : configResult.detail;
    return fail(detail);
  }

  const upstream = await fetchUpstream(normalized.url, ref);
  if ("error" in upstream) return fail(upstream.error);

  try {
    const located = await locateSkillDir(upstream.dir, skill);
    if (!located.ok) return fail(located.error);

    const sourceDir = path.join(upstream.dir, located.relDir);
    const raw = await readFile(path.join(sourceDir, "SKILL.md"), "utf8");
    const fm = parseSkillFrontmatter(raw);
    if (!fm.ok) return fail(`upstream SKILL.md: ${fm.error}`);

    const provenance: Provenance = {
      source: normalized.label,
      ref: upstream.sha,
      path: located.relDir,
      vendoredAt: date,
      vendoredBy: author,
    };

    return await submitSkillPr({
      name: fm.name,
      sourceDir,
      skillMdOnly: located.rootOnly,
      provenance,
      commonsUrl: configResult.config.commons,
      home,
      ghRunner,
      commitLabel: `vendor ${normalized.label}@${upstream.sha.slice(0, 7)}`,
    });
  } finally {
    await upstream.cleanup();
  }
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/commands/skill.test.ts`
Expected: PASS (all cases)

- [ ] **Step 5: Green gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Prepared commit (HELD): `feat: vendor skills from the store into the commons via reviewed PR`

---

### Task 6: Personal promotion — `runSkillPromote`

**Files:**
- Modify: `src/commands/skill.ts`
- Test: `tests/commands/skill.test.ts` (append)

**Interfaces:**
- Consumes: `submitSkillPr` (Task 5), `defaultSkillsTarget` (Task 3), `parseSkillFrontmatter`.
- Produces:
  - `interface SkillPromoteOptions { cwd: string; name: string; author: string; date: string; home?: string; skillsRoot?: string; ghRunner?: GhRunner }` — `skillsRoot` defaults to `defaultSkillsTarget()`, injectable for tests
  - `runSkillPromote(options: SkillPromoteOptions): Promise<CommandResult>`

- [ ] **Step 1: Write the failing tests** (append to `tests/commands/skill.test.ts`)

```typescript
import { runSkillPromote } from "../../src/commands/skill.js"; // merge into existing import

describe("runSkillPromote", () => {
  const tmp = tmpDirFactory("rm-skillpromote-");
  afterEach(tmp.cleanup);

  it("promotes a personal skill: branch pushed, no provenance file", async () => {
    const fixture = await makeCommonsFixture(await tmp.make());
    const cwd = await tmp.make();
    await saveConfig(cwd, { ...VALID_CONFIG, commons: fixture.remoteUrl });
    const home = await tmp.make();
    const skillsRoot = await tmp.make();

    await mkdir(path.join(skillsRoot, "my-flow"), { recursive: true });
    await writeFile(
      path.join(skillsRoot, "my-flow", "SKILL.md"),
      "---\nname: my-flow\ndescription: My workflow.\n---\nSteps.",
      "utf8",
    );

    const gh = ghStubFactory();
    const result = await runSkillPromote({
      cwd, name: "my-flow", author: "hrithik", date: "2026-07-06",
      home, skillsRoot, ghRunner: gh.run,
    });

    expect(result.exitCode).toBe(0);
    const lsRemote = await exec("git", ["ls-remote", fixture.remoteUrl, "refs/heads/skill/my-flow"]);
    expect(lsRemote.ok && lsRemote.stdout).toMatch(/skill\/my-flow/);

    const { workdir } = fixture;
    await exec("git", ["fetch", "origin", "skill/my-flow"], { cwd: workdir });
    await exec("git", ["checkout", "skill/my-flow"], { cwd: workdir });
    const provExists = await readFile(
      path.join(workdir, "skills", "my-flow", ".provenance.json"), "utf8",
    ).then(() => true, () => false);
    expect(provExists).toBe(false);
  });

  it("fails when the personal skill does not exist or frontmatter name mismatches", async () => {
    const fixture = await makeCommonsFixture(await tmp.make());
    const cwd = await tmp.make();
    await saveConfig(cwd, { ...VALID_CONFIG, commons: fixture.remoteUrl });
    const home = await tmp.make();
    const skillsRoot = await tmp.make();

    const missing = await runSkillPromote({
      cwd, name: "nope", author: "h", date: "2026-07-06", home, skillsRoot,
    });
    expect(missing.exitCode).toBe(1);

    await mkdir(path.join(skillsRoot, "renamed"), { recursive: true });
    await writeFile(
      path.join(skillsRoot, "renamed", "SKILL.md"),
      "---\nname: other\ndescription: d\n---\nbody",
      "utf8",
    );
    const mismatch = await runSkillPromote({
      cwd, name: "renamed", author: "h", date: "2026-07-06", home, skillsRoot,
    });
    expect(mismatch.exitCode).toBe(1);
    expect(mismatch.output).toContain("other");
  });
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `pnpm vitest run tests/commands/skill.test.ts`
Expected: new describe FAILs (`runSkillPromote` not exported)

- [ ] **Step 3: Implement** (append to `src/commands/skill.ts`)

```typescript
import { defaultSkillsTarget } from "../core/materialize.js"; // add to imports

export interface SkillPromoteOptions {
  cwd: string;
  name: string;
  author: string;
  date: string;
  home?: string;
  skillsRoot?: string;
  ghRunner?: GhRunner;
}

export const runSkillPromote = async (
  options: SkillPromoteOptions,
): Promise<CommandResult> => {
  const {
    cwd,
    name,
    author,
    date,
    home = memoryHome(),
    skillsRoot = defaultSkillsTarget(),
    ghRunner = defaultGhRunner,
  } = options;

  if (!author.trim()) return fail("author must not be empty.");
  if (!DATE_RE.test(date)) return fail(`Invalid date "${date}". Must be YYYY-MM-DD.`);

  const configResult = await loadConfig(cwd);
  if (!configResult.ok) {
    const detail =
      configResult.reason === "missing"
        ? `No .roboto-mem.json found in ${cwd}. Run roboto-mem init first.`
        : configResult.detail;
    return fail(detail);
  }

  const sourceDir = path.join(skillsRoot, name);
  const raw = await readFile(path.join(sourceDir, "SKILL.md"), "utf8").catch(
    () => undefined,
  );
  if (raw === undefined) {
    return fail(`No personal skill at ${sourceDir} (expected SKILL.md).`);
  }

  const fm = parseSkillFrontmatter(raw);
  if (!fm.ok) return fail(`SKILL.md: ${fm.error}`);
  if (fm.name !== name) {
    return fail(
      `frontmatter name "${fm.name}" must match the skill directory "${name}".`,
    );
  }

  return submitSkillPr({
    name,
    sourceDir,
    commonsUrl: configResult.config.commons,
    home,
    ghRunner,
    commitLabel: "promote from personal memory",
  });
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/commands/skill.test.ts`
Expected: PASS

- [ ] **Step 5: Green gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Prepared commit (HELD): `feat: promote a personal skill into team memory`

---

### Task 7: Sync + digest trigger materialization

**Files:**
- Modify: `src/commands/sync.ts`, `src/commands/digest.ts`
- Test: `tests/commands/sync.test.ts`, `tests/commands/digest.test.ts` (append)

**Interfaces:**
- Consumes: `materializeSkills`, `formatReport`, `MaterializeReport` (Task 3).
- Produces:
  - `SyncOptions` gains `skillsTargetDir?: string`; `runSync` prints the `formatReport` line when defined.
  - `DigestOptions` gains `skillsTargetDir?: string`; `runDigest` appends warnings for `restored` (per name) and `failed` (one aggregate line), same `> WARNING:` style as overlays. Never throws; only runs when the commons sync is fresh (`ok && !stale`) — offline sessions keep last-good skills untouched, honoring the spec.

- [ ] **Step 1: Write the failing tests**

Append to `tests/commands/sync.test.ts` (reuse its existing imports plus `mkdir`/`writeFile`/`path`/`fs` as needed and a small skill-push helper):

```typescript
  it("materializes commons skills into the target dir and reports it", async () => {
    const cwd = await makeDir();
    const tmp = await makeDir();
    const home = await makeDir();
    const target = await makeDir();
    const fixture = await makeCommonsFixture(tmp);

    await pushEntry( // pushEntry writes any file into the fixture and pushes — works for skills too
      fixture,
      "skills/grill-me/SKILL.md",
      "---\nname: grill-me\ndescription: d\n---\nbody",
    );

    await saveConfig(cwd, {
      configVersion: 1, commons: fixture.remoteUrl, overlays: [],
      project: "demo", squads: [], workspaces: {},
    });

    const result = await runSync({ cwd, home, skillsTargetDir: target });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("skills: 1 materialized");

    const skillMd = await fs.readFile(
      path.join(target, "grill-me", "SKILL.md"), "utf8",
    );
    expect(skillMd).toContain("name: grill-me");
  });
```

(`pushEntry` is exported from `tests/helpers/git.ts` and takes any relPath — no helper change needed. Add `import * as fs from "node:fs/promises";` and `import * as path from "node:path";` and the `pushEntry` import to the file's imports.)

Append to `tests/commands/digest.test.ts` (imports needed: `writeFile` from `node:fs/promises`, `path`, `pushEntry` from `../helpers/git.js` — merge with the file's existing imports; if the file already has a tmp-dir helper, use it in place of `makeDir`):

```typescript
  it("skills: warns on drift-restore at session start, stays silent otherwise", async () => {
    const cwd = await makeDir();
    const fixtureRoot = await makeDir();
    const home = await makeDir();
    const target = await makeDir();
    const fixture = await makeCommonsFixture(fixtureRoot);
    await pushEntry(
      fixture,
      "skills/grill-me/SKILL.md",
      "---\nname: grill-me\ndescription: d\n---\nteam body",
    );
    await saveConfig(cwd, {
      configVersion: 1, commons: fixture.remoteUrl, overlays: [],
      project: "demo", squads: [], workspaces: {},
    });

    const first = await runDigest({ cwd, home, skillsTargetDir: target });
    expect(first.exitCode).toBe(0);
    expect(first.output).not.toContain("team skill");

    await writeFile(path.join(target, "grill-me", "SKILL.md"), "local edits", "utf8");

    const second = await runDigest({ cwd, home, skillsTargetDir: target });
    expect(second.exitCode).toBe(0);
    expect(second.output).toContain(
      "> WARNING: team skill grill-me: local edits were replaced",
    );
  });
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `pnpm vitest run tests/commands/sync.test.ts tests/commands/digest.test.ts`
Expected: new cases FAIL (unknown option / no skills line)

- [ ] **Step 3: Implement**

`src/commands/sync.ts` — extend options and wire in after `syncRepos`:

```typescript
import { formatReport, materializeSkills } from "../core/materialize.js";

export interface SyncOptions {
  cwd: string;
  home?: string;
  skillsTargetDir?: string;
}
```

In `runSync`, after the `lines` array is built from repo sync lines:

```typescript
  const skillsLine =
    synced.commons.ok && !synced.commons.stale
      ? formatReport(
          await materializeSkills({
            commonsDir: synced.commons.dir,
            home,
            targetDir: options.skillsTargetDir,
          }),
        )
      : undefined;
  const outputLines = skillsLine ? [...lines, skillsLine] : lines;

  const exitCode = synced.commons.ok ? 0 : 1;
  return { exitCode, output: outputLines.join("\n") };
```

`src/commands/digest.ts` — extend options:

```typescript
import { materializeSkills } from "../core/materialize.js";

export interface DigestOptions {
  cwd: string;
  hook?: boolean;
  home?: string;
  nag?: string;
  today?: string;
  skillsTargetDir?: string;
}
```

After the `synced.commons.ok` guard (before Step 3 loads memory), materialize and collect warnings:

```typescript
  // Step 2b: materialize team skills (best-effort; fresh sync only)
  const skillWarnings = await (async (): Promise<string[]> => {
    if (synced.commons.stale) return [];
    const report = await materializeSkills({
      commonsDir: synced.commons.dir,
      home,
      targetDir: options.skillsTargetDir,
    });
    return [
      ...report.restored.map(
        (name) =>
          `> WARNING: team skill ${name}: local edits were replaced by the team version — promote changes via PR instead.`,
      ),
      ...(report.failed.length
        ? [
            `> WARNING: ${report.failed.length} team skill(s) failed to materialize — run roboto-mem status.`,
          ]
        : []),
    ];
  })();
```

Then include them where `fullOutput` is assembled:

```typescript
  const allWarnings = [...overlayWarnings, ...skillWarnings];
  const fullOutput = allWarnings.length
    ? `${digest}\n${allWarnings.join("\n")}`
    : digest;
```

(`materializeSkills` already never throws — the hook contract holds.)

- [ ] **Step 4: Run the full command test suites**

Run: `pnpm vitest run tests/commands`
Expected: PASS including all pre-existing sync/digest cases.

- [ ] **Step 5: Green gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Prepared commit (HELD): `feat: sync and session start materialize team skills`

---

### Task 8: Status shows the skills picture

**Files:**
- Modify: `src/commands/status.ts`
- Test: `tests/commands/status.test.ts` (append)

**Interfaces:**
- Consumes: `loadSkills` (Task 1), `readSkillManifest` + `hashSkillDir` (Task 2), `defaultSkillsTarget` (Task 3).
- Produces: `StatusOptions` gains `skillsTargetDir?: string`. In the synced branch, after the entries counts:
  - no skills in commons → `skills: none`
  - otherwise → `skills: <m> materialized` plus `, <p> pending sync`, `, shadowed by personal: a, b`, `, drifted (sync will restore): c`, `, <k> invalid` segments when non-zero; and a `skills last materialized: <YYYY-MM-DD>` line when the manifest carries `materializedAt`. Classification per commons skill: in manifest → hash target vs manifest hash (`drifted` on mismatch, else `materialized`); else target dir exists → `shadowed`; else `pending`.

- [ ] **Step 1: Write the failing tests** (append to `tests/commands/status.test.ts`; imports needed: `mkdir`/`writeFile` from `node:fs/promises`, `path`, `pushEntry` from `../helpers/git.js`, `runSync` from `../../src/commands/sync.js` — merge with existing imports and reuse the file's tmp-dir helper as `makeDir`)

```typescript
  const SKILL_CONFIG = {
    configVersion: 1 as const,
    overlays: [] as string[],
    project: "demo",
    squads: [] as string[],
    workspaces: {},
  };

  it("reports skills: none when the commons has no skills", async () => {
    const cwd = await makeDir();
    const fixtureRoot = await makeDir();
    const home = await makeDir();
    const fixture = await makeCommonsFixture(fixtureRoot);
    await saveConfig(cwd, { ...SKILL_CONFIG, commons: fixture.remoteUrl });
    await runSync({ cwd, home });

    const result = await runStatus({ cwd, home });
    expect(result.output).toContain("skills: none");
  });

  it("classifies materialized, shadowed, and drifted skills", async () => {
    const cwd = await makeDir();
    const fixtureRoot = await makeDir();
    const home = await makeDir();
    const target = await makeDir();
    const fixture = await makeCommonsFixture(fixtureRoot);
    await pushEntry(fixture, "skills/one/SKILL.md", "---\nname: one\ndescription: d\n---\nbody");
    await pushEntry(fixture, "skills/two/SKILL.md", "---\nname: two\ndescription: d\n---\nbody");
    await saveConfig(cwd, { ...SKILL_CONFIG, commons: fixture.remoteUrl });

    // "two" exists personally BEFORE the first sync → shadowed
    await mkdir(path.join(target, "two"), { recursive: true });
    await writeFile(path.join(target, "two", "SKILL.md"), "personal", "utf8");

    await runSync({ cwd, home, skillsTargetDir: target });

    // drift "one" after materialization
    await writeFile(path.join(target, "one", "SKILL.md"), "edited", "utf8");

    const result = await runStatus({ cwd, home, skillsTargetDir: target });
    expect(result.output).toContain("shadowed by personal: two");
    expect(result.output).toContain("drifted (sync will restore): one");
    expect(result.output).toMatch(/skills last materialized: \d{4}-\d{2}-\d{2}/);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run tests/commands/status.test.ts`
Expected: new cases FAIL

- [ ] **Step 3: Implement in `src/commands/status.ts`**

```typescript
import * as path from "node:path";
import { defaultSkillsTarget } from "../core/materialize.js";
import { hashSkillDir, readSkillManifest } from "../core/skill-manifest.js";
import { loadSkills } from "../core/skill.js";

export interface StatusOptions {
  cwd: string;
  home?: string;
  skillsTargetDir?: string;
}
```

In the `synced` branch (after the standards/lessons counts and formatVersion line):

```typescript
      const skillsLoad = await loadSkills(cloneDir);
      if (skillsLoad.skills.length === 0 && skillsLoad.errors.length === 0) {
        lines.push("skills: none");
      } else {
        const manifest = await readSkillManifest(home);
        const target = options.skillsTargetDir ?? defaultSkillsTarget();
        const classified = await Promise.all(
          skillsLoad.skills.map(async (skill) => {
            const managed = manifest.skills[skill.name];
            const targetPath = path.join(target, skill.name);
            if (!managed) {
              return {
                name: skill.name,
                state: (await cloneExists(targetPath))
                  ? ("shadowed" as const)
                  : ("pending" as const),
              };
            }
            const drifted =
              (await cloneExists(targetPath)) &&
              (await hashSkillDir(targetPath)) !== managed.hash;
            return {
              name: skill.name,
              state: drifted ? ("drifted" as const) : ("materialized" as const),
            };
          }),
        );
        const names = (s: "shadowed" | "drifted"): string[] =>
          classified.filter((c) => c.state === s).map((c) => c.name);
        const count = (s: "materialized" | "pending"): number =>
          classified.filter((c) => c.state === s).length;
        const shadowed = names("shadowed");
        const drifted = names("drifted");
        const segments = [
          `${count("materialized")} materialized`,
          ...(count("pending") ? [`${count("pending")} pending sync`] : []),
          ...(shadowed.length
            ? [`shadowed by personal: ${shadowed.join(", ")}`]
            : []),
          ...(drifted.length
            ? [`drifted (sync will restore): ${drifted.join(", ")}`]
            : []),
          ...(skillsLoad.errors.length
            ? [`${skillsLoad.errors.length} invalid`]
            : []),
        ];
        lines.push(`skills: ${segments.join(", ")}`);
        if (manifest.materializedAt) {
          lines.push(`skills last materialized: ${manifest.materializedAt}`);
        }
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/commands/status.test.ts`
Expected: PASS

- [ ] **Step 5: Green gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Prepared commit (HELD): `feat: status reports team-skill materialization state`

---

### Task 9: Scaffold, CLI wiring, slash command, docs

**Files:**
- Modify: `src/commands/commons-templates.ts`, `src/commands/init.ts`, `src/cli.ts`, `CONTEXT.md`, `README.md`
- Create: `commands/skill-add.md`
- Test: `tests/commands/init.test.ts`, `tests/cli.test.ts` (append)

**Interfaces:**
- Consumes: `runSkillAdd`, `runSkillPromote` (Tasks 5–6), `splitSquads`-style CLI plumbing, `todayYMD` (already in cli.ts).
- Produces: `roboto-mem skill add <source> [--skill n] [--ref r] --author a [--date d]` and `roboto-mem skill promote <name> --author a [--date d]`; `main.subCommands.skill` registered; Commons scaffold gains `skills/.gitkeep`, CODEOWNERS `skills/` line, README section.

- [ ] **Step 1: Write the failing tests**

Append to `tests/commands/init.test.ts` scaffold test (extend the existing "scaffold: creates…" test or add a sibling):

```typescript
  it("scaffold: creates skills/ with gitkeep and a CODEOWNERS line", async () => {
    const dir = await makeDir();
    const result = await runInit({ dir, scaffoldCommons: true });
    expect(result.exitCode).toBe(0);
    await expect(
      fs.access(path.join(dir, "skills", ".gitkeep")),
    ).resolves.toBeUndefined();
    const codeowners = await fs.readFile(path.join(dir, "CODEOWNERS"), "utf8");
    expect(codeowners).toContain("skills/ @your-org/standards-group");
    const readme = await fs.readFile(path.join(dir, "README.md"), "utf8");
    expect(readme).toContain("## Team Skills");
  });
```

Append to `tests/cli.test.ts`:

```typescript
describe("skill subcommand", () => {
  it("is registered on main", () => {
    expect(main.subCommands).toHaveProperty("skill");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run tests/commands/init.test.ts tests/cli.test.ts`
Expected: new cases FAIL

- [ ] **Step 3: Implement**

`src/commands/commons-templates.ts`:
- CODEOWNERS template — add after the `entries/org/` line:

```
skills/ @your-org/standards-group
```

- `COMMONS_README` — extend the entry-layout code block with `skills/<name>/SKILL.md   # Team Skills — reviewed agent workflows` and append a section:

```markdown
## Team Skills

\`skills/<name>/\` directories are Team Skills: reusable agent workflows (SKILL.md
plus support files) that roboto-mem materializes into every teammate's
\`~/.claude/skills/\` on sync. Vendored skills carry a \`.provenance.json\` pinned to
an upstream commit — updating one is a new PR via
\`roboto-mem skill add <owner>/<repo>\`, and the diff shows exactly what changed
upstream. Review skill PRs like code: watch for exfiltration, network calls, and
"run this command" patterns. Personal skills with the same name always win on a
teammate's machine (reported as shadowed, never overwritten).
```

`src/commands/init.ts` — in `scaffoldMode`, add to the `Promise.all`:

```typescript
    writeFile(path.join(dir, "skills", ".gitkeep"), ""),
```

and `"skills/.gitkeep"` to the `created` list.

`src/cli.ts` — add imports and commands:

```typescript
import { runSkillAdd, runSkillPromote } from "./commands/skill.js";

const skillAddCmd = defineCommand({
  meta: { name: "add", description: "Vendor a skill from GitHub/skills.sh into the commons (opens a PR)" },
  args: {
    source: { type: "positional", description: "owner/repo or git URL" },
    skill: { type: "string", description: "Skill name when the repo has several" },
    ref: { type: "string", description: "Upstream ref to pin (default: HEAD)" },
    author: { type: "string", description: "Author (github handle)" },
    date: { type: "string", description: "Date (YYYY-MM-DD)" },
  },
  async run({ args }) {
    const result = await runSkillAdd({
      cwd: process.cwd(),
      source: (args.source as string | undefined) ?? "",
      skill: args.skill as string | undefined,
      ref: args.ref as string | undefined,
      author: (args.author as string | undefined) ?? "",
      date: (args.date as string | undefined) ?? todayYMD(),
    });
    emit(result);
  },
});

const skillPromoteCmd = defineCommand({
  meta: { name: "promote", description: "Promote a personal skill (~/.claude/skills/<name>) into the commons (opens a PR)" },
  args: {
    name: { type: "positional", description: "Skill directory name" },
    author: { type: "string", description: "Author (github handle)" },
    date: { type: "string", description: "Date (YYYY-MM-DD)" },
  },
  async run({ args }) {
    const result = await runSkillPromote({
      cwd: process.cwd(),
      name: (args.name as string | undefined) ?? "",
      author: (args.author as string | undefined) ?? "",
      date: (args.date as string | undefined) ?? todayYMD(),
    });
    emit(result);
  },
});

const skillCmd = defineCommand({
  meta: { name: "skill", description: "Team Skills: vendor or promote skills into the commons" },
  subCommands: { add: skillAddCmd, promote: skillPromoteCmd },
});
```

Register in `main`: `subCommands: { init: initCmd, sync: syncCmd, digest: digestCmd, promote: promoteCmd, lint: lintCmd, status: statusCmd, skill: skillCmd }`.

Create `commands/skill-add.md`:

```markdown
---
description: Add a team skill — vendor from skills.sh/GitHub or promote a personal skill (opens a reviewed PR)
argument-hint: [owner/repo | skill-name]
---

Add a Skill to Team Memory. Argument: $1 = source.

1. **Dispatch on the argument shape:**
   - Contains `/` or `://` (e.g. `obra/skills`, an https URL) → vendor from upstream.
   - Bare kebab-case name (e.g. `my-flow`) → promote the personal skill at `~/.claude/skills/<name>/`.
   - Missing → ask the user which skill they want and where it lives.

2. **Derive author** from `git config user.name` (confirm with the user), date = today.

3. **Show the user what will happen and get explicit confirmation BEFORE running anything** — this pushes a branch and opens a PR on the Team Memory repo.

4. **Run it:**
   - Vendor: `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" skill add <source> [--skill <name>] --author <author>`
   - Promote: `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" skill promote <name> --author <author>`

5. **Handle findings:**
   - Multiple skills upstream: show the listed candidates, ask which one, re-run with `--skill`.
   - Secret finding: never bypassable. Help the user redact, then re-run.
   - "updated" in the output means the PR replaces an existing team skill — tell the user the diff shows the upstream change.

6. **Report the PR URL.** Remind the user the skill reaches teammates on their next session start after merge.
```

`CONTEXT.md` — add three terms after **Promotion** (Skill, Vendoring, Materialization — bodies verbatim from the spec's Language section) and amend the **Sync** definition to: "Content propagation: merged Entries and Team Skills reaching teammates' sessions by pulling the Team Memory repo. Changes what agents know and which team skills they carry, never how the tool behaves."

`README.md` — add two rows to the commands table (`skill add`, `skill promote`), mention `/skill-add` in the plugin-commands line, and add a short "Team Skills" section after "How scoping works" (3-4 sentences: what they are, reviewed-PR entry, sync materialization, personal-wins collision rule).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/commands/init.test.ts tests/cli.test.ts`
Expected: PASS

- [ ] **Step 5: Green gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: clean; build produces `dist/cli.mjs` with the new subcommands (`node dist/cli.mjs skill --help` lists add/promote).
Prepared commit (HELD): `feat: skill CLI commands, /skill-add, commons scaffold and docs`

---

### Task 10: End-to-end integration test

**Files:**
- Create: `tests/integration/skills-e2e.test.ts`

**Interfaces:**
- Consumes: everything above; `makeCommonsFixture`, `pushEntry`, `runSkillAdd`, `runSync`, `runStatus`.

- [ ] **Step 1: Write the test (it should pass immediately if Tasks 1–9 are correct — it is the full-loop proof, not TDD)**

```typescript
// tests/integration/skills-e2e.test.ts
import { mkdir, readFile, rm, writeFile, access } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runSkillAdd } from "../../src/commands/skill.js";
import { runStatus } from "../../src/commands/status.js";
import { runSync } from "../../src/commands/sync.js";
import { saveConfig } from "../../src/core/config.js";
import type { ExecResult } from "../../src/core/exec.js";
import { exec } from "../../src/core/exec.js";
import { makeCommonsFixture, pushEntry } from "../helpers/git.js";
import { tmpDirFactory } from "../helpers/tmp.js";

describe("skills e2e", () => {
  const tmp = tmpDirFactory("rm-skills-e2e-");
  afterEach(tmp.cleanup);

  const run = async (cmd: string, args: string[], cwd: string): Promise<void> => {
    const r = await exec(cmd, args, { cwd });
    if (!r.ok) throw new Error(`${cmd} ${args.join(" ")}: ${r.stderr}`);
  };

  const exists = (p: string): Promise<boolean> =>
    access(p).then(() => true, () => false);

  it("vendor → merge → sync materializes → edit restores → delete cleans up", async () => {
    const fixture = await makeCommonsFixture(await tmp.make());
    const cwd = await tmp.make();
    const home = await tmp.make();
    const target = await tmp.make();
    await saveConfig(cwd, {
      configVersion: 1, commons: fixture.remoteUrl, overlays: [],
      project: "demo", squads: [], workspaces: {},
    });

    // upstream skill repo
    const upstreamRoot = await tmp.make();
    const upstreamBare = path.join(upstreamRoot, "up.git");
    const upstreamWork = path.join(upstreamRoot, "work");
    await run("git", ["init", "--bare", "--initial-branch=main", upstreamBare], upstreamRoot);
    await run("git", ["clone", upstreamBare, upstreamWork], upstreamRoot);
    await run("git", ["config", "user.email", "t@e.com"], upstreamWork);
    await run("git", ["config", "user.name", "T"], upstreamWork);
    await mkdir(path.join(upstreamWork, "skills", "hello-team"), { recursive: true });
    await writeFile(
      path.join(upstreamWork, "skills", "hello-team", "SKILL.md"),
      "---\nname: hello-team\ndescription: Say hello.\n---\nSay hello to the team.",
      "utf8",
    );
    await run("git", ["add", "."], upstreamWork);
    await run("git", ["commit", "-m", "skill"], upstreamWork);
    await run("git", ["push", "origin", "main"], upstreamWork);

    // 1. vendor → PR branch on the commons
    const ghStub = async (_a: string[], _c: string): Promise<ExecResult> => ({
      ok: true, stdout: "https://example.com/pr/1",
    });
    const add = await runSkillAdd({
      cwd, source: upstreamBare, author: "hrithik", date: "2026-07-06",
      home, ghRunner: ghStub,
    });
    expect(add.exitCode).toBe(0);

    // 2. "review + merge" the PR branch into main on the commons
    await run("git", ["fetch", "origin", "skill/hello-team"], fixture.workdir);
    await run("git", ["merge", "origin/skill/hello-team", "--no-edit"], fixture.workdir);
    await run("git", ["push", "origin", "main"], fixture.workdir);

    // 3. teammate sync → materialized (provenance excluded)
    const sync1 = await runSync({ cwd, home, skillsTargetDir: target });
    expect(sync1.output).toContain("skills: 1 materialized");
    expect(await exists(path.join(target, "hello-team", "SKILL.md"))).toBe(true);
    expect(await exists(path.join(target, "hello-team", ".provenance.json"))).toBe(false);

    // 4. status agrees
    const status = await runStatus({ cwd, home, skillsTargetDir: target });
    expect(status.output).toContain("skills: 1 materialized");

    // 5. local edit → next sync restores and reports
    await writeFile(path.join(target, "hello-team", "SKILL.md"), "hacked", "utf8");
    const sync2 = await runSync({ cwd, home, skillsTargetDir: target });
    expect(sync2.output).toContain("restored: hello-team");
    expect(
      await readFile(path.join(target, "hello-team", "SKILL.md"), "utf8"),
    ).toContain("Say hello");

    // 6. removed from the commons → next sync cleans up
    await run("git", ["rm", "-r", "skills/hello-team"], fixture.workdir);
    await run("git", ["commit", "-m", "remove skill"], fixture.workdir);
    await run("git", ["push", "origin", "main"], fixture.workdir);
    const sync3 = await runSync({ cwd, home, skillsTargetDir: target });
    expect(sync3.output).toContain("removed");
    expect(await exists(path.join(target, "hello-team"))).toBe(false);
  });

  it("personal skill with the same name is never overwritten", async () => {
    const fixture = await makeCommonsFixture(await tmp.make());
    const cwd = await tmp.make();
    const home = await tmp.make();
    const target = await tmp.make();
    await saveConfig(cwd, {
      configVersion: 1, commons: fixture.remoteUrl, overlays: [],
      project: "demo", squads: [], workspaces: {},
    });

    await pushEntry(
      fixture,
      "skills/grill-me/SKILL.md",
      "---\nname: grill-me\ndescription: team version\n---\nteam",
    );

    await mkdir(path.join(target, "grill-me"), { recursive: true });
    await writeFile(path.join(target, "grill-me", "SKILL.md"), "personal", "utf8");

    const sync = await runSync({ cwd, home, skillsTargetDir: target });
    expect(sync.output).toContain("shadowed by personal: grill-me");
    expect(
      await readFile(path.join(target, "grill-me", "SKILL.md"), "utf8"),
    ).toBe("personal");
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm vitest run tests/integration/skills-e2e.test.ts`
Expected: PASS. Any failure here is a real integration bug — fix the responsible module, not the test.

- [ ] **Step 3: Full gate + coverage**

Run: `pnpm typecheck && pnpm lint && pnpm test:coverage`
Expected: everything green, coverage thresholds (80%) met.
Prepared commit (HELD): `test: end-to-end team-skills loop`

---

## Final verification (after all tasks)

- [ ] `pnpm typecheck && pnpm lint && pnpm test:coverage && pnpm build` — all green.
- [ ] Manual smoke (optional, no network): `node dist/cli.mjs skill --help` shows `add` and `promote`.
- [ ] Confirm no `let`/`var` slipped in: `grep -rn "\blet \|\bvar " src tests --include="*.ts"` → no matches (existing code is already clean).
- [ ] Report to Hrithik with a summary and **WAIT** — commits, branches, PRs, version bumps, and plugin/marketplace manifest changes all need his explicit word. (Release later needs the three-file version bump: `package.json`, `.claude-plugin/marketplace.json`, `.claude-plugin/plugin.json`.)
