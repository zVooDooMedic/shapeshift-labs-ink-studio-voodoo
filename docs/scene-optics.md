# Scene optics

Ink Studio can capture the objects around a planar mirror, move their reflected colours with a ripple field, and composite fog, mist or beams against scene depth. Each tool works independently. The [beacon pool](../examples/beacon-pool.js) uses all three with sculpted geometry.

```sh
ink-studio render examples/beacon-pool.js --t 0.94 --raw --out pool.png
ink-studio sheet examples/beacon-pool.js --t 0.4,0.94,1.5 --raw --out pool-motion.png
```

Use `--reflections off` or `--atmosphere off` to inspect each effect separately. The software renderer supports perspective and orthographic views, and the effects run before palette quantization.

The [WebGL canvas renderer](browser-renderer.md) supports the shared glass-beam pass. Planar capture, ripple-driven reflection, and volume integration in this guide use the CPU renderer unless a host implements those passes explicitly.

## Planar reflections

```js
const mirror = K.reflection.plane({ id: 'pool', at: [0, 0, 0], normal: [0, 1, 0] });
const water = K.reflection.material({ r: [1, 2, 3], a: 0.65 }, 'pool', {
  f0: 0.3,
  color: '#b8e0ea',
  distortion: 10,
  blur: 0.7
});
// Use water when adding the flat basin surface to S, then bake.
const world = B.finish({ cam, reflections: [mirror] });
```

The receiving material limits the reflected area, including irregular outlines. Put the receiving surface on the mirror plane and point the plane normal toward the objects and camera. The renderer samples a single mirrored view per visible, referenced plane. Splat centres behind the plane are excluded. Use `bias` in world units to exclude splats very close to the plane, or use `select(index, x, y, z, world)` to control which animated splats appear in the capture.

`K.reflection.material` adds a `planarReflection` layer named `mirror`. The layer takes the usual finish tint, `strength`, Fresnel `f0` and `power`, and optional finish masks. `distortion` controls how much a normal perturbation shifts the reflection in art pixels. `blur` is a small reflection filter radius in art pixels. Any finish normal, including `waves`, `noise` and ripple rings, can perturb the capture. Empty reflected pixels reveal the other finish layers and the base colour.

The existing `reflection` finish type supplies a three-colour sky. It can be layered underneath a planar mirror. `K.reflection.reflectedView(matrix, plane)` supplies the mirrored column-major world-to-view transform to other renderers. `K.reflection.captureView(matrix, plane, eye)` also supplies the clipping equation `[nx, ny, nz, -dot(at, normal)]` and the clip bias. It returns `null` if the eye is on or behind the reflecting side's bias. Use `SurfaceLook.shade` with a `reflection(layer, normal, geometricNormal)` callback returning `{ rgb, coverage }` in 0–1.

## Ripple sources

```js
const ripples = K.ripple.field({ scale: 0.48, amplitude: 0.4, speed: 1.2, damping: 0.25 });
const finish = K.surface.preset('rippling-water', { r: [1, 2, 3] }, { normal: ripples.normal });
// This can also be called later, after the world is baked.
const drop = ripples.add({ at: [1, 0, -0.5], start: 0.3, strength: 1 });
```

Drop coordinates use the material's pattern space, which defaults to the sculpt's rest coordinates. The optional material `origin` and `scale` shift and scale that space. The ripple plane defaults to XZ. Set `axis` and `cross` to two perpendicular XYZ directions for another plane. `scale` sets the wavelength, `width` sets the width around the travelling wavefront, and `speed` is distance per second. Set `repeat` on a drop for a repeating source.

Add and remove sources while rendering without rebaking. `remove(drop)` removes one source, `clear()` removes all, and `prune(time, reach)` retires non-repeating drops whose last rings have travelled beyond the given maximum radius. `sample(position, time, footprint)` returns the normal offset. Use a declarative `{ type: 'rings', amplitude, scale, drops }` normal for data-authored scenes.

A renderer can call `field.frame(time, storage)` once per frame and upload the
result. `axes` contains the two world-space tangents, `shape` contains
`[amplitude, wavelength, packetHalfWidth, damping]`, and each of the first
`count` entries in `drops` packs `[u, v, wavefrontRadius, strength]`.
Optional `Float32Array` storage needs four slots per active source. A field's
`capacity` defaults to 64 and can be lowered to fit a host's buffer.
`K.ripple.sampleFrame(frame, position, footprint, out)` evaluates the same
world-space slope as the surface normal sampler, within float packing precision.
Shader hosts can include `K.ripple.glsl` and sum `inkRippleSlope` for each drop
at a tangent-plane position. The host chooses how that slope affects its
material or reflected view.

