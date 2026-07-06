import { access, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  normalizeSource,
  runSkillAdd,
  runSkillPromote,
} from "../../src/commands/skill.js";
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
  squads: [] as string[],
  workspaces: {},
};

const SKILL = (name: string): string =>
  `---\nname: ${name}\ndescription: A ${name} skill.\n---\nDo the ${name} thing.`;

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
        stdout: "https://github.com/roboto/team-memory/pull/7",
      };
    },
  };
};

const run = async (cmd: string, args: string[], cwd: string): Promise<void> => {
  const r = await exec(cmd, args, { cwd });
  if (!r.ok) throw new Error(`${cmd} ${args.join(" ")}: ${r.stderr}`);
};

const pathExists = (p: string): Promise<boolean> =>
  access(p).then(
    () => true,
    () => false,
  );

describe("normalizeSource", () => {
  it("expands owner/repo to a github https url", () => {
    expect(normalizeSource("obra/skills")).toEqual({
      url: "https://github.com/obra/skills.git",
      label: "github:obra/skills",
    });
  });
  it("passes https urls through", () => {
    expect(normalizeSource("https://example.com/x/y.git")?.url).toBe(
      "https://example.com/x/y.git",
    );
  });
  it("rejects garbage", () => {
    expect(normalizeSource("not a source")).toBeUndefined();
  });
});

