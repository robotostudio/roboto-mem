import * as fs from "node:fs/promises";
import * as path from "node:path";
import { loadConfig } from "../core/config.js";
import { findSimilar } from "../core/dedupe.js";
import { DATE_RE, entryPathForScope, serializeEntry } from "../core/entry.js";
import { type ExecResult, exec } from "../core/exec.js";
import { ensureRepo, loadMemory, memoryHome } from "../core/memory-repo.js";
import { scanEntry } from "../core/scan.js";
import { isValidScope, SCOPE_ID_RE } from "../core/scopes.js";
import type { CommandResult } from "../core/types.js";

export interface PromoteOptions {
  cwd: string;
  scope: string;
  type: "standard" | "lesson";
  name: string;
  description: string;
  body: string;
  author: string;
  date: string;
  overrides?: string;
  force?: boolean;
  home?: string;
  ghRunner?: (args: string[], cwd: string) => Promise<ExecResult>;
}

const fail = (output: string): CommandResult => ({ exitCode: 1, output });
const ok = (output: string): CommandResult => ({ exitCode: 0, output });

/** Derives a GitHub compare URL from a remote URL and branch name, or undefined for non-GitHub remotes. */
export const compareUrl = (
  commonsUrl: string,
  branch: string,
): string | undefined => {
  const m = /github\.com[:/](.+?)(?:\.git)?$/.exec(commonsUrl);
  return m ? `https://github.com/${m[1]}/compare/main...${branch}` : undefined;
};

const branchName = (scope: string, name: string): string =>
  `promote/${scope.replace(/\//g, "-")}-${name}`;

const defaultGhRunner = (args: string[], cwd: string): Promise<ExecResult> =>
  exec("gh", args, { cwd });

