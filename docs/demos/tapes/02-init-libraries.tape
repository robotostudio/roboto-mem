# Bind a project the v2 way: libraries auto-detected from package.json.
Output docs/demos/gif/02-init-libraries.gif
Output docs/demos/mp4/02-init-libraries.mp4
Source docs/demos/tapes/lib/style.tape
Source docs/demos/tapes/lib/world.tape

Type "cd ../demo-app && cat package.json"
Sleep 300ms
Enter
Sleep 2s

Type "roboto-mem init"
Sleep 300ms
Enter
Sleep 1500ms

# mode select: arrow down to "Bind to a Commons using team libraries"
Down
Sleep 800ms
Enter
Sleep 1s

Type@35ms "file:///tmp/roboto-mem-demo/commons-v2.git"
Sleep 500ms
Enter
Sleep 2s

# detected set confirm (defaults to yes)
Enter
Sleep 1200ms

# "Add more?" — none
Enter
Sleep 1200ms

# "Remove any?" — none
Enter
Sleep 3s

Type "cat .roboto-mem.json"
Sleep 500ms
Enter
Sleep 5s
