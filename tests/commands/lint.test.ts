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
});
