const SceneOptics = require('../src/scene-optics.js');

function cameraRays(view, eye, W, H, focal, ortho) {
  const origin = eye.slice(),
    direction = [0, 0, 0];
  const ray = { origin, direction, axial: 1 };
  return (x, y) => {
    const u = (x - W / 2) / focal,
      v = (y - H / 2) / focal;
    ray.axial = ortho ? 1 : 1 / Math.hypot(u, v, 1);
    for (let i = 0; i < 3; i++) {
      const j = i * 4;
      const offset = u * view[j] + v * view[j + 1];
      origin[i] = eye[i] + (ortho ? offset : 0);
      direction[i] = ortho ? -view[j + 2] : (offset - view[j + 2]) * ray.axial;
    }
    return ray;
  };
}

function surfacePoint(ray, normal, x, y, z, axialDepth, radius) {
  const { origin, direction, axial } = ray;
  const facing = normal[0] * direction[0] + normal[1] * direction[1] + normal[2] * direction[2];
  if (Math.abs(facing) < 1e-7) return [x, y, z];
  const distance = (normal[0] * (x - origin[0]) + normal[1] * (y - origin[1]) + normal[2] * (z - origin[2])) / facing;
  if (distance < 0 || Math.abs(distance * axial - axialDepth) > radius) return [x, y, z];
  return origin.map((n, i) => n + distance * direction[i]);
}

function reflectionSampler(planes, render, view, eye, scale) {
  const definitions = new Map(),
    captures = new Map();
  for (const value of planes) {
    const plane = SceneOptics.plane(value);
    if (definitions.has(plane.id)) throw new RangeError('Duplicate reflection plane ' + plane.id);
    if (SceneOptics.planeDistance(plane, ...eye) > plane.bias) definitions.set(plane.id, plane);
    else definitions.set(plane.id, null);
  }
  const rgb = [0, 0, 0],
    reflected = { rgb, coverage: 0 };
  function sample(layer, x, y, dx, dy, dz) {
    const plane = definitions.get(layer.plane);
    if (!plane) return null;
    if (!captures.has(plane.id)) captures.set(plane.id, render(plane));
    const frame = captures.get(plane.id);
    const distortion = (layer.distortion ?? 5) * scale;
    x += distortion * (view[0] * dx + view[4] * dy + view[8] * dz);
    y += distortion * (view[1] * dx + view[5] * dy + view[9] * dz);
    const blur = (layer.blur ?? 0) * scale;
    let red = 0,
      green = 0,
      blue = 0,
      alpha = 0;
    function tap(tx, ty, weight) {
      tx = Math.floor(tx);
      ty = Math.floor(ty);
      if (tx < 0 || tx >= frame.w || ty < 0 || ty >= frame.h) return;
      const p = ty * frame.w + tx,
        j = p * 3;
      red += frame.rgb[j] * weight;
      green += frame.rgb[j + 1] * weight;
      blue += frame.rgb[j + 2] * weight;
      alpha += frame.coverage[p] * weight;
    }
    tap(x, y, blur ? 0.4 : 1);
    if (blur) {
      tap(x - blur, y, 0.15);
      tap(x + blur, y, 0.15);
      tap(x, y - blur, 0.15);
      tap(x, y + blur, 0.15);
    }
    if (alpha <= 1e-6) return null;
    rgb[0] = Math.min(1, red / alpha);
    rgb[1] = Math.min(1, green / alpha);
    rgb[2] = Math.min(1, blue / alpha);
    reflected.coverage = alpha;
    return reflected;
  }
  sample.has = id => !!definitions.get(id);
  return sample;
}

function atmosphereQuality(value = {}) {
  const { scale = 1, depthTolerance = .22, steps = 64, stepScale = 1, samples = 1, jitter = 'off',
    skip = true, seed = 0, stats = false } = value;
  if (!Number.isSafeInteger(scale) || scale < 1 || scale > 4 ||
      !Number.isFinite(depthTolerance) || depthTolerance < 0 ||
      !Number.isSafeInteger(steps) || steps < 4 || steps > 256 ||
      !Number.isFinite(stepScale) || stepScale < .25 || stepScale > 8 ||
      !Number.isSafeInteger(samples) || samples < 1 || samples > 4 || !['off', 'blue-noise', 'spatiotemporal'].includes(jitter) ||
      !Number.isSafeInteger(seed) || typeof skip !== 'boolean' || typeof stats !== 'boolean')
    throw new RangeError('Invalid atmosphere quality options');
  return { scale, depthTolerance, maxSteps: steps, stepScale, samples, jitter, skip, seed, stats };
}

