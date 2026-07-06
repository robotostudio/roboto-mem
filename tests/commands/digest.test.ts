import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDigest } from "../../src/commands/digest.js";
import { saveConfig } from "../../src/core/config.js";
import { makeCommonsFixture, pushEntry } from "../helpers/git.js";
import { tmpDirFactory } from "../helpers/tmp.js";

const TODAY = "2026-06-12";

// Config that gives scopes: org, squad/web, stack/sanity, project/demo
// Fixture has:
//   entries/org/never-use-let.md        → scope org, standard
//   entries/stacks/sanity/typegen-flag.md → scope stack/sanity, lesson
//   entries/squads/web/let-hotpaths.md  → scope squad/web, standard overriding org/never-use-let
const makeConfig = (commonsUrl: string, overlays: string[] = []) => ({
  configVersion: 1 as const,
  commons: commonsUrl,
  overlays,
  project: "demo",
  squads: ["web"],
  workspaces: { ".": ["stack/sanity"] },
});

describe("digest command", () => {
  const tmp = tmpDirFactory("rm-digest-");
  afterEach(tmp.cleanup);
  const makeDir = tmp.make;

  // 1. no config + --hook → exit 0, empty output (silent no-op)
  it("no config + hook → exit 0 with empty output", async () => {
    const cwd = await makeDir();
    const home = await makeDir();
    const result = await runDigest({ cwd, home, hook: true, today: TODAY });
    expect(result.exitCode).toBe(0);
    expect(result.output).toBe("");
  });

  // 2. no config, no hook → exit 1 mentioning init
  it("no config, no hook → exit 1 mentioning init", async () => {
    const cwd = await makeDir();
    const home = await makeDir();
    const result = await runDigest({ cwd, home, today: TODAY });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("init");
  });

  // 3. happy path: output contains org standard body, sanity lesson, squad/web override pointer
  it("happy path: digest contains expected entries", async () => {
    const cwd = await makeDir();
    const tmp = await makeDir();
    const home = await makeDir();

    const fixture = await makeCommonsFixture(tmp);
    await saveConfig(cwd, makeConfig(fixture.remoteUrl));

    const result = await runDigest({ cwd, home, today: TODAY });
    expect(result.exitCode).toBe(0);
    // header present
    expect(result.output).toContain("# Team Memory");
    // org standard is suppressed — override pointer shows instead
    expect(result.output).toContain("overridden for this repo by squad/web");
    // squad/web overriding entry body appears
    expect(result.output).toContain("mutable accumulators are acceptable");
    // sanity lesson appears (lesson line format)
    expect(result.output).toContain("typegen-flag");
  });

  // 4. --hook mode: output is valid JSON envelope with SessionStart and additionalContext containing "# Team Memory"
  it("hook mode: output is JSON envelope with hookEventName SessionStart", async () => {
    const cwd = await makeDir();
    const tmp = await makeDir();
    const home = await makeDir();

    const fixture = await makeCommonsFixture(tmp);
    await saveConfig(cwd, makeConfig(fixture.remoteUrl));

    const result = await runDigest({ cwd, home, hook: true, today: TODAY });
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.output) as {
      hookSpecificOutput: {
        hookEventName: string;
        additionalContext: string;
      };
    };
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      "# Team Memory",
    );
  });

  // 5. cache file is written on happy path (fresh sync)
  it("happy path: cache file is written", async () => {
    const cwd = await makeDir();
    const tmp = await makeDir();
    const home = await makeDir();

    const fixture = await makeCommonsFixture(tmp);
    await saveConfig(cwd, makeConfig(fixture.remoteUrl));

    await runDigest({ cwd, home, today: TODAY });

    // Cache dir should exist with at least one file
    const cacheDir = path.join(home, "cache");
    const files = await fs.readdir(cacheDir);
    expect(files.length).toBeGreaterThan(0);

    // Cache file should contain the date we injected
    const cacheFile = files[0];
    if (!cacheFile) throw new Error("no cache file found");
    const cacheContent = await fs.readFile(
      path.join(cacheDir, cacheFile),
      "utf8",
    );
    const parsed = JSON.parse(cacheContent) as { date: string; digest: string };
    expect(parsed.date).toBe(TODAY);
    expect(parsed.digest).toContain("# Team Memory");
  });

  // 6. newer-format fixture after a prior successful digest → STALE line + last-good content + exit 0
  it("newer-format after prior good digest → STALE line + cached content, exit 0", async () => {
    const cwd = await makeDir();
    const tmp = await makeDir();
    const home = await makeDir();

    const fixture = await makeCommonsFixture(tmp);
    await saveConfig(cwd, makeConfig(fixture.remoteUrl));

    // First successful digest to populate cache
    const first = await runDigest({ cwd, home, today: TODAY });
    expect(first.exitCode).toBe(0);

    // Push a memory.json with formatVersion 2 (newer than supported)
    await pushEntry(
      fixture,
      "memory.json",
      JSON.stringify({ formatVersion: 2, budgets: {} }, null, 2),
    );

    // Second run — should hit stale path
    const second = await runDigest({ cwd, home, today: TODAY });
    expect(second.exitCode).toBe(0);
    expect(second.output).toContain("STALE");
    expect(second.output).toContain("/mem-upgrade");
    expect(second.output).toContain(TODAY); // cache.date
    expect(second.output).toContain("# Team Memory"); // last-good digest body
  });

  // 7. newer-format with empty cache (fresh home) → hook exit 0, advisory mentions /mem-upgrade
  it("newer-format with no cache + hook → exit 0, advisory mentions /mem-upgrade", async () => {
    const cwd = await makeDir();
    const tmp = await makeDir();
    const home = await makeDir();

    const fixture = await makeCommonsFixture(tmp);

    // Push newer-format memory.json before any clone
    await pushEntry(
      fixture,
      "memory.json",
      JSON.stringify({ formatVersion: 2, budgets: {} }, null, 2),
    );

    await saveConfig(cwd, makeConfig(fixture.remoteUrl));

    const result = await runDigest({ cwd, home, hook: true, today: TODAY });
    expect(result.exitCode).toBe(0);
    // Must be the JSON hook envelope
    const parsed = JSON.parse(result.output) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      "mem-upgrade",
    );
  });

  // 8. offline (remote disappears after clone) → digest still produced from stale clone, exit 0
  //    cache date wins over injected today when stale; cache file is NOT rewritten
  it("offline after clone → stale digest produced, exit 0, cache date wins", async () => {
    const cwd = await makeDir();
    const tmp = await makeDir();
    const home = await makeDir();

    const fixture = await makeCommonsFixture(tmp);
    await saveConfig(cwd, makeConfig(fixture.remoteUrl));

    // First run: seed the cache with today = "2026-06-10"
    const first = await runDigest({ cwd, home, today: "2026-06-10" });
    expect(first.exitCode).toBe(0);

    // Snapshot cache state before going offline
    const cacheDir = path.join(home, "cache");
    const cacheFiles = await fs.readdir(cacheDir);
    const cacheFile = cacheFiles[0];
    if (!cacheFile) throw new Error("no cache file after first run");
    const cachePath = path.join(cacheDir, cacheFile);
    const statBefore = await fs.stat(cachePath);
    const contentBefore = await fs.readFile(cachePath, "utf8");

    // Make the remote unreachable by renaming the bare dir
    const renamedBare = `${fixture.remoteUrl}_gone`;
    await fs.rename(fixture.remoteUrl, renamedBare);

    // Second run: pull fails → stale:true → still compiles from local clone
    // today = "2026-06-13" — must NOT appear in header; cache date "2026-06-10" must
    const second = await runDigest({ cwd, home, today: "2026-06-13" });
    expect(second.exitCode).toBe(0);
    expect(second.output).toContain("# Team Memory");

    // Cache date wins: header must reference the original sync date
    expect(second.output).toContain("synced 2026-06-10");
    expect(second.output).not.toContain("2026-06-13");

    // Cache file must NOT have been rewritten (mtime and content unchanged)
    const statAfter = await fs.stat(cachePath);
    expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
    const contentAfter = await fs.readFile(cachePath, "utf8");
    expect(contentAfter).toBe(contentBefore);
  });

  // 9a. overlay budget merge: overlay declared budgets win; commons budgets not clobbered by undeclared keys
  it("overlay declaredBudgets merge: overlay tiny budget triggers warning; commons org budget survives", async () => {
    const cwd = await makeDir();
    const commonsDir = await makeDir();
    const overlayDir = await makeDir();
    const home = await makeDir();

    // Build commons fixture
    const commonsFixture = await makeCommonsFixture(commonsDir);

    // Build overlay fixture — separate bare+workdir
    const overlayFixture = await makeCommonsFixture(overlayDir);

    // Replace overlay memory.json: only declares stack/sanity budget (tiny = 1 to force warning)
    // This must NOT declare default or org — so commons' org:4000 and default:2000 must survive
    await pushEntry(
      overlayFixture,
      "memory.json",
      JSON.stringify(
        { formatVersion: 1, budgets: { "stack/sanity": 1 } },
        null,
        2,
      ),
    );
    // Add a unique overlay entry that won't conflict with commons entries
    await pushEntry(
      overlayFixture,
      "entries/stacks/sanity/overlay-lesson.md",
      `---
description: Overlay-specific lesson for sanity stack
type: lesson
author: hrithik
date: 2026-06-11
---
This lesson comes exclusively from the overlay repo.`,
    );

    await saveConfig(
      cwd,
      makeConfig(commonsFixture.remoteUrl, [overlayFixture.remoteUrl]),
    );

    const result = await runDigest({ cwd, home, today: TODAY });
    expect(result.exitCode).toBe(0);

    // Overlay entry must appear in digest
    expect(result.output).toContain("overlay-lesson");

    // stack/sanity budget = 1 from overlay → must produce a budget warning
    expect(result.output).toMatch(/stack\/sanity/);
    expect(result.output).toMatch(/budget/i);
  });

  // 9b. invalid config + hook → exit 0, valid JSON envelope, context mentions the problem
  it("invalid config + hook → exit 0, valid JSON envelope mentioning the problem", async () => {
    const cwd = await makeDir();
    const home = await makeDir();

    // Write a broken config (missing required fields)
    await fs.writeFile(
      path.join(cwd, ".roboto-mem.json"),
      JSON.stringify({ configVersion: 1, commons: "git@x:y/z.git" }),
      "utf8",
    );

    const result = await runDigest({ cwd, home, hook: true, today: TODAY });
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.output) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    // Should mention the config problem
    expect(parsed.hookSpecificOutput.additionalContext).toMatch(
      /invalid|config/i,
    );
  });

  // 10. blocked cache dir + happy-path config + hook → exit 0, JSON envelope with "# Team Memory"
  it("blocked cache dir + hook → exit 0, digest still in additionalContext", async () => {
    const cwd = await makeDir();
    const tmp2 = await makeDir();
    const home = await makeDir();

    const fixture = await makeCommonsFixture(tmp2);
    await saveConfig(cwd, makeConfig(fixture.remoteUrl));

    // Block the cache dir by placing a FILE where writeCache would mkdir
    await fs.writeFile(path.join(home, "cache"), "i am a file not a dir");

    const result = await runDigest({ cwd, home, hook: true, today: TODAY });
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.output) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      "# Team Memory",
    );
  });

  // 11. directory-as-config + hook → exit 0, valid JSON envelope mentioning unreadable
  it("directory-as-config + hook → exit 0, valid JSON envelope mentioning unreadable", async () => {
    const cwd = await makeDir();
    const home = await makeDir();

    // Put a DIRECTORY at the config file path (triggers EISDIR on readFile)
    await fs.mkdir(path.join(cwd, ".roboto-mem.json"));

    const result = await runDigest({ cwd, home, hook: true, today: TODAY });
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.output) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(parsed.hookSpecificOutput.additionalContext).toMatch(/unreadable/i);
  });

  // 12. skills: warns on drift-restore at session start, stays silent otherwise
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
    await saveConfig(cwd, makeConfig(fixture.remoteUrl));

    const first = await runDigest({
      cwd,
      home,
      skillsTargetDir: target,
      today: TODAY,
    });
    expect(first.exitCode).toBe(0);
    expect(first.output).not.toContain("team skill");

    await fs.writeFile(
      path.join(target, "grill-me", "SKILL.md"),
      "local edits",
      "utf8",
    );

    const second = await runDigest({
      cwd,
      home,
      skillsTargetDir: target,
      today: TODAY,
    });
    expect(second.exitCode).toBe(0);
    expect(second.output).toContain(
      "> WARNING: team skill grill-me: restored — local edits were replaced",
    );
  });
});
