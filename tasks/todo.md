# roboto-mem v1 — execution tracker

## Interactive Mode (ADR 0008) — 2026-07-06

Design ref: CONTEXT.md "Interactive Mode", docs/adr/0008-interactive-prompts-tty-gated-clack.md

### Plan
- [ ] `src/core/entry.ts`: extract `todayYMD` (shared by cli.ts + prompts.ts)
- [ ] `src/core/prompts.ts` (pure, no TTY/clack): field-description constants (single
      source of truth for cli.ts arg descriptions + prompt copy), `PromptStep` types,
      `planInitPrompts`/`planPromotePrompts`/`planSkillAddPrompts`/`planSkillPromotePrompts`,
      async context resolvers (`resolveDefaultAuthor` via git config, `resolveKnownScopes`,
      `listPersonalSkillNames`)
- [ ] `src/core/prompt-driver.ts`: `PromptDriver` interface, `isInteractiveTty`,
      `runPromptSteps` (sequential, cancel-aware), `createClackDriver` (lazy
      `await import("@clack/prompts")` — only touched inside this function)
- [ ] `src/core/interactive.ts`: per-command resolvers
      (`resolveInitPrompts`/`resolvePromotePrompts`/`resolveSkillAddPrompts`/`resolveSkillPromotePrompts`)
      composing plan + driver + merge; promote/skill-promote add summary+confirm gated on
      `steps.length > 0`
- [ ] `src/cli.ts`: wire TTY gate into init/promote/skill add/skill promote; non-TTY branch
      must stay byte-for-byte identical (verbatim existing lines, just reading from a
      `provided`/`filled.options` local instead of `args` directly); digest/sync/status/lint
      untouched
- [ ] Tests (write first, TDD):
  - tests/core/prompts.test.ts — plan computation (missing/required/defaults), resolvers
  - tests/core/prompt-driver.test.ts — isInteractiveTty, runPromptSteps w/ fake driver incl.
    cancel, createClackDriver shape (no real prompting)
  - tests/core/interactive.test.ts — per-command guided flow w/ fake driver → exact merged
    options; cancel path; confirm-summary gated on steps.length
  - tests/cli.test.ts — digest/sync/status/lint source never reference prompt modules
  - tests/integration/interactive-mode.test.ts — fresh build, spawn each command non-TTY
    with missing args, assert unchanged error/exit code
- [ ] Gates: typecheck, lint, test, build; measure dist/cli.mjs size + cold-start delta

### Review

Shipped. Files: src/core/prompts.ts, src/core/prompt-driver.ts,
src/core/interactive.ts (new); src/cli.ts rewritten to wire TTY gate into
init/promote/skill add/skill promote (non-TTY branch is a verbatim
passthrough of the prior logic); src/core/entry.ts (+todayYMD),
src/core/scopes.ts (+splitSquads, moved from cli.ts) as small supporting
extractions to avoid a cli.ts <-> prompts.ts circular import.

Tests: 246 -> 311 (65 new: prompts.test.ts 31, prompt-driver.test.ts 9,
interactive.test.ts 14, entry.test.ts +1, cli.test.ts +4 (isolation,
it.each x4), interactive-mode.test.ts +6 real end-to-end non-TTY checks).

Gates: typecheck clean, lint clean, all tests green, build produces a single
dist/cli.mjs.

Bundle: 511,511 B -> 621,030 B raw (+109,519 B / +21.4%); gzip 125.24 kB ->
152.30 kB (+27.06 kB). Cold-start (`status`, `digest --hook`): 0.04s before
and after, unchanged, both wall-clock and by inspecting the compiled bundle
(rolldown turned `await import("@clack/prompts")` into a memoized
`init_dist()` lazy-initializer wrapped in `Promise.resolve().then(...)` —
confirmed only invoked inside the 4 interactive commands' TTY branch, never
by digest/sync/status/lint).

Deviation flagged to the requester: raw delta (109.68 kB) is well above
ADR 0008's ~30 kB "decision flips" threshold. Implemented as specified
regardless (dependency + architecture were locked in the task); did not
substitute a hand-rolled node:readline prompt implementation.

### Follow-up: scope-select contract + collision confirm-retry — 2026-07-06 pm

