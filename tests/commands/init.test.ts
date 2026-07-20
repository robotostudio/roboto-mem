import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runInit } from "../../src/commands/init.js";
import {
  CONFIG_FILE,
  loadConfig,
  loadConfigV2,
  saveConfig,
} from "../../src/core/config.js";
import { makeV2CommonsFixture, pushEntry } from "../helpers/git.js";
import { tmpDirFactory } from "../helpers/tmp.js";

describe("init command", () => {
  const tmp = tmpDirFactory("rm-init-");
  afterEach(tmp.cleanup);
  const makeDir = tmp.make;

  // 1. bind: detects stacks from package.json deps, writes config, output mentions scopes
  it("bind: writes config and mentions detected stacks and project scope", async () => {
    const dir = await makeDir();
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ dependencies: { next: "14.0.0", react: "18.0.0" } }),
      "utf8",
    );

    const result = await runInit({
      dir,
      commonsUrl: "git@x:y/z.git",
      project: "loggle",
      squads: ["web"],
    });

    expect(result.exitCode).toBe(0);

    const configPath = path.join(dir, CONFIG_FILE);
    await expect(fs.access(configPath)).resolves.toBeUndefined();

    const loaded = await loadConfig(dir);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error("config should be ok");

    expect(loaded.config.commons).toBe("git@x:y/z.git");
    expect(loaded.config.project).toBe("loggle");
    expect(loaded.config.squads).toEqual(["web"]);
    expect(loaded.config.workspaces["."]).toContain("stack/nextjs");
    expect(loaded.config.workspaces["."]).toContain("stack/react");

    expect(result.output).toContain("stack/nextjs");
    expect(result.output).toContain("project/loggle");
  });

  // 2. bind without commonsUrl on a fresh dir → exitCode 1
  it("bind: exits 1 with usage message when commonsUrl and project are missing", async () => {
    const dir = await makeDir();

    const result = await runInit({ dir });

    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/--commons-url/i);
  });

  // 3. re-run: preserves overlays + unknown keys, refreshes workspaces
  it("bind: re-run refreshes workspaces, preserves overlays and unknown raw keys", async () => {
    const dir = await makeDir();

    // seed initial config via saveConfig (overlays preserved)
    await saveConfig(dir, {
      configVersion: 1,
      commons: "git@x:y/z.git",
      project: "loggle",
      squads: ["web"],
      overlays: ["git@x:y/o.git"],
      workspaces: {},
    });

    // write the config file again with an extra unknown key (futureKey)
    const existing = JSON.parse(
      await fs.readFile(path.join(dir, CONFIG_FILE), "utf8"),
    ) as Record<string, unknown>;
    existing.futureKey = "preserved";
    await fs.writeFile(
      path.join(dir, CONFIG_FILE),
      `${JSON.stringify(existing, null, 2)}\n`,
      "utf8",
    );

    // add sanity dep
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ dependencies: { sanity: "3.0.0" } }),
      "utf8",
    );

    const result = await runInit({ dir });

    expect(result.exitCode).toBe(0);

    const loaded = await loadConfig(dir);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error("config should be ok");

    expect(loaded.config.overlays).toEqual(["git@x:y/o.git"]);
    expect(loaded.config.workspaces["."]).toContain("stack/sanity");

    // futureKey must still be in the raw file
    const rawFile = JSON.parse(
      await fs.readFile(path.join(dir, CONFIG_FILE), "utf8"),
    ) as Record<string, unknown>;
    expect(rawFile.futureKey).toBe("preserved");
  });

  // 4. newer config → exitCode 1, output mentions upgrade
  it("bind: exits 1 when config version is newer than supported", async () => {
    const dir = await makeDir();
    await fs.writeFile(
      path.join(dir, CONFIG_FILE),
      JSON.stringify({
        configVersion: 2,
        commons: "git@x:y/z.git",
        project: "p",
        squads: [],
        overlays: [],
        workspaces: {},
      }),
      "utf8",
    );

    const result = await runInit({
      dir,
      commonsUrl: "git@x:y/z.git",
      project: "p",
    });

    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/upgrade/i);
  });

  // 5. scaffold: creates all expected files with correct content
  it("scaffold: creates memory.json, CODEOWNERS, README.md, CI workflow, and entry gitkeeps", async () => {
    const dir = await makeDir();

    const result = await runInit({ dir, scaffoldCommons: true });

    expect(result.exitCode).toBe(0);

    await expect(
      fs.access(path.join(dir, "memory.json")),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(dir, "CODEOWNERS")),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(dir, "README.md")),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(dir, ".github", "workflows", "memory-ci.yml")),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(dir, "entries", "org", ".gitkeep")),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(dir, "entries", "squads", ".gitkeep")),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(dir, "entries", "stacks", ".gitkeep")),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(dir, "entries", "projects", ".gitkeep")),
    ).resolves.toBeUndefined();

    const memJson = JSON.parse(
      await fs.readFile(path.join(dir, "memory.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(memJson.formatVersion).toBe(1);
    expect(memJson.budgets).toBeTruthy();

    // CI runs the CLI vendored into the Commons — no tokens, no network.
    const vendored = await fs.readFile(
      path.join(dir, ".roboto-mem", "cli.mjs"),
    );
    const distBundle = await fs.readFile(
      path.join(import.meta.dirname, "..", "..", "dist", "cli.mjs"),
    );
    expect(vendored.equals(distBundle)).toBe(true);
    const workflow = await fs.readFile(
      path.join(dir, ".github", "workflows", "memory-ci.yml"),
      "utf8",
    );
    expect(workflow).toContain("node .roboto-mem/cli.mjs lint");
    expect(workflow).not.toContain("npx");
    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("push:");
    expect(workflow).toContain("branches: [main]");
  });

  it("scaffold: creates skills/ with gitkeep and a CODEOWNERS line", async () => {
    const dir = await makeDir();
    const result = await runInit({ dir, scaffoldCommons: true });
    expect(result.exitCode).toBe(0);
    await expect(
      fs.access(path.join(dir, "skills", ".gitkeep")),
    ).resolves.toBeUndefined();
    const codeowners = await fs.readFile(path.join(dir, "CODEOWNERS"), "utf8");
    expect(codeowners).toContain("skills/ @your-org/standards-group");
    const readme = await fs.readFile(path.join(dir, "README.md"), "utf8");
    expect(readme).toContain("## Team Skills");
  });

  // 6. scaffold refuses second run
  it("scaffold: exits 1, output mentions memory.json, pre-existing sentinel file unchanged", async () => {
    const dir = await makeDir();

    // write a sentinel memory.json (not via scaffold — raw write so content is known)
    const memJsonPath = path.join(dir, "memory.json");
    const sentinelContent = JSON.stringify({
      formatVersion: 1,
      sentinel: true,
    });
    await fs.writeFile(memJsonPath, sentinelContent, "utf8");

    const result = await runInit({ dir, scaffoldCommons: true });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("memory.json");
    // file must be byte-unchanged
    expect(await fs.readFile(memJsonPath, "utf8")).toBe(sentinelContent);
  });

  // 6b. scaffold never overwrites a pre-existing file when memory.json is
  // absent (the exact accident: scaffolding into an already-populated repo)
  it("scaffold: never overwrites a pre-existing README.md/CODEOWNERS, reports them skipped, still writes the rest", async () => {
    const dir = await makeDir();

    const customReadme =
      "# My Project\n\nThis is a real project, not a Commons.";
    const customCodeowners = "* @someone-else\n";
    await fs.writeFile(path.join(dir, "README.md"), customReadme, "utf8");
    await fs.writeFile(path.join(dir, "CODEOWNERS"), customCodeowners, "utf8");

    const result = await runInit({ dir, scaffoldCommons: true });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("README.md (exists, skipped)");
    expect(result.output).toContain("CODEOWNERS (exists, skipped)");

    // pre-existing files are byte-unchanged
    expect(await fs.readFile(path.join(dir, "README.md"), "utf8")).toBe(
      customReadme,
    );
    expect(await fs.readFile(path.join(dir, "CODEOWNERS"), "utf8")).toBe(
      customCodeowners,
    );

    // files that did NOT already exist are still written normally
    await expect(
      fs.access(path.join(dir, "memory.json")),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(dir, "entries", "org", ".gitkeep")),
    ).resolves.toBeUndefined();
    const memJson = JSON.parse(
      await fs.readFile(path.join(dir, "memory.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(memJson.formatVersion).toBe(1);
  });

  // 7. scaffold output mentions next steps; bind output lists derived scope union
  it("scaffold: output mentions next steps (push + bind)", async () => {
    const dir = await makeDir();
    const result = await runInit({ dir, scaffoldCommons: true });

    expect(result.output).toMatch(/push/i);
    expect(result.output).toMatch(/--commons-url/i);
  });

  // 8. bind: corrupt config → exitCode 1, file unchanged
  it("bind: exits 1 and leaves file unchanged when config is corrupt JSON", async () => {
    const dir = await makeDir();
    const corruptContent = "{not json";
    await fs.writeFile(path.join(dir, CONFIG_FILE), corruptContent, "utf8");

    const result = await runInit({
      dir,
      commonsUrl: "git@x:y/z.git",
      project: "p",
    });

    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/corrupt/i);
    expect(result.output).toContain(CONFIG_FILE);
    // file must be byte-unchanged — corrupt JSON not clobbered
    expect(await fs.readFile(path.join(dir, CONFIG_FILE), "utf8")).toBe(
      corruptContent,
    );
  });

  // Regression: an existing v1 config rebinding with a bare --commons-url and
  // no --project must stay on the v1 path (updating commons, preserving the
  // existing project) — not get misrouted to the v2 flow, which would reject
  // it with "Config already exists". See init.ts's usesLibraryModel dispatch.
  it("bind: existing v1 config + --commons-url (no --project) rebinds v1, preserving project", async () => {
    const dir = await makeDir();
    await saveConfig(dir, {
      configVersion: 1,
      commons: "git@x:y/old.git",
      project: "loggle",
      squads: ["web"],
      overlays: [],
      workspaces: {},
    });

    const result = await runInit({ dir, commonsUrl: "git@x:y/new.git" });

    expect(result.exitCode).toBe(0);

    const loaded = await loadConfig(dir);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error("config should be ok");
    expect(loaded.config.configVersion).toBe(1);
    expect(loaded.config.commons).toBe("git@x:y/new.git");
    expect(loaded.config.project).toBe("loggle");
    expect(loaded.config.squads).toEqual(["web"]);
  });

  it("bind: output lists the full derived scope union", async () => {
    const dir = await makeDir();
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ dependencies: { next: "14.0.0" } }),
      "utf8",
    );

    const result = await runInit({
      dir,
      commonsUrl: "git@x:y/z.git",
      project: "loggle",
      squads: ["web"],
    });

    expect(result.exitCode).toBe(0);
    // org is always first in session scopes
    expect(result.output).toContain("org");
    // squad scope
    expect(result.output).toContain("squad/web");
    // project scope
    expect(result.output).toContain("project/loggle");
    // stack scope from next dep
    expect(result.output).toContain("stack/nextjs");
  });
});

