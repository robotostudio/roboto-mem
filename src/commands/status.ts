import { access } from "node:fs/promises";
import { readCache } from "../core/cache.js";
import { loadConfig } from "../core/config.js";
import { loadMemory, memoryHome, repoDirFor } from "../core/memory-repo.js";
import { sessionScopes } from "../core/scopes.js";
import type { CommandResult } from "../core/types.js";
import { VERSION } from "../core/version.js";

export interface StatusOptions {
  cwd: string;
  home?: string;
}

const cloneExists = async (dir: string): Promise<boolean> =>
  access(dir)
    .then(() => true)
    .catch(() => false);

export const runStatus = async (
  options: StatusOptions,
): Promise<CommandResult> => {
  const { cwd } = options;
  const home = options.home ?? memoryHome();

  const configResult = await loadConfig(cwd);

  if (!configResult.ok) {
    const detail =
      configResult.reason === "missing"
        ? "no .roboto-mem.json — run roboto-mem init"
        : configResult.detail;
    return { exitCode: 1, output: detail };
  }

  const { config } = configResult;
  const lines: string[] = [];

  lines.push(`roboto-mem ${VERSION}`);
  lines.push(`commons: ${config.commons}`);

  if (config.overlays.length > 0) {
    lines.push(`overlays (${config.overlays.length}):`);
    for (const url of config.overlays) {
      lines.push(`  ${url}`);
    }
  } else {
    lines.push("overlays: none");
  }

  lines.push(`project: ${config.project}`);
  lines.push(
    `squads: ${config.squads.length > 0 ? config.squads.join(", ") : "(none)"}`,
  );

  lines.push("workspaces:");
  for (const [ws, stacks] of Object.entries(config.workspaces)) {
    lines.push(`  ${ws}: ${stacks.join(", ")}`);
  }

  const scopes = sessionScopes({
    project: config.project,
    squads: config.squads,
    workspaces: config.workspaces,
  });
  lines.push(`session scopes: ${scopes.join(", ")}`);

  const cloneDir = repoDirFor(config.commons, home);
  const synced = await cloneExists(cloneDir);

  if (!synced) {
    lines.push("commons: not synced yet — run roboto-mem sync");
  } else {
    const mem = await loadMemory(cloneDir);

    if (!mem.ok) {
      if (mem.reason === "newer-format") {
        lines.push(
          `format ${mem.formatVersion} is newer than this tool — upgrade`,
        );
      } else {
        lines.push(`commons load error: ${mem.detail}`);
      }
    } else {
      const standards = mem.entries.filter((e) => e.type === "standard").length;
      const lessons = mem.entries.filter((e) => e.type === "lesson").length;
      lines.push(`${standards} standards, ${lessons} lessons`);
      if (mem.errors.length > 0) {
        lines.push(`parse errors: ${mem.errors.length}`);
      }
      lines.push(`formatVersion ${mem.formatVersion}`);
    }
  }

  const cached = await readCache(home, cwd);
  lines.push(cached ? `last digest: ${cached.date}` : "no digest cached yet");

  return { exitCode: 0, output: lines.join("\n") };
};
