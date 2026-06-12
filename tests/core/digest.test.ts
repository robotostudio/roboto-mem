import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCache, writeCache } from "../../src/core/cache.js";
import {
  compileDigest,
  type DigestInput,
  type DigestMeta,
  estimateTokens,
} from "../../src/core/digest.js";
import type { Entry } from "../../src/core/entry.js";

const makeEntry = (over: Partial<Entry>): Entry => ({
  name: "default-name",
  description: "default description",
  type: "standard",
  scope: "org",
  author: "test",
  date: "2026-01-01",
  body: "default body",
  file: "entries/org/default-name.md",
  ...over,
});

const baseMeta: DigestMeta = {
  toolVersion: "0.1.0",
  formatVersion: 1,
  syncedDate: "2026-06-01",
};

// ─── 1. Filtering ────────────────────────────────────────────────────────────
describe("filtering", () => {
  it("excludes entries whose scope is not in sessionScopes", () => {
    const entries: Entry[] = [
      makeEntry({ name: "org-rule", scope: "org", type: "standard" }),
      makeEntry({
        name: "sanity-lesson",
        scope: "stack/sanity",
        type: "lesson",
        description: "sanity tip",
        file: "entries/stacks/sanity/sanity-lesson.md",
        date: "2026-05-01",
      }),
      makeEntry({
        name: "shopify-lesson",
        scope: "stack/shopify",
        type: "lesson",
        description: "shopify tip",
        file: "entries/stacks/shopify/shopify-lesson.md",
        date: "2026-05-02",
      }),
    ];
    const result = compileDigest({
      entries,
      sessionScopes: ["org", "stack/sanity", "project/x"],
      budgets: {},
      meta: baseMeta,
    });
    expect(result).toContain("org-rule");
    expect(result).toContain("sanity-lesson");
    expect(result).not.toContain("shopify-lesson");
  });
});

// ─── 2. Full body + exact lesson line ────────────────────────────────────────
describe("rendering", () => {
  it("renders full standard body and exact lesson one-liner", () => {
    const entries: Entry[] = [
      makeEntry({
        name: "no-let",
        scope: "org",
        type: "standard",
        body: "Never use let in production code.",
      }),
      makeEntry({
        name: "typegen-flag",
        scope: "stack/sanity",
        type: "lesson",
        description: "TypeGen v3 flag breaks our client wrapper",
        file: "entries/stacks/sanity/typegen-flag.md",
        date: "2026-05-30",
      }),
    ];
    const result = compileDigest({
      entries,
      sessionScopes: ["org", "stack/sanity"],
      budgets: {},
      meta: baseMeta,
    });
    expect(result).toContain("Never use let in production code.");
    expect(result).toContain(
      "- [stack/sanity] typegen-flag — TypeGen v3 flag breaks our client wrapper (entries/stacks/sanity/typegen-flag.md, 2026-05-30)",
    );
  });
});

// ─── 3. Override suppression ──────────────────────────────────────────────────
describe("override suppression", () => {
  it("suppresses target body and inserts pointer; overriding header carries the ref", () => {
    const entries: Entry[] = [
      makeEntry({
        name: "never-use-let",
        scope: "org",
        type: "standard",
        body: "Never use let.",
      }),
      makeEntry({
        name: "let-hotpaths",
        scope: "squad/web",
        type: "standard",
        body: "In hot paths, let is allowed.",
        overrides: "org/never-use-let",
      }),
    ];
    const result = compileDigest({
      entries,
      sessionScopes: ["org", "squad/web"],
      budgets: {},
      meta: baseMeta,
    });
    // Target body is suppressed
    expect(result).not.toContain("Never use let.");
    // Pointer line appears
    expect(result).toContain(
      "> org/never-use-let is overridden for this repo by squad/web/let-hotpaths.",
    );
    // Overriding header carries the ref
    expect(result).toContain("— overrides org/never-use-let");
    // Overriding body is still rendered
    expect(result).toContain("In hot paths, let is allowed.");
  });
});

