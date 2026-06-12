import { describe, expect, it } from "vitest";
import type { DedupeCandidate } from "../../src/core/dedupe.js";
import {
  findSimilar,
  SIMILARITY_THRESHOLD,
  similarity,
  tokenize,
} from "../../src/core/dedupe.js";

describe("tokenize", () => {
  it("lowercases, splits on non-alphanumeric, drops stopwords and empty tokens", () => {
    const result = tokenize("The Sanity TypeGen-flag breaks our client!");
    expect(result.has("the")).toBe(false);
    expect(result.has("our")).toBe(false);
    expect(result.has("sanity")).toBe(true);
    expect(result.has("typegen")).toBe(true);
    expect(result.has("flag")).toBe(true);
    expect(result.has("breaks")).toBe(true);
    expect(result.has("client")).toBe(true);
  });
});

describe("similarity", () => {
  it("returns > 0.7 for near-duplicate texts", () => {
    const score = similarity(
      "sanity typegen flag breaks client wrapper",
      "the sanity typegen flag breaks our client wrapper",
    );
    expect(score).toBeGreaterThan(0.7);
  });

  it("returns < 0.2 for unrelated texts", () => {
    const score = similarity(
      "sanity typegen flag breaks client",
      "tailwind canonical classes only no arbitrary values",
    );
    expect(score).toBeLessThan(0.2);
  });

  it("returns 0 for two empty strings (no NaN)", () => {
    const score = similarity("", "");
    expect(score).toBe(0);
    expect(Number.isNaN(score)).toBe(false);
  });
});

describe("findSimilar", () => {
  const sanityCandidate: DedupeCandidate = {
    name: "sanity typegen flag",
    description: "breaks client wrapper on codegen",
    body: "pass the --watch flag to sanity typegen to avoid breakage",
    file: "entries/sanity-typegen.md",
  };

  const tailwindCandidate: DedupeCandidate = {
    name: "tailwind canonical classes",
    description: "only use canonical tailwind no arbitrary values",
    body: "never use arbitrary values like h-[87px] use h-20 instead",
    file: "entries/tailwind-classes.md",
  };

  it("returns only matches above threshold, omits unrelated candidates", () => {
    const draft = {
      name: "sanity typegen flag breaks",
      description: "client wrapper breaks during codegen",
      body: "use --watch flag with sanity typegen to fix client wrapper",
    };
    const results = findSimilar(draft, [sanityCandidate, tailwindCandidate]);
    expect(results.length).toBe(1);
    expect(results[0]?.candidate.file).toBe("entries/sanity-typegen.md");
    expect(results[0]?.score).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLD);
  });

  it("sorts multiple matches descending by score", () => {
    const exactDraft = {
      name: "sanity typegen flag",
      description: "breaks client wrapper on codegen",
      body: "pass the --watch flag to sanity typegen to avoid breakage",
    };
    // shares most tokens with exactDraft → scores ~0.75 (above threshold, below exact)
    const moderateCandidate: DedupeCandidate = {
      name: "sanity typegen flag breaks",
      description: "client wrapper codegen issue",
      body: "sanity typegen flag watch pass client",
      file: "entries/sanity-moderate.md",
    };
    const results = findSimilar(exactDraft, [
      moderateCandidate,
      sanityCandidate,
    ]);
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0]?.score).toBeGreaterThanOrEqual(results[1]?.score ?? 0);
    expect(results[0]?.score).toBeGreaterThan(0.85);
    expect(results[1]?.score).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLD);
  });

  it("returns empty array when candidates list is empty", () => {
    const draft = {
      name: "sanity typegen flag",
      description: "breaks client",
      body: "some body text",
    };
    expect(findSimilar(draft, [])).toEqual([]);
  });
});
