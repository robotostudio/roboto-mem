# roboto-mem in action

Every feature, demonstrated against a real (local) Commons. Each clip is a scripted, reproducible recording of the actual CLI — rebuild them any time with `scripts/render-demos.sh`.

<!-- TODO(release): GIF URLs below point at v0.3.0 release assets. Upload via
     `gh release upload` after the release exists; until then render locally
     into docs/demos/{gif,mp4} (gitignored) and view from disk. -->

The demos run in a throwaway world at `/tmp/roboto-mem-demo` — a v1 file-based Commons (`commons.git`), a v2 Commons with libraries (`commons-v2.git`), a v1-bound project (`acme-web`), a v2-bound project (`acme-api`), and an unbound one (`demo-app`). Nothing touches your real `~/.roboto-mem` or git config. `teammate-add-skill` and `teammate-update-library` are world-local helpers that commit changes to the Commons, standing in for a colleague.

## 1. Scaffold the Commons

One command creates the shared memory repo: entry directories, `memory.json`, CODEOWNERS for review routing, a token-free CI workflow, and a vendored copy of the CLI so that CI works on private repos with zero secrets.

```sh
roboto-mem init . --commons
```

![init --commons](https://github.com/robotostudio/roboto-mem/releases/download/v0.3.0/01-init-commons.gif)

## 2. Bind with auto-detected libraries

Point `init` at a v2 Commons and it reads your `package.json`, intersects your dependencies with the libraries the team maintains, and proposes the match — confirm it, add to it, or trim it before anything is written. Passing `--libraries` pins the list and skips the prompts entirely.

```sh
roboto-mem init
```

![init libraries](https://github.com/robotostudio/roboto-mem/releases/download/v0.3.0/02-init-libraries.gif)

## 3. Migrate to the library model

v2 replaces project/squad/stack scoping with one flat list: the libraries this repo uses. `migrate` writes the converted config next to the original — `.roboto-mem.json.migrated` — with notes on anything worth a second look, and never touches the original. You review the result and `mv` it into place yourself.

```sh
roboto-mem migrate
```

![migrate](https://github.com/robotostudio/roboto-mem/releases/download/v0.3.0/03-migrate.gif)

## 4. Libraries arrive on sync

Sync materializes each declared library into `~/.roboto-mem/libraries/<name>/`, where your agent reads the full guide on demand. When a teammate improves one, your next sync shows the pending change and pulls it — the whole team converges on the same guidance without anyone copying files.

```sh
roboto-mem sync
```

![library sync](https://github.com/robotostudio/roboto-mem/releases/download/v0.3.0/04-library-sync.gif)

## 5. The v2 digest

Global standards always apply; library-scoped entries load only in repos that declare that library. The digest labels each item with its scope — `[global]` first, then `[library:<name>]` — so a payments repo never pays context for the mobile team's rules.

```sh
roboto-mem digest
```

![library digest](https://github.com/robotostudio/roboto-mem/releases/download/v0.3.0/05-library-digest.gif)

## 6. The Claude Code hook

Hook mode wraps the digest in a SessionStart envelope. The plugin runs this on every session start, resume, and clear — your Team Memory is simply present, in every session, for everyone.

```sh
roboto-mem digest --hook
```

![digest --hook](https://github.com/robotostudio/roboto-mem/releases/download/v0.3.0/06-digest-hook.gif)

## 7. Promote — guided flow

Turn a local note into a proposed entry. Bare `promote` prompts for scope, type, name, description, author, and body file, validates, scans for secrets, then pushes a branch and opens a PR. Nothing enters the Commons unreviewed — promotion is a proposal, not a write.

```sh
roboto-mem promote
```

![promote](https://github.com/robotostudio/roboto-mem/releases/download/v0.3.0/07-promote.gif)

## 8. The secret scan is not negotiable

If the entry body contains key material, promotion stops — and `--force` does not change that. Findings are printed redacted, so the demo (and your terminal history) never re-leaks the secret. Swap the value for an angle-bracket placeholder and promote again.

![promote scan](https://github.com/robotostudio/roboto-mem/releases/download/v0.3.0/08-promote-scan.gif)

## 9. Lint — the CI gate

The Commons CI runs `lint` on every PR using the vendored CLI (`node .roboto-mem/cli.mjs lint .`). Same checks as promote, same redaction, hard exit 1. Placeholders like `<from-1password>` pass by design.

```sh
roboto-mem lint .
```

![lint](https://github.com/robotostudio/roboto-mem/releases/download/v0.3.0/09-lint.gif)

## 10. Promote a library

Your local copy of a library is editable. When you've improved it, `promote library` diffs it against the Commons, pushes a `library/<name>` branch, and opens a PR — the same reviewed path entries take, so a library guide never changes without the team seeing it.

```sh
roboto-mem promote library resend --author ada
```

![promote library](https://github.com/robotostudio/roboto-mem/releases/download/v0.3.0/10-promote-library.gif)

### The proof — a live session

A real `claude -p` run in a bound repo. The plugin injects the digest at session start; Claude cites Team Memory by name and writes code that follows it without being told. This is the one clip that isn't offline-reproducible — it needs Claude auth — so it's recorded separately (`docs/demos/tapes/live/claude.tape`).

![live Claude session](https://github.com/robotostudio/roboto-mem/releases/download/v0.3.0/11-claude-live.gif)

## 11. Team Skills — vendor once

Skills travel through the same reviewed pipeline as entries. `skill add` clones the upstream repo, pins the exact commit into `.provenance.json`, validates the skill, runs the secret scan, and opens a PR on the Commons. Running it again later is the update path — the PR diff shows exactly what changed upstream.

```sh
roboto-mem skill add <owner>/<repo> --author ada
```

![skill add](https://github.com/robotostudio/roboto-mem/releases/download/v0.3.0/12-skill-add.gif)

## 12. Team Skills — sync delivers

Once a skill PR merges, every teammate's next sync materializes it into `~/.claude/skills/`, where Claude Code discovers it — nobody runs an install. `status` reports the picture: materialized count, personal shadows, drift. Remove the skill from the Commons and the next sync cleans it up.

![skill sync](https://github.com/robotostudio/roboto-mem/releases/download/v0.3.0/13-skill-sync.gif)

## 13. Built for unreliable networks

A dead VPN or a git-host outage doesn't take your sessions down. With a cache present, sync reports `stale (offline?)` and the digest keeps working from the last good copy (honestly labelled `synced unknown`). Only a missing cache is a real failure.

![sync resilience](https://github.com/robotostudio/roboto-mem/releases/download/v0.3.0/14-sync-resilience.gif)

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
scripts/render-demos.sh 08-promote-scan   # just one
```

Tapes live in `docs/demos/tapes/`; the world generator is `scripts/make-demo-world.sh`. MP4 versions of every clip are produced alongside the GIFs.
