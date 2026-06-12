#!/usr/bin/env bash
# Renders the produced (captioned) feature videos + the hero walkthrough via the
# Remotion studio in docs/demos/studio. Run AFTER scripts/render-demos.sh —
# it consumes the raw VHS clips in docs/demos/mp4/.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STUDIO="$ROOT/docs/demos/studio"
OUT="$ROOT/docs/demos/out"

ls "$ROOT"/docs/demos/mp4/*.mp4 >/dev/null 2>&1 \
  || { echo "no raw clips — run scripts/render-demos.sh first" >&2; exit 1; }
[ -d "$STUDIO/node_modules" ] || (cd "$STUDIO" && npm install --no-fund --no-audit)

mkdir -p "$STUDIO/public/clips" "$OUT/features"
cp "$ROOT"/docs/demos/mp4/*.mp4 "$STUDIO/public/clips/"

cd "$STUDIO"
for f in "$ROOT"/docs/demos/mp4/*.mp4; do
  id="$(basename "$f" .mp4)"
  # the live recording has no studio composition — it ships raw
  [ "$id" = "11-claude-live" ] && continue
  echo "=== rendering f-$id"
  npx remotion render "f-$id" "$OUT/features/$id.mp4" --log=error
done

echo "=== rendering hero"
npx remotion render hero "$OUT/hero.mp4" --log=error
npx remotion render hero "$OUT/hero.gif" --codec=gif --every-nth-frame=2 --scale=0.5 --log=error

echo "--- sizes"
du -h "$OUT"/features/*.mp4 "$OUT"/hero.mp4 "$OUT"/hero.gif | sort -k2
