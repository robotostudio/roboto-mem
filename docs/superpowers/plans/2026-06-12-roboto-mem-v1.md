# roboto-mem v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **OVERRIDE — NO COMMITS:** Hrithik's global rules forbid `git commit`/`git push`/PR creation without his explicit word. Every task ends at: tests green → type-check → lint → summary → STOP. No commit steps exist in this plan. Subagents MUST NOT run git commit/push under any circumstances.

**Goal:** Ship roboto-mem v1 — a TypeScript CLI (init / sync / digest / promote / lint / status) bundled single-file into a Claude Code plugin that syncs a git-based Team Memory into agent sessions.

**Architecture:** Thin CLI owns all plumbing (ADR 0003); plugin wraps it with a SessionStart hook and slash commands. Team Memory is a git repo of one-Entry-per-file markdown (ADR 0001), Commons + Overlays (ADR 0006), nothing enters unreviewed (ADR 0002). The CLI is bundled by tsdown into a committed `dist/cli.mjs` because git-installed plugins get no build step (ADR 0004). Digest = scope-filtered Standards in full + Lessons as index; stale-cache fallback on format-version skew (ADR 0005).

**Tech Stack:** Node ≥20, ESM only, TypeScript strict, citty (CLI), yaml, tinyglobby (runtime deps — all bundled); tsdown (build), vitest 4 + @vitest/coverage-v8 (tests, 80% thresholds), Biome (lint/format), pnpm. `git`/`gh` invoked as subprocesses via one typed wrapper.

