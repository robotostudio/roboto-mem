# A thin CLI wrapped by a Claude Code plugin

The plumbing — clone/pull of the memory repo, Digest compilation, Promotion PR drafting, scope detection — lives in a standalone CLI; a Claude Code plugin wraps it with a SessionStart hook and `/promote` + sync commands. We split it this way, rather than burying logic in plugin scripts or shipping CLI-only, so the core stays testable outside an agent harness and non-Claude-Code consumers stay possible, while plugin install remains the one-step adoption path.
