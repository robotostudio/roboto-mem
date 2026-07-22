# Libraries materialize on sync; a teammate's edit arrives next sync.
Output docs/demos/gif/04-library-sync.gif
Output docs/demos/mp4/04-library-sync.mp4
Source docs/demos/tapes/lib/style.tape
Source docs/demos/tapes/lib/world.tape

Type "cd ../acme-api"
Sleep 300ms
Enter
Sleep 700ms

Type "roboto-mem sync"
Sleep 300ms
Enter
Sleep 5s

Type "ls $ROBOTO_MEM_HOME/libraries"
Sleep 300ms
Enter
Sleep 2s

Type "# a teammate improves the resend guide in the commons..."
Sleep 300ms
Enter
Sleep 500ms

Type "teammate-update-library"
Sleep 300ms
Enter
Sleep 2500ms

Type "roboto-mem sync"
Sleep 300ms
Enter
Sleep 3s

# TTY sync surfaces the pending library diff as a confirm (defaults to yes)
Enter
Sleep 3s

Type "tail -3 $ROBOTO_MEM_HOME/libraries/resend/LIBRARY.md"
Sleep 500ms
Enter
Sleep 5s
