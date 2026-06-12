import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectWorkspaces } from "../../src/core/detect.js";
import { tmpDirFactory } from "../helpers/tmp.js";

async function writeJson(path: string, data: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(data), "utf8");
}

async function touch(path: string): Promise<void> {
  await writeFile(path, "", "utf8");
}

describe("detectWorkspaces", () => {
  const tmp = tmpDirFactory("roboto-detect-");
  afterEach(tmp.cleanup);
  const makeTmp = tmp.make;

  it("single repo: root pkg deps {next,react} → {'.': ['stack/nextjs','stack/react']}", async () => {
    const tmp = await makeTmp();
    await writeJson(join(tmp, "package.json"), {
      dependencies: { next: "^14", react: "^18" },
    });
    const result = await detectWorkspaces(tmp);
    expect(result).toEqual({ ".": ["stack/nextjs", "stack/react"] });
  });

  it("pnpm monorepo: child workspaces detected, no '.' key when root has no signals", async () => {
    const tmp = await makeTmp();
    // root
    await writeJson(join(tmp, "package.json"), { name: "root" });
    await writeFile(
      join(tmp, "pnpm-workspace.yaml"),
      'packages:\n  - "apps/*"\n  - "packages/*"\n',
      "utf8",
    );

    // apps/web — next + react
    await mkdir(join(tmp, "apps", "web"), { recursive: true });
    await writeJson(join(tmp, "apps", "web", "package.json"), {
      dependencies: { next: "^14", react: "^18" },
    });

    // apps/studio — sanity dep + sanity.config.ts
    await mkdir(join(tmp, "apps", "studio"), { recursive: true });
    await writeJson(join(tmp, "apps", "studio", "package.json"), {
      dependencies: { sanity: "^3" },
    });
    await touch(join(tmp, "apps", "studio", "sanity.config.ts"));

    // packages/ui — react
    await mkdir(join(tmp, "packages", "ui"), { recursive: true });
    await writeJson(join(tmp, "packages", "ui", "package.json"), {
      dependencies: { react: "^18" },
    });

    const result = await detectWorkspaces(tmp);

    expect(Object.keys(result).sort()).toEqual(
      ["apps/web", "apps/studio", "packages/ui"].sort(),
    );
    expect(result["apps/web"]).toEqual(["stack/nextjs", "stack/react"]);
    expect(result["apps/studio"]).toEqual(["stack/sanity"]);
    expect(result["packages/ui"]).toEqual(["stack/react"]);
    expect(result["."]).toBeUndefined();
  });

  it("npm workspaces array: package.json workspaces field behaves like pnpm", async () => {
    const tmp = await makeTmp();
    await writeJson(join(tmp, "package.json"), {
      name: "root",
      workspaces: ["apps/*"],
    });

    await mkdir(join(tmp, "apps", "site"), { recursive: true });
    await writeJson(join(tmp, "apps", "site", "package.json"), {
      dependencies: { astro: "^4" },
    });

    const result = await detectWorkspaces(tmp);
    expect(result).toEqual({ "apps/site": ["stack/astro"] });
    expect(result["."]).toBeUndefined();
  });

  it("config-file beats missing dep: astro.config.mjs with empty deps → stack/astro", async () => {
    const tmp = await makeTmp();
    await writeJson(join(tmp, "package.json"), { name: "astro-site" });
    await touch(join(tmp, "astro.config.mjs"));

    const result = await detectWorkspaces(tmp);
    expect(result).toEqual({ ".": ["stack/astro"] });
  });

  it("dedupe + sort: deps {next,react} + next.config.ts present → ['stack/nextjs','stack/react']", async () => {
    const tmp = await makeTmp();
    await writeJson(join(tmp, "package.json"), {
      dependencies: { next: "^14", react: "^18" },
    });
    await touch(join(tmp, "next.config.ts"));

    const result = await detectWorkspaces(tmp);
    // nextjs should not be doubled; must be alpha sorted
    expect(result["."]).toEqual(["stack/nextjs", "stack/react"]);
  });

  it("malformed package.json in one workspace dir → that dir skipped, others detected, no throw", async () => {
    const tmp = await makeTmp();
    await writeJson(join(tmp, "package.json"), {
      workspaces: ["apps/*"],
    });

    // bad — malformed JSON
    await mkdir(join(tmp, "apps", "bad"), { recursive: true });
    await writeFile(
      join(tmp, "apps", "bad", "package.json"),
      "{ not json",
      "utf8",
    );

    // good
    await mkdir(join(tmp, "apps", "good"), { recursive: true });
    await writeJson(join(tmp, "apps", "good", "package.json"), {
      dependencies: { vue: "^3" },
    });

    const result = await detectWorkspaces(tmp);
    expect(result["apps/bad"]).toBeUndefined();
    expect(result["apps/good"]).toEqual(["stack/vue"]);
  });

  it("empty dir (no package.json at all) → {}", async () => {
    const tmp = await makeTmp();
    const result = await detectWorkspaces(tmp);
    expect(result).toEqual({});
  });
});
