import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import * as path from "node:path";
import { loadConfig } from "./config.js";
import { DATE_RULE, ENTRY_TYPES, isValidDate } from "./entry.js";
import { type ExecResult, exec } from "./exec.js";
import { exists } from "./materialize.js";
import {
  isValidScope,
  SCOPE_ID_RE,
  SCOPE_ID_RULE,
  SCOPE_RULE,
  sessionScopes,
  splitSquads,
} from "./scopes.js";

// ─── Field descriptions — single source of truth for cli.ts arg descriptions
// and prompt copy. Extracted here so neither side duplicates the strings. ────

export const INIT_FIELD_DESC = {
  dir: "Project directory",
  commonsUrl: "Commons repo URL",
  project: "Project name",
  squads: "Comma-separated squad names",
  scaffoldCommons: "Scaffold commons repo",
  libraries: "Comma-separated library names (skips auto-detect confirmation)",
} as const;

export const PROMOTE_FIELD_DESC = {
  scope: "Entry scope",
  type: "Entry type: standard | lesson",
  name: "Entry name",
  description: "Short description",
  author: "Author",
  date: "Date (YYYY-MM-DD)",
  bodyFile: "Path to file containing body",
  overrides: "Override refs",
  force:
    "Promote despite near-duplicate matches (does not overwrite an existing entry)",
} as const;

export const SKILL_ADD_FIELD_DESC = {
  source: "owner/repo or git URL",
  skill: "Skill name when the repo has several",
  ref: "Upstream ref to pin (default: HEAD)",
  author: "Author (github handle)",
  date: "Date (YYYY-MM-DD)",
} as const;

export const SKILL_PROMOTE_FIELD_DESC = {
  name: "Skill directory name",
  author: "Author (github handle)",
  date: "Date (YYYY-MM-DD)",
} as const;

// ─── Prompt plan types (pure — no TTY, no clack) ─────────────────────────────

export interface SelectChoice {
  value: string;
  label: string;
}

export type PromptStep =
  | {
      key: string;
      kind: "text";
      message: string;
      initialValue?: string;
      placeholder?: string;
      validate?: (value: string) => string | undefined;
    }
  | {
      key: string;
      kind: "select";
      message: string;
      options: SelectChoice[];
      initialValue?: string;
      /** Escape hatch offered alongside `options`; picking it immediately
       * asks a validated free-text follow-up under the same key. */
      other?: { label: string; validate?: (v: string) => string | undefined };
    }
  | {
      key: string;
      kind: "confirm";
      message: string;
      initialValue: boolean;
    };

export type PromptAnswers = Record<string, string | boolean>;

interface StepCandidate {
  /** must have a value for the underlying command to succeed */
  required: boolean;
  missing: boolean;
  step: PromptStep;
}

/** Only-missing-required in partial mode; every missing field in full guided
 * mode. `anyProvided` is derived from the candidates themselves so callers
 * never hand-maintain a parallel OR-chain. */
const selectSteps = (candidates: StepCandidate[]): PromptStep[] => {
  const anyProvided = candidates.some((c) => !c.missing);
  return candidates
    .filter((c) => c.missing && (!anyProvided || c.required))
    .map((c) => c.step);
};

/** Empty answers "skip" a field back to undefined, matching an omitted flag. */
const pick = (
  key: string,
  providedValue: string | undefined,
  answers: PromptAnswers,
): string | undefined => {
  if (!(key in answers)) return providedValue;
  const value = String(answers[key]).trim();
  return value ? value : undefined;
};

// ─── init ─────────────────────────────────────────────────────────────────────

export interface InitProvided {
  project?: string;
  commonsUrl?: string;
  squads?: string;
  scaffoldCommons?: boolean;
  /** Global library model (v2): comma-separated library names. Presence
   * (including "") skips detection/confirmation entirely — see
   * docs/design-specs/2026-07-17-global-library-model.md. */
  libraries?: string;
}