// ─── 4. Unknown override target ───────────────────────────────────────────────
describe("unknown override target", () => {
  it("renders overriding entry normally and appends WARNING", () => {
    const entries: Entry[] = [
      makeEntry({
        name: "let-hotpaths",
        scope: "squad/web",
        type: "standard",
        body: "In hot paths, let is allowed.",
        overrides: "org/never-use-let",
      }),
    ];
    const result = compileDigest({
      entries,
      sessionScopes: ["org", "squad/web"],
      budgets: {},
      meta: baseMeta,
    });
    expect(result).toContain("In hot paths, let is allowed.");
    expect(result).toContain(
      "> WARNING: declared override target org/never-use-let not found.",
    );
  });
});

// ─── 5. Ordering determinism ──────────────────────────────────────────────────
describe("ordering determinism", () => {
  it("produces identical output regardless of input order", () => {
    const base: Entry[] = [
      makeEntry({
        name: "z-rule",
        scope: "org",
        type: "standard",
        body: "org z",
      }),
      makeEntry({
        name: "a-rule",
        scope: "org",
        type: "standard",
        body: "org a",
      }),
      makeEntry({
        name: "beta",
        scope: "squad/beta",
        type: "standard",
        body: "squad beta",
      }),
      makeEntry({
        name: "alpha",
        scope: "squad/alpha",
        type: "standard",
        body: "squad alpha",
      }),
      makeEntry({
        name: "stack-b",
        scope: "stack/b",
        type: "lesson",
        description: "b lesson",
        file: "f.md",
        date: "2026-01-01",
      }),
      makeEntry({
        name: "stack-a",
        scope: "stack/a",
        type: "lesson",
        description: "a lesson",
        file: "g.md",
        date: "2026-01-02",
      }),
      makeEntry({
        name: "proj-rule",
        scope: "project/myapp",
        type: "standard",
        body: "proj",
      }),
    ];
    const shuffled = [
      base[3],
      base[6],
      base[1],
      base[4],
      base[0],
      base[5],
      base[2],
    ] as Entry[];
    const input: DigestInput = {
      entries: base,
      sessionScopes: [
        "org",
        "squad/alpha",
        "squad/beta",
        "stack/a",
        "stack/b",
        "project/myapp",
      ],
      budgets: {},
      meta: baseMeta,
    };
    const inputShuffled: DigestInput = { ...input, entries: shuffled };
    expect(compileDigest(input)).toBe(compileDigest(inputShuffled));
  });

  it("produces correct section order: org then squad/* alpha then stack/* alpha then project/*", () => {
    const entries: Entry[] = [
      makeEntry({
        name: "p-rule",
        scope: "project/myapp",
        type: "standard",
        body: "project",
      }),
      makeEntry({
        name: "s-rule",
        scope: "stack/react",
        type: "standard",
        body: "stack",
      }),
      makeEntry({
        name: "o-rule",
        scope: "org",
        type: "standard",
        body: "org",
      }),
      makeEntry({
        name: "q-rule",
        scope: "squad/web",
        type: "standard",
        body: "squad",
      }),
    ];
    const result = compileDigest({
      entries,
      sessionScopes: ["org", "squad/web", "stack/react", "project/myapp"],
      budgets: {},
      meta: baseMeta,
    });
    const orgIdx = result.indexOf("org");
    const squadIdx = result.indexOf("squad");
    const stackIdx = result.indexOf("stack");
    const projectIdx = result.indexOf("project");
    expect(orgIdx).toBeLessThan(squadIdx);
    expect(squadIdx).toBeLessThan(stackIdx);
    expect(stackIdx).toBeLessThan(projectIdx);
  });
});

// ─── 6. Budget warnings ───────────────────────────────────────────────────────
describe("budget warnings", () => {
  it("appends warning when scope exceeds budget", () => {
    const entries: Entry[] = [
      makeEntry({
        name: "big-rule",
        scope: "org",
        type: "standard",
        body: "x".repeat(200),
      }),
    ];
    const result = compileDigest({
      entries,
      sessionScopes: ["org"],
      budgets: { default: 10 },
      meta: baseMeta,
    });
    expect(result).toMatch(
      /> WARNING: scope org exceeds its budget \(\d+ > 10 tokens\)/,
    );
  });

  it("no warning when under budget", () => {
    const entries: Entry[] = [
      makeEntry({ name: "tiny", scope: "org", type: "standard", body: "hi" }),
    ];
    const result = compileDigest({
      entries,
      sessionScopes: ["org"],
      budgets: { default: 99999 },
      meta: baseMeta,
    });
    expect(result).not.toContain("WARNING: scope org exceeds");
  });

  it("uses scope-specific budget over default", () => {
    const entries: Entry[] = [
      makeEntry({
        name: "rule",
        scope: "org",
        type: "standard",
        body: "x".repeat(200),
      }),
    ];
    // org-specific budget is generous; default is tiny
    const result = compileDigest({
      entries,
      sessionScopes: ["org"],
      budgets: { org: 99999, default: 1 },
      meta: baseMeta,
    });
    expect(result).not.toContain("WARNING: scope org exceeds");
  });
});

