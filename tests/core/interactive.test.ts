import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  PromoteOptions,
  PromoteResult,
} from "../../src/commands/promote.js";
import { saveConfig } from "../../src/core/config.js";
import {
  resolveInitPrompts,
  resolvePromotePrompts,
  resolveSkillAddPrompts,
  resolveSkillPromotePrompts,
  submitPromote,
} from "../../src/core/interactive.js";
import type { PromptDriver } from "../../src/core/prompt-driver.js";
import { tmpDirFactory } from "../helpers/tmp.js";

const CANCEL = Symbol("cancel");
/** Scripted "pick the select's other… option" — resolved dynamically from
 * whatever the real driver.select() call was given, so tests never need to
 * know prompt-driver.ts's private sentinel value. */
const PICK_OTHER = Symbol("pick-other");

interface Recorder {
  driver: PromptDriver;
  confirmMessages: string[];
}

/** Scripted driver: text/select answers pulled in call order; confirm() from a separate queue. */
const fakeDriver = (
  textSelectAnswers: (string | symbol)[],
  confirmAnswers: (boolean | symbol)[] = [true],
): Recorder => {
  const textSelectQueue = [...textSelectAnswers];
  const confirmQueue = [...confirmAnswers];
  const confirmMessages: string[] = [];

  // Mirrors a real prompt's re-ask-on-error loop: an answer that fails
  // `validate` is discarded (never returned) and the next queued answer is
  // tried instead, so tests can script "invalid, then valid" like a human
  // correcting a typo.
  const nextValidText = (
    validate?: (v: string) => string | undefined,
  ): string | symbol => {
    const v = textSelectQueue.shift();
    if (v === undefined) throw new Error("no scripted text/select answer");
    if (typeof v !== "string") return v;
    return validate?.(v) ? nextValidText(validate) : v;
  };

  return {
    confirmMessages,
    driver: {
      text: async (opts) => nextValidText(opts.validate),
      select: async (opts) => {
        const v = textSelectQueue.shift();
        if (v === undefined) throw new Error("no scripted text/select answer");
        if (v === PICK_OTHER) {
          const other = opts.options.at(-1);
          if (!other) throw new Error("step has no 'other' option to pick");
          return other.value;
        }
        return v as string | symbol;
      },
      confirm: async (opts) => {
        confirmMessages.push(opts.message);
        const v = confirmQueue.shift();
        if (v === undefined) throw new Error("no scripted confirm answer");
        return v;
      },
      isCancel: (value): value is symbol => value === CANCEL,
    },
  };
};

/** A driver that throws if touched at all — proves "flags-only" never prompts. */
const untouchableDriver: PromptDriver = {
  text: async () => {
    throw new Error("text() must not be called");
  },
  select: async () => {
    throw new Error("select() must not be called");
  },
  confirm: async () => {
    throw new Error("confirm() must not be called");
  },
  isCancel: (_value: unknown): _value is symbol => false,
};

