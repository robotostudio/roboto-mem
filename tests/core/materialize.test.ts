import {
  access,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatReport, materializeSkills } from "../../src/core/materialize.js";
import { readSkillManifest } from "../../src/core/skill-manifest.js";
import { tmpDirFactory } from "../helpers/tmp.js";

const SKILL = (name: string, body = "body"): string =>
  `---\nname: ${name}\ndescription: d\n---\n${body}`;

const PROVENANCE = JSON.stringify({
  source: "github:obra/skills",
  ref: "a".repeat(40),
  path: "skills/grill-me",
  vendoredAt: "2026-07-06",
  vendoredBy: "hrithik",
});

describe("materializeSkills", () => {
  const tmp = tmpDirFactory("rm-mat-");
  afterEach(tmp.cleanup);

  const exists = (p: string): Promise<boolean> =>
    access(p).then(
      () => true,
      () => false,
    );

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
      ".provenance.json": PROVENANCE,
    });

    const report = await materializeSkills({
      commonsDir: commons,
      home,
      targetDir: target,
    });

    expect(report.materialized).toEqual(["grill-me"]);
    expect(await exists(path.join(target, "grill-me", "SKILL.md"))).toBe(true);
    expect(
      await exists(path.join(target, "grill-me", ".provenance.json")),
    ).toBe(false);
    const manifest = await readSkillManifest(home);
    expect(Object.keys(manifest.skills)).toEqual(["grill-me"]);
  });

  it("skips and reports a shadowing personal skill", async () => {
    const { commons, home, target } = await setup();
    await writeCommonsSkill(commons, "grill-me", {
      "SKILL.md": SKILL("grill-me"),
    });
    await mkdir(path.join(target, "grill-me"), { recursive: true });
    await writeFile(
      path.join(target, "grill-me", "SKILL.md"),
      "personal",
      "utf8",
    );

    const report = await materializeSkills({
      commonsDir: commons,
      home,
      targetDir: target,
    });

    expect(report.shadowed).toEqual(["grill-me"]);
    expect(report.materialized).toEqual([]);
    expect(
      await readFile(path.join(target, "grill-me", "SKILL.md"), "utf8"),
    ).toBe("personal");
    expect((await readSkillManifest(home)).skills["grill-me"]).toBeUndefined();
  });

  it("updates a managed skill when commons content changed", async () => {
    const { commons, home, target } = await setup();
    await writeCommonsSkill(commons, "s", { "SKILL.md": SKILL("s", "v1") });
    await materializeSkills({ commonsDir: commons, home, targetDir: target });
    await writeCommonsSkill(commons, "s", { "SKILL.md": SKILL("s", "v2") });

    const report = await materializeSkills({
      commonsDir: commons,
      home,
      targetDir: target,
    });

    expect(report.updated).toEqual(["s"]);
    expect(
      await readFile(path.join(target, "s", "SKILL.md"), "utf8"),
    ).toContain("v2");
  });

  it("restores a managed skill the user edited, and reports it", async () => {
    const { commons, home, target } = await setup();
    await writeCommonsSkill(commons, "s", { "SKILL.md": SKILL("s") });
    await materializeSkills({ commonsDir: commons, home, targetDir: target });
    await writeFile(path.join(target, "s", "SKILL.md"), "local edits", "utf8");

    const report = await materializeSkills({
      commonsDir: commons,
      home,
      targetDir: target,
    });

    expect(report.restored).toEqual(["s"]);
    expect(
      await readFile(path.join(target, "s", "SKILL.md"), "utf8"),
    ).toContain("name: s");
  });

  it("recreates a managed skill whose directory vanished", async () => {
    const { commons, home, target } = await setup();
    await writeCommonsSkill(commons, "s", { "SKILL.md": SKILL("s") });
    await materializeSkills({ commonsDir: commons, home, targetDir: target });
    await rm(path.join(target, "s"), { recursive: true, force: true });

    const report = await materializeSkills({
      commonsDir: commons,
      home,
      targetDir: target,
    });
    expect(report.restored).toEqual(["s"]);
    expect(await exists(path.join(target, "s", "SKILL.md"))).toBe(true);
  });

  it("removes a managed skill deleted from the commons", async () => {
    const { commons, home, target } = await setup();
    await writeCommonsSkill(commons, "s", { "SKILL.md": SKILL("s") });
    await materializeSkills({ commonsDir: commons, home, targetDir: target });
    await rm(path.join(commons, "skills", "s"), {
      recursive: true,
      force: true,
    });

    const report = await materializeSkills({
      commonsDir: commons,
      home,
      targetDir: target,
    });

    expect(report.removed).toEqual(["s"]);
    expect(await exists(path.join(target, "s"))).toBe(false);
    expect((await readSkillManifest(home)).skills.s).toBeUndefined();
  });

  it("does NOT remove a managed skill whose commons dir merely fails to parse", async () => {
    const { commons, home, target } = await setup();
    await writeCommonsSkill(commons, "s", { "SKILL.md": SKILL("s") });
    await materializeSkills({ commonsDir: commons, home, targetDir: target });
    await writeCommonsSkill(commons, "s", { "SKILL.md": "no frontmatter" });

    const report = await materializeSkills({
      commonsDir: commons,
      home,
      targetDir: target,
    });

    expect(report.removed).toEqual([]);
    expect(report.failed.map((f) => f.name)).toEqual(["s"]);
    expect(await exists(path.join(target, "s"))).toBe(true);
  });

  it("is a no-op on a second identical run", async () => {
    const { commons, home, target } = await setup();
    await writeCommonsSkill(commons, "s", { "SKILL.md": SKILL("s") });
    await materializeSkills({ commonsDir: commons, home, targetDir: target });

    const report = await materializeSkills({
      commonsDir: commons,
      home,
      targetDir: target,
    });
    expect(report).toEqual({
      materialized: [],
      updated: [],
      removed: [],
      shadowed: [],
      restored: [],
      failed: [],
    });
    expect(formatReport(report)).toBeUndefined();
  });

  it("provenance-bearing skill is stable across runs (no false restore)", async () => {
    const { commons, home, target } = await setup();
    await writeCommonsSkill(commons, "s", {
      "SKILL.md": SKILL("s"),
      ".provenance.json": PROVENANCE,
    });
    await materializeSkills({ commonsDir: commons, home, targetDir: target });

    const report = await materializeSkills({
      commonsDir: commons,
      home,
      targetDir: target,
    });
    expect(report.restored).toEqual([]);
    expect(report.updated).toEqual([]);
  });

  it("resolves with a (materialize) failure when home is unusable", async () => {
    const { commons, target } = await setup();
    await writeCommonsSkill(commons, "s", { "SKILL.md": SKILL("s") });
    const homeParent = await tmp.make();
    const homeAsFile = path.join(homeParent, "home");
    await writeFile(homeAsFile, "not a dir", "utf8");

    const report = await materializeSkills({
      commonsDir: commons,
      home: homeAsFile,
      targetDir: target,
    });
    expect(report.failed.map((f) => f.name)).toContain("(materialize)");
  });

  it("contains a per-skill copy failure without aborting the run", async () => {
    const { commons, home } = await setup();
    await writeCommonsSkill(commons, "s", { "SKILL.md": SKILL("s") });
    const targetParent = await tmp.make();
    const targetAsFile = path.join(targetParent, "skills");
    await writeFile(targetAsFile, "not a dir", "utf8");

    const report = await materializeSkills({
      commonsDir: commons,
      home,
      targetDir: targetAsFile,
    });
    expect(report.failed.map((f) => f.name)).toContain("s");
  });

  it("stamps materializedAt in the manifest", async () => {
    const { commons, home, target } = await setup();
    await writeCommonsSkill(commons, "s", { "SKILL.md": SKILL("s") });
    await materializeSkills({ commonsDir: commons, home, targetDir: target });
    const manifest = await readSkillManifest(home);
    expect(manifest.materializedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("leaves no temp directories behind", async () => {
    const { commons, home, target } = await setup();
    await writeCommonsSkill(commons, "s", { "SKILL.md": SKILL("s") });
    await materializeSkills({ commonsDir: commons, home, targetDir: target });
    const entries = await readdir(target);
    expect(entries.filter((e) => e.includes(".tmp-"))).toEqual([]);
  });

  it("format gate: touches nothing when memory.json declares a newer formatVersion", async () => {
    const { commons, home, target } = await setup();
    await writeFile(
      path.join(commons, "memory.json"),
      JSON.stringify({ formatVersion: 99 }),
      "utf8",
    );
    await writeCommonsSkill(commons, "s", { "SKILL.md": SKILL("s") });

    const report = await materializeSkills({
      commonsDir: commons,
      home,
      targetDir: target,
    });

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
