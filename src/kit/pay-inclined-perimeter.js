/* Horizontal offset of the swept cross-section of an affine extrusion. */
(function (K) {
  const P = K.procedural || K.authoring, EPS = 1e-8;
  const vector = (p, n) => Array.isArray(p) && p.length === n && Array.from(p).every(Number.isFinite);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

  function inclinedPerimeter(outline, pose, { offset = 0, below = 0, above = 0 } = {}) {
    if (!Array.isArray(outline) || outline.length < 3 || outline.length > 256 ||
      !Array.from(outline).every(q => vector(q, 2)) ||
      !vector(pose?.R, 9) || !vector(pose?.t, 3) ||
      ![offset, below, above].every(value => Number.isFinite(value) && value >= 0))
      throw new Error('An inclined perimeter needs a convex outline, an affine frame and nonnegative clearance');
    const R = pose.R, origin = pose.t.slice(), datum = origin[1], axis = Math.hypot(R[1], R[4], R[7]);
    if (!Number.isFinite(axis) || R[4] < EPS || R[4] < .2 * axis)
      throw new RangeError('Extrusion axis is too close to horizontal');
    const drift = [R[1] / R[4], R[7] / R[4]];
    function project([x, y, z]) {
      return [x - drift[0] * (y - datum), datum, z - drift[1] * (y - datum)];
    }
    function lift([x, , z], y) {
      return [x + drift[0] * (y - datum), y, z + drift[1] * (y - datum)];
    }
    const points = outline.map(([x, z]) => {
      const y = R[3] * x + R[5] * z;
      return [origin[0] + R[0] * x + R[2] * z - drift[0] * y,
        origin[2] + R[6] * x + R[8] * z - drift[1] * y];
    });
    const base = points[0], area = points.reduce((sum, [x, z], i) => {
      const b = points[(i + 1) % points.length];
      return sum + (x - base[0]) * (b[1] - base[1]) - (z - base[1]) * (b[0] - base[0]);
    }, 0);
    if (!Number.isFinite(area) || Math.abs(area) < EPS) throw Error('Inclined perimeter has no finite area');
    const winding = Math.sign(area);
    const edges = points.map((a, i) => {
      const b = points[(i + 1) % points.length], dx = b[0] - a[0], dz = b[1] - a[1],
        length = Math.hypot(dx, dz);
      if (length <= EPS) throw Error('Inclined perimeter has a repeated vertex');
      const n = [winding * dz / length, -winding * dx / length], speed = dot(n, drift);
      if (points.some(p => dot(n, [p[0] - a[0], p[1] - a[1]]) > EPS))
        throw Error('Inclined perimeter must be convex');
      return { a, n, pad: offset + Math.max(0, -below * speed, above * speed) };
    });
    const poly = edges.map(({ a, n, pad }, i) => {
      const previous = edges[(i + edges.length - 1) % edges.length], m = previous.n,
        sum = [n[0] + m[0], n[1] + m[1]], delta = [n[0] - m[0], n[1] - m[1]],
        cosine = dot(sum, sum) / 2, sine = dot(delta, delta) / 2;
      if (cosine < .0008) throw Error('Inclined perimeter offset is too acute');
      const normal = (pad + previous.pad) / (2 * cosine);
      const tangent = sine > EPS * EPS ? (pad - previous.pad) / (2 * sine) : 0;
      return [a[0] + normal * sum[0] + tangent * delta[0], datum,
        a[1] + normal * sum[1] + tangent * delta[1]];
    });
    const raw = points.map(([x, z]) => [x, datum, z]);

    function crossing(a, b, tolerance) {
      let lo = 0, hi = 1;
      for (const { a: q, n, pad } of edges) {
        const u = n[0] * (a[0] - q[0]) + n[1] * (a[2] - q[1]) - pad + tolerance,
          v = n[0] * (b[0] - q[0]) + n[1] * (b[2] - q[1]) - pad + tolerance;
        if (u >= 0 && v >= 0) return false;
        if (u >= 0) lo = Math.max(lo, u / (u - v));
        if (v >= 0) hi = Math.min(hi, u / (u - v));
        if (lo >= hi - EPS) return false;
      }
      return true;
    }
    function allows(guide, tolerance = 1e-6) {
      if (!Array.isArray(guide) || !guide.length || !Array.from(guide).every(p => vector(p, 3)) ||
        !Number.isFinite(tolerance) || tolerance < 0)
        throw Error('An inclined clearance check needs guide vertices and a nonnegative tolerance');
      let a = project(guide[0]);
      for (let i = 0; i < guide.length; i++) {
        const b = i ? project(guide[i]) : a;
        if (crossing(a, b, tolerance)) return false;
        a = b;
      }
      return true;
    }
    return Object.freeze({ raw: P.data.freeze(raw), poly: P.data.freeze(poly), project, lift, allows });
  }

  P.geometry.inclinedPerimeter = inclinedPerimeter;
})(KIT);
