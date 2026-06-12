#!/usr/bin/env bash
# Builds the throwaway offline demo world used by the VHS tapes (docs/demos/tapes/).
# Fixed literal path: CLI output displays the commons URL, so a fixed path keeps
# renders pixel-identical. Idempotent — nukes and rebuilds on every call.
# Never touches real machine state: all git config + ROBOTO_MEM_HOME live inside the world.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORLD=/tmp/roboto-mem-demo

[ -f "$ROOT/dist/cli.mjs" ] || (cd "$ROOT" && pnpm build)

rm -rf "$WORLD"
mkdir -p "$WORLD"/{home,bin,acme-memory,demo-app,acme-web}

export GIT_CONFIG_GLOBAL="$WORLD/gitconfig"
export GIT_CONFIG_NOSYSTEM=1
git config --file "$WORLD/gitconfig" user.name "Ada Demo"
git config --file "$WORLD/gitconfig" user.email "ada@acme.dev"
git config --file "$WORLD/gitconfig" init.defaultBranch main
git config --file "$WORLD/gitconfig" commit.gpgsign false

# --- commons bare repo + teammate clone (tests/helpers/git.ts pattern) ---
git init --bare --initial-branch=main "$WORLD/commons.git" --quiet
git clone --quiet "$WORLD/commons.git" "$WORLD/teamwork" 2>/dev/null

cat > "$WORLD/teamwork/memory.json" <<'JSON'
{
  "formatVersion": 1,
  "budgets": { "default": 2000, "org": 4000 }
}
JSON

mkdir -p "$WORLD/teamwork/entries/org" \
  "$WORLD/teamwork/entries/squads/web" \
  "$WORLD/teamwork/entries/stacks/react"

cat > "$WORLD/teamwork/entries/org/never-use-let.md" <<'MD'
---
description: Never use let; const everything
type: standard
author: hrithik
date: 2026-06-01
---
Always use const. Restructure with ternary, reduce, or early returns instead of reassigning variables.
MD

cat > "$WORLD/teamwork/entries/org/no-secrets-in-entries.md" <<'MD'
---
description: Secrets never go in Team Memory entries
type: standard
author: ada
date: 2026-05-28
---
Use angle-bracket placeholders like <from-1password> when an example needs a credential. CI scans every entry and blocks real key material.
MD

cat > "$WORLD/teamwork/entries/squads/web/let-hotpaths.md" <<'MD'
---
description: let allowed in hot paths
type: standard
author: hrithik
date: 2026-06-02
overrides: org/never-use-let
---
In tight loops where reducing allocations matters, mutable accumulators are acceptable.
MD

cat > "$WORLD/teamwork/entries/stacks/react/memo-by-default.md" <<'MD'
---
description: Wrapping everything in React.memo made renders slower
type: lesson
author: maya
date: 2026-05-30
---
We memoised every component in the dashboard; prop identity churn made it slower than no memo at all. Profile first, memoise the proven hot spots only.
MD

(cd "$WORLD/teamwork" && git add . && git commit --quiet -m "seed commons" && git push --quiet origin main)

# Lint bait — deliberately UNCOMMITTED so it can never leak into the commons.
# sk-demo4f9a… has no second hyphen on purpose: the api-key rule needs sk- + 20+ alphanumerics.
cat > "$WORLD/teamwork/entries/org/rotate-keys.md" <<'MD'
---
description: Rotate API keys quarterly
type: standard
author: ada
date: 2026-06-10
---
Rotate keys every quarter. Example .env:
API_KEY="sk-demo4f9a2b8c1e7d3a5f9b2c8e1d7a3f"
MD

# --- client overlay repo (the second memory repo for the overlays demo) ---
git init --bare --initial-branch=main "$WORLD/client-memory.git" --quiet
git clone --quiet "$WORLD/client-memory.git" "$WORLD/client-work" 2>/dev/null

cat > "$WORLD/client-work/memory.json" <<'JSON'
{ "formatVersion": 1 }
JSON

