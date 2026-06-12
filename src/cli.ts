import { realpathSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { defineCommand, runMain } from "citty";
import { runDigest } from "./commands/digest.js";
import { runInit } from "./commands/init.js";
import { runLint } from "./commands/lint.js";
import { runPromote } from "./commands/promote.js";
import { runStatus } from "./commands/status.js";
import { runSync } from "./commands/sync.js";
import { exec } from "./core/exec.js";
import { memoryHome } from "./core/memory-repo.js";
import { checkForUpdate } from "./core/update-check.js";
import { VERSION } from "./core/version.js";

// must match .claude-plugin/plugin.json "repository"
const REPO_URL = "https://github.com/robotostudio/roboto-mem";

const todayYMD = (): string => new Date().toISOString().slice(0, 10);

const emit = (result: { exitCode: number; output: string }): void => {
  if (result.output) {
    process.stdout.write(
      result.output.endsWith("\n") ? result.output : `${result.output}\n`,
    );
  }
  process.exitCode = result.exitCode;
};

export const splitSquads = (raw: string): string[] =>
  raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export const validatePromoteType = (
  raw: string,
): "standard" | "lesson" | undefined => {
  if (raw === "standard" || raw === "lesson") return raw;
  return undefined;
};

const safeNag = async (): Promise<string | undefined> => {
  try {
    return await checkForUpdate({
      home: memoryHome(),
      repoUrl: REPO_URL,
      currentVersion: VERSION,
      now: () => new Date(),
      lsRemote: (url) =>
        exec("git", ["ls-remote", "--tags", url], { timeoutMs: 5000 }),
    });
  } catch {
    return undefined;
  }
};

const initCmd = defineCommand({
  meta: { name: "init", description: "Initialise roboto-mem in a project" },
  args: {
    dir: { type: "positional", default: ".", description: "Project directory" },
    "commons-url": { type: "string", description: "Commons repo URL" },
    project: { type: "string", description: "Project name" },
    squads: { type: "string", description: "Comma-separated squad names" },
    commons: { type: "boolean", description: "Scaffold commons repo" },
  },
  async run({ args }) {
    const result = await runInit({
      dir: args.dir as string,
      commonsUrl: args["commons-url"] as string | undefined,
      project: args.project as string | undefined,
      squads: args.squads ? splitSquads(args.squads as string) : undefined,
      scaffoldCommons: args.commons as boolean | undefined,
    });
    emit(result);
  },
});

const syncCmd = defineCommand({
  meta: { name: "sync", description: "Sync memory repos" },
  args: {},
  async run() {
    const result = await runSync({ cwd: process.cwd() });
    emit(result);
  },
});

const digestCmd = defineCommand({
  meta: { name: "digest", description: "Emit memory digest for the session" },
  args: {
    hook: { type: "boolean", description: "Run in hook mode (prepend nag)" },
  },
  async run({ args }) {
    const hook = Boolean(args.hook);
    const nag = hook ? await safeNag() : undefined;
    try {
      const result = await runDigest({
        cwd: process.cwd(),
        hook,
        nag,
      });
      emit(result);
    } catch (err: unknown) {
      if (!hook) throw err;
      const message = err instanceof Error ? err.message : String(err);
      process.stdout.write(
        `${JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "SessionStart",
            additionalContext: `> Team Memory digest failed unexpectedly: ${message}. Run roboto-mem status to investigate.`,
          },
        })}\n`,
      );
      process.exitCode = 0;
    }
  },
});

const promoteCmd = defineCommand({
  meta: { name: "promote", description: "Promote an entry to the commons" },
  args: {
    scope: { type: "string", description: "Entry scope" },
    type: { type: "string", description: "Entry type: standard | lesson" },
    name: { type: "string", description: "Entry name" },
    description: { type: "string", description: "Short description" },
    author: { type: "string", description: "Author" },
    date: {
      type: "string",
      description: "Date (YYYY-MM-DD)",
    },
    "body-file": {
      type: "string",
      description: "Path to file containing body",
    },
    overrides: { type: "string", description: "Override refs" },
    force: { type: "boolean", description: "Overwrite existing entry" },
  },
  async run({ args }) {
    const rawType = (args.type as string | undefined) ?? "";
    const resolvedType = validatePromoteType(rawType);
    if (!resolvedType) {
      process.stderr.write(
        `Error: --type must be "standard" or "lesson", got "${rawType}"\n`,
      );
      process.exitCode = 1;
      return;
    }

    const bodyFile = args["body-file"] as string | undefined;
    const bodyResult = bodyFile
      ? await fs
          .readFile(path.resolve(bodyFile), "utf8")
          .then((text): { ok: true; text: string } => ({ ok: true, text }))
          .catch((): { ok: false } => ({ ok: false }))
      : ({ ok: true, text: "" } as { ok: true; text: string });

    if (!bodyResult.ok) {
      process.stderr.write(`Error: cannot read --body-file "${bodyFile}"\n`);
      process.exitCode = 1;
      return;
    }
    const body = bodyResult.text;

    const result = await runPromote({
      cwd: process.cwd(),
      scope: (args.scope as string | undefined) ?? "",
      type: resolvedType,
      name: (args.name as string | undefined) ?? "",
      description: (args.description as string | undefined) ?? "",
      body,
      author: (args.author as string | undefined) ?? "",
      date: (args.date as string | undefined) ?? todayYMD(),
      overrides: args.overrides as string | undefined,
      force: Boolean(args.force),
    });
    emit(result);
  },
});

const lintCmd = defineCommand({
  meta: { name: "lint", description: "Lint memory entries in a directory" },
  args: {
    dir: { type: "positional", default: ".", description: "Directory to lint" },
  },
  async run({ args }) {
    const result = await runLint({ dir: args.dir as string });
    emit(result);
  },
});

const statusCmd = defineCommand({
  meta: {
    name: "status",
    description: "Show memory repo status for the current project",
  },
  args: {},
  async run() {
    const result = await runStatus({ cwd: process.cwd() });
    emit(result);
  },
});

export const main = defineCommand({
  meta: {
    name: "roboto-mem",
    version: VERSION,
    description: "Team Memory for Claude Code",
  },
  subCommands: {
    init: initCmd,
    sync: syncCmd,
    digest: digestCmd,
    promote: promoteCmd,
    lint: lintCmd,
    status: statusCmd,
  },
});

// Only run when invoked directly, not when imported by tests
const isEntrypoint = (() => {
  try {
    const argv1 = process.argv[1];
    if (!argv1) return false;
    // Realpath BOTH sides: the ESM loader realpaths the main module URL, while
    // argv[1] arrives as typed — under symlinked dirs (macOS /var -> /private/var)
    // a plain path.resolve comparison misses and the CLI silently does nothing.
    const real = (p: string): string => {
      try {
        return realpathSync(p);
      } catch {
        return path.resolve(p);
      }
    };
    return real(path.resolve(argv1)) === real(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isEntrypoint) {
  runMain(main);
}
