# 03 — Bake the light into every splat

**What you are training:** the habit of deciding light at author time, so the
renderer never has to be clever. Step 2 of the reference method.

**The rule:** each splat carries its **final colour** — albedo already multiplied
by the light that hits it. There is no light in the render. That is why the look
survives quantisation: variation lives *inside* the object's own ramp, between
lattice steps, instead of arriving from a shading pass after the palette snap.

---

## Why baking is what makes step 4 possible

Step 4 snaps every pixel to a small palette. Anything that is still computing
light at that point gets destroyed — a gradient computed after the snap is
either clipped to one colour or banded by the quantiser, not by the artist.

Baked light flips the order:

```
wrong:  geometry → render → shade → quantise   (shading detail dies at quantise)
right:  geometry + light → bake → render → quantise   (shading detail IS the colour)
```

Consequence: **the number of colours per material is a lighting decision.** A
five-step ramp per material means five planes of light. A three-step ramp reads
as a sports logo. The reference frames sit at 4-5 shades per material — that is
the budget where a chamfer and a groove both stay visible.

## Do it in this repo

The studio bakes colour per dab at author time. Two knobs make baking visible:

```bash
# bounce light, baked into the dabs rather than layered on after
node cli/ink-studio.js render cabinet --bounce --t 1.5 --out /tmp/cab-bounce.png

# smooth body colour instead of per-dab contours
node cli/ink-studio.js render cabinet --colored --t 1.5 --out /tmp/cab-colored.png

# inked detail: colours looked up per pixel, finer than the dab block
node cli/ink-studio.js render cabinet --fine --t 1.5 --out /tmp/cab-fine.png
```

Run all three and put them side by side. The comparison *is* the lesson: the
same form, three different answers to "where does light live".

## How to judge a bake

Zoom to the dab block and look for these three signatures, in order:

1. **Terminator placement** — the dark-to-light edge should follow the form's
   curvature, not the camera. A terminator that swings when you orbit is a
   render-time light; a terminator that sticks is baked.
2. **Ramp continuity** — every step between shades should be exactly one lattice
   step. If two steps look different in size, the ramp was authored unevenly.
3. **Interior contrast** — does the object hold at least three shades inside its
   own silhouette? One shade = painted, five = baked.

## What bad looks like

- **Everything lit from the same direction, equally.** Reads as a sticker sheet.
- **No contact darkening** where the object meets the ground. The eye reads a
  floating object even when the geometry is sitting on the floor.
- **Emissive flat-out.** A lit source that has no ramp (`[11] #ffd24a` in the
  `idol` scene is the tell — one shade, no falloff) reads as a decal, not a
  light. Baked light means the *emission* is one colour but its spill is a ramp.

## Checkpoint

Orbit the scene 8 angles. If the shading *pattern* moves with the camera, it is
not baked. If the pattern stays on the form and only rotates with it, you are
done — and step 4 will not destroy it.
