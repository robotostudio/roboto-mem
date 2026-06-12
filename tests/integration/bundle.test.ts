import { execFile } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { exec } from "../../src/core/exec.js";

const repoRoot = join(import.meta.dirname, "..", "..");
const dirs: string[] = [];
const makeDir = async (prefix: string): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

// citty prints --version/usage via consola, which writes to stderr; our exec
// wrapper drops stderr on success. Capture both streams raw for this test.
interface RawRun {
  code: number;
  stdout: string;
  stderr: string;
}
const rawRun = (args: string[], cwd: string): Promise<RawRun> => {
  // Vitest sets NODE_ENV=test and TEST=true; either alone silences consola
  // (citty's --version/usage printer) in the child. Strip the test-env family
  // so the artifact behaves like production.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => !["NODE_ENV", "TEST", "VITEST"].includes(k),
    ),
  );
  return new Promise((resolve) => {
    execFile(
      "node",
      args,
      { cwd, env, timeout: 30_000 },
      (error, stdout, stderr) =>
        resolve({
          code: error ? ((error as { code?: number }).code ?? 1) : 0,
          stdout,
          stderr,
        }),
    );
  });
};

afterAll(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});

describe("bundle self-containment (ADR 0004)", () => {
  it("the built artifact runs OUTSIDE the repo with no node_modules in reach", async () => {
    const outDir = await makeDir("rm-bundle-out-");
    const runDir = await makeDir("rm-bundle-run-");

    // Build with the real tsdown.config.ts (entry + noExternal), redirecting output.
    const build = await exec("npx", ["tsdown", "-d", outDir], {
      cwd: repoRoot,
      timeoutMs: 120_000,
    });
    expect(build.ok).toBe(true);

    // Copy the artifact away from the repo so bare imports cannot resolve
    // against our node_modules — this is what a git-installed plugin looks like.
    const isolated = join(runDir, "cli.mjs");
    await copyFile(join(outDir, "cli.mjs"), isolated);

    // A bare-import regression dies here with ERR_MODULE_NOT_FOUND (exit 1).
    const version = await rawRun([isolated, "--version"], runDir);
    expect(version.code).toBe(0);
    expect(version.stdout + version.stderr).toContain("0.1.0");

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
