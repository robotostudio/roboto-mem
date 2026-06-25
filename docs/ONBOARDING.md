# Team Memory — run two commands, you're done

Install the plugin once and our shared rulebook loads itself into every Claude Code session after that. You don't set anything up or maintain anything. Inside Claude Code:

```
/plugin marketplace add https://github.com/robotostudio/roboto-mem.git
/plugin install roboto-mem@roboto-mem
```

Confirm with `/mem-status` — you should see the repo and a list of scopes. That's it. Every session from now on starts with the team's rules already loaded, and you never run anything again.

Both repos are public, so there's nothing to request access to and no SSH to set up. If `/plugin marketplace add` ever says the marketplace already exists, run `/plugin marketplace remove roboto-mem` first, then add it again.

Got a rule worth keeping? Type `/promote` and describe the rule. It opens a PR for review. The rulebook itself lives at github.com/robotostudio/team-memory.

Want the long version, with a short video for each step? See [INSTRUCTIONS.md](INSTRUCTIONS.md).
