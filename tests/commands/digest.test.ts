import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDigest } from "../../src/commands/digest.js";
import { runSync } from "../../src/commands/sync.js";
import { saveConfig } from "../../src/core/config.js";
import { ensureRepo, repoDirFor } from "../../src/core/memory-repo.js";
import {
  makeCommonsFixture,
  makeV2CommonsFixture,
  pushEntry,
} from "../helpers/git.js";
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

// Global library model (Phase 6): the digest hook no longer clones/pulls —
// it only reads whatever a prior `roboto-mem sync` (or `init`) left on disk.
// Tests that need entries to actually load must sync the fixture into
// `home` themselves first, exactly like a real user would before their
// first session. See docs/design-specs/2026-07-17-global-library-model.md.
const sync = async (url: string, home: string): Promise<void> => {
  const result = await ensureRepo(url, home);
  if (!result.ok)
    throw new Error(`test setup: ensureRepo failed: ${result.error}`);
};

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
    await sync(fixture.remoteUrl, home);

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
    await sync(fixture.remoteUrl, home);

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
    await sync(fixture.remoteUrl, home);

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
    await sync(fixture.remoteUrl, home);

    // First successful digest to populate cache
    const first = await runDigest({ cwd, home, today: TODAY });
    expect(first.exitCode).toBe(0);

    // Push a memory.json with formatVersion 3 (newer than supported), then
    // sync it locally — the hook itself never pulls, so without this the
    // second run would just see the same (still-valid) clone as the first.
    await pushEntry(
      fixture,
      "memory.json",
      JSON.stringify({ formatVersion: 3, budgets: {} }, null, 2),
    );
    await sync(fixture.remoteUrl, home);

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

    // Push newer-format memory.json, then sync it locally — no digest has
    // run yet, so there is no cache (the hook itself no longer clones/pulls).
    await pushEntry(
      fixture,
      "memory.json",
      JSON.stringify({ formatVersion: 3, budgets: {} }, null, 2),
    );
    await sync(fixture.remoteUrl, home);

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

  // 7b. v2-shaped project config (configVersion 2 + commons + libraries, no v1
  // fields) with a synced v2 commons → a freshly `init`ed v2 project must get
  // a live digest (global entries always apply; library-scoped entries only
  // for declared libraries), not the v1 loader's permanent "newer-config"
  // stale fallback. See global library model spec, "new CLI × v2 config × v2
  // commons (works)" success criterion.
  it("v2 config (configVersion 2 + libraries) with synced v2 commons → live digest with global + declared-library entries", async () => {
    const cwd = await makeDir();
    const tmp = await makeDir();
    const home = await makeDir();

    const fixture = await makeV2CommonsFixture(tmp);
    await pushEntry(
      fixture,
      "entries/decision-framework.md",
      `---
description: Global decision framework
type: standard
author: hrithik
date: 2026-06-01
---
Always weigh reversibility before committing.`,
    );
    await pushEntry(
      fixture,
      "entries/resend-templates.md",
      `---
description: Resend email templates
type: standard
author: hrithik
date: 2026-06-01
scope: library:resend
---
Use the shared template partials.`,
    );
    await pushEntry(
      fixture,
      "entries/sanity-typegen.md",
      `---
description: Sanity typegen flag
type: lesson
author: hrithik
date: 2026-06-01
scope: library:sanity
---
Undeclared library — must not appear in the digest.`,
    );

    await fs.writeFile(
      path.join(cwd, ".roboto-mem.json"),
      JSON.stringify({
        configVersion: 2,
        commons: fixture.remoteUrl,
        libraries: ["resend"],
      }),
      "utf8",
    );
    await sync(fixture.remoteUrl, home);

    const result = await runDigest({ cwd, home, today: TODAY });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("decision-framework");
    expect(result.output).toContain("resend-templates");
    expect(result.output).not.toContain("sanity-typegen");
  });

  // 7c. v2-shaped project config with no prior `roboto-mem sync` → the hook
  // never touches the network (same network-free contract as v1), so it
  // reports the same "run roboto-mem sync" advisory a v1 project would get
  // from an un-synced commons, exit 0.
  it("v2 config with no prior sync + hook → exit 0, advisory to run roboto-mem sync", async () => {
    const cwd = await makeDir();
    const home = await makeDir();

    await fs.writeFile(
      path.join(cwd, ".roboto-mem.json"),
      JSON.stringify({
        configVersion: 2,
        commons: "git@github.com:team/commons.git",
        libraries: ["resend"],
      }),
      "utf8",
    );

    const result = await runDigest({ cwd, home, hook: true, today: TODAY });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.output) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      "roboto-mem sync",
    );
  });

  // 8. offline (remote disappears after a prior sync) → the hook never
  //    touches the network, so digest still succeeds reading the local
  //    clone. Each run's header reflects its own injected `today` (there is
  //    no live pull to mark stale), and the cache is refreshed every run.
  it("offline after sync → digest still succeeds from the local clone (hook never touches network)", async () => {
    const cwd = await makeDir();
    const tmp = await makeDir();
    const home = await makeDir();

    const fixture = await makeCommonsFixture(tmp);
    await saveConfig(cwd, makeConfig(fixture.remoteUrl));
    await sync(fixture.remoteUrl, home);

    // First run: seed the cache with today = "2026-06-10"
    const first = await runDigest({ cwd, home, today: "2026-06-10" });
    expect(first.exitCode).toBe(0);
    expect(first.output).toContain("synced 2026-06-10");

    // Make the remote unreachable by renaming the bare dir — the hook must
    // not care, since it never attempts to reach it.
    const renamedBare = `${fixture.remoteUrl}_gone`;
    await fs.rename(fixture.remoteUrl, renamedBare);

    const second = await runDigest({ cwd, home, today: "2026-06-13" });
    expect(second.exitCode).toBe(0);
    expect(second.output).toContain("# Team Memory");
    expect(second.output).toContain("synced 2026-06-13");

    // Cache reflects the latest successful run.
    const cacheDir = path.join(home, "cache");
    const cacheFiles = await fs.readdir(cacheDir);
    const cacheFile = cacheFiles[0];
    if (!cacheFile) throw new Error("no cache file after second run");
    const cacheContent = JSON.parse(
      await fs.readFile(path.join(cacheDir, cacheFile), "utf8"),
    ) as { date: string; digest: string };
    expect(cacheContent.date).toBe("2026-06-13");
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
    await sync(commonsFixture.remoteUrl, home);
    await sync(overlayFixture.remoteUrl, home);

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
    await sync(fixture.remoteUrl, home);

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

  // 12. skills: the hook no longer materializes or restores team skills at
  // all (global library model Phase 6 — moved to manual `roboto-mem sync`).
  // Drift left by a prior sync must survive a digest run untouched; sync
  // remains the only thing that restores it.
  it("skills: hook never materializes/restores team skills — only sync does", async () => {
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

    // Materialize the skill via sync (unaffected by this phase's change).
    const synced = await runSync({ cwd, home, skillsTargetDir: target });
    expect(synced.exitCode).toBe(0);

    // Drift the materialized copy.
    await fs.writeFile(
      path.join(target, "grill-me", "SKILL.md"),
      "local edits",
      "utf8",
    );

    // digest --hook has no skillsTargetDir option and no longer touches
    // skills at all — the drifted file, and the digest output, stay untouched.
    const digestResult = await runDigest({
      cwd,
      home,
      hook: true,
      today: TODAY,
    });
    expect(digestResult.exitCode).toBe(0);
    expect(digestResult.output).not.toMatch(/skill/i);
    const stillDrifted = await fs.readFile(
      path.join(target, "grill-me", "SKILL.md"),
      "utf8",
    );
    expect(stillDrifted).toBe("local edits");

    // Backward-compat: sync still restores drift on demand.
    const resynced = await runSync({ cwd, home, skillsTargetDir: target });
    expect(resynced.exitCode).toBe(0);
    expect(resynced.output).toContain("restored: grill-me");
    const restored = await fs.readFile(
      path.join(target, "grill-me", "SKILL.md"),
      "utf8",
    );
    expect(restored).toContain("team body");
  });

  // 13. v1 config bound but never synced → hook is not silent (unlike "no
  // config"): it surfaces an informative, non-crashing message telling the
  // user to sync, and it must not have attempted any clone itself.
  it("v1 config, never synced + hook → exit 0, informative message, no clone attempted", async () => {
    const cwd = await makeDir();
    const tmp = await makeDir();
    const home = await makeDir();

    const fixture = await makeCommonsFixture(tmp);
    await saveConfig(cwd, makeConfig(fixture.remoteUrl));

    const result = await runDigest({ cwd, home, hook: true, today: TODAY });
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.output) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(parsed.hookSpecificOutput.additionalContext).toMatch(
      /not synced|roboto-mem sync/i,
    );

    // The hook must not have cloned anything itself.
    const cloneDir = repoDirFor(fixture.remoteUrl, home);
    await expect(fs.access(cloneDir)).rejects.toThrow();
  });

  // 14. Same "never synced" state, but through the direct (non-hook) CLI
  // path — exit 1, same informative message, same no-clone guarantee.
  it("v1 config, never synced, no hook → exit 1, mentions sync, no clone attempted", async () => {
    const cwd = await makeDir();
    const tmp = await makeDir();
    const home = await makeDir();

    const fixture = await makeCommonsFixture(tmp);
    await saveConfig(cwd, makeConfig(fixture.remoteUrl));

    const result = await runDigest({ cwd, home, today: TODAY });
    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/not synced|roboto-mem sync/i);

    const cloneDir = repoDirFor(fixture.remoteUrl, home);
    await expect(fs.access(cloneDir)).rejects.toThrow();
  });
});