**Coding rules that bind every task** (from Hrithik's global standards):
- `const` only — `let`/`var` forbidden. Restructure with early returns, ternaries, `??`, reduce/map.
- Discriminated unions keyed on `ok: boolean` for fallible operations. Expected errors return unions; only unexpected errors throw.
- `interface` for object shapes, `type` for unions. No verbose guards (`if (!x)` over `if (x === null)`); narrow at boundaries.
- No `console.*` in library code — commands receive output via return values; only `src/cli.ts` prints.
- Files < 400 lines, functions < 50. Tests use real temp dirs and real local git repos (no memfs, no mock data theater).

---

## File structure

```
roboto-mem/
├── .claude-plugin/
│   ├── plugin.json                 # plugin manifest (Task 17)
│   └── marketplace.json            # self-marketplace (Task 17)
├── hooks/hooks.json                # SessionStart → node dist/cli.mjs digest --hook (Task 17)
├── commands/                       # /promote, /mem-sync, /mem-status (Task 17)
├── templates/                      # commons scaffold files used by init --commons (Task 5)
├── src/
│   ├── cli.ts                      # citty wiring only (Task 15)
│   ├── commands/                   # one file per subcommand, returns CommandResult
│   │   ├── init.ts (5) sync.ts (9) digest.ts (9) promote.ts (12) lint.ts (13) status.ts (14)
│   ├── core/
│   │   ├── entry.ts (1)            # Entry parse/serialize + types
│   │   ├── scopes.ts (2)           # scope grammar + matching
│   │   ├── config.ts (3)           # .roboto-mem.json load/save/version-gate
│   │   ├── detect.ts (4)           # monorepo-aware stack detection
│   │   ├── exec.ts (6)             # typed subprocess wrapper (git/gh)
│   │   ├── memory-repo.ts (7)      # clone/pull/load entries/format-version gate
│   │   ├── digest.ts (8)           # pure digest compilation + override resolution
│   │   ├── cache.ts (8)            # last-good digest cache
│   │   ├── dedupe.ts (10)          # lexical similarity
│   │   ├── scan.ts (11)            # secret/PII regex pack
│   │   └── update-check.ts (16)    # throttled version nag
├── tests/                          # mirrors src/, *.test.ts; tests/helpers/git.ts fixture builders
├── dist/cli.mjs                    # COMMITTED build artifact (git-installed plugins have no build step)
├── package.json tsconfig.json tsdown.config.ts vitest.config.ts biome.json .gitignore
```

**Two repos at runtime, one repo here.** This repo is the tool. A team's memory lives in a separate repo (the Commons) that `init --commons` scaffolds and tests fixture with real local bare repos.

---

## Shared contracts (defined once, used everywhere)

```ts
// src/core/entry.ts
export interface Entry {
  name: string;                 // kebab-case slug, unique within scope
  description: string;          // one-liner used in the Lesson index
  type: "standard" | "lesson";
  scope: string;                // derived from FILE PATH, e.g. "org", "squad/web", "stack/sanity", "project/loggle"
  author: string;
  date: string;                 // YYYY-MM-DD
  overrides?: string;           // "<scope>/<name>" of the broader Standard this one overrides
  body: string;                 // markdown after frontmatter
  file: string;                 // path relative to memory repo root
}
export type EntryResult = { ok: true; entry: Entry } | { ok: false; file: string; error: string };

// src/core/config.ts
export interface RepoConfig {
  configVersion: 1;
  commons: string;              // git URL
  overlays: string[];           // git URLs, composed after commons
  project: string;              // project scope id
  squads: string[];             // squad scope ids this repo belongs to
  workspaces: Record<string, string[]>;  // "." | "apps/web" → ["stack/nextjs", ...]
}
export type ConfigResult =
  | { ok: true; config: RepoConfig }
  | { ok: false; reason: "missing" | "invalid" | "newer-config"; detail: string };

// src/core/exec.ts
export type ExecResult = { ok: true; stdout: string } | { ok: false; code: number; stderr: string };

// src/commands/* all return:
export interface CommandResult { exitCode: number; output: string }   // src/core/types.ts
```

**Memory repo (Commons/Overlay) format v1:**

```
<memory-repo>/
├── memory.json                  # { "formatVersion": 1, "budgets": { "default": 2000, "org": 4000 } }
├── CODEOWNERS
├── .github/workflows/memory-ci.yml
└── entries/
    ├── org/<name>.md
    ├── squads/<squad>/<name>.md
    ├── stacks/<stack>/<name>.md
    └── projects/<project>/<name>.md
```

Entry file shape (scope comes from the path, never from frontmatter — lint enforces):

```markdown
---
description: Never use `let`; const everything, restructure instead
type: standard
author: hrithik
date: 2026-06-12
---
Use `const` for every binding. If you reach for `let`, restructure: early returns,
ternary, `??`, reduce/map, or a helper returning the value.
```

`name` = filename without `.md`. Frontmatter `overrides: org/<name>` is the declared Override.

**Digest output shape (what agents receive):**

```markdown
# Team Memory (roboto-mem v1.0.0 · format 1 · synced 2026-06-12)

## Standards
### [org] never-use-let
Use `const` for every binding. ...
### [squad/web] let-in-perf-hotpaths — overrides org/never-use-let
...
> org/never-use-let is overridden for this repo by squad/web/let-in-perf-hotpaths.

## Lessons (read the file before relying on one)
- [stack/sanity] typegen-flag-breaks-client — TypeGen v3 flag breaks our client wrapper (entries/stacks/sanity/typegen-flag-breaks-client.md, 2026-05-30)
```

In `--hook` mode this string is wrapped as
`{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"<digest>"}}` on stdout.

---

### Task 0: Toolchain scaffold

**Files:** Create `package.json`, `tsconfig.json`, `tsdown.config.ts`, `vitest.config.ts`, `biome.json`, `.gitignore`, `src/core/types.ts`, `tests/smoke.test.ts`

- [ ] **Step 0.1** Write `package.json`:

```json
{
  "name": "roboto-mem",
  "version": "0.1.0",
  "description": "Team Memory sync for Claude Code — git-backed knowledge base injected into agent sessions",
  "type": "module",
  "bin": { "roboto-mem": "./dist/cli.mjs" },
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsdown",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit",
    "lint": "biome check src tests",
    "lint:fix": "biome check --write src tests"
  },
  "dependencies": { "citty": "^0.1.6", "tinyglobby": "^0.2.10", "yaml": "^2.6.0" },
  "devDependencies": {
    "@biomejs/biome": "^2.0.0",
    "@types/node": "^20.17.0",
    "@vitest/coverage-v8": "^4.0.0",
    "tsdown": "^0.12.0",
    "typescript": "^5.8.0",
    "vitest": "^4.0.0"
  }
}
```

- [ ] **Step 0.2** Run `pnpm install`. Then verify tsdown's real option names before writing config: `cat node_modules/tsdown/dist/*.d.*ts | grep -E "shebang|banner|external" | head -20` (research flagged `shebang` vs `banner` as uncertain; use whichever exists, goal = `#!/usr/bin/env node` on dist/cli.mjs).
- [ ] **Step 0.3** Write `tsconfig.json` (strict, NodeNext, noEmit — tsdown owns emit), `tsdown.config.ts` (entry `src/cli.ts`, format esm, platform node, target node20, outDir dist, output file cli.mjs, dts false, no externals so all deps bundle), `vitest.config.ts` (include `tests/**/*.test.ts`, environment node, coverage v8 over `src/**` excluding `src/cli.ts`, thresholds 80 on lines/functions/branches/statements), `biome.json` (recommended rules + `noVar: "error"`, `useConst: "error"`, organize imports on).
- [ ] **Step 0.4** Write `.gitignore`: `node_modules/`, `coverage/`, `*.tsbuildinfo`, `.roboto-mem-home/` — **dist/ is NOT ignored** (committed artifact, see header note in file: `# dist/ is committed on purpose: git-installed plugins have no build step`).
- [ ] **Step 0.5** Write `src/core/types.ts` with `CommandResult` (above) and `tests/smoke.test.ts` asserting `typeof {exitCode:0,output:""} === "object"` just to prove the pipeline.
- [ ] **Step 0.6** Verify: `pnpm typecheck && pnpm lint && pnpm test` all pass; `pnpm build` emits `dist/cli.mjs`. STOP — no commit.

### Task 1: `core/entry.ts` — parse/serialize Entries

**Files:** Create `src/core/entry.ts`, `tests/core/entry.test.ts`

- [ ] **Step 1.1** Write failing tests covering this table (use inline fixture strings):

| case | input | expect |
|---|---|---|
| valid lesson | well-formed frontmatter at `entries/stacks/sanity/typegen.md` | `ok:true`, scope `stack/sanity`, name `typegen` |
| valid org standard | path `entries/org/never-use-let.md` | scope `org`, type `standard` |
| squad + overrides | path `entries/squads/web/let-hotpaths.md`, frontmatter `overrides: org/never-use-let` | `entry.overrides === "org/never-use-let"` |
| missing description | no description field | `ok:false`, error names the field and file |
| bad type | `type: rule` | `ok:false` |
| bad date | `date: yesterday` | `ok:false` (must match `/^\d{4}-\d{2}-\d{2}$/`) |
| path/scope grammar | `entries/weird/x.md` | `ok:false` (unknown scope dir) |
| serialize roundtrip | `serializeEntry(parseEntry(s).entry)` | parses back equal |

API: `parseEntry(raw: string, file: string): EntryResult`, `serializeEntry(e: Entry): string`, `scopeFromPath(file: string): string | undefined` (maps `entries/org/*`→`org`, `entries/squads/<s>/*`→`squad/<s>`, `entries/stacks/<k>/*`→`stack/<k>`, `entries/projects/<p>/*`→`project/<p>`). Frontmatter split: first `---\n...\n---\n` block, `YAML.parse` (yaml pkg), validate fields manually (no zod — keep bundle thin).
- [ ] **Step 1.2** Run tests — all fail (module missing).
- [ ] **Step 1.3** Implement minimal `entry.ts` (~120 lines).
- [ ] **Step 1.4** Tests green. `pnpm typecheck && pnpm lint`. STOP.

### Task 2: `core/scopes.ts` — scope grammar + session matching

**Files:** Create `src/core/scopes.ts`, `tests/core/scopes.test.ts`

- [ ] **Step 2.1** Failing tests: `isValidScope` accepts `org`, `squad/web`, `stack/nextjs`, `project/loggle`; rejects `team`, `squad/`, `org/x`. `sessionScopes(config)` returns ordered unique list: `org` + `squad/*` from config.squads + union of stack scopes across config.workspaces + `project/<config.project>`. `entryApplies(entryScope, sessionScopes)` exact-match only.
- [ ] **Step 2.2** Implement (pure functions, ~50 lines). Green + typecheck + lint. STOP.

### Task 3: `core/config.ts` — `.roboto-mem.json`

**Files:** Create `src/core/config.ts`, `tests/core/config.test.ts`

- [ ] **Step 3.1** Failing tests (real temp dirs via `fs.mkdtemp(path.join(os.tmpdir(), "rm-"))`): missing file → `{ok:false, reason:"missing"}`; invalid JSON → `"invalid"`; `configVersion: 2` → `"newer-config"` with detail telling the user to upgrade roboto-mem (ADR 0005 forward-skew); valid file roundtrips through `saveConfig`/`loadConfig`; unknown extra keys preserved on save (forward-friendly).
- [ ] **Step 3.2** Implement: `loadConfig(dir): Promise<ConfigResult>`, `saveConfig(dir, config)`. Constant `CONFIG_VERSION = 1`, `CONFIG_FILE = ".roboto-mem.json"`. Green + checks. STOP.

### Task 4: `core/detect.ts` — monorepo-aware stack detection

**Files:** Create `src/core/detect.ts`, `tests/core/detect.test.ts`

- [ ] **Step 4.1** Failing tests build real fixture trees in temp dirs:
  - single-repo: `package.json` deps `{next, react}` → `{".": ["stack/nextjs","stack/react"]}`
  - pnpm monorepo: `pnpm-workspace.yaml` packages `["apps/*","packages/*"]`; `apps/web` (next), `apps/studio` (sanity dep + `sanity.config.ts`), `packages/ui` (react) → per-workspace map with all three keys
  - npm workspaces field works the same
  - config-file signal beats missing dep: `astro.config.mjs` with no astro dep still → `stack/astro`
  - dedupes: react listed once per workspace even if multiple signals
- [ ] **Step 4.2** Implement `detectWorkspaces(root): Promise<Record<string, string[]>>`. Workspace globs resolved with tinyglobby (`onlyFiles: false` on dir patterns; read each `<ws>/package.json`). Detection table (single const):

```ts
const STACK_SIGNALS: ReadonlyArray<{ stack: string; deps?: string[]; files?: string[] }> = [
  { stack: "nextjs",  deps: ["next"],                 files: ["next.config.js","next.config.ts","next.config.mjs"] },
  { stack: "react",   deps: ["react"] },
  { stack: "sanity",  deps: ["sanity","@sanity/client"], files: ["sanity.config.ts","sanity.config.js"] },
  { stack: "shopify", deps: ["@shopify/hydrogen","@shopify/shopify-api"] },
  { stack: "astro",   deps: ["astro"],                files: ["astro.config.mjs","astro.config.ts"] },
  { stack: "remix",   deps: ["@remix-run/node","react-router"] },
  { stack: "vue",     deps: ["vue","nuxt"] },
  { stack: "node",    deps: [] },   // never auto-added; placeholder documenting the table is extensible
];
```

  deps check = dependencies ∪ devDependencies. Green + checks. STOP.

### Task 5: `commands/init.ts` + commons templates

**Files:** Create `src/commands/init.ts`, `templates/commons/{memory.json,CODEOWNERS,README.md,workflows-memory-ci.yml}`, `tests/commands/init.test.ts`

- [ ] **Step 5.1** Failing tests:
  - `runInit({ dir, commonsUrl: "git@...", project: "loggle", squads: ["web"] })` writes `.roboto-mem.json` with detected workspaces, returns `exitCode 0`, output lists detected scopes
  - re-run on existing config preserves `overlays` and unknown keys, refreshes `workspaces`
  - `runInit({ dir, scaffoldCommons: true })` creates `memory.json` (formatVersion 1, budgets default 2000/org 4000), `entries/{org,squads,stacks,projects}/.gitkeep`, `CODEOWNERS` template, `README.md`, `.github/workflows/memory-ci.yml`
- [ ] **Step 5.2** Templates are real files under `templates/commons/` copied verbatim (CI workflow runs `npx -y github:<plugin-repo> lint` — placeholder org noted in README; CODEOWNERS template shows `entries/org/ @your-org/standards-group` pattern per ADR 0002 tiering).
- [ ] **Step 5.3** Implement; templates resolved relative to `import.meta.url` (works both from src in tests and bundled dist — tsdown copy: add `templates/**` to a `copy` option if supported, else read via `new URL("../../templates/...", import.meta.url)` with dist fallback path; verify against installed tsdown in Step 0.2 and choose ONE mechanism). Green + checks. STOP.

### Task 6: `core/exec.ts` — subprocess wrapper

**Files:** Create `src/core/exec.ts`, `tests/core/exec.test.ts`

- [ ] **Step 6.1** Failing tests: `exec("echo", ["hi"])` → `{ok:true, stdout:"hi"}`; nonzero exit → `{ok:false, code, stderr}`; timeout option kills and returns `ok:false`; `cwd` honored.
- [ ] **Step 6.2** Implement with `node:child_process` `execFile` promisified manually (no shell — array args only, no injection surface), default timeout 30_000. ~40 lines. Green + checks. STOP.

### Task 7: `core/memory-repo.ts` — clone/pull/load + format gate

**Files:** Create `src/core/memory-repo.ts`, `tests/core/memory-repo.test.ts`, `tests/helpers/git.ts`

- [ ] **Step 7.1** Write `tests/helpers/git.ts` first: `makeCommonsFixture(tmp)` creates a REAL bare repo (`git init --bare commons.git`), clones it, writes `memory.json` + sample entries (one org standard, one stack/sanity lesson, one squad/web standard with `overrides`), commits, pushes, returns `{ remoteUrl: "file://...", workdir }`. All git via Task 6 `exec`.
- [ ] **Step 7.2** Failing tests:
  - `ensureRepo(url, home)` clones into `<home>/repos/<sha256(url).slice(0,12)>` on first call; second call pulls (`git pull --ff-only`) and picks up a new entry pushed to the fixture
  - network-down simulation: point URL at a deleted path after clone → `ensureRepo` returns `{ok:true, stale:true}` (offline tolerance — last clone wins)
  - `loadMemory(dir)` → `{formatVersion, budgets, entries: Entry[], errors: EntryResult[]}` (invalid entry files collected as errors, not thrown)
  - `formatVersion: 2` in memory.json → `loadMemory` returns `{ok:false, reason:"newer-format"}` (ADR 0005)
  - HOME override: all paths derive from `ROBOTO_MEM_HOME` env when set (tests set it to tmp; default `~/.roboto-mem`)
- [ ] **Step 7.3** Implement. Entry discovery: tinyglobby `glob("entries/**/*.md", { cwd })`. Green + checks. STOP.

### Task 8: `core/digest.ts` + `core/cache.ts` — compilation

**Files:** Create `src/core/digest.ts`, `src/core/cache.ts`, `tests/core/digest.test.ts`

- [ ] **Step 8.1** Failing tests (pure — entries in, string out):
  - filters by `sessionScopes`: org standard in; `stack/shopify` lesson out for a sanity/nextjs config
  - Standards render full body under `### [scope] name`; Lessons render as one-line index `- [scope] name — description (file, date)`
  - Override resolution: overriding Standard renders with `— overrides org/<name>`; the overridden Standard's body is REPLACED by the single line `> org/<name> is overridden for this repo by <scope>/<name>.`; an `overrides` pointing at a nonexistent entry renders both plus `> WARNING: declared override target org/<x> not found.`
  - budget: `estimateTokens(s) = Math.ceil(s.length / 4)`; per-scope sections exceeding `budgets[scope] ?? budgets.default` append `> WARNING: scope <s> exceeds its budget (<n> > <cap> tokens). Prune or split entries.`
  - deterministic ordering: org → squads (alpha) → stacks (alpha) → project; entries alpha by name
  - header line contains tool version, formatVersion, synced date (passed in — no `Date.now()` inside compile; caller supplies)
  - `cache.ts`: `writeCache(home, project, digest)` / `readCache(home, project)` roundtrip; missing → undefined
- [ ] **Step 8.2** Implement `compileDigest(input: {entries, sessionScopes, budgets, meta: {toolVersion, formatVersion, syncedDate, nag?: string}}): string` and the two cache functions (cache file `<home>/cache/<sha256(projectPath)>.md`). Green + checks. STOP.

### Task 9: `commands/sync.ts` + `commands/digest.ts` — orchestration + hook mode

**Files:** Create `src/commands/sync.ts`, `src/commands/digest.ts`, `tests/commands/digest.test.ts`

- [ ] **Step 9.1** Failing tests (use git fixture from Task 7):
  - no `.roboto-mem.json` in cwd + `--hook` → `exitCode 0`, output empty string (silent no-op for non-memory repos)
  - no config without `--hook` → `exitCode 1`, output explains `roboto-mem init`
  - happy path: config pointing at fixture commons → output contains org standard body and sanity lesson index line; cache file written
  - `--hook` wraps in EXACT envelope: `JSON.parse(output).hookSpecificOutput.hookEventName === "SessionStart"` and `.additionalContext` contains the digest
  - newer-format commons (formatVersion 2): falls back to cached digest with prepended `> STALE: Team Memory uses format 2; this roboto-mem only knows 1. Run /mem-upgrade. Showing last-good digest from <date>.`; no cache → exitCode 0 (hook) with warning-only context
  - newer-config repo: same loud-but-alive behavior
  - sync failure offline: digest still produced from stale clone, header shows last synced date
- [ ] **Step 9.2** Implement `runSync` (ensureRepo on commons + each overlay; returns per-repo status) and `runDigest({cwd, hook, home})` composing: loadConfig → runSync → loadMemory (commons + overlays merged; overlay entries appended after commons) → sessionScopes → compileDigest → cache write → wrap if hook. JSON envelope via `JSON.stringify` (handles all escaping). Green + checks. STOP.

### Task 10: `core/dedupe.ts`

**Files:** Create `src/core/dedupe.ts`, `tests/core/dedupe.test.ts`

- [ ] **Step 10.1** Failing tests: `similarity("sanity typegen flag breaks client", "the sanity typegen flag breaks our client")` > 0.55; unrelated strings < 0.2; `findSimilar(draft, entries)` returns entries above 0.55 sorted desc, comparing on `name + " " + description + " " + body` lowercased, tokenized on `/[^a-z0-9]+/`, Jaccard over token sets; stopwords `the a an our we is are to of in for` removed.
- [ ] **Step 10.2** Implement (~40 lines, pure). Green + checks. STOP.

### Task 11: `core/scan.ts` — secret/PII scan

**Files:** Create `src/core/scan.ts`, `tests/core/scan.test.ts`

- [ ] **Step 11.1** Failing tests — flags: `AKIA[0-9A-Z]{16}` (AWS), `ghp_[A-Za-z0-9]{36}`/`github_pat_`, `sk-[A-Za-z0-9]{20,}` (API keys), `-----BEGIN ... PRIVATE KEY-----`, `(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"][^'"]{8,}` (assignment with literal), emails (`\S+@\S+\.\w+`) flagged as PII warning not error. Does NOT flag: the word "token" in prose, `process.env.API_KEY` references, `<your-api-key>` placeholders.
- [ ] **Step 11.2** Implement `scanEntry(text): { severity: "error" | "warning"; match: string; rule: string }[]` with redacted match preview (first 6 chars + `…`). Green + checks. STOP.

### Task 12: `commands/promote.ts`

**Files:** Create `src/commands/promote.ts`, `tests/commands/promote.test.ts`

- [ ] **Step 12.1** Failing tests (real fixture repos; gh stubbed):
  - `runPromote({cwd, home, scope:"stack/sanity", type:"lesson", name:"typegen-flag", description:"...", body:"...", author:"hrithik", date:"2026-06-12"})` → creates branch `promote/stack-sanity-typegen-flag` in the local commons clone, commits exactly one file `entries/stacks/sanity/typegen-flag.md`, pushes to the fixture remote (assert via `git ls-remote` on the bare repo), and calls gh: tests inject `ghRunner: (args) => ...` capturing `["pr","create","--title","promote(stack/sanity): typegen-flag",...]`; stub returns PR URL which appears in output
  - gh unavailable (`ghRunner` returns `ok:false`) → still pushes branch, output contains fallback compare URL `…/compare/main...promote/stack-sanity-typegen-flag` and exitCode 0
  - duplicate: entry similar (>0.55) to existing → exitCode 1, output names the existing entry and says `--force` to override; with `force: true` proceeds
  - secret in body (`ghp_` + 36 chars) → exitCode 1, redacted finding, NO branch created (assert ls-remote unchanged)
  - scope not in valid grammar → exitCode 1
  - name collision exact (same scope+name exists) → exitCode 1 suggesting editing the existing file
  - IMPORTANT test-isolation note: the push target is always the file:// fixture — promote never touches the network in tests
- [ ] **Step 12.2** Implement: validate → ensureRepo → loadMemory → exact-collision check → dedupe → scan → `git checkout -B` on temp worktree-safe branch → write file → `git add` → `git commit -m "promote(<scope>): <name>"` → `git push origin <branch>` → gh pr create (title `promote(<scope>): <name>`, body = description + provenance) with URL fallback. All git through exec wrapper; branch work in the CLI-owned clone under home (never the user's repo — promote commits to the MEMORY repo only, which is roboto-mem's own clone; this does not violate the no-commit rule because the human explicitly invoked promote and the slash command confirms first). Green + checks. STOP.

### Task 13: `commands/lint.ts`

**Files:** Create `src/commands/lint.ts`, `tests/commands/lint.test.ts`

- [ ] **Step 13.1** Failing tests on fixture memory repos: clean repo → exitCode 0, output `✓ <n> entries`. Broken fixtures each produce a finding line `<file>: <message>` and exitCode 1: invalid frontmatter; scope-dir/grammar mismatch; duplicate name within scope; `overrides` target missing; org standard body pushing org section over budget; secret hit (reuses scan).
- [ ] **Step 13.2** Implement `runLint({dir})` over a memory repo working copy (for commons CI). Green + checks. STOP.

### Task 14: `commands/status.ts`

**Files:** Create `src/commands/status.ts`, `tests/commands/status.test.ts`

- [ ] **Step 14.1** Failing tests: with config + synced fixture → output lists project, squads, workspace→scope map, entry counts per type, last-synced date, tool version; without config → exitCode 1 pointing at init.
- [ ] **Step 14.2** Implement (compose existing cores; no new logic). Green + checks. STOP.

### Task 15: `src/cli.ts` — citty wiring

**Files:** Create `src/cli.ts`, `tests/cli.test.ts`

- [ ] **Step 15.1** Failing test: import `main` and `runMain(main, { rawArgs: ["status"] })` in a temp cwd without config exits nonzero (capture via mocking `process.exit`? — simpler: subcommands are thin, so test `buildArgs` mapping per command instead; plus one smoke `node` spawn test AFTER build in Task 18).
- [ ] **Step 15.2** Implement: `defineCommand` main with meta `{name:"roboto-mem", version: VERSION}` and subCommands `{init, sync, digest, promote, lint, status}`; each subcommand maps citty args → `run*` call → `process.stdout.write(result.output)` + `process.exitCode = result.exitCode`. `VERSION` imported from `package.json` via `with { type: "json" }` import (bundles cleanly). Enum-ish args (`type`) validated manually (citty has no enum). Green + checks. STOP.

### Task 16: `core/update-check.ts` — throttled version nag

**Files:** Create `src/core/update-check.ts`, `tests/core/update-check.test.ts`, modify `src/commands/digest.ts` (wire `nag`)

- [ ] **Step 16.1** Failing tests: state file `<home>/state.json` `{lastUpdateCheck: ISO, latestSeen: "v0.2.0"}`; `checkForUpdate({home, repoUrl, currentVersion, now, lsRemote})` — injected `lsRemote` returns tag list; newer semver tag → nag string `roboto-mem v0.2.0 available (you have v0.1.0) — run /mem-upgrade`; checked < 24h ago (per injected `now`) → returns cached `latestSeen` without calling `lsRemote` (assert spy not called); `lsRemote` failure → undefined nag, no throw; equal/older versions → undefined.
- [ ] **Step 16.2** Implement (semver compare = split on `.`, numeric compare — no dep) + wire into `runDigest` meta.nag with everything injected (digest passes real `new Date()` and real ls-remote at the cli.ts boundary, NOT inside core — keeps cores pure/testable). Green + checks. STOP.

### Task 17: Plugin shell

**Files:** Create `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `hooks/hooks.json`, `commands/promote.md`, `commands/mem-sync.md`, `commands/mem-status.md`, `commands/mem-upgrade.md`, `README.md`

- [ ] **Step 17.1** `.claude-plugin/plugin.json` (exact ground-truth schema):

```json
{
  "name": "roboto-mem",
  "version": "0.1.0",
  "description": "Team Memory for Claude Code — git-backed Standards and Lessons synced into every session",
  "author": { "name": "Roboto" },
  "repository": "https://github.com/roboto-org/roboto-mem",
  "keywords": ["memory", "knowledge-base", "team", "standards"]
}
```

  `marketplace.json`: name `roboto-mem`, owner Roboto, plugins `[{ name: "roboto-mem", source: "./", version: "0.1.0", description: same }]` (repo doubles as its own marketplace). NOTE: repo URL is a placeholder until Hrithik confirms the GitHub org/name — flag in summary.
- [ ] **Step 17.2** `hooks/hooks.json`:

```json
{
  "description": "roboto-mem: inject Team Memory digest at session start",
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear",
        "hooks": [
          { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs\" digest --hook", "timeout": 60 }
        ]
      }
    ]
  }
}
```

  Do NOT also reference hooks in plugin.json (duplicate-hooks error per skill reference).
- [ ] **Step 17.3** Slash commands (frontmatter `description` + body instructions):
  - `promote.md`: instructs the agent to assemble scope/type/name/description/body from the conversation or a Personal Memory file, run `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs promote …` ONLY AFTER showing the drafted Entry and getting explicit user confirmation (it pushes a branch + opens a PR), then report the PR URL. Mention `--force` only when the user explicitly accepts a near-duplicate.
  - `mem-sync.md`: run `… sync` then `… status`, report what changed.
  - `mem-status.md`: run `… status`, summarize.
  - `mem-upgrade.md`: explain prompted-upgrade contract; instruct agent to run `claude plugin update roboto-mem` equivalent (or `/plugin` UI) — never silently.
- [ ] **Step 17.4** README.md: what it is (CONTEXT.md terms), install (`/plugin marketplace add <org>/roboto-mem` + install + the `.claude/settings.json` `extraKnownMarketplaces`/`enabledPlugins` snippet for team rollout), quickstart (scaffold commons, init a repo, promote first lesson), the trust contract (ADRs 0002/0005 in two sentences). STOP.

### Task 18: Build, bundle smoke, full verification

**Files:** Create `tests/integration/e2e.test.ts`; build artifact `dist/cli.mjs`

- [ ] **Step 18.1** Integration test (real everything, tmp HOME): scaffold commons fixture → `runInit` on a fixture nextjs+sanity monorepo project → `runDigest({hook:true})` → assert envelope parses, contains org standard + sanity lesson, excludes shopify entry → push a new commons entry → second digest picks it up (sync works) → `runPromote` lands a branch on the bare remote.
- [ ] **Step 18.2** `pnpm build`; smoke: `node dist/cli.mjs --help` lists all six subcommands; `node dist/cli.mjs digest --hook` in a configless tmp dir exits 0 with empty output; `head -1 dist/cli.mjs` is the node shebang; `ls dist/` is a single file (+sourcemap ok).
- [ ] **Step 18.3** Full gate: `pnpm test:coverage` ≥80% all four metrics; `pnpm typecheck`; `pnpm lint`. Fix anything. STOP — summarize for Hrithik; commits are his call.

### Task 19: Post-build review pass

- [ ] **Step 19.1** Dispatch code-reviewer agent over the full diff (correctness, his standards: no `let`, unions, file size, error handling). Address CRITICAL/HIGH.
- [ ] **Step 19.2** Run /simplify pass per Hrithik's writing practices (reuse, altitude, dead code). Re-run full gate after any change. STOP.

---

## Self-review (done at write time)

- Spec coverage: ADR 0001 (git substrate — Tasks 7/9/12), 0002 (review gate — promote opens PRs only, lint guards CI, CODEOWNERS template), 0003 (CLI+plugin split — Tasks 15/17), 0004 (single committed artifact — Tasks 0/18), 0005 (stale fallback + nag + version gates — Tasks 3/8/9/16), 0006 (overlays composed — Tasks 9; overlay overrides intentionally deferred, documented OPEN), scoping/monorepo (Task 4), dedupe+budget guards (Tasks 8/10/12), secret scan (Task 11). v1 cut respected: no semantic search, no capture-time nudge, no telemetry.
- Known deferrals: `migrate` command (no v2 schemas exist yet — YAGNI), Overlay-overrides-Commons review flow (open per grilling), npm publish (post-v1).
- Type consistency: `CommandResult`/`EntryResult`/`ConfigResult`/`ExecResult` defined once in shared contracts; all task signatures reference them.
- Placeholder scan: every step has concrete code, tables, or exact behaviors; the one intentional placeholder (GitHub org in URLs) is flagged for Hrithik.
