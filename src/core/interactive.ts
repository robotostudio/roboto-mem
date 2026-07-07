import * as path from "node:path";
import type { PromoteOptions, PromoteResult } from "../commands/promote.js";
import { runPromote } from "../commands/promote.js";
import { loadConfig } from "./config.js";
import { todayYMD } from "./entry.js";
import type { PromptDriver } from "./prompt-driver.js";
import { runPromptSteps } from "./prompt-driver.js";
import {
  buildInitOptions,
  buildPromoteOptions,
  buildSkillAddOptions,
  buildSkillPromoteOptions,
  type InitPromptResult,
  type InitProvided,
  listPersonalSkillNames,
  type PromotePromptResult,
  type PromoteProvided,
  planInitPrompts,
  planPromotePrompts,
  planSkillAddPrompts,
  planSkillPromotePrompts,
  resolveDefaultAuthor,
  resolveKnownScopes,
  type SkillAddPromptResult,
  type SkillAddProvided,
  type SkillPromotePromptResult,
  type SkillPromoteProvided,
} from "./prompts.js";

export type Resolved<T> =
  | { cancelled: true }
  | { cancelled: false; options: T };

/** Promote's guided flow additionally carries the driver used, so cli.ts can
 * hand it straight to submitPromote's collision-retry confirm without a
 * separately-held (and possibly unreachable) driver variable of its own. */
export type PromoteResolved =
  | { cancelled: true }
  | {
      cancelled: false;
      guided: true;
      options: PromotePromptResult;
      driver: PromptDriver;
    }
  | { cancelled: false; guided: false; options: PromotePromptResult };

/** Ends a guided flow with a recap of what's about to be submitted + a yes/no
 * gate. `answer === true` already excludes the cancel symbol, so there is
 * nothing further to check. */
const confirmSummary = async (
  driver: PromptDriver,
  options: object,
): Promise<boolean> => {
  const lines = Object.entries(options)
    .filter(([, v]) => v !== undefined && v !== false)
    .map(([k, v]) => `  ${k}: ${Array.isArray(v) ? v.join(", ") : v}`);
  const answer = await driver.confirm({
    message: ["About to submit:", ...lines, "", "Proceed?"].join("\n"),
    initialValue: true,
  });
  return answer === true;
};

/** Prompts for whatever bind fields are still missing, prefilling defaults
 * from an existing binding when `dir` is already bound (rebind becomes an
 * edit flow, not a blind overwrite) — never asks about scaffolding, since by
 * the time this runs the mode is already settled. */
const resolveBindPrompts = async (
  provided: InitProvided,
  driver: PromptDriver,
  dir: string,
): Promise<Resolved<InitPromptResult>> => {
  const configResult = await loadConfig(dir);
  const existing = configResult.ok ? configResult.config : undefined;

  const steps = planInitPrompts(provided, {
    defaultProjectName: existing?.project ?? path.basename(path.resolve(dir)),
    defaultCommonsUrl: existing?.commons,
    defaultSquads: existing?.squads.join(", "),
  });
  if (steps.length === 0) {
    return { cancelled: false, options: buildInitOptions(provided, {}) };
  }

  const collected = await runPromptSteps(steps, driver);
  if (collected.cancelled) return { cancelled: true };

  return {
    cancelled: false,
    options: buildInitOptions(provided, collected.answers),
  };
};

export const resolveInitPrompts = async (
  provided: InitProvided,
  driver: PromptDriver,
  dir: string,
): Promise<Resolved<InitPromptResult>> => {
  // `--commons` always wins outright: mirrors non-interactive `init --commons`
  // exactly, with zero prompts of any kind (not even the mode select) — a
  // flag is deliberate intent, unlike a guided answer that can flip modes.
  if (provided.scaffoldCommons === true) {
    return { cancelled: false, options: { scaffoldCommons: true } };
  }

  const bindImplied =
    provided.project !== undefined ||
    provided.commonsUrl !== undefined ||
    provided.squads !== undefined;
  if (bindImplied) {
    return resolveBindPrompts(provided, driver, dir);
  }

  // Bare invocation: which mode is intended is genuinely unknown, so ask
  // FIRST, before collecting any bind answers — this is the fix for the
  // exact accident where a guided scaffold-confirm asked last silently
  // discarded three already-collected bind answers.
  const mode = await driver.select({
    message: "How should this directory be set up?",
    options: [
      { value: "bind", label: "Bind this project to a Commons" },
      { value: "scaffold", label: "Scaffold a new Commons repo" },
    ],
    initialValue: "bind",
  });
  if (driver.isCancel(mode)) return { cancelled: true };

  if (mode === "scaffold") {
    const configResult = await loadConfig(dir);
    const alreadyBound = configResult.ok || configResult.reason !== "missing";
    if (alreadyBound) {
      const proceed = await driver.confirm({
        message:
          "This directory is a bound project repo — scaffold a Commons here anyway?",
        initialValue: false,
      });
      if (proceed !== true) return { cancelled: true };
    }
    return { cancelled: false, options: { scaffoldCommons: true } };
  }

  return resolveBindPrompts(provided, driver, dir);
};

