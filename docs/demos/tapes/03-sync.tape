# Sync pulls the Commons; a teammate's new Standard arrives on the next sync.
Output docs/demos/gif/03-sync.gif
Output docs/demos/mp4/03-sync.mp4
Source docs/demos/tapes/lib/style.tape
Source docs/demos/tapes/lib/world.tape

Type "roboto-mem sync"
Sleep 300ms
Enter
Sleep 2s

Type "roboto-mem status"
Sleep 300ms
Enter
Sleep 3s

Type "# meanwhile, a teammate lands a new Standard in the Commons..."
Sleep 300ms
Enter
Sleep 500ms

Type "teammate-push"
Sleep 300ms
Enter
Sleep 1500ms

Type "roboto-mem sync"
Sleep 300ms
Enter
Sleep 2s

Type "roboto-mem digest | grep -A2 use-server-actions"
Sleep 500ms
Enter
Sleep 5s
