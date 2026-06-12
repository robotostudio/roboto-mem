import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONFIG_FILE,
  CONFIG_VERSION,
  loadConfig,
  type RepoConfig,
  saveConfig,
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
});
