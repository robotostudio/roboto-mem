import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runStatus } from "../../src/commands/status.js";
import { runSync } from "../../src/commands/sync.js";
import { writeCache } from "../../src/core/cache.js";
import { saveConfig } from "../../src/core/config.js";
import { ensureRepo } from "../../src/core/memory-repo.js";
import { makeCommonsFixture, pushEntry } from "../helpers/git.js";
import { tmpDirFactory } from "../helpers/tmp.js";

const tmp = tmpDirFactory("rm-status-");
const mkTmp = tmp.make;

afterEach(tmp.cleanup);

// 1. no config → exit 1 mentions init
describe("status — no config", () => {
  it("exits 1 and mentions init when .roboto-mem.json is absent", async () => {
    const cwd = await mkTmp();
    const home = await mkTmp();

    const result = await runStatus({ cwd, home });

    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/init/i);
  });
});

// 2. bound but never synced → exit 0, commons URL, project, squads, "not synced yet"
describe("status — bound but never synced", () => {
  it("exits 0 and reports config details plus not-synced message", async () => {
    const cwd = await mkTmp();
    const home = await mkTmp();
    const tmp = await mkTmp();
    const fixture = await makeCommonsFixture(tmp);

    await saveConfig(cwd, {
      configVersion: 1,
      commons: fixture.remoteUrl,
      overlays: [],
      project: "my-app",
      squads: ["web"],
      workspaces: {},
    });

    const result = await runStatus({ cwd, home });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain(fixture.remoteUrl);
    expect(result.output).toContain("my-app");
    expect(result.output).toContain("web");
    expect(result.output).toContain("not synced yet");
  });
});

// 3. synced: 2 standards, 1 lesson; formatVersion 1
describe("status — synced clone", () => {
  it("reports entry counts and formatVersion 1 after ensureRepo", async () => {
    const cwd = await mkTmp();
    const home = await mkTmp();
    const tmp = await mkTmp();
    const fixture = await makeCommonsFixture(tmp);

    await saveConfig(cwd, {
      configVersion: 1,
      commons: fixture.remoteUrl,
      overlays: [],
      project: "my-app",
      squads: [],
      workspaces: {},
    });

    await ensureRepo(fixture.remoteUrl, home);

    const result = await runStatus({ cwd, home });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("2 standards, 1 lesson");
    expect(result.output).toContain("formatVersion 1");
  });
});

// 4. with cache → "last digest: <date>"
describe("status — with digest cache", () => {
  it("reports last digest date when cache exists", async () => {
    const cwd = await mkTmp();
    const home = await mkTmp();
    const tmp = await mkTmp();
    const fixture = await makeCommonsFixture(tmp);

    await saveConfig(cwd, {
      configVersion: 1,
      commons: fixture.remoteUrl,
      overlays: [],
      project: "my-app",
      squads: [],
      workspaces: {},
    });

    await writeCache(home, cwd, { date: "2026-06-12", digest: "x" });

    const result = await runStatus({ cwd, home });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("last digest: 2026-06-12");
  });
});

// 5. newer-format clone → exit 0, mentions upgrade
describe("status — newer-format clone", () => {
  it("exits 0 and mentions upgrade when memory.json has a future formatVersion", async () => {
    const cwd = await mkTmp();
    const home = await mkTmp();
    const tmp = await mkTmp();
    const fixture = await makeCommonsFixture(tmp);

    await saveConfig(cwd, {
      configVersion: 1,
      commons: fixture.remoteUrl,
      overlays: [],
      project: "my-app",
      squads: [],
      workspaces: {},
    });

    // First clone so the dir exists, then overwrite memory.json with a newer format
    await ensureRepo(fixture.remoteUrl, home);

    // Push a newer-format memory.json into the bare repo
    await pushEntry(
      fixture,
      "memory.json",
      JSON.stringify({ formatVersion: 2, budgets: {} }),
    );

    // Re-sync to pull the updated memory.json
    await ensureRepo(fixture.remoteUrl, home);

    const result = await runStatus({ cwd, home });

    expect(result.exitCode).toBe(0);
    expect(result.output).toMatch(/upgrade/i);
  });
});

// 6. workspace map rendered; union scopes contain both stacks
describe("status — workspace scopes", () => {
  it("renders workspace entries and union session scopes", async () => {
    const cwd = await mkTmp();
    const home = await mkTmp();

    await saveConfig(cwd, {
      configVersion: 1,
      commons: "git@example.com:org/mem.git",
      overlays: [],
      project: "my-app",
      squads: [],
      workspaces: {
        ".": ["stack/nextjs"],
        "apps/studio": ["stack/sanity"],
      },
    });

    const result = await runStatus({ cwd, home });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain(".: stack/nextjs");
    expect(result.output).toContain("apps/studio: stack/sanity");
    expect(result.output).toContain("stack/nextjs");
    expect(result.output).toContain("stack/sanity");
  });
});

// 7. skills picture: none, and classification of materialized/shadowed/drifted
describe("status — skills", () => {
  const SKILL_CONFIG = {
    configVersion: 1 as const,
    overlays: [] as string[],
    project: "demo",
    squads: [] as string[],
    workspaces: {},
  };

  it("reports skills: none when the commons has no skills", async () => {
    const cwd = await mkTmp();
    const fixtureRoot = await mkTmp();
    const home = await mkTmp();
    const fixture = await makeCommonsFixture(fixtureRoot);
    await saveConfig(cwd, { ...SKILL_CONFIG, commons: fixture.remoteUrl });
    await runSync({ cwd, home });

    const result = await runStatus({ cwd, home });
    expect(result.output).toContain("skills: none");
  });

  it("classifies materialized, shadowed, and drifted skills", async () => {
    const cwd = await mkTmp();
    const fixtureRoot = await mkTmp();
    const home = await mkTmp();
    const target = await mkTmp();
    const fixture = await makeCommonsFixture(fixtureRoot);
    await pushEntry(
      fixture,
      "skills/one/SKILL.md",
      "---\nname: one\ndescription: d\n---\nbody",
    );
    await pushEntry(
      fixture,
      "skills/two/SKILL.md",
      "---\nname: two\ndescription: d\n---\nbody",
    );
    await saveConfig(cwd, { ...SKILL_CONFIG, commons: fixture.remoteUrl });

    // "two" exists personally BEFORE the first sync → shadowed
    await mkdir(path.join(target, "two"), { recursive: true });
    await writeFile(path.join(target, "two", "SKILL.md"), "personal", "utf8");

    await runSync({ cwd, home, skillsTargetDir: target });

    // drift "one" after materialization
    await writeFile(path.join(target, "one", "SKILL.md"), "edited", "utf8");

    const result = await runStatus({ cwd, home, skillsTargetDir: target });
    expect(result.output).toContain("shadowed by personal: two");
    expect(result.output).toContain("drifted (sync will restore): one");
    expect(result.output).toMatch(
      /skills last materialized: \d{4}-\d{2}-\d{2}/,
    );
  });
});