// ─── 7. nag + stale ──────────────────────────────────────────────────────────
describe("nag and stale meta", () => {
  it("renders nag after header when present", () => {
    const result = compileDigest({
      entries: [
        makeEntry({ name: "r", scope: "org", type: "standard", body: "b" }),
      ],
      sessionScopes: ["org"],
      budgets: {},
      meta: { ...baseMeta, nag: "Run roboto-mem sync today!" },
    });
    const headerIdx = result.indexOf("# Team Memory");
    const nagIdx = result.indexOf("> Run roboto-mem sync today!");
    expect(nagIdx).toBeGreaterThan(headerIdx);
  });

  it("renders stale as very first line when present", () => {
    const result = compileDigest({
      entries: [
        makeEntry({ name: "r", scope: "org", type: "standard", body: "b" }),
      ],
      sessionScopes: ["org"],
      budgets: {},
      meta: { ...baseMeta, stale: "7 days" },
    });
    expect(result.startsWith("> STALE: 7 days")).toBe(true);
  });

  it("omits nag line when absent", () => {
    const result = compileDigest({
      entries: [
        makeEntry({ name: "r", scope: "org", type: "standard", body: "b" }),
      ],
      sessionScopes: ["org"],
      budgets: {},
      meta: baseMeta,
    });
    expect(result).not.toContain("> Run");
  });

  it("omits stale line when absent", () => {
    const result = compileDigest({
      entries: [
        makeEntry({ name: "r", scope: "org", type: "standard", body: "b" }),
      ],
      sessionScopes: ["org"],
      budgets: {},
      meta: baseMeta,
    });
    expect(result.startsWith("> STALE")).toBe(false);
  });
});

// ─── 8. Both sections empty ───────────────────────────────────────────────────
describe("empty sections", () => {
  it("omits Standards heading when no standards apply", () => {
    const entries: Entry[] = [
      makeEntry({
        name: "tip",
        scope: "org",
        type: "lesson",
        description: "a tip",
        file: "f.md",
        date: "2026-01-01",
      }),
    ];
    const result = compileDigest({
      entries,
      sessionScopes: ["org"],
      budgets: {},
      meta: baseMeta,
    });
    expect(result).not.toContain("## Standards");
  });

  it("omits Lessons heading when no lessons apply", () => {
    const entries: Entry[] = [
      makeEntry({ name: "rule", scope: "org", type: "standard", body: "body" }),
    ];
    const result = compileDigest({
      entries,
      sessionScopes: ["org"],
      budgets: {},
      meta: baseMeta,
    });
    expect(result).not.toContain("## Lessons");
  });

  it("shows fallback line when no entries apply at all", () => {
    const result = compileDigest({
      entries: [],
      sessionScopes: ["org"],
      budgets: {},
      meta: baseMeta,
    });
    expect(result).toContain(
      "No Team Memory entries apply to this repo's scopes.",
    );
  });
});

