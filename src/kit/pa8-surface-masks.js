/* Paint retained in unit chart coordinates and measured in the current chart metric. */
(function (K) {
  const P = K.procedural || K.authoring;
  const unit = value => Number.isFinite(value) && value >= 0 && value <= 1;

  function compile(strokes, { size, periodic = false } = {}) {
    if (!Array.isArray(size) || size.length !== 2 ||
        !size.every(length => Number.isFinite(length) && length > 0 && length <= 5e5) ||
        typeof periodic !== 'boolean')
      throw Error('Surface masks need a finite chart size');
    if (!Array.isArray(strokes) || strokes.length > 256)
      throw Error('Surface masks need at most 256 strokes');

    const [width, height] = size;
    const { wrap, delta } = P.periodicCoordinates;
    const sweep = P.masks?.stroke || (spec => P.brushFields.stroke({ id: spec.id, parameters: spec }));
    let pointCount = 0;
    const masks = strokes.map((spec, id) => {
      const { points, width: brushWidth, softness = 0, operation = 'add' } = spec || {};
      if (!['add', 'erase'].includes(operation) || !Array.isArray(points) || !points.length ||
          !points.every(point => Array.isArray(point) && point.length === 2 && point.every(unit)))
        throw Error('Surface strokes need unit chart points and an add or erase operation');
      pointCount += points.length;
      if (pointCount > 8192) throw Error('Surface masks exceed their point budget');

      const runs = [];
      const measure = (u, v) => [u * width, v * height];
      if (!periodic) runs.push(points.map(([u, v]) => measure(u, v)));
      else {
        // Join across the seam by the shortest step. Rebase at each chart turn so
        // queries only need the central copy and its two immediate neighbors.
        let [previous, heightAt] = points[0];
        let run = [measure(previous, heightAt)];
        for (const [u, v] of points.slice(1)) {
          const step = delta(u, previous);
          const current = previous + step;
          run.push(measure(current, v));
          previous = wrap(current);
          if (current < 0 || current >= 1) {
            runs.push(run);
            run = [measure(previous, v)];
          }
        }
        if (run.length > 1 || !runs.length) runs.push(run);
      }
      return {
        erase: operation === 'erase',
        runs: runs.map(points => sweep({ id: String(id), points, width: brushWidth, softness }))
      };
    });

    function weight(u, v, initial = 0) {
      if (!Number.isFinite(u) || !Number.isFinite(v) || !unit(initial))
        throw Error('Surface mask queries need finite chart coordinates and unit initial coverage');
      if (v < 0 || v > 1 || (!periodic && (u < 0 || u > 1))) return initial;
      const x = (periodic ? wrap(u) : u) * width;
      const y = v * height;
      let amount = initial;
      for (const { erase, runs } of masks) {
        let coverage = 0;
        for (const run of runs) {
          const { min, max } = run.bounds;
          if (y < min[2] || y > max[2]) continue;
          for (let shift = periodic ? -1 : 0; shift <= (periodic ? 1 : 0); shift++) {
            const at = x + shift * width;
            if (at >= min[0] && at <= max[0]) coverage = Math.max(coverage, run.weight([at, y]));
          }
          if (coverage === 1) break;
        }
        amount = erase ? amount * (1 - coverage) : amount + (1 - amount) * coverage;
      }
      return amount;
    }
    return Object.freeze({ weight });
  }
  P.surfaceMasks = Object.freeze({ compile });
})(KIT);
