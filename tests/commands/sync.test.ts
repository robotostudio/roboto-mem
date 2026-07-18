import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runSync } from "../../src/commands/sync.js";
import { CONFIG_FILE, saveConfig } from "../../src/core/config.js";
import {
  makeCommonsFixture,
  makeV2CommonsFixture,
  pushEntry,
} from "../helpers/git.js";
import { tmpDirFactory } from "../helpers/tmp.js";

const V2_CONFIG = (commons: string, libraries: string[]): string =>
  `${JSON.stringify({ configVersion: 2, commons, libraries }, null, 2)}\n`;

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

  it("materializes commons skills into the target dir and reports it", async () => {
    const cwd = await makeDir();
    const tmp = await makeDir();
    const home = await makeDir();
    const target = await makeDir();
    const fixture = await makeCommonsFixture(tmp);

    await pushEntry(
      fixture,
      "skills/grill-me/SKILL.md",
      "---\nname: grill-me\ndescription: d\n---\nbody",
    );

    await saveConfig(cwd, {
      configVersion: 1,
      commons: fixture.remoteUrl,
      overlays: [],
      project: "demo",
      squads: [],
      workspaces: {},
    });

    const result = await runSync({ cwd, home, skillsTargetDir: target });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("skills: 1 materialized");

    const skillMd = await fs.readFile(
      path.join(target, "grill-me", "SKILL.md"),
      "utf8",
    );
    expect(skillMd).toContain("name: grill-me");
  });
});

describe("sync command — v2 (global library model)", () => {
  const tmp = tmpDirFactory("rm-sync-v2-");
  afterEach(tmp.cleanup);
  const makeDir = tmp.make;

  const writeV2Config = (
    cwd: string,
    commons: string,
    libraries: string[],
  ): Promise<void> =>
    fs.writeFile(
      path.join(cwd, CONFIG_FILE),
      V2_CONFIG(commons, libraries),
      "utf8",
    );

  it("syncs declared libraries to ~/.roboto-mem/libraries and reports them", async () => {
    const cwd = await makeDir();
    const home = await makeDir();
    const fixture = await makeV2CommonsFixture(await makeDir(), {
      resend: { "LIBRARY.md": "# Resend\nSummary." },
      next: { "LIBRARY.md": "# Next\nSummary." },
    });
    await writeV2Config(cwd, fixture.remoteUrl, ["resend", "next"]);

    const result = await runSync({ cwd, home });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain(`synced ${fixture.remoteUrl}`);
    expect(result.output).toContain("libraries: 2 synced");

    const resendMd = await fs.readFile(
      path.join(home, "libraries", "resend", "LIBRARY.md"),
      "utf8",
    );
    expect(resendMd).toBe("# Resend\nSummary.");
  });

  it("auto-pulls without a confirm function (non-TTY default)", async () => {
    const cwd = await makeDir();
    const home = await makeDir();
    const fixture = await makeV2CommonsFixture(await makeDir(), {
      resend: { "LIBRARY.md": "v1" },
    });
    await writeV2Config(cwd, fixture.remoteUrl, ["resend"]);

    // first sync materializes; second sync (upstream changed) has no confirm
    // wired at all and must still proceed — non-TTY/default = auto-pull.
    expect((await runSync({ cwd, home })).exitCode).toBe(0);
    await pushEntry(fixture, "libraries/resend/LIBRARY.md", "v2");

    const result = await runSync({ cwd, home });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("libraries: 1 synced");
    const resendMd = await fs.readFile(
      path.join(home, "libraries", "resend", "LIBRARY.md"),
      "utf8",
    );
    expect(resendMd).toBe("v2");
  });

  it("skips pending libraries when the injected confirm returns false", async () => {
    const cwd = await makeDir();
    const home = await makeDir();
    const fixture = await makeV2CommonsFixture(await makeDir(), {
      resend: { "LIBRARY.md": "v1" },
    });
    await writeV2Config(cwd, fixture.remoteUrl, ["resend"]);
    expect((await runSync({ cwd, home })).exitCode).toBe(0);
    await pushEntry(fixture, "libraries/resend/LIBRARY.md", "v2");

    const confirmCalls: string[] = [];
    const result = await runSync({
      cwd,
      home,
      confirmLibrarySync: async (message) => {
        confirmCalls.push(message);
        return false;
      },
    });

    expect(result.exitCode).toBe(0);
    expect(confirmCalls).toHaveLength(1);
    expect(result.output).toContain("skipped: resend");
    const resendMd = await fs.readFile(
      path.join(home, "libraries", "resend", "LIBRARY.md"),
      "utf8",
    );
    expect(resendMd).toBe("v1");
  });

  it("applies pending libraries when the injected confirm returns true", async () => {
    const cwd = await makeDir();
    const home = await makeDir();
    const fixture = await makeV2CommonsFixture(await makeDir(), {
      resend: { "LIBRARY.md": "v1" },
    });
    await writeV2Config(cwd, fixture.remoteUrl, ["resend"]);
    expect((await runSync({ cwd, home })).exitCode).toBe(0);
    await pushEntry(fixture, "libraries/resend/LIBRARY.md", "v2");

    const result = await runSync({
      cwd,
      home,
      confirmLibrarySync: async () => true,
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("libraries: 1 synced");
  });

  it("exits 2 when a declared library is missing from commons (partial failure)", async () => {
    const cwd = await makeDir();
    const home = await makeDir();
    const fixture = await makeV2CommonsFixture(await makeDir(), {
      resend: { "LIBRARY.md": "hi" },
    });
    await writeV2Config(cwd, fixture.remoteUrl, ["resend", "sanity"]);

    const result = await runSync({ cwd, home });

    expect(result.exitCode).toBe(2);
    expect(result.output).toContain("libraries: 1 synced");
    expect(result.output).toContain("failed: sanity");
  });

  it("still materializes commons skills for a v2 project", async () => {
    const cwd = await makeDir();
    const home = await makeDir();
    const target = await makeDir();
    const fixture = await makeV2CommonsFixture(await makeDir(), {});
    await pushEntry(
      fixture,
      "skills/grill-me/SKILL.md",
      "---\nname: grill-me\ndescription: d\n---\nbody",
    );
    await writeV2Config(cwd, fixture.remoteUrl, []);

    const result = await runSync({ cwd, home, skillsTargetDir: target });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("skills: 1 materialized");
  });

  it("exits 1 mentioning init when config is missing (same as v1)", async () => {
    const cwd = await makeDir();
    const home = await makeDir();
    const result = await runSync({ cwd, home });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("init");
  });

  it("surfaces the legacy-fields error for a hybrid v2+v1 config without falling back to v1", async () => {
    const cwd = await makeDir();
    const home = await makeDir();
    const hybrid = {
      configVersion: 2,
      commons: "https://example.com/commons.git",
      libraries: [],
      project: "demo",
      squads: [],
      workspaces: {},
      overlays: [],
    };
    await fs.writeFile(
      path.join(cwd, CONFIG_FILE),
      `${JSON.stringify(hybrid, null, 2)}\n`,
      "utf8",
    );

    const result = await runSync({ cwd, home });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("legacy fields");
  });
});
