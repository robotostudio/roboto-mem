import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildCliInto,
  normalizeCliOutput,
  rawRun,
} from "../helpers/cli-runner.js";
import { tmpDirFactory } from "../helpers/tmp.js";

// Interactive Mode must never change non-TTY behaviour (ADR 0008). rawRun
// spawns via execFile, whose default stdio is fully piped (never inherited
// from the parent), so its stdin/stdout are never TTYs — exactly the
// non-interactive case. These are real proof — through the actual cli.ts
// wiring, not our extracted resolver functions — that the non-interactive
// path is untouched.

const tmp = tmpDirFactory("rm-interactive-");

describe("interactive mode: non-TTY parity through the real cli.ts wiring", () => {
  const cliPath = { current: "" };

  beforeAll(async () => {
    const outDir = await tmp.make();
    cliPath.current = await buildCliInto(outDir);
  }, 60_000);

  afterAll(tmp.cleanup);

  it("init: bare invocation in an empty dir still exits 1 with the usage message", async () => {
    const dir = await tmp.make();
    const result = await rawRun([cliPath.current, "init"], dir);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("--commons-url");
    expect(result.stdout).toContain("--project");
  });

  it("init --commons: still scaffolds immediately, no mode select, even in an already-bound dir", async () => {
    const dir = await tmp.make();
    // bind it first, non-interactively
    const bound = await rawRun(
      [
        cliPath.current,
        "init",
        "--commons-url",
        "git@x:y/z.git",
        "--project",
        "p",
      ],
      dir,
    );
    expect(bound.code).toBe(0);

    const result = await rawRun([cliPath.current, "init", "--commons"], dir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Commons repo scaffolded");
  });

  it("promote: bare invocation still hits the --type gate before anything else", async () => {
    const dir = await tmp.make();
    const result = await rawRun([cliPath.current, "promote"], dir);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      'Error: --type must be "standard" or "lesson", got ""',
    );
  });

  it("promote: an explicitly bad --type fails immediately with today's exact message", async () => {
    const dir = await tmp.make();
    const result = await rawRun(
      [cliPath.current, "promote", "--type", "bogus"],
      dir,
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      'Error: --type must be "standard" or "lesson", got "bogus"',
    );
  });

  it("promote: an unreadable --body-file fails immediately with today's exact message", async () => {
    const dir = await tmp.make();
    const result = await rawRun(
      [
        cliPath.current,
        "promote",
        "--type",
        "standard",
        "--body-file",
        "/no/such/file.md",
      ],
      dir,
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      'Error: cannot read --body-file "/no/such/file.md"',
    );
  });

  // Global library model (Phase 4): `promote library <name>` is dispatched
  // manually inside promoteCmd.run (never a citty subCommand — see the
  // comment above promoteLibraryCmd in cli.ts). These are real proof, through
  // the actual built CLI, that (a) the dispatch doesn't regress entry
  // promote's own flag parsing and (b) `promote library`'s own missing-NAME
  // usage screen renders correctly.
  it("promote --scope org --type standard: still reaches entry-promote's own gates, not an 'Unknown command' error", async () => {
    const dir = await tmp.make();
    const result = await rawRun(
      [cliPath.current, "promote", "--scope", "org", "--type", "standard"],
      dir,
    );
    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).not.toContain("Unknown command");
    expect(result.stdout).toContain('Invalid name ""');
  });

  it("promote library: missing positional NAME shows promote-library's own usage, not entry-promote's", async () => {
    const dir = await tmp.make();
    const result = await rawRun([cliPath.current, "promote", "library"], dir);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      "ERROR  Missing required positional argument: NAME",
    );
    expect(result.stdout).toContain("promote library");
    expect(result.stdout).not.toContain("--scope");
  });

  // D3: SOURCE/NAME became `required: false` in citty so a TTY session can
  // reach the guided prompt for them — citty's own parse-time throw (which
  // used to fire before run() ever executed) is now replicated verbatim by
  // reportMissingPositional. These assert the FULL captured stdout/stderr
  // (not a substring) so any drift from today's byte-identical output fails
  // the build, per ADR 0008's non-TTY parity contract.
  it("skill add: missing positional SOURCE still fails at argument-parsing, before any prompt code runs", async () => {
    const dir = await tmp.make();
    const result = await rawRun([cliPath.current, "skill", "add"], dir);
    expect(result.code).toBe(1);
    expect(normalizeCliOutput(result.stdout)).toBe(
      "Vendor a skill from GitHub/skills.sh into the commons (opens a PR) (skill add)\n\nUSAGE skill add [OPTIONS] <SOURCE>\n\nARGUMENTS\n\n  SOURCE    owner/repo or git URL    \n\nOPTIONS\n\n   --skill    Skill name when the repo has several\n     --ref    Upstream ref to pin (default: HEAD) \n  --author    Author (github handle)              \n    --date    Date (YYYY-MM-DD)                   \n\n\n",
    );
    expect(normalizeCliOutput(result.stderr)).toBe(
      "\n ERROR  Missing required positional argument: SOURCE\n\n",
    );
  });

  it("skill add: source given but author missing still fails with today's exact message", async () => {
    const dir = await tmp.make();
    const result = await rawRun(
      [cliPath.current, "skill", "add", "obra/skills"],
      dir,
    );
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("author must not be empty.");
  });

  it("skill promote: missing positional NAME still fails at argument-parsing, before any prompt code runs", async () => {
    const dir = await tmp.make();
    const result = await rawRun([cliPath.current, "skill", "promote"], dir);
    expect(result.code).toBe(1);
    expect(normalizeCliOutput(result.stdout)).toBe(
      "Promote a personal skill (~/.claude/skills/<name>) into the commons (opens a PR) (skill promote)\n\nUSAGE skill promote [OPTIONS] <NAME>\n\nARGUMENTS\n\n  NAME    Skill directory name    \n\nOPTIONS\n\n  --author    Author (github handle)\n    --date    Date (YYYY-MM-DD)     \n\n\n",
    );
    expect(normalizeCliOutput(result.stderr)).toBe(
      "\n ERROR  Missing required positional argument: NAME\n\n",
    );
  });

  it("skill promote: name given but author missing still fails with today's exact message", async () => {
    const dir = await tmp.make();
    const result = await rawRun(
      [cliPath.current, "skill", "promote", "grill-me"],
      dir,
    );
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("author must not be empty.");
  });

  it("digest --hook in a configless dir stays a silent, successful no-op", async () => {
    const dir = await tmp.make();
    const result = await rawRun([cliPath.current, "digest", "--hook"], dir);
    expect(result.code).toBe(0);
    expect(normalizeCliOutput(result.stdout)).toBe("");
  });
}, 90_000);
