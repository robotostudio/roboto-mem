import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listCommonsLibraries,
  mapDepsToLibraries,
  scanPackageDeps,
} from "../../src/core/library-detect.js";
import { tmpDirFactory } from "../helpers/tmp.js";

describe("listCommonsLibraries", () => {
  const tmp = tmpDirFactory("rm-library-detect-list-");
  afterEach(tmp.cleanup);
  const makeDir = tmp.make;

  it("returns sorted subdirectory names under commons/libraries/", async () => {
    const commonsDir = await makeDir();
    await mkdir(path.join(commonsDir, "libraries", "resend"), {
      recursive: true,
    });
    await mkdir(path.join(commonsDir, "libraries", "auth0"), {
      recursive: true,
    });
    const result = await listCommonsLibraries(commonsDir);
    expect(result).toEqual(["auth0", "resend"]);
  });

  it("returns [] when libraries/ exists but is empty (not an error)", async () => {
    const commonsDir = await makeDir();
    await mkdir(path.join(commonsDir, "libraries"), { recursive: true });
    const result = await listCommonsLibraries(commonsDir);
    expect(result).toEqual([]);
  });

  it("returns undefined when libraries/ does not exist at all", async () => {
    const commonsDir = await makeDir();
    const result = await listCommonsLibraries(commonsDir);
    expect(result).toBeUndefined();
  });

  it("ignores plain files sitting directly under libraries/", async () => {
    const commonsDir = await makeDir();
    await mkdir(path.join(commonsDir, "libraries", "resend"), {
      recursive: true,
    });
    await writeFile(
      path.join(commonsDir, "libraries", "README.md"),
      "not a library",
      "utf8",
    );
    const result = await listCommonsLibraries(commonsDir);
    expect(result).toEqual(["resend"]);
  });
});

describe("scanPackageDeps", () => {
  const tmp = tmpDirFactory("rm-library-detect-scan-");
  afterEach(tmp.cleanup);
  const makeDir = tmp.make;

  it("merges dependencies and devDependencies keys, deduped", async () => {
    const dir = await makeDir();
    await writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({
        dependencies: { resend: "1.0.0", next: "14.0.0" },
        devDependencies: { typescript: "5.0.0", next: "14.0.0" },
      }),
      "utf8",
    );
    const result = await scanPackageDeps(dir);
    expect(result?.sort()).toEqual(["next", "resend", "typescript"]);
  });

  it("returns undefined when package.json is missing", async () => {
    const dir = await makeDir();
    const result = await scanPackageDeps(dir);
    expect(result).toBeUndefined();
  });

  it("returns undefined when package.json is malformed JSON", async () => {
    const dir = await makeDir();
    await writeFile(path.join(dir, "package.json"), "{ not json", "utf8");
    const result = await scanPackageDeps(dir);
    expect(result).toBeUndefined();
  });

  it("returns [] when package.json has neither dependencies nor devDependencies", async () => {
    const dir = await makeDir();
    await writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "x" }),
      "utf8",
    );
    const result = await scanPackageDeps(dir);
    expect(result).toEqual([]);
  });
});

describe("mapDepsToLibraries", () => {
  it("matches an unscoped dep to a library of the same name (exact intersection)", () => {
    const result = mapDepsToLibraries(
      ["resend", "left-pad"],
      ["resend", "next"],
    );
    expect(result.detected).toEqual(["resend"]);
    expect(result.warnings).toEqual([]);
  });

  it("maps a scoped dep via the alias table when the aliased name is available", () => {
    const result = mapDepsToLibraries(
      ["@auth0/nextjs-auth0"],
      ["auth0", "next"],
    );
    expect(result.detected).toEqual(["auth0"]);
    expect(result.warnings).toEqual([]);
  });

  it("does not detect a scoped dep whose alias target isn't offered by this commons", () => {
    const result = mapDepsToLibraries(["@auth0/nextjs-auth0"], ["next"]);
    expect(result.detected).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("warns (does not throw, does not detect) for a scoped dep with no alias entry", () => {
    const result = mapDepsToLibraries(
      ["@unknown-scope/thing"],
      ["resend", "next"],
    );
    expect(result.detected).toEqual([]);
    expect(result.warnings).toEqual([
      {
        dep: "@unknown-scope/thing",
        message:
          "Couldn't map @unknown-scope/thing to a known library; add manually if needed",
      },
    ]);
  });

  it("dedupes and sorts the detected set", () => {
    const result = mapDepsToLibraries(
      ["next", "@auth0/nextjs-auth0", "resend"],
      ["resend", "next", "auth0"],
    );
    expect(result.detected).toEqual(["auth0", "next", "resend"]);
  });

  it("returns empty detected/warnings for an empty deps list", () => {
    const result = mapDepsToLibraries([], ["resend"]);
    expect(result).toEqual({ detected: [], warnings: [] });
  });

  it("ignores an unscoped dep that isn't offered by commons, without warning", () => {
    const result = mapDepsToLibraries(["left-pad"], ["resend"]);
    expect(result.detected).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});
