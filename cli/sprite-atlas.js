const fs = require('node:fs');
const path = require('node:path');
const PNG = require('./png.js');
const { render } = require('./render.js');
const ArtEffects = require('../src/art-effects.js');

const mapNames = ['depth', 'normal', 'emission'];
const byte = value => Math.round(Math.max(0, Math.min(1, value)) * 255);
const integer = (value, lo, hi) => Number.isSafeInteger(value) && value >= lo && value <= hi;

function spriteAtlas(world, options = {}) {
  const {
    width = 96, height = 96, directions = 8, times = [0], fps = 12, columns = directions,
    pivot = world.cam.target, yaw = world.cam.yaw, maps = [], pose, view = {}, depthRange
  } = options;
  if (!integer(width, 1, 2048) || !integer(height, 1, 2048) || !integer(directions, 1, 64) ||
      !integer(columns, 1, 256) || !Number.isFinite(fps) || fps <= 0 || fps > 240 ||
      !Array.isArray(times) || !times.length || times.length > 512 ||
      times.some((time, i) => !Number.isFinite(time) || time < 0 || (i && time <= times[i - 1])) ||
      !Array.isArray(pivot) || pivot.length !== 3 || !pivot.every(Number.isFinite) || !Number.isFinite(yaw) ||
      !Array.isArray(maps) || maps.some(map => !mapNames.includes(map)) ||
      (pose !== undefined && typeof pose !== 'function'))
    throw new RangeError('Invalid sprite atlas dimensions, timing, directions, pivot or maps');
  const requested = [...new Set(maps)];
  const count = times.length * directions, cols = Math.min(count, columns);
  const rows = Math.ceil(count / cols), w = width * cols, h = height * rows;
  if (w * h * (requested.length + 1) > 32e6) throw new RangeError('Sprite atlas exceeds its pixel budget');
  if (depthRange && (!Array.isArray(depthRange) || depthRange.length !== 2 ||
      !depthRange.every(Number.isFinite) || depthRange[0] >= depthRange[1]))
    throw new RangeError('Sprite depth range must be an increasing finite pair');

  const images = Object.fromEntries(['color', ...requested].map(name => [name, new Uint8Array(w * h * 4)]));
  const depths = requested.includes('depth') ? new Float32Array(w * h).fill(Infinity) : null;
  let minDepth = Infinity, maxDepth = -Infinity;
  const entries = [];
  const history = Array.from({ length: directions }, () => ArtEffects.history({ frames: 24 }));
  const { volumeHistory } = require('../src/scene-optics.js');
  const volumes = view.volumeQuality?.jitter === 'spatiotemporal' || world.volumeQuality?.jitter === 'spatiotemporal'
    ? Array.from({ length: directions }, () => volumeHistory()) : [];
  const orientation = Array.from({ length: directions }, (_, i) => yaw + i * Math.PI * 2 / directions);
  for (let f = 0; f < times.length; f++) {
    const time = times[f];
    if (pose) pose(world, time);
    else world.anim?.update?.(f ? time - times[f - 1] : 0, time);
    const duration = f + 1 < times.length ? times[f + 1] - time : 1 / fps;
    for (let direction = 0; direction < directions; direction++) {
      const i = f * directions + direction, ox = i % cols * width, oy = Math.floor(i / cols) * height;
      const image = render(world, { ...view, t: time, w: width, h: height, px: 1,
        yaw: orientation[direction], ortho: true, target: pivot,
        transparent: true, passes: requested, artHistory: history[direction], volumeHistory: volumes[direction] });
      const data = image.passes;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const p = y * width + x, q = (y + oy) * w + x + ox, j = p * 3, k = q * 4;
        const alpha = image.alpha[p];
        if (alpha) {
          images.color[k] = image.rgb[j];
          images.color[k + 1] = image.rgb[j + 1];
          images.color[k + 2] = image.rgb[j + 2];
        }
        images.color[k + 3] = alpha;
        if (depths && Number.isFinite(data.depth[p])) {
          minDepth = Math.min(minDepth, data.depth[p]);
          maxDepth = Math.max(maxDepth, data.depth[p]);
          depths[q] = data.depth[p];
        }
        if (images.normal && (data.normal[j] || data.normal[j + 1] || data.normal[j + 2])) {
          for (let c = 0; c < 3; c++) images.normal[k + c] = byte(.5 + data.normal[j + c] * .5);
          images.normal[k + 3] = 255;
        }
        if (images.emission) {
          for (let c = 0; c < 3; c++) images.emission[k + c] = byte(data.emission[j + c]);
          images.emission[k + 3] = Math.max(images.emission[k], images.emission[k + 1], images.emission[k + 2]);
        }
      }
      entries.push({ frame: f, direction, yaw: orientation[direction], time, duration,
        rect: { x: ox, y: oy, width, height }, pivot: { x: width / 2, y: height / 2 } });
    }
  }
  const range = depths && (depthRange || (Number.isFinite(minDepth) ? [minDepth, maxDepth] : null));
  if (range) {
    const [near, far] = range;
    for (let p = 0; p < depths.length; p++) if (Number.isFinite(depths[p])) {
      const z = Math.round(0xffffff * Math.max(0, Math.min(1, (depths[p] - near) / (far - near || 1))));
      const q = p * 4;
      images.depth[q] = z >> 16;
      images.depth[q + 1] = (z >> 8) & 255;
      images.depth[q + 2] = z & 255;
      images.depth[q + 3] = 255;
    }
  }
  const metadata = { width: w, height: h, tileWidth: width, tileHeight: height, directions, fps,
    pivot: pivot.slice(), frames: entries,
    encodings: {
      color: 'straight RGBA',
      ...(images.depth && { depth: { range, encoding: 'camera-axis distance as RGB24, alpha marks a surface' } }),
      ...(images.normal && { normal: 'world XYZ mapped from [-1,1] to RGB, alpha marks a normal' }),
      ...(images.emission && { emission: 'visible premultiplied emissive RGB, alpha is max RGB' })
    } };
  return { images, metadata };
}

function writeAtlas(directory, { images, metadata }) {
  fs.mkdirSync(directory, { recursive: true });
  const files = {};
  for (const [name, rgba] of Object.entries(images)) {
    const file = name + '.png';
    fs.writeFileSync(path.join(directory, file), PNG.encode(metadata.width, metadata.height, rgba, 4));
    files[name] = file;
  }
  fs.writeFileSync(path.join(directory, 'atlas.json'), JSON.stringify({ ...metadata, files }, null, 2) + '\n');
}

module.exports = { spriteAtlas, writeAtlas };
