---
description: Show Team Memory binding, scopes, entry counts, and last sync for this repo
---

Run:

```
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" status
```

Present the output to the user: Team Memory binding, scopes, entry counts, and last sync time. If the repo has no `.roboto-mem.json`, note that this repo is not bound to a Team Memory and suggest running `roboto-mem init`.
