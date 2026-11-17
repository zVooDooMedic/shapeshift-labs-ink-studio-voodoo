# 01 — See the lattice before you judge the picture

**What you are training:** the ability to name *why* a render looks wrong before
you touch a single knob. Most "make it prettier" attempts fail because the
author is guessing at taste when they could be reading a number.

**The rule:** a pixel render is measured, not admired. Four numbers decide
whether it can ever look right — palette stay-on-lattice, value distribution,
cell size, and colour count within a material. If those are wrong, no amount of
art direction saves it.

---

## Do it

```bash
node cli/ink-studio.js stats cabinet        # splat counts, colours, cost per frame
node cli/ink-studio.js ramps cabinet        # the ramps it is shaded on
node cli/ink-studio.js values cabinet --t 1.5   # is it readable in three tones?
```

## What you should see (real output, `idol`)

```
idol: 9 ramps, 72,472 dabs shaded on them
 65.6%  [1, 2, 3, 3, 4, 5]  #16181c #2c3036 #4a5058 #4a5058 #70777e #a0a6a2   one hue, darker and lighter
 27.9%  [1, 1, 2, 2, 3]  #16181c #16181c #2c3036 #2c3036 #4a5058   one hue, darker and lighter
  0.1%  [11]  #ffd24a   greys
98% of the dabs in the ramps listed are on one-hue ramps
```

```
idol  dark 91%  middle 8%  light 1%   brightness 24 to 208   ONE TONE: 91% of it is dark
```

## How to read it

- **`98% on one-hue ramps` is the good news.** Each material walks its own
  single hue, darker → lighter. That is the ramp discipline the target look
  depends on. If a scene reports a lot of `only gets darker without turning`,
  its materials are collapsing toward mud — fix at the palette, not post.
- **`ONE TONE: 91% of it is dark` is the diagnosis.** A subject that is 91% dark
  cannot read at 64 px: the eye needs three value groups to parse a silhouette.
  The target band is roughly **60/30/10 dark/middle/light**. This scene needs
  light, not more contrast in the shadows.
- **Shade numbers matter more than hex codes.** `[1,2,3,3,4,5]` is a five-step
  ramp with a doubled mid-step. The doubled step is where the form flattens. If
  a ramp repeats a shade, the material has one less readable plane than it
  pretends.

## The trap this lesson exists to prevent

The famous one: *"make it pop"* → crank saturation → the frame leaves the
lattice → it reads as a photo with big pixels instead of pixel art. The
audit in `look.py` prints the field that catches this:

```
on-lattice 0.001   ← wrong: colours are off the 16-level grid
on-lattice 1.000   ← right: every pixel is a lattice step
```

If someone asks for "more pop" and `on_lattice` is already 1.000, saturation is
not the answer. Value grouping is.

## Checkpoint

Before you open any lesson that changes a picture, answer three things about
**your own** scene:

1. What fraction of pixels are on the lattice?
2. What is the dark/middle/light split?
3. How many ramps, and does any ramp repeat a shade?

If you cannot answer all three with numbers, you do not have a target yet — you
have an opinion.
