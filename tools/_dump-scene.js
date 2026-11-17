#!/usr/bin/env node
/* tools/_dump-scene.js <scene.js> [name-or-index]
   Build a scene with ink-studio's own engine and print its baked splat buffer as JSON on stdout.
   This is the seam every external tool uses: 13 leading floats per splat, i.e.
     [x, y, z, density] [c00, c01, c02, packedRGB] [c11, c12, c22, kind]   (16 per splat in total)
   packedRGB = R + G*256 + B*65536.  c00..c22 is the surface footprint as a symmetric 3x3 covariance.

   usage: node tools/_dump-scene.js demos/labscenes.js > world.json
          node tools/_dump-scene.js demos/labscenes.js night-cabinet > world.json

   A file may export one scene, an array of scenes, or an object keyed by name; the optional
   second argument picks one by id/name/index (default: the first).
*/
const path = require('path');
const K = require(path.join(__dirname, '..', 'index.js')).load();
const file = path.resolve(process.argv[2] || '');
if (!file) { console.error('usage: node tools/_dump-scene.js <scene.js> [name-or-index]'); process.exit(2); }
const pickArg = process.argv[3];
const kit = { makeBuilder: K.makeBuilder, makeSculpt: K.makeSculpt, KIT: K.KIT };
const raw = require(file)(kit);
let list;
if (typeof raw === 'function') list = [raw(kit)];
else if (Array.isArray(raw)) list = raw.map(x => (typeof x === 'function' ? x(kit) : x));
else if (raw && raw.build) list = [raw];
else list = Object.entries(raw || {}).map(([k, v]) => {
  const s = typeof v === 'function' ? v(kit) : v;
  if (s && !s.id) s.id = k;
  return s;
}).filter(s => s && typeof s.build === 'function');
if (!list.length) { console.error('no scene found in ' + file); process.exit(2); }
let scene = list[0];
if (pickArg !== undefined) {
  scene = list.find(s => s && (s.id === pickArg || s.name === pickArg)) ||
          (/^\d+$/.test(pickArg) ? list[+pickArg] : undefined);
  if (!scene) { console.error('no such scene "' + pickArg + '". known: ' + list.map(s => s && s.id).join(', ')); process.exit(2); }
}
const w = scene.build(scene.seed);
const rows = new Array(w.count);
for (let i = 0; i < w.count; i++) {
  const o = i * 16, r = new Array(13);
  for (let j = 0; j < 13; j++) r[j] = w.data[o + j];
  rows[i] = r;
}
console.log(JSON.stringify({
  id: scene.id, name: scene.name, seed: scene.seed, count: w.count,
  detail: w.detail, radius: w.radius, cam: w.cam, fine: !!w.fine,
  siblings: list.map(s => s && s.id).filter(Boolean), rows
}));
