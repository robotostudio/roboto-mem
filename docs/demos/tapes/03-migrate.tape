# Upgrade a v1 config to the v2 library model — reviewed, never in place.
Output docs/demos/gif/03-migrate.gif
Output docs/demos/mp4/03-migrate.mp4
Source docs/demos/tapes/lib/style.tape
Set Height 880
Source docs/demos/tapes/lib/world.tape

Type "cat .roboto-mem.json"
Sleep 300ms
Enter
Sleep 2500ms

Type "# upgrade this project to the v2 library model"
Sleep 300ms
Enter
Sleep 500ms

Type "roboto-mem migrate"
Sleep 300ms
Enter
Sleep 5s

Type "mv .roboto-mem.json.migrated .roboto-mem.json"
Sleep 300ms
Enter
Sleep 1s

Type "cat .roboto-mem.json"
Sleep 500ms
Enter
Sleep 5s
