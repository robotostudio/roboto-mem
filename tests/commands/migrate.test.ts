import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MIGRATED_CONFIG_FILE,
  runMigrate,
} from "../../src/commands/migrate.js";
import {
  CONFIG_FILE,
  loadConfigV2,
  type RepoConfig,
  saveConfig,
} from "../../src/core/config.js";
import { tmpDirFactory } from "../helpers/tmp.js";

const tmp = tmpDirFactory("rm-migrate-");
const mkTmp = tmp.make;
afterEach(tmp.cleanup);

const V1: RepoConfig = {
  configVersion: 1,
  commons: "https://github.com/team/commons",
  overlays: [],
  project: "my-app",
  squads: ["auth"],
  workspaces: {
    "apps/web": ["next", "react"],
    "apps/api": ["auth0", "nodejs"],
  },
};

const configPath = (dir: string): string => path.join(dir, CONFIG_FILE);
const migratedPath = (dir: string): string =>
  path.join(dir, MIGRATED_CONFIG_FILE);

const notWritten = async (dir: string): Promise<void> => {
  await expect(fs.access(migratedPath(dir))).rejects.toThrow();
};

describe("migrate — missing config", () => {
  it("exits 1 and mentions init when .roboto-mem.json is absent", async () => {
    const cwd = await mkTmp();
    const result = await runMigrate({ cwd });
    expect(result.exitCode).toBe(1);
    expect(result.output).toMatch(/init/i);
  });
});

describe("migrate — v1 only", () => {
  it("writes a .migrated file with libraries derived from workspaces + squads, and never touches the original", async () => {
    const cwd = await mkTmp();
    await saveConfig(cwd, V1);
    const before = await fs.readFile(configPath(cwd), "utf8");

    const result = await runMigrate({ cwd });

    expect(result.exitCode).toBe(0);
    expect(await fs.readFile(configPath(cwd), "utf8")).toBe(before);

    const migrated = JSON.parse(await fs.readFile(migratedPath(cwd), "utf8"));
    expect(migrated).toEqual({
      configVersion: 2,
      commons: V1.commons,
      libraries: ["next", "react", "auth0", "nodejs", "auth"],
    });
  });

  it("prints the migrated config and a rename instruction", async () => {
    const cwd = await mkTmp();
    await saveConfig(cwd, V1);
    const result = await runMigrate({ cwd });
    expect(result.output).toContain(MIGRATED_CONFIG_FILE);
    expect(result.output).toContain(
      `mv ${MIGRATED_CONFIG_FILE} ${CONFIG_FILE}`,
    );
  });
});

describe("migrate — v1 with overlays", () => {
  it("preserves overlays under librariesLocal and notes it in the output", async () => {
    const cwd = await mkTmp();
    await saveConfig(cwd, {
      ...V1,
      overlays: ["git@example.com:org/shared-overlay.git"],
    });

    const result = await runMigrate({ cwd });

    expect(result.exitCode).toBe(0);
    const migrated = JSON.parse(await fs.readFile(migratedPath(cwd), "utf8"));
    expect(migrated.librariesLocal).toEqual([
      "git@example.com:org/shared-overlay.git",
    ]);
    expect(result.output).toMatch(/librariesLocal/);
  });

  it("omits librariesLocal and its note when overlays is empty", async () => {
    const cwd = await mkTmp();
    await saveConfig(cwd, V1);
    const result = await runMigrate({ cwd });
    const migrated = JSON.parse(await fs.readFile(migratedPath(cwd), "utf8"));
    expect(migrated).not.toHaveProperty("librariesLocal");
    expect(result.output).not.toMatch(/librariesLocal/);
  });
});

describe("migrate — output loads as a real v2 config after rename", () => {
  it("loadConfigV2 accepts the migrated output verbatim (v1-only)", async () => {
    const cwd = await mkTmp();
    await saveConfig(cwd, V1);
    await runMigrate({ cwd });

    await fs.rename(migratedPath(cwd), configPath(cwd));
    const result = await loadConfigV2(cwd);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config).toEqual({
      configVersion: 2,
      commons: V1.commons,
      libraries: ["next", "react", "auth0", "nodejs", "auth"],
    });
  });

  it("loadConfigV2 still accepts it when librariesLocal (overlays) is present", async () => {
    const cwd = await mkTmp();
    await saveConfig(cwd, {
      ...V1,
      overlays: ["git@example.com:org/shared-overlay.git"],
    });
    await runMigrate({ cwd });

    await fs.rename(migratedPath(cwd), configPath(cwd));
    const result = await loadConfigV2(cwd);

    expect(result.ok).toBe(true);
  });
});

describe("migrate — malformed input", () => {
  it("exits 1 and writes no .migrated file when the JSON is unparseable", async () => {
    const cwd = await mkTmp();
    await fs.writeFile(configPath(cwd), "{not json", "utf8");
    const before = await fs.readFile(configPath(cwd), "utf8");

    const result = await runMigrate({ cwd });

    expect(result.exitCode).toBe(1);
    expect(await fs.readFile(configPath(cwd), "utf8")).toBe(before);
    await notWritten(cwd);
  });

  it("exits 1 with the field-level detail when a required v1 field is invalid", async () => {
    const cwd = await mkTmp();
    const { commons: _omit, ...withoutCommons } = V1;
    await fs.writeFile(configPath(cwd), JSON.stringify(withoutCommons), "utf8");

    const result = await runMigrate({ cwd });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("commons");
    await notWritten(cwd);
  });

  it("exits 1 for an unsupported configVersion (neither 1 nor 2)", async () => {
    const cwd = await mkTmp();
    await fs.writeFile(
      configPath(cwd),
      JSON.stringify({ ...V1, configVersion: 5 }),
      "utf8",
    );

    const result = await runMigrate({ cwd });

    expect(result.exitCode).toBe(1);
    await notWritten(cwd);
  });

  it("exits 1 (not throw) when the config path is a directory (EISDIR)", async () => {
    const cwd = await mkTmp();
    await fs.mkdir(configPath(cwd));

    const result = await runMigrate({ cwd });

    expect(result.exitCode).toBe(1);
    await notWritten(cwd);
  });
});

describe("migrate — idempotent", () => {
  it("is a no-op when the config is already configVersion 2", async () => {
    const cwd = await mkTmp();
    await fs.writeFile(
      configPath(cwd),
      JSON.stringify({
        configVersion: 2,
        commons: "https://github.com/team/commons",
        libraries: ["next"],
      }),
      "utf8",
    );
    const before = await fs.readFile(configPath(cwd), "utf8");

    const result = await runMigrate({ cwd });

    expect(result.exitCode).toBe(0);
    expect(result.output).toMatch(/already migrated/i);
    expect(await fs.readFile(configPath(cwd), "utf8")).toBe(before);
    await notWritten(cwd);
  });

  it("produces byte-identical .migrated output across repeated runs on the same v1 source", async () => {
    const cwd = await mkTmp();
    await saveConfig(cwd, V1);

    const first = await runMigrate({ cwd });
    const firstMigrated = await fs.readFile(migratedPath(cwd), "utf8");
    const firstOriginal = await fs.readFile(configPath(cwd), "utf8");

    const second = await runMigrate({ cwd });
    const secondMigrated = await fs.readFile(migratedPath(cwd), "utf8");
    const secondOriginal = await fs.readFile(configPath(cwd), "utf8");

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(secondMigrated).toBe(firstMigrated);
    expect(secondOriginal).toBe(firstOriginal);
  });
});
