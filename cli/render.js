// Draws a world without a browser: motion kinds, projection of each splat's covariance to a screen ellipse,
// blending from far to near, low-resolution sampling, dithering and palette quantization.
const FOV = (38 * Math.PI) / 180;
const PixelLook = require('../src/pixel-look.js');
const { createArtPasses, sampleFrames } = require('./art-passes.js');
const ArtPasses = require('../src/art-passes.js');
const ArtInk = require('../src/art-ink.js');
const ArtEffects = require('../src/art-effects.js');
const ArtStability = require('../src/art-stability.js');
const { footprint, sampledDepth } = require('./splat-sampling.js');
const blueNoiseTiles = new WeakMap();
function toneFor(world, definition) {
  return PixelLook.prepareTone(definition, ({ seed }) => {
    let tile = blueNoiseTiles.get(world);
    if (tile?.seed !== seed) {
      const { KIT } = require('../index.js').load();
      tile = { seed, ranks: KIT.procedural.materials.blueNoise({ seed }) };
      blueNoiseTiles.set(world, tile);
    }
    return tile.ranks;
  });
}
const SampleCoverage = require('../src/sample-coverage.js');
const Airflow = require('../src/airflow.js');
const LightSchedule = require('../src/light-schedule.js');
const surfaceShading = require('./surface-shading.js');
const SceneOptics = require('../src/scene-optics.js');
const { cameraRays, surfacePoint, reflectionSampler, atmosphereQuality, applyAtmosphere } = require('./scene-optics.js');
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x),
  sstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
