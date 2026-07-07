import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runInit } from "../../src/commands/init.js";
import { CONFIG_FILE, loadConfig, saveConfig } from "../../src/core/config.js";
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
