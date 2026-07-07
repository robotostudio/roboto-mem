import { execFile } from "node:child_process";
import { join } from "node:path";
import { exec } from "../../src/core/exec.js";

const repoRoot = join(import.meta.dirname, "..", "..");

export interface RawRun {
  code: number;
  stdout: string;
  stderr: string;
}

// citty prints --version/usage via consola, which writes to stderr; our exec
// wrapper drops stderr on success. Capture both streams raw for these tests.
// Vitest sets NODE_ENV=test and TEST=true; either alone silences consola
// (citty's --version/usage printer) in the child. Strip the test-env family
// so the artifact behaves like production.
export const rawRun = (args: string[], cwd: string): Promise<RawRun> => {
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

/** Builds the real CLI via the repo's own tsdown config into `outDir`,
 * returning the path to the resulting cli.mjs. */
export const buildCliInto = async (
  outDir: string,
  timeoutMs = 120_000,
): Promise<string> => {
  const build = await exec("npx", ["tsdown", "-d", outDir], {
    cwd: repoRoot,
    timeoutMs,
  });
  if (!build.ok) {
    throw new Error(`tsdown build failed: ${build.stderr}`);
  }
  return join(outDir, "cli.mjs");
};