function viewMatrix(yaw, pitch, dist, T) {
  const cp = Math.cos(pitch),
    sp = Math.sin(pitch),
    e = [T[0] + dist * cp * Math.sin(yaw), T[1] + dist * sp, T[2] + dist * cp * Math.cos(yaw)];
  let zx = e[0] - T[0],
    zy = e[1] - T[1],
    zz = e[2] - T[2];
  const zl = Math.hypot(zx, zy, zz);
  zx /= zl;
  zy /= zl;
  zz /= zl;
  let xx = zz,
    xz = -zx;
  const xy = 0,
    xl = Math.hypot(xx, xz);
  xx /= xl;
  xz /= xl;
  const yx = zy * xz - zz * xy,
    yy = zz * xx - zx * xz,
    yz = zx * xy - zy * xx;
  return [
    xx,
    yx,
    zx,
    0,
    xy,
    yy,
    zy,
    0,
    xz,
    yz,
    zz,
    0,
    -(xx * e[0] + xy * e[1] + xz * e[2]),
    -(yx * e[0] + yy * e[1] + yz * e[2]),
    -(zx * e[0] + zy * e[1] + zz * e[2]),
    1
  ];
}
// o: t (seconds), yaw, pitch, dist, target, w, h (the size of the stage in screen pixels), zoom (1 = the diorama's own distance), raw (skip the palette)
function render(world, o) {
  o = o || {};
  const c = world.cam,
    t = o.t || 0,
    yaw = o.yaw === undefined ? c.yaw : o.yaw,
    pitch = o.pitch === undefined ? c.pitch : o.pitch,
    an = world.anim || {},
    dist0 = o.dist || c.dist / (o.zoom || 1),
    /* a diorama's own zoom (a camera punch) moves the eye, not the size of an art pixel */
    dist = dist0 / (an.zoom || 1),
    T0 = o.target || c.target,
    T = an.kick ? [T0[0] + an.kick[0], T0[1] + an.kick[1], T0[2] + an.kick[2]] : T0,
    cw = o.w || 900,
    ch = o.h || 620;
  const look = world.look || {};
  const transparent = !!o.transparent && !o.captureCoverage;
  const integrateFootprint = o.splatFilter === 'footprint';
  const orderMode = o.splatOrder ?? look.splatOrder ?? 'center';
  const sortedSurfaces = orderMode === 'surface';
  const fragmentBudget = o.fragmentBudget ?? 500000;
  if (!['center', 'surface'].includes(orderMode) ||
      (sortedSurfaces && (!Number.isSafeInteger(fragmentBudget) || fragmentBudget < 1 || fragmentBudget > 2e6)))
    throw new RangeError('Invalid splat order or fragment budget');
  const probe = typeof o.fragmentProbe === 'function' ? o.fragmentProbe : null;
  const styled = !o.raw && !o.samples && !o.captureCoverage;
  const ink = styled ? ArtInk.prepare(o.ink ?? look.ink, world.pal) : null;
  const effects = styled ? ArtEffects.prepare(o.artEffects ?? look.effects, world.pal) : null;
  const stable = ArtStability.prepare(o.stable ?? look.stable);
  const specializedResolve = styled && stable && stable.resolve !== 'native';
  const anchoring = styled && stable && stable.dither !== 'screen';
  const requestedPasses = ArtPasses.select(o.passes);
  const passSelection = new Set(requestedPasses);
  if (effects) for (const channel of ArtEffects.channels) passSelection.add(channel);
  if (effects?.smear && o.artHistory) passSelection.add('emissionMotion');
  if (ink) for (const channel of ArtInk.channels) passSelection.add(channel);
  if (anchoring) {
    passSelection.add('splatId');
    passSelection.add(stable.dither === 'world' ? 'position' : 'objectPosition');
  }
  if (specializedResolve || (styled && stable?.protect.size)) {
    for (const channel of ['objectId', 'materialId', 'emission', 'protected']) passSelection.add(channel);
  }
  const finishLook = (frame, passes, fog) => {
    if (ink) frame = ArtInk.apply(frame, passes, ink, world.pal, fog);
    if (effects) frame = ArtEffects.apply(frame, passes, effects, t, {
      history: o.artHistory, world, palette: world.pal, motionReference: frame.motionReference
    });
    if (!o.captureMotion) delete frame.motionReference;
    if (requestedPasses.length) frame.passes = ArtPasses.subset(passes, requestedPasses);
    return frame;
  };
  if (look.pixelSize !== undefined && (!Number.isSafeInteger(look.pixelSize) || look.pixelSize < 1))
    throw new RangeError('look.pixelSize must be a positive integer');
  const tone = o.raw || o.samples || o.captureCoverage ? null : toneFor(world, o.tone ?? look.tone);
  const rel = c.dist / dist0,
    rho = world.detail * Math.pow(rel, rel > 1 ? 0.5 : 0.25),
    px = o.px || look.pixelSize || clamp(Math.round(ch / (2 * Math.tan(FOV / 2) * rho * dist0)), 1, 18),
    W = Math.ceil(cw / px),
    H = Math.ceil(ch / px);
  const historyFrames = effects?.smear && o.artHistory ? o.artHistory.previous(t, W, H, world) : [];
  const motionFrame = historyFrames[Math.max(0, historyFrames.length - (effects?.smear?.frames || 1))];
  const motionFrom = o.motionFrom ?? motionFrame?.motionReference;
  const captureMotion = !!o.captureMotion || passSelection.has('motion') || passSelection.has('emissionMotion');
  if (styled && (specializedResolve || (o.colored && !tone))) {
    const native = render(world, Object.assign({}, o, { colored: false, samples: true, worked: true, passes: [...passSelection], artInkActive: !!ink,
      captureMotion, motionFrom, reflectionTint: effects?.reflection, captureFog: o.captureFog || ink?.ramps.has('fog') }));
    const samples = render(
      world,
      Object.assign({}, o, {
        colored: false,
        samples: true,
        pick: undefined,
        px: px / 2,
        w: W * px,
        h: H * px,
        reflectionScale: 2,
        artGridScale: 2,
        volumeHistory: null,
        artInkActive: !!ink,
        captureMotion: false, motionFrom: undefined, reflectionTint: effects?.reflection,
        passes: specializedResolve ? ['coverage'] : false
      })
    );
    const basePalette = tone?.palette || world.pal;
    const palette = basePalette.map(h => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]);
    const local = native.localAt && {
      at: native.localAt, palettes: native.localPalettes, output: PixelLook.outputPalettes(basePalette, native.localPalettes)
    };
    const amount = (o.dither === undefined ? 0.35 : o.dither) * 0.3 * world.dither;
    const img = specializedResolve ? ArtStability.resolve(native, samples, stable, palette, PixelLook, amount,
      { local, tone, grade: !tone && world.anim?.grade }) :
      PixelLook.resolve(Object.assign(samples, {
        palette, local, contour: !ink, grade: world.anim && world.anim.grade, interiorColor: native.color, dither: amount,
        ditherAt: anchoring ? (x, y) => ArtStability.ditherCoordinates(stable, native.passes, (H - 1 - y) * W + x, x, y) : null
      }));
    return finishLook(Object.assign(img, { px, drawn: samples.drawn },
      !specializedResolve && native.detail && { detail: native.detail },
      native.motionReference && { motionReference: native.motionReference },
      native.alpha && { alpha: native.alpha },
      (native.orderFallback || samples.orderFallback) && { orderFallback: true },
      native.volumeStats && { volumeStats: native.volumeStats },
      o.captureFog && native.fog && { fog: native.fog }), native.passes, native.fog);
  }
  /* orthographic (o.ortho): no perspective, every ray parallel, the picture as big as the perspective one is at the target. The eye
     is set well back, so nothing comes behind it however far in the camera zooms; the zoom is the size of the view */
  const ortho = !!o.ortho,
    oh = dist * Math.tan(FOV / 2),
    eyeD = ortho ? dist + 2 * world.radius + 4 : dist,
    reflectionPlane = o.reflectionPlane,
    focal = ortho ? H / 2 / oh : H / 2 / Math.tan(FOV / 2),
    cameraView = viewMatrix(yaw, pitch, eyeD, T),
    view = ortho && stable?.snap ? ArtStability.snapView(cameraView, focal / (o.artGridScale || 1), stable.anchor) : cameraView,
    V = reflectionPlane ? SceneOptics.reflectedView(view, reflectionPlane) : view,
    near = Math.max(0.4, 0.15 * dist),
    tp = 1 / Math.tan(FOV / 2),
    asp = W / H,
    N = world.count,
    d = world.data,
    R = world.radius;
  const hex = i => {
      const h = world.pal[i];
      return [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
    },
    bg = o.captureCoverage || transparent || tone ? [0, 0, 0] : hex(0),
    fog = hex(world.fog.c),
    limx = (1.3 * 0.5 * W) / focal,
    limy = (1.3 * 0.5 * H) / focal;
  const eye = [
    -(V[0] * V[12] + V[1] * V[13] + V[2] * V[14]),
    -(V[4] * V[12] + V[5] * V[13] + V[6] * V[14]),
    -(V[8] * V[12] + V[9] * V[13] + V[10] * V[14])
  ];
  const volumes =
    o.atmosphere !== false && world.atmosphere?.length ? SceneOptics.prepareVolumes(world.atmosphere, world.pal) : [];
  const axialDepth = volumes.length ? new Float32Array(W * H).fill(Infinity) : null;
  const centers = captureMotion ? new Float32Array(N * 2).fill(NaN) : null;
  const motionReference = centers && { w: W, h: H, centers };
  const art = createArtPasses([...passSelection], W, H);
  const rayAt = cameraRays(V, eye, W, H, focal, ortho);
  const geometrySample = probe || sortedSurfaces ? sampleFrames(world, t) : null;
  const captured = o.captureCoverage || transparent ? new Float32Array(W * H) : null;
  // The reflected pass uses the same projection and reads only the plane's front side.
  const reflectionTint = effects?.reflection || o.reflectionTint;
  const reflection =
    o.surface !== false && o.reflections !== false && world.reflections?.length
      ? reflectionSampler(
          world.reflections,
          plane =>
            render(world, {
              ...o,
              samples: false,
              colored: false,
              worked: false,
              pick: undefined,
              reflectionPlane: plane,
              captureCoverage: true,
              passes: reflectionTint ? ['emission'] : false,
              reflectionTint,
              captureMotion: false,
              fragmentProbe: undefined,
              atmosphere: false,
              reflections: false,
              edges: false
            }),
          V,
          eye,
          o.reflectionScale ?? 1
        )
      : null;
  const surface = surfaceShading(world, o, {
    eye,
    reflection,
    parallel: ortho ? [V[2], V[6], V[10]] : null,
    footprint: (dist * 2) / (tp * H),
    time: t
  });
  const surfaceGlint = surface ? new Uint8Array(W * H) : null;
  const localAt = surface?.palettes.length && !o.raw ? new Uint32Array(W * H) : null;
  const hasEffectInk = world.effectParticles?.length || world.surfaces?.some(({ settings }) =>
    Object.values(settings.layers || {}).some(layer => layer?.type === 'projected'));
  const detail = hasEffectInk ? new Uint8Array(W * H) : null;
  // where each splat is at this moment, and what it looks like
  const X = new Float32Array(N),
    Y = new Float32Array(N),
    Z = new Float32Array(N),
    AL = new Float32Array(N),
    SC = new Float32Array(N),
    depth = new Float32Array(N),
    add = new Float32Array(N),
    wet = new Float32Array(N);
  const wind = Airflow.frame(o.wind ?? an.wind);
  const daylight = o.lightDaylight ?? o.environment?.daylight ?? an.daylight ?? 1;
  const dusk = LightSchedule.gain(daylight);
  const lamps = LightSchedule.select(world.lights || [], [
    T[0]+eyeD*Math.cos(pitch)*Math.sin(yaw),
    T[1]+eyeD*Math.sin(pitch),
    T[2]+eyeD*Math.cos(pitch)*Math.cos(yaw)
  ], { daylight, duskOnly: true });
  const sampleWithdrawal = SampleCoverage.amount(o.sampleWithdrawal ?? world.sampleWithdrawal ?? 0);
  for (let i = 0, q = 0; i < N; i++, q += 16) {
    let x = d[q],
      y = d[q + 1],
      z = d[q + 2],
      al = d[q + 3],
      sc = 1;
    const kraw = Math.round(d[q + 11]),
      kind = kraw % 16,
      ph = d[q + 12],
      sp = d[q + 13],
      rg = d[q + 14],
      ex = d[q + 15];
    if (sampleWithdrawal > 0 && !SampleCoverage.visible(kraw, sampleWithdrawal)) al = 0;
    if (kind === 1) al *= 0.62 + 0.38 * Math.sin(t * sp + ph);
    else if (kind === 2) {
      const f = (t * sp) / rg + ph,
        pr = f - Math.floor(f);
      y -= pr * rg;
      al *= 1 - pr * pr;
      sc *= 1 + pr * ex;
    } else if (kind === 3) {
      const f = (t * sp) / rg + ph,
        pr = f - Math.floor(f);
      y += pr * rg;
      x += Math.sin(pr * 7 + ph * 50) * 0.25 * pr;
      if (kraw & Airflow.packedFlag) {
        const age = pr * rg / Math.max(sp, 0.00001);
        x += wind.velocity[0] * age;
        z += wind.velocity[1] * age;
      }
      al *= (1 - pr) * sstep(0, 0.1, pr);
      sc *= 0.6 + pr * ex;
    } else if (kind === 4) add[i] = 0.3 * sstep(0.75, 1, Math.sin(t * sp + ph));
    else if (kind === 5) {
      const a = t * sp,
        cs = Math.cos(a),
        sn = Math.sin(a),
        nx = cs * x + sn * z;
      z = -sn * x + cs * z;
      x = nx;
    } else if (kind === 6) y += Math.sin(t * sp + ph) * rg;
    else if (kind === 7 && ex !== LightSchedule.emissionMarker) al *= 0.82 + 0.18 * Math.sin(t * sp + ph);
    else if (kind === 8) {
      const f = 0.2 + 0.8 * Math.abs(Math.sin(t * sp + ph));
      x = rg + (x - rg) * f;
      z = ex + (z - ex) * f;
      y += 0.14 * Math.sin(t * sp * 0.31 + ph);
    } else if (kind === 9) {
      const k = 1 + rg * Math.sin(t * sp + ph - y * ex);
      x *= k;
      z *= k;
    } else if (kind === 15) {
      // flutter down: a leaf or a flake, swinging as it falls
      const f = (t * sp) / rg + ph,
        pr = f - Math.floor(f);
      y -= pr * rg;
      x += Math.sin(pr * 11 + ph * 40) * ex;
      z += Math.cos(pr * 7 + ph * 23) * ex * 0.6;
      al *= sstep(0, 0.05, pr) * (1 - sstep(0.92, 1, pr));
    } else if (kind === 14) {
      const hg = Math.max(0, y - ex);
      x += rg * hg * Math.sin(t * sp + ph);
      z += rg * 0.6 * hg * Math.sin(t * sp * 0.73 + ph * 1.7);
    } else if (kind === 11) {
      if (kraw & Airflow.packedFlag) {
        const displacement = Airflow.bend(t, ph, sp, rg);
        x += wind.flex[0] * displacement;
        z += wind.flex[1] * displacement;
      } else {
        const x0 = x;
        x += rg * Math.sin(t * sp + y * 1.3 + z * 0.9 + ph);
        y += rg * 0.6 * Math.sin(t * sp * 1.3 + x0 * 1.1 + ph);
      }
    }
    if (kraw & 512) {
      // born: not there till its time, then it grows to its size (as the page does it)
      const gw = world.grow || {};
      let gt = t * (gw.rate || 1);
      if (gw.loop > 0) gt -= Math.floor(gt / gw.loop) * gw.loop;
      const gs = Math.min(1, Math.max(0, (gt - ex) / (gw.fade || 0.5)));
      if (gs <= 0) al = 0;
      sc *= gs * (2 - gs);
    } else if (kraw & 1024) wet[i] = Math.min(1, Math.max(0, (t * ((world.grow || {}).rate || 1) - ex) / 2));
    X[i] = x;
    Y[i] = y;
    Z[i] = z;
    AL[i] = al;
    SC[i] = sc;
    depth[i] = V[2] * x + V[6] * y + V[10] * z + V[14];
  }
  let mn = Infinity;
  for (let i = 0; i < N; i++) if (depth[i] < mn) mn = depth[i];
  if (world.back) for (let j = 0; j < world.back.length; j++) depth[world.back[j]] = mn;
  const order = new Uint32Array(N);
  for (let i = 0; i < N; i++) order[i] = i;
  order.sort((a, b) => depth[a] - depth[b]);
  const col = new Float32Array(W * H * 3),
    dep = new Float32Array(W * H),
    gls = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    col[i * 3] = bg[0];
    col[i * 3 + 1] = bg[1];
    col[i * 3 + 2] = bg[2];
    dep[i] = 1;
  }
  let drawn = 0;
  // colour per pixel (look.pixel): which dab is in front at each pixel, to be coloured afterwards from where the pixel lands on it
  const PIX =
      (o.pixel || (world.look && world.look.pixel)) && !o.raw && world.pix && world.pix.length >= N * 8
        ? world.pix
        : null,
    win = PIX ? new Int32Array(W * H).fill(-1) : null;
  // Keep later translucent coats when the opaque receiver is recoloured per pixel.
  let surfaceOverlay = null;
  let pixed = null,
    sprM = null;
  const FN =
      (o.fine || (world.look && world.look.fine)) && world.fine && world.fine.length >= N * 12 ? world.fine : null,
    FPAL = FN ? world.pal.map((h, i) => hex(i)) : null;
  let deferred = sortedSurfaces ? new Map() : null, deferredCount = 0, orderFallback = false;
  function composite(p, i, z, dn, a, pr, pg, pb, wd, emits, highlight, paletteId, detailParticle, projected, coat, glass) {
    const p3 = p * 3, ia = 1 - a;
    col[p3] = pr * a + col[p3] * ia;
    col[p3 + 1] = pg * a + col[p3 + 1] * ia;
    col[p3 + 2] = pb * a + col[p3 + 2] * ia;
    if (captured) captured[p] = a + captured[p] * ia;
    if (art) art.fragment(p, i, a, wd, z, emits, pr, pg, pb);
    if (surfaceGlint && a > 0.5) surfaceGlint[p] = highlight > 0.22 || detailParticle;
    if (localAt && a > 0.5) localAt[p] = paletteId || 0;
    if (detail) {
      const q = (H - 1 - Math.floor(p / W)) * W + p % W;
      if (a > 0.5) detail[q] = 0;
      if (a > 0.24 && (detailParticle || (projected && highlight > 0.22))) detail[q] = 1;
    }
    if (surfaceOverlay) {
      const j = p * 4;
      if (wd && a > 0.5) surfaceOverlay.fill(0, j, j + 4);
      else if (!wd && (coat || surfaceOverlay[j + 3])) {
        surfaceOverlay[j] = pr * a + surfaceOverlay[j] * ia;
        surfaceOverlay[j + 1] = pg * a + surfaceOverlay[j + 1] * ia;
        surfaceOverlay[j + 2] = pb * a + surfaceOverlay[j + 2] * ia;
        surfaceOverlay[j + 3] = a + surfaceOverlay[j + 3] * ia;
      }
    }
    if (wd) {
      dep[p] = dn * a + dep[p] * ia;
      gls[p] *= ia;
      if (a > 0.5) {
        if (win) win[p] = surface?.reveals(i) ? -1 : i;
        if (axialDepth) axialDepth[p] = z;
      }
    } else if (glass) gls[p] = Math.min(1, gls[p] + a * 0.5);
    else if (win && !coat && a > 0.5) win[p] = -1;
  }

  function playFragments(sort) {
    for (const [p, layers] of deferred) {
      if (sort) layers.sort((a, b) => b.sort - a.sort || a.index - b.index);
      for (const entry of layers) {
        const args = entry.sample;
        if (!sort) {
          args[1] = entry.center;
          args[2] = clamp((entry.center - (eyeD - R)) / (2 * R), 0, 1);
        }
        composite(p, ...args);
      }
    }
    deferred = null;
  }
  for (let n = 0; n < N; n++) {
    const i = order[n],
      q = i * 16,
      al = AL[i],
      x = X[i],
      y = Y[i],
      z = Z[i];
    if (al <= 0 || y < -30) continue;
    if (
      reflectionPlane &&
      (SceneOptics.planeDistance(reflectionPlane, x, y, z) <= reflectionPlane.bias ||
        (reflectionPlane.select && !reflectionPlane.select(i, x, y, z, world)))
    )
      continue;
    const cx = V[0] * x + V[4] * y + V[8] * z + V[12],
      cy = V[1] * x + V[5] * y + V[9] * z + V[13],
      cz = V[2] * x + V[6] * y + V[10] * z + V[14];
    if (cz > -near) continue;
    const kraw = Math.round(d[q + 11]),
      kind = kraw % 16,
      flags = Math.floor(kraw / 16),
      s2 = SC[i] * SC[i],
      pk = d[q + 7];
    let r = (pk % 256) / 255 + add[i],
      g = (Math.floor(pk / 256) % 256) / 255 + add[i],
      b = Math.floor(pk / 65536) / 255 + add[i];
    if (wet[i]) {
      // wet: darker, and a little bluer, as the page does it
      r *= 1 - 0.42 * wet[i];
      g *= 1 - 0.38 * wet[i];
      b *= 1 - 0.3 * wet[i];
    }
    const hasSurface = surface?.has(i);
    const emits = art && (flags & 2) !== 0 && !world.renderMetadata?.muteEmission?.[i];
    const automatic = kind === LightSchedule.emissionKind && d[q + 15] === LightSchedule.emissionMarker;
    const sourceScale = automatic ? LightSchedule.emissionScale(dusk) : 1;
    const scheduled = lamps.length && !(flags & 22) && al >= 1 ? LightSchedule.transfer(lamps, x, y, z) : null;
    const dn = clamp((-cz - (eyeD - R)) / (2 * R), 0, 1);
    const iz = -1 / cz,
      tx = clamp(cx * iz, -limx, limx) / iz,
      ty = clamp(cy * iz, -limy, limy) / iz,
      j00 = ortho ? focal : focal * iz,
      j02 = ortho ? 0 : focal * tx * iz * iz,
      j12 = ortho ? 0 : focal * ty * iz * iz;
    const a0 = j00 * V[0] + j02 * V[2],
      a1 = j00 * V[4] + j02 * V[6],
      a2 = j00 * V[8] + j02 * V[10],
      b0 = j00 * V[1] + j12 * V[2],
      b1 = j00 * V[5] + j12 * V[6],
      b2 = j00 * V[9] + j12 * V[10];
    const c00 = d[q + 4] * s2,
      c01 = d[q + 5] * s2,
      c02 = d[q + 6] * s2,
      c11 = d[q + 8] * s2,
      c12 = d[q + 9] * s2,
      c22 = d[q + 10] * s2;
    const u0 = c00 * a0 + c01 * a1 + c02 * a2,
      u1 = c01 * a0 + c11 * a1 + c12 * a2,
      u2 = c02 * a0 + c12 * a1 + c22 * a2,
      w0 = c00 * b0 + c01 * b1 + c02 * b2,
      w1 = c01 * b0 + c11 * b1 + c12 * b2,
      w2 = c02 * b0 + c12 * b1 + c22 * b2;
    const A = a0 * u0 + a1 * u1 + a2 * u2 + 0.15,
      Bq = b0 * u0 + b1 * u1 + b2 * u2,
      C = b0 * w0 + b1 * w1 + b2 * w2 + 0.15,
      det = A * C - Bq * Bq;
    if (det <= 0) continue;
    const k0 = C / det,
      k1 = -Bq / det,
      k2 = A / det,
      ex = Math.min(3 * Math.sqrt(A) + (integrateFootprint ? .25 : 0), 2048),
      ey = Math.min(3 * Math.sqrt(C) + (integrateFootprint ? .25 : 0), 2048);
    let sx = ortho ? ((cx / (oh * asp)) * 0.5 + 0.5) * W : ((((tp / asp) * cx) / -cz) * 0.5 + 0.5) * W,
      sy = ortho ? ((cy / oh) * 0.5 + 0.5) * H : (((tp * cy) / -cz) * 0.5 + 0.5) * H;
    if (kind === 1) {
      sx = Math.floor(sx) + 0.5;
      sy = Math.floor(sy) + 0.5;
    }
    if (centers) {
      centers[i * 2] = sx;
      centers[i * 2 + 1] = H - sy;
    }
    if (sx + ex < 0 || sx - ex > W || sy + ey < 0 || sy - ey > H) continue;
    let coverage = 1,
      glint = 0;
    const planar = surface?.planar(i);
    const pixelSurface = PIX?.[i * 8] && !surface?.reveals(i) && (!planar || (al >= 1 && !(flags & 1)));
    const projected = surface?.projected(i);
    const fragmentSurface = !pixelSurface && (planar || projected);
    const detailParticle = world.effectParticles?.some(({ first, count }) => i >= first && i < first + count);
    if (hasSurface && !pixelSurface && !fragmentSurface) {
      [r, g, b, coverage, glint] = surface.shade(i, x, y, z, x, y, z, r, g, b);
    }
    const fogMix =
      !(flags & 2) && world.fog.max > 0 && world.fog.start < 1 ? sstep(world.fog.start, 1, dn) * world.fog.max : 0;
    const reflectInRaster = planar && !pixelSurface;
    const normal = fragmentSurface ? surface.surfaceNormal(i) : null;
    if (fogMix && !reflectInRaster) {
      r += (fog[0] - r) * fogMix;
      g += (fog[1] - g) * fogMix;
      b += (fog[2] - b) * fogMix;
    }
    const solid = al >= 1,
      writesDepth = solid && coverage === 1 && !(flags & 1),
      glass = (flags & 16) !== 0,
      x0 = Math.max(0, Math.floor(sx - ex)),
      x1 = Math.min(W - 1, Math.ceil(sx + ex)),
      y0 = Math.max(0, Math.floor(sy - ey)),
      y1 = Math.min(H - 1, Math.ceil(sy + ey));
    const coat = PIX && hasSurface && (!writesDepth || reflectInRaster || surface.reveals(i));
    if (coat && !surfaceOverlay) surfaceOverlay = new Float32Array(W * H * 4);
    r = Math.min(r, 1);
    g = Math.min(g, 1);
    b = Math.min(b, 1);
    drawn++;
    /* inked detail: a dab that carries a tile, and is still the colour it was baked, takes each pixel's colour from the tile, at the
       place on the surface the pixel looks at (the two half-axes of the tile, carried to the screen, and that turned inside out) */
    let fi = -1,
      i00 = 0,
      i01 = 0,
      i10 = 0,
      i11 = 0;
    if (FN && FN[i * 12 + 11] && FN[i * 12 + 7] === pk && !add[i] && kind !== 5 && kind !== 12 && kind !== 13) {
      const f = i * 12,
        sc = SC[i],
        m00 = (a0 * FN[f + 4] + a1 * FN[f + 5] + a2 * FN[f + 6]) * sc,
        m01 = (a0 * FN[f + 8] + a1 * FN[f + 9] + a2 * FN[f + 10]) * sc,
        m10 = (b0 * FN[f + 4] + b1 * FN[f + 5] + b2 * FN[f + 6]) * sc,
        m11 = (b0 * FN[f + 8] + b1 * FN[f + 9] + b2 * FN[f + 10]) * sc,
        dt = m00 * m11 - m01 * m10;
      if (Math.abs(dt) > 1e-4 * (Math.abs(m00 * m11) + Math.abs(m01 * m10) + 1e-9)) {
        fi = f;
        i00 = m11 / dt;
        i01 = -m01 / dt;
        i10 = -m10 / dt;
        i11 = m00 / dt;
      }
    }
    const wantsDepth = probe || deferred;
    const probeNormal = wantsDepth ? geometrySample(i).normal : null, probeCenter = wantsDepth && [x, y, z];
    const probeReach = wantsDepth ? 3 * Math.sqrt(c00 + c11 + c22) : 0;
    for (let iy = y0; iy <= y1; iy++) {
      const dy = iy + 0.5 - sy;
      for (let ix = x0; ix <= x1; ix++) {
        const dx = ix + 0.5 - sx,
          pw = -0.5 * (k0 * dx * dx + k2 * dy * dy) - k1 * dx * dy;
        let a;
        if (integrateFootprint) a = footprint(dx, dy, k0, k1, k2, al, solid && !o.soft);
        else {
          if (pw > 0 || pw < -4.5) continue;
          const gg = al * Math.exp(pw);
          a = !o.soft && solid ? 0.99 * sstep(0.38, 0.62, gg) : Math.min(0.99, gg);
        }
        if (a < 0.004) continue;
        let pr = r,
          pg = g,
          pb = b,
          alpha = coverage,
          highlight = glint,
          paletteId = 0;
        if (fi >= 0) {
          const u = clamp(Math.floor((i00 * dx + i01 * dy) * 2 + 2), 0, 3),
            v = clamp(Math.floor((i10 * dx + i11 * dy) * 2 + 2), 0, 3),
            c = FPAL[Math.floor(FN[fi + v] / (u === 0 ? 1 : u === 1 ? 64 : u === 2 ? 4096 : 262144)) % 64];
          if (c) {
            pr = c[0];
            pg = c[1];
            pb = c[2];
            if (!reflectInRaster) {
              pr += (fog[0] - pr) * fogMix;
              pg += (fog[1] - pg) * fogMix;
              pb += (fog[2] - pb) * fogMix;
            }
          }
        }
        if (automatic || scheduled) {
          const exposure = scheduled?.gain ?? sourceScale;
          const tint = scheduled?.color;
          pr = Math.min(1, pr * exposure + (tint?.[0] ?? 0));
          pg = Math.min(1, pg * exposure + (tint?.[1] ?? 0));
          pb = Math.min(1, pb * exposure + (tint?.[2] ?? 0));
        }
        if (fragmentSurface) {
          const hit = surfacePoint(rayAt(ix + 0.5, iy + 0.5), normal, x, y, z, -cz, R);
          [pr, pg, pb, alpha, highlight, paletteId] = surface.shade(i, ...hit, x, y, z, pr, pg, pb, ix + 0.5, iy + 0.5);
          if (reflectInRaster) {
            pr += (fog[0] - pr) * fogMix;
            pg += (fog[1] - pg) * fogMix;
            pb += (fog[2] - pb) * fogMix;
          }
        }
        a *= alpha;
        if (a < 0.004) continue;
        const p = iy * W + ix, wd = writesDepth && alpha === 1;
        const surfaceZ = probe || deferred ?
          sampledDepth(rayAt(ix + .5, iy + .5), probeNormal, probeCenter, -cz, probeReach) : -cz;
        if (probe) probe(p, i, -cz, surfaceZ, pr, pg, pb, a);
        if (deferred && deferredCount >= fragmentBudget) {
          playFragments(false);
          orderFallback = true;
        }
        if (deferred) {
          const entry = { sort: flags & 4 ? Infinity : surfaceZ, index: n, center: -cz,
            sample: [i, surfaceZ, clamp((surfaceZ - (eyeD - R)) / (2 * R), 0, 1), a, pr, pg, pb,
              wd, emits, highlight, paletteId, detailParticle, projected, coat, glass] };
          if (!deferred.has(p)) deferred.set(p, []);
          deferred.get(p).push(entry);
          deferredCount++;
        } else composite(p, i, -cz, dn, a, pr, pg, pb, wd, emits, highlight, paletteId, detailParticle, projected, coat, glass);
      }
    }
  }
  if (deferred) playFragments(true);
  /* colour per pixel. Each pixel's line of sight is met with the plane of the dab in front there (the way its surface truly faces),
     and the pixel is coloured at that exact place: by its pattern, if it has one, or by its ramp. How lit it is is the mean over the
     pixels round it that lie on the same ramp and surface, so the edges between bands are drawn by the pixels, not by the dabs */
  if (PIX) {
    const PT = world.pixTex || [],
      RP = world.ramps || [],
      R00 = V[0],
      R01 = V[4],
      R02 = V[8],
      R10 = V[1],
      R11 = V[5],
      R12 = V[9],
      R20 = V[2],
      R21 = V[6],
      R22 = V[10],
      ex = -(R00 * V[12] + R10 * V[13] + R20 * V[14]),
      ey = -(R01 * V[12] + R11 * V[13] + R21 * V[14]),
      ez = -(R02 * V[12] + R12 * V[13] + R22 * V[14]),
      lit = new Float32Array(W * H),
      PALC = world.pal.map((h, k) => hex(k)),
      VW = world.pixView,
      shaper = o.lightShape === undefined ? !!(world.look && world.look.pixel) : !!o.lightShape;
    // (patterns drawn as little upright pictures need to know where the picture is looked at from, and which pixel is asked about)
    if (VW)
      Object.assign(VW, {
        on: true,
        t,
        R: [R00, R01, R02, R10, R11, R12, R20, R21, R22],
        e: [ex, ey, ez],
        tp,
        ortho,
        oh,
        asp,
        W,
        H
      });
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const p = y * W + x,
          i = win[p];
        if (i < 0 || !PIX[i * 8]) continue;
        /* the light, smoothed over the same surface round the pixel: three by three; with the light shaper (o.lightShape, on for
           pixel-art dioramas, as on the page) also over seven by seven, only where the surface faces much the same way, so light and
           shade fall in a few big shapes with smooth edges. Near the edge of a surface the big window is cut in half and its mean
           would pull a lit rim toward the middle (shading that follows the outline): there the three by three is kept */
        let sum = 0,
          cnt = 0,
          s7 = 0,
          c7 = 0;
        const rad = shaper ? 3 : 1;
        for (let dy = -rad; dy <= rad; dy++)
          for (let dx = -rad; dx <= rad; dx++) {
            const X2 = x + dx,
              Y2 = y + dy;
            if (X2 < 0 || Y2 < 0 || X2 >= W || Y2 >= H) continue;
            const q = Y2 * W + X2,
              j = win[q];
            if (j < 0 || PIX[j * 8] !== PIX[i * 8]) continue;
            const dd = Math.abs(dep[q] - dep[p]);
            if (dx >= -1 && dx <= 1 && dy >= -1 && dy <= 1 && dd <= 0.01) {
              sum += PIX[j * 8 + 1];
              cnt++;
            }
            if (
              shaper &&
              ((dx + dy) & 1) === 0 && // (the wide window every other pixel, a checkerboard, as on the page)
              dd <= 0.03 &&
              PIX[i * 8 + 3] * PIX[j * 8 + 3] + PIX[i * 8 + 4] * PIX[j * 8 + 4] + PIX[i * 8 + 5] * PIX[j * 8 + 5] >= 0.8
            ) {
              s7 += PIX[j * 8 + 1];
              c7++;
            }
          }
        lit[p] = sum / cnt;
        if (shaper && c7) {
          const k = Math.min(1, Math.max(0, (c7 / 25 - 0.5) / 0.35)),
            sm = k * k * (3 - 2 * k);
          lit[p] += (s7 / c7 - lit[p]) * sm;
        }
      }
    pixed = new Uint8Array(W * H);
    const HX = new Float32Array(W * H),
      HY = new Float32Array(W * H),
      HZ = new Float32Array(W * H);
    const key = new Float64Array(W * H).fill(NaN),
      cB = new Int16Array(W * H).fill(-1),
      cBelow = new Int16Array(W * H),
      cAbove = new Int16Array(W * H),
      cLeft = new Int16Array(W * H),
      CELL = world.pixCell || { body: 0, below: 0, above: 0, left: 0 };
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const p = y * W + x,
          i = win[p];
        if (i < 0 || !PIX[i * 8]) continue;
        const f = i * 8,
          ramp = RP[PIX[f] - 1];
        let nx = PIX[f + 3], ny = PIX[f + 4], nz = PIX[f + 5];
        if (surface?.has(i)) [nx, ny, nz] = surface.normalAt(i, [nx, ny, nz]);
        const vx = (((x + 0.5) / W) * 2 - 1) * (ortho ? oh * asp : asp / tp),
          vy = (((y + 0.5) / H) * 2 - 1) * (ortho ? oh : 1 / tp),
          // (orthographic: each ray starts at its own point on the picture's plane, and all run straight ahead)
          ox0 = ortho ? ex + R00 * vx + R10 * vy : ex,
          oy0 = ortho ? ey + R01 * vx + R11 * vy : ey,
          oz0 = ortho ? ez + R02 * vx + R12 * vy : ez,
          dxw = ortho ? -R20 : R00 * vx + R10 * vy - R20,
          dyw = ortho ? -R21 : R01 * vx + R11 * vy - R21,
          dzw = ortho ? -R22 : R02 * vx + R12 * vy - R22,
          den = nx * dxw + ny * dyw + nz * dzw,
          sd = Math.abs(den) > 1e-6 ? (nx * (X[i] - ox0) + ny * (Y[i] - oy0) + nz * (Z[i] - oz0)) / den : 0,
          px = sd ? ox0 + dxw * sd : X[i],
          py = sd ? oy0 + dyw * sd : Y[i],
          pz = sd ? oz0 + dzw * sd : Z[i],
          pat = PIX[f + 2],
          ev = pat ? PT[pat - 1] : null,
          /* (how big a screen pixel is, for the patterns' detail: one for the whole picture, from the camera's distance alone, as on the
             page; from each surface's slant it would differ from pixel to pixel and change as the view turns, and details flicker) */
          fp = (dist * 2) / (tp * H);
        if (VW) ((VW.x = x), (VW.y = y));
        HX[p] = px;
        HY[p] = py;
        HZ[p] = pz;
        if (ev && ev.cell) {
          key[p] = ev.cell(
            px,
            py,
            pz,
            ny,
            lit[p],
            nx,
            nz,
            null,
            fp,
            ramp,
            world.pixUnfold ? world.pixUnfold(PIX[f + 6], PIX[f + 7]) : null
          );
          cB[p] = CELL.body;
          cBelow[p] = CELL.below;
          cAbove[p] = CELL.above;
          cLeft[p] = CELL.left;
        } else
          cB[p] = ev
            ? ev.tex(
                px,
                py,
                pz,
                ny,
                lit[p],
                nx,
                nz,
                null,
                fp,
                ramp,
                world.pixUnfold ? world.pixUnfold(PIX[f + 6], PIX[f + 7]) : null
              )
            : ramp
              ? ramp[clamp(Math.floor(lit[p] * ramp.length), 0, ramp.length - 1)]
              : -1;
      }
    if (VW) VW.on = false;
    // a pixel at the edge of its cell takes that edge's colour: lower edge first, then the side, then the upper edge
    const kAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? NaN : key[y * W + x]),
      differs = (k, q) => q === q && q !== k;
    /* outlines (look.outline), as on the page: a pixel at the edge of a thing, where it meets another material, the background, or
       something well behind it, and is the nearer of the two, takes a darker step of its own ramp (two by default), so each thing is
       ringed in its own darker colour and a lit edge in a softer one. A material with line: false (clouds, water) has none */
    const OLo = ink || o.artInkActive ? null : look.outline,
      OL = OLo ? (OLo === true ? {} : OLo) : null,
      olK = OL && OL.k !== undefined ? OL.k : 2,
      olEps = OL ? (OL.eps === undefined ? 0.6 : OL.eps) / (world.detail || 12) / (2 * R) : 0,
      olGap = OL ? (OL.gap === undefined ? 0.3 : OL.gap) / (2 * R) : 0,
      OFF = world.rampOff || [],
      N4 = [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1]
      ];
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const p = y * W + x,
          i = win[p];
        let ci = cB[p];
        if (ci < 0) continue;
        const k = key[p];
        if (k === k) {
          if (differs(k, kAt(x, y - 1))) ci = cBelow[p];
          else if (differs(k, kAt(x - 1, y))) ci = cLeft[p];
          else if (differs(k, kAt(x, y + 1))) ci = cAbove[p];
        }
        if (OL) {
          const rid = PIX[i * 8];
          if (!OFF[rid - 1]) {
            let edge = false,
              sky = false;
            for (const [dx, dy] of N4) {
              const X2 = x + dx,
                Y2 = y + dy;
              if (X2 < 0 || Y2 < 0 || X2 >= W || Y2 >= H) continue;
              const q = Y2 * W + X2,
                dd = dep[q] - dep[p];
              if (dd <= olEps) continue;
              const j = win[q];
              if (j < 0 || PIX[j * 8] !== rid || dd > olGap) {
                edge = true;
                sky = dep[q] >= 0.995;
                break;
              }
            }
            /* (and a crease: where its own surface turns sharply, as the edge of a block of stone or a crate, the lit side of the turn
                takes a step lighter and the other a step darker, a bevel two pixels wide. Not in leaves or grass) */
            let crease = 0;
            const pk = PIX[i * 8 + 2] ? (world.pats[PIX[i * 8 + 2] - 1] || {}).kind : null;
            if (!edge && OL.crease !== false && pk !== 'leaves' && pk !== 'turf')
              for (const [dx, dy] of N4) {
                const X2 = x + dx,
                  Y2 = y + dy;
                if (X2 < 0 || Y2 < 0 || X2 >= W || Y2 >= H) continue;
                const q = Y2 * W + X2,
                  j = win[q];
                if (j < 0 || PIX[j * 8] !== rid || Math.abs(dep[q] - dep[p]) > olGap) continue;
                if (
                  PIX[i * 8 + 3] * PIX[j * 8 + 3] + PIX[i * 8 + 4] * PIX[j * 8 + 4] + PIX[i * 8 + 5] * PIX[j * 8 + 5] >
                  0.7
                )
                  continue;
                crease = PIX[i * 8 + 1] >= PIX[j * 8 + 1] ? 1 : -1;
                break;
              }
            if (edge || crease) {
              const ramp = RP[rid - 1],
                b = ramp.indexOf(ci);
              /* (a rim in the light takes a softer line than one in shade, or none against another thing, as on the page: so the outline
                 does not darken a shape all round, whichever way it faces, which is pillow shading) */
              const k2 = b * 2 >= ramp.length ? (sky ? 1 : 0) : olK;
              if (b >= 0) ci = ramp[Math.max(0, Math.min(ramp.length - 1, edge ? b - k2 : b + crease))];
            }
          }
          pixed[p] = 1;
        }
        if (!PALC[ci]) continue;
        const base = PALC[ci],
          c = surface?.has(i)
            ? surface.shade(i, HX[p], HY[p], HZ[p], X[i], Y[i], Z[i], ...base, x + 0.5, y + 0.5)
            : base,
          kf = world.fog.max > 0 && world.fog.start < 1 ? sstep(world.fog.start, 1, dep[p]) * world.fog.max : 0;
        if (surfaceGlint) surfaceGlint[p] = c[4] > 0.22;
        if ((surfaceOverlay?.[p * 4 + 3] || 0) < 0.5) {
          if (localAt) localAt[p] = c[5] || 0;
          if (detail && surface?.projected(i) && c[4] > 0.22) detail[(H - 1 - y) * W + x] = 1;
        }
        col[p * 3] = c[0] + (fog[0] - c[0]) * kf;
        col[p * 3 + 1] = c[1] + (fog[1] - c[1]) * kf;
        col[p * 3 + 2] = c[2] + (fog[2] - c[2]) * kf;
        if (captured) {
          const coat = surfaceOverlay?.[p * 4 + 3] || 0;
          const baseAlpha = (captured[p] - coat) / Math.max(1e-6, 1 - coat);
          for (let channel = 0; channel < 3; channel++) col[p * 3 + channel] *= clamp(baseAlpha, 0, 1);
        }
        if (surfaceOverlay) {
          const j = p * 4,
            through = 1 - surfaceOverlay[j + 3];
          for (let channel = 0; channel < 3; channel++) {
            col[p * 3 + channel] = surfaceOverlay[j + channel] + col[p * 3 + channel] * through;
          }
        }
      }
    // (o.pick: where on the surface each pixel lies, for the paint-over tool; rows from the bottom, as everything here)
    if (o.pick) Object.assign(o.pick, { W, H, X: HX, Y: HY, Z: HZ, win, PIX, dep });
    /* edge sprites (K.pixel.edge; o.edges, on by default), as on the page: little pixel pictures stood on points pinned to the
       surface (K.pixel.anchors; the world's pixAnchors), each moving with the dab it stands on, turned the way its surface faces
       on the screen (up, to a side, down), and shown only past the edge of that surface: over the background, over something well
       behind, or over anything that is not its own surface; never over what is nearer. So as the view turns, a sprite whose point
       goes round behind an edge sinks behind it a pixel at a time. Where two cover a pixel the nearer wins */
    const AN = o.edges !== false && world.pixAnchors ? world.pixAnchors(world) : null;
    if (AN && AN.n) {
      const EP = (world.pats || []).map(pt => pt && pt.edge),
        OLe = (world.look || {}).outline,
        eGap = (OLe && OLe !== true && OLe.gap !== undefined ? OLe.gap : 0.3) / (2 * R),
        fpe = (dist * 2) / (tp * H),
        keep = Math.min(1, (0.25 * (1 / (world.detail || 12))) / fpe),
        tol = 3 * fpe + 0.02,
        OD = [
          [0, 1],
          [1, 0],
          [-1, 0],
          [0, -1]
        ],
        TD = [
          [1, 0],
          [0, -1],
          [0, 1],
          [1, 0]
        ],
        A = AN.data,
        sprD = new Float32Array(W * H).fill(9),
        sprC = new Int16Array(W * H).fill(-1),
        sprOwner = art ? new Int32Array(W * H) : null;
      for (let a = 0; a < AN.n; a++) {
        const q0 = a * 12,
          ed = EP[A[q0 + 8]];
        if (!ed || A[q0 + 7] >= keep * (ed.share === undefined ? 0.7 : ed.share)) continue;
        const i = A[q0 + 3],
          ax = A[q0] + X[i] - d[i * 16],
          ay = A[q0 + 1] + Y[i] - d[i * 16 + 1],
          az = A[q0 + 2] + Z[i] - d[i * 16 + 2],
          nx = A[q0 + 4],
          ny = A[q0 + 5],
          nz = A[q0 + 6],
          cx = V[0] * ax + V[4] * ay + V[8] * az + V[12],
          cy = V[1] * ax + V[5] * ay + V[9] * az + V[13],
          cz = V[2] * ax + V[6] * ay + V[10] * az + V[14];
        if (cz > -near) continue;
        const sx = ortho ? ((cx / (oh * asp)) * 0.5 + 0.5) * W : ((((tp / asp) * cx) / -cz) * 0.5 + 0.5) * W,
          sy = ortho ? ((cy / oh) * 0.5 + 0.5) * H : (((tp * cy) / -cz) * 0.5 + 0.5) * H,
          px1 = Math.floor(sx),
          py1 = Math.floor(sy);
        if (px1 < -8 || py1 < -8 || px1 > W + 8 || py1 > H + 8) continue;
        // which way the surface faces on the screen; one that faces the eye has no way out, and stands nothing
        const vx = V[0] * nx + V[4] * ny + V[8] * nz,
          vy = V[1] * nx + V[5] * ny + V[9] * nz,
          vz = V[2] * nx + V[6] * ny + V[10] * nz,
          cl = Math.hypot(cx, cy, cz),
          facing = ortho ? -vz : (vx * cx + vy * cy + vz * cz) / cl;
        if (Math.abs(facing) > 0.95) continue;
        let dx = ortho ? vx : -vx * cz + cx * vz,
          dy = ortho ? vy : -vy * cz + cy * vz;
        const dl = Math.hypot(dx, dy);
        if (dl < 1e-12) continue;
        dx /= dl;
        dy /= dl;
        const cat = dy > 0.38 ? 0 : dy < -0.38 ? 3 : dx > 0 ? 1 : 2,
          list = cat === 0 ? ed.up : cat === 3 ? ed.down : ed.side;
        if (!list.length) continue;
        const sp = list[Math.min(list.length - 1, Math.floor(A[q0 + 11] * list.length))],
          ramp = RP[A[q0 + 9]],
          b = clamp(Math.floor(A[q0 + 10] * ramp.length), 0, ramp.length - 1),
          dA = (-cz - (eyeD - R)) / (2 * R),
          [odx, ody] = OD[cat],
          [tdx, tdy] = TD[cat];
        for (let r = 0; r < sp.h; r++)
          for (let c = 0; c < sp.w; c++) {
            const v = sp.cells[r * sp.w + c];
            if (!v) continue;
            const ou = r + 1 - sp.sink,
              al = c - sp.ax,
              X2 = px1 + odx * ou + tdx * al,
              Y2 = py1 + ody * ou + tdy * al;
            if (X2 < 0 || Y2 < 0 || X2 >= W || Y2 >= H) continue;
            const q = Y2 * W + X2,
              dp = dep[q];
            if (dA >= sprD[q]) continue;
            let show;
            if (dp >= 0.995) show = true;
            else if (dp < dA - 0.008)
              show = false; // (something nearer stands here)
            else if (r < sp.sink)
              show = true; // (the root rows lie over the thing itself)
            else {
              const j = win[q];
              show =
                j < 0 || !PIX[j * 8]
                  ? dp - dA > eGap
                  : Math.abs((HX[q] - ax) * nx + (HY[q] - ay) * ny + (HZ[q] - az) * nz) > tol;
            }
            if (!show) continue;
            sprD[q] = dA;
            if (sprOwner) sprOwner[q] = i;
            sprC[q] = v >= 100 ? v - 100 : ramp[clamp(b + v - 8, 0, ramp.length - 1)];
          }
      }
      sprM = new Uint8Array(W * H);
      for (let q = 0; q < W * H; q++) {
        if (sprC[q] < 0 || !PALC[sprC[q]]) continue;
        const c = PALC[sprC[q]];
        col[q * 3] = c[0];
        col[q * 3 + 1] = c[1];
        col[q * 3 + 2] = c[2];
        if (transparent) captured[q] = 1;
        if (axialDepth) axialDepth[q] = eyeD - R + sprD[q] * 2 * R;
        if (art) art.sprite(q, sprOwner[q], eyeD - R + sprD[q] * 2 * R);
        if (localAt) localAt[q] = 0;
        if (detail) detail[(H - 1 - Math.floor(q / W)) * W + q % W] = 0;
        dep[q] = sprD[q]; // (so the clean-up sees it as part of the thing, and leaves it as drawn)
        pixed[q] = 1;
        sprM[q] = 1;
      }
    }
  }
  let atmosphere, volumeStats;
  if (axialDepth) {
    const quality = atmosphereQuality({ ...world.volumeQuality, ...o.volumeQuality });
    quality.wind = world.volumeWind && !o.wind && !an.wind ? Airflow.frame(world.volumeWind).velocity : wind.velocity;
    const lighting = volumes.some(volume => volume.type === 'field') && (o.volumeLighting ?? world.volumeLighting);
    const media = lighting ? SceneOptics.lighting(lighting, world.pal) : undefined;
    atmosphere = applyAtmosphere(volumes, col, axialDepth, rayAt, W, H, eyeD + 2 * R, quality, t, media,
      ink?.ramps.has('fog') || o.captureFog || transparent, o.volumeHistory,
      o.volumeHistory && [W, H, focal, ortho, ...V].join('/'));
    if (quality.stats) volumeStats = atmosphere.stats;
  }
  const passes = art?.finalize(world, t, { x: X, y: Y, z: Z, rayAt, span: R,
    detail, sprM, surfaceGlint, centers, motionFrom });
  if (o.captureCoverage) {
    if (reflectionTint && passes?.emission) ArtEffects.tintReflection(col, captured, passes.emission, W, H, reflectionTint, t);
    return { w: W, h: H, rgb: col, coverage: captured };
  }
  const alpha = transparent ? new Uint8Array(W * H) : null;
  if (alpha) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x, q = (H - 1 - y) * W + x;
      const fog = atmosphere?.fog?.[q] || 0;
      const a = fog + (1 - fog) * captured[p];
      alpha[q] = Math.round(clamp(a, 0, 1) * 255);
      if (a > 1e-6) for (let c = 0; c < 3; c++) col[p * 3 + c] /= a;
    }
  }
  if (o.samples) {
    // (the picture the contour look takes its insides from is worked on first, as the page does: glass bends it, contact shade darkens it)
    let c2 = col;
    if (o.worked) {
      const bend = world.refract === undefined ? 6 : world.refract,
        aoK = world.ao ? (world.ao.k === undefined ? 0.5 : world.ao.k) : 0,
        aoR = world.ao ? (world.ao.range || 0.6) / (2 * R) : 1,
        at = (x, y) => clamp(y, 0, H - 1) * W + clamp(x, 0, W - 1),
        TAPS = [2, 0, -2, 0, 0, 2, 0, -2, 1, 1, -1, 1, 1, -1, -1, -1];
      c2 = new Float32Array(col.length);
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const p = y * W + x,
            gx = gls[at(x + 1, y)] - gls[at(x - 1, y)],
            gy = gls[at(x, y + 1)] - gls[at(x, y - 1)];
          let q = p;
          if (gls[p] + Math.abs(gx) + Math.abs(gy) > 0) q = at(x + Math.round(gx * bend), y + Math.round(gy * bend));
          let k = 1;
          if (aoK > 0) {
            let occ = 0;
            for (let i = 0; i < 16; i += 2) {
              const dd = (dep[p] - dep[at(x + TAPS[i], y + TAPS[i + 1])]) / aoR;
              if (dd > 0.08 && dd < 3) occ += Math.min(1, dd);
            }
            k = 1 - aoK * Math.min(1, occ / 4);
          }
          c2[p * 3] = col[q * 3] * k;
          c2[p * 3 + 1] = col[q * 3 + 1] * k;
          c2[p * 3 + 2] = col[q * 3 + 2] * k;
        }
    }
    return {
      w: W, h: H, color: Uint8Array.from(c2, v => Math.round(clamp(v, 0, 1) * 255)), depth: dep, drawn,
      ...(localAt && { localAt, localPalettes: surface.palettes }), ...(detail && { detail }), ...(passes && { passes }), ...(motionReference && { motionReference }),
      ...(atmosphere?.fog && { fog: atmosphere.fog }), ...(volumeStats && { volumeStats }), ...(alpha && { alpha }), ...(orderFallback && { orderFallback })
    };
  }
  // the second pass: an outline where the picture steps back sharply, a little ordered noise, then the nearest colour of the palette
  const out = new Uint8Array(W * H * 3),
    np = world.pal.length,
    pal = [];
  for (let i = 0; i < np; i++) pal.push(hex(i));
  const edge = world.outline && world.outline.edge ? world.outline.edge / (2 * R) : 0,
    line = hex(world.outline ? world.outline.c : 0),
    dith = (o.dither === undefined ? 0.35 : o.dither) * 0.3 * world.dither,
    localOutput = localAt && PixelLook.outputPalettes(tone?.palette || world.pal, surface.palettes),
    use = new Uint32Array(localOutput?.packed.length ?? (tone ? tone.palette.length : np)),
    ln = look.lines ? (look.lines === true ? {} : look.lines) : null,
    lines = !ink && !!ln,
    lineGap = ln ? (ln.gap || 0.3) / (2 * R) : 1,
    lineK = ln && ln.k !== undefined ? ln.k : 0.55,
    lineLit = ln && ln.lit !== undefined ? ln.lit : 1.15;
  const D = (x, y) => dep[clamp(y, 0, H - 1) * W + clamp(x, 0, W - 1)],
    G = (x, y) => gls[clamp(y, 0, H - 1) * W + clamp(x, 0, W - 1)];
  // (as in the page: glass bends what is behind it, by how its own thickness changes across the picture; and, where a diorama asks for it,
  //  a pixel with nearer things close round it is shaded, so that what moves still sits in its own shadow)
  const bend = world.refract === undefined ? 6 : world.refract,
    aoK = world.ao ? (world.ao.k === undefined ? 0.5 : world.ao.k) : 0,
    aoR = world.ao ? (world.ao.range || 0.6) / (2 * R) : 1,
    AOT = [
      [2, 0],
      [-2, 0],
      [0, 2],
      [0, -2],
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1]
    ];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      let r = col[p * 3],
        g = col[p * 3 + 1],
        b = col[p * 3 + 2];
      const yo = H - 1 - y,
        q = (yo * W + x) * 3;
      if (!o.raw) {
        const gx = G(x + 1, y) - G(x - 1, y),
          gy = G(x, y + 1) - G(x, y - 1);
        if (gls[p] + Math.abs(gx) + Math.abs(gy) > 0) {
          const p2 = (clamp(y + Math.round(gy * bend), 0, H - 1) * W + clamp(x + Math.round(gx * bend), 0, W - 1)) * 3;
          r = col[p2];
          g = col[p2 + 1];
          b = col[p2 + 2];
        }
      }
      if (aoK > 0 && !o.raw) {
        const dc0 = dep[p];
        let occ = 0;
        for (const tq of AOT) {
          const dd = (dc0 - D(x + tq[0], y + tq[1])) / aoR;
          if (dd > 0.08 && dd < 3) occ += Math.min(1, dd);
        }
        const k = 1 - aoK * Math.min(1, occ / 4);
        r *= k;
        g *= k;
        b *= k;
      }
      if (o.raw) {
        out[q] = Math.round(clamp(r, 0, 1) * 255);
        out[q + 1] = Math.round(clamp(g, 0, 1) * 255);
        out[q + 2] = Math.round(clamp(b, 0, 1) * 255);
        continue;
      }
      const dc = dep[p],
        dm = dc - Math.max(2 * dc - D(x - 1, y) - D(x + 1, y), 2 * dc - D(x, y + 1) - D(x, y - 1));
      // part lines (look.lines), as on the page: the near side of a break in depth, darker, or lighter toward the light
      // (not where an outline was already worked out per pixel)
      if (lines && !(pixed && pixed[p])) {
        const dl = D(x - 1, y),
          dr = D(x + 1, y),
          du = D(x, y + 1),
          dd = D(x, y - 1),
          sx = dl + dr - 2 * dc,
          sy = du + dd - 2 * dc;
        if (Math.max(sx, sy) > lineGap) {
          const k = (sx >= sy ? dl > dr : du > dd) ? lineLit : lineK;
          r *= k;
          g *= k;
          b *= k;
        }
      }
      const outlined = !ink && edge > 0 && dc - dm > edge;
      if (outlined) {
        r = line[0];
        g = line[1];
        b = line[2];
      }
      const localId = outlined ? 0 : localAt?.[p];
      let ditherX = x, ditherY = y;
      if (anchoring) [ditherX, ditherY] = ArtStability.ditherCoordinates(stable, passes, yo * W + x, x, y);
      if (tone || localId) {
        const index = localId ? localOutput.rows[localId - 1][PixelLook.nearest([r, g, b], surface.palettes[localId - 1], false)] :
          PixelLook.toneIndex(tone, r, g, b, ditherX, anchoring && passes.splatId[yo * W + x] ? ditherY : yo);
        const color = (localOutput?.packed || tone.palette)[index];
        use[index]++;
        out[q] = color >> 16;
        out[q + 1] = (color >> 8) & 255;
        out[q + 2] = color & 255;
        continue;
      }
      if (!outlined && !surfaceGlint?.[p]) {
        const th = PixelLook.bayerRank(ditherX, ditherY) - 0.5;
        r = clamp(r + th * dith, 0, 1);
        g = clamp(g + th * dith, 0, 1);
        b = clamp(b + th * dith, 0, 1);
      }
      let bd = 1e9,
        bi = 0;
      for (let i = 0; i < np; i++) {
        const e = pal[i],
          dr = r - e[0],
          dg = g - e[1],
          db = b - e[2],
          dd = dr * dr * 0.3 + dg * dg * 0.55 + db * db * 0.15;
        if (dd < bd) {
          bd = dd;
          bi = i;
        }
      }
      use[bi]++;
      const h = world.pal[bi],
        gr = world.anim && world.anim.grade;
      if (gr) {
        out[q] = Math.round(gr[bi * 3] * 255);
        out[q + 1] = Math.round(gr[bi * 3 + 1] * 255);
        out[q + 2] = Math.round(gr[bi * 3 + 2] * 255);
      } else {
        out[q] = (h >> 16) & 255;
        out[q + 1] = (h >> 8) & 255;
        out[q + 2] = h & 255;
      }
    }
  /* pixel clean-up (an option, or a diorama's look.clean), as on the page: a speck (a pixel with no like neighbour of the eight round
     it, or one of a pair that has no other) takes the colour most of its eight neighbours share, if at least three share it, they are
     on the same surface, and it is not much brighter or darker than they are (a glint, an eye or a flower is kept). */
  if ((o.clean || (look.clean && !tone?.preserveDots)) && !o.raw) {
    const src = out.slice(),
      keep = look.clean && look.clean.keep !== undefined ? look.clean.keep : 0.3,
      at = (x, y) => (clamp(y, 0, H - 1) * W + clamp(x, 0, W - 1)) * 3,
      same = (a, b) => src[a] === src[b] && src[a + 1] === src[b + 1] && src[a + 2] === src[b + 2],
      lum = a => (src[a] * 0.3 + src[a + 1] * 0.55 + src[a + 2] * 0.15) / 255,
      depA = a => {
        const i = a / 3;
        return dep[(H - 1 - Math.floor(i / W)) * W + (i % W)];
      },
      N8 = [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1]
      ];
    const likes = (x, y, q) => {
      let n = 0,
        one = null;
      for (const [dx, dy] of N8)
        if (same(q, at(x + dx, y + dy))) {
          n++;
          one = [x + dx, y + dy];
        }
      return [n, one];
    };
    const empty = (x, y) => depA(at(x, y)) >= 0.995,
      lineClean = o.lineClean === undefined ? !!(world.look && world.look.pixel) : !!o.lineClean;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const q = at(x, y);
        const pixel = (H - 1 - y) * W + x;
        if ((alpha && alpha[q / 3] < 128) || sprM?.[pixel] || surfaceGlint?.[pixel] || detail?.[q / 3] || ArtStability.protectedPixel(stable, passes, q / 3)) continue;
        // outlines, as on the page: a notch is filled from what is round it, a bump against the background taken off
        const e0 = empty(x, y),
          N4 = N8.slice(0, 4),
          en = N4.filter(([dx, dy]) => empty(x + dx, y + dy)).length;
        if (e0 && en <= 1) {
          let kb = 0,
            best = -1;
          for (const [dx, dy] of N4) {
            if (empty(x + dx, y + dy)) continue;
            const a = at(x + dx, y + dy);
            let k = 0;
            for (const [ex, ey] of N4) if (same(a, at(x + ex, y + ey))) k++;
            if (k > kb) ((kb = k), (best = a));
          }
          if (best >= 0) {
            out[q] = src[best];
            out[q + 1] = src[best + 1];
            out[q + 2] = src[best + 2];
            continue;
          }
        }
        if (!e0 && en >= 3) {
          const [dx, dy] = N4.find(([ex, ey]) => empty(x + ex, y + ey)),
            a = at(x + dx, y + dy);
          out[q] = src[a];
          out[q + 1] = src[a + 1];
          out[q + 2] = src[a + 2];
          continue;
        }
        /* the line cleaner (an option, on for pixel-art dioramas, as on the page): a one-pixel kink in a straight edge between two
           colours taken off, and on a dark line one pixel thick the double at the inside corner of a step given the colour beside it */
        if (lineClean) {
          let to = -1;
          for (const [dx, dy] of N8.slice(0, 4)) {
            const ex = dy,
              ey = dx,
              X = at(x + dx, y + dy);
            if (same(X, q) || !same(at(x + ex, y + ey), X) || !same(at(x - ex, y - ey), X)) continue;
            if (
              same(at(x - dx, y - dy), q) &&
              same(at(x - dx + ex, y - dy + ey), q) &&
              same(at(x - dx - ex, y - dy - ey), q)
            ) {
              to = X;
              break;
            }
          }
          if (to < 0) {
            const lum = a => src[a] * 0.3 + src[a + 1] * 0.55 + src[a + 2] * 0.15,
              l0 = lum(q);
            for (const [gx, gy] of N8.slice(4)) {
              if (
                !same(at(x + gx, y), q) ||
                !same(at(x, y + gy), q) ||
                same(at(x + gx, y + gy), q) ||
                same(at(x - gx, y), q) ||
                same(at(x, y - gy), q)
              )
                continue;
              const goH = same(at(x + 2 * gx, y), q) || same(at(x + 2 * gx, y - gy), q),
                goV = same(at(x, y + 2 * gy), q) || same(at(x - gx, y + 2 * gy), q),
                a = at(x - gx, y),
                b = at(x, y - gy);
              if (goH && goV && lum(a) > l0 + 15 && lum(b) > l0 + 15) {
                to = same(a, b) ? a : at(x - gx, y - gy);
                break;
              }
            }
          }
          if (to >= 0) {
            out[q] = src[to];
            out[q + 1] = src[to + 1];
            out[q + 2] = src[to + 2];
            continue;
          }
        }
        const [n, one] = likes(x, y, q);
        if (!(n === 0 || (n === 1 && likes(one[0], one[1], q)[0] === 1))) continue;
        const nb = N8.map(([dx, dy]) => at(x + dx, y + dy));
        let kb = 0,
          best = -1;
        for (const a of nb) {
          if (same(a, q)) continue;
          let k = 0;
          for (const b of nb) if (same(a, b)) k++;
          if (k > kb) ((kb = k), (best = a));
        }
        if (kb < 3 || Math.abs(depA(q) - depA(best)) > 0.03 || Math.abs(lum(q) - lum(best)) >= keep) continue;
        out[q] = src[best];
        out[q + 1] = src[best + 1];
        out[q + 2] = src[best + 2];
      }
  }
  return finishLook({
    w: W, h: H, px, rgb: out, drawn, use,
    ...((localOutput || tone) && { palette: localOutput?.packed || tone.palette }),
    ...(detail && { detail }), ...(motionReference && { motionReference }),
    ...(volumeStats && { volumeStats }), ...(o.captureFog && atmosphere?.fog && { fog: atmosphere.fog }),
    ...(alpha && { alpha }), ...(orderFallback && { orderFallback })
  }, passes, atmosphere?.fog);
}
// make every art pixel k screen pixels wide, the way the page shows it
function upscale(img, k) {
  const W = img.w * k,
    H = img.h * k,
    out = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    const sy = (y / k) | 0;
    for (let x = 0; x < W; x++) {
      const s = (sy * img.w + ((x / k) | 0)) * 3,
        q = (y * W + x) * 3;
      out[q] = img.rgb[s];
      out[q + 1] = img.rgb[s + 1];
      out[q + 2] = img.rgb[s + 2];
    }
  }
  return { w: W, h: H, rgb: out };
}
// several pictures in a grid, each with a small label in its corner
const FONT = {
  0: '111101101101111',
  1: '010110010010111',
  2: '111001111100111',
  3: '111001111001111',
  4: '101101111001001',
  5: '111100111001111',
  6: '111100111101111',
  7: '111001001001001',
  8: '111101111101111',
  9: '111101111001111',
  '.': '000000000000010',
  '-': '000000111000000',
  s: '000111110011111',
  ' ': '000000000000000',
  y: '101101111001111',
  t: '010111010010011'
};
function label(img, x0, y0, text, k) {
  k = k || 2;
  for (let c = 0; c < text.length; c++) {
    const g = FONT[text[c]] || FONT[' '];
    for (let j = 0; j < 15; j++)
      if (g[j] === '1')
        for (let a = 0; a < k; a++)
          for (let b = 0; b < k; b++) {
            const x = x0 + (c * 4 + (j % 3)) * k + a,
              y = y0 + ((j / 3) | 0) * k + b;
            if (x >= 0 && x < img.w && y >= 0 && y < img.h) {
              const q = (y * img.w + x) * 3;
              img.rgb[q] = 255;
              img.rgb[q + 1] = 255;
              img.rgb[q + 2] = 255;
            }
          }
  }
}
function grid(imgs, cols, labels) {
  const w = imgs[0].w,
    h = imgs[0].h,
    rows = Math.ceil(imgs.length / cols),
    out = { w: w * cols, h: h * rows, rgb: new Uint8Array(w * cols * h * rows * 3) };
  imgs.forEach((im, n) => {
    const ox = (n % cols) * w,
      oy = ((n / cols) | 0) * h;
    for (let y = 0; y < h; y++) out.rgb.set(im.rgb.subarray(y * w * 3, (y + 1) * w * 3), ((oy + y) * out.w + ox) * 3);
    if (labels) label(out, ox + 6, oy + 6, labels[n]);
  });
  return out;
}
module.exports = { render, upscale, grid, label, viewMatrix, FOV };