## Atmosphere

```js
const world = B.finish({
  cam,
  atmosphere: [
    K.atmosphere.fog({ top: 0.2, near: 3, density: 0.14, color: '#6e889f' }),
    K.atmosphere.sphere({ at: [-1, 0.3, -2], radius: 1.4, density: 0.3, color: '#93a4b0' }),
    K.atmosphere.box({ min: [-2, 0, -1], max: [-0.3, 0.5, 3], density: 0.2 }),
    K.atmosphere.shaft({ from: [0, 3, -0.8], to: [1.4, 0, 1], radius: 0.22,
      density: 0.5, color: '#ffdb94' })
  ]
});
```

Fog can occupy a height slab with `bottom` and `top`, or cover the whole view. Sphere and box volumes let mist stay around an object or in a defined region. A shaft is a capped cylinder of tinted atmosphere. Combine volumes freely. Integration accounts for overlaps in camera-depth order and stops at the nearest opaque surface. Use `near` or `far` to bound a volume by camera ray distance. Colours accept a palette index, a hex string, or 0–1 RGB.

Hosts can use `K.atmosphere.prepare(world.atmosphere, world.pal)` and `K.atmosphere.trace(volumes, eye, unitDirection, distance)`. Trace returns premultiplied RGB and remaining transmittance `[r, g, b, t]`, so the final colour is the returned RGB plus `t` times the scene RGB.

## Bounded density and lit volumes

```js
const D = K.procedural.density;
const shape = D.fromSdf({
  bounds: { min: [-2, 0, -2], max: [2, 1.4, 2] },
  field: (x, y, z) => Math.hypot(x / 1.6, (y - .55) / .52, z / 1.4) - 1,
  feather: .20,
  breakup: .65,
  noise: (x, y, z, t) => .5 + .5 * Math.sin(4 * x + t + z),
  drift: [.10, .04], windInfluence: .6
});
const volume = K.atmosphere.field({
  field: shape, density: .8, step: .14, ramp: ['#435969', '#769599', '#adc5bd'],
  anisotropy: .22, emissive: '#5cb3aa', emissiveGain: .14
});
const volumeLighting = {
  ambient: .4,
  sun: { direction: [-.4, .8, .4], intensity: .7 },
  point: { at: [0, 1.4, -1], color: '#ffc984', radius: 4, intensity: 2 },
  shadow: K.atmosphere.occluder(sceneSdf)
};
```

Put `volume` in `finish.atmosphere`, and pass `volumeLighting` and optional `volumeQuality` to the finished world. The integrator clips each ray against opaque geometry, evaluates bounded density through overlapping media, and adds single scattering, geometry shadowing and emission before palette resolution. Use `windInfluence` to let live airflow advect the density pattern. Directional light is defined as a vector from a sample toward the light. Set `lit: false` on a volume to use its density ramp and emission without scene scattering.

`D.bounded({ bounds, sample, skip })` accepts a custom density. A skip callback returns a conservative distance to the next possible nonzero sample. `D.sparse(field, { resolution, brick, time })` caches occupied bricks at one time and includes conservative interpolation-aware skipping. `D.toMesh(field, { iso, resolution })` extracts a threshold surface. `D.scatter(field, { minDensity, radius, seed })` places deterministic points inside density.

Use `--atmosphere off` to disable the pass. `volumeQuality` controls `scale` (1–4), `depthTolerance`, `steps`, `stepScale`, `skip`, `samples`, `seed`, and `jitter`. The coarser pass only reuses nearby samples with compatible depth. Set `stats: true` to inspect `frame.volumeStats` ray and fallback counts. Set `jitter: 'blue-noise'` for stable spatial offsets, or `jitter: 'spatiotemporal'` with an explicit `volumeHistory: K.atmosphere.history()` for frame-varying offsets and filtered accumulation. The history resets across a changed camera, a time discontinuity, or incompatible opaque depth. CLI options include `--volume-scale`, `--volume-steps`, and `--volume-jitter`.

Render `examples/art-pipeline.js` to see sculpted pool mist, a local light, and emission coloring at art resolution.
