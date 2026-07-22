# Sessions survive an unreachable Commons: stale cache beats a hard failure.
Output docs/demos/gif/14-sync-resilience.gif
Output docs/demos/mp4/14-sync-resilience.mp4
Source docs/demos/tapes/lib/style.tape
Set Height 880
Source docs/demos/tapes/lib/world.tape

Type "cd ../acme-api"
Sleep 300ms
Enter
Sleep 700ms

Type "roboto-mem sync"
Sleep 300ms
Enter
Sleep 5s

Type "# the commons goes unreachable (offline? git host down?)"
Sleep 300ms
Enter
Sleep 500ms

Type "mv /tmp/roboto-mem-demo/commons-v2.git{,.off}"
Sleep 300ms
Enter
Sleep 800ms

Type "roboto-mem sync"
Sleep 300ms
Enter
Sleep 3500ms

Type "roboto-mem digest | head -1"
Sleep 300ms
Enter
Sleep 3s

Type "# only a missing cache is a real failure:"
Sleep 300ms
Enter
Sleep 500ms

Type "rm -rf $ROBOTO_MEM_HOME/repos && roboto-mem sync"
Sleep 300ms
Enter
Sleep 3500ms

Type "mv /tmp/roboto-mem-demo/commons-v2.git{.off,} && roboto-mem sync"
Sleep 300ms
Enter
Sleep 5s