describe("resolveInitPrompts", () => {
  const tmp = tmpDirFactory("rm-interactive-init-");
  afterEach(tmp.cleanup);

  it("bare invocation + bind selected: mode select first, then project/commonsUrl/squads", async () => {
    const dir = await tmp.make();
    const { driver } = fakeDriver([
      "bind",
      "loggle",
      "git@x:y/z.git",
      "web,mobile",
    ]);
    const result = await resolveInitPrompts({}, driver, dir);
    expect(result).toEqual({
      cancelled: false,
      options: {
        project: "loggle",
        commonsUrl: "git@x:y/z.git",
        squads: ["web", "mobile"],
      },
    });
  });

  it("bare invocation + scaffold selected in an unbound dir: no guard confirm, scaffolds immediately", async () => {
    const dir = await tmp.make();
    const { driver, confirmMessages } = fakeDriver(["scaffold"]);
    const result = await resolveInitPrompts({}, driver, dir);
    expect(result).toEqual({
      cancelled: false,
      options: { scaffoldCommons: true },
    });
    expect(confirmMessages).toEqual([]);
  });

  it("bare invocation + scaffold selected in an ALREADY-BOUND dir: guard confirm, decline → cancelled, nothing written", async () => {
    const dir = await tmp.make();
    await saveConfig(dir, {
      configVersion: 1,
      commons: "git@x:y/z.git",
      overlays: [],
      project: "loggle",
      squads: [],
      workspaces: {},
    });
    const { driver, confirmMessages } = fakeDriver(["scaffold"], [false]);
    const result = await resolveInitPrompts({}, driver, dir);
    expect(result).toEqual({ cancelled: true });
    expect(confirmMessages).toEqual([
      "This directory is a bound project repo — scaffold a Commons here anyway?",
    ]);
  });

  it("bare invocation + scaffold selected in an ALREADY-BOUND dir: guard confirm accepted → scaffolds", async () => {
    const dir = await tmp.make();
    await saveConfig(dir, {
      configVersion: 1,
      commons: "git@x:y/z.git",
      overlays: [],
      project: "loggle",
      squads: [],
      workspaces: {},
    });
    const { driver } = fakeDriver(["scaffold"], [true]);
    const result = await resolveInitPrompts({}, driver, dir);
    expect(result).toEqual({
      cancelled: false,
      options: { scaffoldCommons: true },
    });
  });

  it("cancelling the mode select → cancelled:true, nothing prompted after it", async () => {
    const dir = await tmp.make();
    const { driver } = fakeDriver([CANCEL]);
    const result = await resolveInitPrompts({}, driver, dir);
    expect(result).toEqual({ cancelled: true });
  });

  it("--commons flag wins outright: never touches the driver, not even the mode select", async () => {
    const dir = await tmp.make();
    const result = await resolveInitPrompts(
      { scaffoldCommons: true },
      untouchableDriver,
      dir,
    );
    expect(result).toEqual({
      cancelled: false,
      options: { scaffoldCommons: true },
    });
  });

  it("bind implied by a single bind flag: no mode select, prompts only the missing bind fields", async () => {
    const dir = await tmp.make();
    const { driver } = fakeDriver(["loggle", "git@x:y/z.git"]);
    const result = await resolveInitPrompts({ squads: "web" }, driver, dir);
    expect(result).toEqual({
      cancelled: false,
      options: {
        project: "loggle",
        commonsUrl: "git@x:y/z.git",
        squads: ["web"],
      },
    });
  });

  it("derives the project-name default from the basename of `dir` when unbound", async () => {
    const seen: { initialValue?: string }[] = [];
    const driver: PromptDriver = {
      text: async (opts) => {
        seen.push(opts);
        return "accepted";
      },
      select: async () => "bind",
      confirm: async () => true,
      isCancel: (_value: unknown): _value is symbol => false,
    };
    await resolveInitPrompts({}, driver, "/some/path/my-project");
    expect(seen[0]?.initialValue).toBe("my-project");
  });

  it("rebind: prefills project/commonsUrl/squads from the existing binding, not the basename", async () => {
    const dir = await tmp.make();
    await saveConfig(dir, {
      configVersion: 1,
      commons: "git@x:y/old.git",
      overlays: [],
      project: "existing-project",
      squads: ["web", "mobile"],
      workspaces: {},
    });
    const seen: { initialValue?: string }[] = [];
    const driver: PromptDriver = {
      text: async (opts) => {
        seen.push(opts);
        return opts.initialValue ?? "";
      },
      select: async () => "bind",
      confirm: async () => true,
      isCancel: (_value: unknown): _value is symbol => false,
    };
    const result = await resolveInitPrompts({}, driver, dir);
    expect(seen.map((o) => o.initialValue)).toEqual([
      "existing-project",
      "git@x:y/old.git",
      "web, mobile",
    ]);
    expect(result).toEqual({
      cancelled: false,
      options: {
        project: "existing-project",
        commonsUrl: "git@x:y/old.git",
        squads: ["web", "mobile"],
      },
    });
  });

  it("commonsUrl rejects a non-url before accepting a valid one", async () => {
    const dir = await tmp.make();
    const { driver } = fakeDriver([
      "bind",
      "loggle",
      "asdasd",
      "https://github.com/org/team-memory.git",
      "",
    ]);
    const result = await resolveInitPrompts({}, driver, dir);
    expect(result.cancelled).toBe(false);
    if (!result.cancelled) {
      expect(result.options.commonsUrl).toBe(
        "https://github.com/org/team-memory.git",
      );
    }
  });

  it('squads rejects "Web" before accepting a valid, explicitly-lowercased answer', async () => {
    const dir = await tmp.make();
    const { driver } = fakeDriver([
      "bind",
      "loggle",
      "git@x:y/z.git",
      "Web",
      "web",
    ]);
    const result = await resolveInitPrompts({}, driver, dir);
    expect(result.cancelled).toBe(false);
    if (!result.cancelled) expect(result.options.squads).toEqual(["web"]);
  });

  it("flags-only: never touches the driver, still splits squads into an array", async () => {
    const provided = {
      project: "p",
      commonsUrl: "u",
      squads: "web",
    };
    const dir = await tmp.make();
    const result = await resolveInitPrompts(provided, untouchableDriver, dir);
    expect(result).toEqual({
      cancelled: false,
      options: { ...provided, squads: ["web"] },
    });
  });

  it("cancel mid-bind-flow (after the mode select) → cancelled:true", async () => {
    const dir = await tmp.make();
    const { driver } = fakeDriver(["bind", "loggle", CANCEL]);
    const result = await resolveInitPrompts({}, driver, dir);
    expect(result).toEqual({ cancelled: true });
  });

  it("bare invocation + bind-libraries selected: asks only the commons URL, no project/squads", async () => {
    const dir = await tmp.make();
    const { driver } = fakeDriver([
      "bind-libraries",
      "https://github.com/org/commons.git",
    ]);
    const result = await resolveInitPrompts({}, driver, dir);
    expect(result).toEqual({
      cancelled: false,
      options: { commonsUrl: "https://github.com/org/commons.git" },
    });
  });

  it("bind-libraries commonsUrl rejects a non-url before accepting a valid one", async () => {
    const dir = await tmp.make();
    const { driver } = fakeDriver([
      "bind-libraries",
      "asdasd",
      "git@host:org/commons.git",
    ]);
    const result = await resolveInitPrompts({}, driver, dir);
    expect(result).toEqual({
      cancelled: false,
      options: { commonsUrl: "git@host:org/commons.git" },
    });
  });

  it("cancelling the bind-libraries commonsUrl prompt → cancelled:true", async () => {
    const dir = await tmp.make();
    const { driver } = fakeDriver(["bind-libraries", CANCEL]);
    const result = await resolveInitPrompts({}, driver, dir);
    expect(result).toEqual({ cancelled: true });
  });
});

