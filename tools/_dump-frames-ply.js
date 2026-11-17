#!/usr/bin/env node
/* tools/_dump-frames-ply.js <scene.js> <outdir> <t0> <t1> <n>
   Pose a scene at n times in [t0,t1] the same way tools/frames-dump.js does, and
   write ONE splat-buffer JSON per frame (the shape ink_to_ply.py eats).

   Why this exists: _dump-scene.js only dumps the *rest* pose, so a clip could
   never become a 3DGS asset. The splat turntable needs a per-frame buffer to
   bake walk/attack, not just idle.

   Env is honoured exactly like frames-dump (KNIGHT_CLIP, KNIGHT_MOVE, ...), so
   the caller selects the clip with the same switches the 2D lane uses.
*/
const path = require('path');
const fs = require('fs');
const K = require(path.join(__dirname, '..', 'index.js')).load();
const [file, outdir, t0s, t1s, ns] = process.argv.slice(2);
if (!file || !outdir) {
  console.error('usage: _dump-frames-ply.js <scene.js> <outdir> <t0> <t1> <n>');
  process.exit(2);
}
const t0 = +(t0s || 0), t1 = +(t1s || 1), n = +(ns || 8);
const kit = { makeBuilder: K.makeBuilder, makeSculpt: K.makeSculpt, KIT: K.KIT };
const raw = require(path.resolve(file))(kit);
let list;
if (typeof raw === 'function') list = [raw(kit)];
else if (Array.isArray(raw)) list = raw.map((x) => (typeof x === 'function' ? x(kit) : x));
else if (raw && raw.build) list = [raw];
else list = Object.entries(raw || {}).map(([k, v]) => {
  const s = typeof v === 'function' ? v(kit) : v;
  if (s && !s.id) s.id = k;
  return s;
}).filter((s) => s && typeof s.build === 'function');
if (!list.length) { console.error('no scene found in ' + file); process.exit(2); }
const scene = list[0];
fs.mkdirSync(outdir, { recursive: true });

function pose(w, t) {
  if (!w.anim) return;
  if (w.anim.stateful) {
    while (w.clock < t - 1e-9) {
      const dt = Math.min(1 / 60, t - w.clock);
      w.clock += dt;
      w.anim.update(dt, w.clock);
    }
  } else w.anim.update(1 / 60, t);
}

const meta = { id: scene.id, name: scene.name, seed: scene.seed, frames: [] };
for (let i = 0; i < n; i++) {
  const t = n === 1 ? t0 : t0 + (t1 - t0) * (i / (n - 1));
  const w = scene.build(scene.seed === undefined ? scene.seed : scene.seed);
  w.clock = 0;
  if (w.anim && w.anim.stateful) w.anim.update(0, 0);
  pose(w, t);
  const rows = new Array(w.count);
  for (let j = 0; j < w.count; j++) {
    const o = j * 16, r = new Array(13);
    for (let k = 0; k < 13; k++) r[k] = w.data[o + k];
    rows[j] = r;
  }
  const fn = path.join(outdir, `frame_${String(i).padStart(2, '0')}.json`);
  fs.writeFileSync(fn, JSON.stringify({
    id: scene.id, name: scene.name, seed: scene.seed, count: w.count,
    detail: w.detail, radius: w.radius, cam: w.cam, fine: !!w.fine, t, rows,
  }));
  meta.frames.push({ i, t: +t.toFixed(4), file: fn, count: w.count });
  console.log(`frame ${i} t=${t.toFixed(3)} splats=${w.count} -> ${fn}`);
}
fs.writeFileSync(path.join(outdir, 'frames.json'), JSON.stringify(meta, null, 1));
