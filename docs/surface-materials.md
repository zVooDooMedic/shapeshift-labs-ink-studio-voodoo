# Surface materials

A surface finish is an ordered list of effects evaluated as the camera moves. Use it with the same sculpt materials, colour ramps and procedural patterns you already use. The headless renderer evaluates opaque layers at the art-pixel sample in per-pixel scenes. It also shades ordinary splats and composites translucent finishes over opaque surfaces.

## Start with a preset

```js
const steel = K.surface.preset('brushed-steel', { r: [1, 2, 3] }, {
  direction: 'y',
  layers: {
    brush: { roughness: [0.12, 0.55], color: '#dceeff', strength: 0.85 },
    varnish: { type: 'specular', roughness: 0.12, strength: 0.25 }
  }
});
S.ball([0, 1, 0], 0.8, steel, { res: 0.07 });
```

`preset(name, base, overrides)` returns a new material. The base can be a material object or a palette ramp. A base material's existing surface settings and the supplied overrides merge over the recipe in that order. Preset values are isolated from edits to the result. Change a layer by its name, add a new one, or set an existing one to `false` to disable it. Layer names and defaults are listed in [the preset definitions](../src/kit/kq-surface-presets.js).

Use `K.surface.material(base, settings)` to create or extend a finish directly. For example, this waxed surface has a highlight across the grain and a softer warm rim.

```js
const waxed = K.surface.material({ r: [4, 5, 6] }, {
  direction: [0, 1, 0],
  layers: {
    wax: { type: 'specular', roughness: [0.09, 0.35], strength: 0.7 },
    rim: { type: 'sheen', color: '#ffd9a1', power: 2, strength: 0.28 }
  }
});
```

For per-pixel rendering set `S.pixel = true` before baking and set `look: { pixel: true }` on the finished world. The ordinary splat path evaluates the same effects at splat centres. An optional surface finish takes over from the material's baked `gloss`.

## Shared settings

