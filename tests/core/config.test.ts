import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CONFIG_FILE,
  CONFIG_LEGACY_FIELDS_MESSAGE,
  CONFIG_V1_DEPRECATED_MESSAGE,
  CONFIG_VERSION,
  GLOBAL_CONFIG_FILE,
  globalConfigHome,
  loadConfig,
  loadConfigV2,
  loadGlobalConfig,
  type RepoConfig,
  type RepoConfigV2,
  saveConfig,
  saveConfigV2,
} from "../../src/core/config.js";
import { tmpDirFactory } from "../helpers/tmp.js";

const VALID_CONFIG: RepoConfig = {
  configVersion: 1,
  commons: "git@github.com:org/team-memory.git",
  overlays: ["git@github.com:org/squad-overlay.git"],
  project: "my-project",
  squads: ["platform", "growth"],
  workspaces: { platform: ["packages/platform"], growth: ["packages/growth"] },
};

const VALID_CONFIG_V2: RepoConfigV2 = {
  configVersion: 2,
  commons: "git@github.com:org/team-memory.git",
  libraries: ["resend", "next"],
};

describe("config", () => {
  const tmp = tmpDirFactory("rm-config-");
  afterEach(tmp.cleanup);
  const makeDir = tmp.make;

  it("returns missing when no config file exists", async () => {
    const dir = await makeDir();
    const result = await loadConfig(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("missing");
    }
  });

  it("returns invalid when file contains unparseable JSON", async () => {
    const dir = await makeDir();
    await fs.writeFile(path.join(dir, CONFIG_FILE), "{not json", "utf8");
    const result = await loadConfig(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid");
    }
  });

  it("returns invalid with detail mentioning missing field when commons is absent", async () => {
    const dir = await makeDir();
    const { commons: _omit, ...without } = VALID_CONFIG;
    await fs.writeFile(
      path.join(dir, CONFIG_FILE),
      JSON.stringify(without),
      "utf8",
    );
    const result = await loadConfig(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid");
      expect(result.detail).toContain("commons");
    }
  });

  it("returns newer-config when configVersion exceeds CONFIG_VERSION", async () => {
    const dir = await makeDir();
    const newer = { ...VALID_CONFIG, configVersion: CONFIG_VERSION + 1 };
    await fs.writeFile(
      path.join(dir, CONFIG_FILE),
      JSON.stringify(newer),
      "utf8",
    );
    const result = await loadConfig(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("newer-config");
      expect(result.detail).toMatch(/upgrade/i);
    }
  });

  it("roundtrips a full valid config via saveConfig then loadConfig", async () => {
    const dir = await makeDir();
    await saveConfig(dir, VALID_CONFIG);
    const result = await loadConfig(dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config).toEqual(VALID_CONFIG);
    }
  });

  it("preserves unknown future keys across a round trip", async () => {
    const dir = await makeDir();
    const withFuture = {
      ...VALID_CONFIG,
      futureKey: { x: 1 },
    };
    await fs.writeFile(
      path.join(dir, CONFIG_FILE),
      JSON.stringify(withFuture),
      "utf8",
    );
    const result = await loadConfig(dir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.raw).toHaveProperty("futureKey");

    // Re-save preserving the raw unknown keys
    await saveConfig(dir, result.config, result.raw);

    const text = await fs.readFile(path.join(dir, CONFIG_FILE), "utf8");
    const reparsed = JSON.parse(text) as Record<string, unknown>;
    expect(reparsed).toHaveProperty("futureKey");
    expect((reparsed.futureKey as { x: number }).x).toBe(1);
  });

  it("returns invalid with detail mentioning squads when squads is not an array", async () => {
    const dir = await makeDir();
    const bad = { ...VALID_CONFIG, squads: "not-an-array" };
    await fs.writeFile(
      path.join(dir, CONFIG_FILE),
      JSON.stringify(bad),
      "utf8",
    );
    const result = await loadConfig(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid");
      expect(result.detail).toContain("squads");
    }
  });

  it("returns invalid with detail mentioning squads when squads contains non-strings", async () => {
    const dir = await makeDir();
    const bad = { ...VALID_CONFIG, squads: [1, 2] };
    await fs.writeFile(
      path.join(dir, CONFIG_FILE),
      JSON.stringify(bad),
      "utf8",
    );
    const result = await loadConfig(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid");
      expect(result.detail).toContain("squads");
    }
  });

  it("returns invalid with detail mentioning workspaces when workspaces values contain non-strings", async () => {
    const dir = await makeDir();
    const bad = { ...VALID_CONFIG, workspaces: { ".": ["stack/next", 5] } };
    await fs.writeFile(
      path.join(dir, CONFIG_FILE),
      JSON.stringify(bad),
      "utf8",
    );
    const result = await loadConfig(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid");
      expect(result.detail).toContain("workspaces");
    }
  });

  it("writes file with 2-space indent and trailing newline", async () => {
    const dir = await makeDir();
    await saveConfig(dir, VALID_CONFIG);
    const text = await fs.readFile(path.join(dir, CONFIG_FILE), "utf8");
    // Trailing newline
    expect(text.endsWith("\n")).toBe(true);
    // 2-space indent: first indented line should start with exactly two spaces
    const lines = text.split("\n");
    const firstIndented = lines.find((l) => l.startsWith("  "));
    expect(firstIndented).toBeDefined();
    expect(
      firstIndented?.startsWith("    ") || firstIndented?.startsWith("  "),
    ).toBe(true);
    // Verify it's not 4-space by checking content matches JSON.stringify with 2
    const expected = `${JSON.stringify(VALID_CONFIG, null, 2)}\n`;
    expect(text).toBe(expected);
  });

  it("returns invalid (not throw) when config path is a directory (EISDIR)", async () => {
    const dir = await makeDir();
    // Create a DIRECTORY at the path loadConfig would readFile
    await fs.mkdir(path.join(dir, CONFIG_FILE));
    const result = await loadConfig(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid");
      expect(result.detail).toMatch(/unreadable/i);
    }
  });

  // Phase 2 (global library model): CONFIG_VERSION is bumped to 2 so a
  // future splice into loadConfig doesn't also need a version-gate bump —
  // see docs/design-specs/2026-07-17-global-library-model.md.
  it("CONFIG_VERSION constant equals 2", () => {
    expect(CONFIG_VERSION).toBe(2);
  });

  // Regression: the v1-only loadConfig path cannot execute a real v2-shaped
  // config (no v1 fields at all — configVersion, commons, libraries only) —
  // it must keep degrading to newer-config (graceful stale-cache+nag), not
  // "invalid: overlays must be an array of strings", even though 2 is no
  // longer numerically greater than CONFIG_VERSION post-bump.
  it("treats a real v2-shaped config as newer-config (old CLI safety net)", async () => {
    const dir = await makeDir();
    await fs.writeFile(
      path.join(dir, CONFIG_FILE),
      JSON.stringify(VALID_CONFIG_V2),
      "utf8",
    );
    const result = await loadConfig(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("newer-config");
      expect(result.detail).toMatch(/upgrade/i);
    }
  });
});

