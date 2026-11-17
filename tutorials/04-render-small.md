# 04 — Render small, 4 samples per pixel

**What you are training:** the counter-intuitive move — **do not ask the renderer
for a pixel-art picture.** Render small and noisy, and let the downsample decide
the pixel grid. Step 3 of the reference method.

**The rule:** total budget is **4 samples per final pixel**. Render at 2× the
final resolution and take exactly 4 samples per output pixel (2×2), or render at
final resolution with 4 jittered samples. Either way the number is 4, and it is
spent *before* any palette work.

---

## Why 4

It is the smallest number that still averages away the aliasing a hard edge
produces, without averaging away the edge itself:

| samples/pixel | what it buys | what it costs |
|---|---|---|
| 1 | maximum chunk, maximum shimmer | edges crawl between frames; hard to read |
| **4** | edge stability while staying crisp | the target |
| 16+ | smooth gradients | gradients are forbidden anyway — step 4 snaps them |
| 64+ | photographic | the whole look is gone |

The insight most people miss: **4 spp is not a quality setting, it is a
filtering contract.** The 2×2 squash in step 4 performs the resolve. Rendering
at high resolution and then resampling with an interpolating filter is the same
number of samples spent worse — it smears across lattice cells.

## Do it in this repo

Ink Studio does not ray-march, so "samples per pixel" arrives as **dab density on
a small canvas**. The equivalent contract:

```bash
# the studio renders at its own dab canvas; dump it rather than upscaling a PNG
node tools/frames-dump.js cabinet --n 4 --turn 4 \
  --w 900 --h 620 --out studio/out/frames-cabinet.json --px1
```

`--px1` forces the dump to the **pre-upscale dab canvas** — the frames the studio
actually drew, not the PNG it inflated by its dab block. This is the single most
important flag in the whole tutorial set:

- The JSON carries `px` = the studio's dab block in screen px.
- Measuring `px` from a rendered PNG gives you the *upscale factor*, not the dab.
- `--px1` keeps the raw side honest; `look.py` never upscales the raw frame —
  it refuses to invent studio pixels that were never drawn.

Then check what you got, before restyling:

```bash
/usr/bin/python3 - <<'PY'
import json,base64,numpy as np
d=json.load(open("studio/out/frames-cabinet.json"))
f=d["frames"][0]
a=np.frombuffer(base64.b64decode(f["rgb"]),np.uint8).reshape(f["h"],f["w"],3)
print("canvas", a.shape[1], "x", a.shape[0], " dab block px =", f["px"])
PY
```

## The trap this lesson exists to prevent

**"Render at 600 px and let it look pixelated."** It will not. A renderer at
600 px draws 600 px of detail; downsampling that to 150 px with a box filter
keeps about 6% of it and smears the rest across cells. The look comes from the
grid being *declared early*, which means a small canvas all the way through.

Second trap: **upscaling before restyling.** Once you have resized a frame up,
every lattice measurement afterwards is a lie. Always: small → restyle → measure
→ nearest upscale, last.

## Checkpoint

Answer these about your own dump:

1. What is the canvas size in the JSON (not the PNG)?
2. What is `px` (the dab block)?
3. Is your eventual cell exactly an integer multiple of `px`?

If `cell / px` is not an integer, you are resampling, not squashing — and step 5
will produce cells of two different sizes in the same frame.
