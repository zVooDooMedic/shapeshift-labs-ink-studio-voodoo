#!/usr/bin/env bash
# bake_clip.sh <clip-env> <clip-name> <t0> <t1> <nframes> <outdir>
#
# One animation clip -> full 8-angle 3DGS sprite set, through the measured chain:
#   ink-studio pose dump  -> densify 8 (70k+ splats) -> palette/selout/rim pass
#
# Example (walk, from the knight rig):
#   KNIGHT_MOVE=1 KNIGHT_PERIOD=999 ./bake_clip.sh "" walk 0.06 0.70 8
set -euo pipefail
INK="${INK:-$HOME/SafeHouse/Games/ink-studio}"
SDF="${SDF:-$HOME/SafeHouse/Games/sdf-splat-pixel}"
SCENE="${SCENE:-$INK/lab/knight.js}"
CLIP_ENV="${1:-}"
CLIP="${2:?clip name}"
T0="${3:-0}"
T1="${4:-1}"
N="${5:-8}"
OUT="${6:-$HOME/Projects/pixel-hard/assets/sprites/knight_splat}"
CELL="${CELL:-48}"
WORK="${WORK:-$HOME/.hermes/cache/scratch/bake_$CLIP}"

mkdir -p "$WORK/frames" "$OUT"
echo "== $CLIP: env='$CLIP_ENV' times $T0..$T1 n=$N cell=$CELL"

env $CLIP_ENV node "$INK/tools/_dump-frames-ply.js" "$SCENE" "$WORK/frames" "$T0" "$T1" "$N"

for f in "$WORK"/frames/frame_*.json; do
  idx=$(basename "$f" .json | sed 's/frame_//')
  python3 "$INK/tools/ink_to_ply.py" "$f" "$WORK/k_$idx.ply" --densify 8 >/dev/null
  python3 "$SDF/tools/splat_turntable.py" --ply "$WORK/k_$idx.ply" \
    --angles 8 --cell "$CELL" --pitch 22 --fov 30 \
    --key 1.30 --rim 0.65 --ambient 0.20 --bands 3 --dither-strength 0.25 \
    --clip "$CLIP" --frame-index "$((10#$idx))" --export-dir "$OUT" \
    --out "$WORK/turn_$idx" 2>&1 | grep -E "TURN-COVER-OK|TURN-EXPORT" || true
done
echo "== $CLIP done: $(ls "$OUT/${CLIP}_f"*.png 2>/dev/null | wc -l) files"
