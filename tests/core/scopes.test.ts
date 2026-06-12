import { describe, expect, it } from "vitest";
import {
  entryApplies,
  isValidScope,
  sessionScopes,
} from "../../src/core/scopes.js";

describe("isValidScope", () => {
  it("accepts valid scopes", () => {
    expect(isValidScope("org")).toBe(true);
    expect(isValidScope("squad/web")).toBe(true);
    expect(isValidScope("stack/nextjs")).toBe(true);
    expect(isValidScope("project/loggle")).toBe(true);
    expect(isValidScope("stack/react-router")).toBe(true);
  });

  it("rejects invalid scopes", () => {
    expect(isValidScope("team")).toBe(false);
    expect(isValidScope("squad/")).toBe(false);
    expect(isValidScope("org/x")).toBe(false);
    expect(isValidScope("stack/Next")).toBe(false);
    expect(isValidScope("squad/web/extra")).toBe(false);
    expect(isValidScope("")).toBe(false);
    expect(isValidScope("project/-bad")).toBe(false);
  });
});

describe("sessionScopes", () => {
  it("returns deduplicated scopes in exact order", () => {
    const result = sessionScopes({
      project: "loggle",
      squads: ["web", "platform"],
      workspaces: {
        ".": ["stack/nextjs", "stack/react"],
        "apps/studio": ["stack/sanity", "stack/react"],
      },
    });

    expect(result).toEqual([
      "org",
      "squad/platform",
      "squad/web",
      "stack/nextjs",
      "stack/react",
      "stack/sanity",
      "project/loggle",
    ]);
  });

  it("silently drops invalid workspace values", () => {
    const result = sessionScopes({
      project: "loggle",
      squads: [],
      workspaces: { ".": ["stack/nextjs", "weird/x"] },
    });

    expect(result).toEqual(["org", "stack/nextjs", "project/loggle"]);
    expect(result).not.toContain("weird/x");
  });
});

describe("entryApplies", () => {
  it("returns true for scopes in the set and false otherwise", () => {
    const scopes = sessionScopes({
      project: "loggle",
      squads: ["web", "platform"],
      workspaces: {
        ".": ["stack/nextjs", "stack/react"],
        "apps/studio": ["stack/sanity", "stack/react"],
      },
    });

    expect(entryApplies("stack/sanity", scopes)).toBe(true);
    expect(entryApplies("stack/shopify", scopes)).toBe(false);
    expect(entryApplies("org", scopes)).toBe(true);
  });
});