describe("runSkillAdd", () => {
  const tmp = tmpDirFactory("rm-skilladd-");
  afterEach(tmp.cleanup);

  /** bare upstream repo containing the given files */
  const makeUpstream = async (
    files: Record<string, string>,
  ): Promise<string> => {
    const root = await tmp.make();
    const bare = path.join(root, "upstream.git");
    const work = path.join(root, "work");
    await run("git", ["init", "--bare", "--initial-branch=main", bare], root);
    await run("git", ["clone", bare, work], root);
    await run("git", ["config", "user.email", "t@e.com"], work);
    await run("git", ["config", "user.name", "T"], work);
    await Promise.all(
      Object.entries(files).map(async ([f, c]) => {
        await mkdir(path.dirname(path.join(work, f)), { recursive: true });
        await writeFile(path.join(work, f), c, "utf8");
      }),
    );
    await run("git", ["add", "."], work);
    await run("git", ["commit", "-m", "skills"], work);
    await run("git", ["push", "origin", "main"], work);
    return bare;
  };

  const setup = async (): Promise<{
    cwd: string;
    home: string;
    fixture: Awaited<ReturnType<typeof makeCommonsFixture>>;
  }> => {
    const fixture = await makeCommonsFixture(await tmp.make());
    const cwd = await tmp.make();
    await saveConfig(cwd, { ...VALID_CONFIG, commons: fixture.remoteUrl });
    return { cwd, home: await tmp.make(), fixture };
  };

  it("vendors a single-skill upstream: branch, provenance, gh call", async () => {
    const { cwd, home, fixture } = await setup();
    const upstream = await makeUpstream({
      "skills/grill-me/SKILL.md": SKILL("grill-me"),
    });
    const gh = ghStubFactory();

    const result = await runSkillAdd({
      cwd,
      source: upstream,
      author: "hrithik",
      date: "2026-07-06",
      home,
      ghRunner: gh.run,
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("pull/7");

    const lsRemote = await exec("git", [
      "ls-remote",
      fixture.remoteUrl,
      "refs/heads/skill/grill-me",
    ]);
    expect(lsRemote.ok && lsRemote.stdout).toMatch(/skill\/grill-me/);

    // provenance landed on the branch with a 40-char sha
    await run("git", ["fetch", "origin", "skill/grill-me"], fixture.workdir);
    await run("git", ["checkout", "skill/grill-me"], fixture.workdir);
    const prov = JSON.parse(
      await readFile(
        path.join(fixture.workdir, "skills", "grill-me", ".provenance.json"),
        "utf8",
      ),
    ) as { ref: string; vendoredBy: string };
    expect(prov.ref).toMatch(/^[0-9a-f]{40}$/);
    expect(prov.vendoredBy).toBe("hrithik");

    const title = gh.calls[0] ?? [];
    expect(title[title.indexOf("--title") + 1]).toContain("skill(grill-me)");
  });

  it("multi-skill upstream requires --skill; with it, vendors the named one", async () => {
    const { cwd, home } = await setup();
    const upstream = await makeUpstream({
      "skills/a-one/SKILL.md": SKILL("a-one"),
      "skills/b-two/SKILL.md": SKILL("b-two"),
    });
    const gh = ghStubFactory();

    const bare = await runSkillAdd({
      cwd,
      source: upstream,
      author: "h",
      date: "2026-07-06",
      home,
      ghRunner: gh.run,
    });
    expect(bare.exitCode).toBe(1);
    expect(bare.output).toContain("--skill");
    expect(bare.output).toContain("a-one");
    expect(bare.output).toContain("b-two");

    const picked = await runSkillAdd({
      cwd,
      source: upstream,
      skill: "b-two",
      author: "h",
      date: "2026-07-06",
      home,
      ghRunner: gh.run,
    });
    expect(picked.exitCode).toBe(0);
    expect(picked.output).toContain("b-two");
  });

  it("re-vendoring a merged skill: update path when upstream changed, no-op when identical", async () => {
    const { cwd, home, fixture } = await setup();
    const root = await tmp.make();
    const upstreamBare = path.join(root, "upstream.git");
    const upstreamWork = path.join(root, "work");
    await run(
      "git",
      ["init", "--bare", "--initial-branch=main", upstreamBare],
      root,
    );
    await run("git", ["clone", upstreamBare, upstreamWork], root);
    await run("git", ["config", "user.email", "t@e.com"], upstreamWork);
    await run("git", ["config", "user.name", "T"], upstreamWork);
    await mkdir(path.join(upstreamWork, "skills", "grill-me"), {
      recursive: true,
    });
    await writeFile(
      path.join(upstreamWork, "skills", "grill-me", "SKILL.md"),
      SKILL("grill-me"),
      "utf8",
    );
    await run("git", ["add", "."], upstreamWork);
    await run("git", ["commit", "-m", "v1"], upstreamWork);
    await run("git", ["push", "origin", "main"], upstreamWork);

    const gh = ghStubFactory();
    const opts = {
      cwd,
      source: upstreamBare,
      author: "h",
      date: "2026-07-06",
      home,
      ghRunner: gh.run,
    };

    expect((await runSkillAdd(opts)).exitCode).toBe(0);

    // "review + merge" the first PR so the skill exists on main
    await run("git", ["fetch", "origin", "skill/grill-me"], fixture.workdir);
    await run(
      "git",
      ["merge", "origin/skill/grill-me", "--no-edit"],
      fixture.workdir,
    );
    await run("git", ["push", "origin", "main"], fixture.workdir);

    const shaBefore = await exec("git", [
      "ls-remote",
      fixture.remoteUrl,
      "refs/heads/skill/grill-me",
    ]);

    // identical upstream → nothing to submit
    const noop = await runSkillAdd(opts);
    expect(noop.exitCode).toBe(0);
    expect(noop.output).toContain("already up to date");

    const shaAfter = await exec("git", [
      "ls-remote",
      fixture.remoteUrl,
      "refs/heads/skill/grill-me",
    ]);
    expect(shaAfter.ok && shaAfter.stdout).toBe(
      shaBefore.ok && shaBefore.stdout,
    );

    // upstream moves → re-vendor is the update path
    await writeFile(
      path.join(upstreamWork, "skills", "grill-me", "SKILL.md"),
      `${SKILL("grill-me")}\n\nNew guidance.`,
      "utf8",
    );
    await run("git", ["commit", "-am", "v2"], upstreamWork);
    await run("git", ["push", "origin", "main"], upstreamWork);

    const second = await runSkillAdd(opts);
    expect(second.exitCode).toBe(0);
    expect(second.output).toContain("Skill updated");

    await run("git", ["fetch", "origin", "skill/grill-me"], fixture.workdir);
    await run("git", ["checkout", "skill/grill-me"], fixture.workdir);
    const pushedSkillMd = await readFile(
      path.join(fixture.workdir, "skills", "grill-me", "SKILL.md"),
      "utf8",
    );
    expect(pushedSkillMd).toContain("New guidance.");
  });

  it("blocks vendoring when a skill file contains a secret", async () => {
    const { cwd, home, fixture } = await setup();
    const upstream = await makeUpstream({
      "skills/leaky/SKILL.md": SKILL("leaky"),
      "skills/leaky/notes.md": `token: "ghp_${"a".repeat(36)}"`,
    });
    const gh = ghStubFactory();

    const result = await runSkillAdd({
      cwd,
      source: upstream,
      author: "h",
      date: "2026-07-06",
      home,
      ghRunner: gh.run,
    });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("github-token");
    const lsRemote = await exec("git", [
      "ls-remote",
      fixture.remoteUrl,
      "refs/heads/skill/leaky",
    ]);
    expect(lsRemote.ok && lsRemote.stdout).toBe("");
  });

  it("refuses to vendor an upstream skill containing a symlink", async () => {
    const { cwd, home, fixture } = await setup();
    const root = await tmp.make();
    const bare = path.join(root, "upstream.git");
    const work = path.join(root, "work");
    await run("git", ["init", "--bare", "--initial-branch=main", bare], root);
    await run("git", ["clone", bare, work], root);
    await run("git", ["config", "user.email", "t@e.com"], work);
    await run("git", ["config", "user.name", "T"], work);
    await mkdir(path.join(work, "skills", "sneaky"), { recursive: true });
    await writeFile(
      path.join(work, "skills", "sneaky", "SKILL.md"),
      SKILL("sneaky"),
      "utf8",
    );
    await symlink("/etc", path.join(work, "skills", "sneaky", "escape"));
    await run("git", ["add", "."], work);
    await run("git", ["commit", "-m", "skills"], work);
    await run("git", ["push", "origin", "main"], work);

    const gh = ghStubFactory();
    const result = await runSkillAdd({
      cwd,
      source: bare,
      author: "h",
      date: "2026-07-06",
      home,
      ghRunner: gh.run,
    });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("symbolic link");

    const lsRemote = await exec("git", [
      "ls-remote",
      fixture.remoteUrl,
      "refs/heads/skill/sneaky",
    ]);
    expect(lsRemote.ok && lsRemote.stdout).toBe("");
  });

  it("root-level SKILL.md vendors only that file", async () => {
    const { cwd, home, fixture } = await setup();
    const upstream = await makeUpstream({
      "SKILL.md": SKILL("root-skill"),
      "src/code.ts": "export const x = 1;",
    });
    const gh = ghStubFactory();

    const result = await runSkillAdd({
      cwd,
      source: upstream,
      author: "h",
      date: "2026-07-06",
      home,
      ghRunner: gh.run,
    });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("only SKILL.md");

    await run("git", ["fetch", "origin", "skill/root-skill"], fixture.workdir);
    await run("git", ["checkout", "skill/root-skill"], fixture.workdir);
    expect(
      await pathExists(
        path.join(fixture.workdir, "skills", "root-skill", "SKILL.md"),
      ),
    ).toBe(true);
    expect(
      await pathExists(
        path.join(fixture.workdir, "skills", "root-skill", "src"),
      ),
    ).toBe(false);
  });

  it("rejects an unusable source string", async () => {
    const { cwd, home } = await setup();
    const result = await runSkillAdd({
      cwd,
      source: "???",
      author: "h",
      date: "2026-07-06",
      home,
    });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("owner/repo");
  });

  it("rejects --skill values that traverse or are absolute", async () => {
    const { cwd, home } = await setup();
    const upstream = await makeUpstream({
      "skills/ok-skill/SKILL.md": SKILL("ok-skill"),
    });
    const gh = ghStubFactory();

    const traversal = await runSkillAdd({
      cwd,
      source: upstream,
      skill: "../../evil",
      author: "h",
      date: "2026-07-06",
      home,
      ghRunner: gh.run,
    });
    expect(traversal.exitCode).toBe(1);
    expect(traversal.output).toContain("Invalid --skill");

    const absolute = await runSkillAdd({
      cwd,
      source: upstream,
      skill: "/etc",
      author: "h",
      date: "2026-07-06",
      home,
      ghRunner: gh.run,
    });
    expect(absolute.exitCode).toBe(1);
    expect(absolute.output).toContain("Invalid --skill");
    expect(gh.calls).toHaveLength(0);
  });
});

describe("runSkillPromote", () => {
  const tmp = tmpDirFactory("rm-skillpromote-");
  afterEach(tmp.cleanup);

  it("promotes a personal skill: branch pushed, no provenance file", async () => {
    const fixture = await makeCommonsFixture(await tmp.make());
    const cwd = await tmp.make();
    await saveConfig(cwd, { ...VALID_CONFIG, commons: fixture.remoteUrl });
    const home = await tmp.make();
    const skillsRoot = await tmp.make();

    await mkdir(path.join(skillsRoot, "my-flow"), { recursive: true });
    await writeFile(
      path.join(skillsRoot, "my-flow", "SKILL.md"),
      "---\nname: my-flow\ndescription: My workflow.\n---\nSteps.",
      "utf8",
    );

    const gh = ghStubFactory();
    const result = await runSkillPromote({
      cwd,
      name: "my-flow",
      author: "hrithik",
      date: "2026-07-06",
      home,
      skillsRoot,
      ghRunner: gh.run,
    });

    expect(result.exitCode).toBe(0);
    const lsRemote = await exec("git", [
      "ls-remote",
      fixture.remoteUrl,
      "refs/heads/skill/my-flow",
    ]);
    expect(lsRemote.ok && lsRemote.stdout).toMatch(/skill\/my-flow/);

    await run("git", ["fetch", "origin", "skill/my-flow"], fixture.workdir);
    await run("git", ["checkout", "skill/my-flow"], fixture.workdir);
    expect(
      await pathExists(
        path.join(fixture.workdir, "skills", "my-flow", ".provenance.json"),
      ),
    ).toBe(false);
  });

  it("fails when the personal skill does not exist or frontmatter name mismatches", async () => {
    const fixture = await makeCommonsFixture(await tmp.make());
    const cwd = await tmp.make();
    await saveConfig(cwd, { ...VALID_CONFIG, commons: fixture.remoteUrl });
    const home = await tmp.make();
    const skillsRoot = await tmp.make();

    const missing = await runSkillPromote({
      cwd,
      name: "nope",
      author: "h",
      date: "2026-07-06",
      home,
      skillsRoot,
    });
    expect(missing.exitCode).toBe(1);

    await mkdir(path.join(skillsRoot, "renamed"), { recursive: true });
    await writeFile(
      path.join(skillsRoot, "renamed", "SKILL.md"),
      "---\nname: other\ndescription: d\n---\nbody",
      "utf8",
    );
    const mismatch = await runSkillPromote({
      cwd,
      name: "renamed",
      author: "h",
      date: "2026-07-06",
      home,
      skillsRoot,
    });
    expect(mismatch.exitCode).toBe(1);
    expect(mismatch.output).toContain("other");
  });
});
