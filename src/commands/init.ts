import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONFIG_FILE,
  loadConfig,
  type RepoConfig,
  saveConfig,
  saveConfigV2,
} from "../core/config.js";
import { detectWorkspaces } from "../core/detect.js";
import {
  listCommonsLibraries,
  mapDepsToLibraries,
  scanPackageDeps,
} from "../core/library-detect.js";
import { exists } from "../core/materialize.js";
import { ensureRepo, memoryHome } from "../core/memory-repo.js";
import { sessionScopes } from "../core/scopes.js";
import type { CommandResult } from "../core/types.js";
import {
  CODEOWNERS,
  COMMONS_README,
  MEMORY_CI_YML,
  MEMORY_JSON,
} from "./commons-templates.js";
import { runSync } from "./sync.js";

export interface InitOptions {
  dir: string;
  commonsUrl?: string;
  project?: string;
  squads?: string[];
  scaffoldCommons?: boolean;
  /** Global library model (v2): explicit library list. When given
   * (including `[]`), skips auto-detect confirmation entirely — the
   * detected set is only used as a fallback/prefill. Undefined = run
   * detection and, if `selectLibraries` is set, ask the user. */
  libraries?: string[];
  /** Test-only override for `~/.roboto-mem` — mirrors sync.ts/library.ts. */
  home?: string;
  /** Test-only override for the auto-sync step's skills materialize target. */
  skillsTargetDir?: string;
  /**
   * TTY-only confirm/add/remove step (design spec's init steps 7–8).
   * Undefined = non-interactive default: accept the detected set as-is.
   * Returning `undefined` from the callback means "cancelled". Built and
   * injected by cli.ts's initCmd — init.ts itself stays prompt-module-free,
   * same DI pattern as sync.ts's `confirmLibrarySync`.
   */
  selectLibraries?: (input: {
    available: string[];
    detected: string[];
  }) => Promise<string[] | undefined>;
}

/** Never clobbers a pre-existing file — scaffolding into an already-bound
 * project repo (or any dir with its own README/CODEOWNERS/etc.) must not
 * overwrite content that isn't ours. */
const writeIfMissing = async (
  filePath: string,
  content: string,
): Promise<boolean> => {
  const alreadyExists = await fs.access(filePath).then(
    () => true,
    () => false,
  );
  if (alreadyExists) return false;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
  return true;
};

// The CI workflow runs the CLI vendored into the Commons (no tokens, no network).
// At runtime import.meta.url IS the bundle; from src (tests/dev) fall back to dist.
const ownBundlePath = (): string => {
  const self = fileURLToPath(import.meta.url);
  return self.endsWith("cli.mjs")
    ? self
    : path.join(path.dirname(self), "..", "..", "dist", "cli.mjs");
};

const vendorCli = async (dir: string): Promise<string | undefined> => {
  const target = path.join(dir, ".roboto-mem", "cli.mjs");
  try {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(ownBundlePath(), target);
    return undefined;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return `WARNING: could not vendor the CLI bundle (${message}) — copy dist/cli.mjs to .roboto-mem/cli.mjs manually or CI lint will fail.`;
  }
};