describe("config v2 (loadConfigV2)", () => {
  const tmp = tmpDirFactory("rm-config-v2-");
  afterEach(tmp.cleanup);
  const makeDir = tmp.make;

  const write = async (dir: string, value: unknown): Promise<void> => {
    await fs.writeFile(
      path.join(dir, CONFIG_FILE),
      JSON.stringify(value),
      "utf8",
    );
  };

  it("returns missing when no config file exists", async () => {
    const dir = await makeDir();
    const result = await loadConfigV2(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("missing");
  });

  it("roundtrips a full valid v2 config (commons + libraries)", async () => {
    const dir = await makeDir();
    await write(dir, VALID_CONFIG_V2);
    const result = await loadConfigV2(dir);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config).toEqual(VALID_CONFIG_V2);
  });

  it("defaults libraries to [] when the key is omitted", async () => {
    const dir = await makeDir();
    await write(dir, { configVersion: 2, commons: "git@x:y/z.git" });
    const result = await loadConfigV2(dir);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config.libraries).toEqual([]);
  });

  it("saveConfigV2 round-trips through loadConfigV2", async () => {
    const dir = await makeDir();
    await saveConfigV2(dir, VALID_CONFIG_V2);
    const result = await loadConfigV2(dir);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config).toEqual(VALID_CONFIG_V2);
  });

  it("saveConfigV2 writes 2-space-indented JSON with a trailing newline", async () => {
    const dir = await makeDir();
    await saveConfigV2(dir, VALID_CONFIG_V2);
    const raw = await fs.readFile(path.join(dir, CONFIG_FILE), "utf8");
    expect(raw).toBe(`${JSON.stringify(VALID_CONFIG_V2, null, 2)}\n`);
  });

  it("returns invalid with detail mentioning commons when commons is missing", async () => {
    const dir = await makeDir();
    await write(dir, { configVersion: 2, libraries: [] });
    const result = await loadConfigV2(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid");
      expect(result.detail).toContain("commons");
    }
  });

  it("returns invalid with detail mentioning libraries when libraries contains non-strings", async () => {
    const dir = await makeDir();
    await write(dir, {
      configVersion: 2,
      commons: "git@x:y/z.git",
      libraries: ["resend", 5],
    });
    const result = await loadConfigV2(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid");
      expect(result.detail).toContain("libraries");
    }
  });

  it("returns invalid with detail mentioning configVersion when it is missing", async () => {
    const dir = await makeDir();
    await write(dir, { commons: "git@x:y/z.git" });
    const result = await loadConfigV2(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid");
      expect(result.detail).toContain("configVersion");
    }
  });

  it("rejects an unsupported configVersion between formats (e.g. 0) as invalid", async () => {
    const dir = await makeDir();
    await write(dir, { configVersion: 0, commons: "git@x:y/z.git" });
    const result = await loadConfigV2(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid");
      expect(result.detail).toContain("configVersion");
    }
  });

  it("returns newer-config when configVersion exceeds 2", async () => {
    const dir = await makeDir();
    await write(dir, { configVersion: 3, commons: "git@x:y/z.git" });
    const result = await loadConfigV2(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("newer-config");
      expect(result.detail).toMatch(/upgrade/i);
    }
  });

  it("rejects configVersion 1 with the exact v1-deprecated migrate message", async () => {
    const dir = await makeDir();
    await write(dir, VALID_CONFIG);
    const result = await loadConfigV2(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid");
      expect(result.detail).toBe(CONFIG_V1_DEPRECATED_MESSAGE);
      expect(result.detail).toContain("roboto-mem migrate");
    }
  });

  it("rejects configVersion 2 with all v1 legacy fields present (hybrid) with the exact legacy-fields message", async () => {
    const dir = await makeDir();
    await write(dir, {
      configVersion: 2,
      commons: "git@x:y/z.git",
      project: "my-project",
      squads: ["platform"],
      workspaces: {},
      overlays: [],
    });
    const result = await loadConfigV2(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid");
      expect(result.detail).toBe(CONFIG_LEGACY_FIELDS_MESSAGE);
    }
  });

  it("rejects configVersion 2 with a single stray v1 field present (hybrid)", async () => {
    const dir = await makeDir();
    await write(dir, {
      configVersion: 2,
      commons: "git@x:y/z.git",
      project: "my-project",
    });
    const result = await loadConfigV2(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid");
      expect(result.detail).toBe(CONFIG_LEGACY_FIELDS_MESSAGE);
    }
  });

  it("returns invalid (not throw) when config path is a directory (EISDIR)", async () => {
    const dir = await makeDir();
    await fs.mkdir(path.join(dir, CONFIG_FILE));
    const result = await loadConfigV2(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid");
      expect(result.detail).toMatch(/unreadable/i);
    }
  });

  it("returns invalid when file contains unparseable JSON", async () => {
    const dir = await makeDir();
    await fs.writeFile(path.join(dir, CONFIG_FILE), "{not json", "utf8");
    const result = await loadConfigV2(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid");
  });

  it("returns invalid when the JSON parses to a non-object (e.g. an array)", async () => {
    const dir = await makeDir();
    await fs.writeFile(path.join(dir, CONFIG_FILE), "[1, 2, 3]", "utf8");
    const result = await loadConfigV2(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid");
      expect(result.detail).toContain("JSON object");
    }
  });
});

