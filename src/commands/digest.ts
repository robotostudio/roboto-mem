import { readCache, writeCache } from "../core/cache.js";
import type { RepoConfigV2 } from "../core/config.js";
import { loadConfig, loadConfigV2 } from "../core/config.js";
import { compileDigest } from "../core/digest.js";
import {
  FORMAT_VERSION,
  loadMemory,
  localRepo,
  memoryHome,
  readSyncDate,
} from "../core/memory-repo.js";
import { sessionScopes } from "../core/scopes.js";
import type { CommandResult } from "../core/types.js";
import { VERSION } from "../core/version.js";
import { localRepos } from "./sync.js";

export interface DigestOptions {
  cwd: string;
  hook?: boolean;
  home?: string;
  nag?: string;
  today?: string;
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

/** Global library model: the v2 (library) digest path — global (untagged)
 * entries always apply, library-scoped entries apply only if declared, both
 * already implemented generically by entryApplies/compileDigest (Phase 2),
 * so config.libraries doubles as the v2 "session scopes" list. Same
 * network-free, cache-first contract as the v1 hook path below (localRepo,
 * not ensureRepo) — see "Loading mechanism at SessionStart" in
 * docs/design-specs/2026-07-17-global-library-model.md. */
const runDigestV2 = async (
  config: RepoConfigV2,
  options: {
    cwd: string;
    hook: boolean;
    home: string;
    nag?: string;
    today?: string;
  },
): Promise<CommandResult> => {
  const { cwd, hook, home, nag, today } = options;

  const commons = await localRepo(config.commons, home);
  if (!commons.ok) {
    const msg = `Team Memory unavailable: ${commons.error}`;
    return hook ? hookResult(msg) : { exitCode: 1, output: msg };
  }

  const commonsLoad = await loadMemory(commons.dir);
  if (!commonsLoad.ok) {
    if (commonsLoad.reason === "newer-format") {
      return staleResult(hook, home, cwd);
    }
    const msg = `Team Memory unavailable: ${commonsLoad.detail}`;
    return hook ? hookResult(msg) : { exitCode: 1, output: msg };
  }

  // The hook reads a local clone without pulling, so "today" is not the sync
  // date — prefer the timestamp `roboto-mem sync` persisted on its last
  // successful run, falling back to today only when none was ever recorded.
  const syncedDate =
    today ?? (await readSyncDate(config.commons, home)) ?? todayString();

  const digest = compileDigest({
    entries: commonsLoad.entries,
    sessionScopes: config.libraries,
    budgets: commonsLoad.budgets,
    meta: {
      toolVersion: VERSION,
      formatVersion: FORMAT_VERSION,
      syncedDate,
      nag,
    },
  });

  await writeCache(home, cwd, { date: syncedDate, digest });

  return hook ? hookResult(digest) : { exitCode: 0, output: digest };
};

export const runDigest = async (
  options: DigestOptions,
): Promise<CommandResult> => {
  const { cwd, hook = false, home = memoryHome(), nag, today } = options;

  // Global library model: a genuine v2 config wins outright (mirrors
  // sync.ts's runSync dispatch) — anything that ISN'T one (missing,
  // v1-shaped, invalid, too-new) falls through to the v1 flow below
  // completely unchanged.
  const v2Result = await loadConfigV2(cwd);
  if (v2Result.ok) {
    return runDigestV2(v2Result.config, { cwd, hook, home, nag, today });
  }

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

  // Step 2: resolve local repos — no network. The hook only reads whatever
  // a prior `roboto-mem sync` (or `init`) left on disk; cloning/pulling and
  // skill materialization are manual `roboto-mem sync` operations now (see
  // docs/design-specs/2026-07-17-global-library-model.md, "SessionStart
  // Integration").
  const synced = await localRepos(config, home);

  if (!synced.commons.ok) {
    const msg = `Team Memory unavailable: ${synced.commons.error}`;
    if (hook) return hookResult(msg);
    return { exitCode: 1, output: msg };
  }

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

  // Step 5: resolve the header's sync date. The hook only ever reads an
  // already-local clone (no live pull), so "today" is not the sync date —
  // prefer the timestamp `roboto-mem sync` persisted on its last successful
  // run (see writeSyncDate/readSyncDate in core/memory-repo.ts), falling back
  // to today only when none was ever recorded.
  const syncedDate =
    today ?? (await readSyncDate(config.commons, home)) ?? todayString();

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

  const fullOutput = overlayWarnings.length
    ? `${digest}\n${overlayWarnings.join("\n")}`
    : digest;

  // Step 7: write cache — always, so status/staleResult have a last-known-good
  // digest to fall back on if a future run hits a format/config mismatch.
  await writeCache(home, cwd, { date: syncedDate, digest: fullOutput });

  return hook ? hookResult(fullOutput) : { exitCode: 0, output: fullOutput };
};
