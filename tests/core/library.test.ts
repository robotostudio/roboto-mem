import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatLibrariesReport,
  materializeLibraries,
} from "../../src/core/library.js";
import { tmpDirFactory } from "../helpers/tmp.js";

describe("materializeLibraries", () => {
  const tmp = tmpDirFactory("rm-library-");
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

  const seedCommons = async (
    commonsDir: string,
    libraries: Record<string, Record<string, string>>,
  ): Promise<void> => {
    for (const [name, files] of Object.entries(libraries)) {
      await writeFiles(path.join(commonsDir, "libraries", name), files);
    }
  };

  it("returns an empty report when libraryNames is empty", async () => {
    const commonsDir = await tmp.make();
    const home = await tmp.make();

    const report = await materializeLibraries({
      commonsDir,
      home,
      libraryNames: [],
    });

    expect(report).toEqual({
      synced: [],
      upToDate: [],
      skipped: [],
      failed: [],
    });
  });

  it("reports failed when a declared library is missing from commons", async () => {
    const commonsDir = await tmp.make();
    const home = await tmp.make();

    const report = await materializeLibraries({
      commonsDir,
      home,
      libraryNames: ["resend"],
    });

    expect(report.failed).toEqual([
      {
        name: "resend",
        error: "library not found in commons (expected libraries/resend/)",
      },
    ]);
    expect(report.synced).toEqual([]);
  });

  it("auto-pulls a brand-new library when confirm is omitted (non-TTY default)", async () => {
    const commonsDir = await tmp.make();
    const home = await tmp.make();
    await seedCommons(commonsDir, {
      resend: { "LIBRARY.md": "# Resend\nSummary." },
    });

    const report = await materializeLibraries({
      commonsDir,
      home,
      libraryNames: ["resend"],
    });

    expect(report.synced).toEqual(["resend"]);
    expect(report.failed).toEqual([]);

    const materialized = await readFile(
      path.join(home, "libraries", "resend", "LIBRARY.md"),
      "utf8",
    );
    expect(materialized).toBe("# Resend\nSummary.");
  });

  it("reports up to date without calling confirm when the local copy already matches", async () => {
    const commonsDir = await tmp.make();
    const home = await tmp.make();
    await seedCommons(commonsDir, {
      resend: { "LIBRARY.md": "same" },
    });
    await writeFiles(path.join(home, "libraries", "resend"), {
      "LIBRARY.md": "same",
    });

    const confirmCalls: string[] = [];
    const report = await materializeLibraries({
      commonsDir,
      home,
      libraryNames: ["resend"],
      confirm: async (message) => {
        confirmCalls.push(message);
        return true;
      },
    });

    expect(report.upToDate).toEqual(["resend"]);
    expect(report.synced).toEqual([]);
    expect(confirmCalls).toEqual([]);
  });

  it("calls confirm once with a combined summary and applies all pending libraries on yes", async () => {
    const commonsDir = await tmp.make();
    const home = await tmp.make();
    await seedCommons(commonsDir, {
      resend: { "LIBRARY.md": "v2" },
      next: { "LIBRARY.md": "new" },
    });
    await writeFiles(path.join(home, "libraries", "resend"), {
      "LIBRARY.md": "v1",
    });

    const confirmCalls: string[] = [];
    const report = await materializeLibraries({
      commonsDir,
      home,
      libraryNames: ["resend", "next"],
      confirm: async (message) => {
        confirmCalls.push(message);
        return true;
      },
    });

    expect(confirmCalls).toHaveLength(1);
    expect(confirmCalls[0]).toContain("resend");
    expect(confirmCalls[0]).toContain("next");
    expect(report.synced.sort()).toEqual(["next", "resend"]);

    const resendMd = await readFile(
      path.join(home, "libraries", "resend", "LIBRARY.md"),
      "utf8",
    );
    expect(resendMd).toBe("v2");
  });

  it("skips all pending libraries when confirm returns false, leaving local copies untouched", async () => {
    const commonsDir = await tmp.make();
    const home = await tmp.make();
    await seedCommons(commonsDir, { resend: { "LIBRARY.md": "v2" } });
    await writeFiles(path.join(home, "libraries", "resend"), {
      "LIBRARY.md": "v1",
    });

    const report = await materializeLibraries({
      commonsDir,
      home,
      libraryNames: ["resend"],
      confirm: async () => false,
    });

    expect(report.skipped).toEqual(["resend"]);
    expect(report.synced).toEqual([]);

    const resendMd = await readFile(
      path.join(home, "libraries", "resend", "LIBRARY.md"),
      "utf8",
    );
    expect(resendMd).toBe("v1");
  });

  it("mixes failed and synced libraries in one run", async () => {
    const commonsDir = await tmp.make();
    const home = await tmp.make();
    await seedCommons(commonsDir, { resend: { "LIBRARY.md": "hi" } });

    const report = await materializeLibraries({
      commonsDir,
      home,
      libraryNames: ["resend", "sanity"],
    });

    expect(report.synced).toEqual(["resend"]);
    expect(report.failed).toEqual([
      {
        name: "sanity",
        error: "library not found in commons (expected libraries/sanity/)",
      },
    ]);
  });
});

describe("formatLibrariesReport", () => {
  it("formats each non-empty bucket and omits empty ones", () => {
    const text = formatLibrariesReport({
      synced: ["resend"],
      upToDate: ["next"],
      skipped: ["auth0"],
      failed: [{ name: "sanity", error: "not found" }],
    });
    expect(text).toBe(
      "libraries: 1 synced, 1 up to date, skipped: auth0, failed: sanity (not found)",
    );
  });

  it("returns undefined when every bucket is empty", () => {
    expect(
      formatLibrariesReport({
        synced: [],
        upToDate: [],
        skipped: [],
        failed: [],
      }),
    ).toBeUndefined();
  });
});
