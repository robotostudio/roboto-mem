import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  diffDirs,
  formatDirDiff,
  isDirDiffEmpty,
} from "../../src/core/dir-diff.js";
import { tmpDirFactory } from "../helpers/tmp.js";

describe("diffDirs", () => {
  const tmp = tmpDirFactory("rm-dirdiff-");
  afterEach(tmp.cleanup);

  const writeFiles = async (
    dir: string,
    files: Record<string, string>,
  ): Promise<void> => {
    await Promise.all(
      Object.entries(files).map(async ([rel, content]) => {
        const abs = path.join(dir, rel);
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, content, "utf8");
      }),
    );
  };

  it("treats every file as added when there is no old dir", async () => {
    const newDir = await tmp.make();
    await writeFiles(newDir, { "LIBRARY.md": "a", "docs/setup.md": "b" });

    const diff = await diffDirs(undefined, newDir);
    expect(diff.added.sort()).toEqual(["LIBRARY.md", "docs/setup.md"]);
    expect(diff.changed).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it("reports no differences for identical directories", async () => {
    const oldDir = await tmp.make();
    const newDir = await tmp.make();
    await writeFiles(oldDir, { "LIBRARY.md": "same" });
    await writeFiles(newDir, { "LIBRARY.md": "same" });

    const diff = await diffDirs(oldDir, newDir);
    expect(isDirDiffEmpty(diff)).toBe(true);
  });

  it("classifies added, changed, and removed files", async () => {
    const oldDir = await tmp.make();
    const newDir = await tmp.make();
    await writeFiles(oldDir, {
      "LIBRARY.md": "v1",
      "docs/old.md": "gone soon",
    });
    await writeFiles(newDir, {
      "LIBRARY.md": "v2",
      "docs/new.md": "fresh",
    });

    const diff = await diffDirs(oldDir, newDir);
    expect(diff.added).toEqual(["docs/new.md"]);
    expect(diff.changed).toEqual(["LIBRARY.md"]);
    expect(diff.removed).toEqual(["docs/old.md"]);
    expect(isDirDiffEmpty(diff)).toBe(false);
  });
});

describe("formatDirDiff", () => {
  it("summarizes counts and lists each changed path", () => {
    const text = formatDirDiff({
      added: ["examples/new.md"],
      changed: ["LIBRARY.md"],
      removed: ["docs/old.md"],
    });
    expect(text).toContain("1 added");
    expect(text).toContain("1 changed");
    expect(text).toContain("1 removed");
    expect(text).toContain("+ examples/new.md");
    expect(text).toContain("~ LIBRARY.md");
    expect(text).toContain("- docs/old.md");
  });

  it("reports no changes for an empty diff", () => {
    expect(formatDirDiff({ added: [], changed: [], removed: [] })).toBe(
      "no changes",
    );
  });
});
