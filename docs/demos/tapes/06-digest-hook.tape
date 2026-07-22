# Hook mode: the SessionStart envelope Claude Code receives on every session.
Output docs/demos/gif/06-digest-hook.gif
Output docs/demos/mp4/06-digest-hook.mp4
Source docs/demos/tapes/lib/style.tape
Source docs/demos/tapes/lib/world.tape

Type "cd ../acme-api"
Sleep 300ms
Enter
Sleep 700ms

Type "roboto-mem sync"
Sleep 300ms
Enter
Sleep 4s

Type "# this is what the Claude Code SessionStart hook runs:"
Sleep 300ms
Enter
Sleep 500ms

Type "roboto-mem digest --hook | jq '.hookSpecificOutput.hookEventName'"
Sleep 500ms
Enter
Sleep 2500ms

Type "roboto-mem digest --hook | jq -r '.hookSpecificOutput.additionalContext' | head -8"
Sleep 500ms
Enter
Sleep 6s
