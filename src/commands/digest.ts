import { readCache, writeCache } from "../core/cache.js";
import { loadConfig } from "../core/config.js";
import { compileDigest } from "../core/digest.js";
import { materializeSkills } from "../core/materialize.js";
import { FORMAT_VERSION, loadMemory, memoryHome } from "../core/memory-repo.js";
import { sessionScopes } from "../core/scopes.js";
import type { CommandResult } from "../core/types.js";
import { VERSION } from "../core/version.js";
import { syncRepos } from "./sync.js";

export interface DigestOptions {
  cwd: string;
  hook?: boolean;
  home?: string;
  nag?: string;
  today?: string;
  skillsTargetDir?: string;
}

const todayString = (): string => new Date().toISOString().slice(0, 10);

const wrapHook = (output: string): string =>
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: output,
    },
  });

const hookResult = (output: string): CommandResult => ({
  exitCode: 0,
  output: output ? wrapHook(output) : "",
});

const STALE_WITH_CACHE =
  "> STALE: Team Memory uses a newer format/config than this roboto-mem understands. Run /mem-upgrade. Showing last-good digest from";
const STALE_ADVISORY =
  "> STALE: Team Memory uses a newer format/config than this roboto-mem understands. Run /mem-upgrade.";

const staleResult = async (
  hook: boolean,
  home: string,
  cwd: string,
): Promise<CommandResult> => {
  const cache = await readCache(home, cwd);
  if (cache) {
    const output = `${STALE_WITH_CACHE} ${cache.date}.\n${cache.digest}`;
    return hook ? hookResult(output) : { exitCode: 0, output };
  }
  if (hook) return hookResult(STALE_ADVISORY);
  return { exitCode: 1, output: STALE_ADVISORY };
};

export const runDigest = async (
  options: DigestOptions,
): Promise<CommandResult> => {
  const { cwd, hook = false, home = memoryHome(), nag, today } = options;

  // Step 1: load config
  const configResult = await loadConfig(cwd);

  if (!configResult.ok) {
    if (configResult.reason === "missing") {
      if (hook) return { exitCode: 0, output: "" };
      return { exitCode: 1, output: "run roboto-mem init" };
    }
    if (configResult.reason === "newer-config") {
      return staleResult(hook, home, cwd);
    }
    // invalid config
    if (hook) {
      return hookResult(
        `Team Memory config is invalid: ${configResult.detail}`,
      );
    }
    return { exitCode: 1, output: configResult.detail };
  }

  const { config } = configResult;

  // Step 2: sync repos
  const synced = await syncRepos(config, home);

  if (!synced.commons.ok) {
    const msg = `Team Memory unavailable: ${synced.commons.error}`;
    if (hook) return hookResult(msg);
    return { exitCode: 1, output: msg };
  }

  // Step 2b: materialize team skills (best-effort; fresh sync only)
  const skillReport = synced.commons.stale
    ? undefined
    : await materializeSkills({
        commonsDir: synced.commons.dir,
        home,
        targetDir: options.skillsTargetDir,
      });

  const skillWarnings: string[] = skillReport
    ? [
        ...skillReport.restored.map(
          (name) =>
            `> WARNING: team skill ${name}: restored — local edits were replaced by the team version. Promote changes via PR instead.`,
        ),
        ...(skillReport.failed.length
          ? [
              `> WARNING: ${skillReport.failed.length} team skill(s) failed to materialize — run roboto-mem status.`,
            ]
          : []),
      ]
    : [];

  // Step 3: load commons memory
  const commonsLoad = await loadMemory(synced.commons.dir);

  if (!commonsLoad.ok) {
    if (commonsLoad.reason === "newer-format") {
      return staleResult(hook, home, cwd);
    }
    // missing-manifest
    const msg = `Team Memory unavailable: ${commonsLoad.detail}`;
    if (hook) return hookResult(msg);
    return { exitCode: 1, output: msg };
  }

  // Step 4: load overlays, accumulate entries + budgets
  const allEntries = [...commonsLoad.entries];
  const allBudgets = { ...commonsLoad.budgets };
  const overlayWarnings: string[] = [];

  const overlayLoads = await Promise.all(
    synced.overlays.map(({ sync }) =>
      sync.ok ? loadMemory(sync.dir) : Promise.resolve(null),
    ),
  );

  for (const [i, overlayEntry] of synced.overlays.entries()) {
    const { url, sync } = overlayEntry;
    if (!sync.ok) {
      overlayWarnings.push(`> WARNING: overlay ${url} skipped: ${sync.error}`);
      continue;
    }
    const overlayLoad = overlayLoads[i];
    if (!overlayLoad) continue;
    if (!overlayLoad.ok) {
      if (overlayLoad.reason === "newer-format") {
        return staleResult(hook, home, cwd);
      }
      overlayWarnings.push(
        `> WARNING: overlay ${url} skipped: ${overlayLoad.detail}`,
      );
      continue;
    }
    allEntries.push(...overlayLoad.entries);
    // overlay-DECLARED budgets override commons (defaults excluded so an undeclared overlay can't reset them)
    Object.assign(allBudgets, overlayLoad.declaredBudgets);
  }

  // Step 5: derive date — stale sync uses cache date
  const isStale = synced.commons.stale;
  const cache = isStale ? await readCache(home, cwd) : undefined;
  const syncedDate = isStale
    ? (cache?.date ?? "unknown")
    : (today ?? todayString());

  // Step 6: compile
  const scopes = sessionScopes({
    project: config.project,
    squads: config.squads,
    workspaces: config.workspaces,
  });

  const digest = compileDigest({
    entries: allEntries,
    sessionScopes: scopes,
    budgets: allBudgets,
    meta: {
      toolVersion: VERSION,
      formatVersion: FORMAT_VERSION,
      syncedDate,
      nag,
    },
  });

  const allWarnings = [...overlayWarnings, ...skillWarnings];
  const fullOutput = allWarnings.length
    ? `${digest}\n${allWarnings.join("\n")}`
    : digest;

  // Step 7: write cache only when sync was fresh
  if (!isStale) {
    await writeCache(home, cwd, { date: syncedDate, digest: fullOutput });
  }

  return hook ? hookResult(fullOutput) : { exitCode: 0, output: fullOutput };
};