1. Scope select: verified `resolveKnownScopes` already returns exactly
   org+squads+stacks+project (reuses digest/status's own `sessionScopes`) —
   no change needed there. Added the missing piece: `planPromotePrompts`'s
   scope select now appends an `OTHER_SCOPE` ("other…") sentinel; picking it
   immediately follows up with a free-text prompt (wired in
   `resolveScopeStep`/`resolvePromotePrompts`, interactive.ts) before moving
   on to type/name/etc.
2. Collision confirm-retry (guided promote only): discovered `--force`
   deliberately never bypasses the exact-collision gate (4a) — locked,
   tested behavior (`tests/commands/promote.test.ts` "force does not
   bypass"). Reusing `force` for the retry would have silently changed
   flag-mode behavior. Added a new `overwrite` field to `PromoteOptions`
   (src/commands/promote.ts) — never CLI-flag-reachable, bypasses 4a only —
   and `submitPromote` (interactive.ts) which detects the exact collision
   message, shows the exact-copy confirm (default No), and on Yes retries
   with `{ force: true, overwrite: true }`. `resolvePromotePrompts` now
   returns `guided: boolean`; cli.ts only calls `submitPromote` when
   `guided` (flags-only/non-TTY call `runPromote` directly, unchanged).

Tests: 311 -> 319 (+8: promote.test.ts +1 overwrite-bypass test,
interactive.test.ts +7 — 2 "other…" follow-up, 5 submitPromote).
Gates: typecheck/lint/test/build all green; single dist/cli.mjs
(624,102 B, cold-start unchanged at ~0.04s).

### Code review fixes — 2026-07-07

1. `entryCollisionMessage(scope, name)` exported from src/commands/promote.ts;
   consumed by runPromote's gate 4a, submitPromote (interactive.ts), and the
   test fixture (interactive.test.ts) — no more drift-prone duplicate string.
2. Prompt-isolation test now ALSO extracts syncCmd/digestCmd/lintCmd/statusCmd's
   own defineCommand({...}) block from src/cli.ts and asserts none reference
   isInteractiveTty/createClackDriver/resolve*Prompts (leaf-file checks kept).
3. PROMOTE_FIELD_DESC.force corrected to "Promote despite near-duplicate
   matches (does not overwrite an existing entry)".
4. Added `validateScope` (isValidScope) to the no-knownScopes scope text
   fallback (prompts.ts) and the "other…" free-text follow-up (interactive.ts).
5. Added DATE_RE-based `validateDate` to both date steps (promote + skill
   promote).
6. Renamed unused isCancel predicate param to `_value` (interactive.test.ts).

Tests: 319 -> 330 (+11: cli.test.ts +4 it.each cases for finding 2;
interactive.test.ts +4 invalid/valid validate-path tests (scope fallback,
"other…" follow-up, promote date, skill-promote date) driven through a
fakeDriver upgraded to simulate real reject-then-retry; prompts.test.ts +3
direct validator unit tests (scope fallback, promote date, skill-promote
date)). Also fixed a latent bug the new scope validator surfaced: the
existing "other…" follow-up test used "custom/scope-value", which was never
actually a valid scope shape (isValidScope requires squad|stack|project
prefix) — corrected to "project/custom".
Gates: typecheck/lint/test/build all green; single dist/cli.mjs
(624,766 B, cold-start unchanged at ~0.04s).

### 4-angle quality batch (17 items) — 2026-07-07

Applied all 17: (1) select-step `other` capability replaces the OTHER_SCOPE
special case; (2) runPromptSteps rewritten as for...of + local const answers,
true early return; (3) askStep passes step objects directly, option types
derived via Omit<Extract<PromptStep,...>>, SelectChoice reused from
prompts.ts; (4) promote gains `reason?: "collision"`, submitPromote checks
the tag instead of string-matching, entryCollisionMessage deleted; (5)
resolvePromotePrompts/resolveSkillPromotePrompts compute missing-ness from
`provided` alone and fetch knownScopes/defaultAuthor/personalSkillNames only
when their field is actually missing; (6) promoteCmd validates a passed
--type/--body-file before any prompting; (7) init non-TTY uses
buildInitOptions(provided, {}); (8) selectSteps derives anyProvided from
candidates.some(c => !c.missing); (9) guided skill add gets the
summary+confirm recap; (10) PromoteResolved carries the driver in the guided
arm; (11) confirmSummary/submitPromote's cancel checks simplified to
`=== true` / `!== true`; (12) splitSquads re-export shim deleted from cli.ts;
(13) resolveInitPrompts takes `dir` and derives the basename itself; (14)
materialize.ts's `exists` exported and reused in listPersonalSkillNames; (15)
SCOPE_RULE/SCOPE_ID_RULE (scopes.ts) and DATE_RULE (entry.ts) single-source
promote's gate-1 messages and the prompt validators; (16) ENTRY_TYPES/
EntryType/isEntryType (entry.ts) drive the type select, gate-1 check, and
cli.ts's validatePromoteType; (17) tests/helpers/cli-runner.ts (new) hoists
RawRun/rawRun/buildCliInto for both integration test files, interactive-mode
adopts tmpDirFactory.

One deviation: item 15's "name-slug ... beside their regexes in entry.ts" —
SCOPE_ID_RE actually lives in scopes.ts, not entry.ts, so SCOPE_ID_RULE was
placed beside it there instead (the stated principle — beside the regex —
took precedence over the named file).

Tests: 330 -> 336 (+6: init "derives project-name default" +1,
promote "partial: only author missing" +1, skill-add "declining confirm
cancels" +1, skill-promote "partial: only date missing" +1, interactive-mode
+2 for item 6's early-validation paths — bad --type / unreadable
--body-file). All existing tests adapted for the new shapes continue to pass
(scope "other…" tests now drive it via the driver's own returned option list
rather than an exported sentinel).
Gates: typecheck/lint/test/build all green; single dist/cli.mjs
(624,295 B — smaller than before this batch despite new capability; cold
start unchanged at ~0.04s).

### Guided init design flaw fix — 2026-07-07 pm

Bug: bare guided init asked project/commons-url/squads THEN a trailing
"scaffold commons?" confirm; answering Yes silently discarded the three
just-collected bind answers and scaffolded a Commons into a bound project
repo (accepted "asdasd" as a commons-url with zero validation along the way).

1. Mode-first guided init: resolveInitPrompts now asks a bind-vs-scaffold
   select FIRST on a genuinely bare invocation, before collecting anything.
   `--commons` still wins outright with zero prompts (mirrors non-interactive
   `init --commons` exactly); any of --commons-url/--project/--squads implies
   bind mode with no mode prompt, prompting only the missing bind fields
   (unchanged partial-mode semantics). planInitPrompts dropped the
   scaffoldCommons step entirely — mode is never a plannable step again.
2. commons-url prompt (guided bind only) validates trimmed+non-empty+looks
   like a git remote ("://" or "git@..."); "asdasd" now rejected at the
   prompt with a message naming the accepted forms. Flag path (runInit's own
   `commonsUrl ?? existing?.commons` fallback) untouched.
3. Squads prompt validates each comma-segment against SCOPE_ID_RE (imported,
   not duplicated), rejecting "Web" with a message suggesting "web" — no
   silent lowercasing.
4. Guards: guided SCAFFOLD chosen in a dir with any .roboto-mem.json (valid,
   corrupt, or newer-version) now confirms first, default No; guided BIND in
   an already-bound dir prefills project/commons-url/squads from the
   existing config instead of the bare basename default — no extra confirm
   on rebind.
5. Scaffold overwrite safety: scaffoldMode's writeFile was unconditional
   (confirmed by reading it — it did overwrite pre-existing files). Replaced
   with writeIfMissing: never overwrites an existing file, reports each as
   "(exists, skipped)", exit 0 unchanged, memory.json early-exit untouched.
   Applies to both the flag path and the guided path (same runInit/scaffoldMode).

Tests: 336 -> 350 (+14: prompts.test.ts +4 — 3 bind fields not 4, rebind
prefill, commonsUrl validate, squads validate; interactive.test.ts's
resolveInitPrompts describe rewritten (18 cases: mode select both branches,
flags-imply-mode x2, scaffold-into-bound-repo decline/accept, rebind prefill,
commonsUrl/squads validation through the full flow, cancel paths);
init.test.ts +1 (scaffold skip-existing-files, README/CODEOWNERS preserved);
interactive-mode.test.ts +1 (init --commons non-TTY on an already-bound dir).
Gates: typecheck/lint/test/build all green; single dist/cli.mjs (627,026 B;
cold-start unchanged at ~0.04s).

Noted, not caused by me: HEAD advanced (e8866c3 -> 2a1264a) via a commit
authored by Hrithik containing only the pre-existing demo-tape/docs files
that were already dirty before this session started — unrelated to this
work, no `git add`/`commit` call made by me at any point.

### PTY scenario matrix — 3 defects (D1/D2/D3) — 2026-07-07 pm

Found by a live pty scenario matrix (real terminal, state-based assertions).

D1 — calendar-invalid dates accepted everywhere: DATE_RE is format-only, so
`--date 2026-13-99` passed promote's gate 1 and the interactive
`validateDate`. Added `isValidDate(s)` beside `DATE_RE` in entry.ts —
constructs the UTC date from the YYYY-MM-DD parts and requires an exact
year/month/day round-trip (JS's Date normalizes out-of-range components
instead of rejecting them, so a round-trip mismatch means the calendar date
was never real; UTC-only, no local-timezone dependence). Wired into both
promote's gate 1 and prompts.ts's shared `validateDate` (one function serves
both planPromotePrompts and planSkillPromotePrompts, so skill promote's date
step is covered automatically). Gate-1 message now says "...and a real
calendar date." skill.ts's own separate DATE_RE-only date gates in
runSkillAdd/runSkillPromote were left untouched — out of scope per the
literal fix request (only promote's gate 1 and prompts.ts's validateDate were
named); flagged here as a similar-shaped gap deliberately left alone.

D2 — guided skill add could never complete flagless: planSkillAddPrompts had
no author step; cli.ts passed `(args.author ?? "")` straight through;
runSkillAdd rejects empty author — so a TTY user answering every guided
prompt still failed. Added a required author step to planSkillAddPrompts
(mirrors promote's: prefilled from resolveDefaultAuthor via git identity,
description reused from the existing --author flag desc), and
resolveSkillAddPrompts now takes a `cwd` param and only fetches the git
identity when author is actually missing (same "required fields drive
inclusion independent of anyProvided" shortcut used elsewhere). cli.ts's
skillAddCmd now reads `author` from the resolved prompt options instead of
straight off `args`, closing the loop. Checked whether runSkillAdd also needs
a date step — no, cli.ts's own `?? todayYMD()` fallback already guarantees a
valid date regardless of TTY state, so no date step was added. The confirm
recap added in the earlier quality batch stays untouched.

D3 — guided source/name prompts were dead code: skillAddCmd's `source` and
skillPromoteCmd's `name` positionals were `required` in citty, so citty's own
arg-parser threw ("Missing required positional argument") before run() ever
executed — the guided branch could never render. Read citty's source
directly: the same `arg.required !== false && arg.default === void 0`
condition gates both the parse-time throw AND showUsage()'s `<X>`/`[X]`
bracket choice, so marking the arg `required: false` (needed to stop the
throw) also flips its rendered usage text — citty's own showUsage() can't
reproduce today's non-TTY output unmodified once the arg is optional. Fixed
by rendering usage against a display-only clone of the command def (the one
arg's `required` flipped back to `true` for that call only; the real command
def used for parsing stays permissive) via a new `reportMissingPositional`
helper, then writing the same `ERROR Missing required positional argument`
stderr line as before. Captured the actual pre-fix stdout/stderr+exit code
from the built CLI first, then diffed the post-fix build against those
captures: byte-for-byte identical for both `skill add` and `skill promote`,
exit 1 both times. Both positionals are now `required: false` in their citty
defs, each guarded by `if (!provided.X && !isInteractiveTty())` before the
TTY branch.

Tests: 350 -> 366 (+16: entry.test.ts +7 (`isValidDate` — month/day out of
range, Feb 29 leap/non-leap, normal date, today, format-rejects); prompts.test.ts
planSkillAddPrompts rewritten with an author step (+2 net: prefill-from-default,
partial-only-author-missing) and buildSkillAddOptions +1 (author merge);
interactive.test.ts +1 (resolveSkillAddPrompts partial-only-author-missing,
proving D2's guided flow now completes flagless) and +2 (calendar-invalid
date rejected-then-reasked via fake driver, one each for resolvePromotePrompts
and resolveSkillPromotePrompts); tests/commands/promote.test.ts +2 (flag-path
gate-1 rejection for 2026-13-99 and 2026-02-30); interactive-mode.test.ts +1
(skill promote missing NAME, full exact stdout/stderr) and the existing skill
add missing-SOURCE test upgraded from a substring check to the full exact
captured text). Guided-flow reachability for source/name themselves was
already covered by pre-existing fake-driver tests (never broken at the
resolver layer — only reachability from cli.ts was); true pty-level
end-to-end confirmation is the separate pty harness agent's job.
Gates: typecheck/lint/test/build all green; single dist/cli.mjs
(629,629 B; cold-start unchanged at ~0.04s).

## Global Library Model — Phase 1 (Schema & Infrastructure)

Spec: docs/design-specs/2026-07-17-global-library-model.md. Phase 1 is
schema + infra only — NOT wired into the live runtime path yet.
CONFIG_VERSION/FORMAT_VERSION stay at 1 (bump is explicitly Phase 2).

Key design resolution: since CONFIG_VERSION stays 1, the current
`loadConfig`/`validateConfig` (v1, used by digest.ts/sync.ts/etc.) must
stay behaviorally IDENTICAL — any `configVersion: 2` config still hits the
existing `newer-config` gate before v1 field validation runs. The new v2
schema/validator is a parallel, self-contained code path (`loadConfigV2`,
not wired into `loadConfig`) so it's fully testable now without disturbing
the live command flow. Phase 2 will bump CONFIG_VERSION and splice this in.

- [ ] Refactor `loadConfig`'s file-read/parse logic into a shared
      `readConfigFile(dir, fileName)` helper (zero behavior change to v1;
      dedupes 3x repetition once v2 + global loaders are added)
- [ ] Add `RepoConfigV2` (`configVersion:2`, `commons: string`,
      `libraries: string[]`), `ConfigV2Result`, `CONFIG_VERSION_V2=2`,
      `LEGACY_V1_FIELDS`, `CONFIG_V1_DEPRECATED_MESSAGE`,
      `CONFIG_LEGACY_FIELDS_MESSAGE`
- [ ] Add private `validateConfigV2` + exported `loadConfigV2(dir)`
      (mirrors `validateConfig`/`loadConfig`, unexported validator per
      existing convention)
- [ ] Add `GlobalConfig` (`commons?: string`), `GlobalConfigResult`,
      `GLOBAL_CONFIG_FILE`, `globalConfigHome()`, `loadGlobalConfig(home)`
      for `~/.config/roboto-mem/config.json` (init-only defaults, Phase 3
      consumer)
- [ ] RED tests first in tests/core/config.test.ts: v2 valid/invalid
      shapes, v1-deprecated fixture, hybrid (v2+legacy-fields) fixture x2,
      configVersion newer-than-2, global config suite, precedence/silence
      regression, v1 loadConfig-vs-v2-shape backward-compat regression
- [ ] Add `repoDirFor` direct unit test in memory-repo.test.ts (sha256-12
      hash scheme currently only exercised indirectly)
- [ ] Add digest.test.ts coverage for a REAL v2-shaped project config
      (configVersion 2 + commons + libraries) hitting stale-cache+nag,
      mirroring the existing newer-format pair of tests
- [ ] typecheck + lint + full suite + coverage; /simplify pass; report

Explicitly OUT of scope for Phase 1 (do not touch): CONFIG_VERSION bump,
FORMAT_VERSION bump, entry.ts scope: frontmatter, scopes.ts library
filtering, digest.ts/scopes.ts wiring, init/sync/migrate commands.

### Review — Phase 1 shipped

All checklist items done. src/core/config.ts: refactored the v1
loadConfig's file-read/parse into a shared `readConfigFile(dir, fileName)`
(byte-identical detail strings preserved — verified against every existing
v1 test, none needed changing); added the v2 schema (RepoConfigV2,
ConfigV2Result, CONFIG_VERSION_V2=2, LEGACY_V1_FIELDS,
CONFIG_V1_DEPRECATED_MESSAGE, CONFIG_LEGACY_FIELDS_MESSAGE) + private
validateConfigV2 + exported loadConfigV2(dir) as a parallel, self-contained
path — NOT spliced into loadConfig, since CONFIG_VERSION stays 1 this
phase and any configVersion:2 file must keep hitting the pre-existing
newer-config gate (verified via new regression test, zero digest.ts/
memory-repo.ts changes needed). Added GlobalConfig/GlobalConfigResult/
loadGlobalConfig/globalConfigHome for `~/.config/roboto-mem/config.json`
(init-only suggested defaults, Phase 3 consumer) with an
ROBOTO_MEM_CONFIG_HOME env override mirroring memoryHome()'s pattern.

Key design resolution confirmed correct: "project override, global
init-only, silence" precedence needed no merge function — loadConfig/
loadConfigV2 simply never reference the global path, proven by an explicit
test (populated global config sitting next to a missing project config
still returns reason:"missing"). validateConfigV2 discriminates
configVersion 1 ("v1 deprecated, run migrate") from configVersion 2 +
legacy fields present ("hybrid, hand-edited, remove them") using the exact
message strings from the spec (asserted via toBe, not just toContain).

Tests: 368 -> 396 (+28: config.test.ts +23 — v2 valid/minimal/defaults,
invalid commons/libraries/configVersion, configVersion 0 edge case,
newer-config at 3, v1-deprecated fixture, hybrid fixture x2 (all-4-fields
and single-field), EISDIR, bad JSON, non-object JSON (closed a
pre-existing tryParseJson gap), global config suite x4, precedence/silence
x2, globalConfigHome x2, backward-compat regression (real v2 shape into
v1 loadConfig -> newer-config); memory-repo.test.ts +3 (repoDirFor:
sha256-12 hash scheme had zero direct coverage before — only exercised
indirectly through ensureRepo); digest.test.ts +2 (v2-shaped project
config -> stale-cache+nag end-to-end, mirroring the existing newer-format
pair — this was the literal "verify old CLI behavior" gap, now closed).

Coverage: config.ts 92.15%->96.47% lines (only pre-existing v1 gaps at
lines 36/64/76 remain — configVersion-not-number/project-not-string/
workspaces-not-object detail branches were never covered before my
changes either; left alone, out of Phase 1 scope). Repo-wide: 93.58% ->
93.87% lines, all thresholds (80%) cleared by a wide margin.

Simplify pass: merged the "configVersion===1" and "configVersion!==2"
branches into one guard with a ternary detail message; replaced
validateGlobalConfig's redundant ternary with a direct `as string |
undefined` cast (type already narrowed by the preceding guard). Did NOT
genericize ConfigResult/ConfigV2Result into a shared parametrized type —
only 2 occurrences (below the 3+ dedupe threshold) and every other
`*Load`/`*Result` union in this codebase (MemoryLoad, DigestMeta, etc.) is
its own concrete named type, not a shared generic — matching that
precedent over introducing a new abstraction.

Gates: typecheck/lint/test/build all green (396/396). Reverted
dist/cli.mjs after a verification build — Phase 1 is source+tests only,
no release intended. RepoConfig (v1) and CONFIG_VERSION untouched at the
type/value level, so init.ts/sync.ts/digest.ts/status.ts/etc. compile and
behave identically to before — confirmed via full untargeted typecheck
and test run, not just the touched files.

## Global Library Model — Phase 4 (Sync & Promotion)

Spec: docs/design-specs/2026-07-17-global-library-model.md, "Sync &
Promotion" section + Phase 4 checklist. Builds on Phase 1's `loadConfigV2`
(config.ts) and the already-shipped `src/core/dir-diff.ts` (diffDirs/
formatDirDiff/isDirDiffEmpty — built ahead of time explicitly for this
phase's collision-confirm + promote-PR-body use). CONFIG_VERSION (v1)
stays at 1 — v1 projects/commons must keep working unchanged (task's
explicit backward-compat requirement); v2 is opt-in via `loadConfigV2`
succeeding.

Found via direct spec re-read (not the task paraphrase): no ancestor-
directory config walk anywhere in the spec or existing loadConfig/
loadConfigV2 (both take `dir` directly, matching every other command)
— skipping that item from the task's step list, corroborated by an
existing memory note flagging the same discrepancy.

citty gotcha (verified via a throwaway probe against the installed
citty@0.1.6): `subCommands` resolution scans raw argv tokens for the
first one not starting with `-` — it has no notion of "this token is a
flag's value", so giving `promoteCmd` a `library` subCommand directly
would make `roboto-mem promote --scope org ...` throw `Unknown command
\`org\``` (first flag VALUE token misread as a subcommand name), and
citty also does NOT `return` after dispatching a matched subCommand, so
both the subcommand AND the parent's own `run` would fire. Fix: never
register `subCommands` on `promoteCmd`; manually check `rawArgs[0] ===
"library"` inside its own `run` and `return` after a manual `runCommand
(promoteLibraryCmd, {rawArgs: rawArgs.slice(1)})` call — sidesteps both
bugs, keeps `roboto-mem promote --scope ...` untouched.

Existing locked-down test conflict: `tests/cli.test.ts`'s prompt-module-
isolation suite asserts `syncCmd`'s cli.ts block never references
`isInteractiveTty`/`createClackDriver`. The spec requires a TTY confirm
for library sync collisions, so this needs to change — but the right fix
is pushing TTY/clack orchestration UP into `syncCmd` (cli.ts layer, same
place every other interactive command does it) while `sync.ts` itself
(and `core/library.ts`) stay 100% prompt-module-free, accepting only a
plain injected `confirm?: (message) => Promise<boolean>` callback
(mirrors the existing `ghRunner` DI pattern) that defaults to
auto-proceed when omitted. This keeps sync.ts on the leaf-file forbidden-
module check UNCHANGED (the more important invariant — a hook-callable
function must never block) and only trims `syncCmd` out of the
cli.ts-wiring check's `it.each` array, with a comment explaining why.

### Plan

- [ ] `src/core/library.ts` (new): `commonsLibrariesDir`/`librariesHome`
      path helpers; `planLibrary`/`applyLibrary` (tmp-then-rename copy,
      mirrors materialize.ts's `copySkill`) internals; exported
      `materializeLibraries({commonsDir, home, libraryNames, confirm?})`
      — diffs each declared library (via `diffDirs`) against its local
      cache, and when ANY has a pending diff calls `confirm(combined
      summary)` ONCE (all-or-nothing per spec's known-limitations list,
      not N per-library prompts) before applying; omitted confirm =
      auto-pull. Returns `{synced, upToDate, skipped, failed}` +
      `formatLibrariesReport` (mirrors materialize.ts's `formatReport`).
- [ ] RED tests first: `tests/core/library.test.ts` — git-free (plain
      tmpdirs, no git needed — commonsDir is already-cloned by the time
      this runs), covering: added/changed/missing-in-commons, empty
      libraryNames, confirm=false skips all pending, confirm omitted
      auto-pulls, up-to-date library never triggers confirm.
- [ ] `src/commands/sync.ts`: split today's `runSync` body into
      `runSyncV1(config, options)` (byte-identical to today, renamed) +
      new `runSyncV2(config, options)` (ensureRepo once on config.commons,
      materializeLibraries over config.libraries, reuse shipped
      materializeSkills, format combined output, exit 2 on any partial
      failure). New top-level `runSync` dispatches: try `loadConfigV2`
      first (v2 path on success); `reason:"missing"` → today's "run
      roboto-mem init"; else try `loadConfig` (v1) — success → v1 path
      (this is the backward-compat guarantee); else surface `loadConfigV2`'s
      detail (more specific than v1's would be for hybrid/newer configs,
      verified case-by-case, no string-matching involved — purely
      structural on `.ok`/`.reason`). `SyncOptions` gains optional
      `librariesTargetDir?` (test override, mirrors `skillsTargetDir`) and
      `confirmLibrarySync?: (message) => Promise<boolean>`.
- [ ] `tests/helpers/git.ts`: add `makeV2CommonsFixture(tmp, libraries?)`
      — new, additive-only (does not touch `makeCommonsFixture`, which
      stays exactly as-is given how widely it's already depended on) —
      v2 memory.json, seeds `libraries/<name>/<relPath>` files.
- [ ] RED tests: `tests/commands/sync.test.ts` v2 additions — clones a v2
      commons + syncs declared libraries to `~/.roboto-mem/libraries/`,
      confirm-injected TTY-yes/TTY-no/non-TTY(no confirm fn) branches,
      missing-in-commons library → exit 2, materializeSkills still runs
      for v2 too. All 5 EXISTING v1 tests must keep passing unchanged
      (proves backward-compat item 8).
- [ ] `src/commands/promote-library.ts` (new): `runPromoteLibrary({cwd,
      name, commonsUrl?, author, date, home?, librariesRoot?, ghRunner?})`
      — validates name/author/date, resolves commonsUrl (flag ||
      `loadConfigV2(cwd).config.commons`), validates local library exists
      (`~/.roboto-mem/libraries/<name>/LIBRARY.md`), ensureRepo, diffs
      old-commons-side vs local (dir-diff, pre-overwrite, "symmetrically"
      per its own doc comment) for the PR body, tree-hashes the local dir
      via the already-shipped `hashSkillDir` (generic enough — no new hash
      fn needed) for the commit message, checkout branch `library/<name>`
      → overwrite `libraries/<name>/` → add/diff-cached-quiet-shortcut/
      commit/push → `gh pr create` with compareUrl fallback (mirrors
      submitSkillPr's shape; NOT calling it directly — 5/7 aspects differ
      — target dir, branch prefix, commit/PR body, no provenance, no
      skillMdOnly — and promote.ts/skill.ts already independently
      duplicate this same git-plumbing shape today, so a third
      independent implementation matches existing precedent over forcing
      a premature shared abstraction).
- [ ] RED tests: `tests/commands/promote-library.test.ts` — real bare-git
      fixtures + ghStubFactory (mirrors skill.test.ts's style): first
      promote (new library, no prior commons copy), update path (diff
      body reflects changed files), no-op when identical, missing local
      library error, missing commons/config error, bad name/author/date
      gates.
- [ ] `src/cli.ts`: `promoteLibraryCmd` (name positional `required:
      false` + `reportMissingPositional` reuse, mirrors skillAdd/
      skillPromote's existing pattern exactly) declared before
      `promoteCmd`; `promoteCmd.run` manually dispatches on `rawArgs[0]
      === "library"` (see citty gotcha above) instead of citty
      `subCommands`. `syncCmd.run` builds a real `confirmLibrarySync`
      (clack confirm) only when `isInteractiveTty()`, else leaves it
      undefined (auto-pull) — no TTY-detection duplicated into sync.ts.
- [ ] `tests/cli.test.ts`: remove `"syncCmd"` from the `forbiddenWiring`
      `it.each` array (with a comment explaining why), keep
      digestCmd/lintCmd/statusCmd unchanged; "has exactly 7 subcommand
      keys" needs NO change (promote library is nested dispatch, not a
      new top-level key).
- [ ] 2 real end-to-end CLI-spawn cases in
      `tests/integration/interactive-mode.test.ts` (reuses the file's
      already-built cli.mjs): `promote library` missing NAME, and
      `promote --scope ... ` still works unaffected (regression proof for
      the citty gotcha fix).
- [ ] typecheck + lint + full suite + coverage; /simplify pass; report in
      3 sections (sync, materialize, promote) per the requester's ask.

Explicitly OUT of scope for Phase 4 (per spec section boundaries): token
budget enforcement (Phase 6/digest.ts), LIBRARY.md frontmatter schema
(never defined by the spec), guided/interactive promote-library flow
(task's CLI signature is flags-only, sync has no guided flow either),
falling back promote-library's commons-url resolution to v1 `loadConfig`
(v2-only concept; `--commons-url` flag always available as an explicit
out), digest.ts hook changes (still Phase 6 — `syncRepos`/
`materializeSkills` stay wired into the hook exactly as today).

### Review — Phase 4 shipped

All checklist items done. New: `src/core/library.ts` (materializeLibraries/
formatLibrariesReport — diff+confirm+apply pipeline over dir-diff.ts, plain
injected `confirm?` callback, all-or-nothing per-run gate), `src/commands/
promote-library.ts` (runPromoteLibrary — self-contained PR flow mirroring
submitSkillPr/runPromote's shape, not calling either directly — see the
"5/7 aspects differ + existing precedent of independent PR-flow
duplication" note above). Modified: `src/commands/sync.ts` (runSyncV1/
runSyncV2 split behind a structural dispatch — loadConfigV2 first, fall
back to loadConfig, else surface loadConfigV2's detail), `src/cli.ts`
(promoteLibraryCmd + manual `rawArgs[0] === "library"` dispatch inside
promoteCmd.run instead of citty subCommands; syncCmd builds the real
clack confirm and injects it).

Two things diverged from the plan mid-flight, both caught before they
became bugs:

1. **config.ts changed twice, concurrently, while sync.ts's dispatch was
   being designed.** First CONFIG_VERSION bumped 1→2 (broke the "v1Result.ok
   implies genuine v1" assumption my first dispatch draft relied on — a
   hybrid v2+legacy-fields config would have been silently misrouted to the
   v1 flow). Re-verified with a throwaway debug script
   (`loadConfig`/`loadConfigV2` against a hand-built hybrid raw object)
   before writing a word of sync.ts. Then, before I'd finished reacting, a
   second concurrent edit added an explicit `version === CONFIG_VERSION`
   guard to `validateConfig` (v1), which restored the original "v1Result.ok
   ⟹ genuine v1" invariant and let the dispatch logic stay simple/structural
   (no string-matching on CONFIG_V1_DEPRECATED_MESSAGE). Re-verified all 7
   dispatch cases by hand against the final config.ts state; all 8 v2 sync
   tests plus all 5 pre-existing v1 sync tests pass unchanged.
2. **citty's subCommands mechanism is unsafe for retrofitting onto a
   flag-only command.** Found via a throwaway probe against the installed
   citty@0.1.6 (not assumed): `subCommands` resolution scans raw argv for
   the first token not starting with `-`, with zero awareness of "this
   token is a flag's value" — giving promoteCmd a `library` subCommand
   directly makes `promote --scope org ...` throw `Unknown command \`org\``,
   AND citty never `return`s after a matched-subcommand dispatch (both the
   subcommand's run and the parent's own run fire). Fixed with manual
   dispatch (`rawArgs[0] === "library"` + `runCommand(promoteLibraryCmd,
   ...)` + immediate `return`), verified against the real built cli.mjs
   (not just unit tests) for both `promote --scope ...` (unaffected) and
   `promote library` (missing-NAME shows the right usage screen, not
   promoteCmd's).

Also found and fixed one pre-existing test-infra gap unrelated to either
of the above: `tests/helpers/cli-runner.ts`'s `rawRun` strips the NODE_ENV/
TEST/VITEST/CI/GITHUB_ACTIONS env family but not FORCE_COLOR — 2
interactive-mode.test.ts tests fail on any machine with FORCE_COLOR set
locally (reproduced on the clean pre-Phase-4 tree via `git stash`, so not
caused by this work). Left unfixed — out of scope for this task, flagged
here instead of silently patching shared test infra as a drive-by.

Tests: 396 (Phase 1 baseline) → 449 (+53, on top of the concurrent Phase 2
work also landing during this session): library.test.ts +9, sync.test.ts
+8 (v2 flow: multi-library sync, non-TTY auto-pull, confirm-yes,
confirm-no/skip, missing-in-commons partial failure, skills-still-
materialize, missing-config parity, hybrid-config error routing),
promote-library.test.ts +9 (new-library PR, update/no-op path via a real
merge-then-diverge cycle, missing-local-library, commons-url flag vs v2-
config fallback, missing-both error, author/date/name gates, gh-
unavailable fallback), cli.test.ts unchanged count (forbiddenWiring array
edited, not grown), interactive-mode.test.ts +2 (real built-CLI proof for
both citty-dispatch directions).

Coverage: library.ts 98.24%/91.66%/100%/98%, sync.ts 97.67%/93.33%/100%/
97.56%, promote-library.ts 86.36%/85.71%/83.33%/88.33% (in line with
sibling promote.ts 82.1%/68.33% and skill.ts 82.12%/72.11% — uncovered
lines are the never-unit-tested `defaultGhRunner` and a git-push-failure
branch, both pre-existing-shaped gaps, not new ones). Repo-wide:
92.98%/85.24%/95.91%/94.05%, all four thresholds (80%) cleared.

Gates: typecheck/lint/test(449/449)/build all green. Reverted dist/cli.mjs
after two verification builds (manual citty-dispatch probing + a full
tsdown build) — Phase 4 is source+tests only, no release intended, same
precedent as Phase 1.

## Demo video remake — v2 global library model — 2026-07-20

Goal: rewrite tapes + Remotion studio so every demo reflects the v2 library model, then re-render all assets. No commits without explicit approval.

### Plan

- [x] Explore: v2 CLI surface (agent) + demo infra (agent)
- [x] Rebuild dist/cli.mjs from branch head (post-CodeRabbit fixes)
- [x] Scope decision: status/promote/skill are v1-only on this branch → keep clips 01-14 on the v1 world (re-render), ADD clips 15-19 for v2 (migrate, init-libraries, library-sync, library-digest, promote-library); recut hero to 01,16,17,18,08,10
- [x] Agent: extend make-demo-world.sh (commons-v2 + acme-api v2-bound + teammate-update-library) + write tapes 15-19 + docs/demos/README.md sections (tape 16 uses the real interactive flow — bare `init` → mode select → URL → detect confirm; `--commons-url` on TTY routes to v1 prompts)
- [x] Agent: studio clips.ts 15-19 + HERO_CLIP_IDS recut + TitleCard "Standards · Lessons · Libraries" (tsc + eslint clean)
- [x] Render tapes via scripts/render-demos.sh; verified: 18/18 fresh, gifs ≤948K (cap 5MB), frame-checked 15/16/18 (v2) + 05 (v1 regression); 11-claude-live kept from manual recording
- [x] Render studio via scripts/render-videos.sh; verified: 18 features + hero.mp4 (97.9s, 7.4MB) + hero.gif (7.3MB), all fresh
- [x] Spot-check frames (hero @30s shows v2 bind segment; end card intact); docs/demos/README.md updated by tapes agent
- [ ] Review section below; WAIT for commit approval

## Panel redo — interactive-first, stale clips removed — 2026-07-20 (same session)

Hrithik: "remove the old videos as these are stale ones and use the interactive
features ? like re do the intire panel"

New panel (01-14, one narrative): 01 scaffold (guided) · 02 bind w/ libraries
(interactive) · 03 migrate · 04 library-sync · 05 library-digest · 06 hook ·
07 promote (guided) · 08 scan · 09 lint · 10 promote-library · 11 claude-live
(kept) · 12 skill-add (guided) · 13 skill-sync · 14 resilience (v2 world).
REMOVED: 02-init-bind, 03-sync, 05-status (status errors on v2 — flagged as
gap), 06-digest, 12-overlays (v2 = single commons).

- [x] Renumber/rename tapes + fix Output lines (13 offline tapes)
- [x] Purge stale rendered outputs (kept 11-claude-live gif/mp4 everywhere)
- [x] Agent: interactive tapes 01/07/12 (pty-discovered prompt flows: scaffold
      = 2 Downs on mode select; promote = 8 steps + recap + confirm, prefills
      Ada Demo/today; skill add = source → skip skill → HEAD ref → author →
      confirm), rework 06/14 onto v2 world, world trimmed (teammate-push,
      add-overlay, client-memory removed; bash -n + pnpm lint clean)
- [x] Agent: studio manifest rewrite (13 clips, hero = 01,02,04,05,07,10) — tsc + eslint clean, no stale ids
- [x] Agent: docs/demos/README.md catalog rewrite + root README demo section
      (14-clip panel, all v0.3.0 URLs, stale-id greps clean)
- [x] Full render: 13 tapes + remotion features + hero; frame-check; summary

### Review — panel redo (2026-07-20 evening)

- Panel is now 14 clips (13 offline + live), interactive-first, one narrative.
  Removed: 02-init-bind, 03-sync, 05-status, 06-digest, 12-overlays (+ their
  outputs everywhere). 11-claude-live preserved (auth-gated manual recording).
- Guided flows recorded for real: init scaffold (mode select), init bind w/
  library detection, promote (8 prompts + recap + confirm), skill add.
  Prompt sequences pty-discovered before scripting; option orders documented
  in tasks agent report.
- RACE FOUND + FIXED in full-pass verification: tape 04's 2s post-sync sleep
  occasionally let the next Type interleave with sync output (caught in a
  hero frame). Bumped post-sync sleeps across 04/06/07/13/14 (3-5s),
  re-rendered, re-verified frames. Lesson: frame-check EVERY pass, not just
  the first; sleeps after any git-touching command ≥3s.
- World: overlay repo + teammate-push + add-overlay removed (unreferenced);
  bash -n + pnpm lint clean. Studio: 13-clip manifest, hero = 01,02,04,05,
  07,10 (tsc+eslint clean). READMEs: catalog rewritten, root demo section
  on v0.3.0 URLs, stale-id greps clean.
- KNOWN GAP flagged to Hrithik: `status` (and entry promote/skill cmds) are
  v1-only — no status clip exists in the new panel; add one back when v2
  status ships.
- Nothing committed; render outputs gitignored; release upload manual.

### Review — demo video remake (2026-07-20)

Shipped (working tree only, nothing committed):
- New tapes 15-19 covering the v2 library model: migrate (reviewed two-step config
  upgrade), init-libraries (genuine interactive flow: bare `init` → mode select →
  URL → detection confirm — `--commons-url` on a TTY routes to v1 prompts, found
  and worked around), library-sync (materialize + teammate edit arrives, TTY diff
  confirm), library-digest ([global]/[library:resend] labels, format-2 header),
  promote-library (edit → branch → PR).
- make-demo-world.sh: +commons-v2.git (formatVersion 2, 4 LIBRARY.md guides,
  3 flat entries), +acme-api (v2-bound in-world), demo-app deps → next/react/resend,
  +bin/teammate-update-library. v1 world byte-identical.
- Studio: clips.ts +5 entries, hero recut 01→16→17→18→08→10, title card
  "Standards · Lessons · Libraries". tsc + eslint clean.
- Renders: 18/18 tapes fresh (gifs ≤948K), 18 captioned features, hero 97.9s.
  Frame-verified 15/16/18 (v2), 05 (v1 regression), hero mid+end.
- Constraint honored: status/promote/skill are v1-only on this branch → clips
  01-14 stay on the v1 world; 11-claude-live preserved from manual recording.
- Outputs gitignored as before; release upload remains manual at tag time.

## PR #15 review fixes — CodeRabbit + independent review — 2026-07-22

Goal: apply the reviewed fixes, verify, re-review the diff, push to feat/global-library-model (push approved this session).

### Plan

- [x] promote-library: stale-clone guard + librariesRoot derived from home (+tests)
- [x] library.ts: planLibrary failures land in report.failed instead of crashing runSync (+test)
- [x] interactive/prompts: trim commons URL (v1+v2) + wire loadGlobalConfig prefill (+tests)
- [x] init: reword phantom `update-libraries` message; reject `--project`+`--libraries` (+tests)
- [x] migrate: always-on note that legacy-scoped entries drop until commons retag (+digest test)
- [x] lint: invalid-ref message lists all 3 accepted forms; library-detect filters non-grammar dir names (+tests)
- [x] config.test: wire ROBOTO_MEM_CONFIG_HOME so precedence tests can fail
- [x] Dockerfile.test: non-root, --no-install-recommends, roboto-mem symlink; new .dockerignore (image build verified on colima: full suite green as node user, symlink works)
- [x] README: v2-first quickstart, migrate + promote-library rows, library scoping section
- [x] Verify: typecheck + lint + full suite; review-agent pass on the combined diff; commit + push

### Review

All 8 fix groups + Docker hardening + README pass applied by parallel agents on
disjoint files; adversarial review agent verdict: ship-ready (2 LOW wording items,
both fixed: documented the EACCES test's non-root requirement; corrected the v2
override wording in README). Gates: typecheck clean, biome clean, 537/537 tests
(526 -> 537, +11). Dockerfile.test verified end-to-end on colima: image builds,
full suite passes as USER node, `roboto-mem --help` works via the new
/usr/local/bin symlink (one fix found in-build: /app was root-owned from WORKDIR;
now chowned). Remaining before merge (manual): upload renumbered demo assets to
the release tag (README links 404 until then). Follow-ups (not this PR): dynamic
commons default branch (main hardcoded in promote/skill/promote-library,
pre-existing); TTY `init --commons-url` alone still routes to guided v1 prompts.

Declined after verification (pushed back on CodeRabbit): digest libraries-are-URLs (false premise — bare names everywhere), init dispatch misroute (false premise — v1 loader refuses configVersion 2), rm-before-rename swap (mirrors shipped copySkill; derived cache, next sync restores), commons-namespaced library cache (documented accepted limitation in the design spec). Follow-up ticket, not this PR: resolve commons default branch dynamically — `main` is hardcoded identically in promote.ts, skill.ts, and promote-library.ts (pre-existing).