- **Direction** accepts `'x'`, `'y'`, `'z'`, an XYZ vector, or a JavaScript function `(position, normal) => direction`. The shader projects it onto the surface. Use `{ type: 'circular', axis: 'z' }` for concentric grooves or `{ type: 'weave', along: 'x', across: 'y', scale: 0.2 }` for alternating directions. A splat can supply a local tangent, such as a strand in combed fur.
- **Origin, scale and seed** set the reference frame for the material pattern. Sample positions are relative to `origin` and divided by `scale`. The seed keeps random-looking details repeatable and attached to the same positions.
- **Normal variation** uses `normal: { type: 'noise' | 'waves', amplitude, scale, axis, cross, speed }`. Wave speed is in radians per second. The shader softens fine variations as they become smaller than an art pixel.
- **Ripple sources** use `normal: { type: 'rings', amplitude, scale, speed, width, damping, drops }`. Each drop has an `at` position in the material's coordinate frame and an optional `start`, `repeat` and `strength`. Rings travel at `speed` units per second, with `scale` controlling wavelength and `width` controlling the wave packet. The same surface layers respond as the rings move. [Beacon pool example](../examples/beacon-pool.js)
- **Opacity** optionally scales the base material's alpha with `opacity: { facing, grazing, power }`. Set `a` on the base material for translucency and use values from zero to one for the two multipliers. Setting `glass: true` also uses the renderer's existing glass distortion.
- **Layer controls** include `strength` from zero to one, `rotation` in radians, and `steps` for stepped highlights. Colours can be palette indices, hex strings or normalized RGB triples. A layer's `shadow: false` lets it use the direct light in baked shadow.
- **Layer masks** include `{ type: 'noise', scale, low, high, seed }`, `{ type: 'stripes', axis, scale, width, phase, feather }` and `{ type: 'checker', axis, cross, scale }`. Use `invert: true` to swap the painted and bare regions. In JavaScript a layer may also use `mask(x, y, z, frame)` returning coverage from zero to one. It receives the unscaled rest-space position and a geometric frame with `normal`, `tangent`, `bitangent`, and `footprint`. This lets a mask share contact fields with sculpt materials or filter subpixel patterns. See [material mapping](./procedural.md#material-mapping-ramps-and-distance-ink).

| Layer type | Controls |
| --- | --- |
| `specular` | Set `roughness` to one value or to `[along, across]` to shape the reflected highlight. Set `color` for a tinted highlight. |
| `fiber` | Set `roughness`, `shift` and optionally `figure`, `axis` and `scale` for tilted fibres with a moving band. |
| `reflection` | Approximate sky, horizon and ground reflection with `sky`, `horizon` and `ground` colours. Use `f0` and `power` to shape the facing-to-grazing response. |
| `sheen` | Choose a grazing `color` and control its width with `power` and its grain bias with `directional`. |
| `film` | Set `thickness` and `variation` in nanometres, `ior`, `scale` and optional `colors`. Set `flash` for an angle-limited flash or `axisBias` to steer the effect toward the grain. |
| `diffraction` | Configure groove `spacing` and `bandwidth` in nanometres, diffraction `order` and the angular `roughness` across the effect. |
| `directionalColor` | Blend between `color` and `crossColor` according to the grain and view. Set `width` and `bias` to tune the shift. |
| `glints` | Set cell `scale`, candidate `density`, inset `radius`, normal `tilt`, angular `roughness` and one `color` or a list of `colors`. A lower `response` makes faint glints more visible. Glints are deterministic, fade at subpixel size, and can survive the pixel cleanup pass. |

These are stylized reflectance models. The CLI resolves them into the scene palette and uses its existing baked direct-light visibility. Subtle tones can share the same palette entry, so include colours for any highlights you want visible in the final render.

## Presets

- **Grain and fibre** include `brushed-steel`, `brushed-brass`, `machined-knob`, `cross-brushed-metal`, `scratched-metal`, `carbon-fibre`, `satin`, `woven-ribbon`, `corduroy`, `hair`, `combed-fur` and `figured-wood`.
- **Grazing reflection and sheen** include `puddle`, `wet-cobblestone`, `waxy-leaf`, `glazed-pottery`, `lacquered-wood`, `clear-ice`, `glass-bottle`, `velvet`, `dust` and `gold-leaf`.
- **Angle-dependent colour** includes `soap-bubble`, `oil-slick`, `beetle-shell`, `peacock-feather`, `butterfly-wing`, `mother-of-pearl`, `pearlescent-paint`, `shot-silk` and `holographic-foil`.
- **Pinned glints and facets** include `snow`, `mica-granite`, `frost-crystals`, `metallic-paint`, `sequins`, `dewy-grass`, `rippling-water`, `fish-scales` and `cut-gem`.

`K.surface.presets` lists the available IDs. Presets describe finishes. Supply a bowl of water, a fur material, a faceted mesh, or other geometry independently. The gallery includes sample geometry for every recipe.

## JSON and host rendering

In JSON, `mat.surface` accepts a preset ID or a settings object. Add a `preset` field to the object to override that recipe.

```json
{
  "id": "brushed-orb",
  "finish": { "look": { "pixel": true } },
  "solids": [{
    "kind": "ball",
    "at": [0, 1, 0],
    "r": 1,
    "mat": {
      "role": "metal",
      "surface": {
        "preset": "brushed-steel",
        "direction": "x",
        "layers": { "brush": { "roughness": [0.1, 0.5] } }
      }
    }
  }]
}
```

The browser script bundle exposes `SurfaceLook` alongside `PixelLook`. Host renderers can cache `SurfaceLook.prepare(settings, palette, lightDirection)` and call `SurfaceLook.shade(prepared, sample, baseRgb, result)`. A sample takes world-space `position`, `normal` and `view` toward the eye, plus optional `tangent`, `visibility`, `footprint` and `time`. The result contains normalized RGB, a coverage multiplier and a glint weight. The finished world includes `surfaces` with material bindings and `surfaceData` with one row per baked splat. `SurfaceLook.STRIDE` is the row length. Row fields are the one-based binding ID (zero for an ordinary splat), XYZ normal, direct-light visibility and optional XYZ tangent. Hosts with skeletal or procedural transforms should supply the rest-space material position and transform the frame consistently with their geometry and lighting.

These finish layers use CPU rendering or a custom host integration. See the
[WebGL canvas renderer coverage](browser-renderer.md#feature-coverage).

## Project animated paint and patterns

Use a `projected` layer for animated pixel rasters, field-driven patterns,
or a JavaScript shader. Existing finish layers can read the same fields
through a field mask. See the [projected effects guide](projected-effects.md)
for field authoring, local palettes, and emitters.

## Animate the finish light

Set `light.surfaceDirection` in a JSON scene, or pass `surfaceLight` to
`B.finish()` in JavaScript. Each row is `[seconds, x, y, z]`. Times strictly
increase and directions are nonzero vectors pointing toward the light.
The track interpolates smoothly on the unit sphere and holds its first or
last direction outside the keyed interval.

The track changes the direction used by finish layers such as specular,
sheen and glints. Baked diffuse shading and visibility remain as authored.
Browser hosts can prepare the track once with
`SurfaceLook.prepareLightTrack(keys)` and pass the sampled direction to
`SurfaceLook.shade` as `sample.lightDirection`, in the same coordinate
frame as the surface normal. See the [stipple example](../examples/stipple.json)
for a loop with a stationary camera and geometry.

## Render the examples

```sh
node cli/ink-studio.js render examples/surface-gallery.js --w 1236 --h 816 --t 0.6
node cli/ink-studio.js render examples/surface-gallery.js --surface off --w 1236 --h 816
node scripts/render-surface-gallery.js
```

The gallery script writes a still life and two camera angles of all 40 presets to `studio/out/surface-gallery`. It keeps the light and scene state fixed for each pair.
