# Lessons — roboto-mem

## From Hrithik's corrections this build

**Monorepos are the default, not the edge case.** Mid-grilling correction: stack auto-detection planned against a root package.json; half of work/roboto is Turborepo monorepos. Rule: any Roboto tooling that inspects a repo must walk workspaces (pnpm-workspace.yaml, workspaces field) and read framework config files, not just root deps. Single-package repos are the degenerate case.

**Ask for scale in the first three questions.** The design was grilled for a small team; "this will be used by 100-200 people" arrived late and reopened topology, governance, review tiers, and compat windows. Rule: for any internal tool, pin down "how many people, one org or many, any confidentiality boundaries" before the architecture fork, not after.

## From the build itself

**Parallel implementer agents drift in exactly two ways:** cross-module duplication (same regex/helper re-invented per module) and convention violations in files the prompt's verification grep didn't cover (the `let`-in-tests leak). Counter: put the repo-wide grep in every prompt's verification block, and budget a reuse-angle review pass at the end.

**Spec reviewers must re-derive, not re-read.** The wave reviews that caught real bugs (stale-date precedence, declared-budget clobber, branch stacking) were the ones that traced data flow and ran probes — not the ones comparing code to the checklist. Prompt reviewers to enumerate return paths and reproduce empirically.

**Bundled artifacts must be verified from OUTSIDE the repo.** dist/cli.mjs passed every test while shipping bare imports of citty/yaml/tinyglobby — module resolution silently found the repo's node_modules from the script's path, so "node dist/cli.mjs works" proved nothing. tsdown (library-mode default) externalizes `dependencies`. Rule: any committed bundle gets an isolation test (copy to a temp dir, run it there), and never trust an agent's "bundles deps by default" claim — measure.

**Test-env vars silence CLI frameworks.** citty/consola suppress ALL output (even --version) when NODE_ENV=test or TEST=true — both set by vitest and inherited by spawned children. And consola prints --version/usage to stderr, not stdout. Rule: when testing a CLI binary, strip the test-env family from the child env and assert on merged streams.

**Hook-contract code needs a totality audit.** Anything invoked from a SessionStart hook must be reviewed for "can ANY path throw/exit nonzero/print non-JSON" — unit-green code still crashed on EISDIR and a blocked cache dir. Final holistic review caught it only because it attacked the built bundle.

## Demo-asset production (2026-06-12)
- **VHS tape strings**: `\"` escapes are parse errors — wrap strings containing double quotes in backticks. `Output /abs/path` also fails (leading `/` reads as regex) — use CWD-relative output paths and pin the render script's CWD.
- **VHS Wait vs TUI programs**: `Wait+Line`/`Wait+Screen` read a stale buffer across an alt-screen lifecycle (claude's spinner UI) — content never "appears" to the poller. For TUI-launching beats use fixed sleeps and verify content post-hoc by frame extraction. For plain commands, content-anchored `Wait+Screen /expected-output/` doubles as an assertion.
- **ffmpeg multi-output trap**: `-ss A -i f.mp4 -frames:v 1 a.png -ss B -i f.mp4 -frames:v 1 b.png` maps input 0 to ALL outputs without explicit -map — every "frame" was the same frame. One invocation per extraction.
- **Background Bash + persisted cwd**: the shell's working directory persists across tool calls — a backgrounded `npm install` meant for a subdir ran at repo root (nearly polluted product deps). Always absolute-path or `cd <abs> && ...` inside the same command string.
- **Demo worlds**: fixed literal path (/tmp/roboto-mem-demo) because CLI output displays URLs — fixed paths keep recordings reproducible. Rebuild before EVERY tape; tapes that mutate (promote, resilience) can't contaminate the next.
- **Live-agent demos**: pin the model's answer to the injected context ("From the Team Memory digest only… quote exact entry names") or personal config bleeds in and muddies what the demo proves. Keep planted secrets obviously fake (AKIAIOSFODNN7EXAMPLE = AWS's documented example key).
