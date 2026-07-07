import * as fs from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { main, validatePromoteType } from "../src/cli.js";
import { splitSquads } from "../src/core/scopes.js";

describe("splitSquads", () => {
  it("splits comma-separated values and trims whitespace", () => {
    expect(splitSquads("a, b")).toEqual(["a", "b"]);
  });

  it("handles no spaces", () => {
    expect(splitSquads("alpha,beta,gamma")).toEqual(["alpha", "beta", "gamma"]);
  });

  it("returns empty array for empty string", () => {
    expect(splitSquads("")).toEqual([]);
  });

  it("filters blank segments from leading/trailing commas", () => {
    expect(splitSquads(",a,,b,")).toEqual(["a", "b"]);
  });
});

describe("validatePromoteType", () => {
  it("accepts 'standard'", () => {
    expect(validatePromoteType("standard")).toBe("standard");
  });

  it("accepts 'lesson'", () => {
    expect(validatePromoteType("lesson")).toBe("lesson");
  });

  it("rejects 'rule'", () => {
    expect(validatePromoteType("rule")).toBeUndefined();
  });

  it("rejects empty string", () => {
    expect(validatePromoteType("")).toBeUndefined();
  });

  it("rejects arbitrary strings", () => {
    expect(validatePromoteType("STANDARD")).toBeUndefined();
  });
});

describe("main subCommands structure", () => {
  it("has exactly 7 subcommand keys", () => {
    const keys = Object.keys(main.subCommands ?? {});
    expect(keys.sort()).toEqual(
      ["digest", "init", "lint", "promote", "skill", "status", "sync"].sort(),
    );
  });
});

describe("skill subcommand", () => {
  it("is registered on main", () => {
    expect(main.subCommands).toHaveProperty("skill");
  });
});

// digest --hook runs inside a Claude Code SessionStart hook and must never be
// able to block a session on a prompt. Proven at the source level: none of
// these command modules reference the prompt/driver/interactive modules or
// @clack/prompts itself, so there is no code path — TTY or not — by which
// they could invoke a prompt.
describe("prompt module isolation (digest/sync/status/lint never prompt)", () => {
  const commandsDir = path.join(import.meta.dirname, "..", "src", "commands");
  const forbidden = [
    "@clack",
    "core/prompts.js",
    "core/prompt-driver.js",
    "core/interactive.js",
  ];

  it.each([
    "digest.ts",
    "sync.ts",
    "status.ts",
    "lint.ts",
  ])("%s never references a prompt module", async (file) => {
    const source = await fs.readFile(path.join(commandsDir, file), "utf8");
    for (const needle of forbidden) {
      expect(source).not.toContain(needle);
    }
  });

  // The leaf-file check above would stay green even if someone wired prompts
  // straight into a defineCommand block in cli.ts (which legitimately
  // imports these modules for init/promote/skill add/skill promote) — so
  // also lock down each of digest/sync/status/lint's OWN defineCommand block
  // specifically, extracted from the shared cli.ts source.
  const cliPath = path.join(import.meta.dirname, "..", "src", "cli.ts");
  const forbiddenWiring = [
    "isInteractiveTty",
    "createClackDriver",
    "resolveInitPrompts",
    "resolvePromotePrompts",
    "resolveSkillAddPrompts",
    "resolveSkillPromotePrompts",
  ];

  /** Slices out `const <name> = defineCommand({ ... })` up to (not including)
   * the next top-level `const`/`export const` declaration in the file. */
  const commandBlockSource = (source: string, constName: string): string => {
    const marker = `const ${constName} = defineCommand(`;
    const start = source.indexOf(marker);
    if (start === -1) throw new Error(`${constName} not found in cli.ts`);
    const rest = source.slice(start + marker.length);
    const nextDeclOffset = rest.search(/\n(?:export )?const \w+ = /);
    return nextDeclOffset === -1
      ? source.slice(start)
      : source.slice(start, start + marker.length + nextDeclOffset);
  };

  it.each([
    "syncCmd",
    "digestCmd",
    "lintCmd",
    "statusCmd",
  ])("%s's defineCommand block in cli.ts never references prompt wiring", async (cmdName) => {
    const source = await fs.readFile(cliPath, "utf8");
    const block = commandBlockSource(source, cmdName);
    for (const needle of forbiddenWiring) {
      expect(block).not.toContain(needle);
    }
  });
});
