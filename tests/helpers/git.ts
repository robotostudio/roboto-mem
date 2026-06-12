import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { exec } from "../../src/core/exec.js";

export interface CommonsFixture {
  remoteUrl: string;
  workdir: string;
}

const run = async (cmd: string, args: string[], cwd: string): Promise<void> => {
  const result = await exec(cmd, args, { cwd });
  if (!result.ok) {
    throw new Error(
      `${cmd} ${args.join(" ")} failed (cwd=${cwd}): ${result.stderr}`,
    );
  }
};

const MEMORY_JSON = JSON.stringify(
  { formatVersion: 1, budgets: { default: 2000, org: 4000 } },
  null,
  2,
);

const SAMPLE_ENTRIES: Array<{ relPath: string; content: string }> = [
  {
    relPath: "entries/org/never-use-let.md",
    content: `---
description: Never use let; const everything
type: standard
author: hrithik
date: 2026-06-01
---
Always use const. Restructure with ternary, reduce, or early returns instead of reassigning variables.`,
  },
  {
    relPath: "entries/stacks/sanity/typegen-flag.md",
    content: `---
description: TypeGen v3 flag breaks our client wrapper
type: lesson
author: hrithik
date: 2026-05-30
---
Running sanity typegen generate with --experimental flag breaks createClient typing. Pin to v2 syntax until the issue is resolved.`,
  },
  {
    relPath: "entries/squads/web/let-hotpaths.md",
    content: `---
description: let allowed in hot paths
type: standard
author: hrithik
date: 2026-06-02
overrides: org/never-use-let
---
In tight loops where reducing allocations matters, mutable accumulators are acceptable.`,
  },
];

export const makeCommonsFixture = async (
  tmp: string,
): Promise<CommonsFixture> => {
  const bareDir = path.join(tmp, "commons.git");
  const workdir = path.join(tmp, "work");

  await run("git", ["init", "--bare", "--initial-branch=main", bareDir], tmp);
  await run("git", ["clone", bareDir, workdir], tmp);

  await run("git", ["config", "user.email", "test@example.com"], workdir);
  await run("git", ["config", "user.name", "Test User"], workdir);

  await writeFile(path.join(workdir, "memory.json"), MEMORY_JSON, "utf8");

  for (const { relPath, content } of SAMPLE_ENTRIES) {
    const abs = path.join(workdir, relPath);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
  }

  await run("git", ["add", "."], workdir);
  await run("git", ["commit", "-m", "initial"], workdir);
  await run("git", ["push", "origin", "main"], workdir);

  return { remoteUrl: bareDir, workdir };
};

export const pushEntry = async (
  fixture: CommonsFixture,
  relPath: string,
  content: string,
): Promise<void> => {
  const abs = path.join(fixture.workdir, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
  await run("git", ["add", relPath], fixture.workdir);
  await run("git", ["commit", "-m", `add ${relPath}`], fixture.workdir);
  await run("git", ["push", "origin", "main"], fixture.workdir);
};
