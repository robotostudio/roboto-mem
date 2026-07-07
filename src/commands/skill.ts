import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { glob } from "tinyglobby";
import { loadConfig } from "../core/config.js";
import { DATE_RULE, isValidDate } from "../core/entry.js";
import { type ExecResult, exec } from "../core/exec.js";
import { defaultSkillsTarget } from "../core/materialize.js";
import { ensureRepo, memoryHome } from "../core/memory-repo.js";
import { scanEntry } from "../core/scan.js";
import {
  findSymlink,
  PROVENANCE_FILE,
  type Provenance,
  parseSkillFrontmatter,
} from "../core/skill.js";
import type { CommandResult } from "../core/types.js";
import { compareUrl } from "./promote.js";

export type GhRunner = (args: string[], cwd: string) => Promise<ExecResult>;

export interface SkillAddOptions {
  cwd: string;
  source: string;
  skill?: string;
  ref?: string;
  author: string;
  date: string;
  home?: string;
  ghRunner?: GhRunner;
}

const fail = (output: string): CommandResult => ({ exitCode: 1, output });
const ok = (output: string): CommandResult => ({ exitCode: 0, output });

const defaultGhRunner: GhRunner = (args, cwd) => exec("gh", args, { cwd });

const OWNER_REPO_RE = /^[\w.-]+\/[\w.-]+$/;

export const normalizeSource = (
  source: string,
): { url: string; label: string } | undefined => {
  if (/^https:\/\/\S+$/.test(source)) {
    return { url: source, label: source.replace(/\.git$/, "") };
  }
  // absolute path or file:// — local remotes (tests, mirrors, non-GitHub hosts)
  if (source.startsWith("/") || source.startsWith("file://")) {
    return { url: source, label: source };
  }
  if (OWNER_REPO_RE.test(source)) {
    return {
      url: `https://github.com/${source}.git`,
      label: `github:${source}`,
    };
  }
  return undefined;
};

// ─── Upstream fetch + skill location ─────────────────────────────────────────

interface Upstream {
  dir: string;
  sha: string;
  cleanup: () => Promise<void>;
}

const fetchUpstream = async (
  url: string,
  ref: string | undefined,
): Promise<Upstream | { error: string }> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "rm-vendor-"));
  const cleanup = (): Promise<void> =>
    rm(dir, { recursive: true, force: true });

  const cloneArgs = ref
    ? ["clone", url, dir]
    : ["clone", "--depth", "1", url, dir];
  const clone = await exec("git", cloneArgs, { timeoutMs: 60_000 });
  if (!clone.ok) {
    await cleanup();
    return { error: `git clone failed: ${clone.stderr}` };
  }

  if (ref) {
    const checkout = await exec("git", ["checkout", ref], { cwd: dir });
    if (!checkout.ok) {
      await cleanup();
      return { error: `git checkout ${ref} failed: ${checkout.stderr}` };
    }
  }

  const revParse = await exec("git", ["rev-parse", "HEAD"], { cwd: dir });
  if (!revParse.ok) {
    await cleanup();
    return { error: `git rev-parse failed: ${revParse.stderr}` };
  }

  return { dir, sha: revParse.stdout.trim(), cleanup };
};

type Located =
  | { ok: true; relDir: string; rootOnly: boolean }
  | { ok: false; error: string };

const locateSkillDir = async (
  cloneDir: string,
  skillArg: string | undefined,
): Promise<Located> => {
  const hasSkillMd = async (rel: string): Promise<boolean> =>
    readFile(path.join(cloneDir, rel, "SKILL.md"), "utf8").then(
      () => true,
      () => false,
    );

  if (skillArg) {
    if (
      path.isAbsolute(skillArg) ||
      skillArg.includes("\\") ||
      skillArg.split("/").includes("..")
    ) {
      return {
        ok: false,
        error: `Invalid --skill "${skillArg}" — must be a skill name or repo-relative path without ".."`,
      };
    }

    const root = path.resolve(cloneDir) + path.sep;
    const contained = (rel: string): boolean =>
      path.resolve(cloneDir, rel).startsWith(root);

    const candidates = [`skills/${skillArg}`, skillArg].filter(contained);
    for (const rel of candidates) {
      if (await hasSkillMd(rel))
        return { ok: true, relDir: rel, rootOnly: false };
    }
    return {
      ok: false,
      error: `no SKILL.md found at skills/${skillArg}/ or ${skillArg}/ in the upstream repo`,
    };
  }

  const found = await glob(["**/SKILL.md"], {
    cwd: cloneDir,
    ignore: [".git/**", "node_modules/**"],
    followSymbolicLinks: false,
  });
  found.sort();

  if (found.length === 0) {
    return { ok: false, error: "no SKILL.md found in the upstream repo" };
  }
  if (found.length > 1) {
    const names = found.map((f) => path.dirname(f)).slice(0, 10);
    return {
      ok: false,
      error: [
        "multiple skills found — pass --skill <name>:",
        ...names.map((n) => `  ${n}`),
      ].join("\n"),
    };
  }

  const relDir = path.dirname(found[0] ?? "");
  return relDir === "."
    ? { ok: true, relDir: ".", rootOnly: true }
    : { ok: true, relDir, rootOnly: false };
};

