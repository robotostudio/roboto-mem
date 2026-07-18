import { cp, mkdir, rename, rm } from "node:fs/promises";
import * as path from "node:path";
import {
  type DirDiff,
  diffDirs,
  formatDirDiff,
  isDirDiffEmpty,
} from "./dir-diff.js";
import { exists } from "./materialize.js";

export const commonsLibrariesDir = (commonsDir: string): string =>
  path.join(commonsDir, "libraries");

export const librariesHome = (home: string): string =>
  path.join(home, "libraries");

interface LibraryPlanEntry {
  name: string;
  /** absolute: commonsDir/libraries/<name> */
  commonsDir: string;
  /** absolute: home/libraries/<name> (may not exist yet) */
  localDir: string;
  diff: DirDiff;
}

type LibraryPlan =
  | { ok: true; entry: LibraryPlanEntry }
  | { ok: false; name: string; error: string };

const isPlanOk = (p: LibraryPlan): p is Extract<LibraryPlan, { ok: true }> =>
  p.ok;

const planLibrary = async (
  commonsDir: string,
  home: string,
  name: string,
): Promise<LibraryPlan> => {
  const commonsLibDir = path.join(commonsLibrariesDir(commonsDir), name);
  if (!(await exists(commonsLibDir))) {
    return {
      ok: false,
      name,
      error: `library not found in commons (expected libraries/${name}/)`,
    };
  }

  const localDir = path.join(librariesHome(home), name);
  const localExists = await exists(localDir);
  const diff = await diffDirs(
    localExists ? localDir : undefined,
    commonsLibDir,
  );

  return {
    ok: true,
    entry: { name, commonsDir: commonsLibDir, localDir, diff },
  };
};

/** Atomically replaces localDir's contents with commonsDir's (tmp-then-rename,
 * mirrors materialize.ts's copySkill). */
const applyLibrary = async (entry: LibraryPlanEntry): Promise<void> => {
  const tmp = `${entry.localDir}.tmp-${process.pid}`;
  await mkdir(path.dirname(entry.localDir), { recursive: true });
  try {
    await rm(tmp, { recursive: true, force: true });
    await cp(entry.commonsDir, tmp, { recursive: true });
    await rm(entry.localDir, { recursive: true, force: true });
    await rename(tmp, entry.localDir);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
};

const formatCombinedDiff = (entries: LibraryPlanEntry[]): string =>
  entries.map((e) => `${e.name}:\n${formatDirDiff(e.diff)}`).join("\n\n");

export interface MaterializeLibrariesReport {
  synced: string[];
  upToDate: string[];
  skipped: string[];
  failed: { name: string; error: string }[];
}

export interface MaterializeLibrariesOptions {
  commonsDir: string;
  home: string;
  libraryNames: string[];
  /** Called once with a combined diff summary when ANY declared library has
   * a pending change. Returning false skips every pending library this run
   * (all-or-nothing — see the design spec's known-limitations list: library
   * updates have no selective/per-library pull). Omitted = auto-pull
   * (non-TTY default; see src/commands/sync.ts for the TTY-aware caller). */
  confirm?: (message: string) => Promise<boolean>;
}

export const materializeLibraries = async (
  options: MaterializeLibrariesOptions,
): Promise<MaterializeLibrariesReport> => {
  const report: MaterializeLibrariesReport = {
    synced: [],
    upToDate: [],
    skipped: [],
    failed: [],
  };

  const plans = await Promise.all(
    options.libraryNames.map((name) =>
      planLibrary(options.commonsDir, options.home, name),
    ),
  );

  for (const plan of plans) {
    if (!plan.ok) report.failed.push({ name: plan.name, error: plan.error });
  }

  const ok = plans.filter(isPlanOk).map((p) => p.entry);
  const pending = ok.filter((e) => !isDirDiffEmpty(e.diff));
  report.upToDate.push(
    ...ok.filter((e) => isDirDiffEmpty(e.diff)).map((e) => e.name),
  );

  if (pending.length === 0) return report;

  const proceed = options.confirm
    ? await options.confirm(formatCombinedDiff(pending))
    : true;

  if (!proceed) {
    report.skipped.push(...pending.map((e) => e.name));
    return report;
  }

  for (const entry of pending) {
    try {
      await applyLibrary(entry);
      report.synced.push(entry.name);
    } catch (e: unknown) {
      report.failed.push({
        name: entry.name,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return report;
};

export const formatLibrariesReport = (
  report: MaterializeLibrariesReport,
): string | undefined => {
  const parts = [
    ...(report.synced.length ? [`${report.synced.length} synced`] : []),
    ...(report.upToDate.length ? [`${report.upToDate.length} up to date`] : []),
    ...(report.skipped.length ? [`skipped: ${report.skipped.join(", ")}`] : []),
    ...(report.failed.length
      ? [
          `failed: ${report.failed.map((f) => `${f.name} (${f.error})`).join(", ")}`,
        ]
      : []),
  ];
  return parts.length ? `libraries: ${parts.join(", ")}` : undefined;
};
