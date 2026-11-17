# Tutorials — training the eye, then the hand

Ink Studio can already animate, pose on bones, shade with dabs and ink detail.
What it cannot do is *see*. Every lesson here is one skill: noticing the thing
that makes a render look wrong, then having a knob to fix it.

These are **pseudo-tutorials**: they teach a method, they are runnable against
this repo, and they are honest about which parts are built and which are
targets. Where a lesson describes something we do not have yet, it says so in
the lesson, not in a footnote.

---

## The premise

A pixel render fails in five predictable ways, in this order:

1. **Wrong form source** — modelled geometry with normals that fight the pixel grid
2. **Flat or wrong light** — lighting that arrives at render time instead of at bake time
3. **Render-at-size** — asking a renderer for a beautiful 64px picture (it cannot)
4. **Filtered pixel grid** — resampling onto a canvas instead of declaring the grid by downsampling
5. **Borrowed ink** — one universal outline colour instead of each material's own dark shade

Each lesson takes one of those and gives you the instrument to see it.

## The five-step reference method

The target look, as the owner describes it:

1. build the shapes in code with distance functions, **no 3D model**
2. fill them with tiny gaussian splats and **bake the light into each one**
3. render it small, **4 samples per pixel**
4. **squash every 2×2 block into 1 pixel** and snap it to a small palette
5. give edge pixels **a darker shade of their own colour**, then scale up with **no smoothing**

## Lessons and honest status

| # | Lesson | Teaches | Status in this repo |
|---|---|---|---|
| 01 | [See the lattice](01-see-the-lattice.md) | measuring a render before judging it | **built** — `ramps`, `values`, `stats`, `look.py` audit |
| 02 | [Shapes in code](02-shapes-in-code.md) | authoring form as code, not a model | **built** — scenes are dab code; `llm-author.js` writes them |
| 03 | [Bake the light](03-bake-the-light.md) | light that survives quantisation | **built** — per-dab colour, `--bounce` |
| 04 | [Render small](04-render-small.md) | why 4 spp at low internal res is the anti-alias trick | **partial** — `frames-dump --w/--h` sets internal res; no explicit spp knob (splat scan, not ray march) |
| 05 | [Squash and snap](05-squash-and-snap.md) | the downsample *is* the pixel grid | **built** — `look.py --cell-px` + `--levels` |
| 06 | [Edge and upscale](06-edge-and-upscale.md) | own-colour ink, integer nearest upscale | **built 2026-11-17** — `--outline-mode own` |

## The loop

Everything is one loop, and every step prints numbers:

```
see  →  author  →  render  →  restyle  →  measure  →  see
```

Run the whole loop on a scene in one command:

```bash
bash tutorials/drill.sh cabinet        # any scene id: scenes | watcher | burn | idol | bench | stuff | cabinet
```

It dumps frames, restyles them, writes `contact.png` / `zoom.png`, and prints a
before/after audit. Nothing to trust — go look at the pictures.

## Reference frames

`refs/` holds stills from the reference clip plus `refs/SOURCES.md`. The video
itself is at
`~/SafeHouse/Games/sdf-splat-pixel/reference/crucible_splat_ref_2122375294699159552.mp4`.

Read a frame with your own eyes *before* reading any lesson. The frames carry
the author's own on-screen legend, and that legend is the actual specification —
everything in these lessons was reverse-read from it, not invented.