const scaffoldMode = async (dir: string): Promise<CommandResult> => {
  const memJsonPath = path.join(dir, "memory.json");

  try {
    await fs.access(memJsonPath);
    return {
      exitCode: 1,
      output:
        "memory.json already exists — this directory is already a Commons repo. Nothing written.",
    };
  } catch {
    // file absent — proceed
  }

  const targets: { label: string; path: string; content: string }[] = [
    { label: "memory.json", path: memJsonPath, content: MEMORY_JSON },
    {
      label: "CODEOWNERS",
      path: path.join(dir, "CODEOWNERS"),
      content: CODEOWNERS,
    },
    {
      label: "README.md",
      path: path.join(dir, "README.md"),
      content: COMMONS_README,
    },
    {
      label: ".github/workflows/memory-ci.yml",
      path: path.join(dir, ".github", "workflows", "memory-ci.yml"),
      content: MEMORY_CI_YML,
    },
    {
      label: "entries/org/.gitkeep",
      path: path.join(dir, "entries", "org", ".gitkeep"),
      content: "",
    },
    {
      label: "entries/squads/.gitkeep",
      path: path.join(dir, "entries", "squads", ".gitkeep"),
      content: "",
    },
    {
      label: "entries/stacks/.gitkeep",
      path: path.join(dir, "entries", "stacks", ".gitkeep"),
      content: "",
    },
    {
      label: "entries/projects/.gitkeep",
      path: path.join(dir, "entries", "projects", ".gitkeep"),
      content: "",
    },
    {
      label: "skills/.gitkeep",
      path: path.join(dir, "skills", ".gitkeep"),
      content: "",
    },
  ];

  const written = await Promise.all(
    targets.map(async (t) => ({
      label: t.label,
      wrote: await writeIfMissing(t.path, t.content),
    })),
  );
  const vendorWarning = await vendorCli(dir);

  const lines = written.map(({ label, wrote }) =>
    wrote ? `  ${label}` : `  ${label} (exists, skipped)`,
  );
  if (!vendorWarning) {
    lines.push("  .roboto-mem/cli.mjs (vendored CLI for CI)");
  }

  return {
    exitCode: 0,
    output: [
      "Commons repo scaffolded:",
      ...lines,
      ...(vendorWarning ? [vendorWarning] : []),
      "",
      "Next steps:",
      "  1. Commit and push this repo to your git host.",
      "  2. Bind each project repo:",
      "       roboto-mem init --commons-url <url> --project <name>",
    ].join("\n"),
  };
};

const bindMode = async (options: InitOptions): Promise<CommandResult> => {
  const { dir, commonsUrl, project, squads } = options;

  const configResult = await loadConfig(dir);

  if (!configResult.ok && configResult.reason === "newer-config") {
    return { exitCode: 1, output: configResult.detail };
  }

  if (!configResult.ok && configResult.reason === "invalid") {
    return {
      exitCode: 1,
      output: [
        `${CONFIG_FILE} is corrupt and cannot be read: ${configResult.detail}`,
        "",
        `Fix or delete ${CONFIG_FILE} before re-running init.`,
      ].join("\n"),
    };
  }

  const existing = configResult.ok ? configResult.config : undefined;
  const existingRaw: Record<string, unknown> = configResult.ok
    ? configResult.raw
    : {};

  const resolvedCommons = commonsUrl ?? existing?.commons;
  const resolvedProject = project ?? existing?.project;

  if (!resolvedCommons || !resolvedProject) {
    return {
      exitCode: 1,
      output: [
        "Missing required options.",
        "  --commons-url <git-url>   URL of the Commons memory repo",
        "  --project <name>          Identifier for this project",
        "",
        "Example:",
        "  roboto-mem init --commons-url https://github.com/org/team-memory.git --project my-app",
      ].join("\n"),
    };
  }

  const workspaces = await detectWorkspaces(dir);

  const config: RepoConfig = {
    configVersion: 1,
    commons: resolvedCommons,
    overlays: existing?.overlays ?? [],
    project: resolvedProject,
    squads: squads ?? existing?.squads ?? [],
    workspaces,
  };

  await saveConfig(dir, config, existingRaw);

  const scopes = sessionScopes({
    project: config.project,
    squads: config.squads,
    workspaces: config.workspaces,
  });

  const workspaceLines =
    Object.keys(workspaces).length > 0
      ? Object.entries(workspaces).map(
          ([ws, stacks]) => `  ${ws}: ${stacks.join(", ")}`,
        )
      : ["  (none detected)"];

  return {
    exitCode: 0,
    output: [
      `Bound commons: ${config.commons}`,
      `Project: ${config.project}`,
      `Squads: ${config.squads.length > 0 ? config.squads.join(", ") : "(none)"}`,
      "",
      "Workspaces:",
      ...workspaceLines,
      "",
      "Session scopes:",
      `  ${scopes.join(", ")}`,
    ].join("\n"),
  };
};

const initUsageV2 = (): string =>
  [
    "Missing required option.",
    "  --commons-url <git-url>   URL of the Commons memory repo",
    "",
    "Example:",
    "  roboto-mem init --commons-url https://github.com/org/team-memory.git",
  ].join("\n");

const fail = (output: string): CommandResult => ({ exitCode: 1, output });

/**
 * Global library model (Phase 3): the new `.roboto-mem.json` v2 flow —
 * "Library Detection & Init Flow" in docs/design-specs/2026-07-17-global-
 * library-model.md, steps 1–10 (step 11's non-TTY-errors framing is
 * softened to "flags-only never prompts", matching every other guided
 * command in this codebase — see runInit's dispatch comment for why).
 */
