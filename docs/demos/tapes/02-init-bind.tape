# Bind a project to the Commons — workspaces and stacks are detected automatically.
Output docs/demos/gif/02-init-bind.gif
Output docs/demos/mp4/02-init-bind.mp4
Source docs/demos/tapes/lib/style.tape
Source docs/demos/tapes/lib/world.tape

Type "cd ../demo-app && cat package.json"
Sleep 300ms
Enter
Sleep 2s

Type@35ms "roboto-mem init . --commons-url file:///tmp/roboto-mem-demo/commons.git --project demo-app --squads web"
Sleep 500ms
Enter
Sleep 4s

Type "cat .roboto-mem.json"
Sleep 500ms
Enter
Sleep 5s