/** Bind vs scaffold is decided once, up front, at the orchestration layer
 * (interactive.ts) — never as a step in this plan — so a guided answer can
 * never silently flip mode and discard bind answers already collected. This
 * context only ever describes the bind-fields sub-flow. */
export interface InitPromptContext {
  defaultProjectName: string;
  /** Prefilled from an existing binding on rebind; absent for a fresh bind. */
  defaultCommonsUrl?: string;
  defaultSquads?: string;
}

export interface InitPromptResult {
  project?: string;
  commonsUrl?: string;
  squads?: string[];
  scaffoldCommons?: boolean;
  libraries?: string[];
}

/** Exported so interactive.ts's "bind-libraries" commons-url prompt (global
 * library model init flow) reuses the exact same rule. */
export const validateCommonsUrl = (value: string): string | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return "must not be empty";
  return trimmed.includes("://") || trimmed.startsWith("git@")
    ? undefined
    : 'must look like a git remote (contains "://" or starts with "git@")';
};

const validateSquads = (value: string): string | undefined => {
  const invalid = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .find((s) => !SCOPE_ID_RE.test(s));
  return invalid
    ? `"${invalid}" must match ${SCOPE_ID_RULE} (try "${invalid.toLowerCase()}"?)`
    : undefined;
};

export const planInitPrompts = (
  provided: InitProvided,
  ctx: InitPromptContext,
): PromptStep[] =>
  selectSteps([
    {
      required: true,
      missing: provided.project === undefined,
      step: {
        key: "project",
        kind: "text",
        message: INIT_FIELD_DESC.project,
        initialValue: ctx.defaultProjectName,
      },
    },
    {
      required: true,
      missing: provided.commonsUrl === undefined,
      step: {
        key: "commonsUrl",
        kind: "text",
        message: INIT_FIELD_DESC.commonsUrl,
        initialValue: ctx.defaultCommonsUrl,
        validate: validateCommonsUrl,
      },
    },
    {
      required: false,
      missing: provided.squads === undefined,
      step: {
        key: "squads",
        kind: "text",
        message: INIT_FIELD_DESC.squads,
        initialValue: ctx.defaultSquads,
        validate: validateSquads,
      },
    },
  ]);

export const buildInitOptions = (
  provided: InitProvided,
  answers: PromptAnswers,
): InitPromptResult => {
  const squadsRaw = pick("squads", provided.squads, answers);
  return {
    project: pick("project", provided.project, answers),
    commonsUrl: pick("commonsUrl", provided.commonsUrl, answers)?.trim(),
    squads: squadsRaw ? splitSquads(squadsRaw) : undefined,
    scaffoldCommons:
      "scaffoldCommons" in answers
        ? (answers.scaffoldCommons as boolean)
        : provided.scaffoldCommons,
    // Never collected via runPromptSteps — the v2 flow resolves its library
    // list through init's own injected `selectLibraries` callback, not a
    // text-prompt answer — so this is a flags-only passthrough.
    libraries:
      provided.libraries !== undefined
        ? splitSquads(provided.libraries)
        : undefined,
  };
};

// ─── promote ──────────────────────────────────────────────────────────────────

export interface PromoteProvided {
  scope?: string;
  type?: string;
  name?: string;
  description?: string;
  author?: string;
  date?: string;
  bodyFile?: string;
}

export interface PromotePromptContext {
  knownScopes?: string[];
  defaultAuthor: string;
  today: string;
}

export type PromotePromptResult = PromoteProvided;

const validateEntryName = (value: string): string | undefined =>
  SCOPE_ID_RE.test(value) ? undefined : `must match ${SCOPE_ID_RULE}`;

const validateFileExists = (value: string): string | undefined =>
  value && existsSync(path.resolve(value)) ? undefined : "file not found";

/** Exported so interactive.ts's "other…" free-text follow-up (a scope typed
 * outside the detected-scopes select) reuses the exact same rule. */
