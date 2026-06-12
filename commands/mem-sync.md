---
description: Pull the latest Team Memory and report what changed
---

Pull the latest Team Memory content and report what changed.

1. Run:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" sync
   ```

2. Then run:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" status
   ```

3. Summarize new and changed Entries for the user in one short paragraph. If nothing changed, say so.
