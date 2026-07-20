import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runPromoteLibrary } from "../../src/commands/promote-library.js";
import { CONFIG_FILE } from "../../src/core/config.js";
import type { ExecResult } from "../../src/core/exec.js";
import { exec } from "../../src/core/exec.js";
import { makeV2CommonsFixture } from "../helpers/git.js";
import { tmpDirFactory } from "../helpers/tmp.js";

const ghStubFactory = (): {
  calls: string[][];
  run: (a: string[], c: string) => Promise<ExecResult>;
} => {
  const calls: string[][] = [];
  return {
    calls,
    run: async (args: string[], _cwd: string): Promise<ExecResult> => {
      calls.push(args);
      return {
        ok: true,
        stdout: "https://github.com/roboto/team-memory/pull/9",
      };
    },
  };
};

const writeLocalLibrary = async (
  librariesRoot: string,
  name: string,
  files: Record<string, string>,
): Promise<void> => {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(librariesRoot, name, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
  }
};

describe("runPromoteLibrary", () => {
  const tmp = tmpDirFactory("rm-promote-library-");
  afterEach(tmp.cleanup);
  const makeDir = tmp.make;

  it("promotes a brand-new library: branch pushed, commit message carries the dir hash, gh called", async () => {
    const fixture = await makeV2CommonsFixture(await makeDir(), {});
    const home = await makeDir();
    const librariesRoot = await makeDir();
    await writeLocalLibrary(librariesRoot, "resend", {
      "LIBRARY.md": "# Resend\nSummary.",
      "docs/setup.md": "Setup guide.",
    });
    const gh = ghStubFactory();

    const result = await runPromoteLibrary({
      cwd: await makeDir(),
      name: "resend",
      commonsUrl: fixture.remoteUrl,
      author: "hrithik",
      date: "2026-07-17",
      home,
      librariesRoot,
      ghRunner: gh.run,
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("pull/9");

    const lsRemote = await exec("git", [
      "ls-remote",
      fixture.remoteUrl,
      "refs/heads/library/resend",
    ]);
    expect(lsRemote.ok && lsRemote.stdout).toMatch(/library\/resend/);

    const title = gh.calls[0] ?? [];
    expect(title[title.indexOf("--title") + 1]).toBe(
      "chore: promote library resend",
    );
    const body = title[title.indexOf("--body") + 1] ?? "";
    expect(body).toContain("added");
    expect(body).toContain("LIBRARY.md");
  });

  it("re-promoting after a local edit: update path when changed, no-op when identical", async () => {
    const fixture = await makeV2CommonsFixture(await makeDir(), {});
    const home = await makeDir();
    const librariesRoot = await makeDir();
    await writeLocalLibrary(librariesRoot, "resend", {
      "LIBRARY.md": "v1",
    });
    const gh = ghStubFactory();
    const opts = {
      cwd: await makeDir(),
      name: "resend",
      commonsUrl: fixture.remoteUrl,
      author: "hrithik",
      date: "2026-07-17",
      home,
      librariesRoot,
      ghRunner: gh.run,
    };

    expect((await runPromoteLibrary(opts)).exitCode).toBe(0);

    // "review + merge" the first PR so the library exists on main
    const worktree = await makeDir();
    await exec("git", ["clone", fixture.remoteUrl, worktree]);
    await exec("git", ["config", "user.email", "t@e.com"], { cwd: worktree });
    await exec("git", ["config", "user.name", "T"], { cwd: worktree });
    await exec("git", ["fetch", "origin", "library/resend"], { cwd: worktree });
    await exec("git", ["merge", "origin/library/resend", "--no-edit"], {
      cwd: worktree,
    });
    await exec("git", ["push", "origin", "main"], { cwd: worktree });

    // identical local copy → nothing to submit
    const noop = await runPromoteLibrary(opts);
    expect(noop.exitCode).toBe(0);
    expect(noop.output).toContain("already up to date");

    // local edit → update path, PR body reflects the change
    await writeLocalLibrary(librariesRoot, "resend", { "LIBRARY.md": "v2" });
    const updated = await runPromoteLibrary(opts);
    expect(updated.exitCode).toBe(0);
    expect(updated.output).toContain("pull/9");

    await exec("git", ["fetch", "origin", "library/resend"], {
      cwd: worktree,
    });
    await exec("git", ["checkout", "origin/library/resend", "--", "."], {
      cwd: worktree,
    });
    const onBranch = await readFile(
      path.join(worktree, "libraries", "resend", "LIBRARY.md"),
      "utf8",
    );
    expect(onBranch).toBe("v2");

    const lastCall = gh.calls.at(-1) ?? [];
    const body = lastCall[lastCall.indexOf("--body") + 1] ?? "";
    expect(body).toContain("changed");
  });

  it("re-promoting before the first PR merges updates the existing remote branch (no non-fast-forward)", async () => {
    const fixture = await makeV2CommonsFixture(await makeDir(), {});
    const home = await makeDir();
    const librariesRoot = await makeDir();
    await writeLocalLibrary(librariesRoot, "resend", { "LIBRARY.md": "v1" });
    const gh = ghStubFactory();
    const opts = {
      cwd: await makeDir(),
      name: "resend",
      commonsUrl: fixture.remoteUrl,
      author: "hrithik",
      date: "2026-07-17",
      home,
      librariesRoot,
      ghRunner: gh.run,
    };

    // First promote pushes library/resend to the remote.
    expect((await runPromoteLibrary(opts)).exitCode).toBe(0);

    // WITHOUT merging that PR, edit locally and promote again — the second
    // push must fast-forward the existing remote branch, not fork from main
    // (which would be rejected as non-fast-forward).
    await writeLocalLibrary(librariesRoot, "resend", { "LIBRARY.md": "v2" });
    const second = await runPromoteLibrary(opts);
    expect(second.exitCode).toBe(0);
    expect(second.output).toContain("pull/9");

    // The existing remote branch now carries v2.
    const worktree = await makeDir();
    await exec("git", [
      "clone",
      "--branch",
      "library/resend",
      fixture.remoteUrl,
      worktree,
    ]);
    const onBranch = await readFile(
      path.join(worktree, "libraries", "resend", "LIBRARY.md"),
      "utf8",
    );
    expect(onBranch).toBe("v2");
  });

  it("fails when no local library exists at librariesRoot/<name>", async () => {
    const fixture = await makeV2CommonsFixture(await makeDir(), {});
    const result = await runPromoteLibrary({
      cwd: await makeDir(),
      name: "resend",
      commonsUrl: fixture.remoteUrl,
      author: "hrithik",
      date: "2026-07-17",
      home: await makeDir(),
      librariesRoot: await makeDir(),
      ghRunner: ghStubFactory().run,
    });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("No local library");
    expect(result.output).toContain("roboto-mem sync");
  });

  it("falls back to the v2 project config's commons when --commons-url is omitted", async () => {
    const fixture = await makeV2CommonsFixture(await makeDir(), {});
    const home = await makeDir();
    const librariesRoot = await makeDir();
    await writeLocalLibrary(librariesRoot, "resend", { "LIBRARY.md": "hi" });
    const cwd = await makeDir();
    await writeFile(
      path.join(cwd, CONFIG_FILE),
      `${JSON.stringify(
        { configVersion: 2, commons: fixture.remoteUrl, libraries: ["resend"] },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = await runPromoteLibrary({
      cwd,
      name: "resend",
      author: "hrithik",
      date: "2026-07-17",
      home,
      librariesRoot,
      ghRunner: ghStubFactory().run,
    });

    expect(result.exitCode).toBe(0);
  });

  it("fails with a clear message when neither --commons-url nor a v2 config is available", async () => {
    const home = await makeDir();
    const librariesRoot = await makeDir();
    await writeLocalLibrary(librariesRoot, "resend", { "LIBRARY.md": "hi" });

    const result = await runPromoteLibrary({
      cwd: await makeDir(),
      name: "resend",
      author: "hrithik",
      date: "2026-07-17",
      home,
      librariesRoot,
      ghRunner: ghStubFactory().run,
    });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("--commons-url");
  });

  it("rejects an empty author before touching git", async () => {
    const result = await runPromoteLibrary({
      cwd: await makeDir(),
      name: "resend",
      commonsUrl: "https://example.com/commons.git",
      author: "  ",
      date: "2026-07-17",
      ghRunner: ghStubFactory().run,
    });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("author");
  });

  it("rejects a calendar-invalid date before touching git", async () => {
    const result = await runPromoteLibrary({
      cwd: await makeDir(),
      name: "resend",
      commonsUrl: "https://example.com/commons.git",
      author: "hrithik",
      date: "2026-13-99",
      ghRunner: ghStubFactory().run,
    });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("Invalid date");
  });

  it("falls back to a compare URL when gh is unavailable", async () => {
    const fixture = await makeV2CommonsFixture(await makeDir(), {});
    const home = await makeDir();
    const librariesRoot = await makeDir();
    await writeLocalLibrary(librariesRoot, "resend", { "LIBRARY.md": "hi" });
    const ghUnavailable = async (): Promise<ExecResult> => ({
      ok: false,
      reason: "spawn",
      code: -1,
      stderr: "gh: command not found",
    });

    const result = await runPromoteLibrary({
      cwd: await makeDir(),
      name: "resend",
      commonsUrl: fixture.remoteUrl,
      author: "hrithik",
      date: "2026-07-17",
      home,
      librariesRoot,
      ghRunner: ghUnavailable,
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("gh unavailable");
    expect(result.output).toContain("Library promoted: libraries/resend");
  });

  it("rejects a library name that fails the kebab-case rule", async () => {
    const result = await runPromoteLibrary({
      cwd: await makeDir(),
      name: "Not Valid",
      commonsUrl: "https://example.com/commons.git",
      author: "hrithik",
      date: "2026-07-17",
      ghRunner: ghStubFactory().run,
    });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("Invalid library name");
  });
});
