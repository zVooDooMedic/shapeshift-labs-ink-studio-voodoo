/* Reserve upright, oriented volumes while laying out nearby candidates. */
(function (K) {
  const P = K.procedural || K.authoring;
  const vector = v => Array.isArray(v) && v.length === 3 && Array.from(v).every(Number.isFinite);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

  function createFootprintReservations({ clearance = 0, cellSize = 2 } = {}) {
    if (!Number.isFinite(clearance) || clearance < 0 || !Number.isFinite(cellSize) || cellSize <= 0)
      throw new Error('Footprint reservations need nonnegative clearance and a positive cell size');
    const cells = new Map(), large = [], occupied = [];

    function frame({ point, tangent, size } = {}) {
      if (![point, tangent, size].every(vector) || size.some(v => v <= 0))
        throw new Error('A reservation needs a finite point and positive dimensions');
      const length = Math.hypot(tangent[0], tangent[2]);
      if (length < 1e-8 || !Number.isFinite(length)) throw new Error('A reservation needs a horizontal tangent');
      const u = [tangent[0] / length, tangent[2] / length], v = [-u[1], u[0]];
      const half = [(size[0] + clearance) / 2, (size[2] + clearance) / 2];
      const extent = u.map((_, i) => half[0] * Math.abs(u[i]) + half[1] * Math.abs(v[i]));
      const center = [point[0], point[2]];
      return { center, axes: [u, v], half, low: point[1], high: point[1] + size[1],
        min: center.map((x, i) => x - extent[i]), max: center.map((x, i) => x + extent[i]) };
    }

    function keys(item) {
      const lo = item.min.map(v => Math.floor(v / cellSize)), hi = item.max.map(v => Math.floor(v / cellSize));
      if (![...lo, ...hi].every(Number.isSafeInteger) || (hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) > 128)
        return null;
      const result = [];
      for (let x = lo[0]; x <= hi[0]; x++) for (let z = lo[1]; z <= hi[1]; z++) result.push(x + '/' + z);
      return result;
    }

    const verticalOverlap = (a, b) => a.high > b.low && b.high > a.low;
    const axes = (a, b) => [...a.axes, ...b.axes];
    const radius = (item, axis) => Math.abs(dot(item.axes[0], axis)) * item.half[0] +
      Math.abs(dot(item.axes[1], axis)) * item.half[1];

    function intersects(a, b) {
      if (!verticalOverlap(a, b) || a.min.some((v, i) => v >= b.max[i] || b.min[i] >= a.max[i]))
        return false;
      const delta = a.center.map((v, i) => v - b.center[i]);
      return axes(a, b).every(axis => Math.abs(dot(delta, axis)) < radius(a, axis) + radius(b, axis));
    }

    function nearby(entries) {
      if (entries === null) return occupied;
      const found = new Set(large);
      for (const key of entries) for (const other of cells.get(key) || []) found.add(other);
      return found;
    }

    function fits(item, entries) {
      for (const other of nearby(entries)) if (intersects(item, other)) return false;
      return true;
    }

    function forbidden(a, b, direction) {
      if (!verticalOverlap(a, b)) return null;
      const delta = a.center.map((value, i) => value - b.center[i]);
      let low = -Infinity, high = Infinity;
      for (const axis of axes(a, b)) {
        const start = dot(delta, axis), rate = dot(direction, axis), limit = radius(a, axis) + radius(b, axis);
        if (!rate) {
          if (Math.abs(start) >= limit) return null;
          continue;
        }
        const first = (-limit - start) / rate, last = (limit - start) / rate;
        low = Math.max(low, Math.min(first, last));
        high = Math.min(high, Math.max(first, last));
        if (high <= low) return null;
      }
      return [low, high];
    }

    function freeIntervals(spec, tangent, range) {
      const length = vector(tangent) ? Math.hypot(tangent[0], tangent[2]) : 0;
      if (!Number.isFinite(length) || length < 1e-8 || !Array.isArray(range) || range.length !== 2 ||
          !range.every(Number.isFinite) || range[1] < range[0])
        throw new Error('Footprint intervals need a horizontal direction and finite ordered range');
      const item = frame(spec), direction = [tangent[0] / length, tangent[2] / length], [from, to] = range;
      const span = direction.map(component => [component * from, component * to]);
      const swept = { min: item.min.map((v, i) => v + Math.min(...span[i])),
        max: item.max.map((v, i) => v + Math.max(...span[i])) };
      const blocked = [];
      for (const other of nearby(keys(swept))) {
        const interval = forbidden(item, other, direction);
        if (interval && interval[0] < to && interval[1] > from) blocked.push(interval);
      }
      blocked.sort((a, b) => a[0] - b[0]);
      const open = [];
      let cursor = from;
      for (const [lo, hi] of blocked) {
        if (lo >= cursor) open.push([cursor, lo]);
        cursor = Math.max(hi, cursor);
        if (cursor > to) break;
      }
      if (cursor <= to) open.push([cursor, to]);
      return open;
    }

    function add(item, entries) {
      occupied.push(item);
      if (entries === null) large.push(item);
      else for (const key of entries) {
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(item);
      }
    }

    return Object.freeze({
      freeIntervals,
      fits(spec) { const item = frame(spec); return fits(item, keys(item)); },
      reserve(spec) {
        const item = frame(spec), entries = keys(item);
        if (!fits(item, entries)) return false;
        add(item, entries);
        return true;
      },
      occupy(spec) { const item = frame(spec); add(item, keys(item)); }
    });
  }

  P.createFootprintReservations = createFootprintReservations;
})(KIT);
