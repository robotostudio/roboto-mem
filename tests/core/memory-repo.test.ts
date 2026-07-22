import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { rename, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureRepo,
  FORMAT_VERSION,
  loadMemory,
  localRepo,
  memoryHome,
  repoDirFor,
} from "../../src/core/memory-repo.js";
import { makeCommonsFixture, pushEntry } from "../helpers/git.js";
import { tmpDirFactory } from "../helpers/tmp.js";

const tmp = tmpDirFactory("roboto-mem-test-");
const mkTmp = tmp.make;

// ---------------------------------------------------------------------------
// Test 0: repoDirFor — repos/<sha12(url)>/ clone-path scheme (global library
// model spec: hash-keyed isolation so multiple projects/commons on one
// machine never collide; verified here, no new code — see design spec
// docs/design-specs/2026-07-17-global-library-model.md)
// ---------------------------------------------------------------------------
describe("repoDirFor", () => {
  it("returns home/repos/<first-12-hex-chars-of-sha256(url)>", () => {
    const home = "/fake/home/.roboto-mem";
    const url = "https://github.com/team/commons";
    const expectedHash = createHash("sha256")
      .update(url)
      .digest("hex")
      .slice(0, 12);
    expect(repoDirFor(url, home)).toBe(path.join(home, "repos", expectedHash));
    expect(expectedHash).toHaveLength(12);
  });

  it("produces different dirs for different urls (hash-keyed isolation)", () => {
    const home = "/fake/home/.roboto-mem";
    const a = repoDirFor("https://github.com/team/commons-a", home);
    const b = repoDirFor("https://github.com/team/commons-b", home);
    expect(a).not.toBe(b);
  });

  it("produces the same dir for the same url across calls (deterministic)", () => {
    const home = "/fake/home/.roboto-mem";
    const url = "https://github.com/team/commons";
    expect(repoDirFor(url, home)).toBe(repoDirFor(url, home));
  });
});