const bindModeV2 = async (options: InitOptions): Promise<CommandResult> => {
  const { dir, home = memoryHome() } = options;

  // Step 1: a pre-existing .roboto-mem.json (any version/shape) blocks a
  // fresh v2 write — refreshing an existing binding is update-libraries's
  // job, not init's.
  if (await exists(path.join(dir, CONFIG_FILE))) {
    return fail(
      "Config already exists. Run `roboto-mem update-libraries` to refresh.",
    );
  }

  // Step 2: resolve commons URL. Interactive callers resolve this via
  // interactive.ts's own "bind-libraries" prompt (which prefills a global-
  // config default) before ever reaching here; a bare flags/non-interactive
  // call requires it explicitly.
  const commonsUrl = options.commonsUrl;
  if (!commonsUrl) return fail(initUsageV2());

  // Step 3: clone/pull commons (reuses shipped ensureRepo/repoDirFor).
  const repoSync = await ensureRepo(commonsUrl, home);
  if (!repoSync.ok) {
    return fail(
      `Cannot reach commons; check network and URL: ${repoSync.error}`,
    );
  }

  // Step 4: list available libraries.
  const available = await listCommonsLibraries(repoSync.dir);
  if (available === undefined) {
    return fail(
      "Commons has no libraries. Team must create v2-format commons.",
    );
  }

  // Steps 5–6: scan package.json deps, intersect against available libraries.
  const deps = await scanPackageDeps(dir);
  const detection = deps
    ? mapDepsToLibraries(deps, available)
    : { detected: [], warnings: [] };

  // Steps 7–9: explicit override wins outright (mirrors --commons winning
  // outright over init's mode-select); otherwise ask (TTY) or accept the
  // detected set as-is (non-interactive default, mirrors sync.ts's
  // confirm-omitted-means-auto-pull convention).
  const chosen =
    options.libraries ??
    (options.selectLibraries
      ? await options.selectLibraries({
          available,
          detected: detection.detected,
        })
      : detection.detected);

  if (chosen === undefined) return fail("Cancelled.");

  // Step 9: write config.
  await saveConfigV2(dir, {
    configVersion: 2,
    commons: commonsUrl,
    libraries: chosen,
  });

  // Step 10: auto-sync, silently (non-blocking — a sync failure warns but
  // never undoes the config write already on disk).
  const syncResult = await runSync({
    cwd: dir,
    home,
    skillsTargetDir: options.skillsTargetDir,
  });
  const syncLine =
    syncResult.exitCode === 0
      ? "Libraries synced."
      : `WARNING: sync did not fully complete (${syncResult.output.split("\n")[0]}). Run roboto-mem sync manually.`;

  return {
    exitCode: 0,
    output: [
      `Bound commons: ${commonsUrl}`,
      `Libraries: ${chosen.length ? chosen.join(", ") : "(none)"}`,
      ...detection.warnings.map((w) => `WARNING: ${w.message}`),
      syncLine,
    ].join("\n"),
  };
};

// Global library model: a project explicitly opting into the new schema gives
// --commons-url without --project (v2 has no project concept at all). But a
// bare --commons-url is also how a v1 project *rebinds* its commons, so the
// dispatch can't route on flags alone — it must inspect the on-disk config:
//
//   - --project given            → always v1 (only v1 has a project concept)
//   - no --commons-url           → v1 usage/error path (bindMode reports it)
//   - --commons-url, existing v1 → v1 rebind (preserve the existing project)
//   - --commons-url, otherwise   → v2 (fresh init, or bindModeV2's own
//                                  "already exists" guard for a v2 file)
//
// This keeps TTY and non-interactive dispatch identical. See docs/design-
// specs/2026-07-17-global-library-model.md's "Library Detection & Init Flow".
const usesLibraryModel = async (options: InitOptions): Promise<boolean> => {
  if (options.project !== undefined || options.commonsUrl === undefined) {
    return false;
  }
  const existing = await loadConfig(options.dir);
  return !existing.ok;
};

export const runInit = async (options: InitOptions): Promise<CommandResult> => {
  if (options.scaffoldCommons) return scaffoldMode(options.dir);
  return (await usesLibraryModel(options))
    ? bindModeV2(options)
    : bindMode(options);
};
