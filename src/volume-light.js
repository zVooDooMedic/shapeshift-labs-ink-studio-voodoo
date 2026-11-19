/* Front-to-back integration for a bounded density with optional single scattering. */
const VolumeLight = (() => {
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const vector = (value, name) => {
    if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite))
      throw new RangeError(name + ' expects a finite XYZ vector');
    return value.slice();
  };
  const number = (value, min, max, name) => {
    if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(name + ' is out of range');
    return value;
  };

  function lighting(settings, color, palette) {
    const { ambient = .35, sun, point, shadow } = settings || {};
    if (shadow !== undefined && typeof shadow !== 'function') throw new TypeError('Atmosphere shadow must be a ray query');
    let directional = null, local = null;
    if (sun) {
      const direction = vector(sun.direction, 'Sun direction'), length = Math.hypot(...direction);
      if (!length) throw new RangeError('Sun direction must be nonzero');
      directional = { direction: direction.map(v => v / length), rgb: color(sun.color ?? '#fff3dc', palette),
        intensity: number(sun.intensity ?? .7, 0, 64, 'Sun intensity'),
        distance: number(sun.distance ?? 20, .001, 1000, 'Sun shadow distance') };
    }
    if (point) local = { at: vector(point.at, 'Point light position'), rgb: color(point.color ?? '#ffd095', palette),
      intensity: number(point.intensity ?? 1, 0, 64, 'Point light intensity'),
      radius: number(point.radius ?? 3, .001, 1000, 'Point light radius') };
    return { ambient: number(ambient, 0, 64, 'Ambient light'), sun: directional, point: local, shadow };
  }

  function occluder(field, { bias = .025, step = .035, steps = 24, safety = .75 } = {}) {
    if (typeof field !== 'function' || !Number.isFinite(bias) || bias <= 0 || !Number.isFinite(step) || step <= 0 ||
        !Number.isSafeInteger(steps) || steps < 1 || steps > 256 || !Number.isFinite(safety) || safety <= 0 || safety > 1)
      throw new RangeError('Invalid density occluder settings');
    return (x, y, z, direction, stop) => {
      let distance = bias;
      for (let i = 0; i < steps && distance < stop; i++) {
        const d = field(x + direction[0] * distance, y + direction[1] * distance, z + direction[2] * distance);
        if (d < 0) return true;
        distance += Math.max(step, d * safety);
      }
      return false;
    };
  }

  function mediumColor(volume, density) {
    const { ramp, rgb } = volume;
    if (!ramp) return rgb;
    return ramp[Math.min(ramp.length - 1, Math.floor(density * ramp.length))];
  }

  const phase = (g, cosine) => (1 - g * g) / Math.pow(1 + g * g - 2 * g * cosine, 1.5);
  function illuminate(volume, output, x, y, z, direction, media) {
    const { ambient, sun, point, shadow } = media;
    output.fill(ambient);
    if (sun && sun.intensity && (!shadow || !shadow(x, y, z, sun.direction, sun.distance))) {
      const amount = sun.intensity * phase(volume.anisotropy, dot(direction, sun.direction));
      for (let i = 0; i < 3; i++) output[i] += sun.rgb[i] * amount;
    }
    if (point?.intensity) {
      const dx = point.at[0] - x, dy = point.at[1] - y, dz = point.at[2] - z;
      const range = Math.hypot(dx, dy, dz);
      if (range < point.radius && range > 1e-6) {
        const toLight = [dx / range, dy / range, dz / range];
        if (!shadow || !shadow(x, y, z, toLight, range)) {
          const amount = point.intensity * (1 - range / point.radius) ** 2 * phase(volume.anisotropy, dot(direction, toLight));
          for (let i = 0; i < 3; i++) output[i] += point.rgb[i] * amount;
        }
      }
    }
  }

  function integrate(segments, origin, direction, stop, result, options = {}) {
    const { time = 0, media, maxSteps = 64, stepScale = 1, jitter = .5, skip = true } = options;
    const active = new Set(), rgb = [0, 0, 0], light = [1, 1, 1];
    result[0] = result[1] = result[2] = 0;
    result[3] = 1;
    let last = 0;
    function blend(density, length) {
      if (density <= 0) return;
      const alpha = -Math.expm1(-density * length);
      const contribution = result[3] * alpha / density;
      for (let k = 0; k < 3; k++) result[k] += contribution * rgb[k];
      result[3] *= 1 - alpha;
    }
    const entry = segments[0]?.[0] ?? 0;
    const rateFloor = (Math.min(stop, segments.at(-1)?.[0] ?? stop) - entry) / maxSteps;
    for (const [end, volume, sign] of segments) {
      if (result[3] < .001) break;
      if (active.size && end > last) {
        let minStep = Infinity;
        for (const v of active) if (v.type === 'field') minStep = Math.min(minStep, v.step * stepScale);
        if (minStep === Infinity) {
          let density = 0;
          rgb.fill(0);
          for (const v of active) {
            density += v.density;
            for (let k = 0; k < 3; k++) rgb[k] += v.density * v.rgb[k];
          }
          blend(density, end - last);
        } else {
          const step = Math.max(minStep, rateFloor);
          for (let t = last; t < end && result[3] >= .001;) {
            const distance = Math.min(end - t, step);
            if (t + distance === t) break;
            const depth = t + distance * jitter;
            const x = origin[0] + depth * direction[0], y = origin[1] + depth * direction[1], z = origin[2] + depth * direction[2];
            let density = 0, advance = Infinity;
            rgb.fill(0);
            for (const v of active) {
              if (v.type !== 'field') {
                advance = 0;
                density += v.density;
                for (let k = 0; k < 3; k++) rgb[k] += v.density * v.rgb[k];
                continue;
              }
              const gap = skip && v.field.skip ? v.field.skip(origin[0] + t * direction[0], origin[1] + t * direction[1],
                origin[2] + t * direction[2], direction, time) : 0;
              if (gap >= distance) {
                advance = Math.min(advance, gap);
                continue;
              }
              advance = 0;
              const value = v.field.sample(x, y, z, time, options);
              const extinction = value * v.density;
              if (!extinction) continue;
              density += extinction;
              const base = mediumColor(v, value);
              if (v.lit && media) illuminate(v, light, x, y, z, direction, media);
              else light.fill(1);
              for (let k = 0; k < 3; k++)
                rgb[k] += extinction * (base[k] * light[k] + v.emissiveRgb[k] * v.emissiveGain);
            }
            blend(density, distance);
            // Round to the same step grid so skipping agrees with dense integration.
            t += advance > distance ? Math.min(end - t, Math.max(1, Math.floor(advance / step)) * step) : distance;
          }
        }
      }
      if (sign > 0) active.add(volume);
      else active.delete(volume);
      last = end;
    }
    return result;
  }

  function history({ weight = .55, depthTolerance = .08, maxGap = .14 } = {}) {
    number(weight, 0, .95, 'Volume history weight');
    number(depthTolerance, 0, 10, 'Volume history depth tolerance');
    number(maxGap, .001, 10, 'Volume history time gap');
    let last;
    return {
      filter(color, depth, time, key) {
        if (last && last.key === key && time > last.time && time - last.time <= maxGap && last.depth.length === depth.length) {
          for (let p = 0; p < depth.length; p++) {
            const dz = depth[p] === last.depth[p] ? 0 : Math.abs(depth[p] - last.depth[p]);
            // A sharp change in transmittance signals disocclusion or a fast density change.
            if (dz > depthTolerance || Math.abs(color[p * 4 + 3] - last.color[p * 4 + 3]) > .18) continue;
            for (let c = 0; c < 4; c++) {
              const i = p * 4 + c;
              color[i] += (last.color[i] - color[i]) * weight;
            }
          }
        }
        last = { time, key, depth: depth.slice(), color: color.slice() };
        return color;
      },
      clear() { last = undefined; }
    };
  }

  return Object.freeze({ lighting, occluder, integrate, history });
})();
if (typeof module !== 'undefined') module.exports = VolumeLight;
