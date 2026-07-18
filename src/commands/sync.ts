import type { RepoConfig, RepoConfigV2 } from "../core/config.js";
import { loadConfig, loadConfigV2 } from "../core/config.js";
import {
  formatLibrariesReport,
  materializeLibraries,
} from "../core/library.js";
import { formatReport, materializeSkills } from "../core/materialize.js";
import type { RepoSync } from "../core/memory-repo.js";
import { ensureRepo, localRepo, memoryHome } from "../core/memory-repo.js";
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

/** Global library model (Phase 6): the SessionStart hook's network-free
 * counterpart to `syncRepos` — resolves commons + overlays from whatever a
 * prior `roboto-mem sync` (or `init`) left on disk, with no clone/pull. See
 * "Loading mechanism at SessionStart" in
 * docs/design-specs/2026-07-17-global-library-model.md. */
export const localRepos = async (
  config: RepoConfig,
  home: string,
): Promise<SyncedRepos> => {
  const [commons, ...overlaySyncs] = await Promise.all([
    localRepo(config.commons, home),
    ...config.overlays.map((url) => localRepo(url, home)),
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
  /**
   * Called once with a combined diff summary when any declared library has
   * a pending change (see core/library.ts's materializeLibraries). Omitted
   * = auto-pull — this file must stay prompt-module-free (see
   * tests/cli.test.ts's "prompt module isolation" suite); the real,
   * TTY-aware confirm function is built and injected by cli.ts's syncCmd.
   */
  confirmLibrarySync?: (message: string) => Promise<boolean>;
}

const lineForSync = (url: string, sync: RepoSync): string => {
  if (!sync.ok) return `FAILED ${url}: ${sync.error}`;
  return sync.stale ? `stale (offline?) ${url}` : `synced ${url}`;
};

/** Today's v1 flow, unchanged — still what runs for every existing
 * configVersion:1 project (verified: all pre-existing v1 sync tests keep
 * passing byte-for-byte through this extraction). */
const runSyncV1 = async (
  config: RepoConfig,
  options: SyncOptions,
): Promise<CommandResult> => {
  const { home = memoryHome() } = options;
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

/** Global library model (Phase 4): one commons clone, declared libraries
 * materialized into ~/.roboto-mem/libraries/{lib}/, commons skills
 * materialized exactly as v1 already does. See "Sync & Promotion" in
 * docs/design-specs/2026-07-17-global-library-model.md. */
const runSyncV2 = async (
  config: RepoConfigV2,
  options: SyncOptions,
): Promise<CommandResult> => {
  const { home = memoryHome() } = options;

  const commons = await ensureRepo(config.commons, home);
  if (!commons.ok) {
    return {
      exitCode: 1,
      output: `Cannot sync commons; check network and auth: ${commons.error}`,
    };
  }

  const librariesReport = await materializeLibraries({
    commonsDir: commons.dir,
    home,
    libraryNames: config.libraries,
    confirm: options.confirmLibrarySync,
  });

  const skillsReport = await materializeSkills({
    commonsDir: commons.dir,
    home,
    targetDir: options.skillsTargetDir,
  });

  const librariesLine = formatLibrariesReport(librariesReport);
  const skillsLine = formatReport(skillsReport);
  const lines = [
    lineForSync(config.commons, commons),
    ...(librariesLine ? [librariesLine] : []),
    ...(skillsLine ? [skillsLine] : []),
  ];

  const hasFailures =
    librariesReport.failed.length > 0 || skillsReport.failed.length > 0;
  return { exitCode: hasFailures ? 2 : 0, output: lines.join("\n") };
};

export const runSync = async (options: SyncOptions): Promise<CommandResult> => {
  const { cwd } = options;

  const v2Result = await loadConfigV2(cwd);
  if (v2Result.ok) {
    return runSyncV2(v2Result.config, options);
  }
  if (v2Result.reason === "missing") {
    return { exitCode: 1, output: "run roboto-mem init" };
  }

  // Not v2 — try the v1 loader (this is the backward-compat path: every
  // genuine configVersion:1 project keeps working exactly as before).
  const v1Result = await loadConfig(cwd);
  if (v1Result.ok) {
    return runSyncV1(v1Result.config, options);
  }

  // Neither loader accepted this config — v2's diagnostic is the more
  // specific one here (v1's loader now structurally refuses anything at or
  // above its own CONFIG_VERSION before ever validating v1 shape, so
  // v1Result carries no extra information for a hybrid/too-new config).
  return { exitCode: 1, output: v2Result.detail };
};
