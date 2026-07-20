# Guided promote: bare promote interviews you — scope to body — then opens the PR. Nothing lands unreviewed.
Output docs/demos/gif/07-promote.gif
Output docs/demos/mp4/07-promote.mp4
Source docs/demos/tapes/lib/style.tape
Set Height 880
Source docs/demos/tapes/lib/world.tape

Type "roboto-mem sync"
Sleep 300ms
Enter
Sleep 3s

Type "cat note.md"
Sleep 300ms
Enter
Sleep 2s

Type "# promote it — no flags needed, the CLI asks"
Sleep 300ms
Enter
Sleep 500ms

Type "roboto-mem promote"
Sleep 300ms
Enter
Sleep 1500ms

# scope select: org -> down once to squad/web
Down
Sleep 900ms
Enter
Sleep 1s

# type select: standard is already highlighted
Enter
Sleep 1s

# entry name
Type "zod-at-boundaries"
Sleep 800ms
Enter
Sleep 1s

# description
Type "Validate at boundaries with zod"
Sleep 800ms
Enter
Sleep 1s

# author: prefilled from git (Ada Demo) — accept
Enter
Sleep 1s

# date: prefilled with today — accept
Enter
Sleep 1s

# body: pull it from the draft note
Type "note.md"
Sleep 800ms
Enter
Sleep 1200ms

# summary + confirm -> branch + PR
Enter
Sleep 7s
