# Lint: what the Commons CI runs on every PR — redacted findings, hard exit 1.
Output docs/demos/gif/09-lint.gif
Output docs/demos/mp4/09-lint.mp4
Source docs/demos/tapes/lib/style.tape
Source docs/demos/tapes/lib/world.tape

Type "cd ../teamwork"
Sleep 300ms
Enter
Sleep 700ms

Type "# the Commons CI runs this on every PR:"
Sleep 300ms
Enter
Sleep 500ms

Type "roboto-mem lint ."
Sleep 300ms
Enter
Sleep 3500ms

Type `sed -i '' 's/"sk-demo[0-9a-f]*"/"<from-1password>"/' entries/org/rotate-keys.md`
Sleep 500ms
Enter
Sleep 1s

Type "roboto-mem lint ."
Sleep 300ms
Enter
Sleep 5s
