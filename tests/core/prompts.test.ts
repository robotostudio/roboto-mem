import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { saveConfig } from "../../src/core/config.js";
import type { ExecResult } from "../../src/core/exec.js";
import {
  buildInitOptions,
  buildPromoteOptions,
  buildSkillAddOptions,
  buildSkillPromoteOptions,
  listPersonalSkillNames,
  planInitPrompts,
  planPromotePrompts,
  planSkillAddPrompts,
  planSkillPromotePrompts,
  resolveDefaultAuthor,
  resolveKnownScopes,
} from "../../src/core/prompts.js";
import { tmpDirFactory } from "../helpers/tmp.js";

const VALID_CONFIG = {
  configVersion: 1 as const,
  commons: "git@x:y/z.git",
  overlays: [] as string[],
  project: "loggle",
  squads: ["web"],
  workspaces: { ".": ["stack/nextjs"] },
};

describe("planInitPrompts", () => {
  const ctx = { defaultProjectName: "my-dir" };

  // Bind vs scaffold mode is decided up front by resolveInitPrompts (never a
  // step here), so this plan only ever covers the bind fields.
  it("bare invocation: asks all 3 bind fields with defaults prefilled", () => {
    const steps = planInitPrompts({}, ctx);
    expect(steps.map((s) => s.key)).toEqual([
      "project",
      "commonsUrl",
      "squads",
    ]);
    const project = steps.find((s) => s.key === "project");
    expect(project?.kind).toBe("text");
    expect(project && "initialValue" in project && project.initialValue).toBe(
      "my-dir",
    );
  });

  it("prefills commonsUrl/squads defaults from an existing binding (rebind)", () => {
    const steps = planInitPrompts(
      {},
      { ...ctx, defaultCommonsUrl: "git@x:y/old.git", defaultSquads: "web" },
    );
    const commonsUrl = steps.find((s) => s.key === "commonsUrl");
    const squads = steps.find((s) => s.key === "squads");
    expect(
      commonsUrl && "initialValue" in commonsUrl && commonsUrl.initialValue,
    ).toBe("git@x:y/old.git");
    expect(squads && "initialValue" in squads && squads.initialValue).toBe(
      "web",
    );
  });

  it("commonsUrl rejects a non-url before accepting a valid one", () => {
    const steps = planInitPrompts({}, ctx);
    const commonsUrl = steps.find((s) => s.key === "commonsUrl");
    expect(
      commonsUrl?.kind === "text" && commonsUrl.validate?.("asdasd"),
    ).toMatch(/git@|:\/\//);
    expect(
      commonsUrl?.kind === "text" &&
        commonsUrl.validate?.("https://github.com/org/team-memory.git"),
    ).toBeUndefined();
    expect(
      commonsUrl?.kind === "text" &&
        commonsUrl.validate?.("git@host:org/x.git"),
    ).toBeUndefined();
    expect(commonsUrl?.kind === "text" && commonsUrl.validate?.("   ")).toMatch(
      /empty/,
    );
  });

  it("squads rejects an invalid name, surfacing the lowercase-slug suggestion, no silent lowercasing", () => {
    const steps = planInitPrompts({}, ctx);
    const squads = steps.find((s) => s.key === "squads");
    const error = squads?.kind === "text" && squads.validate?.("Web");
    expect(error).toContain('"web"');
    expect(
      squads?.kind === "text" && squads.validate?.("web, mobile"),
    ).toBeUndefined();
    expect(squads?.kind === "text" && squads.validate?.("")).toBeUndefined();
  });

  it("partial: some flags given → prompts only missing required fields", () => {
    const steps = planInitPrompts({ squads: "web" }, ctx);
    // project + commonsUrl are required and missing; squads is provided
    expect(steps.map((s) => s.key)).toEqual(["project", "commonsUrl"]);
  });

  it("flags-only: all 3 bind fields given → no steps", () => {
    const steps = planInitPrompts(
      { project: "p", commonsUrl: "u", squads: "web" },
      ctx,
    );
    expect(steps).toEqual([]);
  });
});

describe("buildInitOptions", () => {
  it("answers win for prompted keys; provided values pass through for the rest", () => {
    const result = buildInitOptions(
      { squads: "web" },
      { project: "loggle", commonsUrl: "git@x:y/z.git" },
    );
    expect(result).toEqual({
      project: "loggle",
      commonsUrl: "git@x:y/z.git",
      squads: ["web"],
      scaffoldCommons: undefined,
    });
  });

  it("splits comma-separated squads answer", () => {
    const result = buildInitOptions({}, { squads: "web, mobile" });
    expect(result.squads).toEqual(["web", "mobile"]);
  });

  it("empty-string answer skips back to undefined", () => {
    const result = buildInitOptions({}, { commonsUrl: "  " });
    expect(result.commonsUrl).toBeUndefined();
  });
});

describe("planPromotePrompts", () => {
  const ctx = {
    knownScopes: undefined,
    defaultAuthor: "",
    today: "2026-07-06",
  };

  it("bare invocation: asks all 7 fields in order, date prefilled with today", () => {
    const steps = planPromotePrompts({}, ctx);
    expect(steps.map((s) => s.key)).toEqual([
      "scope",
      "type",
      "name",
      "description",
      "author",
      "date",
      "bodyFile",
    ]);
    const date = steps.find((s) => s.key === "date");
    expect(date && "initialValue" in date && date.initialValue).toBe(
      "2026-07-06",
    );
  });

  it("never plans --force or --overrides", () => {
    const steps = planPromotePrompts({}, ctx);
    expect(steps.some((s) => s.key === "force")).toBe(false);
    expect(steps.some((s) => s.key === "overrides")).toBe(false);
  });

  it("partial: date is optional (has a CLI-level fallback) and is skipped when missing", () => {
    const steps = planPromotePrompts(
      {
        scope: "org",
        type: "standard",
        name: "n",
        description: "d",
        author: "a",
        bodyFile: "f.md",
      },
      ctx,
    );
    expect(steps).toEqual([]);
  });

  it("partial: author has no code-level fallback and stays required", () => {
    const steps = planPromotePrompts(
      {
        scope: "org",
        type: "standard",
        name: "n",
        description: "d",
        bodyFile: "f.md",
      },
      ctx,
    );
    expect(steps.map((s) => s.key)).toEqual(["author"]);
  });

  it("scope becomes a select of exactly the detected scopes, declaring an 'other…' escape hatch", () => {
    const steps = planPromotePrompts(
      {},
      { ...ctx, knownScopes: ["org", "project/loggle"] },
    );
    const scope = steps.find((s) => s.key === "scope");
    expect(scope?.kind).toBe("select");
    expect(scope?.kind === "select" && scope.options).toEqual([
      { value: "org", label: "org" },
      { value: "project/loggle", label: "project/loggle" },
    ]);
    expect(scope?.kind === "select" && scope.other?.label).toBe("other…");
    expect(
      scope?.kind === "select" && scope.other?.validate?.("not valid!"),
    ).toMatch(/org|squad|stack|project/);
    expect(
      scope?.kind === "select" && scope.other?.validate?.("org"),
    ).toBeUndefined();
  });

  it("scope falls back to text when knownScopes is undefined", () => {
    const steps = planPromotePrompts({}, ctx);
    expect(steps.find((s) => s.key === "scope")?.kind).toBe("text");
  });

  it("scope text fallback validates against isValidScope", () => {
    const steps = planPromotePrompts({}, ctx);
    const scope = steps.find((s) => s.key === "scope");
    expect(scope?.kind === "text" && scope.validate?.("not valid!")).toMatch(
      /org|squad|stack|project/,
    );
    expect(scope?.kind === "text" && scope.validate?.("org")).toBeUndefined();
  });

  it("date step validates against DATE_RE", () => {
    const steps = planPromotePrompts({}, ctx);
    const date = steps.find((s) => s.key === "date");
    expect(date?.kind === "text" && date.validate?.("07/06/2026")).toMatch(
      /YYYY-MM-DD/,
    );
    expect(
      date?.kind === "text" && date.validate?.("2026-07-06"),
    ).toBeUndefined();
  });

  it("name step validates against the kebab-case entry-name rule", () => {
    const steps = planPromotePrompts({}, ctx);
    const name = steps.find((s) => s.key === "name");
    expect(name?.kind).toBe("text");
    expect(name?.kind === "text" && name.validate?.("Bad Name")).toMatch(
      /kebab|a-z0-9/,
    );
    expect(
      name?.kind === "text" && name.validate?.("good-name"),
    ).toBeUndefined();
  });

  it("bodyFile step validates the path exists on disk", () => {
    const steps = planPromotePrompts({}, ctx);
    const bodyFile = steps.find((s) => s.key === "bodyFile");
    expect(
      bodyFile?.kind === "text" && bodyFile.validate?.("/nope/does-not-exist"),
    ).toMatch(/not found/);
    expect(
      bodyFile?.kind === "text" && bodyFile.validate?.(__filename),
    ).toBeUndefined();
  });
});

describe("buildPromoteOptions", () => {
  it("merges answers over provided and leaves untouched keys alone", () => {
    const result = buildPromoteOptions(
      { scope: "org", bodyFile: "f.md" },
      { type: "standard", name: "n", description: "d", author: "a" },
    );
    expect(result).toEqual({
      scope: "org",
      type: "standard",
      name: "n",
      description: "d",
      author: "a",
      date: undefined,
      bodyFile: "f.md",
    });
  });
});

describe("planSkillAddPrompts", () => {
  const ctx = { defaultAuthor: "" };

  it("bare invocation asks source, skill, ref, author in order", () => {
    const steps = planSkillAddPrompts({}, ctx);
    expect(steps.map((s) => s.key)).toEqual([
      "source",
      "skill",
      "ref",
      "author",
    ]);
    expect(
      steps.find((s) => s.key === "ref")?.kind === "text" &&
        (steps.find((s) => s.key === "ref") as { placeholder?: string })
          .placeholder,
    ).toBe("HEAD");
  });

  it("never plans date (skill add keeps it flag-only)", () => {
    const steps = planSkillAddPrompts({}, ctx);
    expect(steps.some((s) => s.key === "date")).toBe(false);
  });

  it("author is prefilled from the injected git-derived default", () => {
    const steps = planSkillAddPrompts({}, { defaultAuthor: "hrithik" });
    const author = steps.find((s) => s.key === "author");
    expect(author?.kind === "text" && author.initialValue).toBe("hrithik");
  });

  it("partial: source and author given → only optional fields remain unprompted", () => {
    const steps = planSkillAddPrompts(
      { source: "obra/skills", author: "hrithik" },
      ctx,
    );
    expect(steps).toEqual([]);
  });

  it("partial: source missing while skill given → prompts source and author (both required)", () => {
    const steps = planSkillAddPrompts({ skill: "grill-me" }, ctx);
    expect(steps.map((s) => s.key)).toEqual(["source", "author"]);
  });

  it("partial: only author missing → prompts just author", () => {
    const steps = planSkillAddPrompts(
      { source: "obra/skills", skill: "grill-me", ref: "main" },
      ctx,
    );
    expect(steps.map((s) => s.key)).toEqual(["author"]);
  });
});

describe("buildSkillAddOptions", () => {
  it("passes through untouched fields and applies answers", () => {
    const result = buildSkillAddOptions(
      { skill: "grill-me" },
      { source: "obra/skills", ref: "" },
    );
    expect(result).toEqual({
      source: "obra/skills",
      skill: "grill-me",
      ref: undefined,
      author: undefined,
    });
  });

  it("merges the answered author over provided", () => {
    const result = buildSkillAddOptions(
      { source: "obra/skills" },
      { author: "hrithik" },
    );
    expect(result.author).toBe("hrithik");
  });
});

describe("planSkillPromotePrompts", () => {
  const ctx = {
    personalSkillNames: undefined,
    defaultAuthor: "",
    today: "2026-07-06",
  };

  it("bare invocation asks name, author, date in order", () => {
    const steps = planSkillPromotePrompts({}, ctx);
    expect(steps.map((s) => s.key)).toEqual(["name", "author", "date"]);
  });

  it("name becomes a select when personal skills are listable", () => {
    const steps = planSkillPromotePrompts(
      {},
      { ...ctx, personalSkillNames: ["grill-me", "other"] },
    );
    const name = steps.find((s) => s.key === "name");
    expect(name?.kind).toBe("select");
  });

  it("name falls back to text when there are no personal skills", () => {
    const steps = planSkillPromotePrompts(
      {},
      { ...ctx, personalSkillNames: [] },
    );
    expect(steps.find((s) => s.key === "name")?.kind).toBe("text");
  });

  it("date step validates against DATE_RE", () => {
    const steps = planSkillPromotePrompts({}, ctx);
    const date = steps.find((s) => s.key === "date");
    expect(date?.kind === "text" && date.validate?.("07/06/2026")).toMatch(
      /YYYY-MM-DD/,
    );
    expect(
      date?.kind === "text" && date.validate?.("2026-07-06"),
    ).toBeUndefined();
  });

  it("date is optional and skipped in partial mode", () => {
    const steps = planSkillPromotePrompts({ name: "n", author: "a" }, ctx);
    expect(steps).toEqual([]);
  });
});

describe("buildSkillPromoteOptions", () => {
  it("merges answers over provided", () => {
    const result = buildSkillPromoteOptions(
      { name: "grill-me" },
      { author: "hrithik", date: "2026-07-06" },
    );
    expect(result).toEqual({
      name: "grill-me",
      author: "hrithik",
      date: "2026-07-06",
    });
  });
});

describe("resolveDefaultAuthor", () => {
  it("trims stdout from the injected git runner on success", async () => {
    const runGit = async (args: string[]): Promise<ExecResult> => {
      expect(args).toEqual(["config", "user.name"]);
      return { ok: true, stdout: "  Hrithik  \n" };
    };
    expect(await resolveDefaultAuthor("/tmp", runGit)).toBe("Hrithik");
  });

  it("returns empty string when git config has no user.name", async () => {
    const runGit = async (): Promise<ExecResult> => ({
      ok: false,
      reason: "exit",
      code: 1,
      stderr: "",
    });
    expect(await resolveDefaultAuthor("/tmp", runGit)).toBe("");
  });
});

// resolveKnownScopes must return EXACTLY this repo's detected scopes (its
// squads, its stacks, itself) plus "org" — the same sessionScopes() union
// digest/status already compute for cwd. Nothing from the wider Commons.
describe("resolveKnownScopes", () => {
  const tmp = tmpDirFactory("rm-prompts-scopes-");
  afterEach(tmp.cleanup);

  it("returns the session-scope union for a bound project", async () => {
    const dir = await tmp.make();
    await saveConfig(dir, VALID_CONFIG);
    const scopes = await resolveKnownScopes(dir);
    expect(scopes).toEqual([
      "org",
      "squad/web",
      "stack/nextjs",
      "project/loggle",
    ]);
  });

  it("returns undefined when the project has no config", async () => {
    const dir = await tmp.make();
    expect(await resolveKnownScopes(dir)).toBeUndefined();
  });
});

describe("listPersonalSkillNames", () => {
  const tmp = tmpDirFactory("rm-prompts-skills-");
  afterEach(tmp.cleanup);

  it("lists only directories containing a SKILL.md, sorted", async () => {
    const root = await tmp.make();
    await fs.mkdir(path.join(root, "zeta"), { recursive: true });
    await fs.writeFile(path.join(root, "zeta", "SKILL.md"), "x", "utf8");
    await fs.mkdir(path.join(root, "alpha"), { recursive: true });
    await fs.writeFile(path.join(root, "alpha", "SKILL.md"), "x", "utf8");
    await fs.mkdir(path.join(root, "junk"), { recursive: true }); // no SKILL.md

    expect(await listPersonalSkillNames(root)).toEqual(["alpha", "zeta"]);
  });

  it("returns an empty array when the root does not exist", async () => {
    expect(await listPersonalSkillNames("/no/such/dir")).toEqual([]);
  });
});