describe("init command — v2 (global library model)", () => {
  const tmp = tmpDirFactory("rm-init-v2-");
  afterEach(tmp.cleanup);
  const makeDir = tmp.make;

  it("commons-url without project: detects libraries from package.json, writes v2 config, auto-syncs", async () => {
    const dir = await makeDir();
    const home = await makeDir();
    const target = await makeDir();
    const fixture = await makeV2CommonsFixture(await makeDir(), {
      resend: { "LIBRARY.md": "# Resend\nSummary." },
      next: { "LIBRARY.md": "# Next\nSummary." },
      sanity: { "LIBRARY.md": "# Sanity\nSummary." },
    });
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ dependencies: { resend: "1.0.0", next: "14.0.0" } }),
      "utf8",
    );

    const result = await runInit({
      dir,
      commonsUrl: fixture.remoteUrl,
      home,
      skillsTargetDir: target,
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain(`Bound commons: ${fixture.remoteUrl}`);
    expect(result.output).toContain("Libraries: next, resend");
    expect(result.output).toContain("Libraries synced.");

    const loaded = await loadConfigV2(dir);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error("config should be ok");
    expect(loaded.config.configVersion).toBe(2);
    expect(loaded.config.commons).toBe(fixture.remoteUrl);
    expect(loaded.config.libraries.sort()).toEqual(["next", "resend"]);

    // auto-sync step 10: libraries materialized into home/libraries/
    const resendMd = await fs.readFile(
      path.join(home, "libraries", "resend", "LIBRARY.md"),
      "utf8",
    );
    expect(resendMd).toBe("# Resend\nSummary.");
  });

  it("explicit libraries overrides auto-detection entirely", async () => {
    const dir = await makeDir();
    const home = await makeDir();
    const fixture = await makeV2CommonsFixture(await makeDir(), {
      resend: { "LIBRARY.md": "hi" },
      sanity: { "LIBRARY.md": "hi" },
    });
    // deps would detect "resend"; explicit override picks "sanity" instead
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ dependencies: { resend: "1.0.0" } }),
      "utf8",
    );

    const result = await runInit({
      dir,
      commonsUrl: fixture.remoteUrl,
      libraries: ["sanity"],
      home,
      skillsTargetDir: await makeDir(),
    });

    expect(result.exitCode).toBe(0);
    const loaded = await loadConfigV2(dir);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.config.libraries).toEqual(["sanity"]);
  });

  it("no package.json: writes an empty libraries array without erroring", async () => {
    const dir = await makeDir();
    const home = await makeDir();
    const fixture = await makeV2CommonsFixture(await makeDir(), {
      resend: { "LIBRARY.md": "hi" },
    });

    const result = await runInit({
      dir,
      commonsUrl: fixture.remoteUrl,
      home,
      skillsTargetDir: await makeDir(),
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Libraries: (none)");
    const loaded = await loadConfigV2(dir);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.config.libraries).toEqual([]);
  });

  it("config already exists: exits 1 mentioning update-libraries, does not overwrite", async () => {
    const dir = await makeDir();
    const existingContent = JSON.stringify(
      {
        configVersion: 2,
        commons: "https://example.com/old.git",
        libraries: [],
      },
      null,
      2,
    );
    await fs.writeFile(path.join(dir, CONFIG_FILE), existingContent, "utf8");

    const result = await runInit({
      dir,
      commonsUrl: "https://example.com/new.git",
      home: await makeDir(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("Config already exists");
    expect(result.output).toContain("roboto-mem update-libraries");
    expect(await fs.readFile(path.join(dir, CONFIG_FILE), "utf8")).toBe(
      existingContent,
    );
  });

  it("commons has no libraries/ directory: exits 1 with a clear error", async () => {
    const dir = await makeDir();
    const fixture = await makeV2CommonsFixture(await makeDir(), {});

    const result = await runInit({
      dir,
      commonsUrl: fixture.remoteUrl,
      home: await makeDir(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("Commons has no libraries");
    await expect(fs.access(path.join(dir, CONFIG_FILE))).rejects.toThrow();
  });

  it("scoped dependency with no alias: still exits 0, warns in output", async () => {
    const dir = await makeDir();
    const fixture = await makeV2CommonsFixture(await makeDir(), {
      resend: { "LIBRARY.md": "hi" },
    });
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({
        dependencies: { resend: "1.0.0", "@unknown-scope/thing": "1.0.0" },
      }),
      "utf8",
    );

    const result = await runInit({
      dir,
      commonsUrl: fixture.remoteUrl,
      home: await makeDir(),
      skillsTargetDir: await makeDir(),
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain(
      "WARNING: Couldn't map @unknown-scope/thing to a known library",
    );
    const loaded = await loadConfigV2(dir);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.config.libraries).toEqual(["resend"]);
  });

  it("clone/pull failure: exits 1 with a clear network error, no config written", async () => {
    const dir = await makeDir();

    const result = await runInit({
      dir,
      commonsUrl: "/nonexistent-url/that-does-not-exist.git",
      home: await makeDir(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("Cannot reach commons");
    await expect(fs.access(path.join(dir, CONFIG_FILE))).rejects.toThrow();
  });

  it("libraries flag alone (no commons-url, no project) still falls back to the v1 usage message", async () => {
    const dir = await makeDir();

    const result = await runInit({ dir, libraries: ["resend"] });

    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/--commons-url/i);
    expect(result.output).toMatch(/--project/i);
  });

  it("an empty-string commons-url reaches the v2 flow's own usage message (project still undefined)", async () => {
    const dir = await makeDir();

    const result = await runInit({ dir, commonsUrl: "" });

    expect(result.exitCode).toBe(1);
    expect(result.output).toBe(
      [
        "Missing required option.",
        "  --commons-url <git-url>   URL of the Commons memory repo",
        "",
        "Example:",
        "  roboto-mem init --commons-url https://github.com/org/team-memory.git",
      ].join("\n"),
    );
  });

  it("interactive selectLibraries callback shapes the final list (detected + manual add)", async () => {
    const dir = await makeDir();
    const home = await makeDir();
    const fixture = await makeV2CommonsFixture(await makeDir(), {
      resend: { "LIBRARY.md": "hi" },
      next: { "LIBRARY.md": "hi" },
    });
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ dependencies: { resend: "1.0.0" } }),
      "utf8",
    );

    const seen: { available: string[]; detected: string[] }[] = [];
    const result = await runInit({
      dir,
      commonsUrl: fixture.remoteUrl,
      home,
      skillsTargetDir: await makeDir(),
      selectLibraries: async (input) => {
        seen.push(input);
        return [...input.detected, "next"];
      },
    });

    expect(result.exitCode).toBe(0);
    expect(seen).toEqual([
      { available: ["next", "resend"], detected: ["resend"] },
    ]);
    const loaded = await loadConfigV2(dir);
    expect(loaded.ok).toBe(true);
    if (loaded.ok)
      expect(loaded.config.libraries.sort()).toEqual(["next", "resend"]);
  });

  it("selectLibraries returning undefined (cancelled) aborts without writing config", async () => {
    const dir = await makeDir();
    const fixture = await makeV2CommonsFixture(await makeDir(), {
      resend: { "LIBRARY.md": "hi" },
    });

    const result = await runInit({
      dir,
      commonsUrl: fixture.remoteUrl,
      home: await makeDir(),
      selectLibraries: async () => undefined,
    });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("Cancelled");
    await expect(fs.access(path.join(dir, CONFIG_FILE))).rejects.toThrow();
  });

  it("declining the selectLibraries confirm returns an empty list without asking add/remove", async () => {
    const dir = await makeDir();
    const home = await makeDir();
    const fixture = await makeV2CommonsFixture(await makeDir(), {
      resend: { "LIBRARY.md": "hi" },
    });
    await fs.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ dependencies: { resend: "1.0.0" } }),
      "utf8",
    );

    const result = await runInit({
      dir,
      commonsUrl: fixture.remoteUrl,
      home,
      skillsTargetDir: await makeDir(),
      selectLibraries: async () => [],
    });

    expect(result.exitCode).toBe(0);
    const loaded = await loadConfigV2(dir);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.config.libraries).toEqual([]);
  });

  it("sync partial failure after write still exits 0, config already on disk, output warns", async () => {
    const dir = await makeDir();
    const home = await makeDir();
    const fixture = await makeV2CommonsFixture(await makeDir(), {
      resend: { "LIBRARY.md": "hi" },
    });

    const result = await runInit({
      dir,
      commonsUrl: fixture.remoteUrl,
      libraries: ["resend", "nonexistent-lib"],
      home,
      skillsTargetDir: await makeDir(),
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("WARNING: sync did not fully complete");
    const loaded = await loadConfigV2(dir);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.config.libraries.sort()).toEqual([
        "nonexistent-lib",
        "resend",
      ]);
    }
  });

  it("materializes commons skills as part of the v2 auto-sync step", async () => {
    const dir = await makeDir();
    const home = await makeDir();
    const target = await makeDir();
    const fixture = await makeV2CommonsFixture(await makeDir(), {});
    await pushEntry(
      fixture,
      "skills/grill-me/SKILL.md",
      "---\nname: grill-me\ndescription: d\n---\nbody",
    );
    // give commons a libraries/ dir so detection doesn't error (still 0 declared)
    await pushEntry(fixture, "libraries/resend/LIBRARY.md", "hi");

    const result = await runInit({
      dir,
      commonsUrl: fixture.remoteUrl,
      libraries: [],
      home,
      skillsTargetDir: target,
    });

    expect(result.exitCode).toBe(0);
    const skillMd = await fs.readFile(
      path.join(target, "grill-me", "SKILL.md"),
      "utf8",
    );
    expect(skillMd).toContain("name: grill-me");
  });
});
