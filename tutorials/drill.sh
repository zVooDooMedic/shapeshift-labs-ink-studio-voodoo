#!/usr/bin/env bash
# tutorials/drill.sh — one full loop: see -> render -> restyle -> measure.
#
#   bash tutorials/drill.sh [sceneId] [cellPx]
#   bash tutorials/drill.sh cabinet 8
#
# Prints a before/after audit and writes contact.png / zoom.png you can actually look at.
# Nothing here is inferred: every number printed comes from tools/look.py's audit.json.
set -euo pipefail

SCENE="${1:-cabinet}"
CELL="${2:-8}"
MODE="${3:-ramp}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
cd "$ROOT"

PY=/usr/bin/python3
FRAMES="studio/out/frames-$SCENE.json"
OUT="studio/out/look/$SCENE"

echo "== 1. render small (pre-upscale dab canvas, with the diorama's own material ramps) =="
node tools/frames-dump.js "$SCENE" --n 4 --turn 4 --px1 --out "$FRAMES"

echo
echo "== 2. restyle: 3 bands -> lattice+dither -> ${CELL}px cell vote -> ${MODE} palette snap -> own-colour ink -> nearest =="
rm -rf "$OUT"
$PY tools/look.py --frames "$FRAMES" --out-dir "$OUT" \
  --bands 3 --levels 16 --dither bayer-4 --dither-strength 1.0 \
  --cell-px "$CELL" --palette-mode "$MODE" \
  --outline --outline-mode own --outline-steps 1 --target 600

echo
echo "== 3. look at it =="
echo "   before/after : $OUT/contact.png"
echo "   zoomed 3x    : $OUT/zoom.png"
echo "   raw frames   : $OUT/raw/"
echo "   restyled     : $OUT/look/"
echo "   audit json   : $OUT/audit.json"