// ─── 9. estimateTokens ───────────────────────────────────────────────────────
describe("estimateTokens", () => {
  it('returns 1 for "abcd" (4 chars)', () => {
    expect(estimateTokens("abcd")).toBe(1);
  });

  it('returns 2 for "abcde" (5 chars)', () => {
    expect(estimateTokens("abcde")).toBe(2);
  });

  it('returns 0 for ""', () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("applies ceil: 7 chars → 2", () => {
    expect(estimateTokens("abcdefg")).toBe(2);
  });

  it("applies ceil: 8 chars → 2", () => {
    expect(estimateTokens("abcdefgh")).toBe(2);
  });

  it("applies ceil: 9 chars → 3", () => {
    expect(estimateTokens("abcdefghi")).toBe(3);
  });
});

// ─── 10. Cache roundtrip ─────────────────────────────────────────────────────
describe("cache", () => {
  it("roundtrip: write then read returns deep-equal object", async () => {
    const home = join(tmpdir(), `roboto-cache-test-${Date.now()}`);
    await mkdir(home, { recursive: true });
    try {
      const cached = { date: "2026-06-01", digest: "hello world digest" };
      await writeCache(home, "/projects/myapp", cached);
      const result = await readCache(home, "/projects/myapp");
      expect(result).toEqual(cached);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("readCache returns undefined when home dir does not exist", async () => {
    const result = await readCache(
      "/nonexistent/path/that/cannot/exist",
      "/project/x",
    );
    expect(result).toBeUndefined();
  });

  it("readCache returns undefined for corrupted JSON", async () => {
    const home = join(tmpdir(), `roboto-cache-corrupt-${Date.now()}`);
    const cacheDir = join(home, "cache");
    await mkdir(cacheDir, { recursive: true });
    // Write a deliberately bad file at the expected path
    // We need the sha256 of the projectPath — derive it the same way cache.ts will
    // Use a known project path and write corruption there
    const { createHash } = await import("node:crypto");
    const key = createHash("sha256")
      .update("/project/corrupt")
      .digest("hex")
      .slice(0, 12);
    await writeFile(join(cacheDir, `${key}.json`), "not json");
    try {
      const result = await readCache(home, "/project/corrupt");
      expect(result).toBeUndefined();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("readCache returns undefined when shape is wrong", async () => {
    const home = join(tmpdir(), `roboto-cache-shape-${Date.now()}`);
    const cacheDir = join(home, "cache");
    await mkdir(cacheDir, { recursive: true });
    const { createHash } = await import("node:crypto");
    const key = createHash("sha256")
      .update("/project/shape")
      .digest("hex")
      .slice(0, 12);
    await writeFile(
      join(cacheDir, `${key}.json`),
      JSON.stringify({ foo: "bar" }),
    );
    try {
      const result = await readCache(home, "/project/shape");
      expect(result).toBeUndefined();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("different projectPaths produce different cache files (isolation)", async () => {
    const home = join(tmpdir(), `roboto-cache-iso-${Date.now()}`);
    await mkdir(home, { recursive: true });
    try {
      await writeCache(home, "/project/a", { date: "2026-01-01", digest: "a" });
      await writeCache(home, "/project/b", { date: "2026-01-02", digest: "b" });
      const a = await readCache(home, "/project/a");
      const b = await readCache(home, "/project/b");
      expect(a?.digest).toBe("a");
      expect(b?.digest).toBe("b");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

// ─── 11. Override where target is a lesson (not-found treatment) ──────────────
describe("override target is a lesson", () => {
  it("treats lesson-target as not found → WARNING (rule-4 edge)", () => {
    const entries: Entry[] = [
      makeEntry({
        name: "a-lesson",
        scope: "org",
        type: "lesson",
        description: "some lesson",
        file: "f.md",
        date: "2026-01-01",
      }),
      makeEntry({
        name: "overrider",
        scope: "squad/web",
        type: "standard",
        body: "overrider body",
        overrides: "org/a-lesson",
      }),
    ];
    const result = compileDigest({
      entries,
      sessionScopes: ["org", "squad/web"],
      budgets: {},
      meta: baseMeta,
    });
    // Overriding standard is rendered normally
    expect(result).toContain("overrider body");
    // WARNING because the ref points at a lesson, not a standard
    expect(result).toContain(
      "> WARNING: declared override target org/a-lesson not found.",
    );
  });
});

// ─── 12. writeCache is best-effort — blocked cache dir does not throw ─────────
describe("writeCache blocked cache dir", () => {
  it("resolves to undefined when a FILE blocks the cache dir (no throw)", async () => {
    const home = join(tmpdir(), `roboto-cache-blocked-${Date.now()}`);
    await mkdir(home, { recursive: true });
    // Place a FILE at the path where writeCache would mkdir the "cache" subdir
    await writeFile(join(home, "cache"), "not a directory");
    try {
      await expect(
        writeCache(home, "/project/x", { date: "2026-06-12", digest: "x" }),
      ).resolves.toBeUndefined();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
