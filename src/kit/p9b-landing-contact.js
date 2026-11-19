/* Fit a shared exterior datum across the width and depth of a landing. */
(function (K) {
  const P = K.procedural || K.authoring;
  const { freeze } = P.data;
  const vector = value => Array.isArray(value) && value.length === 3 &&
    Array.from(value).every(Number.isFinite);

  function create({ sill, facing, width, near = .045, far = .27,
    fraction = .84, verticalTolerance = .18, elevationSpread = .065 } = {}) {
    if (!vector(sill) || !vector(facing) ||
      ![width, near, far, fraction, verticalTolerance, elevationSpread].every(Number.isFinite) ||
      width <= 0 || near < 0 || far <= near || fraction <= 0 || fraction > 1 ||
      verticalTolerance < 0 || elevationSpread < 0)
      throw Error('Landing contact needs finite geometry and ordered clearances');
    const length = Math.hypot(facing[0], facing[2]);
    if (length < 1e-8) throw Error('A landing contact needs a horizontal facing direction');
    const [x,y,z] = sill, dx = facing[0] / length, dz = facing[2] / length,
      side = width * fraction / 2, points = [];
    for (const depth of [near, far])
      for (const across of [-side, 0, side])
        points.push([x + dx * depth - dz * across, z + dz * depth + dx * across]);
    const low = y - verticalTolerance, high = y + verticalTolerance;
    const bounds = {
      min: [Math.min(...points.map(p => p[0])), low, Math.min(...points.map(p => p[1]))],
      max: [Math.max(...points.map(p => p[0])), high, Math.max(...points.map(p => p[1]))]
    };
    if (![...bounds.min, ...bounds.max].every(Number.isFinite))
      throw Error('Landing contact bounds must be finite');

    function match(candidates) {
      if (!Array.isArray(candidates)) throw Error('Landing contact needs floor candidates');
      let result = null, best = Infinity;
      for (const candidate of candidates) {
        if (!candidate || typeof candidate.id !== 'string' || !candidate.id ||
            typeof candidate.height !== 'function')
          throw Error('Floor candidates need a stable ID and an XZ height sampler');
        let min = Infinity, max = -Infinity;
        for (const [px,pz] of points) {
          const height = candidate.height(px,pz);
          if (height == null) { max = Infinity; break; }
          if (!Number.isFinite(height)) throw Error('Floor heights must be finite');
          if (height < low || height > high) { max = Infinity; break; }
          min = Math.min(min, height);
          max = Math.max(max, height);
          if (max - min > elevationSpread) break;
        }
        const span = max - min, gap = Math.abs(max - y);
        if (!Number.isFinite(max) || span > elevationSpread ||
          gap > best || gap === best && result && result.id <= candidate.id) continue;
        best = gap;
        result = { id:candidate.id, height:max, range:[min,max] };
      }
      return result && freeze(result);
    }
    return Object.freeze({ bounds:freeze(bounds), points:freeze(points), match });
  }

  P.landingContact = Object.freeze({ create });
})(KIT);
