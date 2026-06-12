---
description: Promote a Lesson or Standard from this session into Team Memory (opens a reviewed PR)
argument-hint: [scope] [name]
---

Promote an Entry from this session into Team Memory. Optional arguments: $1 = scope, $2 = name.

1. **Assemble the Entry** from the conversation context, or from the Personal Memory file the user named. Fields:
   - scope: `org` | `squad/<id>` | `stack/<id>` | `project/<id>`
   - type: `standard` or `lesson`
   - name: kebab-case
   - description: one line
   - body: markdown
   - author: ask the user, or derive from `git config user.name`
   - date: today

2. **Show the complete drafted Entry to the user and get explicit confirmation BEFORE running anything.** This command pushes a branch and opens a PR on the Team Memory repo — never run it on an unconfirmed draft.

3. **Run the promotion.** Write the body to a temp file first, then run:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" promote --scope <scope> --type <type> --name <name> --description <description> --author <author> --body-file <tempfile>
   ```

4. **Handle CLI findings:**
   - Near-duplicate: show the reported duplicate to the user. Re-run with `--force` only if the user explicitly accepts the duplication.
   - Secret finding: never force. Help the user redact the secret from the body, then re-run.

5. **Report the PR URL** to the user.
