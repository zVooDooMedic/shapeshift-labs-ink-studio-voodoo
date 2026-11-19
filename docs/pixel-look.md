# Tone and stipple

The stipple look maps the lit frame to a small palette on a fixed screen grid.
Try it with the [polished seal](../examples/stipple.json).

```sh
node cli/ink-studio.js render examples/stipple.json --w 1024 --h 1024 --t 1.5
node cli/ink-studio.js clip examples/stipple.json --w 1024 --h 1024 --from 0 --to 3 --fps 24
node cli/ink-studio.js shimmer examples/stipple.json --mode still --t 0 --frames 15 --step 0.2
```

In JSON, set `finish.look.tone` to `"stipple"` or an object that overrides
preset settings. In JavaScript, pass the same `look` object to `B.finish()`.
The CLI can preview the preset on any scene with `--tone stipple`.
Use `--tone off` to switch to the scene's regular palette.

```json
{
  "finish": {
    "look": {
      "pixelSize": 2,
      "tone": {
        "preset": "stipple",
        "cutoff": 0.2,
        "stops": [[0, "#000000"], [0.22, "#176bfa"], [0.8, "#ff8d27"], [1, "#fff1cd"]],
        "pattern": "blue-noise",
        "seed": 17,
        "amount": 0.85,
        "preserveDots": true
      }
    }
  }
}
```

- `pixelSize` fixes the number of screen pixels per art pixel. At 1024 × 1024,
  a size of 2 produces a 512 × 512 art grid. The CLI uses nearest-neighbor
  enlargement. `--px` overrides the scene's size.
- `cutoff` maps luminance at or below that value to black. The renderer
  remaps the range above the cutoff to 0–1 before looking up `stops`.
  Provide 2–48 strictly increasing stops. Start with `[0, "#000000"]`
  and end at position 1. The stops define an output palette independent
  of the sculpt's material palette.
- `pattern` selects a repeating 4 × 4 `bayer` tile or the toolkit's
  `blue-noise` tile. The blue-noise `seed` changes the pattern.
  Both tiles are anchored to the top-left of the art grid.
  `amount` ranges from 0, a hard transition between stops, to 1, the full
  threshold pattern.
- `preserveDots` skips the scene's pixel cleanup by default. `--clean`
  explicitly enables cleanup. `--raw` bypasses the tone mapping.
  An enabled tone mode takes precedence over `--colored`.

Use the [surface light track](surface-materials.md#animate-the-finish-light) to
move the highlights between color bands. The threshold pattern stays fixed
across frames.

## Host integration

The [WebGL canvas renderer](browser-renderer.md) reads the world's `look.tone`.
Pass `tone` in the frame options to override the look, and set the canvas
drawing buffer dimensions to the desired art resolution. The headless
renderer derives that grid from its viewport and `look.pixelSize` or `--px`.

`PixelLook.prepareTone(settings, KIT.procedural.materials.blueNoise)`
returns the ordered stops, packed output palette, tile dimensions and an
array of normalized thresholds. Prepare it once per look. A CPU host can use
`PixelLook.toneIndex(prepared, r, g, b, x, y)` to look up a palette index.

A WebGL 2 host can include `PixelLook.toneGlsl` in its fragment shader and
call `inkToneResolve(litRgb, artPixel)` before enlargement. Pass normalized
lit RGB composited over black and integer art-pixel coordinates measured
from the top-left. Set `u_inkToneCount` to the number of stops,
`u_inkToneCutoff` and `u_inkToneAmount` to the prepared settings, and
`u_inkToneStops` to the normalized RGB colors with stop positions in alpha.
Upload the threshold array as an `R32F` texture with nearest filtering and
bind it to `u_inkToneRanks`.
