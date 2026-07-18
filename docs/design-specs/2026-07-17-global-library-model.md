# roboto-mem Global Library Model — Design Spec (Final + Iron Clad)

**Status:** Final Review Passed, Iron Clad, Ready for Implementation | **Date:** 2026-07-17 | **Author:** Hrithik + Fable Review (5 passes)

## Goals

1. **One team memory** — libraries are shared, team-curated, not per-project
2. **User skill precedence** — personal skills override team libraries without conflict
3. **Low friction onboarding** — auto-detect libraries on init; user reviews and confirms
4. **Team curation via PR review** — libraries sync to commons; nothing enters unreviewed
5. **Dynamic, scoped loading** — load only libraries + global entries declared per-project
6. **Backwards-compatible migration** — existing projects migrate cleanly to new schema; old CLIs degrade gracefully

## Mental Model

**Three layers of precedence** (in order):
1. User skill (`~/.claude/skills/{lib}/SKILL.md` authored by user, not materialized from commons)
2. Team library (`~/.roboto-mem/libraries/{lib}/LIBRARY.md` synced from commons)
3. Fallback — nothing loads if both 1 and 2 absent

**Collision handling:**
- If both `~/.claude/skills/resend/SKILL.md` (user) and `~/.roboto-mem/libraries/resend/LIBRARY.md` (team) exist, user skill fully replaces team library in digest
- Team-materialized skills (`commons/skills/resend/ → ~/.claude/skills/resend/` via `materializeSkills`) are treated as layer 1 (user's copy) for precedence; they suppress team libraries of the same name
- No merging; one wins cleanly

**Default behavior (no `.roboto-mem.json`):**
- No libraries auto-load
- User must create `.roboto-mem.json` to opt-in to team libraries
- Prevents surprise library injection into random directories
- Matches SessionStart semantics: missing config = silent

**Entry scoping** (replaces project/squad hierarchy):
- **Untagged entries** (`entries/decision-framework.md` with no `scope:` frontmatter) → always load (org-wide guidance, standards, decisions)
- **Library-scoped entries** (`entries/resend-email-templates.md` with `scope: library:resend` frontmatter) → load only if project declares that library
- Existing v1 entries migrate: `entries/stacks/next/...` → `entries/.../` with `scope: library:next`; `entries/squads/auth/...` → `entries/.../` with `scope: library:auth` (squad name becomes library tag verbatim; team adjusts mapping in PR review); `entries/projects/my-app/...` → untagged (org-wide); `entries/org/...` → untagged
- Scope frontmatter grammar: `scope: library:{name}` (one only, no multiple tags per entry)
- Frontmatter is required (contains `description/type/author/date`); only the `scope:` key is optional (absent scope = global)

## Directory Structure

### Local

```
~/.roboto-mem/
├── libraries/
│   ├── resend/
│   │   ├── LIBRARY.md          ← 200–300 tokens (summary + paths)
│   │   ├── docs/
│   │   └── examples/
│   ├── next/
│   ├── auth0/
│   └── ...
└── repos/
    ├── abc123def456/           ← sha12(commons-url)
    │   ├── entries/
    │   │   ├── stacks/next/...         ← migrated to frontmatter; removed during v1→v2
    │   │   ├── squads/auth/...         ← migrated to frontmatter; removed during v1→v2
    │   │   ├── projects/my-app/...     ← migrated to untagged; removed during v1→v2
    │   │   ├── org/...                 ← migrated to untagged; removed during v1→v2
    │   ├── libraries/
    │   │   ├── resend/
    │   │   ├── next/
    │   │   └── ...
    │   ├── skills/
    │   ├── CHANGELOG.md
    │   ├── FORMAT_VERSION              ← version of commons schema
    │   └── memory.json
    └── (only one commons per project; multiple projects on same machine have different URLs)

~/.config/roboto-mem/
└── config.json          ← global defaults (init only)
```

**One commons per project rule:** enforced by `.roboto-mem.json` config having a single `commons` string field. Multiple projects can bind different commons (stored in separate `repos/<hash>/` dirs), but each project has exactly one.

Old `org/project/squads/` directory hierarchy is removed. `stacks/*`, `squads/*`, `projects/*` entry scopes become `library:*` or untagged.

### Commons Repository Format

```
commons/
├── FORMAT_VERSION               ← plain text file; contains: "2"
├── libraries/
│   ├── resend/
│   │   ├── LIBRARY.md
│   │   ├── docs/
│   │   └── examples/
│   ├── next/
│   │   ├── LIBRARY.md
│   │   ├── docs/
│   │   └── examples/
│   └── ...
├── entries/
│   ├── decision-framework.md    ← frontmatter with no `scope:` key (global)
│   ├── resend-email-templates.md ← frontmatter: scope: library:resend
│   ├── auth-patterns.md         ← frontmatter: scope: library:auth0
│   └── ...
├── skills/
│   └── ...
├── CONTEXT.md
├── CODEOWNERS
├── CHANGELOG.md
├── memory.json                   ← formatVersion: 2 (bumped on migration)
└── memory.json.old              ← archived v1 (optional, for audit)
```

**Entry frontmatter** (YAML, at top of file):
```markdown
---
description: "Email templates for Resend"
type: template
author: team
date: 2026-07-17
scope: library:resend
---
# Email Template Library (Resend)
...
```

Frontmatter is required (all entries must have at least `description/type/author/date`). The `scope:` key is optional; absent `scope:` = global entry. Old entries with path-based scopes (`entries/squads/auth/...`) must be retagged to frontmatter during migration.

## Configuration

### Global Defaults

File: `~/.config/roboto-mem/config.json`

```json
{
  "commons": "https://github.com/team/commons"
}
```

Consumed **only by** `roboto-mem init` as suggested defaults. Does NOT apply to projects without `.roboto-mem.json`.

**Behavior at init:**
- If no global config exists, prompt user for commons URL
- If global config exists, use as default suggestion (user can override)
- Init does NOT write back to global config (only reads it)

### Project-Level Config

File: `.roboto-mem.json` in project root

```json
{
  "configVersion": 2,
  "commons": "https://github.com/team/commons",
  "libraries": [
    "resend",
    "next",
    "auth0"
  ]
}
```

**Schema rules (v2):**
- `configVersion`: must be 2 (number)
- `commons`: required, must be a string (single URL)
- `libraries`: optional, must be array of strings (library names)
- Unknown v1 fields (`project`, `squads`, `workspaces`, `overlays`) are validation errors; reject with message "Config format v1 is deprecated. Run: `roboto-mem migrate` to upgrade."

**Separate error for v2+stray-fields:**
- If `configVersion: 2` with v1 fields present (hand-edited config): error "Config has legacy fields (project, squads, workspaces, overlays). Remove them or run `roboto-mem migrate` to clean up."

**Precedence:**
1. Project `.roboto-mem.json` (if present) — binds libraries + commons
2. Global `~/.config/roboto-mem/config.json` (init only) — suggested values
3. No libraries — silent (no auto-activation)

## Library Detection & Init Flow

### roboto-mem init (interactive, TTY-only)

**Step-by-step:**

1. Check if `.roboto-mem.json` already exists
   - If yes: error "Config already exists. Run `roboto-mem update-libraries` to refresh."
   - If no: continue

2. Prompt for commons URL (if no global config; else use global as default)
   - Accept user input or default to global
   - Validate: must be git-clone-able; attempt test clone if not cached

3. Clone/pull commons (if not cached)
   - Check `~/.roboto-mem/repos/<sha12(url)>/` (reuse shipped `repoDirFor`)
   - If cached and <24h old (check via `.git/FETCH_HEAD` mtime): reuse
   - If not cached or >24h old: git clone/pull
   - If pull fails: error "Cannot reach commons; check network and URL"

4. List available libraries from `commons/libraries/`
   - Enumerate directory; each subdir is a library
   - Error if `commons/libraries/` doesn't exist: "Commons has no libraries. Team must create v2-format commons."

5. Scan `package.json` (root only, npm-only for v1)
   - If no `package.json`: skip detection, offer empty config (user manually adds libraries)
   - If found: extract `dependencies` + `devDependencies` keys
   - **Dependency-to-library matching rule:** Exact string intersection only
     - `resend` in deps + `resend` in commons → match
     - `@auth0/nextjs-auth0` in deps: check hardcoded alias table (e.g., `@auth0/*` → `auth0`); if no alias, skip with warn "⚠️ Couldn't map @auth0/nextjs-auth0 to a known library; add manually if needed"
   - Hardcoded alias table (v1 bootstrap): `{@auth0: auth0, @sanity: sanity, @shopify: shopify, ...}` (extensible in Phase 3)
   - (Do NOT adopt STACK_SIGNALS; it outputs stack names (`nextjs`, not `next`) and lacks Resend/Auth0)

6. Intersect: `package.json` deps ∩ available libraries
   - Result is a list of matching library names

7. Show user with confirmation
   ```
   Available in commons: resend, next, auth0, sanity, ...
   Detected in your deps: resend, next
   Load these libraries? (y/n)
   [If y]: Add more? (comma-separated names, or press enter)
   [If y]: Remove any? (comma-separated names, or press enter)
   ```

8. User can add/remove before writing `.roboto-mem.json`

9. Write `.roboto-mem.json` with chosen libraries

10. **Sync libraries locally:**
    - Run `roboto-mem sync` to populate `~/.roboto-mem/libraries/` cache
    - Suppress confirm prompt in init context (auto-pull silently)
    - If sync fails (exit 2): warn but don't block init completion (libraries will be empty until user runs `sync` manually)

11. **Non-TTY (CI):** error "Init requires TTY. Pre-write .roboto-mem.json and run `roboto-mem sync`." (exit code 1)

**Exit codes:**
- 0: config written and libraries synced (or sync deferred if network error)
- 1: fatal error (not TTY, unreachable commons, invalid URL)

### roboto-mem update-libraries (new command)

Re-scan `package.json` and compare against declared libraries in `.roboto-mem.json`.

```bash
roboto-mem update-libraries
# Comparing package.json vs .roboto-mem.json...
# In package.json, not in config:
#   + auth0
# In config, not in package.json:
#   - sanity (still declared, but removed from deps)
# Update config? (y/n)
```

**Behavior:**
- If `.roboto-mem.json` missing: error
- If `package.json` missing: warn "No package.json; skipping detection" (exit 0, no changes)
- TTY: prompt user for each suggested add/remove (y/n per library)
- Non-TTY: list differences and exit 0 (no changes)
- Write updated `.roboto-mem.json` only if user confirms

**Exit codes:**
- 0: success (config updated, or no changes)
- 1: fatal error (missing config)

**Important:** If user *removed* a library at init while it remains in `package.json` deps, `update-libraries` will re-suggest it every run. This is by design — no "ignored" list in v1 (punted to v2+). Document as known limitation.

## Library Loading & Token Budget

### What gets injected into digest

**Per declared library:**
- **LIBRARY.md only** — the summary/overview (~200–300 tokens)
- **Path references** — "For examples, see `~/.roboto-mem/libraries/resend/examples/`"
- User can manually read `docs/` or `examples/` directories as needed

**Global entries (untagged):**
- Always injected, counted toward 1000t total

**Library-scoped entries:**
- Injected only if library declared in config, counted toward 1000t total

### Token budgets (enforced by digest compiler)

**Per-library:**
- Soft warn if LIBRARY.md exceeds 300 tokens (logged as "⚠️ library:resend (412 tokens) exceeds 300-token target")
- File still fully injected (not truncated)

**Total (libraries + all entries):**
- Hard ceiling: **1000 tokens max** for combined library summaries + untagged entries + library-scoped entries
- **Drop algorithm:** if total exceeds 1000t:
  1. Drop declared libraries in reverse-config-order (last declared drops first)
  2. Drop library-scoped entries by their associated library (in reverse-config-order)
  3. Drop untagged entries last
  4. Drop notification: "⚠️ Dropping library:sanity (would exceed 1000-token limit); retained: resend, next, auth0"

**Token estimator:**
- `ceil(utf8_length / 4)` (shipped `estimateTokens` pattern)

**memory.json v2 budget schema** (add to `memory.json`):
```json
{
  "budgets": {
    "defaultTotal": 2000,
    "libraryMax": 1000
  }
}
```
(Note: `libraryMax` replaces per-scope budgets; defines the ceiling for all library + entry injection combined)

### Loading mechanism at SessionStart

1. Digest hook runs (same as today)
2. Hook does NOT call `syncRepos` (git pull) or `materializeSkills` (moved to manual `roboto-mem sync`)
3. Hook loads declared libraries from **cached** `~/.roboto-mem/libraries/{lib}/LIBRARY.md` (no remote fetch)
4. If cache is stale or missing: use fallback (skip library, don't nag)
5. Load untagged entries (always)
6. Filter library-scoped entries by declared libraries
7. Render into digest buffer

**Performance target:** <500ms (cached file reads + frontmatter parsing, no I/O wait)

## Sync & Promotion

### roboto-mem sync (pull libraries + entries, materialize skills)

**Step-by-step:**

1. Check if `.roboto-mem.json` exists (required)
   - If missing: error "No config found. Run `roboto-mem init` first." (exit 1)

2. Clone/pull commons repo to `~/.roboto-mem/repos/<sha12(url)>/`
   - If pull fails: error "Cannot sync commons; check network and auth" (exit 1)

3. Copy `commons/libraries/<lib>/` → `~/.roboto-mem/libraries/<lib>/` for all declared libraries
   - **Collision rule (overwrite-after-confirm):** Always pull latest from commons after user confirms diffs
   - TTY: show git-diff summary per library; prompt "Continue? (y/n)"
   - Non-TTY: silently proceed (auto-pull)
   - If file exists locally, overwrite (user edits should go in `~/.claude/skills/` instead, precedence layer 1)

4. **Materialize team skills from `commons/skills/` → `~/.claude/skills/`** (reuse shipped `materializeSkills`)
   - Report restored/failed skills
   - Errors are non-fatal; continue

5. Write sync timestamp to cache metadata (e.g., `.git/FETCH_HEAD` mtime)

**Exit codes:**
- 0: success (sync complete, all libraries + skills updated)
- 1: fatal error (missing config, cannot reach commons, commons format mismatch)
- 2: partial failure (some libraries synced, others failed, or skills partially restored); still usable

### roboto-mem promote library <library-name> (push library to commons via PR)

**Command:** `roboto-mem promote library <library-name>`

(Distinct from existing `roboto-mem promote <entry>` and `roboto-mem skill promote <skill>`. CLI routing: `promote <entry>` for entries, `promote library <lib>` for libraries, `skill promote <skill>` for skills. The `library` subcommand disambiguates from existing promote without collision.)

**Step-by-step:**

1. Validate library exists in `~/.roboto-mem/libraries/<lib>/`

2. Stage directory as a commit:
   - Hash contents of `LIBRARY.md`, `docs/`, `examples/` (tree hash)
   - Create commit message: `"chore: promote library {lib}"\n\n<dir hash>`

3. Create PR in commons (use `runSkillPromote` PR flow from `src/commands/skill.ts`)
   - Title: `"chore: promote library {lib}"`
   - Body: show what's changing (diff from last synced version, or new)
   - Assignee: team lead (via CODEOWNERS)

4. Output PR URL: "PR: https://github.com/team/commons/pull/NNN"

5. On merge: library is available to all projects on next `roboto-mem sync`

**Exit codes:**
- 0: PR created successfully
- 1: fatal error (library not found, missing config, no git/auth, commons not reachable)

**Review gate:** Nothing enters commons unreviewed (CONTEXT.md invariant).

## Migration: configVersion 1 → 2

### New CLI behavior reading v1 config

When a new CLI encounters `configVersion: 1` or unknown v1 fields (`project`, `squads`, etc.), it:
1. Prints error: "Config format v1 is deprecated. Run: `roboto-mem migrate` to upgrade."
2. Exits with code 1 (failure)
3. Does NOT attempt to load or run in legacy mode

**Separate error for v2+stray-fields** (hand-edited config with legacy fields):
1. Prints error: "Config has legacy fields (project, squads, workspaces, overlays). Remove them or run `roboto-mem migrate` to clean up."
2. Exits with code 1
3. No execution

### roboto-mem migrate (per-project, idempotent)

Run from project directory to migrate old config to new schema.

```bash
cd my-app
roboto-mem migrate
# Found .roboto-mem.json with configVersion 1
# Migrating...
# 
# Transformation:
#   commons: (kept as string)
#   project, squads, workspaces, overlays: (removed)
#   libraries: (auto-detected from workspaces stack values)
# 
# New config:
# {
#   "configVersion": 2,
#   "commons": "https://github.com/team/commons",
#   "libraries": ["next", "auth0"]
# }
# 
# Commit migration? (y/n)
```

**Config transformation:**

Old config:
```json
{
  "configVersion": 1,
  "commons": "https://github.com/team/commons",
  "project": "my-app",
  "squads": ["auth"],
  "overlays": ["../shared-overlays"],
  "workspaces": {
    "apps/web": ["next", "react"],
    "apps/api": ["auth0", "nodejs"]
  }
}
```

New config (generated):
```json
{
  "configVersion": 2,
  "commons": "https://github.com/team/commons",
  "libraries": ["next", "auth0"]
}
```

**Seed libraries from workspaces (lossless):**
- `workspaces` field maps workspace dirs to stack arrays: `{dir: [stacks]}`
- Migrate reads the stack arrays directly (e.g., `["next", "react"]` from `apps/web`)
- Union all stacks from all workspaces into `libraries` array (deduped)
- E.g., if `apps/web` has `["next", "react"]` and `apps/api` has `["auth0", "nodejs"]`, result is `["next", "react", "auth0", "nodejs"]` (filtered to commons-available libs)

**What gets dropped:**
- `project`, `squads`, `overlays` — removed (entry scopes migrate at commons-side, below)

**Idempotent:**
- If `.roboto-mem.json` already has `configVersion: 2`, migrate is a no-op (exit 0, print "Already migrated")

**Non-TTY:**
- No confirmation prompt; migrate silently and exit 0

**Exit codes:**
- 0: migration successful or already migrated (v2 config found = no-op)
- 1: fatal error (missing config, workspaces not readable)

**Ordering:** Project-side migrate can run *before* commons migration. Libraries are seeded from workspaces (not from commons availability). Commons migration is independent.

### Commons-side migration (team responsibility, separate from project migrate)

**Mandatory steps:**

1. **Retag all entries via frontmatter:**
   - `entries/stacks/next/...` → `entries/.../` with frontmatter `scope: library:next`
   - `entries/squads/auth/...` → `entries/.../` with frontmatter `scope: library:auth` (squad name → library, verbatim; team adjusts mapping in PR review if needed)
   - `entries/projects/my-app/...` → `entries/.../` (no scope = global, org-wide)
   - `entries/org/...` → `entries/.../` (no scope = global)
   - (Tool: optional migration script to automate path→frontmatter; team validates output in PR)

2. **Bump memory.json:**
   ```json
   {
     "formatVersion": 2,
     ...
   }
   ```

3. **Create FORMAT_VERSION file:**
   ```
   echo "2" > commons/FORMAT_VERSION
   ```
   (Note: `memory.json.formatVersion` is authoritative; FORMAT_VERSION is a human/lint marker)

4. **Fix entry-to-entry overrides:**
   - Current refs: `${scope}/${name}` (e.g., `stacks/next/entry-name`)
   - New form: `library:{name}/{entry-name}` (e.g., `library:next/entry-name`)
   - Bare entry refs (targeting untagged/global entries): use bare `{entry-name}` (no prefix)
   - Search+replace in entry frontmatter and body references

5. **Archive v1 (optional):**
   - `cp memory.json memory.json.old`
   - Commit with message "chore: archive v1 memory schema"

6. **Lint changes:**
   - Run `roboto-mem lint` (add v2 validation: FORMAT_VERSION=2, all entries have required frontmatter fields, no path-based scope dirs remain, all override-refs are valid)
   - Commit linting fixes

7. **Team review:**
   - PR all changes to main
   - Ensure entry scope mapping matches team intent (squads→libraries mapping can be subjective; adjust in PR review)

**Old CLIs reading migrated commons:**
- Load fails at `memory.json.formatVersion: 2 > old_CLI_FORMAT_VERSION` (1)
- `loadMemory` detects mismatch → returns `newer-format` error
- Digest falls back to stale cache + nag (safe)

**New CLI × v2 config × v1 commons (commons not yet migrated):**
- New CLI loads v2 config, attempts to parse v1 commons entries
- Detects path-scoped entries: `entries/stacks/next/foo.md` (no frontmatter `scope:`)
- Entry parser rejects: "Commons format v1 not supported. Team must migrate commons: retag entries to frontmatter, bump memory.json.formatVersion to 2."
- Exit code 1; no fallback; forces commons migration before CLI use

## Edge Cases & Their Handlers

1. **User has both `~/.claude/skills/resend/SKILL.md` and `~/.roboto-mem/libraries/resend/LIBRARY.md`**
   - Handler: User skill wins; library ignored; digest injects skill only
   - No collision warning (explicit precedence rule)

2. **Library detection suggests library but user removes it at init**
   - Handler: `update-libraries` will re-suggest it on every run while dep remains
   - Expected behavior; document as known limitation (future: `ignoredLibraries` field punted to v2)

3. **Team updates a library; user has local customizations in `~/.roboto-mem/libraries/{lib}/`**
   - Handler: `roboto-mem sync` shows diffs, user confirms, pull latest from commons (overwrites local edits)
   - Rationale: user edits should happen in `~/.claude/skills/` (precedence layer 1) instead
   - Future: per-library version pinning

4. **Non-TTY environment (CI, scripts)**
   - Handler: `roboto-mem init` errors; user pre-writes `.roboto-mem.json`
   - Handler: `roboto-mem sync` auto-pulls silently (no confirmation)
   - Handler: SessionStart reads cached libraries (no remote fetch)

5. **Project has zero libraries**
   - Handler: `.roboto-mem.json` omits `libraries` key or empty array
   - Result: global entries load, no library entries

6. **roboto-mem sync fails (network, auth, corrupted library)**
   - Handler: Cached version persists; sync is retryable
   - Error message lists failed libraries and reason (exit code 2)
   - User can manually delete corrupted file and re-sync

7. **Multiple team members; first person migrates old project to v2**
   - Handler: First migrator commits v2 config + commons migration
   - Others pull commit; old CLIs see v2 config → stale cache + nag; can continue working
   - Team upgrades roboto-mem on own schedule

8. **Two projects on same machine, different commons URLs**
   - Handler: Both stored in `~/.roboto-mem/repos/<sha12(url1)>/` and `repos/<sha12(url2)>/` (hash-keyed isolation)
   - No collision
   - Mitigation: teams should namespace libs (e.g., `resend-v1`, `resend-v2`) if libraries conflict

9. **New CLI × v1 config**
   - Handler: new CLI rejects v1 config (nag to migrate); never tries to read v1 commons
   - Result: user must `roboto-mem migrate` before upgrading CLI
   - Safe; forces intentional upgrade

10. **New CLI × v2 config × v1 commons (commons not yet migrated)**
    - Handler: new CLI loads v2 config, attempts to parse v1 commons entries
    - Detects path-scoped entries, rejects with error message
    - Exit code 1; forces commons migration before CLI use

11. **Npm scoped package (`@scope/name`) in deps**
    - Handler: Check hardcoded alias table (e.g., `@auth0/*` → `auth0`)
    - If no alias: skip with warn "⚠️ Couldn't map @auth0/nextjs-auth0 to a known library; add manually if needed"
    - Alias table is extensible in Phase 3

## Implementation Phases

### Phase 1 — Schema & Infrastructure (Blocker for all phases)
- [ ] Update config schema (`src/core/config.ts`): v2 shape, validation rules, unknown-field rejection, separate error for v2+stray-fields
- [ ] Update config loader: project override > global init-only > silence
- [ ] Add v1 stale-cache fallback path (verified: shipped `newer-config` behavior already exists)
- [ ] Update error messages: "Config format v1 is deprecated. Run: `roboto-mem migrate`" and "Config has legacy fields..."
- [ ] Create `~/.config/roboto-mem/config.json` default structure
- [ ] Reuse shipped clone-path scheme: `repos/<sha12(url)>/` via `repoDirFor` (no new code needed; verify in Phase 1)

### Phase 2 — Entry Scoping + Version Bumps (Blocker for Phase 6)
- [ ] **Bump FORMAT_VERSION to 2** in `src/core/memory-repo.ts` (critical for new CLI to recognize v2 commons)
- [ ] **Bump CONFIG_VERSION to 2** in `src/core/config.ts` (critical for version check)
- [ ] Update entry parsing (`src/core/entry.ts`): add frontmatter `scope:` field support (YAML); make frontmatter required, only `scope:` optional
- [ ] Define untagged=global rule (entries without `scope:` always load)
- [ ] Update `entryApplies` filter: `library:X` matches only if library X declared
- [ ] Update digest scoping (`src/core/scopes.ts`): replace project/squad/stack/org dimensions with library-based
- [ ] Update digest compiler (`src/commands/digest.ts`): load global entries + library entries
- [ ] Update memory.json schema: add token budget config (v2)
- [ ] Migrate existing `stack/*` entries: tooling to convert path scopes to frontmatter

### Phase 3 — Detection & Init (Blocker for Phase 5)
- [ ] Implement library listing from commons (`commons/libraries/`)
- [ ] Implement npm dep scanning (`package.json` → dependencies + devDependencies)
- [ ] Implement npm-name→library mapping: **exact intersection only** + hardcoded alias table for scoped packages (NOT STACK_SIGNALS)
- [ ] Implement commons clone/pull on init (reuse shipped `repoDirFor`; check mtime via `.git/FETCH_HEAD`)
- [ ] Implement `roboto-mem init` TTY-gated flow (steps 1–11 above, non-TTY error)
- [ ] Implement `roboto-mem update-libraries` command

### Phase 4 — Sync & Promotion (Blocker for Phase 6)
- [ ] Implement `roboto-mem sync` (pull libraries + entries, materialize skills, show diffs, cache locally)
- [ ] Implement **overwrite-after-confirm** collision rule (pull latest after user confirms diffs)
- [ ] Implement diff rendering for user confirmation (TTY)
- [ ] Implement non-TTY auto-pull (CI)
- [ ] Implement cache persistence + retry logic (store sync timestamp via `.git/FETCH_HEAD` mtime)
- [ ] Implement `roboto-mem materializeSkills` step within sync (reuse shipped code)
- [ ] Implement `roboto-mem promote library <lib>` (subcommand, distinct from existing promote/skill promote)
- [ ] Use existing PR machinery (`runSkillPromote` from `src/commands/skill.ts`)
- [ ] Add library promotion to plugin command docs (`commands/promote-library.md`)

### Phase 5 — Migration (Blocker for backward-compat)
- [ ] Implement `roboto-mem migrate` (per-project, v1→v2)
- [ ] Implement **lossless workspaces→libraries mapping** (read workspace stack arrays directly; union and dedupe)
- [ ] Implement config transformation (remove v1 fields, seed libraries from workspaces)
- [ ] Implement idempotency (v2 config → no-op)
- [ ] Implement non-TTY behavior (silent migrate, no prompt)
- [ ] Add commons-side migration guide (retag entries with frontmatter, bump memory.json.formatVersion, create FORMAT_VERSION, fix override-refs, lint)
- [ ] Add migration docs with examples

### Phase 6 — SessionStart Integration (Last phase)
- [ ] **Remove `syncRepos` and `materializeSkills` from digest hook** (`src/commands/digest.ts:82,93`) — these move to manual `roboto-mem sync` only
- [ ] Load declared libraries from cached `~/.roboto-mem/libraries/{lib}/LIBRARY.md`
- [ ] Inject library summaries (LIBRARY.md, soft-warn >300t, hard-drop >1000t total)
- [ ] Load global entries (untagged)
- [ ] Filter library-scoped entries by declared libraries
- [ ] Test precedence: user skill > library
- [ ] Test backwards-compat: new CLI × v1 config (error + nag); new CLI × v2 config × v1 commons (error); new CLI × v2 config × v2 commons (works)
- [ ] Test backwards-compat: old CLI × v1 config (works); old CLI × v2 config (stale cache + nag)
- [ ] Performance test: library loading <500ms (cached file reads)

## Success Criteria (Measurable)

- [ ] **Migration tool works** — `roboto-mem migrate` converts v1→v2 losslessly (output matches transformation table) for 10 test projects; each generates reviewable diff
- [ ] **Init detects libraries** — `roboto-mem init` on a Next.js + Resend project detects `["next", "resend"]` and writes config
- [ ] **User skills override** — if `~/.claude/skills/resend/SKILL.md` exists, digest ignores `~/.roboto-mem/libraries/resend/LIBRARY.md`
- [ ] **Sync shows diffs** — `roboto-mem sync` with updated library shows changes; TTY prompts for confirm; confirm overwrites local edits
- [ ] **Old CLI safe** — old CLI reads v2 config, detects `configVersion: 2`, returns stale cache + nag (no crash, no silent failure)
- [ ] **Backward-compat: new × v1 config** — new CLI reads v1 config, errors with "Run: `roboto-mem migrate`", exit code 1
- [ ] **Backward-compat: new × v1 commons** — new CLI × v1 commons rejects with error; forces commons migration first
- [ ] **SessionStart performance** — library loading <500ms (cached file reads, no I/O wait)
- [ ] **Non-TTY works** — init errors; sync auto-pulls; SessionStart reads cache (no prompts)
- [ ] **Token budget enforced** — library injection respects 300t/lib soft-warn, 1000t total hard-cap; drop algorithm is deterministic (reverse-config-order)
- [ ] **Entry scoping works** — untagged entries always load; `library:resend` entries load only if `libraries: ["resend"]` declared
- [ ] **Promotion PR-gated** — `roboto-mem promote library <lib>` creates PR; nothing goes to commons without review

## Known Limitations (v1)

- npm/Node-only detection (v2+ will add Python, Go, Ruby)
- Single commons per project (string, not array)
- No per-library version pinning (latest always)
- Library updates are all-or-nothing confirm (no selective pull)
- One commons per machine (flat cache; collision mitigation: team namespacing)
- No "ignored libraries" list (re-suggestions possible; v2+ feature)

## Open Questions (v2+)

1. **Ignored libraries field** — add `"ignoredLibraries": ["sanity"]` to suppress `update-libraries` re-suggestions?
2. **Per-library version pinning** — support `"libraries": {"resend": "v1.2.0"}`?
3. **Multi-language detection** — Python (requirements.txt, pyproject.toml), Go (go.mod), Ruby (Gemfile)?
4. **Library domains** — organizational grouping (email/, auth/, etc.) for large commons?
5. **Multi-commons support** — `"commons": [url1, url2]` as array?
6. **Commons format versioning** — process for future FORMAT_VERSION bumps?
7. **Per-library edits & sync conflict resolution** — merge strategy or always preserve local?
