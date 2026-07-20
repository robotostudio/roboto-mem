# Scaffold a brand-new Commons — bare init asks, you pick, it builds the repo.
Output docs/demos/gif/01-init-commons.gif
Output docs/demos/mp4/01-init-commons.mp4
Source docs/demos/tapes/lib/style.tape
Source docs/demos/tapes/lib/world.tape

Type "# create the team's shared memory repo"
Sleep 300ms
Enter
Sleep 500ms

Type "cd ../acme-memory"
Sleep 300ms
Enter
Sleep 700ms

Type "roboto-mem init"
Sleep 300ms
Enter
Sleep 1500ms

# mode select: arrow down twice to "Scaffold a new Commons repo"
Down
Sleep 800ms
Down
Sleep 800ms
Enter
Sleep 3s

Type "find . -type f | sort"
Sleep 500ms
Enter
Sleep 5s
