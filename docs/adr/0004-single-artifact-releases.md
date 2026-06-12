# Single-artifact releases: the plugin bundles the built CLI

One source repo produces one versioned release: CI builds the CLI into a single-file bundle shipped inside the plugin, so installing or updating the plugin is the entire story and plugin/CLI version skew cannot exist. We chose this over publishing the CLI to npm with a pinned `npx` invocation (two publishes per release, registry as a session-start runtime dependency, cold-start latency). npm publishing can start later from the same repo and version if a non-Claude-Code consumer appears.

Enforcement, added after the premise was found silently violated: tsdown defaults to library mode and externalizes `dependencies`, so the config must force inlining (`noExternal` for everything non-`node:`), and a regression test builds the artifact and runs it from OUTSIDE the repo where bare imports cannot resolve. "Works in the repo" proves nothing — module resolution finds the dev `node_modules` from the script's own path.
