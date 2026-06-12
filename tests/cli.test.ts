import { describe, expect, it } from "vitest";
import { main, splitSquads, validatePromoteType } from "../src/cli.js";

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
  it("has exactly 6 subcommand keys", () => {
    const keys = Object.keys(main.subCommands ?? {});
    expect(keys.sort()).toEqual(
      ["digest", "init", "lint", "promote", "status", "sync"].sort(),
    );
  });
});
