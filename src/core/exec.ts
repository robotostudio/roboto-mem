import { execFile } from "node:child_process";

export type ExecResult =
  | { ok: true; stdout: string }
  | {
      ok: false;
      reason: "exit" | "spawn" | "timeout" | "maxbuffer";
      code: number;
      stderr: string;
    };

export interface ExecOptions {
  cwd?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export const exec = (
  cmd: string,
  args: string[],
  options?: ExecOptions,
): Promise<ExecResult> =>
  new Promise((resolve) => {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const child = execFile(
      cmd,
      args,
      { cwd: options?.cwd },
      (error, stdout, stderr) => {
        if (!error) {
          return resolve({ ok: true, stdout: stdout.trim() });
        }

        const trimmedStderr = stderr.trim();

        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return resolve({
            ok: false,
            reason: "spawn",
            code: -1,
            stderr: error.message,
          });
        }

        if (
          (error as NodeJS.ErrnoException).code ===
          "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
        ) {
          return resolve({
            ok: false,
            reason: "maxbuffer",
            code: -1,
            stderr: error.message,
          });
        }

        if (error.killed) {
          return resolve({
            ok: false,
            reason: "timeout",
            code: -1,
            stderr: `timeout after ${timeoutMs}ms`,
          });
        }

        const exitCode = (error as NodeJS.ErrnoException & { code?: unknown })
          .code;

        return resolve({
          ok: false,
          reason: "exit",
          code: typeof exitCode === "number" ? exitCode : -1,
          stderr: trimmedStderr || error.message,
        });
      },
    );

    const timer = setTimeout(() => {
      child.kill();
    }, timeoutMs);

    child.on("close", () => clearTimeout(timer));
  });
