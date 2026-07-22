# Edit a library locally, promote it — branch, diff, PR.
Output docs/demos/gif/10-promote-library.gif
Output docs/demos/mp4/10-promote-library.mp4
Source docs/demos/tapes/lib/style.tape
Source docs/demos/tapes/lib/world.tape

Type "cd ../acme-api"
Sleep 300ms
Enter
Sleep 700ms

Type "roboto-mem sync"
Sleep 300ms
Enter
Sleep 1500ms

Type@30ms `echo "- Never send from unverified domains in staging either." >> $ROBOTO_MEM_HOME/libraries/resend/LIBRARY.md`
Sleep 500ms
Enter
Sleep 1s

Type "roboto-mem promote library resend --author ada"
Sleep 500ms
Enter
Sleep 6s