// ─── Scanning ────────────────────────────────────────────────────────────────

interface SkillScan {
  errors: string[];
  warnings: string[];
}

const scanSkillFiles = async (absDir: string): Promise<SkillScan> => {
  const files = (
    await glob(["**/*"], {
      cwd: absDir,
      dot: true,
      ignore: [".git/**"],
      followSymbolicLinks: false,
    })
  ).filter((f) => f !== PROVENANCE_FILE);
  files.sort();

  const errors: string[] = [];
  const warnings: string[] = [];
  for (const f of files) {
    const text = await readFile(path.join(absDir, f), "utf8").catch(() => "");
    for (const finding of scanEntry(text)) {
      const line = `  ${f}: [${finding.rule}] ${finding.match}`;
      if (finding.severity === "error") errors.push(line);
      else warnings.push(line);
    }
  }
  return { errors, warnings };
};

// ─── Shared PR submission (used by add + promote) ────────────────────────────

export interface SubmitSkillArgs {
  name: string;
  /** absolute dir holding the skill files to vendor (never contains .git we want) */
  sourceDir: string;
  /** copy only SKILL.md (root-level upstream skill) */
  skillMdOnly?: boolean;
  provenance?: Provenance;
  commonsUrl: string;
  home: string;
  ghRunner: GhRunner;
  commitLabel: string;
}

export const submitSkillPr = async (
  args: SubmitSkillArgs,
): Promise<CommandResult> => {
  const repoSync = await ensureRepo(args.commonsUrl, args.home);
  if (!repoSync.ok) {
    return fail(`Failed to sync commons repo: ${repoSync.error}`);
  }
  const cloneDir = repoSync.dir;
  const relDir = `skills/${args.name}`;
  const absTarget = path.join(cloneDir, relDir);

  const symlink = await findSymlink(args.sourceDir);
  if (symlink) {
    return fail(
      `Refusing to vendor: symbolic link found at ${symlink} — symbolic links are not allowed in vendored skills.`,
    );
  }

  const scan = await scanSkillFiles(args.sourceDir);
  if (scan.errors.length > 0) {
    return fail(["Secret scan failed:", ...scan.errors].join("\n"));
  }

  const existing = await readFile(
    path.join(absTarget, "SKILL.md"),
    "utf8",
  ).then(
    () => true,
    () => false,
  );

  const branch = `skill/${args.name}`;
  const gitCleanup = (): Promise<ExecResult> =>
    exec("git", ["checkout", "main"], { cwd: cloneDir });

  const checkout = await exec("git", ["checkout", "-B", branch, "main"], {
    cwd: cloneDir,
  });
  if (!checkout.ok) return fail(`git checkout failed: ${checkout.stderr}`);

  await rm(absTarget, { recursive: true, force: true });
  await mkdir(absTarget, { recursive: true });
  if (args.skillMdOnly) {
    await cp(
      path.join(args.sourceDir, "SKILL.md"),
      path.join(absTarget, "SKILL.md"),
    );
  } else {
    await cp(args.sourceDir, absTarget, {
      recursive: true,
      filter: (s) => path.basename(s) !== ".git",
    });
  }
  if (args.provenance) {
    await writeFile(
      path.join(absTarget, PROVENANCE_FILE),
      `${JSON.stringify(args.provenance, null, 2)}\n`,
      "utf8",
    );
  }

  const add = await exec("git", ["add", relDir], { cwd: cloneDir });
  if (!add.ok) {
    await gitCleanup();
    return fail(`git add failed: ${add.stderr}`);
  }

  // re-vendoring an unchanged upstream stages nothing — succeed without an empty PR
  const staged = await exec("git", ["diff", "--cached", "--quiet"], {
    cwd: cloneDir,
  });
  if (staged.ok) {
    await gitCleanup();
    return ok(`${relDir} is already up to date — nothing to submit.`);
  }

  const commitMsg = `skill(${args.name}): ${args.commitLabel}`;
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

  const prResult = await args.ghRunner(
    [
      "pr",
      "create",
      "--title",
      commitMsg,
      "--body",
      `Team skill ${existing ? "update" : "addition"} via roboto-mem.`,
      "--head",
      branch,
    ],
    cloneDir,
  );

  await gitCleanup();

  const modeLine = existing
    ? `Skill updated: ${relDir} (existing team skill replaced in this PR)`
    : `Skill added: ${relDir}`;
  const rootNote = args.skillMdOnly
    ? [
        "Note: upstream skill lives at the repo root — only SKILL.md was vendored.",
      ]
    : [];
  const warningLines = scan.warnings.length
    ? ["", "Warnings (non-blocking):", ...scan.warnings]
    : [];

  if (prResult.ok) {
    return ok(
      [
        modeLine,
        ...rootNote,
        `Branch: ${branch}`,
        `PR: ${prResult.stdout.trim()}`,
        ...warningLines,
      ].join("\n"),
    );
  }

  const fallback =
    compareUrl(args.commonsUrl, branch) ??
    `open a PR for branch ${branch} on your git host`;
  return ok(
    [
      modeLine,
      ...rootNote,
      `Branch: ${branch}`,
      `gh unavailable — ${fallback}`,
      ...warningLines,
    ].join("\n"),
  );
};

