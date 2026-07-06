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
    const noName = parseSkillFrontmatter("---\ndescription: d\n---\nbody");
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
      "SKILL.md": "---\nname: bad-prov\ndescription: d\n---\nbody",
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

  it("reports a skills dir without SKILL.md as an error and keeps it in dirNames", async () => {
    const repo = await tmp.make();
    await mkdir(path.join(repo, "skills", "half-vendored"), {
      recursive: true,
    });
    await writeFile(
      path.join(repo, "skills", "half-vendored", "notes.md"),
      "x",
      "utf8",
    );

    const load = await loadSkills(repo);
    expect(load.skills).toEqual([]);
    expect(load.dirNames).toEqual(["half-vendored"]);
    expect(load.errors).toHaveLength(1);
    expect(load.errors[0]?.error).toContain("SKILL.md");
  });
});
