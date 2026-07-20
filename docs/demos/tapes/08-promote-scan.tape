# The secret scan blocks promotion — and --force cannot bypass it.
Output docs/demos/gif/08-promote-scan.gif
Output docs/demos/mp4/08-promote-scan.mp4
Source docs/demos/tapes/lib/style.tape
Source docs/demos/tapes/lib/world.tape

Type "roboto-mem sync"
Sleep 300ms
Enter
Sleep 1500ms

Type "cat note-rotate.md"
Sleep 300ms
Enter
Sleep 3s

Type@25ms `roboto-mem promote --scope org --type standard --name rotate-deploy-keys --description "Rotate deploy creds quarterly" --author ada --body-file note-rotate.md`
Sleep 500ms
Enter
Sleep 3s

Type "# even --force can't sneak a secret past the scan:"
Sleep 300ms
Enter
Sleep 500ms

Type@25ms `roboto-mem promote --scope org --type standard --name rotate-deploy-keys --description "Rotate deploy creds quarterly" --author ada --body-file note-rotate.md --force`
Sleep 500ms
Enter
Sleep 3s

Type "sed -i '' 's/AKIAIOSFODNN7EXAMPLE/<your-access-key>/' note-rotate.md"
Sleep 300ms
Enter
Sleep 1s

Type@25ms `roboto-mem promote --scope org --type standard --name rotate-deploy-keys --description "Rotate deploy creds quarterly" --author ada --body-file note-rotate.md`
Sleep 500ms
Enter
Sleep 6s