describe("globalConfigHome", () => {
  it("returns ROBOTO_MEM_CONFIG_HOME when env var is set", () => {
    const saved = process.env.ROBOTO_MEM_CONFIG_HOME;
    try {
      process.env.ROBOTO_MEM_CONFIG_HOME = "/custom/config/path";
      expect(globalConfigHome()).toBe("/custom/config/path");
    } finally {
      if (saved === undefined) {
        delete process.env.ROBOTO_MEM_CONFIG_HOME;
      } else {
        process.env.ROBOTO_MEM_CONFIG_HOME = saved;
      }
    }
  });

  it("ends with .config/roboto-mem when env var is not set", () => {
    const saved = process.env.ROBOTO_MEM_CONFIG_HOME;
    try {
      delete process.env.ROBOTO_MEM_CONFIG_HOME;
      expect(
        globalConfigHome().endsWith(path.join(".config", "roboto-mem")),
      ).toBe(true);
    } finally {
      if (saved !== undefined) {
        process.env.ROBOTO_MEM_CONFIG_HOME = saved;
      }
    }
  });
});

describe("global config (loadGlobalConfig)", () => {
  const tmp = tmpDirFactory("rm-global-config-");
  afterEach(tmp.cleanup);
  const makeDir = tmp.make;

  it("returns missing when no global config file exists", async () => {
    const home = await makeDir();
    const result = await loadGlobalConfig(home);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("missing");
  });

  it("returns the commons suggestion when the global config is valid", async () => {
    const home = await makeDir();
    await fs.writeFile(
      path.join(home, GLOBAL_CONFIG_FILE),
      JSON.stringify({ commons: "https://github.com/team/commons" }),
      "utf8",
    );
    const result = await loadGlobalConfig(home);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.commons).toBe("https://github.com/team/commons");
    }
  });

  it("returns ok with commons undefined when the global config is an empty object", async () => {
    const home = await makeDir();
    await fs.writeFile(
      path.join(home, GLOBAL_CONFIG_FILE),
      JSON.stringify({}),
      "utf8",
    );
    const result = await loadGlobalConfig(home);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.config.commons).toBeUndefined();
  });

  it("returns invalid when commons is present but not a string", async () => {
    const home = await makeDir();
    await fs.writeFile(
      path.join(home, GLOBAL_CONFIG_FILE),
      JSON.stringify({ commons: 5 }),
      "utf8",
    );
    const result = await loadGlobalConfig(home);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid");
      expect(result.detail).toContain("commons");
    }
  });
});