export const resolvePromotePrompts = async (
  provided: PromoteProvided,
  driver: PromptDriver,
  cwd: string,
): Promise<PromoteResolved> => {
  // Purely from `provided` (no I/O): a required field always needs prompting
  // when missing, regardless of what else was given, so each field's own
  // emptiness already tells us whether its I/O-backed context is worth
  // fetching at all.
  const needsScope = provided.scope === undefined;
  const needsAuthor = provided.author === undefined;
  const needsAnything =
    needsScope ||
    provided.type === undefined ||
    provided.name === undefined ||
    provided.description === undefined ||
    needsAuthor ||
    provided.bodyFile === undefined;

  if (!needsAnything) {
    return { cancelled: false, guided: false, options: provided };
  }

  const [knownScopes, defaultAuthor] = await Promise.all([
    needsScope ? resolveKnownScopes(cwd) : undefined,
    needsAuthor ? resolveDefaultAuthor(cwd) : "",
  ]);

  const steps = planPromotePrompts(provided, {
    knownScopes,
    defaultAuthor,
    today: todayYMD(),
  });
  const collected = await runPromptSteps(steps, driver);
  if (collected.cancelled) return { cancelled: true };

  const options = buildPromoteOptions(provided, collected.answers);
  const proceed = await confirmSummary(driver, options);
  return proceed
    ? { cancelled: false, guided: true, options, driver }
    : { cancelled: true };
};

export type SubmitPromoteResult =
  | { cancelled: true }
  | { cancelled: false; result: PromoteResult };

/**
 * Runs the guided promote, and — only for a genuine scope/name collision —
 * offers a single overwrite-confirm retry. Never called for flags-only or
 * non-TTY invocations (cli.ts calls runPromote directly there instead), so
 * this is the only place `overwrite: true` is ever set.
 */
export const submitPromote = async (
  input: PromoteOptions,
  driver: PromptDriver,
  runPromoteFn: (opts: PromoteOptions) => Promise<PromoteResult> = runPromote,
): Promise<SubmitPromoteResult> => {
  const result = await runPromoteFn(input);
  if (result.reason !== "collision") return { cancelled: false, result };

  const proceed = await driver.confirm({
    message: `${input.scope}/${input.name} already exists — propose overwriting it?`,
    initialValue: false,
  });
  if (proceed !== true) return { cancelled: true };

  const retried = await runPromoteFn({
    ...input,
    force: true,
    overwrite: true,
  });
  return { cancelled: false, result: retried };
};

export const resolveSkillAddPrompts = async (
  provided: SkillAddProvided,
  driver: PromptDriver,
  cwd: string,
): Promise<Resolved<SkillAddPromptResult>> => {
  const needsAuthor = provided.author === undefined;
  const needsAnything = provided.source === undefined || needsAuthor;
  if (!needsAnything) return { cancelled: false, options: provided };

  const defaultAuthor = needsAuthor ? await resolveDefaultAuthor(cwd) : "";

  const steps = planSkillAddPrompts(provided, { defaultAuthor });
  const collected = await runPromptSteps(steps, driver);
  if (collected.cancelled) return { cancelled: true };

  const options = buildSkillAddOptions(provided, collected.answers);
  const proceed = await confirmSummary(driver, options);
  return proceed ? { cancelled: false, options } : { cancelled: true };
};

export const resolveSkillPromotePrompts = async (
  provided: SkillPromoteProvided,
  driver: PromptDriver,
  skillsRoot: string,
  cwd: string,
): Promise<Resolved<SkillPromotePromptResult>> => {
  const needsName = provided.name === undefined;
  const needsAuthor = provided.author === undefined;

  if (!needsName && !needsAuthor) {
    return { cancelled: false, options: provided };
  }

  const [personalSkillNames, defaultAuthor] = await Promise.all([
    needsName ? listPersonalSkillNames(skillsRoot) : undefined,
    needsAuthor ? resolveDefaultAuthor(cwd) : "",
  ]);

  const steps = planSkillPromotePrompts(provided, {
    personalSkillNames,
    defaultAuthor,
    today: todayYMD(),
  });
  const collected = await runPromptSteps(steps, driver);
  if (collected.cancelled) return { cancelled: true };

  const options = buildSkillPromoteOptions(provided, collected.answers);
  const proceed = await confirmSummary(driver, options);
  return proceed ? { cancelled: false, options } : { cancelled: true };
};
