export const MEMORY_JSON = `{
  "formatVersion": 1,
  "budgets": { "default": 2000, "org": 4000 }
}
`;

export const CODEOWNERS = `# Scope ownership — every Entry needs its scope Owner's approval (tiered review).
# Org-wide Standards are policy: protect entries/org/ with your standards group.
entries/org/ @your-org/standards-group
# entries/squads/web/ @your-org/squad-web
# entries/stacks/sanity/ @your-org/sanity-guild
`;

export const COMMONS_README = `# Team Memory — Commons

This repository is the **Commons**: the shared, version-controlled knowledge base for your org.
Entries are written once, reviewed by owners, and injected into every agent session automatically.

## Entry layout

\`\`\`
entries/
  org/<name>.md          # Org-wide standards (reviewed by standards group)
  squads/<id>/<name>.md  # Squad-specific lessons and patterns
  stacks/<id>/<name>.md  # Stack/technology guidance (e.g. nextjs, sanity)
  projects/<id>/<name>.md # Project-scoped context
\`\`\`

## Frontmatter fields

Each entry starts with a YAML frontmatter block:

\`\`\`yaml
---
description: One-line summary shown in scope listings
type: standard | lesson          # standard = policy; lesson = learned pattern
author: github-handle
date: YYYY-MM-DD
# optional:
# overrides: org/never-use-let  # declare this entry as a narrower exception to a
                                 # broader Standard; that Standard is suppressed in
                                 # the Digest with a pointer to this entry
---
\`\`\`

Scope and name are derived from the file path (e.g. \`entries/org/my-rule.md\` →
scope \`org\`, name \`my-rule\`). Do **not** put \`scope\` or \`name\` in frontmatter —
the parser rejects them.

## How entries land

1. Open a PR with your new or updated entry.
2. CODEOWNERS routes review to the right group automatically.
3. CI runs \`roboto-mem lint\` to validate frontmatter and structure.
4. Merge → entry is live in all bound project sessions.

Use \`/promote\` in a Claude session to draft a promotion PR from a session lesson.
`;

export const MEMORY_CI_YML = `# memory-ci — validates entry frontmatter and structure on every PR.
# The roboto-mem CLI is vendored at .roboto-mem/cli.mjs by \`roboto-mem init --commons\`,
# so this workflow needs no tokens and no network. Update the vendored CLI via a normal PR.
name: memory-ci

on:
  pull_request:

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Lint entries
        run: node .roboto-mem/cli.mjs lint
`;
