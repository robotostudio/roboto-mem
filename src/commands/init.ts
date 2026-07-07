import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONFIG_FILE,
  loadConfig,
  type RepoConfig,
  saveConfig,
} from "../core/config.js";
import { detectWorkspaces } from "../core/detect.js";
import { sessionScopes } from "../core/scopes.js";
import type { CommandResult } from "../core/types.js";
import {
  CODEOWNERS,
  COMMONS_README,
  MEMORY_CI_YML,
  MEMORY_JSON,
} from "./commons-templates.js";

export interface InitOptions {
  dir: string;
  commonsUrl?: string;
  project?: string;
  squads?: string[];
  scaffoldCommons?: boolean;
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

export const runInit = async (options: InitOptions): Promise<CommandResult> =>
  options.scaffoldCommons ? scaffoldMode(options.dir) : bindMode(options);
