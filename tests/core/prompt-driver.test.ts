import { describe, expect, it } from "vitest";
import {
  createClackDriver,
  isInteractiveTty,
  type PromptDriver,
  runPromptSteps,
} from "../../src/core/prompt-driver.js";
import type { PromptStep } from "../../src/core/prompts.js";

const CANCEL = Symbol("cancel");

/** Scripted driver: returns queued answers in call order; never touches a real TTY. */
const fakeDriver = (
  answers: (string | boolean | symbol)[],
): { driver: PromptDriver; calls: string[] } => {
  const queue = [...answers];
  const calls: string[] = [];
  const next = (kind: string): string | boolean | symbol => {
    calls.push(kind);
    const value = queue.shift();
    if (value === undefined) {
      throw new Error(`fakeDriver: no scripted answer left for ${kind}`);
    }
    return value;
  };
  return {
    calls,
    driver: {
      text: async () => next("text") as string | symbol,
      select: async () => next("select") as string | symbol,
      confirm: async () => next("confirm") as boolean | symbol,
      isCancel: (value): value is symbol => value === CANCEL,
    },
  };
};

describe("isInteractiveTty", () => {
  it("true only when both stdin and stdout are TTYs", () => {
    expect(isInteractiveTty({ isTTY: true }, { isTTY: true })).toBe(true);
  });

  it("false when stdin is not a TTY", () => {
    expect(isInteractiveTty({ isTTY: false }, { isTTY: true })).toBe(false);
  });

  it("false when stdout is not a TTY", () => {
    expect(isInteractiveTty({ isTTY: true }, { isTTY: false })).toBe(false);
  });

  it("false when isTTY is undefined on both (piped process)", () => {
    expect(isInteractiveTty({}, {})).toBe(false);
  });
});

describe("runPromptSteps", () => {
  const steps: PromptStep[] = [
    { key: "name", kind: "text", message: "Name?" },
    {
      key: "type",
      kind: "select",
      message: "Type?",
      options: [{ value: "standard", label: "standard" }],
    },
    { key: "force", kind: "confirm", message: "Force?", initialValue: false },
  ];

  it("collects answers keyed by step, in order", async () => {
    const { driver } = fakeDriver(["new-thing", "standard", true]);
    const result = await runPromptSteps(steps, driver);
    expect(result).toEqual({
      cancelled: false,
      answers: { name: "new-thing", type: "standard", force: true },
    });
  });

  it("stops at the first cancelled step and asks nothing after it", async () => {
    const { driver, calls } = fakeDriver(["new-thing", CANCEL]);
    const result = await runPromptSteps(steps, driver);
    expect(result).toEqual({ cancelled: true });
    // only "text" and "select" were asked — "confirm" never ran
    expect(calls).toEqual(["text", "select"]);
  });

  it("returns cancelled immediately when the very first step is cancelled", async () => {
    const { driver, calls } = fakeDriver([CANCEL]);
    const result = await runPromptSteps(steps, driver);
    expect(result).toEqual({ cancelled: true });
    expect(calls).toEqual(["text"]);
  });

  it("returns empty answers for an empty step list without touching the driver", async () => {
    const { driver, calls } = fakeDriver([]);
    const result = await runPromptSteps([], driver);
    expect(result).toEqual({ cancelled: false, answers: {} });
    expect(calls).toEqual([]);
  });
});

describe("createClackDriver", () => {
  it("lazily resolves a driver exposing text/select/confirm/isCancel without prompting", async () => {
    const driver = await createClackDriver();
    expect(typeof driver.text).toBe("function");
    expect(typeof driver.select).toBe("function");
    expect(typeof driver.confirm).toBe("function");
    expect(typeof driver.isCancel).toBe("function");
    // isCancel is safe to call with any plain value with no rendering side effects
    expect(driver.isCancel("not-a-cancel-symbol")).toBe(false);
  });
});
