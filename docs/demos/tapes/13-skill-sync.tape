# Sync materializes merged team skills into ~/.claude/skills on every machine.
Output docs/demos/gif/13-skill-sync.gif
Output docs/demos/mp4/13-skill-sync.mp4
Source docs/demos/tapes/lib/style.tape
Source docs/demos/tapes/lib/world.tape

Type "# a teammate's skill PR just merged in the Commons..."
Sleep 300ms
Enter
Sleep 500ms

Type "teammate-add-skill"
Sleep 300ms
Enter
Sleep 2500ms

Type "roboto-mem sync"
Sleep 300ms
Enter
Sleep 4s

Type "ls ~/.claude/skills"
Sleep 300ms
Enter
Sleep 2s

Type "roboto-mem status"
Sleep 300ms
Enter
Sleep 5s
