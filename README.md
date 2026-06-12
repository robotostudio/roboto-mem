# roboto-mem

## What it is

roboto-mem gives your team a Team Memory: a git-backed knowledge base synced into every Claude Code session. Entries are Standards (authored rules, always in force) or Lessons (learned gotchas, indexed, read on demand), and the Digest — the scope-filtered view of what applies to this repo — is injected at session start. New Entries arrive only through Promotion, the explicit, reviewed act of adding an Entry: it opens a PR, and nothing enters unreviewed.

## Install

For yourself, inside Claude Code:

```
/plugin marketplace add robotostudio/roboto-mem
/plugin install roboto-mem@roboto-mem
```

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
2. Bind a project: `roboto-mem init --commons-url <git-url> --project <id> --squads <ids>`.
3. Session starts now inject the Digest.
4. `/promote` your first Lesson.

## The trust contract

Nothing enters Team Memory without a reviewed PR. The tool never auto-upgrades and never silently misreads newer formats — it falls back to the last-good Digest and says so.

## Development

```
pnpm install
pnpm test
pnpm build
```

`dist/cli.mjs` is committed on purpose — git-installed plugins have no build step.
