#!/usr/bin/env bash
# Renders the roboto-mem demo tapes into docs/demos/{gif,mp4}.
# Usage: scripts/render-demos.sh [tape-name ...]   (default: all top-level tapes)
# Requires: brew install vhs   (the first-ever vhs run downloads a headless browser)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" # vhs resolves Source/Output paths from its CWD

command -v vhs >/dev/null || { echo "missing vhs — brew install vhs" >&2; exit 1; }
[ -f dist/cli.mjs ] || pnpm build
mkdir -p docs/demos/gif docs/demos/mp4

tapes=()
if [ $# -gt 0 ]; then
  for name in "$@"; do tapes+=("docs/demos/tapes/${name%.tape}.tape"); done
else
  while IFS= read -r t; do tapes+=("$t"); done \
    < <(find docs/demos/tapes -maxdepth 1 -name '*.tape' | sort)
fi

for tape in "${tapes[@]}"; do
  echo "=== rendering $tape"
  bash "$ROOT/scripts/make-demo-world.sh" >/dev/null # identical world before EVERY tape
  vhs "$tape"
done

echo "--- sizes"
du -h docs/demos/gif/*.gif docs/demos/mp4/*.mp4 2>/dev/null | sort -k2
find docs/demos/gif -name '*.gif' -size +5M | while IFS= read -r f; do
  echo "WARNING: $f exceeds 5MB — trim Sleeps or gifsicle -O3 --lossy=80"
done
