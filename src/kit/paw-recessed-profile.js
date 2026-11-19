/* A closed extrusion with a blind recess, sharing its sampled ring edges. */
(function (K) {
  const P = K.procedural || K.authoring, EPS = 1e-9, TAU = Math.PI * 2;
  const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
  const point = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);

  function ring(raw, center) {
    if (!Array.isArray(raw) || raw.length < 3 || raw.length > 256 || !Array.from(raw).every(point))
      throw new Error('Recessed profiles need 3 to 256 finite points per ring');
    const vertices = raw.map(([x, y]) => [x - center[0], y - center[1]]);
    const turn = vertices.map((p, i) => cross(p, vertices[(i + 1) % vertices.length]));
    if (turn.some(t => !Number.isFinite(t) || Math.abs(t) <= EPS || Math.sign(t) !== Math.sign(turn[0])))
      throw new Error('Profile center must see every edge from inside');
    if (turn[0] < 0) vertices.reverse();
    let sweep = 0;
    for (const [i, a] of vertices.entries()) {
      const b = vertices[(i + 1) % vertices.length];
      sweep += Math.atan2(cross(a, b), a[0] * b[0] + a[1] * b[1]);
    }
    if (Math.abs(sweep - TAU) > 1e-6) throw new Error('Recessed profile edges must make one turn around the center');
    return vertices;
  }

  function onRay(ring, direction) {
    for (const [i, a] of ring.entries()) {
      const b = ring[(i + 1) % ring.length], edge = [b[0] - a[0], b[1] - a[1]];
      const denominator = cross(direction, edge);
      if (denominator <= 0) continue;
      const t = cross(a, direction) / denominator;
      if (t < -EPS || t > 1 + EPS) continue;
      if (t <= EPS) return a;
      if (t >= 1 - EPS) return b;
      return [a[0] + edge[0] * t, a[1] + edge[1] * t];
    }
    throw new Error('Profile ray must meet its boundary');
  }

  function recessedProfile({ outline, recess, center = [0, 0], span, inset }) {
    if (!point(center) || !point(span) || !Number.isFinite(inset) || inset <= EPS || span[1] - span[0] - inset <= EPS)
      throw new Error('A recessed profile needs a finite center, an ordered span and backing thickness');
    const outer = ring(outline, center), inner = ring(recess, center), back = span[0], front = span[1], floor = front - inset;
    const directions = [...outer, ...inner].map(p => {
      const theta = Math.atan2(p[1], p[0]);
      return theta < 0 ? theta + TAU : theta;
    }).sort((a, b) => a - b);
    const stations = directions.filter((theta, i) => i === 0 || theta - directions[i - 1] > EPS);
    if (stations[0] + TAU - stations.at(-1) <= EPS) stations.pop();
    const bands = stations.map(theta => {
      const direction = [Math.cos(theta), Math.sin(theta)], outside = onRay(outer, direction), inside = onRay(inner, direction);
      if (Math.hypot(...outside) <= Math.hypot(...inside) + EPS)
        throw new Error('Recess must lie strictly inside the exterior profile');
      return [outside, inside].map(([x, y]) => [x + center[0], y + center[1]]);
    });
    const pivot = center.slice(), exterior = P.geometry.profileDistance(outer), cavity = P.geometry.profileDistance(inner);
    const bounds = {
      min: [Math.min(...outline.map(p => p[0])), Math.min(...outline.map(p => p[1])), back],
      max: [Math.max(...outline.map(p => p[0])), Math.max(...outline.map(p => p[1])), front]
    };
    function distance([x, y, z]) {
      const u = x - pivot[0], v = y - pivot[1];
      return Math.max(exterior(u, v), back - z, z - front, Math.min(-cavity(u, v), z - floor));
    }

    function faces(triangle, quad) {
      for (const [i, [a, b]] of bands.entries()) {
        const [c, d] = bands[(i + 1) % bands.length];
        const oa = [...a, front], oc = [...c, front], ib = [...b, front], id = [...d, front];
        const ba = [...a, back], bc = [...c, back], fb = [...b, floor], fd = [...d, floor];
        quad(oa, oc, id, ib);
        quad(oa, ba, bc, oc);
        quad(ib, id, fd, fb);
        triangle([...pivot, back], bc, ba);
        triangle([...pivot, floor], fb, fd);
      }
    }
    function mesh(meta) {
      const builder = P.geometry.builder();
      faces((a, b, c) => builder.triangle(a, b, c, meta),
        (a, b, c, d) => builder.quad(a, b, c, d, meta));
      return builder.finish();
    }
    function sample(spacing, emit) {
      if (!Number.isFinite(spacing) || spacing <= 0 || typeof emit !== 'function')
        throw new Error('Profile sampling needs positive spacing and a callback');
      let count = 0;
      function triangle(a, b, c) {
        const n = Math.max(1, Math.ceil(Math.max(K.V.dist(a, b), K.V.dist(b, c), K.V.dist(c, a)) / spacing));
        count += (n + 1) * (n + 2) / 2;
        if (count > 1000000) throw new RangeError('Profile sampling exceeds its work budget');
        for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
          emit(a.map((v, k) => v + (b[k] - v) * i / n + (c[k] - v) * j / n));
        }
      }
      faces(triangle, (a, b, c, d) => { triangle(a, b, c); triangle(a, c, d); });
    }
    return Object.freeze({ bounds: P.data.freeze(bounds), distance, mesh, sample });
  }

  P.geometry.recessedProfile = recessedProfile;
})(KIT);
