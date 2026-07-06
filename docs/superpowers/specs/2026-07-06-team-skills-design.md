# Team Skills — design

2026-07-06 · approved in brainstorming session

## Problem

Teams share knowledge through Team Memory, but skills — reusable agent workflows like
`grill-me` or `grill-with-docs` — are installed per person (`npx skills add`, manual
copies into `~/.claude/skills/`). There is no reviewed, synced, team-wide way to adopt
a skill once and have every teammate's agent pick it up.

## Decisions

| Question | Decision |
|---|---|
| Where do team skills come from? | Both: vendored from skills.sh/GitHub, and team-authored in the Commons |
| How do they reach teammates? | Sync materialization into `~/.claude/skills/` (rides existing sync/cache/status) |
| Scoping | Org-wide flat (`skills/<name>/`) — no scope model in v1 |
| Naming & collisions | Unprefixed dirs; personal skills always win; manifest tracks ownership |

Rejected alternatives: Commons-as-plugin-marketplace (second install step, version-bump
friction, updates on plugin cadence not sync cadence) and per-repo committed skills
(N copies, no central curation).

## Language (CONTEXT.md additions)

- **Skill** — a reusable agent workflow (a `SKILL.md` directory) shared through Team
  Memory. Where an Entry is knowledge, a Skill is a capability. Enters the Commons only
  via reviewed PR. _Avoid: command, macro, prompt._
- **Vendoring** — copying a third-party skill into the Commons pinned at an upstream
  commit. Upstream changes never flow in automatically; re-vendoring is a new reviewed
  PR. _Avoid: installing, mirroring._
- **Materialization** — sync writing team skills into `~/.claude/skills/` so Claude
  Code discovers them. Only manifest-owned directories are ever touched.

The existing **Sync** definition ("changes what agents know, never how the tool
behaves") needs one clarifying touch: skills are content that changes what agents *can
do*, but never how roboto-mem itself behaves — that remains Upgrade territory. Update
the CONTEXT.md wording accordingly when implementing.

## Commons format

```
skills/
  grill-me/
    SKILL.md              # byte-identical to upstream when vendored
    ADR-FORMAT.md         # supporting files travel with the skill
    .provenance.json      # vendored skills only; never materialized
  our-deploy-checklist/
    SKILL.md              # team-authored: no provenance file
```

`.provenance.json` schema:

```json
{
  "source": "github:obra/skills",
  "ref": "<40-char commit sha>",
  "path": "skills/grill-me",
  "vendoredAt": "2026-07-06",
  "vendoredBy": "github-handle"
}
```

Provenance lives in a sidecar, not SKILL.md frontmatter, so vendored files stay
byte-identical to upstream and re-vendor PRs diff cleanly.

No `formatVersion` bump: older CLI versions read only `entries/` and simply do not
materialize skills. Nothing is misread; the feature degrades to absence.

## Acquisition

Three paths; the first two get tooling:

1. **Vendor**: `roboto-mem skill add <owner>/<repo> [--skill <name>] [--ref <sha|tag>]`
   — fetch the upstream repo at the pinned ref (resolve HEAD to a sha when `--ref` is
   omitted), copy the skill directory, write `.provenance.json`, then run the existing
   promote pipeline: validate → secret-scan → branch → PR against the Commons.
   Running it for a skill already in the Commons is the **update path**: the directory
   is replaced, `.provenance.json` gets the new ref, and the PR diff shows exactly what
   changed upstream. (Entry promotion refuses collisions; skill add must not.)
2. **Promote a personal skill**: `roboto-mem skill promote <name>` — lifts
   `~/.claude/skills/<name>/` into the same pipeline. No provenance file.
3. **Author directly**: open a PR adding a directory under `skills/` in the Commons.
   `lint` + memory-ci validate it; no tooling required.

In Claude Code the plugin adds `/skill-add`, wrapping paths 1 and 2 conversationally.

## Materialization

Runs at the end of every `sync`. A manifest at `<memoryHome()>/skills-manifest.json`
records `{ name, contentHash }` per managed directory. Reconcile Commons `skills/`
against it:

| Case | Action |
|---|---|
| New in Commons, `~/.claude/skills/<name>` free | Copy dir (excluding `.provenance.json`), record in manifest |
| New in Commons, dir exists but not in manifest | Skip — personal wins; report "shadowed" |
| In manifest, Commons content changed | Replace; update hash |
| In manifest, user edited the materialized copy | Restore team version; warn: "local edits replaced — promote them via PR" |
| Removed from Commons | Delete dir; drop from manifest |
| Offline / sync stale | No-op — skills stay at last-good state, labelled honestly like the Digest |

The manifest is the safety line: sync creates, updates, or deletes only directories it
recorded. Failures materializing one skill must not break sync or the digest hook
(best-effort, reported — same posture as the cache layer).

## Status, lint, scaffold

- `/mem-status` and `roboto-mem status` gain a Skills section: materialized count,
  shadowed names, drift warnings, last materialization time.
- `roboto-mem lint` extends to `skills/`: frontmatter has `name` + `description`,
  `name` matches the directory, `.provenance.json` matches its schema when present,
  secret scan over every file. The Commons' token-free memory-ci therefore gates skill
  PRs exactly like entry PRs.
- `roboto-mem init --commons` scaffolds `skills/` with a README section and a
  CODEOWNERS line (`skills/ @your-org/standards-group`).

## Trust model

Skills are agent instructions — higher blast radius than knowledge entries.

- Nothing enters without CODEOWNERS-routed PR review.
- Vendored skills are pinned at a commit sha; upstream never flows in automatically.
  A re-vendor PR shows the full content diff — the supply-chain win over each teammate
  running `npx skills add` individually.
- Secret scan covers all skill files; `--force` does not bypass it (existing behavior).
- Commons README gains review guidance for skill PRs: read them like code — watch for
  exfiltration, network calls, and "run this command" patterns.
- No automated injection detection in v1; human review is the gate.

## Testing

- Unit: the reconcile matrix above (create, update, shadow, drift-restore, remove,
  offline), manifest round-trip, vendor fetch with injected git runner (same pattern
  as promote's `ghRunner`), lint fixtures for valid/invalid skills and provenance.
- E2E: scaffold a Commons with a skill → bind a project → sync → assert materialized →
  remove the skill upstream → sync → assert cleaned up; personal-shadow case included.

## Out of scope (v1)

Scope-filtered skills; upstream update notifications (`skill outdated` is a v2
candidate); distributing commands/agents/hooks; publishing to skills.sh; a local
opt-out list.

## Open items for planning

- Exact fetch mechanism for vendoring (shallow git clone vs codeload tarball) — pick
  whichever the existing exec/git plumbing supports with less new surface.
- `contentHash` definition (ordered file-path + bytes digest) and rename handling.
- Final slash-command shape: one `/skill-add` detecting `owner/repo` vs personal-skill
  name, or a separate promote surface. The spec's intent stands either way: both
  acquisition paths reachable from inside a session.
