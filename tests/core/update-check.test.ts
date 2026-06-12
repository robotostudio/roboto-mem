import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExecResult } from "../../src/core/exec.js";
import {
  checkForUpdate,
  type UpdateCheckInput,
} from "../../src/core/update-check.js";
import { tmpDirFactory } from "../helpers/tmp.js";

const okResult = (stdout: string): ExecResult => ({ ok: true, stdout });
const failResult = (): ExecResult => ({
  ok: false,
  reason: "exit",
  code: 1,
  stderr: "network error",
});

const lsRemoteOutput = (...tags: string[]): string =>
  tags.map((t) => `abc123\trefs/tags/${t}`).join("\n");

describe("checkForUpdate", () => {
  const tmp = tmpDirFactory("update-check-test-");
  afterEach(tmp.cleanup);
  const makeDir = tmp.make;

  const baseInput = async (
    overrides: Partial<UpdateCheckInput> = {},
  ): Promise<UpdateCheckInput> => ({
    home: await makeDir(),
    repoUrl: "https://github.com/robotostudio/roboto-mem",
    currentVersion: "0.1.0",
    now: () => new Date("2025-01-01T12:00:00Z"),
    lsRemote: vi.fn().mockResolvedValue(okResult(lsRemoteOutput("v0.2.0"))),
    ...overrides,
  });

  it("returns nag string when remote has a newer version", async () => {
    const result = await checkForUpdate(await baseInput());
    expect(result).toBe(
      "roboto-mem v0.2.0 available (you have v0.1.0) — run /mem-upgrade",
    );
  });

  it("returns undefined when remote version equals current", async () => {
    const result = await checkForUpdate(
      await baseInput({
        lsRemote: vi.fn().mockResolvedValue(okResult(lsRemoteOutput("v0.1.0"))),
      }),
    );
    expect(result).toBeUndefined();
  });

  it("returns undefined when remote version is older than current", async () => {
    const result = await checkForUpdate(
      await baseInput({
        currentVersion: "1.0.0",
        lsRemote: vi.fn().mockResolvedValue(okResult(lsRemoteOutput("v0.9.0"))),
      }),
    );
    expect(result).toBeUndefined();
  });

  it("throttles: does not call lsRemote when last check was < 24h ago, uses latestSeen", async () => {
    const input = await baseInput({
      now: () => new Date("2025-01-01T12:00:00Z"),
      lsRemote: vi.fn(),
    });
    // Write a state showing check was 1 hour ago with a newer latestSeen
    await fs.writeFile(
      path.join(input.home, "state.json"),
      JSON.stringify({
        lastUpdateCheck: new Date("2025-01-01T11:00:00Z").toISOString(),
        latestSeen: "v0.2.0",
      }),
    );

    const result = await checkForUpdate(input);

    expect(input.lsRemote).not.toHaveBeenCalled();
    expect(result).toBe(
      "roboto-mem v0.2.0 available (you have v0.1.0) — run /mem-upgrade",
    );
  });

  it("calls lsRemote when last check was > 24h ago", async () => {
    const lsRemote = vi
      .fn()
      .mockResolvedValue(okResult(lsRemoteOutput("v0.2.0")));
    const input = await baseInput({
      now: () => new Date("2025-01-01T12:00:00Z"),
      lsRemote,
    });
    await fs.writeFile(
      path.join(input.home, "state.json"),
      JSON.stringify({
        lastUpdateCheck: new Date("2024-12-31T10:00:00Z").toISOString(),
        latestSeen: "v0.1.0",
      }),
    );

    const result = await checkForUpdate(input);

    expect(lsRemote).toHaveBeenCalledOnce();
    expect(result).toBe(
      "roboto-mem v0.2.0 available (you have v0.1.0) — run /mem-upgrade",
    );
  });

  it("returns undefined and still stamps lastUpdateCheck when lsRemote fails", async () => {
    const fixedNow = new Date("2025-01-01T12:00:00Z");
    const lsRemote = vi.fn().mockResolvedValue(failResult());
    const input = await baseInput({ lsRemote, now: () => fixedNow });

    const result = await checkForUpdate(input);

    expect(result).toBeUndefined();

    const raw = await fs.readFile(path.join(input.home, "state.json"), "utf8");
    const state: { lastUpdateCheck?: string } = JSON.parse(raw);
    expect(state.lastUpdateCheck).toBe(fixedNow.toISOString());
  });

  it("treats corrupt state.json as empty and does a fresh check", async () => {
    const lsRemote = vi
      .fn()
      .mockResolvedValue(okResult(lsRemoteOutput("v0.2.0")));
    const input = await baseInput({ lsRemote });
    await fs.writeFile(path.join(input.home, "state.json"), "NOT JSON{{{");

    const result = await checkForUpdate(input);

    expect(lsRemote).toHaveBeenCalledOnce();
    expect(result).toBe(
      "roboto-mem v0.2.0 available (you have v0.1.0) — run /mem-upgrade",
    );
  });

  it("ignores peeled tags (^{}) and non-semver tags when parsing", async () => {
    const stdout = [
      "abc\trefs/tags/v0.2.0",
      "def\trefs/tags/v0.2.0^{}",
      "ghi\trefs/tags/not-semver",
      "jkl\trefs/tags/v0.1.5",
    ].join("\n");

    const result = await checkForUpdate(
      await baseInput({
        lsRemote: vi.fn().mockResolvedValue(okResult(stdout)),
      }),
    );

    // v0.2.0 is max valid tag, peeled entry and non-semver are skipped
    expect(result).toBe(
      "roboto-mem v0.2.0 available (you have v0.1.0) — run /mem-upgrade",
    );
  });
});
