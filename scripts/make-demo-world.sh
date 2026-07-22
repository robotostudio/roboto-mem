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
mkdir -p "$WORLD"/{home,bin,acme-memory,demo-app,acme-web,acme-api}

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

# --- upstream skills repo (the vendoring source for the skill-add demo) ---
git init --bare --initial-branch=main "$WORLD/skills.git" --quiet
git clone --quiet "$WORLD/skills.git" "$WORLD/skills-work" 2>/dev/null

mkdir -p "$WORLD/skills-work/skills/grill-me"
cat > "$WORLD/skills-work/skills/grill-me/SKILL.md" <<'MD'
---
name: grill-me
description: Interview the user about a plan until every branch of the decision tree is resolved
---
Ask one question at a time. Chase every "it depends" to a concrete answer. Stop only when the plan survives all of them.
MD

(cd "$WORLD/skills-work" && git add . && git commit --quiet -m "grill-me" && git push --quiet origin main)

# --- v2 commons (global library model) bare repo + teammate clone ---
# Hand-built: `init --commons` still scaffolds v1-only. libraries/<name>/ dirs
# drive init's dep auto-detection; auth0 is deliberately in NO project's deps
# so the init tape shows available-vs-detected.
git init --bare --initial-branch=main "$WORLD/commons-v2.git" --quiet
git clone --quiet "$WORLD/commons-v2.git" "$WORLD/teamwork-v2" 2>/dev/null

cat > "$WORLD/teamwork-v2/memory.json" <<'JSON'
{
  "formatVersion": 2,
  "budgets": { "defaultTotal": 2000, "libraryMax": 1000 }
}
JSON

mkdir -p "$WORLD/teamwork-v2/libraries"/{next,react,resend,auth0} \
  "$WORLD/teamwork-v2/entries"

cat > "$WORLD/teamwork-v2/libraries/next/LIBRARY.md" <<'MD'
# next — team guide

How we use Next.js at Acme.

- App Router only; no new pages/ routes.
- Mutations go through Server Actions; route handlers are for webhooks.
- Default to Server Components; add "use client" only at interactive leaves.
- Co-locate loading.tsx and error.tsx with every route segment.
MD

cat > "$WORLD/teamwork-v2/libraries/react/LIBRARY.md" <<'MD'
# react — team guide

How we write React at Acme.

- Composition over prop drilling; extract children, not booleans.
- Derive state during render; useEffect is for external systems only.
- Profile before memoising — React.memo is not a default.
- Keys are stable ids, never array indexes.
MD

cat > "$WORLD/teamwork-v2/libraries/resend/LIBRARY.md" <<'MD'
# resend — team guide

How we send email at Acme.

- Send only from verified sender domains — never onboarding@resend.dev in prod.
- Set an idempotency key on every retried send.
- Build templates with react-email; no hand-written HTML strings.
- One From address per product surface; reply-to goes to support.
MD

cat > "$WORLD/teamwork-v2/libraries/auth0/LIBRARY.md" <<'MD'
# auth0 — team guide

How we use Auth0 at Acme.

- Rotate client secrets quarterly; store them in the team vault.
- Refresh token rotation is mandatory for SPAs.
- Use Organizations for B2B tenants — never roll custom tenant claims.
- Test rules against a staging tenant before promoting them.
MD

# Flat v2 entries: no scope key = global (always applies);
# scope: library:<name> applies only when that library is declared.
cat > "$WORLD/teamwork-v2/entries/decision-framework.md" <<'MD'
---
description: Write down the decision before writing the code
type: standard
author: hrithik
date: 2026-07-10
---
Before building anything non-trivial, write a three-line decision record:
the problem, the option you chose, and the option you rejected.
Put it in the PR description — reviewers approve the decision first,
the diff second.
MD

cat > "$WORLD/teamwork-v2/entries/resend-sender-domain.md" <<'MD'
---
description: Production email sends from verified domains only
type: standard
author: ada
date: 2026-07-12
scope: library:resend
---
Every production send uses a verified sender domain. onboarding@resend.dev
is for local experiments only — CI blocks it outside test files.
MD

