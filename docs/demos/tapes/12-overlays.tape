# Two memory repos at once: the company Commons plus a client Overlay.
Output docs/demos/gif/12-overlays.gif
Output docs/demos/mp4/12-overlays.mp4
Source docs/demos/tapes/lib/style.tape
Set Height 880
Source docs/demos/tapes/lib/world.tape

Type "roboto-mem sync"
Sleep 300ms
Enter
Sleep 2s

Type "cat .roboto-mem.json"
Sleep 300ms
Enter
Sleep 2500ms

Type "# add the client's memory repo as an overlay (any text editor works):"
Sleep 300ms
Enter
Sleep 500ms

Type "add-overlay && cat .roboto-mem.json"
Sleep 300ms
Enter
Sleep 3s

Type "roboto-mem sync"
Sleep 300ms
Enter
Sleep 2500ms

Type "roboto-mem digest | grep -B1 -A2 client-naming"
Sleep 500ms
Enter
Sleep 5s