export const validateScope = (value: string): string | undefined =>
  isValidScope(value) ? undefined : `must be ${SCOPE_RULE}`;

const validateDate = (value: string): string | undefined =>
  isValidDate(value)
    ? undefined
    : `must be ${DATE_RULE} and a real calendar date`;

export const planPromotePrompts = (
  provided: PromoteProvided,
  ctx: PromotePromptContext,
): PromptStep[] => {
  // Exactly this repo's detected scopes (org + its squads/stacks + itself, via
  // the same sessionScopes the digest/status scope-detection already computes
  // for cwd) plus an escape hatch to free-type anything else.
  const scopeStep: PromptStep = ctx.knownScopes
    ? {
        key: "scope",
        kind: "select",
        message: PROMOTE_FIELD_DESC.scope,
        options: ctx.knownScopes.map((s) => ({ value: s, label: s })),
        other: { label: "other…", validate: validateScope },
      }
    : {
        key: "scope",
        kind: "text",
        message: PROMOTE_FIELD_DESC.scope,
        validate: validateScope,
      };

  return selectSteps([
    { required: true, missing: provided.scope === undefined, step: scopeStep },
    {
      required: true,
      missing: provided.type === undefined,
      step: {
        key: "type",
        kind: "select",
        message: PROMOTE_FIELD_DESC.type,
        options: ENTRY_TYPES.map((t) => ({ value: t, label: t })),
      },
    },
    {
      required: true,
      missing: provided.name === undefined,
      step: {
        key: "name",
        kind: "text",
        message: PROMOTE_FIELD_DESC.name,
        validate: validateEntryName,
      },
    },
    {
      required: true,
      missing: provided.description === undefined,
      step: {
        key: "description",
        kind: "text",
        message: PROMOTE_FIELD_DESC.description,
      },
    },
    {
      required: true,
      missing: provided.author === undefined,
      step: {
        key: "author",
        kind: "text",
        message: PROMOTE_FIELD_DESC.author,
        initialValue: ctx.defaultAuthor || undefined,
      },
    },
    {
      required: false,
      missing: provided.date === undefined,
      step: {
        key: "date",
        kind: "text",
        message: PROMOTE_FIELD_DESC.date,
        initialValue: ctx.today,
        validate: validateDate,
      },
    },
    {
      required: true,
      missing: provided.bodyFile === undefined,
      step: {
        key: "bodyFile",
        kind: "text",
        message: PROMOTE_FIELD_DESC.bodyFile,
        validate: validateFileExists,
      },
    },
  ]);
};

export const buildPromoteOptions = (
  provided: PromoteProvided,
  answers: PromptAnswers,
): PromotePromptResult => ({
  scope: pick("scope", provided.scope, answers),
  type: pick("type", provided.type, answers),
  name: pick("name", provided.name, answers),
  description: pick("description", provided.description, answers),
  author: pick("author", provided.author, answers),
  date: pick("date", provided.date, answers),
  bodyFile: pick("bodyFile", provided.bodyFile, answers),
});

// ─── skill add ────────────────────────────────────────────────────────────────

export interface SkillAddProvided {
  source?: string;
  skill?: string;
  ref?: string;
  author?: string;
}

export interface SkillAddPromptContext {
  defaultAuthor: string;
}

export type SkillAddPromptResult = SkillAddProvided;

export const planSkillAddPrompts = (
  provided: SkillAddProvided,
  ctx: SkillAddPromptContext,
): PromptStep[] =>
  selectSteps([
    {
      required: true,
      missing: provided.source === undefined,
      step: {
        key: "source",
        kind: "text",
        message: SKILL_ADD_FIELD_DESC.source,
      },
    },
    {
      required: false,
      missing: provided.skill === undefined,
      step: { key: "skill", kind: "text", message: SKILL_ADD_FIELD_DESC.skill },
    },
    {
      required: false,
      missing: provided.ref === undefined,
      step: {
        key: "ref",
        kind: "text",
        message: SKILL_ADD_FIELD_DESC.ref,
        placeholder: "HEAD",
      },
    },
    {
      required: true,
      missing: provided.author === undefined,
      step: {
        key: "author",
        kind: "text",
        message: SKILL_ADD_FIELD_DESC.author,
        initialValue: ctx.defaultAuthor || undefined,
      },
    },
  ]);

