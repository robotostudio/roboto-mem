import { mkdir, symlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runLint } from "../../src/commands/lint.js";
import {
  type CommonsFixture,
  makeCommonsFixture,
  pushEntry,
} from "../helpers/git.js";
import { tmpDirFactory } from "../helpers/tmp.js";

describe("lint command", () => {
  const tmp = tmpDirFactory("rm-lint-");
  afterEach(tmp.cleanup);

  const makeFixture = async (): Promise<CommonsFixture> =>
    makeCommonsFixture(await tmp.make());

  const makeTmp = tmp.make;

  // 1. clean fixture -> exit 0, checkmark 3 entries
  it("clean fixture exits 0 with entry count", async () => {
    const fixture = await makeFixture();
    const result = await runLint({ dir: fixture.workdir });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("✓ 3 entries");
  });

  // 2. invalid frontmatter entry -> exit 1, finding names the file
  it("parse error: missing description -> exit 1, finding mentions file", async () => {
    const fixture = await makeFixture();
    await pushEntry(
      fixture,
      "entries/org/broken.md",
      `---
type: standard
author: hrithik
date: 2026-06-01
---
Body text here.`,
    );
    const result = await runLint({ dir: fixture.workdir });
    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/broken\.md/);
  });

  // 3. unresolved override -> exit 1, "not found"
  it("unresolved override ref -> exit 1 with not found finding", async () => {
    const fixture = await makeFixture();
    await pushEntry(
      fixture,
      "entries/org/my-rule.md",
      `---
description: A rule that overrides nothing
type: standard
author: hrithik
date: 2026-06-01
overrides: org/does-not-exist
---
Body.`,
    );
    const result = await runLint({ dir: fixture.workdir });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("not found");
  });

  // 4. override target is a lesson -> exit 1 "is a lesson"
  it("override target is a lesson -> exit 1 with lesson finding", async () => {
    const fixture = await makeFixture();
    // stacks/sanity/typegen-flag.md is type:lesson in the fixture
    await pushEntry(
      fixture,
      "entries/org/my-override.md",
      `---
description: Overriding a lesson
type: standard
author: hrithik
date: 2026-06-01
overrides: stack/sanity/typegen-flag
---
Body.`,
    );
    const result = await runLint({ dir: fixture.workdir });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("is a lesson");
  });

  // 5. lesson declaring overrides -> exit 1 "only standards"
  it("lesson with overrides field -> exit 1 only standards can declare overrides", async () => {
    const fixture = await makeFixture();
    await pushEntry(
      fixture,
      "entries/org/lesson-override.md",
      `---
description: A lesson that tries to override
type: lesson
author: hrithik
date: 2026-06-01
overrides: org/never-use-let
---
Body.`,
    );
    const result = await runLint({ dir: fixture.workdir });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("only standards");
  });

  // 6. bad override ref format -> exit 1, finding mentions "override" and the bad ref text
  it("bad override ref format -> exit 1 with finding mentioning override and bad ref", async () => {
    const fixture = await makeFixture();
    await pushEntry(
      fixture,
      "entries/org/bad-ref.md",
      `---
description: Bad override ref
type: standard
author: hrithik
date: 2026-06-01
overrides: nonsense
---
Body.`,
    );
    const result = await runLint({ dir: fixture.workdir });
    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/override/i);
    expect(result.output).toContain("nonsense");
  });

  // 7. budget exceeded -> exit 1, finding mentions a scope
  it("budget exceeded -> exit 1 with scope budget finding", async () => {
    const fixture = await makeFixture();
    // overwrite memory.json with a very tight budget via pushEntry
    await pushEntry(
      fixture,
      "memory.json",
      JSON.stringify(
        { formatVersion: 1, budgets: { default: 10, org: 10 } },
        null,
        2,
      ),
    );
    const result = await runLint({ dir: fixture.workdir });
    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/exceeds its budget/);
    expect(result.output).toMatch(/\bscope\b/);
  });

  // 8. secret in body -> exit 1, finding includes rule name + redacted match, full key absent
  it("aws access key in body -> exit 1 with aws-access-key finding, key redacted", async () => {
    const fixture = await makeFixture();
    await pushEntry(
      fixture,
      "entries/org/secret-entry.md",
      `---
description: Entry with a secret
type: standard
author: hrithik
date: 2026-06-01
---
Do not use this key: AKIAIOSFODNN7EXAMPLE`,
    );
    const result = await runLint({ dir: fixture.workdir });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("aws-access-key");
    // match is redacted -- full key must not appear
    expect(result.output).not.toContain("AKIAIOSFODNN7EXAMPLE");
    // redacted prefix should appear
    expect(result.output).toContain("AKIAIO");
  });

  // 9. email-only warning -> exit 0, warnings section present
  it("email in body -> exit 0 but warnings section present", async () => {
    const fixture = await makeFixture();
    await pushEntry(
      fixture,
      "entries/org/email-entry.md",
      `---
description: Entry with an email address
type: standard
author: hrithik
date: 2026-06-01
---
Contact support@example.com for help.`,
    );
    const result = await runLint({ dir: fixture.workdir });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("warnings:");
  });

  // 10. missing manifest (empty dir) -> exit 1, single finding
  it("missing manifest -> exit 1 with single finding", async () => {
    const tmp = await makeTmp();
    const result = await runLint({ dir: tmp });
    expect(result.exitCode).toBe(1);
    const lines = result.output.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("memory.json");
  });

  // Helper for creating skills alongside entries
  const writeManifestAndSkill = async (
    dir: string,
    skillDir: string,
    skillMd: string,
  ): Promise<void> => {
    await writeFile(
      path.join(dir, "memory.json"),
      JSON.stringify({
        formatVersion: 1,
        budgets: { default: 2000, org: 4000 },
      }),
      "utf8",
    );
    await mkdir(path.join(dir, "skills", skillDir), { recursive: true });
    await writeFile(
      path.join(dir, "skills", skillDir, "SKILL.md"),
      skillMd,
      "utf8",
    );
  };

  it("skills: valid skill counts in the summary", async () => {
    const dir = await makeTmp();
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
    const dir = await makeTmp();
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

  it("skills: a symlink inside a skill dir fails the lint", async () => {
    const dir = await makeTmp();
    await writeManifestAndSkill(
      dir,
      "sneaky",
      "---\nname: sneaky\ndescription: d\n---\nbody",
    );
    await symlink("/etc", path.join(dir, "skills", "sneaky", "escape"));

    const result = await runLint({ dir });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("symbolic link");
  });

  it("skills: secrets are scanned even when the skill fails validation", async () => {
    const dir = await makeTmp();
    await writeManifestAndSkill(dir, "broken", "no frontmatter at all");
    await writeFile(
      path.join(dir, "skills", "broken", "notes.md"),
      `token: "ghp_${"b".repeat(36)}"`,
      "utf8",
    );

    const result = await runLint({ dir });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("skills/broken/notes.md");
    expect(result.output).toContain("github-token");
  });

  it("skills: warning-severity findings land in the warnings section on exit 0", async () => {
    const dir = await makeTmp();
    await writeManifestAndSkill(
      dir,
      "mailer",
      "---\nname: mailer\ndescription: d\n---\ncontact hrithik@example.com for access",
    );

    const result = await runLint({ dir });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("warnings:");
    expect(result.output).toContain("skills/mailer/SKILL.md");
    expect(result.output).toContain("[email]");
  });

  it("skills and entries combined summary format", async () => {
    const fixture = await makeFixture();
    // Add one skill to the fixture
    await mkdir(path.join(fixture.workdir, "skills", "grill-me"), {
      recursive: true,
    });
    await writeFile(
      path.join(fixture.workdir, "skills", "grill-me", "SKILL.md"),
      "---\nname: grill-me\ndescription: d\n---\nbody",
      "utf8",
    );

    const result = await runLint({ dir: fixture.workdir });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("✓ 3 entries, 1 skills, 0 problems");
  });
});
