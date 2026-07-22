# roboto-mem

Team Memory for Claude Code — your team's Standards and Lessons, synced into every session.

[![npm](https://img.shields.io/npm/v/roboto-mem)](https://www.npmjs.com/package/roboto-mem)
[![license](https://img.shields.io/npm/l/roboto-mem)](LICENSE)

<!-- TODO(release): GIF URLs below point at v0.3.0 release assets. Upload via
     `gh release upload` after the release exists; until then render locally
     into docs/demos/{gif,mp4} (gitignored) and view from disk. -->
![roboto-mem walkthrough](https://github.com/robotostudio/roboto-mem/releases/download/v0.3.0/hero.gif)

[Watch the walkthrough as MP4](https://github.com/robotostudio/roboto-mem/releases/download/v0.3.0/hero.mp4)

New to all of this? Start with **[the friendly guide](docs/INSTRUCTIONS.md)** — every command explained from zero, with a video for each step. No git expertise needed.

## What it is

roboto-mem gives your team a Team Memory: a git-backed knowledge base synced into every Claude Code session. Entries are Standards (authored rules, always in force) or Lessons (learned gotchas, indexed, read on demand), and the Digest — the scope-filtered view of what applies to this repo — is injected at session start. New Entries arrive only through Promotion, the explicit, reviewed act of adding an Entry: it opens a PR, and nothing enters unreviewed.

## See it in action

The digest your agent reads — global standards and library-scoped entries, each labeled with its scope:

![library digest](https://github.com/robotostudio/roboto-mem/releases/download/v0.3.0/05-library-digest.gif)

A real session: Claude cites Team Memory by name and writes code that follows it without being told:

![live Claude session](https://github.com/robotostudio/roboto-mem/releases/download/v0.3.0/11-claude-live.gif)

The secret scan stops a promotion, and `--force` doesn't change its mind:

![secret scan](https://github.com/robotostudio/roboto-mem/releases/download/v0.3.0/08-promote-scan.gif)

A teammate's merged Team Skill lands in `~/.claude/skills/` on your next sync — adopted once, everywhere:

![team skills sync](https://github.com/robotostudio/roboto-mem/releases/download/v0.3.0/13-skill-sync.gif)

All fourteen clips, with instructions for every feature: [docs/demos](docs/demos/README.md).

Prefer video? Captioned MP4s of every feature:
[scaffold the Commons](https://github.com/robotostudio/roboto-mem/releases/download/v0.3.0/01-init-commons.mp4) ·
[init with libraries](https://github.com/robotostudio/roboto-mem/releases/download/v0.3.0/02-init-libraries.mp4) ·
[migrate](https://github.com/robotostudio/roboto-mem/releases/download/v0.3.0/03-migrate.mp4) ·
[library sync](https://github.com/robotostudio/roboto-mem/releases/download/v0.3.0/04-library-sync.mp4) ·
[the digest](https://github.com/robotostudio/roboto-mem/releases/download/v0.3.0/05-library-digest.mp4) ·
[the hook](https://github.com/robotostudio/roboto-mem/releases/download/v0.3.0/06-digest-hook.mp4) ·
[promote](https://github.com/robotostudio/roboto-mem/releases/download/v0.3.0/07-promote.mp4) ·
[the secret scan](https://github.com/robotostudio/roboto-mem/releases/download/v0.3.0/08-promote-scan.mp4) ·
[lint](https://github.com/robotostudio/roboto-mem/releases/download/v0.3.0/09-lint.mp4) ·
[promote a library](https://github.com/robotostudio/roboto-mem/releases/download/v0.3.0/10-promote-library.mp4) ·
[live Claude session](https://github.com/robotostudio/roboto-mem/releases/download/v0.3.0/11-claude-live.mp4) ·
[skill add](https://github.com/robotostudio/roboto-mem/releases/download/v0.3.0/12-skill-add.mp4) ·
[team skills sync](https://github.com/robotostudio/roboto-mem/releases/download/v0.3.0/13-skill-sync.mp4) ·
[offline resilience](https://github.com/robotostudio/roboto-mem/releases/download/v0.3.0/14-sync-resilience.mp4)

## Install

For yourself, inside Claude Code:

```
/plugin marketplace add https://github.com/robotostudio/roboto-mem.git
/plugin install roboto-mem@roboto-mem
```

The CLI alone (for CI or non-Claude-Code use) is on npm: `npx roboto-mem` or `npm i -g roboto-mem`.

For a team repo, add this to `.claude/settings.json` so teammates are prompted to install when they trust the folder:

```json
{
  "extraKnownMarketplaces": {
    "roboto-mem": {
      "source": { "source": "github", "repo": "robotostudio/roboto-mem" }
    }
  },
  "enabledPlugins": {
    "roboto-mem@roboto-mem": true
  }
}
```

## Quickstart

1. Scaffold a Commons: run `roboto-mem init --commons` in a new repo and push it.
2. Bind a project: `roboto-mem init --commons-url <git-url>`. Libraries are detected from `package.json`; a bare `roboto-mem init` offers the same via "Bind to a Commons using team libraries".
3. Session starts now inject the Digest.
4. `/promote` your first Lesson.

The legacy v1 binding — `roboto-mem init --commons-url <git-url> --project <id> --squads <ids>` — still works; `roboto-mem migrate` upgrades a v1 config to the library model.

## Commands

| Command | What it does |
|---|---|
| `roboto-mem init --commons` | Scaffold a new Commons: entry directories, CODEOWNERS, token-free CI, vendored CLI |
| `roboto-mem init --commons-url <url>` | Bind a repo to the Commons; libraries are detected from `package.json` (legacy v1: add `--project <id> --squads <ids>`) |
| `roboto-mem migrate` | Migrate a v1 config to v2 — writes `.roboto-mem.json.migrated` for review, never touches the original |
| `roboto-mem sync` | Clone the Commons on first run, fast-forward after |
| `roboto-mem digest` | Print the scope-filtered Digest (`--hook` wraps it in the SessionStart envelope) |
| `roboto-mem promote --scope <s> --type <standard\|lesson> --name <n> …` | Validate → dedupe → secret-scan → branch → PR |
| `roboto-mem promote library <name>` | Open a reviewed Commons PR from your local `~/.roboto-mem/libraries/<name>` edits |
| `roboto-mem lint <dir>` | The CI gate: validate every entry, redacted findings, exit 1 on problems |
| `roboto-mem status` | Binding, session scopes, entry counts, sync freshness |
| `roboto-mem skill add <owner>/<repo> [--skill <n>]` | Vendor a store skill into the Commons pinned at a commit — validate → secret-scan → PR |
| `roboto-mem skill promote <name>` | Lift a personal skill from ~/.claude/skills into a Commons PR |

Inside Claude Code, the plugin adds `/mem-status`, `/mem-sync`, `/mem-upgrade` (prompted, never silent), `/promote`, and `/skill-add`.

## Interactive Mode

Commands that take many flags — `init`, `promote`, `skill add`, `skill promote` — can be run bare in a terminal to prompt for each input:

```sh
$ npx roboto-mem promote
? Scope (org, squad/web, stack/react, etc.)
  org
? Type (standard or lesson)
  lesson
? Name (slug-style: lowercase-with-dashes)
  sanity-typegen-break
? Description (one short line)
  TypeGen flag breaks Sanity client queries
? Author
  you
? Body file path
  ./entry.md

  lesson · org · sanity-typegen-break
? Open a PR to the Commons? (Y/n)
  y
✔ Created PR · https://github.com/your-org/team-memory/pull/42
```

Flags you provide are never re-asked. Non-TTY runs (CI, hooks, scripts) never prompt — they behave exactly as they did before.

## How scoping works

An Entry with no `scope:` frontmatter is global — it's in the Digest everywhere, always. An Entry tagged `scope: library:<name>` loads only in projects that declare that library; `init` detects yours from `package.json` against the Commons' `libraries/`. So `library:resend` guidance never reaches a repo that doesn't send email.

The legacy v1 scoping still works for v1-bound projects: Entries live at a Scope — `org`, `squad/<id>`, `stack/<id>`, or `project/<id>` — a repo's session scopes come from its binding (project, squads) plus detection (`react` in `package.json` → `stack/react`, `typescript` → `stack/typescript`), and the Digest includes exactly the entries whose scope applies. In both models a narrower Standard can explicitly override a broader one — a library Standard over a global one, a squad Standard over an org one — and the Digest then replaces the overridden entry's body with a pointer to the override, so your agent never reads two contradicting rules.

## Team Skills

Team Skills are reusable agent workflows — `SKILL.md` directories living at `skills/<name>/` in the Commons, reviewed like any other Entry. They enter via `roboto-mem skill add <owner>/<repo>` (vendored from GitHub, pinned at a commit), `roboto-mem skill promote <name>` (lifted from your personal `~/.claude/skills/`), or a direct PR adding a directory under `skills/`. Every bound project materializes them into `~/.claude/skills/` on sync, so a merged skill reaches teammates on their next session start. A personal skill with the same name always wins — the team version is reported as shadowed, never overwritten. Remove a skill from the Commons and the next sync deletes the materialized copy too.

## When the network is down

A dead VPN or a git-host outage doesn't take sessions down. With a cached copy present, `sync` reports `stale (offline?)` and the Digest keeps working from the last good state, honestly labelled. Only a missing cache is a real failure.

Non-interactive syncs (CI, scripts) auto-pull library updates without the confirm prompt, so promote local library edits (`roboto-mem promote library <name>`) before running scripted syncs.

## The trust contract

Nothing enters Team Memory without a reviewed PR. The tool never auto-upgrades and never silently misreads newer formats — it falls back to the last-good Digest and says so.

## Development

```
pnpm install
pnpm test
pnpm build
```

## License

[MIT](LICENSE) © Roboto Studio
