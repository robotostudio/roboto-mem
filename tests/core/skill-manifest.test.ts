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
    const manifest = {
      formatVersion: 1 as const,
      skills: { "grill-me": { hash: "abc" } },
    };
    await writeSkillManifest(home, manifest);
    expect(await readSkillManifest(home)).toEqual(manifest);
    const onDisk = await readFile(
      path.join(home, "skills-manifest.json"),
      "utf8",
    );
    expect(JSON.parse(onDisk)).toEqual(manifest);
  });

  it("returns an empty manifest when the file is missing or corrupt", async () => {
    const home = await tmp.make();
    expect(await readSkillManifest(home)).toEqual({
      formatVersion: 1,
      skills: {},
    });
    await writeFile(
      path.join(home, "skills-manifest.json"),
      "{corrupt",
      "utf8",
    );
    expect(await readSkillManifest(home)).toEqual({
      formatVersion: 1,
      skills: {},
    });
  });

  it("writeSkillManifest creates a missing home directory", async () => {
    const home = path.join(await tmp.make(), "nested", "home");
    const manifest = { formatVersion: 1 as const, skills: {} };
    await writeSkillManifest(home, manifest);
    expect(await readSkillManifest(home)).toEqual(manifest);
  });

  it("treats an array skills field as corrupt", async () => {
    const home = await tmp.make();
    await writeFile(
      path.join(home, "skills-manifest.json"),
      JSON.stringify({ formatVersion: 1, skills: [] }),
      "utf8",
    );
    expect(await readSkillManifest(home)).toEqual({
      formatVersion: 1,
      skills: {},
    });
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

  it("ignores nested .provenance.json files too", async () => {
    const a = await makeSkill({ "SKILL.md": "body" });
    const b = await makeSkill({
      "SKILL.md": "body",
      "ref/.provenance.json": "{}",
    });
    expect(await hashSkillDir(a)).toBe(await hashSkillDir(b));
  });
});
