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
