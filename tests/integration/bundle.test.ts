import { copyFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { exec } from "../../src/core/exec.js";
import { buildCliInto, rawRun } from "../helpers/cli-runner.js";
import { tmpDirFactory } from "../helpers/tmp.js";

const repoRoot = join(import.meta.dirname, "..", "..");
const tmp = tmpDirFactory("rm-bundle-");

afterAll(tmp.cleanup);

describe("bundle self-containment (ADR 0004)", () => {
  it("the built artifact runs OUTSIDE the repo with no node_modules in reach", async () => {
    const outDir = await tmp.make();
    const runDir = await tmp.make();

    // Build with the real tsdown.config.ts (entry + noExternal), redirecting output.
    const builtCli = await buildCliInto(outDir);

    // Copy the artifact away from the repo so bare imports cannot resolve
    // against our node_modules — this is what a git-installed plugin looks like.
    const isolated = join(runDir, "cli.mjs");
    await copyFile(builtCli, isolated);

    // A bare-import regression dies here with ERR_MODULE_NOT_FOUND (exit 1).
    const version = await rawRun([isolated, "--version"], runDir);
    expect(version.code).toBe(0);
    const { version: pkgVersion } = JSON.parse(
      await readFile(join(repoRoot, "package.json"), "utf8"),
    ) as { version: string };
    expect(version.stdout + version.stderr).toContain(pkgVersion);

    // Prove citty is actually wired (entrypoint guard ran runMain).
    const usage = await rawRun([isolated, "not-a-command"], runDir);
    expect(usage.stdout + usage.stderr).toContain("init|sync|digest");

    // Hook mode in a configless dir must stay a silent success even in isolation.
    const hook = await exec("node", [isolated, "digest", "--hook"], {
      cwd: runDir,
    });
    expect(hook).toEqual({ ok: true, stdout: "" });
  }, 150_000);
});
