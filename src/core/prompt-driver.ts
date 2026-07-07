import type { PromptStep, SelectChoice } from "./prompts.js";

// ─── Driver interface — clack sits behind this so tests can script answers
// without a real TTY or the real @clack/prompts renderer. Option shapes are
// derived straight from PromptStep so there is exactly one place that
// describes what a text/select/confirm step looks like. ─────────────────────

export type TextPromptOptions = Omit<
  Extract<PromptStep, { kind: "text" }>,
  "key" | "kind"
>;
export type SelectPromptOptions = Omit<
  Extract<PromptStep, { kind: "select" }>,
  "key" | "kind"
>;
export type ConfirmPromptOptions = Omit<
  Extract<PromptStep, { kind: "confirm" }>,
  "key" | "kind"
>;

export interface PromptDriver {
  text: (opts: TextPromptOptions) => Promise<string | symbol>;
  select: (opts: SelectPromptOptions) => Promise<string | symbol>;
  confirm: (opts: ConfirmPromptOptions) => Promise<boolean | symbol>;
  isCancel: (value: unknown) => value is symbol;
}

/**
 * Real, clack-backed driver. `@clack/prompts` is imported lazily here — never
 * at module top-level — so commands that never take the interactive branch
 * (digest, sync, status, lint) never pay for parsing it. Maps explicitly to
 * clack's own arg shape rather than forwarding opts wholesale, since clack
 * has no notion of our `other` escape hatch.
 */
export const createClackDriver = async (): Promise<PromptDriver> => {
  const clack = await import("@clack/prompts");
  return {
    text: (opts) =>
      clack.text({
        message: opts.message,
        initialValue: opts.initialValue,
        placeholder: opts.placeholder,
        validate: opts.validate
          ? (value) => opts.validate?.(value ?? "")
          : undefined,
      }),
    select: (opts) =>
      clack.select({
        message: opts.message,
        options: opts.options,
        initialValue: opts.initialValue,
      }),
    confirm: (opts) =>
      clack.confirm({
        message: opts.message,
        initialValue: opts.initialValue,
      }),
    isCancel: (value) => clack.isCancel(value),
  };
};

/** Both stdin AND stdout must be TTYs for a session to be interactive. */
export const isInteractiveTty = (
  stdin: { isTTY?: boolean } = process.stdin,
  stdout: { isTTY?: boolean } = process.stdout,
): boolean => Boolean(stdin.isTTY) && Boolean(stdout.isTTY);

/** Sentinel select value for "not one of the listed options" — never a real
 * answer; runPromptSteps swaps it for a validated free-text follow-up before
 * it ever reaches a caller. */
const OTHER_VALUE = "__other__";

const selectOptions = (
  step: Extract<PromptStep, { kind: "select" }>,
): SelectChoice[] =>
  step.other
    ? [...step.options, { value: OTHER_VALUE, label: step.other.label }]
    : step.options;

const askStep = (
  step: PromptStep,
  driver: PromptDriver,
): Promise<string | boolean | symbol> => {
  switch (step.kind) {
    case "text":
      return driver.text(step);
    case "select":
      return driver.select({ ...step, options: selectOptions(step) });
    case "confirm":
      return driver.confirm(step);
  }
};

export type StepsResult =
  | { cancelled: true }
  | { cancelled: false; answers: Record<string, string | boolean> };

/**
 * Runs each step in order against the driver, stopping the instant one is
 * cancelled. A "select" step declaring `other` that resolves to the escape
 * hatch immediately asks a validated free-text follow-up under the same key.
 */
export const runPromptSteps = async (
  steps: PromptStep[],
  driver: PromptDriver,
): Promise<StepsResult> => {
  const answers: Record<string, string | boolean> = {};

  for (const step of steps) {
    const answer = await askStep(step, driver);
    if (driver.isCancel(answer)) return { cancelled: true };

    if (step.kind === "select" && step.other && answer === OTHER_VALUE) {
      const custom = await driver.text({
        message: step.message,
        validate: step.other.validate,
      });
      if (driver.isCancel(custom)) return { cancelled: true };
      answers[step.key] = custom;
      continue;
    }

    answers[step.key] = answer;
  }

  return { cancelled: false, answers };
};
