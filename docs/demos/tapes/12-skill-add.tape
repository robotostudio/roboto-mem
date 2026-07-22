# Skill add, guided: point at the upstream repo — pinned at a commit, validated, scanned, PR'd.
Output docs/demos/gif/12-skill-add.gif
Output docs/demos/mp4/12-skill-add.mp4
Source docs/demos/tapes/lib/style.tape
Set Height 880
Source docs/demos/tapes/lib/world.tape

Type "# adopt a skill for the whole team — pinned at the upstream commit"
Sleep 300ms
Enter
Sleep 500ms

Type "roboto-mem skill add"
Sleep 300ms
Enter
Sleep 1500ms

# source: the upstream skills repo
Type@35ms "file:///tmp/roboto-mem-demo/skills.git"
Sleep 800ms
Enter
Sleep 1s

# skill name: repo has exactly one — skip
Enter
Sleep 1s

# ref: pin at HEAD (the default)
Enter
Sleep 1s

# author: prefilled from git (Ada Demo) — accept
Enter
Sleep 1200ms

# summary + confirm -> branch + PR
Enter
Sleep 6s
