import { realpathSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ArgsDef,
  type CommandDef,
  defineCommand,
  runCommand,
  runMain,
  showUsage,
} from "citty";
import { runDigest } from "./commands/digest.js";
import { runInit } from "./commands/init.js";
import { runLint } from "./commands/lint.js";
import { runMigrate } from "./commands/migrate.js";
import { runPromote } from "./commands/promote.js";
import { runPromoteLibrary } from "./commands/promote-library.js";
import { runSkillAdd, runSkillPromote } from "./commands/skill.js";
import { runStatus } from "./commands/status.js";
import { runSync } from "./commands/sync.js";
import { isEntryType, todayYMD } from "./core/entry.js";
import { exec } from "./core/exec.js";
import {
  type PromoteResolved,
  type Resolved,
  resolveInitPrompts,
  resolvePromotePrompts,
  resolveSkillAddPrompts,
  resolveSkillPromotePrompts,
  submitPromote,
} from "./core/interactive.js";
import { defaultSkillsTarget } from "./core/materialize.js";
import { memoryHome } from "./core/memory-repo.js";
import { createClackDriver, isInteractiveTty } from "./core/prompt-driver.js";
import {
  buildInitOptions,
  INIT_FIELD_DESC,
  type InitPromptResult,
  type InitProvided,
  PROMOTE_FIELD_DESC,
  type PromoteProvided,
  SKILL_ADD_FIELD_DESC,
  SKILL_PROMOTE_FIELD_DESC,
  type SkillAddPromptResult,
  type SkillAddProvided,
  type SkillPromotePromptResult,
  type SkillPromoteProvided,
} from "./core/prompts.js";
import { splitSquads } from "./core/scopes.js";
import { checkForUpdate } from "./core/update-check.js";
import { VERSION } from "./core/version.js";

// must match .claude-plugin/plugin.json "repository"
const REPO_URL = "https://github.com/robotostudio/roboto-mem";

const emit = (result: { exitCode: number; output: string }): void => {
  if (result.output) {
    process.stdout.write(
      result.output.endsWith("\n") ? result.output : `${result.output}\n`,
    );
  }
  process.exitCode = result.exitCode;
};

// Cancel (Ctrl-C / clack cancel symbol, or declining a summary confirm) always
// looks like this: no partial output, no side effects, exit 1.
const reportCancelled = (): void => {
  process.stderr.write("Cancelled.\n");
  process.exitCode = 1;
};

/**
 * skill add's SOURCE and skill promote's NAME positionals must be `required:
 * false` in citty so a TTY session can reach the guided prompt for them
 * (citty's own arg-parser throws — before run() ever executes — for a
 * missing `required` positional). But `required: false` ALSO flips citty's
 * own renderUsage() bracket style for that arg from `<NAME>` to `[NAME]`, so
 * showUsage() can no longer reproduce today's non-TTY usage output byte-for-
 * byte on its own. Render it against a display-only clone with that one arg
 * flipped back to required, so the text stays identical to what citty used
 * to print, while the REAL command definition (used for actual parsing)
 * stays permissive. Non-TTY output is otherwise unaffected by this file.
 */
const reportMissingPositional = async <T extends ArgsDef>(
  cmd: CommandDef<T>,
  parent: CommandDef<ArgsDef>,
  argKey: string,
  argName: string,
): Promise<void> => {
  // cmd.args is always a plain object literal for our own commands (never
  // citty's async-thunk Resolvable<T> form), so this cast is safe.
  const realArgs = cmd.args as Record<string, object>;
  const displayCmd: CommandDef<T> = {
    ...cmd,
    args: {
      ...realArgs,
      [argKey]: { ...realArgs[argKey], required: true },
    } as T,
  };
  // showUsage only ever reads parent.meta (never its args shape), so this
  // narrowing cast is safe despite citty's showUsage<T> tying cmd and parent
  // to the same T.
  await showUsage(displayCmd, parent as CommandDef<T>);
  process.stderr.write(
    `\n ERROR  Missing required positional argument: ${argName}\n\n`,
  );
  process.exitCode = 1;
};

export const validatePromoteType = (
  raw: string,
): "standard" | "lesson" | undefined => (isEntryType(raw) ? raw : undefined);

