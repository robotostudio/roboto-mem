import { readCache, writeCache } from "../core/cache.js";
import { loadConfig } from "../core/config.js";
import { compileDigest } from "../core/digest.js";
import { FORMAT_VERSION, loadMemory, memoryHome } from "../core/memory-repo.js";
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

  // Step 5: derive today's date for the header. The hook only ever reads an
  // already-local clone (no live pull), so there is no per-run "stale"
  // signal to fall back on here — `roboto-mem sync` is what keeps that
  // clone fresh; see localRepo in core/memory-repo.ts.
  const syncedDate = today ?? todayString();

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
