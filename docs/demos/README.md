# roboto-mem in action

Every feature, demonstrated against a real (local) Commons. Each clip is a scripted, reproducible recording of the actual CLI — rebuild them any time with `scripts/render-demos.sh`.

<!-- TODO(release): GIF URLs below point at v0.1.0 release assets. Upload via
     `gh release upload` after the release exists; until then render locally
     into docs/demos/{gif,mp4} (gitignored) and view from disk. -->

The demos run in a throwaway world at `/tmp/roboto-mem-demo` — a file-based Commons, a bound project (`acme-web`), and an unbound one (`demo-app`). Nothing touches your real `~/.roboto-mem` or git config. `teammate-push` is a world-local helper that commits a Standard to the Commons, standing in for a colleague; `teammate-add-skill` does the same with a Team Skill.

## 1. Scaffold the Commons

One command creates the shared memory repo: entry directories, `memory.json`, CODEOWNERS for review routing, a token-free CI workflow, and a vendored copy of the CLI so that CI works on private repos with zero secrets.

```sh
roboto-mem init . --commons
```

![init --commons](https://github.com/robotostudio/roboto-mem/releases/download/v0.1.0/01-init-commons.gif)

## 2. Bind a project

Point a repo at your Commons. Stacks are detected from `package.json` (react → `stack/react`), squads come from you, and the resulting session scopes decide which entries this repo receives.

```sh
roboto-mem init . --commons-url <your-commons-git-url> --project demo-app --squads web
```

![init bind](https://github.com/robotostudio/roboto-mem/releases/download/v0.1.0/02-init-bind.gif)

## 3. Sync

`sync` clones the Commons on first run and fast-forwards after that. When a teammate lands a new Standard, your next sync picks it up — no copying files between repos, no Slack reminders.

```sh
roboto-mem sync
```

![sync](https://github.com/robotostudio/roboto-mem/releases/download/v0.1.0/03-sync.gif)

## 4. Status

The at-a-glance view: what you're bound to, which scopes apply here, entry counts, and how fresh your local copy is.

```sh
roboto-mem status
```

![status](https://github.com/robotostudio/roboto-mem/releases/download/v0.1.0/05-status.gif)

## 5. The digest

What your agent actually reads. Standards appear in full, grouped by scope. An Override replaces the overridden Standard's body with a pointer, so there's never a contradiction in context. Lessons are a one-line index — read on demand, not paid for on every session.

```sh
roboto-mem digest
```

![digest](https://github.com/robotostudio/roboto-mem/releases/download/v0.1.0/06-digest.gif)

## 6. The Claude Code hook

Hook mode wraps the digest in a SessionStart envelope. The plugin runs this on every session start, resume, and clear — your Team Memory is simply present, in every session, for everyone.

```sh
roboto-mem digest --hook
```

![digest --hook](https://github.com/robotostudio/roboto-mem/releases/download/v0.1.0/07-digest-hook.gif)

### The proof — a live session

A real `claude -p` run in a bound repo. The plugin injects the digest at session start; Claude cites `[org] never-use-let` by name and writes `const`/`reduce` code without being told. This is the one clip that isn't offline-reproducible — it needs Claude auth — so it's recorded separately (`docs/demos/tapes/live/claude.tape`).

![live Claude session](https://github.com/robotostudio/roboto-mem/releases/download/v0.1.0/11-claude-live.gif)

## 7. Promote

Turn a local note into a proposed entry. Promote validates, checks for collisions and near-duplicates, scans for secrets, then pushes a branch and opens a PR. Nothing enters the Commons unreviewed — promotion is a proposal, not a write.

```sh
roboto-mem promote --scope squad/web --type standard --name zod-at-boundaries \
  --description "Validate at boundaries with zod" --author ada --body-file note.md
```

![promote](https://github.com/robotostudio/roboto-mem/releases/download/v0.1.0/08-promote.gif)

## 8. The secret scan is not negotiable

If the entry body contains key material, promotion stops — and `--force` does not change that. Findings are printed redacted, so the demo (and your terminal history) never re-leaks the secret. Swap the value for an angle-bracket placeholder and promote again.

![promote scan](https://github.com/robotostudio/roboto-mem/releases/download/v0.1.0/09-promote-scan.gif)

## 9. Lint — the CI gate

The Commons CI runs `lint` on every PR using the vendored CLI (`node .roboto-mem/cli.mjs lint .`). Same checks as promote, same redaction, hard exit 1. Placeholders like `<from-1password>` pass by design.

```sh
roboto-mem lint .
```

![lint](https://github.com/robotostudio/roboto-mem/releases/download/v0.1.0/10-lint.gif)

## 10. Two memory repos at once — Overlays

A project can read a second memory repo on top of the Commons (agency case: company rules + client rules). Add its URL to the `overlays` array in `.roboto-mem.json`; sync reports each repo on its own line and the digest merges entries from both.

![overlays](https://github.com/robotostudio/roboto-mem/releases/download/v0.1.0/12-overlays.gif)

## 11. Built for unreliable networks

A dead VPN or a git-host outage doesn't take your sessions down. With a cache present, sync reports `stale (offline?)` and the digest keeps working from the last good copy (honestly labelled `synced unknown`). Only a missing cache is a real failure.

![sync resilience](https://github.com/robotostudio/roboto-mem/releases/download/v0.1.0/04-sync-resilience.gif)

## 12. Team Skills — vendor once

Skills travel through the same reviewed pipeline as entries. `skill add` clones the upstream repo, pins the exact commit into `.provenance.json`, validates the skill, runs the secret scan, and opens a PR on the Commons. Running it again later is the update path — the PR diff shows exactly what changed upstream.

```sh
roboto-mem skill add <owner>/<repo> --author ada
```

![skill add](https://github.com/robotostudio/roboto-mem/releases/download/v0.2.0/13-skill-add.gif)

## 13. Team Skills — sync delivers

Once a skill PR merges, every teammate's next sync materializes it into `~/.claude/skills/`, where Claude Code discovers it — nobody runs an install. `status` reports the picture: materialized count, personal shadows, drift. Remove the skill from the Commons and the next sync cleans it up.

![skill sync](https://github.com/robotostudio/roboto-mem/releases/download/v0.2.0/14-skill-sync.gif)

---

## Produced videos

Beyond the raw clips, `docs/demos/studio/` (a Remotion project) renders captioned MP4s of every feature plus the hero walkthrough embedded at the top of the main README — title, one-line explanation, and an end card with the install commands.

```sh
scripts/render-videos.sh    # consumes docs/demos/mp4/, writes docs/demos/out/
```

## Rebuilding these demos

```sh
brew install vhs            # one-time; first run downloads a headless browser
scripts/render-demos.sh     # all tapes, fresh world per tape, ~8 min
scripts/render-demos.sh 09-promote-scan   # just one
```

Tapes live in `docs/demos/tapes/`; the world generator is `scripts/make-demo-world.sh`. MP4 versions of every clip are produced alongside the GIFs.
