const fs = require('node:fs');
const path = require('node:path');
const PNG = require('./png.js');
const { upscale } = require('./render.js');
const { channels } = require('../src/art-passes.js');

const byte = value => Math.round(Math.max(0, Math.min(1, value)) * 255);

function writePasses(directory, frame, scale = 1) {
  const passes = frame.passes;
  const manifest = { width: frame.w, height: frame.h, scale, rows: 'top-down', files: {} };
  if (passes.objects) manifest.objects = passes.objects;
  if (passes.materials) manifest.materials = passes.materials;
  let near = Infinity, far = -Infinity;
  if (passes.depth || passes.emissionDepth) {
    for (const depth of passes.depth || passes.emissionDepth) if (Number.isFinite(depth)) {
      near = Math.min(near, depth);
      far = Math.max(far, depth);
    }
    manifest.depth = Number.isFinite(near) ? { near, far } : null;
  }
  fs.mkdirSync(directory, { recursive: true });
  for (const channel of ['color', ...channels]) {
    if (channel === 'position' || channel === 'objectPosition') continue;
    const data = channel === 'color' ? frame.rgb : passes[channel];
    if (!data) continue;
    let rgb = data;
    if (channel !== 'color') {
      rgb = new Uint8Array(frame.w * frame.h * 3);
      for (let p = 0; p < frame.w * frame.h; p++) {
        const q = p * 3;
        if (channel === 'coverage' || channel === 'protected') rgb.fill(byte(data[p]), q, q + 3);
        else if (channel === 'depth') {
          if (Number.isFinite(data[p])) rgb.fill(byte(1 - .85 * (data[p] - near) / (far - near || 1)), q, q + 3);
        } else if (channel === 'normal') {
          if (data[q] || data[q + 1] || data[q + 2])
            for (let c = 0; c < 3; c++) rgb[q + c] = byte(data[q + c] * .5 + .5);
        } else if (channel === 'motion' || channel === 'emissionMotion') {
          rgb[q] = byte(.5 + data[p * 2] / 8);
          rgb[q + 1] = byte(.5 + data[p * 2 + 1] / 8);
        } else if (channel === 'emission') {
          for (let c = 0; c < 3; c++) rgb[q + c] = byte(data[q + c]);
        } else if (data[p]) {
          const hash = Math.imul(data[p], 0x9e3779b1);
          for (let c = 0; c < 3; c++) rgb[q + c] = 48 + ((hash >>> (8 * c)) & 191);
        }
      }
    }
    const image = scale === 1 ? { ...frame, rgb } : upscale({ ...frame, rgb }, scale);
    const file = channel + '.png';
    PNG.write(path.join(directory, file), image.w, image.h, image.rgb);
    manifest.files[channel] = file;
  }
  fs.writeFileSync(path.join(directory, 'passes.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

module.exports = { writePasses };
