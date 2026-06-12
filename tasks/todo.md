# roboto-mem v1 — execution tracker

Full plan: [docs/superpowers/plans/2026-06-12-roboto-mem-v1.md](../docs/superpowers/plans/2026-06-12-roboto-mem-v1.md)
Rule in force: NO commits/pushes — every task ends at tests + typecheck + lint + summary.

## Wave 0 — foundation
- [x] Task 0: toolchain scaffold — tsdown 0.12.9 (outputOptions.banner for shebang), vitest 4.1.8, biome 2.4.16; all gates verified by controller

## Wave 1 — pure cores (parallel) — ALL SPEC-REVIEWED ✅, quality review in flight
- [x] Task 1: core/entry.ts — spec ✅; double-cast fixed (typed IIFE)
- [x] Task 2: core/scopes.ts — spec ✅; workspace filter tightened to stack/, isValidScope simplified
- [x] Task 3: core/config.ts — spec ✅
- [x] Task 4: core/detect.ts — spec ✅ (tinyglobby trailing-slash strip verified empirically)
- [x] Task 6: core/exec.ts — spec ✅; dead killed-ternary removed
- [x] Task 10: core/dedupe.ts — spec ✅ (fixture corrected: spec's moderate example scored below threshold)
- [x] Task 11: core/scan.ts — spec ✅ (regexes probe-verified, redaction never leaks)
- [x] Task 17: plugin shell — spec ✅ (manifests exact, promote carries confirm-before-push)
- [x] De-let pass: zero `let` declarations repo-wide (incl. tests)
- Gate after fixes: 63/63 tests, typecheck + lint clean

## Wave 2 — composition (parallel after wave 1) — IN FLIGHT
- [ ] Task 5: commands/init.ts + commons templates — DEVIATION (approved): templates embedded as string constants in src/commands/commons-templates.ts, no templates/ dir (single-file bundle can't resolve sibling files reliably)
- [ ] Task 7: core/memory-repo.ts (real-git fixtures, clone/pull, format gate) + tests/helpers/git.ts
- [ ] Task 8: core/digest.ts + cache (compile, overrides, budgets, stale/nag lines)
- [x] Stage-2 quality review of wave 1 — no blockers; fix pass queued (post-wave-2):
  - scan.ts: span-containment filter (suppress warning inside error span) + tests
  - exec.ts: widen failure arm with reason "exit"|"spawn"|"timeout"|"maxbuffer" + update tests (do BEFORE wave 3 — promote/sync will branch on it)
  - config.ts: validate array elements are strings (squads/overlays/workspaces leaves)
  - entry.ts: extract parseFrontmatter helper (replace IIFE)
  - detect.ts: one-line comment on pnpm-over-npm precedence
  - WAIVED: entry error-shape reason enum (YAGNI until something branches on it)

## Wave 3 — orchestration — DONE (152/152 gate green), spec review in flight
- [x] Task 9: sync + digest commands — hook-never-blocks invariant proven across 11 paths
- [x] Task 12: promote — nothing-written-before-gates; secrets/collisions never forceable
- [x] Task 13: lint — multi-segment override-ref parsing verified
- [x] Task 14: status — pure reads; repoDirFor exported from memory-repo
- [x] Wave-2 fix pass: truthful README template, zero `let` repo-wide, corrupt config fails loud

## Wave 4 — surface + gate — ALL DONE
- [x] Tasks 15+16: cli.ts citty wiring + update-check nag (double failure-isolation)
- [x] Wave-3 spec review → fix pass: stale-date precedence, declaredBudgets merge, promote branch hygiene, weak-test strengthening
- [x] Task 18: integration e2e (full loop + stale fallback) + real-bundle e2e; coverage 92/82/97/93
- [x] Task 19: /simplify (4-angle, 7 applied / 11 skipped with reasons) + final holistic review → hook-crash fixes (best-effort writeCache, total loadConfig, cli hook guard)

## Review (final state)
- 180/180 tests, 19 files; typecheck + biome clean (42 files); coverage S92.07 B81.85 F97.27 L93.01
- dist/cli.mjs 52.4 kB single file, shebang, --version 0.1.0, byte-reproducible builds
- Verified system properties: hook path can never exit nonzero / print non-JSON (empirically attacked); promote never touches main, secret-scan unforceable; no shell anywhere (execFile array-args only); zero `let` repo-wide
- NOT COMMITTED — zero git history by design; awaiting Hrithik's explicit word
- Known cosmetic: tsdown prints a harmless internal "define" warning on build (their bug, recheck on bump)

## Open / parked
- [x] GitHub home: private robotostudio/roboto-mem created, placeholder swept (7 spots, 5 files), remote added — awaiting "commit"/"push"
- NEW: private-repo CI wrinkle — memory-repo CI's `npx github:robotostudio/roboto-mem` needs read access (token or internal visibility); solve when the Commons is set up
- Overlay-overrides-Commons review flow (parked in grilling)
- migrate command deferred until a v2 schema exists

## Demo assets — GIFs + videos + instructions for every feature (plan: ~/.claude/plans/mighty-sprouting-newt.md)
- [x] Install VHS 0.11 (brew) + official remotion-best-practices skill (365K installs)
- [x] Verify scan rules / update-check throttle / memoryHome against source (caught: sk-demo- bait needed no second hyphen)
- [x] scripts/make-demo-world.sh — offline world at /tmp/roboto-mem-demo (bare commons + teamwork + acme-web bound + shims)
- [x] Hand-verify every CLI command in the world (caught: promote requires --author; VHS strings need backticks when they contain double quotes)
- [x] lib/style.tape + lib/world.tape + 10 feature tapes — ALL RENDERED, 139-613KB/gif, frames audited (scan-block arc + 880px digest + ❯ prompt all correct)
- [x] scripts/render-demos.sh — rebuild world per tape, serial, size report
- [x] 11-claude-live RECORDED (947K gif): cites [org] never-use-let + [squad/web] let-hotpaths override, emits const/reduce code — frame-audited. (VHS Wait broke across claude's alt-screen; fixed sleeps + post-hoc frame audit instead)
- [x] Remotion studio scaffolded (4.0.475) + FeatureClip/Hero/Root written, tsc + eslint clean — LICENSE FLAG: free only ≤3-person companies; Hrithik to confirm Roboto headcount before public use
- [x] Video renders DONE: 10 captioned features (1-3MB) + hero.mp4 89s/7MB + hero.gif 7.3MB — title/mid/end frames audited
- [x] docs/demos/README.md instructions page + root README hero/"See it in action" + .gitignore for binaries
- [x] Final gate: 181/181 tests, biome clean, build 485kB byte-identical dist, studio tsc+eslint clean, determinism re-render 0.2% byte drift / identical content

## Review — demo assets (2026-06-12 afternoon)
- 24 binary assets in docs/demos/{gif,mp4} + out/: 11 raw GIF+MP4 pairs (139K-947K gifs), 10 captioned feature MP4s, hero walkthrough (89s, title→6 chapters→install card)
- All offline-reproducible except live/claude.tape (needs auth); scripts/render-demos.sh + render-videos.sh rebuild everything
- Docs: docs/demos/README.md (journey-ordered instructions, release-asset URL placeholders), README hero + "See it in action"
- NOT COMMITTED, NO RELEASE — embeds 404 until v0.1.0 release assets are uploaded (Hrithik's explicit word required)
- Upload manifest when that day comes: 11 gifs from docs/demos/gif/, CAPTIONED mp4s from docs/demos/out/features/ as plain <id>.mp4 (raw mp4s stay local-only), 11-claude-live.mp4 from docs/demos/mp4/ (no captioned version), hero.gif + hero.mp4 from docs/demos/out/
- Remotion license: confirm Roboto Studio ≤3 people before shipping studio publicly
