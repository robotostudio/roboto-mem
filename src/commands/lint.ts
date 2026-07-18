import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { glob } from "tinyglobby";
import { entryRef, estimateTokens, scopeKey } from "../core/digest.js";
import type { Entry } from "../core/entry.js";
import { loadMemory } from "../core/memory-repo.js";
import { scanEntry } from "../core/scan.js";
import { isValidScope, SCOPE_ID_RE } from "../core/scopes.js";
import { findSymlink, loadSkills, PROVENANCE_FILE } from "../core/skill.js";
import type { CommandResult } from "../core/types.js";

export interface LintOptions {
  dir: string;
}

// Override ref format: <scope>/<name>  where scope may itself contain "/"
// name = segment after final "/", scope = everything before it

interface ParsedRef {
  scope: string;
  name: string;
}

const parseRef = (ref: string): ParsedRef | null => {
  const lastSlash = ref.lastIndexOf("/");
  if (lastSlash === -1) return null;
  const scope = ref.slice(0, lastSlash);
  const name = ref.slice(lastSlash + 1);
  if (!scope || !name) return null;
  if (!isValidScope(scope) || !SCOPE_ID_RE.test(name)) return null;
  return { scope, name };
};

// ─── Finding collectors ───────────────────────────────────────────────────────

const manifestFindings = (
  load: Awaited<ReturnType<typeof loadMemory>>,
): string[] => {
  if (load.ok) return [];
  if (load.reason === "missing-manifest") {
    return [`memory.json: ${load.detail}`];
  }
  return [
    `memory.json: format version ${load.formatVersion} is newer than this tool supports -- upgrade the pinned roboto-mem version in CI`,
  ];
};

const parseErrorFindings = (
  errors: { file: string; error: string }[],
): string[] => errors.map(({ file, error }) => `${file}: ${error}`);

const overrideFindings = (entries: Entry[]): string[] => {
  const findings: string[] = [];

  // Build lookup: entry ref ("scope/name", or bare "name" if untagged) -> entry.
  // Note: parseRef below is still legacy-only (org/squad/stack/project) —
  // library:{name} and bare (untagged-target) override refs are Phase 5
  // work (commons-side migration + lint v2 validation); this key
  // construction just stays consistent with digest.ts's entryRef so the
  // map itself never holds a nonsense "undefined/name" key.
  const byRef = new Map<string, Entry>(entries.map((e) => [entryRef(e), e]));

  for (const entry of entries) {
    if (!entry.overrides) continue;

    // Only standards can declare overrides
    if (entry.type === "lesson") {
      findings.push(`${entry.file}: only standards can declare overrides`);
      continue;
    }

    const parsed = parseRef(entry.overrides);
    if (!parsed) {
      findings.push(
        `${entry.file}: invalid override ref format "${entry.overrides}" -- expected <scope>/<kebab-name>`,
      );
      continue;
    }

    const refKey = `${parsed.scope}/${parsed.name}`;
    const target = byRef.get(refKey);

    if (!target) {
      findings.push(
        `${entry.file}: declared override target ${entry.overrides} not found`,
      );
      continue;
    }

    if (target.type === "lesson") {
      findings.push(
        `${entry.file}: override target ${entry.overrides} is a lesson, not a standard`,
      );
    }
  }

  return findings;
};

const budgetFindings = (
  entries: Entry[],
  budgets: Record<string, number>,
): string[] => {
  const byScope = new Map<string, Entry[]>();
  for (const entry of entries) {
    const key = scopeKey(entry.scope);
    const group = byScope.get(key) ?? [];
    group.push(entry);
    byScope.set(key, group);
  }

  const findings: string[] = [];

  for (const [scope, group] of byScope) {
    const text = group.map((e) => e.name + e.description + e.body).join("");
    const tokens = estimateTokens(text);
    const cap = budgets[scope] ?? budgets.default ?? 2000;
    if (tokens > cap) {
      const firstFile = group[0]?.file ?? scope;
      findings.push(
        `${firstFile}: scope ${scope} exceeds its budget (${tokens} > ${cap} tokens)`,
      );
    }
  }

  return findings;
};

interface SecretResult {
  errors: string[];
  warnings: string[];
}

const secretFindings = (entries: Entry[]): SecretResult => {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const entry of entries) {
    const text = `${entry.description}\n${entry.body}`;
    for (const finding of scanEntry(text)) {
      const line = `${entry.file}: [${finding.rule}] ${finding.match}`;
      if (finding.severity === "error") {
        errors.push(line);
      } else {
        warnings.push(line);
      }
    }
  }

  return { errors, warnings };
};

// ─── Skill finding collectors ────────────────────────────────────────────────

const skillErrorFindings = (
  errors: { dir: string; error: string }[],
): string[] =>
  errors.map(({ dir, error }) => `skills/${dir}/SKILL.md: ${error}`);

const skillSecretFindings = async (
  repoDir: string,
  dirNames: string[],
): Promise<SecretResult> => {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const dirName of dirNames) {
    const abs = path.join(repoDir, "skills", dirName);

    const symlink = await findSymlink(abs);
    if (symlink) {
      errors.push(
        `skills/${dirName}/${symlink}: symbolic links are not allowed in skills`,
      );
    }

    const files = (
      await glob(["**/*"], {
        cwd: abs,
        dot: true,
        followSymbolicLinks: false,
      })
    ).filter((f) => f !== PROVENANCE_FILE);
    files.sort();
    for (const f of files) {
      const text = await readFile(path.join(abs, f), "utf8").catch(() => "");
      for (const finding of scanEntry(text)) {
        const line = `skills/${dirName}/${f}: [${finding.rule}] ${finding.match}`;
        if (finding.severity === "error") errors.push(line);
        else warnings.push(line);
      }
    }
  }
  return { errors, warnings };
};

// ─── Main command ─────────────────────────────────────────────────────────────

export const runLint = async (options: LintOptions): Promise<CommandResult> => {
  const load = await loadMemory(options.dir);

  if (!load.ok) {
    return { exitCode: 1, output: manifestFindings(load).join("\n") };
  }

  const { entries, errors: parseErrors, budgets } = load;

  const errorLines: string[] = [
    ...parseErrorFindings(parseErrors),
    ...overrideFindings(entries),
    ...budgetFindings(entries, budgets),
  ];

  const skillsLoad = await loadSkills(options.dir);
  errorLines.push(...skillErrorFindings(skillsLoad.errors));

  const skillSecrets = await skillSecretFindings(
    options.dir,
    skillsLoad.dirNames,
  );
  errorLines.push(...skillSecrets.errors);

  const { errors: secretErrors, warnings: secretWarnings } =
    secretFindings(entries);
  errorLines.push(...secretErrors);

  const allWarnings = [...secretWarnings, ...skillSecrets.warnings];
  const warningsSection =
    allWarnings.length > 0 ? `\nwarnings:\n${allWarnings.join("\n")}` : "";

  if (errorLines.length > 0) {
    return {
      exitCode: 1,
      output: `${errorLines.join("\n")}${warningsSection}`,
    };
  }

  const skillSuffix =
    skillsLoad.skills.length > 0 ? `, ${skillsLoad.skills.length} skills` : "";
  return {
    exitCode: 0,
    output: `✓ ${entries.length} entries${skillSuffix}, 0 problems${warningsSection}`,
  };
};