describe("resolvePromotePrompts", () => {
  const tmp = tmpDirFactory("rm-interactive-promote-");
  afterEach(tmp.cleanup);

  it("guided flow collects answers, shows a summary confirm, then returns merged options", async () => {
    const cwd = await tmp.make(); // no config → knownScopes undefined, scope stays text
    const { driver, confirmMessages } = fakeDriver(
      [
        "org",
        "standard",
        "new-thing",
        "does a thing",
        "hrithik",
        "2026-07-06",
        __filename,
      ],
      [true],
    );
    const result = await resolvePromotePrompts({}, driver, cwd);
    expect(result).toEqual({
      cancelled: false,
      guided: true,
      driver,
      options: {
        scope: "org",
        type: "standard",
        name: "new-thing",
        description: "does a thing",
        author: "hrithik",
        date: "2026-07-06",
        bodyFile: __filename,
      },
    });
    expect(confirmMessages).toHaveLength(1);
    expect(confirmMessages[0]).toContain("Proceed?");
    expect(confirmMessages[0]).toContain("scope: org");
  });

  it("declining the final confirm cancels with zero side effects reported", async () => {
    const cwd = await tmp.make();
    const { driver } = fakeDriver(
      [
        "org",
        "standard",
        "new-thing",
        "d",
        "hrithik",
        "2026-07-06",
        __filename,
      ],
      [false],
    );
    const result = await resolvePromotePrompts({}, driver, cwd);
    expect(result).toEqual({ cancelled: true });
  });

  it("cancel mid-flow short-circuits before the confirm is ever shown", async () => {
    const cwd = await tmp.make();
    const { driver, confirmMessages } = fakeDriver(["org", CANCEL]);
    const result = await resolvePromotePrompts({}, driver, cwd);
    expect(result).toEqual({ cancelled: true });
    expect(confirmMessages).toEqual([]);
  });

  it("flags-only: never touches the driver (no prompts, no confirm)", async () => {
    const cwd = await tmp.make();
    const provided = {
      scope: "org",
      type: "standard",
      name: "n",
      description: "d",
      author: "a",
      bodyFile: __filename,
    };
    const result = await resolvePromotePrompts(
      provided,
      untouchableDriver,
      cwd,
    );
    expect(result).toEqual({
      cancelled: false,
      guided: false,
      options: provided,
    });
  });

  it("partial: only author missing → never fetches knownScopes (untouchableDriver would still throw if scope were prompted)", async () => {
    const cwd = await tmp.make(); // unbound — resolveKnownScopes would return undefined anyway,
    // but the point is author-only-missing must not even ask about scope.
    const provided = {
      scope: "org",
      type: "standard",
      name: "n",
      description: "d",
      bodyFile: __filename,
    };
    const { driver } = fakeDriver(["hrithik"], [true]);
    const result = await resolvePromotePrompts(provided, driver, cwd);
    expect(result.cancelled).toBe(false);
    if (!result.cancelled) expect(result.options.author).toBe("hrithik");
  });

  it("offers a select of known scopes when the project is bound", async () => {
    const cwd = await tmp.make();
    await saveConfig(cwd, {
      configVersion: 1,
      commons: "git@x:y/z.git",
      overlays: [],
      project: "loggle",
      squads: [],
      workspaces: {},
    });
    const { driver } = fakeDriver(
      ["project/loggle", "lesson", "n", "d", "a", "2026-07-06", __filename],
      [true],
    );
    const result = await resolvePromotePrompts({}, driver, cwd);
    expect(result.cancelled).toBe(false);
    if (!result.cancelled) {
      expect(result.options.scope).toBe("project/loggle");
      expect(result.guided).toBe(true);
    }
  });

  it('scope "other…" falls through to a free-text follow-up, asked immediately after the select', async () => {
    const cwd = await tmp.make();
    await saveConfig(cwd, {
      configVersion: 1,
      commons: "git@x:y/z.git",
      overlays: [],
      project: "loggle",
      squads: [],
      workspaces: {},
    });
    const { driver } = fakeDriver(
      [
        PICK_OTHER,
        "project/custom",
        "lesson",
        "n",
        "d",
        "a",
        "2026-07-06",
        __filename,
      ],
      [true],
    );
    const result = await resolvePromotePrompts({}, driver, cwd);
    expect(result.cancelled).toBe(false);
    if (!result.cancelled) {
      expect(result.options.scope).toBe("project/custom");
    }
  });

  it('cancelling the "other…" follow-up prompt cancels the whole flow', async () => {
    const cwd = await tmp.make();
    await saveConfig(cwd, {
      configVersion: 1,
      commons: "git@x:y/z.git",
      overlays: [],
      project: "loggle",
      squads: [],
      workspaces: {},
    });
    const { driver, confirmMessages } = fakeDriver([PICK_OTHER, CANCEL]);
    const result = await resolvePromotePrompts({}, driver, cwd);
    expect(result).toEqual({ cancelled: true });
    // never even reached the summary confirm
    expect(confirmMessages).toEqual([]);
  });

  it("scope text fallback rejects an invalid scope before accepting a valid one", async () => {
    const cwd = await tmp.make(); // no config → knownScopes undefined, scope stays text
    const { driver } = fakeDriver(
      [
        "not a valid scope!",
        "org",
        "standard",
        "n",
        "d",
        "a",
        "2026-07-06",
        __filename,
      ],
      [true],
    );
    const result = await resolvePromotePrompts({}, driver, cwd);
    expect(result.cancelled).toBe(false);
    if (!result.cancelled) expect(result.options.scope).toBe("org");
  });

  it('scope "other…" follow-up rejects an invalid custom scope before accepting a valid one', async () => {
    const cwd = await tmp.make();
    await saveConfig(cwd, {
      configVersion: 1,
      commons: "git@x:y/z.git",
      overlays: [],
      project: "loggle",
      squads: [],
      workspaces: {},
    });
    const { driver } = fakeDriver(
      [
        PICK_OTHER,
        "not valid!",
        "project/custom",
        "lesson",
        "n",
        "d",
        "a",
        "2026-07-06",
        __filename,
      ],
      [true],
    );
    const result = await resolvePromotePrompts({}, driver, cwd);
    expect(result.cancelled).toBe(false);
    if (!result.cancelled) {
      expect(result.options.scope).toBe("project/custom");
    }
  });

  it("date rejects a malformed value before accepting a valid one", async () => {
    const cwd = await tmp.make();
    const { driver } = fakeDriver(
      [
        "org",
        "standard",
        "n",
        "d",
        "a",
        "07/06/2026",
        "2026-07-06",
        __filename,
      ],
      [true],
    );
    const result = await resolvePromotePrompts({}, driver, cwd);
    expect(result.cancelled).toBe(false);
    if (!result.cancelled) expect(result.options.date).toBe("2026-07-06");
  });

  it("date rejects a calendar-invalid value (2026-02-30) before accepting a valid one", async () => {
    const cwd = await tmp.make();
    const { driver } = fakeDriver(
      [
        "org",
        "standard",
        "n",
        "d",
        "a",
        "2026-02-30",
        "2026-07-06",
        __filename,
      ],
      [true],
    );
    const result = await resolvePromotePrompts({}, driver, cwd);
    expect(result.cancelled).toBe(false);
    if (!result.cancelled) expect(result.options.date).toBe("2026-07-06");
  });
});