const noiseTiles = new Map();
function volumeNoise(seed) {
  if (!noiseTiles.has(seed)) {
    if (noiseTiles.size >= 8) noiseTiles.delete(noiseTiles.keys().next().value);
    const { KIT } = require('../index.js').load();
    noiseTiles.set(seed, KIT.procedural.materials.blueNoise({ seed }));
  }
  return noiseTiles.get(seed);
}

function applyAtmosphere(volumes, col, depths, rayAt, W, H, horizon, quality, time, media, capture, history, viewKey) {
  const light = [0, 0, 0, 1], sample = [0, 0, 0, 1];
  const fields = volumes.some(volume => volume.type === 'field');
  const query = { ...quality, time, media };
  const temporal = fields && quality.jitter === 'spatiotemporal' && history;
  const tile = fields && quality.jitter !== 'off' ? volumeNoise(quality.seed) : null;
  const accumulation = temporal ? new Float32Array(W * H * 4) : null;
  const frame = temporal ? Math.floor(time * 60) : 0;
  const phaseShift = (frame * .61803398875) % 1;
  const samples = fields ? quality.samples : 1;
  const stats = { rays: 0, fallbackRays: 0 };
  const fog = capture ? new Float32Array(W * H) : null;
  function solve(x, y, depth) {
    const { origin, direction, axial } = rayAt(x + .5, y + .5);
    const stop = (Number.isFinite(depth) ? depth : horizon) / axial;
    const phase = tile ? ((tile.ranks[y % tile.height * tile.width + x % tile.width] + .5) / tile.ranks.length + phaseShift) % 1 : .5;
    light.fill(0);
    for (let i = 0; i < samples; i++) {
      query.jitter = (i + phase) / samples;
      SceneOptics.trace(volumes, origin, direction, stop, sample, query);
      for (let c = 0; c < 4; c++) light[c] += sample[c] / samples;
      stats.rays++;
    }
  }

  const { scale, depthTolerance } = quality, cw = Math.ceil(W / scale), ch = Math.ceil(H / scale);
  const low = scale > 1 ? new Float32Array(cw * ch * 4) : null;
  const lowDepth = low ? new Float32Array(cw * ch) : null;
  if (low) for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const rx = Math.min(W - 1, x * scale + (scale >> 1)), ry = Math.min(H - 1, y * scale + (scale >> 1));
    const p = y * cw + x;
    lowDepth[p] = depths[ry * W + rx];
    solve(rx, ry, lowDepth[p]);
    low.set(light, p * 4);
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, p = i * 3;
    let weight = 0;
    if (low) {
      light.fill(0);
      const u = (x - (scale >> 1)) / scale, v = (y - (scale >> 1)) / scale;
      const ix = Math.floor(u), iy = Math.floor(v);
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const bx = Math.max(0, Math.min(cw - 1, ix + dx)), by = Math.max(0, Math.min(ch - 1, iy + dy));
        const j = by * cw + bx, guide = lowDepth[j], depth = depths[i];
        const delta = guide === depth ? 0 : Math.abs(guide - depth);
        if (delta > depthTolerance) continue;
        const w = (1 - Math.abs(u - (ix + dx))) * (1 - Math.abs(v - (iy + dy))) / (1 + delta * 5);
        for (let c = 0; c < 4; c++) light[c] += low[j * 4 + c] * w;
        weight += w;
      }
    }
    if (weight) for (let c = 0; c < 4; c++) light[c] /= weight;
    else {
      solve(x, y, depths[i]);
      if (low) stats.fallbackRays += samples;
    }
    if (accumulation) accumulation.set(light, i * 4);
    else {
      for (let c = 0; c < 3; c++) col[p + c] = light[c] + light[3] * col[p + c];
      if (fog) fog[(H - 1 - y) * W + x] = 1 - light[3];
    }
  }
  if (accumulation) {
    history.filter(accumulation, depths, time, viewKey);
    for (let i = 0; i < W * H; i++) {
      const transmittance = accumulation[i * 4 + 3];
      for (let c = 0; c < 3; c++) col[i * 3 + c] = accumulation[i * 4 + c] + transmittance * col[i * 3 + c];
      if (fog) fog[(H - 1 - Math.floor(i / W)) * W + i % W] = 1 - transmittance;
    }
  }
  return { fog, stats };
}

module.exports = { cameraRays, surfacePoint, reflectionSampler, atmosphereQuality, applyAtmosphere };