mkdir -p "$WORLD/client-work/entries/org"
cat > "$WORLD/client-work/entries/org/client-naming.md" <<'MD'
---
description: Client features use the acme- prefix in package names
type: standard
author: maya
date: 2026-06-05
---
Every package built for this client is named acme-<feature>. No exceptions, including internal tooling.
MD

(cd "$WORLD/client-work" && git add . && git commit --quiet -m "seed client memory" && git push --quiet origin main)

# --- consumer projects ---
cat > "$WORLD/acme-web/package.json" <<'JSON'
{
  "name": "acme-web",
  "private": true,
  "dependencies": { "react": "^19.0.0" }
}
JSON

cat > "$WORLD/demo-app/package.json" <<'JSON'
{
  "name": "demo-app",
  "private": true,
  "dependencies": { "react": "^19.0.0" }
}
JSON

cat > "$WORLD/acme-web/note.md" <<'MD'
Validate request payloads with zod schemas at route boundaries. Parse once, pass typed data inward; never re-validate downstream.
MD

cat > "$WORLD/acme-web/note-rotate.md" <<'MD'
Rotate deploy credentials quarterly. The old access key AKIAIOSFODNN7EXAMPLE must be revoked after rotation.
MD

node "$ROOT/dist/cli.mjs" init "$WORLD/acme-web" \
  --commons-url "file://$WORLD/commons.git" \
  --project acme-web --squads web > /dev/null

# Pre-seed the update-check throttle: 24h window means digest --hook makes no
# network call and prints no nag during recordings.
printf '{"lastUpdateCheck":"%s"}' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$WORLD/home/state.json"

# --- bin shims (prepended to PATH by env.zsh) ---
cat > "$WORLD/bin/roboto-mem" <<SH
#!/usr/bin/env bash
exec node "$ROOT/dist/cli.mjs" "\$@"
SH

cat > "$WORLD/bin/gh" <<'SH'
#!/usr/bin/env bash
# Fake gh for offline demos: answers `pr create` with a fixed PR URL.
set -euo pipefail
if [ "${1:-}" = "pr" ] && [ "${2:-}" = "create" ]; then
  echo "https://github.com/acme/team-memory/pull/128"
  exit 0
fi
echo "fake gh: unsupported: $*" >&2
exit 1
SH

cat > "$WORLD/bin/teammate-push" <<'SH'
#!/usr/bin/env bash
# Hidden tape beat: a teammate lands a new Standard in the commons.
# Path-scoped git add (pushEntry pattern) — the uncommitted lint bait can never leak.
set -euo pipefail
cd /tmp/roboto-mem-demo/teamwork
cat > entries/squads/web/use-server-actions.md <<'MD'
---
description: Mutations go through Server Actions, not API routes
type: standard
author: maya
date: 2026-06-12
---
New mutations use Next.js Server Actions. Reserve route handlers for webhooks and third-party callbacks.
MD
git add entries/squads/web/use-server-actions.md
git commit --quiet -m "add squads/web/use-server-actions"
git push --quiet origin main
SH

cat > "$WORLD/bin/add-overlay" <<'SH'
#!/usr/bin/env bash
# Tape helper: adds the client overlay to .roboto-mem.json (stands in for "open it in your editor").
set -euo pipefail
cd /tmp/roboto-mem-demo/acme-web
python3 - <<'PY'
import json
c = json.load(open(".roboto-mem.json"))
c["overlays"] = ["file:///tmp/roboto-mem-demo/client-memory.git"]
json.dump(c, open(".roboto-mem.json", "w"), indent=2)
PY
SH

chmod +x "$WORLD/bin/roboto-mem" "$WORLD/bin/gh" "$WORLD/bin/teammate-push" "$WORLD/bin/add-overlay"

cat > "$WORLD/env.zsh" <<'ZSH'
export ROBOTO_MEM_HOME=/tmp/roboto-mem-demo/home
export PATH=/tmp/roboto-mem-demo/bin:$PATH
export GIT_CONFIG_GLOBAL=/tmp/roboto-mem-demo/gitconfig
export GIT_CONFIG_NOSYSTEM=1
setopt interactive_comments
PROMPT='%F{magenta}❯%f '
cd /tmp/roboto-mem-demo/acme-web
ZSH

echo "demo world ready at $WORLD"
