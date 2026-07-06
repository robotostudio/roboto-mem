---
description: Add a team skill — vendor from skills.sh/GitHub or promote a personal skill (opens a reviewed PR)
argument-hint: [owner/repo | skill-name]
---

Add a Skill to Team Memory. Argument: $1 = source.

1. **Dispatch on the argument shape:**
   - Contains `/` or `://` (e.g. `obra/skills`, an https URL) → vendor from upstream.
   - Bare kebab-case name (e.g. `my-flow`) → promote the personal skill at `~/.claude/skills/<name>/`.
   - Missing → ask the user which skill they want and where it lives.

2. **Derive author** from `git config user.name` (confirm with the user), date = today.

3. **Show the user what will happen and get explicit confirmation BEFORE running anything** — this pushes a branch and opens a PR on the Team Memory repo.

4. **Run it:**
   - Vendor: `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" skill add <source> [--skill <name>] --author <author>`
   - Promote: `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" skill promote <name> --author <author>`

5. **Handle findings:**
   - Multiple skills upstream: show the listed candidates, ask which one, re-run with `--skill`.
   - Secret finding: never bypassable. Help the user redact, then re-run.
   - "updated" in the output means the PR replaces an existing team skill — tell the user the diff shows the upstream change.

6. **Report the PR URL.** Remind the user the skill reaches teammates on their next session start after merge.