// ---------------------------------------------------------------------------
// Test 1: first ensureRepo clones
// ---------------------------------------------------------------------------
describe("ensureRepo — first clone", () => {
  afterEach(tmp.cleanup);

  it("returns ok:true, stale:false, dir contains memory.json", async () => {
    const tmp = await mkTmp();
    const home = await mkTmp();
    const fixture = await makeCommonsFixture(tmp);

    const result = await ensureRepo(fixture.remoteUrl, home);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stale).toBe(false);
    const stat = await fs.stat(path.join(result.dir, "memory.json"));
    expect(stat.isFile()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 2: second ensureRepo pulls new content
// ---------------------------------------------------------------------------
describe("ensureRepo — pull new content", () => {
  afterEach(tmp.cleanup);

  it("pulls new entry; stale:false and new file present", async () => {
    const tmp = await mkTmp();
    const home = await mkTmp();
    const fixture = await makeCommonsFixture(tmp);

    const first = await ensureRepo(fixture.remoteUrl, home);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    await pushEntry(
      fixture,
      "entries/org/new-lesson.md",
      `---
description: A brand new org lesson
type: lesson
author: hrithik
date: 2026-06-10
---
Body of the new lesson.`,
    );

    const second = await ensureRepo(fixture.remoteUrl, home);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.stale).toBe(false);

    const stat = await fs.stat(
      path.join(second.dir, "entries/org/new-lesson.md"),
    );
    expect(stat.isFile()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 3: offline tolerance — pull fails, stale:true, old content intact
// ---------------------------------------------------------------------------
describe("ensureRepo — offline tolerance", () => {
  afterEach(tmp.cleanup);

  it("returns ok:true, stale:true when remote is unreachable", async () => {
    const tmp = await mkTmp();
    const home = await mkTmp();
    const fixture = await makeCommonsFixture(tmp);

    const first = await ensureRepo(fixture.remoteUrl, home);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Move the bare repo away to simulate offline / deleted remote
    const movedDir = `${fixture.remoteUrl}.gone`;
    await rename(fixture.remoteUrl, movedDir);

    const second = await ensureRepo(fixture.remoteUrl, home);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.stale).toBe(true);

    // Old content still readable
    const stat = await fs.stat(path.join(second.dir, "memory.json"));
    expect(stat.isFile()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 4: clone failure (nonexistent URL, fresh home)
// ---------------------------------------------------------------------------
describe("ensureRepo — clone failure", () => {
  afterEach(tmp.cleanup);

  it("returns ok:false with error text when url does not exist", async () => {
    const home = await mkTmp();
    const result = await ensureRepo("/nonexistent/path/to/repo.git", home);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Test 4b: localRepo — network-free repo resolution (global library model
// Phase 6: SessionStart no longer clones/pulls; it only reads whatever a
// prior `ensureRepo` call — via `roboto-mem sync`/`init` — left on disk. See
// "Loading mechanism at SessionStart" in
// docs/design-specs/2026-07-17-global-library-model.md.
// ---------------------------------------------------------------------------
describe("localRepo — not yet synced", () => {
  afterEach(tmp.cleanup);

  it("returns ok:false without touching the network or creating the dir", async () => {
    const home = await mkTmp();
    const dir = repoDirFor("https://example.test/never-synced.git", home);

    const result = await localRepo(
      "https://example.test/never-synced.git",
      home,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.length).toBeGreaterThan(0);

    // Never attempted a clone — the repo dir must not exist.
    await expect(fs.access(dir)).rejects.toThrow();
  });
});

describe("localRepo — already synced", () => {
  afterEach(tmp.cleanup);

  it("returns ok:true, stale:false, same dir as repoDirFor, after a prior ensureRepo", async () => {
    const tmp = await mkTmp();
    const home = await mkTmp();
    const fixture = await makeCommonsFixture(tmp);

    const synced = await ensureRepo(fixture.remoteUrl, home);
    expect(synced.ok).toBe(true);

    const result = await localRepo(fixture.remoteUrl, home);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stale).toBe(false);
    expect(result.dir).toBe(repoDirFor(fixture.remoteUrl, home));
    const stat = await fs.stat(path.join(result.dir, "memory.json"));
    expect(stat.isFile()).toBe(true);
  });

  it("keeps reading the local clone even after the remote becomes unreachable (no pull attempted)", async () => {
    const tmp = await mkTmp();
    const home = await mkTmp();
    const fixture = await makeCommonsFixture(tmp);

    await ensureRepo(fixture.remoteUrl, home);

    // Remote disappears — a network-based resolver (ensureRepo) would mark
    // this stale:true after a failed pull. localRepo must not even try.
    await rename(fixture.remoteUrl, `${fixture.remoteUrl}.gone`);

    const result = await localRepo(fixture.remoteUrl, home);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stale).toBe(false);
    const stat = await fs.stat(path.join(result.dir, "memory.json"));
    expect(stat.isFile()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 5: loadMemory on fixture clone — entries, scope, budgets
// ---------------------------------------------------------------------------
describe("loadMemory — valid fixture clone", () => {
  afterEach(tmp.cleanup);

  it("returns ok:true, formatVersion 1, 3 entries sorted by file, correct scopes, correct budgets", async () => {
    const tmp = await mkTmp();
    const home = await mkTmp();
    const fixture = await makeCommonsFixture(tmp);
    const synced = await ensureRepo(fixture.remoteUrl, home);
    if (!synced.ok) throw new Error("clone failed in setup");
    const cloneDir = synced.dir;

    const result = await loadMemory(cloneDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.formatVersion).toBe(1);
    expect(result.entries).toHaveLength(3);

    // sorted by file path
    const files = result.entries.map((e) => e.file);
    expect(files).toEqual([...files].sort());

    // scopes present
    const scopes = result.entries.map((e) => e.scope);
    expect(scopes).toContain("org");
    expect(scopes).toContain("squad/web");
    expect(scopes).toContain("stack/sanity");

    expect(result.budgets).toEqual({ default: 2000, org: 4000 });
    expect(result.declaredBudgets).toEqual({ default: 2000, org: 4000 });
    expect(result.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test 6: invalid entry collected, not thrown
// ---------------------------------------------------------------------------
describe("loadMemory — invalid entry collected", () => {
  afterEach(tmp.cleanup);

  it("returns ok:true with 3 good entries and 1 error referencing the broken file", async () => {
    const tmp = await mkTmp();
    const home = await mkTmp();
    const fixture = await makeCommonsFixture(tmp);

    await pushEntry(
      fixture,
      "entries/org/broken.md",
      // missing description — will fail parseEntry
      `---
type: standard
author: hrithik
date: 2026-06-05
---
Body without description.`,
    );

    const synced = await ensureRepo(fixture.remoteUrl, home);
    if (!synced.ok) throw new Error("clone failed in setup");
    const cloneDir = synced.dir;

    const result = await loadMemory(cloneDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.entries).toHaveLength(3);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.file).toContain("broken.md");
  });
});

// ---------------------------------------------------------------------------
// Test 7: newer format version
// ---------------------------------------------------------------------------
describe("loadMemory — newer format version", () => {
  afterEach(tmp.cleanup);

  it("returns ok:false, reason newer-format, formatVersion 3", async () => {
    const dir = await mkTmp();
    await writeFile(
      path.join(dir, "memory.json"),
      JSON.stringify({ formatVersion: 3, budgets: {} }),
      "utf8",
    );

    const result = await loadMemory(dir);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("newer-format");
    if (result.reason !== "newer-format") return;
    expect(result.formatVersion).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Test 7b: global library model — FORMAT_VERSION bump (Phase 2). New CLI
// (FORMAT_VERSION=2) accepts a v2-declared commons; old CLI (FORMAT_VERSION=1,
// already shipped/frozen) rejecting a v2 commons via this exact
// `formatVersion > FORMAT_VERSION` gate was already proven in Phase 1 —
// see docs/design-specs/2026-07-17-global-library-model.md, "Old CLI safe".
// ---------------------------------------------------------------------------
describe("loadMemory — FORMAT_VERSION is 2 (global library model)", () => {
  afterEach(tmp.cleanup);

  it("FORMAT_VERSION constant equals 2", () => {
    expect(FORMAT_VERSION).toBe(2);
  });

  it("accepts a commons that declares formatVersion 2 (current version, not newer)", async () => {
    const dir = await mkTmp();
    await writeFile(
      path.join(dir, "memory.json"),
      JSON.stringify({ formatVersion: 2, budgets: {} }),
      "utf8",
    );

    const result = await loadMemory(dir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.formatVersion).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Test 8: missing manifest
// ---------------------------------------------------------------------------
describe("loadMemory — missing manifest", () => {
  afterEach(tmp.cleanup);

  it("returns ok:false, reason missing-manifest for an empty dir", async () => {
    const dir = await mkTmp();

    const result = await loadMemory(dir);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("missing-manifest");
  });
});

// ---------------------------------------------------------------------------
// Test 8b: loadMemory with no budgets key → declaredBudgets {} but budgets has defaults
// ---------------------------------------------------------------------------
describe("loadMemory — no budgets key in manifest", () => {
  afterEach(tmp.cleanup);

  it("declaredBudgets is empty; budgets has default values injected", async () => {
    const dir = await mkTmp();
    // Use a SEPARATE tmp dir for this fixture — no entries dir, just manifest
    await writeFile(
      path.join(dir, "memory.json"),
      JSON.stringify({ formatVersion: 1 }),
      "utf8",
    );

    const result = await loadMemory(dir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // No budgets key → declaredBudgets must be empty
    expect(result.declaredBudgets).toEqual({});
    // budgets still has injected defaults
    expect(result.budgets).toEqual({ default: 2000, org: 4000 });
  });
});

// ---------------------------------------------------------------------------
// Test 9: memoryHome()
// ---------------------------------------------------------------------------
describe("memoryHome", () => {
  it("returns ROBOTO_MEM_HOME when env var is set", () => {
    const saved = process.env.ROBOTO_MEM_HOME;
    try {
      process.env.ROBOTO_MEM_HOME = "/custom/path";
      expect(memoryHome()).toBe("/custom/path");
    } finally {
      if (saved === undefined) {
        delete process.env.ROBOTO_MEM_HOME;
      } else {
        process.env.ROBOTO_MEM_HOME = saved;
      }
    }
  });

  it("ends with .roboto-mem when env var is not set", () => {
    const saved = process.env.ROBOTO_MEM_HOME;
    try {
      delete process.env.ROBOTO_MEM_HOME;
      expect(memoryHome().endsWith(".roboto-mem")).toBe(true);
    } finally {
      if (saved !== undefined) {
        process.env.ROBOTO_MEM_HOME = saved;
      }
    }
  });
});
