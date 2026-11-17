#!/usr/bin/env node
/* tools/frames-dump.js — hand ink-studio's OWN renderer output to a post-processing pass.

   The studio already animates, poses on bones, shades with dabs and inks detail. Instead of
   re-rendering scenes in our own rasteriser, ask the studio to render and dump the frames as raw
   RGB in JSON; then any tool (ours: tools/look.py) can restyle those frames — lattice, dither,
   cel bands, ink outline, nearest upscale — while keeping every animation beat the studio made.

   usage: node tools/frames-dump.js <sceneId|file.js> [opts] --out studio/out/frames.json
     --times 0,0.5,...      explicit times (default: --n frames spread over --from..--to)
     --n 8 --from 0 --to 6  animation frames when --times is absent
     --turn N               also emit N yaw steps (turntable), yaw offset from the scene default
     --yaw A --pitch B      override the camera instead of using the scene's
     --zoom 1  --w 900 --h 620
     --fine --colored --clean --bounce --focus x,y,z[,near,far,coarse] --follow --px1
     --seed n
   Frame order: for each time, the base view, then the turn yaws (if --turn).
   Output JSON: {id, name, w, h, px, frames: [{label, t, yaw, pitch, rgb: base64(RGB8)}]}
*/
const fs = require('fs'),
  path = require('path'),
  R = require('../cli/render.js');
const CWD = process.cwd(),
  ROOT = path.join(__dirname, '..');
let cfg = {};
try {
  cfg = require(path.join(CWD, 'ink-studio.config.js'));
} catch (e) {
  if (e.code !== 'MODULE_NOT_FOUND' || !/ink-studio\.config/.test(e.message)) throw e;
}
const argvx = process.argv.slice(2),
  pos = [],
  opt = {};
for (let i = 0; i < argvx.length; i++) {
  const a = argvx[i];
  if (a === '--') {
    pos.push(...argvx.slice(i + 1));
    break;
  }
  if (a.startsWith('--')) {
    const k = a.slice(2);
    if (i + 1 < argvx.length && !argvx[i + 1].startsWith('--')) opt[k] = argvx[++i];
    else opt[k] = true;
  } else pos.push(a);
}

const num = (k, d) => (opt[k] === undefined ? d : +opt[k]),
  list = (k) => String(opt[k]).split(',').map(Number);
let LIB = null;
const lib = () => LIB || (LIB = cfg.load ? cfg.load() : require(path.join(ROOT, 'index.js')).load());

function scene(id) {
  if (!id) {
    console.error('which diorama? try: node cli/ink-studio.js scenes');
    process.exit(1);
  }
  if (id.endsWith('.json')) {
    const data = JSON.parse(fs.readFileSync(path.resolve(id), 'utf8'));
    return { id: path.basename(id).replace(/\.json$/, ''), name: id, seed: 1, build: () => lib().KIT.build(data) };
  }
  if (id.endsWith('.js')) return require(path.resolve(id))(lib());
  const s = lib().SCENES.find((q) => q.id === id);
  if (!s) {
    console.error('no diorama called "' + id + '"');
    process.exit(1);
  }
  return s;
}
function build(id) {
  if (opt.focus) {
    const f = list('focus');
    globalThis.INK_FOCUS = { p: [f[0] || 0, f[1] || 0, f[2] || 0], near: f[3], far: f[4], coarse: f[5] };
  }
  if (opt.follow)
    globalThis.INK_FOLLOW =
      opt.follow === true ? {} : { stretch: +String(opt.follow).split(',')[0], broad: +String(opt.follow).split(',')[1] || undefined };
  if (opt.bounce) globalThis.INK_BOUNCE = true;
  if (opt.fine) globalThis.INK_FINE = true;
  const s = scene(id),
    w = s.build(opt.seed === undefined ? s.seed : +opt.seed);
  w.id = s.id;
  w.name = s.name;
  w.clock = 0;
  if (w.anim && w.anim.stateful) w.anim.update(0, 0);
  return w;
}
/* --poke 2:x,y,z (several with ;) taps the diorama along the camera->point line, like the CLI does */
const POKES = String(opt.poke || '')
  .split(';')
  .filter(Boolean)
  .map((q) => {
    const m = q.split(':');
    return { t: +m[0], p: m[1].split(',').map(Number) };
  });
