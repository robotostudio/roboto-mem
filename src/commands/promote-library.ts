import { cp, mkdir, rm } from "node:fs/promises";
import * as path from "node:path";
import { loadConfigV2 } from "../core/config.js";
import { diffDirs, formatDirDiff } from "../core/dir-diff.js";
import { DATE_RULE, isValidDate } from "../core/entry.js";
import { type ExecResult, exec } from "../core/exec.js";
import { librariesHome } from "../core/library.js";
import { exists } from "../core/materialize.js";
import { ensureRepo, memoryHome } from "../core/memory-repo.js";
import { SCOPE_ID_RE, SCOPE_ID_RULE } from "../core/scopes.js";
import { hashSkillDir } from "../core/skill-manifest.js";
import type { CommandResult } from "../core/types.js";
import { compareUrl } from "./promote.js";

export type GhRunner = (args: string[], cwd: string) => Promise<ExecResult>;

export interface PromoteLibraryOptions {
  cwd: string;
  name: string;
  /** Overrides the project's `.roboto-mem.json` commons — either this or a
   * v2 config at `cwd` is required. */
  commonsUrl?: string;
  author: string;
  date: string;
  home?: string;
  /** defaults to ~/.roboto-mem/libraries — override for tests */
  librariesRoot?: string;
  ghRunner?: GhRunner;
}

const fail = (output: string): CommandResult => ({ exitCode: 1, output });
const ok = (output: string): CommandResult => ({ exitCode: 0, output });

const defaultGhRunner: GhRunner = (args, cwd) => exec("gh", args, { cwd });

const resolveCommonsUrl = async (
  cwd: string,
  commonsUrl: string | undefined,
): Promise<string | undefined> => {
  if (commonsUrl) return commonsUrl;
  const v2 = await loadConfigV2(cwd);
  return v2.ok ? v2.config.commons : undefined;
};

export const runPromoteLibrary = async (
  options: PromoteLibraryOptions,
): Promise<CommandResult> => {
  const {
    cwd,
    name,
    author,
    date,
    home = memoryHome(),
    librariesRoot = librariesHome(home),
    ghRunner = defaultGhRunner,
  } = options;

  if (!SCOPE_ID_RE.test(name)) {
    return fail(`Invalid library name "${name}". Must match ${SCOPE_ID_RULE}.`);
  }
  if (!author.trim()) return fail("author must not be empty.");
  if (!isValidDate(date)) {
    return fail(
      `Invalid date "${date}". Must be ${DATE_RULE} and a real calendar date.`,
    );
  }

  const sourceDir = path.join(librariesRoot, name);
  if (!(await exists(path.join(sourceDir, "LIBRARY.md")))) {
    return fail(
      `No local library at ${sourceDir} (expected LIBRARY.md). Run roboto-mem sync first.`,
    );
  }

  const commonsUrl = await resolveCommonsUrl(cwd, options.commonsUrl);
  if (!commonsUrl) {
    return fail(
      `No --commons-url given and no .roboto-mem.json (v2) found in ${cwd}. Run roboto-mem init or pass --commons-url.`,
    );
  }

  const repoSync = await ensureRepo(commonsUrl, home);
  if (!repoSync.ok) {
    return fail(`Failed to sync commons repo: ${repoSync.error}`);
  }
  // A failed fast-forward pull surfaces as `ok: true, stale: true` — refuse
  // to build a branch/PR from that outdated snapshot (mirrors runSyncV2's
  // stale guard in src/commands/sync.ts: "never overwrite from that outdated
  // snapshot").
  if (repoSync.stale) {
    return fail(
      "Commons clone is stale (offline or pull failed) — cannot promote from an outdated base. Check network and retry.",
    );
  }
  const cloneDir = repoSync.dir;
  const relDir = `libraries/${name}`;
  const absTarget = path.join(cloneDir, relDir);

  // Diff BEFORE overwriting — this is the PR body, "what's changing on
  // commons" (dir-diff.ts's own doc comment: "symmetrically, swapping which
  // side is 'new'" from sync's pull-diff).
  const diff = await diffDirs(
    (await exists(absTarget)) ? absTarget : undefined,
    sourceDir,
  );
  const dirHash = await hashSkillDir(sourceDir);

  const branch = `library/${name}`;
  const gitCleanup = (): Promise<ExecResult> =>
    exec("git", ["checkout", "main"], { cwd: cloneDir });

  // Base the branch on an existing remote promotion branch when one is still
  // open — a second promotion before the first PR merges must build on the
  // remote tip, not re-fork from main (which discards the earlier commit and
  // gets rejected as a non-fast-forward push). Fall back to main otherwise.
  await exec("git", ["fetch", "origin"], { cwd: cloneDir });
  const remoteRef = `origin/${branch}`;
  const remoteExists = await exec(
    "git",
    ["rev-parse", "--verify", "--quiet", remoteRef],
    { cwd: cloneDir },
  );
  const base = remoteExists.ok ? remoteRef : "main";

  const checkout = await exec("git", ["checkout", "-B", branch, base], {
    cwd: cloneDir,
  });
  if (!checkout.ok) return fail(`git checkout failed: ${checkout.stderr}`);

  await rm(absTarget, { recursive: true, force: true });
  await mkdir(absTarget, { recursive: true });
  await cp(sourceDir, absTarget, { recursive: true });

  const add = await exec("git", ["add", relDir], { cwd: cloneDir });
  if (!add.ok) {
    await gitCleanup();
    return fail(`git add failed: ${add.stderr}`);
  }

  // re-promoting an unchanged local library stages nothing — succeed without an empty PR
  const staged = await exec("git", ["diff", "--cached", "--quiet"], {
    cwd: cloneDir,
  });
  if (staged.ok) {
    await gitCleanup();
    return ok(`${relDir} is already up to date — nothing to promote.`);
  }

  const commitMsg = `chore: promote library ${name}\n\n${dirHash}`;
  const commit = await exec("git", ["commit", "-m", commitMsg], {
    cwd: cloneDir,
  });
  if (!commit.ok) {
    await gitCleanup();
    return fail(`git commit failed: ${commit.stderr}`);
  }

  const push = await exec("git", ["push", "-u", "origin", branch], {
    cwd: cloneDir,
  });
  if (!push.ok) {
    await gitCleanup();
    return fail(`git push failed: ${push.stderr}`);
  }

  const prTitle = `chore: promote library ${name}`;
  const prBody = [
    `Promoted by ${author} on ${date} via roboto-mem.`,
    "",
    formatDirDiff(diff),
  ].join("\n");

  const prResult = await ghRunner(
    ["pr", "create", "--title", prTitle, "--body", prBody, "--head", branch],
    cloneDir,
  );

  await gitCleanup();

  if (prResult.ok) {
    return ok(
      [
        `Library promoted: ${relDir}`,
        `Branch: ${branch}`,
        `PR: ${prResult.stdout.trim()}`,
      ].join("\n"),
    );
  }

  const fallback =
    compareUrl(commonsUrl, branch) ??
    `open a PR for branch ${branch} on your git host`;
  return ok(
    [
      `Library promoted: ${relDir}`,
      `Branch: ${branch}`,
      `gh unavailable — ${fallback}`,
    ].join("\n"),
  );
};