const failTypeError = (raw: string): void => {
  process.stderr.write(
    `Error: --type must be "standard" or "lesson", got "${raw}"\n`,
  );
  process.exitCode = 1;
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

/**
 * Real, clack-backed library confirm/add/remove for init's v2 (global
 * library model) flow — built here (not in init.ts, which stays prompt-
 * module-free like every other command) and injected as a plain callback.
 * Mirrors the design spec's init steps 7–8 literally: declining the initial
 * confirm skips straight to an empty list (no add/remove asked); accepting
 * it allows freeform additions/removals on top of the detected set.
 */
const selectLibraries = async (input: {
  available: string[];
  detected: string[];
}): Promise<string[] | undefined> => {
  const driver = await createClackDriver();
  const message = [
    `Available in commons: ${input.available.length ? input.available.join(", ") : "(none)"}`,
    `Detected in your deps: ${input.detected.length ? input.detected.join(", ") : "(none)"}`,
    "Load these libraries?",
  ].join("\n");
  const proceed = await driver.confirm({ message, initialValue: true });
  if (driver.isCancel(proceed)) return undefined;
  if (proceed !== true) return [];

  const added = await driver.text({
    message: "Add more? (comma-separated names, or press enter)",
  });
  if (driver.isCancel(added)) return undefined;
  const removed = await driver.text({
    message: "Remove any? (comma-separated names, or press enter)",
  });
  if (driver.isCancel(removed)) return undefined;

  const removedSet = new Set(splitSquads(String(removed)));
  return [
    ...new Set([...input.detected, ...splitSquads(String(added))]),
  ].filter((lib) => !removedSet.has(lib));
};

const initCmd = defineCommand({
  meta: { name: "init", description: "Initialise roboto-mem in a project" },
  args: {
    dir: { type: "positional", default: ".", description: INIT_FIELD_DESC.dir },
    "commons-url": { type: "string", description: INIT_FIELD_DESC.commonsUrl },
    project: { type: "string", description: INIT_FIELD_DESC.project },
    squads: { type: "string", description: INIT_FIELD_DESC.squads },
    commons: { type: "boolean", description: INIT_FIELD_DESC.scaffoldCommons },
    libraries: { type: "string", description: INIT_FIELD_DESC.libraries },
  },
  async run({ args }) {
    const dir = args.dir as string;
    const provided: InitProvided = {
      project: args.project as string | undefined,
      commonsUrl: args["commons-url"] as string | undefined,
      squads: args.squads as string | undefined,
      scaffoldCommons: args.commons as boolean | undefined,
      libraries: args.libraries as string | undefined,
    };

    const filled: Resolved<InitPromptResult> = isInteractiveTty()
      ? await resolveInitPrompts(provided, await createClackDriver(), dir)
      : { cancelled: false, options: buildInitOptions(provided, {}) };

    if (filled.cancelled) {
      reportCancelled();
      return;
    }

    const result = await runInit({
      dir,
      ...filled.options,
      selectLibraries: isInteractiveTty() ? selectLibraries : undefined,
    });
    emit(result);
  },
});

/**
 * Real, clack-backed confirm for sync's library-collision gate — built here
 * (not in sync.ts, which must stay prompt-module-free; see
 * tests/cli.test.ts's "prompt module isolation" suite) and injected as a
 * plain callback. Non-TTY leaves confirmLibrarySync undefined, which
 * core/library.ts's materializeLibraries treats as auto-pull.
 */
const confirmLibrarySync = async (message: string): Promise<boolean> => {
  const driver = await createClackDriver();
  const answer = await driver.confirm({ message, initialValue: true });
  return answer === true;
};

const syncCmd = defineCommand({
  meta: { name: "sync", description: "Sync memory repos" },
  args: {},
  async run() {
    const result = await runSync({
      cwd: process.cwd(),
      confirmLibrarySync: isInteractiveTty() ? confirmLibrarySync : undefined,
    });
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

// Distinct from entry `promote` and `skill promote` — pushes a locally
// materialized library (~/.roboto-mem/libraries/<name>) to the commons via
// PR. Deliberately NOT registered as promoteCmd's citty `subCommands`: citty
// scans raw argv for the first token not starting with "-" to resolve a
// subcommand, with no notion of "this token is a flag's value" — so
// `roboto-mem promote --scope org ...` would misread "org" as an unknown
// subcommand, AND citty never `return`s after dispatching a matched
// subCommand (both the subcommand's run AND the parent's own run would
// fire). promoteCmd.run below dispatches on `rawArgs[0] === "library"`
// manually instead, sidestepping both issues.
const promoteLibraryCmd = defineCommand({
  meta: {
    name: "library",
    description:
      "Promote a local library (~/.roboto-mem/libraries/<name>) to the commons (opens a PR)",
  },
  args: {
    // required:false so the reportMissingPositional pattern below (mirrors
    // skillAdd/skillPromote) renders this command's own usage rather than
    // citty's default parse-time throw.
    name: { type: "positional", description: "Library name", required: false },
    "commons-url": {
      type: "string",
      description:
        "Commons repo URL (defaults to the project's .roboto-mem.json)",
    },
    author: { type: "string", description: "Author" },
    date: { type: "string", description: "Date (YYYY-MM-DD)" },
  },
  async run({ args }) {
    if (!args.name) {
      // promoteCmd (unlike skillCmd, the parent in every other
      // reportMissingPositional call) has a concrete `args` shape, so its
      // inferred CommandDef<T> isn't structurally assignable to the
      // ArgsDef-generic `parent` parameter — same variance reportMissingPositional
      // itself already casts through internally for showUsage.
      await reportMissingPositional(
        promoteLibraryCmd,
        promoteCmd as CommandDef<ArgsDef>,
        "name",
        "NAME",
      );
      return;
    }
    const result = await runPromoteLibrary({
      cwd: process.cwd(),
      name: args.name as string,
      commonsUrl: args["commons-url"] as string | undefined,
      author: (args.author as string | undefined) ?? "",
      date: (args.date as string | undefined) ?? todayYMD(),
    });
    emit(result);
  },
});

const promoteCmd = defineCommand({
  meta: { name: "promote", description: "Promote an entry to the commons" },
  args: {
    scope: { type: "string", description: PROMOTE_FIELD_DESC.scope },
    type: { type: "string", description: PROMOTE_FIELD_DESC.type },
    name: { type: "string", description: PROMOTE_FIELD_DESC.name },
    description: {
      type: "string",
      description: PROMOTE_FIELD_DESC.description,
    },
    author: { type: "string", description: PROMOTE_FIELD_DESC.author },
    date: {
      type: "string",
      description: PROMOTE_FIELD_DESC.date,
    },
    "body-file": {
      type: "string",
      description: PROMOTE_FIELD_DESC.bodyFile,
    },
    overrides: { type: "string", description: PROMOTE_FIELD_DESC.overrides },
    force: { type: "boolean", description: PROMOTE_FIELD_DESC.force },
  },
  async run({ args, rawArgs }) {
    // `roboto-mem promote library <name>` — manual dispatch (see the
    // comment above promoteLibraryCmd for why this isn't a citty
    // subCommand). Nothing about entry-promote's own flags (--scope,
    // --type, etc.) ever starts with a bare "library" token, so this can
    // only match the real `promote library ...` invocation.
    if (rawArgs[0] === "library") {
      await runCommand(promoteLibraryCmd, { rawArgs: rawArgs.slice(1) });
      return;
    }

    const provided: PromoteProvided = {
      scope: args.scope as string | undefined,
      type: args.type as string | undefined,
      name: args.name as string | undefined,
      description: args.description as string | undefined,
      author: args.author as string | undefined,
      date: args.date as string | undefined,
      bodyFile: args["body-file"] as string | undefined,
    };

    // Validate flags that WERE passed before any prompting/driver work, so a
    // bad flag fails fast instead of after a guided-flow summary confirm.
    if (provided.type !== undefined && !validatePromoteType(provided.type)) {
      failTypeError(provided.type);
      return;
    }
    if (provided.bodyFile !== undefined) {
      const readable = await access(path.resolve(provided.bodyFile)).then(
        () => true,
        () => false,
      );
      if (!readable) {
        process.stderr.write(
          `Error: cannot read --body-file "${provided.bodyFile}"\n`,
        );
        process.exitCode = 1;
        return;
      }
    }

    const driver = isInteractiveTty() ? await createClackDriver() : undefined;

    const filled: PromoteResolved = driver
      ? await resolvePromotePrompts(provided, driver, process.cwd())
      : { cancelled: false, guided: false, options: provided };

    if (filled.cancelled) {
      reportCancelled();
      return;
    }
    const { options } = filled;

    const resolvedType = validatePromoteType(options.type ?? "");
    if (!resolvedType) {
      failTypeError(options.type ?? "");
      return;
    }

    const bodyFile = options.bodyFile;
    const bodyResult = bodyFile
      ? await readFile(path.resolve(bodyFile), "utf8")
          .then((text): { ok: true; text: string } => ({ ok: true, text }))
          .catch((): { ok: false } => ({ ok: false }))
      : ({ ok: true, text: "" } as { ok: true; text: string });

    if (!bodyResult.ok) {
      process.stderr.write(`Error: cannot read --body-file "${bodyFile}"\n`);
      process.exitCode = 1;
      return;
    }
    const body = bodyResult.text;

    const promoteInput = {
      cwd: process.cwd(),
      scope: options.scope ?? "",
      type: resolvedType,
      name: options.name ?? "",
      description: options.description ?? "",
      body,
      author: options.author ?? "",
      date: options.date ?? todayYMD(),
      overrides: args.overrides as string | undefined,
      force: Boolean(args.force),
    };

    // Collision confirm-retry only ever applies to a genuinely guided run —
    // flags-only and non-TTY call runPromote directly, same error as always.
    if (!filled.guided) {
      const result = await runPromote(promoteInput);
      emit(result);
      return;
    }

    const submitted = await submitPromote(promoteInput, filled.driver);
    if (submitted.cancelled) {
      reportCancelled();
      return;
    }
    emit(submitted.result);
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

const migrateCmd = defineCommand({
  meta: {
    name: "migrate",
    description: "Migrate .roboto-mem.json from configVersion 1 to 2",
  },
  args: {},
  async run() {
    const result = await runMigrate({ cwd: process.cwd() });
    emit(result);
  },
});

const skillAddCmd = defineCommand({
  meta: {
    name: "add",
    description:
      "Vendor a skill from GitHub/skills.sh into the commons (opens a PR)",
  },
  args: {
    // required:false so a TTY session can reach the guided source prompt —
    // see reportMissingPositional for how non-TTY output stays unchanged.
    source: {
      type: "positional",
      description: SKILL_ADD_FIELD_DESC.source,
      required: false,
    },
    skill: {
      type: "string",
      description: SKILL_ADD_FIELD_DESC.skill,
    },
    ref: { type: "string", description: SKILL_ADD_FIELD_DESC.ref },
    author: { type: "string", description: SKILL_ADD_FIELD_DESC.author },
    date: { type: "string", description: SKILL_ADD_FIELD_DESC.date },
  },
  async run({ args }) {
    const provided: SkillAddProvided = {
      source: args.source as string | undefined,
      skill: args.skill as string | undefined,
      ref: args.ref as string | undefined,
      author: args.author as string | undefined,
    };

    if (!provided.source && !isInteractiveTty()) {
      await reportMissingPositional(skillAddCmd, skillCmd, "source", "SOURCE");
      return;
    }

    const filled: Resolved<SkillAddPromptResult> = isInteractiveTty()
      ? await resolveSkillAddPrompts(
          provided,
          await createClackDriver(),
          process.cwd(),
        )
      : { cancelled: false, options: provided };

    if (filled.cancelled) {
      reportCancelled();
      return;
    }

    const result = await runSkillAdd({
      cwd: process.cwd(),
      source: filled.options.source ?? "",
      skill: filled.options.skill,
      ref: filled.options.ref,
      author: filled.options.author ?? "",
      date: (args.date as string | undefined) ?? todayYMD(),
    });
    emit(result);
  },
});

const skillPromoteCmd = defineCommand({
  meta: {
    name: "promote",
    description:
      "Promote a personal skill (~/.claude/skills/<name>) into the commons (opens a PR)",
  },
  args: {
    // required:false so a TTY session can reach the guided personal-skill
    // select — see reportMissingPositional for the non-TTY parity story.
    name: {
      type: "positional",
      description: SKILL_PROMOTE_FIELD_DESC.name,
      required: false,
    },
    author: { type: "string", description: SKILL_PROMOTE_FIELD_DESC.author },
    date: { type: "string", description: SKILL_PROMOTE_FIELD_DESC.date },
  },
  async run({ args }) {
    const provided: SkillPromoteProvided = {
      name: args.name as string | undefined,
      author: args.author as string | undefined,
      date: args.date as string | undefined,
    };

    if (!provided.name && !isInteractiveTty()) {
      await reportMissingPositional(skillPromoteCmd, skillCmd, "name", "NAME");
      return;
    }

    const filled: Resolved<SkillPromotePromptResult> = isInteractiveTty()
      ? await resolveSkillPromotePrompts(
          provided,
          await createClackDriver(),
          defaultSkillsTarget(),
          process.cwd(),
        )
      : { cancelled: false, options: provided };

    if (filled.cancelled) {
      reportCancelled();
      return;
    }

    const result = await runSkillPromote({
      cwd: process.cwd(),
      name: filled.options.name ?? "",
      author: filled.options.author ?? "",
      date: filled.options.date ?? todayYMD(),
    });
    emit(result);
  },
});

const skillCmd = defineCommand({
  meta: {
    name: "skill",
    description: "Team Skills: vendor or promote skills into the commons",
  },
  subCommands: { add: skillAddCmd, promote: skillPromoteCmd },
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
    migrate: migrateCmd,
    skill: skillCmd,
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