describe("config precedence — project overrides global; missing project = silence", () => {
  const tmp = tmpDirFactory("rm-config-precedence-");
  const makeDir = tmp.make;
  // Shared across beforeEach/afterEach (never reassigned, only .value
  // mutated) so each test can point ROBOTO_MEM_CONFIG_HOME at its own
  // globalDir and still leave the env var exactly as it found it.
  const priorConfigHome: { value: string | undefined } = { value: undefined };

  beforeEach(() => {
    priorConfigHome.value = process.env.ROBOTO_MEM_CONFIG_HOME;
  });

  afterEach(async () => {
    await tmp.cleanup();
    if (priorConfigHome.value === undefined) {
      delete process.env.ROBOTO_MEM_CONFIG_HOME;
    } else {
      process.env.ROBOTO_MEM_CONFIG_HOME = priorConfigHome.value;
    }
  });

  it("loadConfig/loadConfigV2 never fall back to a populated global config (silence holds)", async () => {
    const projectDir = await makeDir();
    const globalDir = await makeDir();
    process.env.ROBOTO_MEM_CONFIG_HOME = globalDir;
    await fs.writeFile(
      path.join(globalDir, GLOBAL_CONFIG_FILE),
      JSON.stringify({ commons: "https://github.com/team/commons" }),
      "utf8",
    );

    const v1Result = await loadConfig(projectDir);
    expect(v1Result.ok).toBe(false);
    if (!v1Result.ok) expect(v1Result.reason).toBe("missing");

    const v2Result = await loadConfigV2(projectDir);
    expect(v2Result.ok).toBe(false);
    if (!v2Result.ok) expect(v2Result.reason).toBe("missing");
  });

  it("project config wins even when global declares a different commons URL", async () => {
    const projectDir = await makeDir();
    const globalDir = await makeDir();
    process.env.ROBOTO_MEM_CONFIG_HOME = globalDir;
    await fs.writeFile(
      path.join(globalDir, GLOBAL_CONFIG_FILE),
      JSON.stringify({ commons: "https://github.com/team/global-commons" }),
      "utf8",
    );
    await fs.writeFile(
      path.join(projectDir, CONFIG_FILE),
      JSON.stringify({
        configVersion: 2,
        commons: "https://github.com/team/project-commons",
        libraries: [],
      }),
      "utf8",
    );

    const result = await loadConfigV2(projectDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.commons).toBe(
        "https://github.com/team/project-commons",
      );
    }
  });
});
