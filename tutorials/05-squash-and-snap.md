# 05 — Squash 2×2 into 1 pixel, then snap the palette

**What you are training:** the difference between *downsampling* and *resampling*.
Step 4 of the reference method, and the step that actually creates the pixel grid.

**The rule:** every 2×2 block of the small render becomes **exactly one output
pixel**, and that pixel becomes **one palette colour**. The grid is declared by
the squash, not painted over afterwards.

---

## The law that makes the palette small

It is easy to read "snap to a small palette" as "run a median cut to 20 colours".
That is what most tooling does and it is wrong for this look. Our reference
frames carry the author's own on-screen legend:

> **"3 one colour ramp per material"**

Five materials, each with a 4-5 shade ramp, ≈21-22 colours total, and **no
colour crosses between materials**. The palette is *structural*, not global.

Consequence for this step — and this is the whole lesson:

```
global snap (wrong):   nearest colour in the whole palette
                       → stone shadow can land on a wheat shade
                       → ramp discipline collapses while the count still reads "20"

ramp snap   (right):   nearest colour within THAT material's own ramp
                       → a material never borrows another's shade
                       → count per material stays 4-5
```

A global quantiser will pass every colour-count check you write and still destroy
the look. Count is not the property you are protecting. **Ramp membership is.**

## Do it in this repo

```bash
bash tutorials/drill.sh cabinet
# or directly:
/usr/bin/python3 tools/look.py --frames studio/out/frames-cabinet.json \
  --cell-px 8 --levels 16 --dither bayer-4 --dither-strength 1.0 \
  --outline --outline-mode own
```

What each flag does, in the order it is applied:

| flag | stage | what it means |
|---|---|---|
| `--bands 3` | before the squash | OKLab cel bands — the 3-tone value ladder |
| `--levels 16` | palette | 16 levels per channel == the step-17/255 lattice |
| `--dither bayer-4 --dither-strength 1.0` | palette | dither at exactly **one lattice step** |
| `--cell-px 8` | the squash | vote the quantised frame down to 8 px cells |
| `--bg-threshold 0.12` | mask | how far from the border colour counts as subject |

The cell vote in `look.py` is the squash: it averages each cell, then rounds to
the lattice:

```python
cell = cut.reshape(cvh, k1, cvw, k1, 3).mean(axis=(1, 3))
cell = np.round(cell * (levels - 1)) / (levels - 1)
```

`k1` is clamped to be at least 1 and derived from `cell_px / px` — so the vote
blocks are an **integer** multiple of the studio's dab block, and every cell is
the same size. That clamp is the difference between squashing and smearing.

## Measured (cabinet, real output)

```
BEFORE  cov 0.649  lum 0.244  colours 6  on-lattice 0.001  dither 0.29  outline 0.196  block 2
AFTER   cov 0.631  lum 0.382  colours 5  on-lattice 1.000  dither 0.01  outline 0.060  block 2
```

Read it like this:

- `on-lattice 0.001 → 1.000` — the squash+snap put every pixel on the grid. That
  is the whole point of the stage, and it is the number to defend.
- `lum 0.244 → 0.382` — the cel banding raised the mid-tone into the readable
  band. Same content, better value grouping.
- `dither 0.29 → 0.01` — **not a regression.** After a cell vote a cell carries
  ONE colour, so dither now lives at cell borders. Compare dither only within one
  mode; comparing pre-squash dither to post-squash dither is meaningless.
- `colours 6 → 5` — one ramp step got absorbed by the snap. Watch this number
  walk *down* as cells grow: that is the palette contracting, which is correct.

## What bad looks like

- **Cells of two sizes in one frame** — `cell_px / px` was not an integer.
- **The subject bleeding into the background** — the quantiser was applied
  outside the subject mask. Snap inside `mask > 0.5` only.
- **20 colours that look like 6** — global snap collapsed different materials
  onto the same shades. Check ramp membership per material, not the count.
- **Dither visible as a checkerboard in flat areas** — strength above one lattice
  step. One step is the budget; more is a pattern.

## Checkpoint

Pick one material in your scene and list its shades **after** the squash. If any
shade belongs to a different material's ramp, step 4 is not done — you quantised,
you did not enforce the ramps.
