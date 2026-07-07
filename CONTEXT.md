# Team Memory

roboto-mem syncs a shared, agent-first knowledge base across a team's Claude Code instances. Built for Roboto as customer zero, packaged so other teams can install it.

## Language

**Team Memory**:
The shared knowledge base an org syncs into every member's Claude Code sessions, composed from the Commons plus any Overlays the person can access. Written for agent consumption; humans read it as a side effect.
_Avoid_: knowledge base, KB, wiki, shared memory

**Commons**:
The single org-wide memory repo — the default home of every Entry. Squad scopes are directories within it, owned via CODEOWNERS.
_Avoid_: main repo, core memory

**Overlay**:
A separate memory repo that composes on top of the Commons for people with access. Exists only when access isolation demands it (e.g., a client NDA pod); never a squad's default home.
_Avoid_: fork, private memory, satellite

**Entry**:
A single unit of Team Memory — either a Standard or a Lesson — carrying exactly one Scope.
_Avoid_: memory, fact, note, document

**Scope**:
The audience of an Entry: the whole org, a squad, a stack (e.g., sanity, shopify, nextjs), or a single project. A session receives only Entries whose Scope matches the project it runs in and the squads its repo belongs to.
_Avoid_: tag, category, namespace

**Owner**:
The people accountable for a Scope; nothing enters it without their approval. The org scope is owned by a small named standards group.
_Avoid_: maintainer, admin

**Standard**:
A deliberately authored rule or convention in Team Memory (e.g., "never use `let`"). Exists because someone decided it, is always in force, and outranks Personal Memory when they conflict.
_Avoid_: rule, convention, guideline

**Override**:
A narrower Standard's declared exception to a broader one. Must name the Standard it overrides, pulls that Standard's Owners into review, and appears in the Digest so agents resolve the conflict deterministically. An undeclared contradiction is a bug.
_Avoid_: exception, fork

**Lesson**:
Knowledge that emerged from one person's session — a correction, a gotcha, a discovered pattern. Consulted when relevant rather than always in force. Lives in Personal Memory until promoted; one that proves universal can be re-authored as a Standard.
_Avoid_: learning, instinct, pattern

**Promotion**:
The explicit, teammate-reviewed act of moving a Lesson from one person's Personal Memory into Team Memory. Nothing enters Team Memory unreviewed — Standards are authored directly, Lessons are promoted, and both pass a second pair of eyes.
_Avoid_: sync, auto-share, publish

**Skill**:
A reusable agent workflow (a `SKILL.md` directory) shared through Team Memory. Where an Entry is knowledge, a Skill is a capability. Enters the Commons only via reviewed PR.
_Avoid_: command, macro, prompt

**Vendoring**:
Copying a third-party skill into the Commons pinned at an upstream commit. Upstream changes never flow in automatically; re-vendoring is a new reviewed PR.
_Avoid_: installing, mirroring

**Materialization**:
Sync writing team skills into `~/.claude/skills/` so Claude Code discovers them. Only manifest-owned directories are ever touched.

**Digest**:
The scope-filtered view of Team Memory a session receives at start: Standards in full, Lessons as a one-line index expanded on demand.
_Avoid_: context dump, bundle, snapshot

**Personal Memory**:
An individual's local Claude Code memory. Private by default; never leaves the machine except via Promotion.
_Avoid_: local memory, user memory

**Sync**:
Content propagation: merged Entries and Team Skills reaching teammates' sessions by pulling the Team Memory repo. Changes what agents know and which team skills they carry, never how the tool behaves.
_Avoid_: update (ambiguous), refresh

**Upgrade**:
A new version of the tool itself (plugin + bundled CLI) reaching a teammate's machine. Changes how the tool behaves, never what's in Team Memory, and never touches committed files.
_Avoid_: update (ambiguous)

**Migration**:
The explicit act of moving a committed artifact (a scope config, the Team Memory repo format) to a newer schema version, always landing as a reviewable diff. Never a side effect of Upgrade or Sync.
_Avoid_: auto-migrate

**Interactive Mode**:
A flag-taking command run in a terminal collects its missing inputs by prompting, showing each flag's purpose inline. Flags always win over prompts; non-TTY runs (hooks, CI, scripts) never prompt and behave exactly as scripted.
_Avoid_: TUI, wizard, interactive suite, guided mode

## Example dialogue

> **Dev**: My Claude figured out that our Sanity client breaks with the new TypeGen flag. Should I add that to the standards?
>
> **Domain expert**: No — that's a Lesson, not a Standard. Nobody decided it; you discovered it. Promote it from your Personal Memory and it lands in Team Memory for everyone's agent.
>
> **Dev**: And if I just want my own shortcuts to stay mine?
>
> **Domain expert**: Then do nothing. Personal Memory never syncs on its own.
