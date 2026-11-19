/* Projected surface effects shared by the software renderer and browser hosts. */
const SplatEffects = (() => {
  const clamp = x => Math.min(1, Math.max(0, x));
  const fract = x => x - Math.floor(x);
  const vector = (value, n) => Array.isArray(value) && value.length === n && Array.from(value).every(Number.isFinite);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const subtract = (a, b) => a.map((value, i) => value - b[i]);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  function unit(v) {
    const length = Math.hypot(...v);
    if (!(length > 1e-8 && Number.isFinite(length))) throw new RangeError('Projection axes need distinct, nonzero directions');
    return v.map(x => x / length);
  }
  function smooth(lo, hi, value) {
    const x = clamp((value - lo) / (hi - lo));
    return x * x * (3 - 2 * x);
  }

  function project({ type = 'plane', origin = [0, 0, 0], along = [1, 0, 0], across = [0, 0, 1],
    up = [0, 1, 0], points, radius = 1 } = {}) {
    if (!vector(origin, 3) || !vector(along, 3) || !vector(across, 3) || !vector(up, 3))
      throw new TypeError('Projections need finite XYZ axes and origin');
    if (type === 'ribbon') {
      if (!Array.isArray(points) || points.length < 2 || points.length > 64 ||
          !Array.from(points).every(point => vector(point, 3)))
        throw new TypeError('Ribbon projection needs 2–64 world-space points');
      let length = 0;
      const segments = points.slice(1).map((end, i) => {
        const start = points[i].slice();
        const delta = subtract(end, start);
        const axis = unit(delta);
        const segment = {
          start, axis, cross: unit(cross(axis, up)), size: Math.hypot(...delta), at: length,
          first: i === 0, last: i === points.length - 2
        };
        length += segment.size;
        return segment;
      });
      return position => {
        let best = Infinity, u = 0, v = 0;
        for (const segment of segments) {
          const dx = position[0] - segment.start[0], dy = position[1] - segment.start[1], dz = position[2] - segment.start[2];
          const along = dx * segment.axis[0] + dy * segment.axis[1] + dz * segment.axis[2];
          const t = Math.max(0, Math.min(segment.size, along));
          const distance = (dx - t * segment.axis[0]) ** 2 + (dy - t * segment.axis[1]) ** 2 + (dz - t * segment.axis[2]) ** 2;
          if (distance >= best) continue;
          best = distance;
          u = segment.at + ((segment.first && along < 0) || (segment.last && along > segment.size) ? along : t);
          v = dx * segment.cross[0] + dy * segment.cross[1] + dz * segment.cross[2];
        }
        return [u, v];
      };
    }
    const x = unit(along);
    if (type === 'plane') {
      const z = unit(cross(cross(x, across), x));
      return position => {
        const q = subtract(position, origin);
        return [dot(q, x), dot(q, z)];
      };
    }
    if (type === 'cylinder') {
      if (!(Number.isFinite(radius) && radius > 0)) throw new RangeError('Cylinder projection needs a positive radius');
      const y = unit(up), z = unit(cross(y, x)), radial = cross(z, y);
      return position => {
        const q = subtract(position, origin);
        return [fract(Math.atan2(dot(q, z), dot(q, radial)) / (Math.PI * 2) + 1) * Math.PI * 2 * radius, dot(q, y)];
      };
    }
    throw new RangeError('Unknown projection: ' + type);
  }

  // Each motif produces a distance in one repeat, so the same footprint can
  // antialias a thin hatch and a broad contour without softening raster art.
  const line = x => Math.abs(fract(x + 0.5) - 0.5);
  const motifs = {
    stripes: (u, v) => line(v),
    hatch: (u, v) => Math.min(line(u + v), line(u - v)),
    chevrons: (u, v) => line(v + line(u)),
    rings: (u, v) => Math.abs(Math.hypot(fract(u) - 0.5, fract(v) - 0.5) - 0.27),
    dots: (u, v) => Math.hypot(fract(u) - 0.5, fract(v) - 0.5),
    checker: (u, v) => (Math.floor(u * 2) + Math.floor(v * 2)) & 1
  };

  function raster(spec = {}) {
    const { width, height, frames, fps = 1, channels = 4, repeat = false, wrap = false } = spec;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
        ![3, 4].includes(channels) || !Array.isArray(frames) || !frames.length ||
        width * height * frames.length > 2 ** 20 || !Number.isFinite(fps) || fps <= 0 ||
        typeof repeat !== 'boolean' || typeof wrap !== 'boolean')
      throw new TypeError('Raster effects need bounded RGB or RGBA frames and a positive frame rate');
    const pixels = Array.from(frames, frame => {
      if (!(Array.isArray(frame) || ArrayBuffer.isView(frame)) || frame.length !== width * height * channels ||
          !Array.from(frame).every(n => Number.isInteger(n) && n >= 0 && n <= 255))
        throw new TypeError('Raster frames need one RGB or RGBA byte tuple per pixel');
      return Uint8Array.from(frame);
    });
    return (u, v, time, result) => {
      if (!wrap && (u < 0 || v < 0 || u >= 1 || v >= 1)) return 0;
      const frame = Math.max(0, Math.floor(time * fps));
      const data = pixels[repeat ? frame % pixels.length : Math.min(frame, pixels.length - 1)];
      const q = (Math.floor(fract(v) * height) * width + Math.floor(fract(u) * width)) * channels;
      for (let k = 0; k < 3; k++) result[k] = data[q + k] / 255;
      return channels === 4 ? data[q + 3] / 255 : 1;
    };
  }

  function coordinates({ projection = {}, space = 'rest', field }, channels, context) {
    if (space !== 'rest' && space !== 'world') throw new TypeError('Projection space must be rest or world');
    const source = Object.hasOwn(context?.fields || {}, field) ? context.fields[field] : undefined;
    if ((field !== undefined || channels.length) && (!source || typeof source.frame !== 'function' || !Array.isArray(source.channels)))
      throw new RangeError('Unknown projected field: ' + field);
    for (const name of channels)
      if (!source.channels.includes(name)) throw new RangeError('Unknown field channel: ' + name);
    const mapping = typeof projection === 'function' ? projection : project(projection);
    let frame, frameTime, revision;
    return sample => {
      const uv = mapping(space === 'world' ? sample.worldPosition || sample.position : sample.position, sample);
      if (!uv || !Number.isFinite(uv[0]) || !Number.isFinite(uv[1])) return null;
      const time = sample.time || 0;
      if (source && (frameTime !== time || revision !== source.revision)) {
        frame = source.frame(time);
        frameTime = time;
        revision = source.revision;
      }
      const [u, v] = uv;
      return { u, v, at: name => frame?.sample(name, u, v) ?? 0 };
    };
  }

  function fieldMask(definition, context) {
    const { channel, range = [0, 1], invert = false } = definition;
    if (typeof channel !== 'string' || !vector(range, 2) || !(range[1] > range[0]))
      throw new TypeError('Field masks need a channel and increasing range');
    const lookup = coordinates(definition, [channel], context);
    return sample => {
      const loc = lookup(sample);
      const coverage = loc ? smooth(...range, loc.at(channel)) : 0;
      return invert ? 1 - coverage : coverage;
    };
  }

  function layer(definition, context, resolveColor) {
    const { projection = {}, space = 'rest', field, maskChannel, revealChannel, contourChannel,
      warpChannels, warp = 1, range = [0, 1], scroll = [0, 0], scale = 1, width = 0.16,
      pattern = 'solid', color, colors, outputPalette, ink = false } = definition;
    if (!['rest', 'world'].includes(space) || !vector(scroll, 2) || !vector(range, 2) || !(range[1] > range[0]) ||
        !Number.isFinite(scale) || scale <= 0 || !Number.isFinite(width) || width <= 0 ||
        !Number.isFinite(warp) || (warpChannels && (!Array.isArray(warpChannels) || warpChannels.length !== 2)))
      throw new TypeError('Projected layers need a valid space, scale, range and scroll');
    const channels = [maskChannel, revealChannel, contourChannel, ...(warpChannels || [])].filter(name => name !== undefined);
    const lookup = coordinates({ projection, space, field }, channels, context);
    if (pattern === 'contour' && !contourChannel) throw new TypeError('Contours need a contourChannel');
    const pixels = pattern === 'raster' ? raster(definition.raster) : null;
    const custom = typeof pattern === 'function' ? pattern :
      Object.hasOwn(context?.shaders || {}, pattern) ? context.shaders[pattern] : null;
    if (custom !== null && typeof custom !== 'function') throw new TypeError('A projected shader must be a function');
    if (!pixels && !custom && !['solid', 'contour'].includes(pattern) && !Object.hasOwn(motifs, pattern))
      throw new RangeError('Unknown projected pattern: ' + pattern);
    if (outputPalette !== undefined && (!Array.isArray(outputPalette) || !outputPalette.length ||
        outputPalette.length > 48 || !Array.from(outputPalette).every(value => value !== undefined)))
      throw new TypeError('Projected output palettes need 1–48 colors');
    if (colors !== undefined && (!Array.isArray(colors) || colors.length < 2 || !Array.from(colors).every(value => value !== undefined)))
      throw new TypeError('Projected color ramps need at least two colors');
    const palette = outputPalette?.map(resolveColor);
    const ramp = colors?.map(resolveColor);
    const tint = resolveColor(color);
    const result = new Float64Array(6); // RGB, amount, coverage, glint
    return {
      palette,
      reveals: revealChannel !== undefined || Boolean(custom),
      sample(sample, base) {
        result[0] = tint[0]; result[1] = tint[1]; result[2] = tint[2];
        result[3] = 0; result[4] = 1; result[5] = 0;
        const time = sample.time || 0;
        const coord = lookup(sample);
        if (!coord) {
          if (revealChannel) result[4] = 0;
          return result;
        }
        const { u, v, at } = coord;
        const x = (u + time * scroll[0] + (warpChannels ? at(warpChannels[0]) * warp : 0)) / scale;
        const y = (v + time * scroll[1] + (warpChannels ? at(warpChannels[1]) * warp : 0)) / scale;
        const mask = maskChannel ? smooth(...range, at(maskChannel)) : 1;
        const footprint = (sample.footprint || 0) / scale;
        result[4] = revealChannel ? smooth(...range, at(revealChannel)) : 1;
        let amount = 1;
        if (ramp) {
          const value = clamp(at(contourChannel || maskChannel || revealChannel));
          const t = value * (ramp.length - 1), low = Math.min(ramp.length - 2, Math.floor(t));
          for (let k = 0; k < 3; k++) result[k] = ramp[low][k] + (ramp[low + 1][k] - ramp[low][k]) * (t - low);
        }
        if (pixels) amount = pixels(x, y, time, result);
        else if (custom) {
          // Custom JS effects can set RGB, amount, coverage and glint in their sample.
          result[3] = 1;
          const returned = custom({ u, v, x, y, time, sample, base, field: at, settings: definition }, result);
          if (returned && typeof returned.then === 'function') throw new TypeError('Projected shaders must be synchronous');
          if (!result.every(Number.isFinite)) throw new TypeError('Projected shader outputs must be finite');
          amount = result[3];
        } else if (pattern !== 'solid') {
          const distance = pattern === 'contour' ? line(at(contourChannel) / scale) : motifs[pattern](x, y);
          amount = 1 - smooth(width * 0.5, width * 0.5 + Math.max(0.002, footprint * 0.5), distance);
        }
        result[3] = clamp(amount) * mask;
        if (ink) result[5] = Math.max(result[5], result[3]);
        return result;
      }
    };
  }

  return { project, layer, fieldMask, clamp, vector };
})();
if (typeof module !== 'undefined') module.exports = SplatEffects;
