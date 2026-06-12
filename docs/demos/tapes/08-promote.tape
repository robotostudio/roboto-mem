# Promote: draft note -> validated entry -> branch -> PR. Nothing lands unreviewed.
Output docs/demos/gif/08-promote.gif
Output docs/demos/mp4/08-promote.mp4
Source docs/demos/tapes/lib/style.tape
Source docs/demos/tapes/lib/world.tape

Type "roboto-mem sync"
Sleep 300ms
Enter
Sleep 1500ms

Type "cat note.md"
Sleep 300ms
Enter
Sleep 2500ms

Type@30ms `roboto-mem promote --scope squad/web --type standard --name zod-at-boundaries --description "Validate at boundaries with zod" --author ada --body-file note.md`
Sleep 500ms
Enter
Sleep 7s
