# Browser renderer

The package's browser entry selects WebGL 2. Bundlers that honor the `browser`
field can use the package name. With native browser modules, import
`webgl.mjs` by URL and serve its relative `src/webgl/` modules. Both entry
points export `createRenderer` as a default and named import. Prepare the
authoring toolkit with [the browser bundle](../README.md#embedding-and-custom-scene-collections).
Node's `render()` and the `ink-studio` CLI provide CPU image export.

```js
import createRenderer from '@shapeshift-labs/ink-studio';

const renderer = createRenderer(canvas, { toolkit: { KIT, PixelLook } });
renderer.render(world, { width: 320, height: 200, time: 0 });
```

The factory needs a canvas or `OffscreenCanvas`, a toolkit that exports
`PixelLook`, and an available WebGL 2 context. Include `KIT` to use
per-pixel materials and blue-noise tone generation. The renderer manages
the canvas context and can rebuild GPU resources after context restoration.
Call `renderer.dispose()` when the canvas is removed.

## Frames

Pass the world returned by `builder.finish()`. The drawing buffer is the art
resolution. Choose `width` and `height` to resize it, then enlarge visually
with CSS such as `image-rendering: pixelated`. The host controls input and
calls `world.anim.update(dt, time)` before drawing. Supply `time` and optional
`bornAt` in seconds. A camera override can set `target`, `dist`, `yaw`,
`pitch`, `fov`, and `ortho`. Angles are in radians.

Pass `changedRows` as an array of changed 512-splat texture row indices.
Omit it to upload all packed splat data, or pass `[]` when the data is
unchanged. Initial uploads and changes in the world's buffer or count still
upload the complete data. Replace pixel-material and fine-tile buffers or
their material tables when editing them. An explicit `order` can provide
one `Int32Array` of back-to-front splat IDs for the frame.

The browser defaults reuse depth order when the caller marks the rows
unchanged and the view, depth-dependent time, and ordering inputs match.
Scenes with bone buffers sort again. The canvas also uses a smaller palette
resolve shader when per-pixel materials, ambient occlusion, glass beams,
tone mapping, and grading are inactive. Pass `reuseOrder: false` or
`specialize: false` to the factory to compare the corresponding full path.

| Frame control | Effect |
| --- | --- |
| `raw` | Show the directly blended RGB instead of the palette resolve. |
| `colored` | Use higher-resolution contours over native-size interiors. On by default for scenes without per-pixel materials. |
| `outline`, `dither`, `tone` | Control outline and palette treatment. Use `tone: false` to disable an authored tone. |
| `clean`, `lineClean`, `damp` | Control isolated-pixel cleanup, line cleanup, and per-pixel flicker damping. |
| `edges`, `lightShape` | Toggle surface edge sprites and per-pixel line shading. |
| `scale`, `stepAnimation` | Change the splat size or disable the shared per-pixel animation clock stepping. |

## Feature coverage

| Feature | WebGL canvas renderer | Node and CLI renderer |
| --- | --- | --- |
| Packed splats, animation poses, palette and tone | Supported | Supported |
| Fine ink tiles, per-pixel patterns and edge sprites | Supported | Supported |
| Contours, cleanup, and camera-dependent glass beams | Supported | Supported |
| Selective ink, diagnostic buffers, stable art resolves, and frame-history effects | Host integration | Supported |
| View-dependent surface finishes, projected layers, reflection captures, and atmosphere volumes | Host integration | Supported |
| Text rendering, PNG/APNG, scene reviews, and sprite atlases | Host integration | Supported |

Pixel output can differ across the CPU and GPU backends. Use the same
backend for both sides of a pixel-exact comparison.

## Integrate a custom draw pipeline

Hosts that manage their own framebuffers and effects can import
`createSplatPipeline`, `splatShaderSources`, and `pixelShaderSources` from the
same entry. Pass `{ ascii: KIT.ascii?.glsl }` to the pipeline if the host
implements the text passes. Shader sources are available to hosts that
compile and bind independent programs.

Call `pipeline.programFor({ lamps, fine, textZones })` and bind its returned
`p` before setting uniforms. Uniform locations are in `u`. The full shader
is selected when any feature is active or unspecified. The shader can omit
those paths when all three are explicitly false.

Upload order IDs with `setOrder(ids)` and call `draw()` after binding the
framebuffer, textures, and blend state. To use host-owned geometry, pass
`draw(count, vao)`. That VAO needs the two-component quad corners at
attribute 0 and the integer splat ID with instance divisor 1 at attribute 1.
Call `pipeline.dispose()` to release the pipeline's own resources.