// ─── skill add (vendor) ──────────────────────────────────────────────────────

export const runSkillAdd = async (
  options: SkillAddOptions,
): Promise<CommandResult> => {
  const {
    cwd,
    source,
    skill,
    ref,
    author,
    date,
    home = memoryHome(),
    ghRunner = defaultGhRunner,
  } = options;

  if (!author.trim()) return fail("author must not be empty.");
  if (!isValidDate(date))
    return fail(
      `Invalid date "${date}". Must be ${DATE_RULE} and a real calendar date.`,
    );

  const normalized = normalizeSource(source);
  if (!normalized) {
    return fail(
      `Unusable source "${source}" — expected owner/repo or an https git URL.`,
    );
  }

  const configResult = await loadConfig(cwd);
  if (!configResult.ok) {
    const detail =
      configResult.reason === "missing"
        ? `No .roboto-mem.json found in ${cwd}. Run roboto-mem init first.`
        : configResult.detail;
    return fail(detail);
  }

  const upstream = await fetchUpstream(normalized.url, ref);
  if ("error" in upstream) return fail(upstream.error);

  try {
    const located = await locateSkillDir(upstream.dir, skill);
    if (!located.ok) return fail(located.error);

    const sourceDir = path.join(upstream.dir, located.relDir);
    const raw = await readFile(path.join(sourceDir, "SKILL.md"), "utf8");
    const fm = parseSkillFrontmatter(raw);
    if (!fm.ok) return fail(`upstream SKILL.md: ${fm.error}`);

    const provenance: Provenance = {
      source: normalized.label,
      ref: upstream.sha,
      path: located.relDir,
      vendoredAt: date,
      vendoredBy: author,
    };

    return await submitSkillPr({
      name: fm.name,
      sourceDir,
      skillMdOnly: located.rootOnly,
      provenance,
      commonsUrl: configResult.config.commons,
      home,
      ghRunner,
      commitLabel: `vendor ${normalized.label}@${upstream.sha.slice(0, 7)}`,
    });
  } finally {
    await upstream.cleanup();
  }
};

// ─── skill promote (personal → team) ────────────────────────────────────────

export interface SkillPromoteOptions {
  cwd: string;
  name: string;
  author: string;
  date: string;
  home?: string;
  skillsRoot?: string;
  ghRunner?: GhRunner;
}

export const runSkillPromote = async (
  options: SkillPromoteOptions,
): Promise<CommandResult> => {
  const {
    cwd,
    name,
    author,
    date,
    home = memoryHome(),
    skillsRoot = defaultSkillsTarget(),
    ghRunner = defaultGhRunner,
  } = options;

  if (!author.trim()) return fail("author must not be empty.");
  if (!isValidDate(date))
    return fail(
      `Invalid date "${date}". Must be ${DATE_RULE} and a real calendar date.`,
    );

  const configResult = await loadConfig(cwd);
  if (!configResult.ok) {
    const detail =
      configResult.reason === "missing"
        ? `No .roboto-mem.json found in ${cwd}. Run roboto-mem init first.`
        : configResult.detail;
    return fail(detail);
  }

  const sourceDir = path.join(skillsRoot, name);
  const raw = await readFile(path.join(sourceDir, "SKILL.md"), "utf8").catch(
    () => undefined,
  );
  if (raw === undefined) {
    return fail(`No personal skill at ${sourceDir} (expected SKILL.md).`);
  }

  const fm = parseSkillFrontmatter(raw);
  if (!fm.ok) return fail(`SKILL.md: ${fm.error}`);
  if (fm.name !== name) {
    return fail(
      `frontmatter name "${fm.name}" must match the skill directory "${name}".`,
    );
  }

  return submitSkillPr({
    name,
    sourceDir,
    commonsUrl: configResult.config.commons,
    home,
    ghRunner,
    commitLabel: "promote from personal memory",
  });
};