cat > "$WORLD/teamwork-v2/entries/resend-rate-limits.md" <<'MD'
---
description: Bulk sends tripped Resend's rate limit and dropped receipts
type: lesson
author: maya
date: 2026-07-15
scope: library:resend
---
A per-user send loop hit the rate limit mid-batch; use batch endpoints or queue with backoff.
MD

(cd "$WORLD/teamwork-v2" && git add . && git commit --quiet -m "seed commons-v2" && git push --quiet origin main)

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
  "dependencies": {
    "next": "^15.3.2",
    "react": "^19.0.0",
    "resend": "^4.5.1"
  }
}
JSON

cat > "$WORLD/acme-api/package.json" <<'JSON'
{
  "name": "acme-api",
  "private": true,
  "dependencies": {
    "next": "^15.3.2",
    "react": "^19.0.0",
    "resend": "^4.5.1"
  }
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

# Pre-bind acme-api the v2 way. HOME + ROBOTO_MEM_HOME point into the world so
# init's auto-sync materializes libraries into $WORLD/home, never the real one
# (env.zsh exports the same values at tape time).
HOME="$WORLD/home" ROBOTO_MEM_HOME="$WORLD/home" node "$ROOT/dist/cli.mjs" init "$WORLD/acme-api" \
  --commons-url "file://$WORLD/commons-v2.git" \
  --libraries next,react,resend > /dev/null

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

cat > "$WORLD/bin/teammate-add-skill" <<'SH'
#!/usr/bin/env bash
# Hidden tape beat: a teammate's skill PR merges in the commons.
# Path-scoped git add (pushEntry pattern) — the uncommitted lint bait can never leak.
set -euo pipefail
cd /tmp/roboto-mem-demo/teamwork
mkdir -p skills/deploy-checklist
cat > skills/deploy-checklist/SKILL.md <<'MD'
---
name: deploy-checklist
description: The team's pre-deploy checklist — run before every production release
---
Verify migrations are reversible, feature flags default off, and the rollback command is in the deploy message before shipping.
MD
git add skills/deploy-checklist
git commit --quiet -m "skill(deploy-checklist): add"
git push --quiet origin main
SH

cat > "$WORLD/bin/teammate-update-library" <<'SH'
#!/usr/bin/env bash
# Hidden tape beat: a teammate improves the resend library guide in the commons.
# Path-scoped git add (pushEntry pattern), same as teammate-add-skill.
set -euo pipefail
cd /tmp/roboto-mem-demo/teamwork-v2
cat >> libraries/resend/LIBRARY.md <<'MD'
- Batch sends: prefer audiences + broadcasts over per-user loops.
MD
git add libraries/resend/LIBRARY.md
git commit --quiet -m "update libraries/resend"
git push --quiet origin main
SH

chmod +x "$WORLD/bin/roboto-mem" "$WORLD/bin/gh" "$WORLD/bin/teammate-add-skill" "$WORLD/bin/teammate-update-library"

cat > "$WORLD/env.zsh" <<'ZSH'
# HOME redirected into the world: skill materialization targets ~/.claude/skills,
# and recordings must never touch the real one. zsh startup already ran with the
# real HOME, and git config is pinned by GIT_CONFIG_GLOBAL, so this only affects
# the tools the tapes invoke.
export HOME=/tmp/roboto-mem-demo/home
export ROBOTO_MEM_HOME=/tmp/roboto-mem-demo/home
export PATH=/tmp/roboto-mem-demo/bin:$PATH
export GIT_CONFIG_GLOBAL=/tmp/roboto-mem-demo/gitconfig
export GIT_CONFIG_NOSYSTEM=1
setopt interactive_comments
PROMPT='%F{magenta}❯%f '
cd /tmp/roboto-mem-demo/acme-web
ZSH

echo "demo world ready at $WORLD"