function tap(w, t0, t1) {
  for (const k of POKES) {
    if (!(k.t > t0 && k.t <= t1) || !w.anim || !w.anim.poke) continue;
    const c = w.cam,
      cp = Math.cos(c.pitch),
      eye = [
        c.target[0] + c.dist * cp * Math.sin(c.yaw),
        c.target[1] + c.dist * Math.sin(c.pitch),
        c.target[2] + c.dist * cp * Math.cos(c.yaw)
      ],
      d = k.p.map((v, i) => v - eye[i]),
      l = Math.hypot(d[0], d[1], d[2]);
    w.anim.poke(
      eye,
      d.map((v) => v / l)
    );
  }
}
function pose(w, t) {
  if (!w.anim) return;
  if (w.anim.stateful) {
    while (w.clock < t - 1e-9) {
      const dt = Math.min(1 / 60, t - w.clock),
        before = w.clock;
      w.clock += dt;
      tap(w, before, w.clock);
      w.anim.update(dt, w.clock);
    }
  } else w.anim.update(1 / 60, t);
  w.clock = t;
  if (w.anim.bones) {
    if (!w.rest) w.rest = w.data;
    w.data = lib().KIT.bones.posed({
      data: w.rest,
      anim: w.anim,
      get posedBuf() {
        return w.posedBuf;
      },
      set posedBuf(v) {
        w.posedBuf = v;
      }
    });
  }
}
const view = (extra) =>
  Object.assign(
    {
      yaw: opt.yaw === undefined ? undefined : +opt.yaw,
      pitch: opt.pitch === undefined ? undefined : +opt.pitch,
      zoom: num('zoom', 1),
      target: opt.target ? list('target') : undefined,
      w: num('w', 900),
      h: num('h', 620),
      raw: !!opt.raw,
      colored: !!opt.colored,
      fine: !!opt.fine,
      clean: !!opt.clean
    },
    extra
  );

const id = pos[0];
/* Ramps are ground truth for the palette law: the builder registers every ramp a diorama is
   shaded on into globalThis.INK_RAMPS (see cli/ink-studio.js ramps()). Set it before the build
   so the dump carries the material ramps alongside the pixels — tools/look.py snaps to those
   instead of guessing hue clusters from the frame. */
globalThis.INK_RAMPS = new Map();
const w = build(id);
const times = opt.times !== undefined ? list('times') : Array.from({ length: num('n', 8) }, (_, i) => +(num('from', 0) + ((num('to', 6) - num('from', 0)) * i) / Math.max(1, num('n', 8) - 1)).toFixed(3));
// render.js takes an ABSOLUTE yaw in radians (there is no yawOffset option)
const baseYaw = opt.yaw !== undefined ? +opt.yaw : 0;
const nTurn = num('turn', 0);
const yaws = nTurn > 0
  ? Array.from({ length: nTurn }, (_, i) => baseYaw + (2 * Math.PI * i) / nTurn)
  : [baseYaw];
const frames = [];
for (const t of times) {
  pose(w, t);
  const seq = [];
  for (let i = 0; i < yaws.length; i++)
    seq.push({ label: 't' + t + (nTurn > 1 ? '_yaw' + i : ''), extra: { yaw: yaws[i] } });
  for (const q of seq) {
    const im = R.render(w, view(q.extra));
    frames.push({
      label: q.label,
      t,
      yaw: +(yaws[seq.indexOf(q)].toFixed(4)),
      w: im.w,
      h: im.h,
      px: im.px,
      drawn: im.drawn,
      use: im.use,
      rgb: Buffer.from(im.rgb).toString('base64')
    });
    process.stderr.write('frame ' + frames.length + ' ' + q.label + ' ' + im.w + 'x' + im.h + ' drawn ' + im.drawn + '\n');
  }
}
const out = path.resolve(opt.out || path.join(ROOT, 'studio/out/frames-' + id + '.json'));
fs.mkdirSync(path.dirname(out), { recursive: true });
/* material ramps, collected by the build: [{idx: [palette indices], dabs: count}] most used first */
const ramps = [...(globalThis.INK_RAMPS || new Map()).entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([idx, dabs]) => ({ idx: Array.from(idx), dabs }));
const pal = (w.pal || []).map((c) => '#' + c.toString(16).padStart(6, '0'));
fs.writeFileSync(out, JSON.stringify({ id: w.id, name: w.name, w: frames[0].w, h: frames[0].h, px: frames[0].px, n: frames.length, pal, ramps, frames }));
console.log('wrote', out, frames.length, 'frames', frames[0].w + 'x' + frames[0].h, 'px', frames[0].px, 'ramps', ramps.length);
