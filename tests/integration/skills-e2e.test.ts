import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runSkillAdd } from "../../src/commands/skill.js";
import { runStatus } from "../../src/commands/status.js";
import { runSync } from "../../src/commands/sync.js";
import { saveConfig } from "../../src/core/config.js";
import type { ExecResult } from "../../src/core/exec.js";
import { exec } from "../../src/core/exec.js";
import { makeCommonsFixture, pushEntry } from "../helpers/git.js";
import { tmpDirFactory } from "../helpers/tmp.js";

describe("skills e2e", () => {
  const tmp = tmpDirFactory("rm-skills-e2e-");
  afterEach(tmp.cleanup);

  const run = async (
    cmd: string,
    args: string[],
    cwd: string,
  ): Promise<void> => {
    const r = await exec(cmd, args, { cwd });
    if (!r.ok) throw new Error(`${cmd} ${args.join(" ")}: ${r.stderr}`);
  };

  const exists = (p: string): Promise<boolean> =>
    access(p).then(
      () => true,
      () => false,
    );

  it("vendor → merge → sync materializes → edit restores → delete cleans up", async () => {
    const fixture = await makeCommonsFixture(await tmp.make());
    const cwd = await tmp.make();
    const home = await tmp.make();
    const target = await tmp.make();
    await saveConfig(cwd, {
      configVersion: 1,
      commons: fixture.remoteUrl,
      overlays: [],
      project: "demo",
      squads: [],
      workspaces: {},
    });

    // upstream skill repo
    const upstreamRoot = await tmp.make();
    const upstreamBare = path.join(upstreamRoot, "up.git");
    const upstreamWork = path.join(upstreamRoot, "work");
    await run(
      "git",
      ["init", "--bare", "--initial-branch=main", upstreamBare],
      upstreamRoot,
    );
    await run("git", ["clone", upstreamBare, upstreamWork], upstreamRoot);
    await run("git", ["config", "user.email", "t@e.com"], upstreamWork);
    await run("git", ["config", "user.name", "T"], upstreamWork);
    await mkdir(path.join(upstreamWork, "skills", "hello-team"), {
      recursive: true,
    });
    await writeFile(
      path.join(upstreamWork, "skills", "hello-team", "SKILL.md"),
      "---\nname: hello-team\ndescription: Say hello.\n---\nSay hello to the team.",
      "utf8",
    );
    await run("git", ["add", "."], upstreamWork);
    await run("git", ["commit", "-m", "skill"], upstreamWork);
    await run("git", ["push", "origin", "main"], upstreamWork);

    // 1. vendor → PR branch on the commons
    const ghStub = async (_a: string[], _c: string): Promise<ExecResult> => ({
      ok: true,
      stdout: "https://example.com/pr/1",
    });
    const add = await runSkillAdd({
      cwd,
      source: upstreamBare,
      author: "hrithik",
      date: "2026-07-06",
      home,
      ghRunner: ghStub,
    });
    expect(add.exitCode).toBe(0);

    // 2. "review + merge" the PR branch into main on the commons
    await run("git", ["fetch", "origin", "skill/hello-team"], fixture.workdir);
    await run(
      "git",
      ["merge", "origin/skill/hello-team", "--no-edit"],
      fixture.workdir,
    );
    await run("git", ["push", "origin", "main"], fixture.workdir);

    // 3. teammate sync → materialized (provenance excluded)
    const sync1 = await runSync({ cwd, home, skillsTargetDir: target });
    expect(sync1.output).toContain("skills: 1 materialized");
    expect(await exists(path.join(target, "hello-team", "SKILL.md"))).toBe(
      true,
    );
    expect(
      await exists(path.join(target, "hello-team", ".provenance.json")),
    ).toBe(false);

    // 4. status agrees
    const status = await runStatus({ cwd, home, skillsTargetDir: target });
    expect(status.output).toContain("skills: 1 materialized");

    // 5. local edit → next sync restores and reports
    await writeFile(
      path.join(target, "hello-team", "SKILL.md"),
      "hacked",
      "utf8",
    );
    const sync2 = await runSync({ cwd, home, skillsTargetDir: target });
    expect(sync2.output).toContain("restored: hello-team");
    expect(
      await readFile(path.join(target, "hello-team", "SKILL.md"), "utf8"),
    ).toContain("Say hello");

    // 6. removed from the commons → next sync cleans up
    await run("git", ["rm", "-r", "skills/hello-team"], fixture.workdir);
    await run("git", ["commit", "-m", "remove skill"], fixture.workdir);
    await run("git", ["push", "origin", "main"], fixture.workdir);
    const sync3 = await runSync({ cwd, home, skillsTargetDir: target });
    expect(sync3.output).toContain("removed");
    expect(await exists(path.join(target, "hello-team"))).toBe(false);
  });

  it("personal skill with the same name is never overwritten", async () => {
    const fixture = await makeCommonsFixture(await tmp.make());
    const cwd = await tmp.make();
    const home = await tmp.make();
    const target = await tmp.make();
    await saveConfig(cwd, {
      configVersion: 1,
      commons: fixture.remoteUrl,
      overlays: [],
      project: "demo",
      squads: [],
      workspaces: {},
    });

    await pushEntry(
      fixture,
      "skills/grill-me/SKILL.md",
      "---\nname: grill-me\ndescription: team version\n---\nteam",
    );

    await mkdir(path.join(target, "grill-me"), { recursive: true });
    await writeFile(
      path.join(target, "grill-me", "SKILL.md"),
      "personal",
      "utf8",
    );

    const sync = await runSync({ cwd, home, skillsTargetDir: target });
    expect(sync.output).toContain("shadowed by personal: grill-me");
    expect(
      await readFile(path.join(target, "grill-me", "SKILL.md"), "utf8"),
    ).toBe("personal");
  });
});