describe("submitPromote", () => {
  const input: PromoteOptions = {
    cwd: "/tmp/rm-submit-promote",
    scope: "org",
    type: "standard",
    name: "n",
    description: "d",
    body: "b",
    author: "a",
    date: "2026-07-06",
  };
  const collisionResult: PromoteResult = {
    exitCode: 1,
    output:
      "Entry already exists at entries/org/n.md. Edit it directly instead of promoting a new one.",
    reason: "collision",
  };

  it("passes a successful result straight through, never showing a confirm", async () => {
    const calls: PromoteOptions[] = [];
    const runPromoteFn = async (
      opts: PromoteOptions,
    ): Promise<PromoteResult> => {
      calls.push(opts);
      return { exitCode: 0, output: "ok" };
    };
    const result = await submitPromote(input, untouchableDriver, runPromoteFn);
    expect(result).toEqual({
      cancelled: false,
      result: { exitCode: 0, output: "ok" },
    });
    expect(calls).toHaveLength(1);
  });

  it("passes a non-collision failure straight through, never showing a confirm", async () => {
    const runPromoteFn = async (): Promise<PromoteResult> => ({
      exitCode: 1,
      output: "author must not be empty.",
    });
    const result = await submitPromote(input, untouchableDriver, runPromoteFn);
    expect(result).toEqual({
      cancelled: false,
      result: { exitCode: 1, output: "author must not be empty." },
    });
  });

  it("collision + decline the confirm → cancelled, never retries", async () => {
    const calls: PromoteOptions[] = [];
    const runPromoteFn = async (
      opts: PromoteOptions,
    ): Promise<PromoteResult> => {
      calls.push(opts);
      return collisionResult;
    };
    const { driver, confirmMessages } = fakeDriver([], [false]);
    const result = await submitPromote(input, driver, runPromoteFn);
    expect(result).toEqual({ cancelled: true });
    expect(calls).toHaveLength(1);
    expect(confirmMessages).toEqual([
      "org/n already exists — propose overwriting it?",
    ]);
  });

  it("collision + Ctrl-C on the confirm behaves the same as declining", async () => {
    const runPromoteFn = async (): Promise<PromoteResult> => collisionResult;
    const { driver } = fakeDriver([], [CANCEL]);
    const result = await submitPromote(input, driver, runPromoteFn);
    expect(result).toEqual({ cancelled: true });
  });

  it("collision + accept the confirm → retries once with force+overwrite, returns the retry result", async () => {
    const calls: PromoteOptions[] = [];
    const runPromoteFn = async (
      opts: PromoteOptions,
    ): Promise<PromoteResult> => {
      calls.push(opts);
      return calls.length === 1
        ? collisionResult
        : { exitCode: 0, output: "overwritten" };
    };
    const { driver } = fakeDriver([], [true]);
    const result = await submitPromote(input, driver, runPromoteFn);
    expect(result).toEqual({
      cancelled: false,
      result: { exitCode: 0, output: "overwritten" },
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({ ...input, force: true, overwrite: true });
  });
});

describe("resolveSkillAddPrompts", () => {
  const tmp = tmpDirFactory("rm-interactive-skilladd-");
  afterEach(tmp.cleanup);

  it("guided flow collects source/skill/ref/author and shows a summary confirm", async () => {
    const cwd = await tmp.make();
    const { driver, confirmMessages } = fakeDriver([
      "obra/skills",
      "grill-me",
      "",
      "hrithik",
    ]);
    const result = await resolveSkillAddPrompts({}, driver, cwd);
    expect(result).toEqual({
      cancelled: false,
      options: {
        source: "obra/skills",
        skill: "grill-me",
        ref: undefined,
        author: "hrithik",
      },
    });
    expect(confirmMessages).toHaveLength(1);
  });

  it("declining the confirm cancels", async () => {
    const cwd = await tmp.make();
    const { driver } = fakeDriver(
      ["obra/skills", "grill-me", "", "hrithik"],
      [false],
    );
    const result = await resolveSkillAddPrompts({}, driver, cwd);
    expect(result).toEqual({ cancelled: true });
  });

  it("flags-only: never touches the driver", async () => {
    const cwd = await tmp.make();
    const provided = {
      source: "obra/skills",
      skill: undefined,
      ref: undefined,
      author: "hrithik",
    };
    const result = await resolveSkillAddPrompts(
      provided,
      untouchableDriver,
      cwd,
    );
    expect(result).toEqual({ cancelled: false, options: provided });
  });

  it("cancel returns cancelled:true", async () => {
    const cwd = await tmp.make();
    const { driver } = fakeDriver([CANCEL]);
    const result = await resolveSkillAddPrompts({}, driver, cwd);
    expect(result).toEqual({ cancelled: true });
  });

  it("partial: only author missing → prompts just author, so a guided flow can now complete flagless", async () => {
    const cwd = await tmp.make();
    const provided = { source: "obra/skills", skill: "grill-me", ref: "main" };
    const { driver, confirmMessages } = fakeDriver(["hrithik"], [true]);
    const result = await resolveSkillAddPrompts(provided, driver, cwd);
    expect(result).toEqual({
      cancelled: false,
      options: { ...provided, author: "hrithik" },
    });
    expect(confirmMessages).toHaveLength(1);
  });
});

describe("resolveSkillPromotePrompts", () => {
  const tmp = tmpDirFactory("rm-interactive-skillpromote-");
  afterEach(tmp.cleanup);

  it("guided flow: select from listed personal skills, then confirm", async () => {
    const skillsRoot = await tmp.make();
    const cwd = await tmp.make();
    await fs.mkdir(path.join(skillsRoot, "grill-me"), { recursive: true });
    await fs.writeFile(
      path.join(skillsRoot, "grill-me", "SKILL.md"),
      "---\nname: grill-me\ndescription: x\n---\nbody",
      "utf8",
    );

    const { driver, confirmMessages } = fakeDriver(
      ["grill-me", "hrithik", "2026-07-06"],
      [true],
    );
    const result = await resolveSkillPromotePrompts(
      {},
      driver,
      skillsRoot,
      cwd,
    );
    expect(result).toEqual({
      cancelled: false,
      options: { name: "grill-me", author: "hrithik", date: "2026-07-06" },
    });
    expect(confirmMessages).toHaveLength(1);
  });

  it("declining the confirm cancels", async () => {
    const skillsRoot = await tmp.make();
    const cwd = await tmp.make();
    const { driver } = fakeDriver(
      ["grill-me", "hrithik", "2026-07-06"],
      [false],
    );
    const result = await resolveSkillPromotePrompts(
      {},
      driver,
      skillsRoot,
      cwd,
    );
    expect(result).toEqual({ cancelled: true });
  });

  it("flags-only: never touches the driver", async () => {
    const skillsRoot = await tmp.make();
    const cwd = await tmp.make();
    const provided = {
      name: "grill-me",
      author: "hrithik",
      date: "2026-07-06",
    };
    const result = await resolveSkillPromotePrompts(
      provided,
      untouchableDriver,
      skillsRoot,
      cwd,
    );
    expect(result).toEqual({ cancelled: false, options: provided });
  });

  it("partial: only date missing → never touches the driver (name+author already satisfy the guard)", async () => {
    const skillsRoot = await tmp.make();
    const cwd = await tmp.make();
    const provided = { name: "grill-me", author: "hrithik" };
    const result = await resolveSkillPromotePrompts(
      provided,
      untouchableDriver,
      skillsRoot,
      cwd,
    );
    expect(result).toEqual({ cancelled: false, options: provided });
  });

  it("date rejects a malformed value before accepting a valid one", async () => {
    const skillsRoot = await tmp.make();
    const cwd = await tmp.make();
    const { driver } = fakeDriver(
      ["grill-me", "hrithik", "not-a-date", "2026-07-06"],
      [true],
    );
    const result = await resolveSkillPromotePrompts(
      {},
      driver,
      skillsRoot,
      cwd,
    );
    expect(result.cancelled).toBe(false);
    if (!result.cancelled) expect(result.options.date).toBe("2026-07-06");
  });

  it("date rejects a calendar-invalid value (2026-13-99) before accepting a valid one", async () => {
    const skillsRoot = await tmp.make();
    const cwd = await tmp.make();
    const { driver } = fakeDriver(
      ["grill-me", "hrithik", "2026-13-99", "2026-07-06"],
      [true],
    );
    const result = await resolveSkillPromotePrompts(
      {},
      driver,
      skillsRoot,
      cwd,
    );
    expect(result.cancelled).toBe(false);
    if (!result.cancelled) expect(result.options.date).toBe("2026-07-06");
  });
});
