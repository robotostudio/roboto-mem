import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compareUrl, runPromote } from "../../src/commands/promote.js";
import { saveConfig } from "../../src/core/config.js";
import type { ExecResult } from "../../src/core/exec.js";
import { exec } from "../../src/core/exec.js";
import { makeCommonsFixture } from "../helpers/git.js";
import { tmpDirFactory } from "../helpers/tmp.js";

const VALID_CONFIG = {
  configVersion: 1 as const,
  commons: "",
  overlays: [] as string[],
  project: "my-project",
  squads: [],
  workspaces: {},
};

describe("promote command", () => {
  const tmp = tmpDirFactory("rm-promote-");
  afterEach(tmp.cleanup);
  const makeDir = tmp.make;

  // ---------------------------------------------------------------------------
  // 1. Happy path: lesson to stack/sanity with fresh name → exit 0, branch on
  //    remote, ghStub captured correct args, output contains stub URL
  // ---------------------------------------------------------------------------
  it("happy path: promotes a lesson to stack/sanity, pushes branch, calls gh", async () => {
    const tmp = await makeDir();
    const fixture = await makeCommonsFixture(tmp);

    const cwd = await makeDir();
    await saveConfig(cwd, { ...VALID_CONFIG, commons: fixture.remoteUrl });

    const home = await makeDir();

    const ghCalls: string[][] = [];
    const ghStub = async (
      args: string[],
      _cwd: string,
    ): Promise<ExecResult> => {
      ghCalls.push(args);
      return {
        ok: true,
        stdout: "https://github.com/roboto/team-memory/pull/42",
      };
    };

    const result = await runPromote({
      cwd,
      scope: "stack/sanity",
      type: "lesson",
      name: "new-client-pattern",
      description: "Using createClient from v3 has subtle differences",
      body: "Always pass the projectId explicitly when constructing the sanity client in server contexts.",
      author: "hrithik",
      date: "2026-06-12",
      home,
      ghRunner: ghStub,
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain(
      "https://github.com/roboto/team-memory/pull/42",
    );
    expect(result.output).toContain("promote/stack-sanity-new-client-pattern");

    // gh was called with the right title
    expect(ghCalls).toHaveLength(1);
    expect(ghCalls[0]).toContain("pr");
    expect(ghCalls[0]).toContain("create");
    expect(ghCalls[0]).toContain("--title");
    const firstCall = ghCalls[0] ?? [];
    const titleIdx = firstCall.indexOf("--title");
    expect(firstCall[titleIdx + 1]).toBe(
      "promote(stack/sanity): new-client-pattern",
    );

    // branch must be on the remote
    const lsRemote = await exec("git", [
      "ls-remote",
      fixture.remoteUrl,
      "refs/heads/promote/stack-sanity-new-client-pattern",
    ]);
    expect(lsRemote.ok).toBe(true);
    if (lsRemote.ok) {
      expect(lsRemote.stdout).toMatch(
        /refs\/heads\/promote\/stack-sanity-new-client-pattern/,
      );
    }
  });

  // ---------------------------------------------------------------------------
  // 2a. gh spawn-fails → exit 0, branch still pushed, output has fallback message
  //     (local path remoteUrl → expect generic "open a PR for branch" message)
  // ---------------------------------------------------------------------------
  it("gh spawn-fail: exit 0, branch on remote, generic fallback message for local path url", async () => {
    const tmp = await makeDir();
    const fixture = await makeCommonsFixture(tmp);

    const cwd = await makeDir();
    await saveConfig(cwd, { ...VALID_CONFIG, commons: fixture.remoteUrl });

    const home = await makeDir();

    const ghStub = async (
      _args: string[],
      _cwd: string,
    ): Promise<ExecResult> => ({
      ok: false,
      reason: "spawn",
      code: -1,
      stderr: "not found",
    });

    const result = await runPromote({
      cwd,
      scope: "stack/sanity",
      type: "lesson",
      name: "spawn-fail-entry",
      description: "testing spawn failure path",
      body: "Branch should still be pushed even when gh is not installed.",
      author: "hrithik",
      date: "2026-06-12",
      home,
      ghRunner: ghStub,
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toMatch(/open a PR for branch/i);
    expect(result.output).toContain("promote/stack-sanity-spawn-fail-entry");

    // branch must still be on the remote
    const lsRemote = await exec("git", [
      "ls-remote",
      fixture.remoteUrl,
      "refs/heads/promote/stack-sanity-spawn-fail-entry",
    ]);
    expect(lsRemote.ok).toBe(true);
    if (lsRemote.ok) {
      expect(lsRemote.stdout).toMatch(
        /refs\/heads\/promote\/stack-sanity-spawn-fail-entry/,
      );
    }
  });

  // ---------------------------------------------------------------------------
  // 2b. Unit test for compareUrl helper
  // ---------------------------------------------------------------------------
  it("compareUrl: derives github compare URL for ssh and https remotes", () => {
    expect(
      compareUrl(
        "git@github.com:roboto/team-memory.git",
        "promote/stack-sanity-foo",
      ),
    ).toBe(
      "https://github.com/roboto/team-memory/compare/main...promote/stack-sanity-foo",
    );

    expect(
      compareUrl("https://github.com/x/y.git", "promote/stack-sanity-foo"),
    ).toBe("https://github.com/x/y/compare/main...promote/stack-sanity-foo");

    expect(compareUrl("/tmp/foo", "promote/stack-sanity-foo")).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // 2c. gh spawn-fails with non-github local URL → generic "open a PR for branch" fallback
  // ---------------------------------------------------------------------------
  it("gh spawn-fail with non-github commons URL: output has generic fallback with branch name", async () => {
    const tmp = await makeDir();
    const fixture = await makeCommonsFixture(tmp);

    const cwd = await makeDir();
    await saveConfig(cwd, { ...VALID_CONFIG, commons: fixture.remoteUrl });

    const home = await makeDir();

    const ghStub = async (
      _args: string[],
      _cwd: string,
    ): Promise<ExecResult> => ({
      ok: false,
      reason: "spawn",
      code: -1,
      stderr: "not found",
    });

    const result = await runPromote({
      cwd,
      scope: "org",
      type: "standard",
      name: "fallback-message-entry",
      description: "Testing fallback message on non-github remote",
      body: "Body for the fallback test entry.",
      author: "hrithik",
      date: "2026-06-12",
      home,
      ghRunner: ghStub,
    });

    expect(result.exitCode).toBe(0);
    // Generic fallback must mention "open a PR for branch" and the branch name
    expect(result.output).toMatch(/open a PR for branch/i);
    expect(result.output).toContain("promote/org-fallback-message-entry");
  });

  // ---------------------------------------------------------------------------
  // 2d. Two sequential promotes against the same clone: branch 2 has exactly 1 commit
  //     over main (no leak from branch 1)
  // ---------------------------------------------------------------------------
  it("sequential promotes: branch 2 carries exactly its own commit, not branch 1's", async () => {
    const tmp = await makeDir();
    const fixture = await makeCommonsFixture(tmp);

    const cwd = await makeDir();
    await saveConfig(cwd, { ...VALID_CONFIG, commons: fixture.remoteUrl });

    const home = await makeDir();

    const ghStub = async (
      _args: string[],
      _cwd: string,
    ): Promise<ExecResult> => ({
      ok: true,
      stdout: "https://github.com/roboto/team-memory/pull/1",
    });

    const first = await runPromote({
      cwd,
      scope: "stack/sanity",
      type: "lesson",
      name: "first-entry",
      description: "First sequential promote entry",
      body: "Body of the first entry.",
      author: "hrithik",
      date: "2026-06-12",
      home,
      ghRunner: ghStub,
    });
    expect(first.exitCode).toBe(0);

    const second = await runPromote({
      cwd,
      scope: "org",
      type: "standard",
      name: "second-entry",
      description: "Second sequential promote entry",
      body: "Body of the second entry.",
      author: "hrithik",
      date: "2026-06-12",
      home,
      ghRunner: ghStub,
    });
    expect(second.exitCode).toBe(0);

    // branch 2 must diverge from main by exactly 1 commit (its own)
    const revList = await exec(
      "git",
      ["rev-list", "--count", "main..promote/org-second-entry"],
      { cwd: fixture.remoteUrl },
    );
    expect(revList.ok).toBe(true);
    if (revList.ok) {
      expect(revList.stdout.trim()).toBe("1");
    }
  });

  // ---------------------------------------------------------------------------
  // 3. Near-duplicate: exit 1 listing matches; with force: true → exit 0
  // ---------------------------------------------------------------------------
  it("near-duplicate: exit 1 without force, exit 0 with force", async () => {
    const tmp = await makeDir();
    const fixture = await makeCommonsFixture(tmp);

    const cwd = await makeDir();
    await saveConfig(cwd, { ...VALID_CONFIG, commons: fixture.remoteUrl });

    const home = await makeDir();

    const ghStub = async (
      _args: string[],
      _cwd: string,
    ): Promise<ExecResult> => ({
      ok: true,
      stdout: "https://example.com/pr/1",
    });

    // Mirror the wording of the fixture's typegen-flag entry closely enough
    // to score >= 0.55 (verified: scores ~0.65 against the fixture entry)
    const nearDupOptions = {
      cwd,
      scope: "stack/sanity",
      type: "lesson" as const,
      name: "typegen-flag-redux",
      description: "TypeGen v3 flag breaks our client wrapper",
      body: "Running sanity typegen generate with --experimental flag breaks createClient typing. Pin to v2 syntax until the issue is resolved.",
      author: "hrithik",
      date: "2026-06-12",
      home,
      ghRunner: ghStub,
    };

    const noForce = await runPromote(nearDupOptions);
    expect(noForce.exitCode).toBe(1);
    expect(noForce.output).toContain("entries/stacks/sanity/typegen-flag.md");
    // score should be present (2dp)
    expect(noForce.output).toMatch(/0\.\d{2}/);
    expect(noForce.output).toMatch(/--force/i);

    const withForce = await runPromote({ ...nearDupOptions, force: true });
    expect(withForce.exitCode).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 4. Secret in body: exit 1, no branch pushed; force does NOT bypass
  // ---------------------------------------------------------------------------
  it("secret in body: exit 1 even with force, branch NOT pushed", async () => {
    const tmp = await makeDir();
    const fixture = await makeCommonsFixture(tmp);

    const cwd = await makeDir();
    await saveConfig(cwd, { ...VALID_CONFIG, commons: fixture.remoteUrl });

    const home = await makeDir();

    const ghStub = async (
      _args: string[],
      _cwd: string,
    ): Promise<ExecResult> => ({
      ok: true,
      stdout: "https://example.com/pr/1",
    });

    // ghp_ + exactly 36 alphanumeric chars matches the github-token scan rule
    const secretBody =
      "Use this token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 to authenticate.";

    const secretOptions = {
      cwd,
      scope: "stack/sanity",
      type: "standard" as const,
      name: "secret-entry",
      description: "Authentication approach",
      body: secretBody,
      author: "hrithik",
      date: "2026-06-12",
      force: true,
      home,
      ghRunner: ghStub,
    };

    const result = await runPromote(secretOptions);
    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/secret|scan|error/i);

    // No promote branch should be on the remote
    const lsRemote = await exec("git", [
      "ls-remote",
      fixture.remoteUrl,
      "refs/heads/promote/*",
    ]);
    expect(lsRemote.ok).toBe(true);
    if (lsRemote.ok) {
      expect(lsRemote.stdout).toBe("");
    }
  });

  // ---------------------------------------------------------------------------
  // 5. Exact collision: scope stack/sanity name typegen-flag — exit 1 even with force
  // ---------------------------------------------------------------------------
  it("exact collision: exit 1 naming the file, force does not bypass", async () => {
    const tmp = await makeDir();
    const fixture = await makeCommonsFixture(tmp);

    const cwd = await makeDir();
    await saveConfig(cwd, { ...VALID_CONFIG, commons: fixture.remoteUrl });

    const home = await makeDir();

    const ghStub = async (
      _args: string[],
      _cwd: string,
    ): Promise<ExecResult> => ({
      ok: true,
      stdout: "https://example.com/pr/1",
    });

    const collisionOptions = {
      cwd,
      scope: "stack/sanity",
      type: "lesson" as const,
      name: "typegen-flag",
      description: "Different description",
      body: "Different body content entirely.",
      author: "hrithik",
      date: "2026-06-12",
      home,
      ghRunner: ghStub,
    };

    const noForce = await runPromote(collisionOptions);
    expect(noForce.exitCode).toBe(1);
    expect(noForce.output).toContain("entries/stacks/sanity/typegen-flag.md");

    const withForce = await runPromote({ ...collisionOptions, force: true });
    expect(withForce.exitCode).toBe(1);
    expect(withForce.output).toContain("entries/stacks/sanity/typegen-flag.md");
  });

  // ---------------------------------------------------------------------------
  // 6. Invalid scope: exit 1 before any clone; home/repos does not exist
  // ---------------------------------------------------------------------------
  it("invalid scope: exits 1 before any clone", async () => {
    const tmp = await makeDir();
    const fixture = await makeCommonsFixture(tmp);

    const cwd = await makeDir();
    await saveConfig(cwd, { ...VALID_CONFIG, commons: fixture.remoteUrl });

    const home = await makeDir();

    const result = await runPromote({
      cwd,
      scope: "team/web",
      type: "standard",
      name: "some-entry",
      description: "Some description",
      body: "Some body",
      author: "hrithik",
      date: "2026-06-12",
      home,
    });

    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/scope/i);

    // home/repos must not have been created
    const reposExists = await fs
      .access(path.join(home, "repos"))
      .then(() => true)
      .catch(() => false);
    expect(reposExists).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // 7. Email in body: exit 0, output mentions the warning
  // ---------------------------------------------------------------------------
  it("email in body: exit 0 with warning in output", async () => {
    const tmp = await makeDir();
    const fixture = await makeCommonsFixture(tmp);

    const cwd = await makeDir();
    await saveConfig(cwd, { ...VALID_CONFIG, commons: fixture.remoteUrl });

    const home = await makeDir();

    const ghStub = async (
      _args: string[],
      _cwd: string,
    ): Promise<ExecResult> => ({
      ok: true,
      stdout: "https://github.com/roboto/team-memory/pull/99",
    });

    const result = await runPromote({
      cwd,
      scope: "stack/sanity",
      type: "standard",
      name: "email-warning-entry",
      description: "Contact the team for questions",
      body: "Reach out to someone@example.com for access.",
      author: "hrithik",
      date: "2026-06-12",
      home,
      ghRunner: ghStub,
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toMatch(/warning|warn/i);
  });
});
