import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDigest } from "../../src/commands/digest.js";
import { runInit } from "../../src/commands/init.js";
import { runLint } from "../../src/commands/lint.js";
import { runPromote } from "../../src/commands/promote.js";
import { runStatus } from "../../src/commands/status.js";
import { runSync } from "../../src/commands/sync.js";
import type { ExecResult } from "../../src/core/exec.js";
import { exec } from "../../src/core/exec.js";
import { makeCommonsFixture, pushEntry } from "../helpers/git.js";

describe("e2e integration", () => {
  const dirs: string[] = [];

  const makeDir = async (): Promise<string> => {
    const d = await fs.mkdtemp(path.join(os.tmpdir(), "rm-e2e-"));
    dirs.push(d);
    return d;
  };

  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
    );
  });

  // ─── Test 1: full team-memory loop ──────────────────────────────────────────

  it("full team-memory loop", async () => {
    const tmp = await makeDir();
    const dir = await makeDir();
    const home = await makeDir();

    // Step 1: make a commons fixture (org standard, stack/sanity lesson, squad/web override)
    const fixture = await makeCommonsFixture(tmp);

    // Step 2: build a consuming monorepo fixture dir
    //   package.json with workspaces ["apps/*"]
    //   apps/web: next + react  → stack/nextjs, stack/react
    //   apps/studio: sanity     → stack/sanity
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "demo-mono", workspaces: ["apps/*"] }, null, 2),
      "utf8",
    );
    await fs.mkdir(path.join(dir, "apps", "web"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "apps", "web", "package.json"),
      JSON.stringify(
        { name: "web", dependencies: { next: "14.0.0", react: "18.0.0" } },
        null,
        2,
      ),
      "utf8",
    );
    await fs.mkdir(path.join(dir, "apps", "studio"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "apps", "studio", "package.json"),
      JSON.stringify(
        { name: "studio", dependencies: { sanity: "3.0.0" } },
        null,
        2,
      ),
      "utf8",
    );

    // Step 3: runInit → exit 0, workspaces detected both apps
    const initResult = await runInit({
      dir,
      commonsUrl: fixture.remoteUrl,
      project: "demo",
      squads: ["web"],
    });
    expect(initResult.exitCode).toBe(0);

    // Verify .roboto-mem.json was written and workspaces detected both apps
    const { loadConfig } = await import("../../src/core/config.js");
    const configResult = await loadConfig(dir);
    expect(configResult.ok).toBe(true);
    if (!configResult.ok) throw new Error("config load failed");
    const cfg = configResult.config;
    expect(cfg.project).toBe("demo");
    expect(cfg.squads).toContain("web");
    // Both workspace dirs must be detected
    const wsKeys = Object.keys(cfg.workspaces);
    expect(wsKeys).toContain("apps/web");
    expect(wsKeys).toContain("apps/studio");

    // Step 3b: sync — the digest hook no longer clones/pulls on its own
    // (global library model Phase 6), so a real user's first session
    // depends on init/sync having already populated the local clone.
    const syncResult = await runSync({ cwd: dir, home });
    expect(syncResult.exitCode).toBe(0);

    // Step 4: runDigest hook mode
    const digest1 = await runDigest({
      cwd: dir,
      hook: true,
      home,
      today: "2026-06-12",
    });
    expect(digest1.exitCode).toBe(0);

    const envelope1 = JSON.parse(digest1.output) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(envelope1.hookSpecificOutput.hookEventName).toBe("SessionStart");

    const ctx1 = envelope1.hookSpecificOutput.additionalContext;

    // Must contain Team Memory header
    expect(ctx1).toContain("# Team Memory");

    // Squad/web override: squad/web header present
    expect(ctx1).toContain("[squad/web]");

    // The org/never-use-let entry is suppressed — pointer line present
    expect(ctx1).toContain(
      "org/never-use-let is overridden for this repo by squad/web",
    );

    // The sanity lesson index line must be present
    expect(ctx1).toContain("typegen-flag");

    // Must NOT contain shopify content
    expect(ctx1).not.toContain("shopify");
    expect(ctx1).not.toContain("@shopify");

    // Step 5: push a new org lesson, re-sync (the hook itself never pulls),
    // then runDigest again → new lesson appears.
    await pushEntry(
      fixture,
      "entries/org/prefer-const.md",
      `---
description: Prefer const over let everywhere
type: lesson
author: hrithik
date: 2026-06-12
---
Always declare variables with const. Use ternary or reduce instead of reassignment.`,
    );
    expect((await runSync({ cwd: dir, home })).exitCode).toBe(0);

    const digest2 = await runDigest({
      cwd: dir,
      hook: true,
      home,
      today: "2026-06-12",
    });
    expect(digest2.exitCode).toBe(0);

    const envelope2 = JSON.parse(digest2.output) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    const ctx2 = envelope2.hookSpecificOutput.additionalContext;
    expect(ctx2).toContain("prefer-const");

    // Step 6: runPromote
    const ghArgs: string[][] = [];
    const ghStub = async (
      args: string[],
      _cwd: string,
    ): Promise<ExecResult> => {
      ghArgs.push(args);
      return { ok: true, stdout: "https://example.test/pr/1" };
    };

    const promoteResult = await runPromote({
      cwd: dir,
      home,
      scope: "stack/sanity",
      type: "lesson",
      name: "e2e-promoted",
      description: "e2e promoted lesson",
      body: "Found during e2e.",
      author: "hrithik",
      date: "2026-06-12",
      ghRunner: ghStub,
    });
    expect(promoteResult.exitCode).toBe(0);
    expect(promoteResult.output).toContain("https://example.test/pr/1");

    // Branch must exist on the bare remote
    const lsRemote = await exec("git", [
      "ls-remote",
      fixture.remoteUrl,
      "refs/heads/promote/stack-sanity-e2e-promoted",
    ]);
    expect(lsRemote.ok).toBe(true);
    if (lsRemote.ok) {
      expect(lsRemote.stdout).toMatch(
        /refs\/heads\/promote\/stack-sanity-e2e-promoted/,
      );
    }

    // Step 7: runLint on the fixture workdir
    // The fixture workdir has: org/never-use-let, stacks/sanity/typegen-flag,
    //   squads/web/let-hotpaths, plus the pushed org/prefer-const = 4 entries
    const lintResult = await runLint({ dir: fixture.workdir });
    expect(lintResult.exitCode).toBe(0);
    expect(lintResult.output).toContain("✓");

    // Step 8: runStatus
    const statusResult = await runStatus({ cwd: dir, home });
    expect(statusResult.exitCode).toBe(0);
    expect(statusResult.output).toContain("demo");
    // Entry counts appear: standards + lessons
    expect(statusResult.output).toMatch(/\d+ standards?/);
    expect(statusResult.output).toMatch(/\d+ lessons?/);
  });

  // ─── Test 2: stale fallback loop ────────────────────────────────────────────

  it("stale fallback loop", async () => {
    const tmp = await makeDir();
    const dir = await makeDir();
    const home = await makeDir();

    const fixture = await makeCommonsFixture(tmp);

    // Bind the consuming project, then sync — the digest hook no longer
    // clones/pulls on its own (global library model Phase 6).
    await runInit({
      dir,
      commonsUrl: fixture.remoteUrl,
      project: "demo",
      squads: ["web"],
    });
    expect((await runSync({ cwd: dir, home })).exitCode).toBe(0);

    // First digest: today "2026-06-10" → seeds cache
    const first = await runDigest({
      cwd: dir,
      hook: true,
      home,
      today: "2026-06-10",
    });
    expect(first.exitCode).toBe(0);

    // Push a memory.json with formatVersion 3 (newer than supported), then
    // re-sync so the local clone actually picks it up (the hook itself
    // never pulls).
    await pushEntry(
      fixture,
      "memory.json",
      JSON.stringify({ formatVersion: 3, budgets: {} }, null, 2),
    );
    expect((await runSync({ cwd: dir, home })).exitCode).toBe(0);

    // Second digest: today "2026-06-13" → stale path: must use cached digest from 2026-06-10
    const second = await runDigest({
      cwd: dir,
      hook: true,
      home,
      today: "2026-06-13",
    });
    expect(second.exitCode).toBe(0);

    const envelope = JSON.parse(second.output) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    const ctx = envelope.hookSpecificOutput.additionalContext;

    // Must start with "> STALE:"
    expect(ctx.startsWith("> STALE:")).toBe(true);

    // Must contain the last-good cache date
    expect(ctx).toContain("2026-06-10");
  });
});
