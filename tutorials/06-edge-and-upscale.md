# 06 — Own-colour edges, then scale with no smoothing

**What you are training:** the last two decisions, which are the two most people
get wrong because they are invisible until you compare them side by side. Step 5
of the reference method.

**The rule:** an edge pixel is **a darker shade of the colour it belongs to** —
never a universal ink colour — and the final upscale is **integer
nearest-neighbour**. No interpolation, no bilinear, no "sharpening afterwards".

---

## The outline law, and how it was read off the reference

In the reference frames, the stone windmill is outlined in a darker blue-grey,
the sails in a darker gold, the wheat in a darker brown/orange. There is no
black anywhere. Each edge is **one ramp step down from its own fill**.

That matters for two reasons:

1. **On-lattice.** A universal ink colour like `#0c0c14` is not a lattice step,
   so every outlined pixel leaves the grid you just spent step 4 establishing.
   An own-colour edge snapped to the lattice step below stays on-grid.
2. **Material identity.** A universal outline flattens every material into the
   same silhouette weight. Own-colour edges let a warm object and a cold object
   read as different substances while sharing one drawing style.

## Do it in this repo

`tools/look.py` now implements both modes:

```bash
# the reference look: edge = one lattice step darker than its own fill
/usr/bin/python3 tools/look.py --frames studio/out/frames-cabinet.json \
  --outline --outline-mode own --outline-steps 1

# the older look: one universal outline colour
/usr/bin/python3 tools/look.py --frames studio/out/frames-cabinet.json \
  --outline --outline-mode ink --outline-color 12,12,20

# no outline at all, as a control
/usr/bin/python3 tools/look.py --frames studio/out/frames-cabinet.json --no-outline
```

## Measured (cabinet, real output, identical inputs)

```
no outline   AFTER  cov 0.633  lum 0.393  colours 6  on-lattice 1.000  outline 0.049
ink  (universal)  AFTER  cov 0.633  lum 0.393  colours 6  on-lattice 1.000  outline 0.049   ← identical
own  (own colour) AFTER  cov 0.631  lum 0.382  colours 5  on-lattice 1.000  outline 0.060   ← changed
```

Three things to take from that table:

- **`ink` output is byte-identical to no-outline.** That is a real bug, not a
  subtlety: `render_pixel.add_outline` imports `scipy.ndimage` and returns the
  image untouched when scipy is missing — and this machine's system python has
  no scipy. The flag was silently doing nothing. `own` mode is numpy-only, so it
  actually fires.
- **`own` stays at `on-lattice 1.000`.** Darkening by a whole lattice step
  instead of multiplying by 0.55 is what preserves that.
- **`colours 6 → 5` and `lum 0.393 → 0.382`** are the outline taking one ramp
  step out of circulation. Small, and exactly the size of a 1 px inner edge.

## The upscale half of the rule

```python
k2 = max(1, int(round(target / max(cvw, 1))))    # integer only
look_out = np.repeat(np.repeat(..., k2, 0), k2, 1)
```

`np.repeat` is not lazy shorthand for "resize" — it is the guarantee. Every
source pixel becomes a solid `k2 × k2` block, so the grid survives the upscale
exactly. The moment you use PIL's `.resize()` with any default filter, you have
invented colours that were never on the palette, and the audit's `on_lattice`
will start falling below 1.000.

And the other half: **never upscale the raw frame.** `look.py` deliberately keeps
the raw side at its native size — upscaling it would invent studio pixels the
studio never drew, and the before/after comparison would be style *plus* scale.

## What bad looks like

- A **black halo** on a warm object — universal ink. Wrong law.
- **`on_lattice` below 1.000 only where the outline is** — the outline colour is
  off-lattice. Darken by a lattice step, not by a factor.
- **Soft edges after upscaling** — an interpolating filter got in. Nearest only.
- **Outline on interior detail** instead of silhouette — the mask erosion ran on
  a mask that included colour boundaries rather than the subject edge.

## Checkpoint

Zoom your render 8× and answer: **is every edge pixel a darker version of the
colour beside it?** Then check the audit still reads `on_lattice 1.000` and
`block` equal to your cell size. If both hold, step 5 is done and the frame is on
the reference law.