export const runPromote = async (
  options: PromoteOptions,
): Promise<CommandResult> => {
  const {
    cwd,
    scope,
    type,
    name,
    description,
    body,
    author,
    date,
    overrides,
    force = false,
    home = memoryHome(),
    ghRunner = defaultGhRunner,
  } = options;

  // --- Gate 1: validate inputs ---
  if (!isValidScope(scope)) {
    return fail(
      `Invalid scope "${scope}". Must be org, squad/<s>, stack/<k>, or project/<p>.`,
    );
  }
  if (!SCOPE_ID_RE.test(name)) {
    return fail(`Invalid name "${name}". Must match /^[a-z0-9][a-z0-9-]*$/.`);
  }
  if (type !== "standard" && type !== "lesson") {
    return fail(`Invalid type "${type}". Must be "standard" or "lesson".`);
  }
  if (!DATE_RE.test(date)) {
    return fail(`Invalid date "${date}". Must be YYYY-MM-DD.`);
  }
  if (!description.trim()) return fail("description must not be empty.");
  if (!body.trim()) return fail("body must not be empty.");
  if (!author.trim()) return fail("author must not be empty.");

  // --- Gate 2: load config ---
  const configResult = await loadConfig(cwd);
  if (!configResult.ok) {
    const detail =
      configResult.reason === "newer-config"
        ? configResult.detail
        : configResult.reason === "missing"
          ? `No .roboto-mem.json found in ${cwd}. Run roboto-mem init first.`
          : `Config invalid: ${configResult.detail}`;
    return fail(detail);
  }
  const { commons } = configResult.config;

  // --- Gate 3: ensure clone ---
  const repoSync = await ensureRepo(commons, home);
  if (!repoSync.ok)
    return fail(`Failed to sync commons repo: ${repoSync.error}`);
  const { dir: cloneDir } = repoSync;

  // --- Gate 4: load memory + collision/dedupe/scan ---
  const mem = await loadMemory(cloneDir);
  if (!mem.ok) {
    if (mem.reason === "newer-format") {
      return fail(
        `Memory repo format version ${mem.formatVersion} is newer than supported. Upgrade roboto-mem.`,
      );
    }
    return fail(`Failed to load memory: ${mem.detail}`);
  }

  // 4a: exact collision
  const relPath = entryPathForScope(scope, name);
  const collision = mem.entries.find((e) => e.file === relPath);
  if (collision) {
    return fail(
      `Entry already exists at ${relPath}. Edit it directly instead of promoting a new one.`,
    );
  }

  // 4b: dedupe (bypassed by force)
  if (!force) {
    const similar = findSimilar({ name, description, body }, mem.entries);
    if (similar.length > 0) {
      const lines = similar.map(
        (m) => `  ${m.candidate.file} (score ${m.score.toFixed(2)})`,
      );
      return fail(
        [
          "Similar entries already exist — use --force to promote anyway:",
          ...lines,
        ].join("\n"),
      );
    }
  }

  // 4c: scan (never bypassed by force)
  const scanText = `${description}\n${body}`;
  const findings = scanEntry(scanText);
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");

  if (errors.length > 0) {
    const lines = errors.map((f) => `  [${f.rule}] ${f.match}`);
    return fail(["Secret scan failed:", ...lines].join("\n"));
  }

  // --- Gate 5: build entry ---
  const entry = {
    name,
    description,
    type,
    scope,
    author,
    date,
    body,
    file: relPath,
    ...(overrides !== undefined ? { overrides } : {}),
  };

  // --- Gate 6: git operations in clone ---
  const branch = branchName(scope, name);
  const absEntryPath = path.join(cloneDir, relPath);

  const gitCleanup = async (): Promise<void> => {
    await exec("git", ["checkout", "main"], { cwd: cloneDir });
  };

  const checkoutResult = await exec("git", ["checkout", "-B", branch, "main"], {
    cwd: cloneDir,
  });
  if (!checkoutResult.ok) {
    return fail(`git checkout failed: ${checkoutResult.stderr}`);
  }

  await fs.mkdir(path.dirname(absEntryPath), { recursive: true });
  await fs.writeFile(absEntryPath, serializeEntry(entry), "utf8");

  const addResult = await exec("git", ["add", relPath], { cwd: cloneDir });
  if (!addResult.ok) {
    await gitCleanup();
    return fail(`git add failed: ${addResult.stderr}`);
  }

  const commitMsg = `promote(${scope}): ${name}`;
  const commitResult = await exec("git", ["commit", "-m", commitMsg], {
    cwd: cloneDir,
  });
  if (!commitResult.ok) {
    await gitCleanup();
    return fail(`git commit failed: ${commitResult.stderr}`);
  }

  const pushResult = await exec("git", ["push", "-u", "origin", branch], {
    cwd: cloneDir,
  });
  if (!pushResult.ok) {
    await gitCleanup();
    return fail(`git push failed: ${pushResult.stderr}`);
  }

  // --- Gate 7: open PR via ghRunner ---
  const prTitle = `promote(${scope}): ${name}`;
  const prBody = `${description}\n\nPromoted by ${author} on ${date} via roboto-mem.`;

  const prResult = await ghRunner(
    ["pr", "create", "--title", prTitle, "--body", prBody, "--head", branch],
    cloneDir,
  );

  const warningLines =
    warnings.length > 0
      ? [
          "",
          "Warnings (non-blocking):",
          ...warnings.map((f) => `  [${f.rule}] ${f.match}`),
        ]
      : [];

  // Best-effort: return clone to main so subsequent runs start clean
  await exec("git", ["checkout", "main"], { cwd: cloneDir });

  if (prResult.ok) {
    return ok(
      [
        `Entry written: ${relPath}`,
        `Branch: ${branch}`,
        `PR: ${prResult.stdout.trim()}`,
        ...warningLines,
      ].join("\n"),
    );
  }

  // gh failed (spawn or exit) — still success overall
  const fallback =
    compareUrl(commons, branch) ??
    `open a PR for branch ${branch} on your git host`;

  return ok(
    [
      `Entry written: ${relPath}`,
      `Branch: ${branch}`,
      `gh unavailable — ${fallback}`,
      ...warningLines,
    ].join("\n"),
  );
};
