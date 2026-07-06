import type { RepoConfig } from "../core/config.js";
import { loadConfig } from "../core/config.js";
import { formatReport, materializeSkills } from "../core/materialize.js";
import type { RepoSync } from "../core/memory-repo.js";
import { ensureRepo, memoryHome } from "../core/memory-repo.js";
import type { CommandResult } from "../core/types.js";

export interface SyncedRepos {
  commons: RepoSync;
  overlays: { url: string; sync: RepoSync }[];
}

export const syncRepos = async (
  config: RepoConfig,
  home: string,
): Promise<SyncedRepos> => {
  const [commons, ...overlaySyncs] = await Promise.all([
    ensureRepo(config.commons, home),
    ...config.overlays.map((url) => ensureRepo(url, home)),
  ]);

  const overlays = config.overlays.map((url, i) => ({
    url,
    sync: overlaySyncs[i] as RepoSync,
  }));

  return { commons, overlays };
};

export interface SyncOptions {
  cwd: string;
  home?: string;
  skillsTargetDir?: string;
}

const lineForSync = (url: string, sync: RepoSync): string => {
  if (!sync.ok) return `FAILED ${url}: ${sync.error}`;
  return sync.stale ? `stale (offline?) ${url}` : `synced ${url}`;
};

export const runSync = async (options: SyncOptions): Promise<CommandResult> => {
  const { cwd, home = memoryHome() } = options;

  const configResult = await loadConfig(cwd);

  if (!configResult.ok) {
    if (configResult.reason === "missing") {
      return { exitCode: 1, output: "run roboto-mem init" };
    }
    return { exitCode: 1, output: configResult.detail };
  }

  const { config } = configResult;
  const synced = await syncRepos(config, home);

  const lines: string[] = [lineForSync(config.commons, synced.commons)];
  for (const { url, sync } of synced.overlays) {
    lines.push(lineForSync(url, sync));
  }

  const skillsLine =
    synced.commons.ok && !synced.commons.stale
      ? formatReport(
          await materializeSkills({
            commonsDir: synced.commons.dir,
            home,
            targetDir: options.skillsTargetDir,
          }),
        )
      : undefined;
  const outputLines = skillsLine ? [...lines, skillsLine] : lines;

  const exitCode = synced.commons.ok ? 0 : 1;
  return { exitCode, output: outputLines.join("\n") };
};
