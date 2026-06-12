---
description: Upgrade the roboto-mem plugin (prompted, never silent)
---

Upgrade contract: upgrades swap the tool only, never committed files.

Ask the user to confirm the upgrade. After confirmation, update the plugin through Claude Code's plugin system: run `claude plugin update roboto-mem`, or direct the user to the /plugin UI. Then verify the new version by running:

```
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" --version
```
