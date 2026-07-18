import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { glob } from "tinyglobby";

export interface DirDiff {
  added: string[];
  changed: string[];
  removed: string[];
}

const hashFiles = async (dir: string): Promise<Map<string, string>> => {
  const files = await glob(["**/*"], {
    cwd: dir,
    dot: true,
    followSymbolicLinks: false,
  });
  files.sort();

  const map = new Map<string, string>();
  for (const f of files) {
    const buf = await readFile(path.join(dir, f));
    map.set(f, createHash("sha256").update(buf).digest("hex"));
  }
  return map;
};

/** File-level diff between two directory trees, keyed by relative path.
 * `oldDir` undefined means "nothing there yet" — every file in `newDir` is
 * reported as added. Used both for sync's pre-overwrite confirm summary and
 * (symmetrically, swapping which side is "new") for a promotion's PR body. */
export const diffDirs = async (
  oldDir: string | undefined,
  newDir: string,
): Promise<DirDiff> => {
  const newFiles = await hashFiles(newDir);
  if (!oldDir) {
    return { added: [...newFiles.keys()].sort(), changed: [], removed: [] };
  }

  const oldFiles = await hashFiles(oldDir);
  const added = [...newFiles.keys()].filter((f) => !oldFiles.has(f)).sort();
  const removed = [...oldFiles.keys()].filter((f) => !newFiles.has(f)).sort();
  const changed = [...newFiles.keys()]
    .filter((f) => oldFiles.has(f) && oldFiles.get(f) !== newFiles.get(f))
    .sort();

  return { added, changed, removed };
};

export const isDirDiffEmpty = (diff: DirDiff): boolean =>
  diff.added.length === 0 &&
  diff.changed.length === 0 &&
  diff.removed.length === 0;

/** Human-readable multi-line summary — a leading counts line ("1 added, 2
 * changed") followed by one `+`/`~`/`-` line per path. Used for sync's TTY
 * collision-confirm prompt. */
export const formatDirDiff = (diff: DirDiff): string => {
  if (isDirDiffEmpty(diff)) return "no changes";

  const counts = [
    ...(diff.added.length ? [`${diff.added.length} added`] : []),
    ...(diff.changed.length ? [`${diff.changed.length} changed`] : []),
    ...(diff.removed.length ? [`${diff.removed.length} removed`] : []),
  ].join(", ");

  const lines = [
    ...diff.added.map((f) => `  + ${f}`),
    ...diff.changed.map((f) => `  ~ ${f}`),
    ...diff.removed.map((f) => `  - ${f}`),
  ];

  return [counts, ...lines].join("\n");
};
