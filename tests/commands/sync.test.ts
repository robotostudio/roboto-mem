import { afterEach, describe, expect, it } from "vitest";
import { runSync } from "../../src/commands/sync.js";
import { saveConfig } from "../../src/core/config.js";
import { makeCommonsFixture } from "../helpers/git.js";
import { tmpDirFactory } from "../helpers/tmp.js";

describe("sync command", () => {
  const tmp = tmpDirFactory("rm-sync-");
  afterEach(tmp.cleanup);
  const makeDir = tmp.make;

  it("exits 1 mentioning init when config is missing", async () => {
    const cwd = await makeDir();
    const home = await makeDir();
    const result = await runSync({ cwd, home });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("init");
  });

  it("syncs commons and emits synced line, exits 0", async () => {
    const cwd = await makeDir();
    const tmp = await makeDir();
    const home = await makeDir();

    const fixture = await makeCommonsFixture(tmp);

    await saveConfig(cwd, {
      configVersion: 1,
      commons: fixture.remoteUrl,
      overlays: [],
      project: "demo",
      squads: [],
      workspaces: {},
    });

    const result = await runSync({ cwd, home });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain(`synced ${fixture.remoteUrl}`);
  });

  it("lists overlay lines in output", async () => {
    const cwd = await makeDir();
    const tmp = await makeDir();
    const tmp2 = await makeDir();
    const home = await makeDir();

    const commons = await makeCommonsFixture(tmp);
    const overlay = await makeCommonsFixture(tmp2);

    await saveConfig(cwd, {
      configVersion: 1,
      commons: commons.remoteUrl,
      overlays: [overlay.remoteUrl],
      project: "demo",
      squads: [],
      workspaces: {},
    });

    const result = await runSync({ cwd, home });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain(`synced ${commons.remoteUrl}`);
    expect(result.output).toContain(`synced ${overlay.remoteUrl}`);
  });

  it("exits 1 when commons clone fails (bad URL)", async () => {
    const cwd = await makeDir();
    const home = await makeDir();

    await saveConfig(cwd, {
      configVersion: 1,
      commons: "/nonexistent-url/that-does-not-exist.git",
      overlays: [],
      project: "demo",
      squads: [],
      workspaces: {},
    });

    const result = await runSync({ cwd, home });
    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/FAILED/i);
  });
});