export const buildSkillAddOptions = (
  provided: SkillAddProvided,
  answers: PromptAnswers,
): SkillAddPromptResult => ({
  source: pick("source", provided.source, answers),
  skill: pick("skill", provided.skill, answers),
  ref: pick("ref", provided.ref, answers),
  author: pick("author", provided.author, answers),
});

// ─── skill promote ────────────────────────────────────────────────────────────

export interface SkillPromoteProvided {
  name?: string;
  author?: string;
  date?: string;
}

export interface SkillPromotePromptContext {
  personalSkillNames?: string[];
  defaultAuthor: string;
  today: string;
}

export type SkillPromotePromptResult = SkillPromoteProvided;

export const planSkillPromotePrompts = (
  provided: SkillPromoteProvided,
  ctx: SkillPromotePromptContext,
): PromptStep[] => {
  const nameStep: PromptStep =
    ctx.personalSkillNames && ctx.personalSkillNames.length > 0
      ? {
          key: "name",
          kind: "select",
          message: SKILL_PROMOTE_FIELD_DESC.name,
          options: ctx.personalSkillNames.map((n) => ({ value: n, label: n })),
        }
      : { key: "name", kind: "text", message: SKILL_PROMOTE_FIELD_DESC.name };

  return selectSteps([
    { required: true, missing: provided.name === undefined, step: nameStep },
    {
      required: true,
      missing: provided.author === undefined,
      step: {
        key: "author",
        kind: "text",
        message: SKILL_PROMOTE_FIELD_DESC.author,
        initialValue: ctx.defaultAuthor || undefined,
      },
    },
    {
      required: false,
      missing: provided.date === undefined,
      step: {
        key: "date",
        kind: "text",
        message: SKILL_PROMOTE_FIELD_DESC.date,
        initialValue: ctx.today,
        validate: validateDate,
      },
    },
  ]);
};

export const buildSkillPromoteOptions = (
  provided: SkillPromoteProvided,
  answers: PromptAnswers,
): SkillPromotePromptResult => ({
  name: pick("name", provided.name, answers),
  author: pick("author", provided.author, answers),
  date: pick("date", provided.date, answers),
});

// ─── async context resolvers (I/O, but no TTY / no clack) ───────────────────

/** Best-effort local git identity, used only to pre-fill a prompt default. */
export const resolveDefaultAuthor = async (
  cwd: string,
  runGit: (args: string[]) => Promise<ExecResult> = (args) =>
    exec("git", args, { cwd }),
): Promise<string> => {
  const result = await runGit(["config", "user.name"]);
  return result.ok ? result.stdout.trim() : "";
};

/** The session-scope union for the project bound at `cwd`, or undefined when unbound/invalid. */
export const resolveKnownScopes = async (
  cwd: string,
): Promise<string[] | undefined> => {
  const configResult = await loadConfig(cwd);
  return configResult.ok
    ? sessionScopes({
        project: configResult.config.project,
        squads: configResult.config.squads,
        workspaces: configResult.config.workspaces,
      })
    : undefined;
};

/** Personal skill directory names under `skillsRoot` that carry a SKILL.md. */
export const listPersonalSkillNames = async (
  skillsRoot: string,
): Promise<string[]> => {
  const entries = await readdir(skillsRoot, { withFileTypes: true }).catch(
    () => [],
  );
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  const withSkillMd = await Promise.all(
    dirs.map(async (name) => ({
      name,
      hasSkillMd: await exists(path.join(skillsRoot, name, "SKILL.md")),
    })),
  );
  return withSkillMd
    .filter((d) => d.hasSkillMd)
    .map((d) => d.name)
    .sort();
};
