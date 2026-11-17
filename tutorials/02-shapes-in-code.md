# 02 — Shapes in code, never a model

**What you are training:** the instinct to build form from primitives and
composition rather than from a mesh somebody else authored. This is step 1 of
the reference method, and it is the step that decides whether everything after
it can work.

**The rule:** the form comes from **distance functions composed in code**. No
imported model. A modelled high-poly surface carries normals and a shading
history that fight a 16-level lattice — you cannot quantise a sculpted normal
map into three value bands without losing the form it was carrying.

---

## Why "no model" is not ideology

Three concrete reasons, all mechanical:

1. **Silhouette control.** A distance function gives you the distance to the
   surface, so you can *inflate, cut and round* by changing one number. A mesh
   gives you a vertex set; changing the silhouette means re-topologising.
2. **Free re-posing.** The reference clip shows the same shape at many angles.
   SDF primitives can be re-evaluated at any camera; a mesh can only be rotated,
   and its shading breaks the pixel law at oblique angles.
3. **Cheap sub-pixel detail.** Step 3 renders at tiny internal resolution. Detail
   that has to survive there must be *structural* (a chamfer, a groove), not
   texture — and structural detail is exactly what distance functions express.

## Do it in this repo

Ink Studio's scenes are already code-first: a diorama is a JS module that pushes
splats with explicit primitives, ramps and beats. Nothing is modelled.

```bash
node cli/ink-studio.js stats idol          # what the scene is made of
node cli/ink-studio.js render idol --t 1.5 --out /tmp/idol.png
```

To author a *new* shape from a sentence rather than by hand:

```bash
# writes a scene module from a prompt, looping until node --check passes
node tools/llm-author.js "a squat stone lantern, chipped lip, warm interior"
```

The prompt it uses is `tools/llm-author-prompt.md`. Read that file before you
run it: it is where the form vocabulary lives (primitive types, how to compose
them, what a ramp means), and it is the real tutorial for this step.

## Where the literal distance functions live

This repo composes *dabs* on primitives. If you need a true SDF — signed
distance evaluated per point, with CSG and smooth-min blends — that lane is
`~/SafeHouse/Games/sdf-splat-pixel/sdf_splat.py`:

```bash
python sdf_splat.py --shape scene --res 160 --out out/scene.ply
```

Both roads end in the same place (a splat set with baked colour). Use this repo
when you want animation, bones and beats; use the SDF lane when you want form
you can re-evaluate at any camera.

## What bad looks like

- Imported mesh whose facets read as **stair-steps** at 2 px — detail too small
  to survive the downsample, so it turns into noise.
- Silhouette that has **no chamfer** — at three value bands an unbevelled corner
  vanishes; the object looks like a blob with a highlight.
- Surface detail carried as **texture** — it either disappears in step 4 or
  fights the palette snap.

## Checkpoint

Look at your silhouette zoomed 8× and answer: **could I move this outline 1 px
in 4 places by changing 4 numbers?** If the answer is "no, I'd have to remodel",
you are importing a form, not authoring one.
