# The friendly guide to Team Memory

This guide explains roboto-mem from zero. You don't need to be a git expert. If you can copy a command into a terminal, you can use everything on this page.

Every part has a short video. Watch it first, then follow the commands.

## What is this, exactly?

Imagine your team keeps one shared notebook. Before any AI assistant on your team starts working, it reads that notebook. The notebook says things like "we never use `let` in TypeScript" and "validate data where it enters the system".

That notebook is your **Team Memory**. roboto-mem is the tool that:

1. keeps the notebook in one place everyone can reach,
2. hands the right pages to your AI assistant at the start of every session, automatically,
3. lets anyone *propose* a new page — but never lets a page in without a human approving it.

The notebook lives in a git repository. Git is just a filing cabinet that remembers every version of every page forever, and lets the whole team share it. GitHub is where that cabinet sits online.

[▶ Watch the 90-second walkthrough](https://github.com/robotostudio/roboto-mem/releases/download/v0.1.0/hero.mp4)

## The words you'll see

| Word | What it means |
|---|---|
| **Team Memory** | The whole shared notebook. |
| **Commons** | The git repository that holds the notebook. One per company. |
| **Entry** | One page in the notebook. A single rule or story, in one file. |
| **Standard** | An entry that is a rule. Always shown to the assistant. "Never use let." |
| **Lesson** | An entry that is a story about a mistake. Shown as a one-line index; the assistant opens it only when relevant. |
| **Digest** | The bundle of pages your assistant actually reads for *this* project. |
| **Scope** | The label that says who a page applies to: the whole org, one squad, one tech stack, or one project. |
| **Sync** | Fetching the newest version of the notebook to your machine. |
| **Promotion** | Proposing a new page. It creates a review request; a human approves it. |
| **Overlay** | A *second* notebook added on top of the main one. See [two repos](#can-i-use-two-git-repos-as-memory-yes). |

## Part 1 — You just joined the team

You need exactly one thing: the plugin. Open Claude Code and run these two commands:

```
/plugin marketplace add https://github.com/robotostudio/roboto-mem.git
/plugin install roboto-mem@roboto-mem
```

That's it. If your project is already linked to the Team Memory (most team repos are), every session you start now begins with the team's rules already loaded. You don't run anything daily. It just happens.

To check it worked, type `/mem-status` inside Claude Code. You should see the memory repo's address and a list of scopes.

[▶ Watch a real session use the memory](https://github.com/robotostudio/roboto-mem/releases/download/v0.1.0/11-claude-live.mp4) — Claude quotes the team's rule by name, then writes code that follows it.

## Part 2 — Link a project to the memory

If `/mem-status` says the project isn't linked yet, link it. In a terminal, inside the project folder:

```sh
npx roboto-mem init . \
  --commons-url https://github.com/your-org/team-memory.git \
  --project my-app \
  --squads web
```

What each piece means:

| You type | What it is |
|---|---|
| `--commons-url …` | The address of your team's memory repo. Ask whoever set it up, or copy it from another project's `.roboto-mem.json`. If you can clone that repo, you have access. |
| `--project my-app` | A short name for *this* project. Pick anything; keep it lowercase. |
| `--squads web` | Which squad(s) this project belongs to. Comma-separate if it's more than one: `--squads web,platform`. |

The command writes one small file, `.roboto-mem.json`, into the project. Think of it as a sticky note on the repo that says "read *this* notebook, as *this* project". Commit that file so teammates get the link for free.

You don't tell it your tech stack — it looks at `package.json` and figures out react, next, typescript, and friends on its own.

[▶ Watch: linking a project](https://github.com/robotostudio/roboto-mem/releases/download/v0.1.0/02-init-bind.mp4)

## Part 3 — See what your assistant knows

Two commands, both safe to run any time:

```sh
npx roboto-mem status
```

Status is the dashboard: which memory repo you're linked to, which scopes apply here, how many rules exist, and how fresh your copy is.

```sh
npx roboto-mem digest
```

Digest prints the exact pages your assistant reads — rules in full, lessons as a one-line list. If you ever wonder "why did Claude just say our team forbids X?", the answer is on this page.

[▶ Watch: status](https://github.com/robotostudio/roboto-mem/releases/download/v0.1.0/05-status.mp4) · [▶ Watch: the digest](https://github.com/robotostudio/roboto-mem/releases/download/v0.1.0/06-digest.mp4)

## Part 4 — Get the latest memory

When a teammate adds a rule, you get it the next time you sync:

```sh
npx roboto-mem sync
```

You rarely need to run this yourself — every new Claude Code session syncs for you. Run it manually when you want a teammate's brand-new rule *right now*.

If you're offline or the git host is down, nothing breaks. The tool says `stale (offline?)` and keeps using the last copy it fetched, clearly labelled so you know it might be slightly old.

[▶ Watch: sync picking up a teammate's new rule](https://github.com/robotostudio/roboto-mem/releases/download/v0.1.0/03-sync.mp4) · [▶ Watch: what offline looks like](https://github.com/robotostudio/roboto-mem/releases/download/v0.1.0/04-sync-resilience.mp4)

## Part 5 — Add something to the memory

You learned something the hard way, or the team agreed on a new rule. Put it in the notebook so nobody relearns it.

Write the body of your rule in a file (say `note.md`), then:

```sh
npx roboto-mem promote \
  --scope org \
  --type standard \
  --name validate-at-boundaries \
  --description "Validate data where it enters the system" \
  --author yourname \
  --body-file note.md
```

What each piece means:

| You type | What it is |
|---|---|
| `--scope org` | Who it applies to. `org` = everyone. `squad/web` = just that squad. `stack/react` = any project using react. `project/my-app` = one project only. |
| `--type standard` | `standard` for a rule, `lesson` for a hard-won story. |
| `--name …` | The page's filename-style name: lowercase words joined by dashes. |
| `--description …` | One short line. This is what people (and assistants) see in lists. |
| `--author yourname` | You. |
| `--body-file note.md` | The file with the actual text of the rule. |

Easier route: inside Claude Code, just type `/promote` and describe the rule — the assistant fills in all the flags for you.

What happens when you run it:

1. It checks your page is formatted right.
2. It checks the notebook doesn't already have this page (or a near-twin).
3. It scans the text for passwords and keys. If it finds one, it refuses. `--force` does not change its mind — this check has no override, on purpose.
4. It creates a review request (a "pull request") on the memory repo.

Nothing enters the notebook until a human Owner approves that request. That's the whole trust model: every page was approved by someone, every page shows who wrote it, and git remembers every change forever.

[▶ Watch: promoting a rule](https://github.com/robotostudio/roboto-mem/releases/download/v0.1.0/08-promote.mp4) · [▶ Watch: the secret scan saying no](https://github.com/robotostudio/roboto-mem/releases/download/v0.1.0/09-promote-scan.mp4)

## Part 6 — Change or remove a rule

Pages are just markdown files in the memory repo, under `entries/`. To change or remove one:

1. Open the memory repo on GitHub.
2. Edit (or delete) the file — GitHub's pencil button works fine, no terminal needed.
3. Submit the change as a pull request.

The repo's own robot checker (the same `lint` the team runs) verifies your edit is well-formed, and an Owner approves it. Everyone receives the change on their next sync.

[▶ Watch: the checker catching a bad page, then passing a fixed one](https://github.com/robotostudio/roboto-mem/releases/download/v0.1.0/10-lint.mp4)

## Can I use two git repos as memory? (Yes)

This is called an **Overlay**, and it's built for agencies: your company has one notebook (the Commons), and a client engagement has its own extra notebook. Projects for that client read *both*.

Open the project's `.roboto-mem.json` in any editor and add the second repo's address to the `overlays` list:

```json
{
  "configVersion": 1,
  "commons": "https://github.com/your-org/team-memory.git",
  "overlays": [
    "https://github.com/your-org/acme-client-memory.git"
  ],
  "project": "acme-web",
  "squads": ["web"]
}
```

Then sync. You'll see two `synced` lines — one per notebook — and the digest merges pages from both:

```sh
npx roboto-mem sync
# synced https://github.com/your-org/team-memory.git
# synced https://github.com/your-org/acme-client-memory.git
```

An overlay repo is just another Commons — scaffold one the same way (`roboto-mem init --commons` in an empty repo, push it). Add as many overlays as you need; the list takes more than one.

[▶ Watch: two memory repos feeding one digest](https://github.com/robotostudio/roboto-mem/releases/download/v0.1.0/12-overlays.mp4)

## Starting a memory from scratch

Setting this up for a whole team is one command in a new, empty repo:

```sh
npx roboto-mem init . --commons
```

It creates the folder structure, a reviewers file (who approves pages), and a robot checker that runs on every proposed page — with zero secrets or tokens to configure. Push the repo to GitHub, then link your projects to it (Part 2).

[▶ Watch: scaffolding the Commons](https://github.com/robotostudio/roboto-mem/releases/download/v0.1.0/01-init-commons.mp4)

## When something looks wrong

| You see | What it means | What to do |
|---|---|---|
| `stale (offline?) …` | Couldn't reach the memory repo; using the last good copy. | Nothing, usually. Check VPN/network if it persists. |
| `FAILED … not a git repository` | The address is wrong, or you don't have access. | Check the URL in `.roboto-mem.json`; try `git clone` with that URL — if that fails, ask for access. |
| `Secret scan failed: [aws-access-key] …` | Your page contains something that looks like a real key. | Replace it with a placeholder like `<your-access-key>`. Placeholders in angle brackets pass. |
| `Malformed YAML frontmatter` | The block between the `---` lines at the top of an entry is broken. | Compare with any existing entry; watch out for `:` inside the description line. |
| `not synced yet — run roboto-mem sync` | You linked the project but never fetched the notebook. | Run `npx roboto-mem sync`. |
| `command not found: roboto-mem` | The CLI isn't installed globally. | Use `npx roboto-mem …`, or install once with `npm i -g roboto-mem`. |

## Questions people actually ask

**Do I need to know git?**
To *read* the memory: no — install the plugin and you're done. To *add* a page: also no — `promote` does the git work for you. Only editing existing pages touches GitHub directly, and the website's edit button is enough.

**Where does it keep things on my computer?**
In `~/.roboto-mem` — a cached copy of each memory repo plus one small state file. Delete it any time; the next sync rebuilds it.

**Is my code sent anywhere?**
No. The tool only *pulls* from your memory repo over git. There's no server, no telemetry, no account. The only thing that ever leaves your machine is a page you explicitly promote.

**Who decides what enters the memory?**
The Owners listed in the memory repo's CODEOWNERS file. Every page enters through a reviewed pull request — there is no path around review.

**What if two rules disagree?**
A squad rule can explicitly override an org rule. The digest then shows the override and replaces the org rule's text with a pointer to it, so your assistant never reads two contradicting instructions.

**What's a Standard vs a Lesson, again?**
A Standard is law: short, always in the assistant's context. A Lesson is a story: "this burned us, here's what to do instead" — indexed in one line, read only when relevant. If you're unsure, ask: "should every session pay to read this?" Yes → Standard. "Only when touching that area" → Lesson.

**Can a project belong to two squads?**
Yes: `--squads web,platform`. It receives both squads' pages.

**How does the tool itself update?**
Inside Claude Code, `/mem-upgrade` — it always asks before changing anything, never upgrades silently, and tells you what changed.

**How does the magic injection actually work?** *(for the curious)*
The plugin registers a session-start hook. When a session begins, it runs `roboto-mem digest --hook`, which prints the digest wrapped in the envelope Claude Code expects, and Claude Code adds it to the session's context. [▶ Watch the plumbing](https://github.com/robotostudio/roboto-mem/releases/download/v0.1.0/07-digest-hook.mp4)

---

Still stuck? Open an issue: https://github.com/robotostudio/roboto-mem/issues
