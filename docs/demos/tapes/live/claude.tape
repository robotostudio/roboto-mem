# LIVE demo — real Claude Code session with the roboto-mem plugin installed.
# Not part of the default render set: needs claude auth + network + the plugin.
# Pre-warm once before rendering (folder trust): cd /tmp/roboto-mem-demo/acme-web && claude -p "reply ok"
# No Wait here: VHS's Wait reads a stale buffer across claude's alt-screen
# lifecycle (empirically). Fixed sleeps; verify the citations by frame audit.
Output docs/demos/gif/11-claude-live.gif
Output docs/demos/mp4/11-claude-live.mp4
Source docs/demos/tapes/lib/style.tape
Set Framerate 12
Set PlaybackSpeed 1.5
Source docs/demos/tapes/lib/world.tape

Type "roboto-mem sync"
Sleep 300ms
Enter
Sleep 2s

Type "# every Claude session in this repo now starts with the team's standards:"
Sleep 300ms
Enter
Sleep 500ms

Type@30ms "claude -p 'From the Team Memory digest only: what do the entries say about using let? Quote the exact entry names. Do not mention any other configuration.'"
Sleep 500ms
Enter
Sleep 42s

Type@30ms "claude -p 'Following the Team Memory standards, write a TypeScript function that sums item.price over an array. Reply with only a code block, no commentary.'"
Sleep 500ms
Enter
Sleep 36s
