You are an author for the `@shapeshift-labs/ink-studio` toolkit (plain JavaScript, Node, no dependencies).
Write ONE runnable scene module. Follow the API exactly. Y is up. Units are world units.

=== EXACT API ===
A scene file exports a function that receives the toolkit and returns a scene object:

  module.exports = ({ makeBuilder, makeSculpt, KIT: K }) => ({
    id: 'my-id',            // lowercase, hyphenated, unique
    name: 'My Scene',
    seed: 7,                // integer; everything random is derived from it
    build(seed) {
      const B = makeBuilder(seed, palette);      // palette optional: array of 0xRRGGBB ints
      const S = K.sculpt(makeSculpt(B));
      // ...sculpt here...
      S.bake();
      return B.finish({
        cam: { target: [0, 1.2, 0], dist: 11, pitch: 0.22, yaw: 0.5 },
        detail: 14,          // art-pixel density: 10 coarse .. 18 fine
        dither: 0.25,        // 0..1
        radius: 6            // scene radius the camera frames
      });
    }
  });

Sculpt calls (positions [x,y,z]; box takes HALF-extents; res is surface sampling spacing,
smaller res = more splats and more cost):
  S.ground(material, { rad: 4, res: 0.18 })
  S.box([cx,cy,cz], [hx,hy,hz], material, { res: 0.12 })
  S.ball([cx,cy,cz], radius, material, { res: 0.1 })
  S.tube([[x0,y0,z0],[x1,y1,z1]], radius, radius2, material, { res: 0.12 })   // cone if radii differ
  S.torus([cx,cy,cz], R, r, material, { res: 0.12 })
  S.lathe(profilePoints, material, { res: 0.12 })
  S.rock([cx,cy,cz], size, material, { res: 0.15 })
  S.crown(...), S.cover(...), S.grp(...), S.place(...), S.mask(...), S.clip(...), S.join(...)
Boolean/solid ops:
  S.join(kind, a, b, { res: 0.12 })  with kind in: union, cut, common, round, chamfer,
      stairs, columns, pipe, engrave, groove, tongue
  `neg: true` on an operand subtracts it; `hold: true` keeps an operand invisible until a join uses it.
Materials (r = palette indices, dark to light ramp):
  const stone = { r: [1, 2, 3, 4] };
  const glow  = { r: [5, 6, 7], em: true };         // emissive: it lights itself
  const mossy = { r: [1, 2, 3, 4], mod: K.tex.range(K.tex.wave(5), 0, 1, -0.2, 0.2) };
  const jelly = K.look.jelly([5,6,7], { depth: 1.3, k: 0.85 });
  const glass = K.look.glass([2,3,4], { a: 0.085 });
  const wax   = K.look.wax([1,2,3,4], { depth: 0.5 });
  const fur   = K.look.fur([1,2,3,4], { len: 0.2, droop: 0.3 });
Palettes that definitely supply the indices used above:
  const palette = [0x080b10, 0x26313d, 0x566778, 0x9baeb8, 0xe5e9dc, 0x387548, 0x8fc75e];
  // index 0 is always the background void. 1..4 dark->light ramp. 5..7 accent/glow.
Textures available on K.tex: range, wave, noise, voronoi, bricks, checker, gradient.
Never use: require, import, fs, Date.now, Math.random, await, fetch, DOM APIs. No comments after
code on the same line (a trailing // comment breaks the bundle).

=== TASK ===
Build a small diorama called `lantern-shrine`: a weathered stone shrine (box with an arched
opening cut through it), a glowing lantern inside it (use an emissive material), one mossy rock
beside it, a low ground disc, and two or three tiny props. Make the silhouette readable from one
three-quarter camera angle. Keep res values at or above 0.1 so the bake stays cheap.

Output ONLY one fenced ```js code block containing the complete runnable module. No prose, no
second block.
