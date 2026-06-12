# Git repo as the source of truth for Team Memory

A team's memory is a git repo of markdown entries: PR review is the Promotion gate, `git pull` is the sync, and repo access is the auth. We chose this over a hosted service (which buys instant propagation and server-side search) because the consumers are developers who already live in git — review, history, and access control come free, and there is nothing to operate. The packaged tool is a thin CLI/plugin over the repo.
