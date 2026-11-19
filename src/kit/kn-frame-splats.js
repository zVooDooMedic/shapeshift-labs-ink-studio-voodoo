/* Frame-local splats for streaks and instances of small baked models. */
(function (K) {
  const { V, M, TAU } = K;
  const models = new WeakMap();
  const identity = M.id();
  const NO_DEPTH = 16,
    EMISSIVE = 32,
    GLASS = 256;
  const SNAPSHOT_STRIDE = 12;
  const finiteVector = (v, n) =>
    (Array.isArray(v) || ArrayBuffer.isView(v)) && v.length === n && Array.from(v).every(Number.isFinite);

  K.frameSplats = (B, capacity, render) => {
    if (!Number.isSafeInteger(capacity) || capacity <= 0 || typeof render !== 'function') {
      throw new Error('Frame splats need a positive integer capacity and a draw callback');
    }
    const pool = K.pool(B, capacity);
    const palette = B.P.map(([r, g, b]) => r + g * 256 + b * 65536);
    let stage = null,
      drawing = false,
      used = 0,
      previous = 0;

    function requireFrame() {
      if (!drawing) throw new Error('Frame splat commands are only available inside its draw callback');
    }

    function style({ width = 0.04, color = 1, rgb, density = 2, emissive = true }) {
      if (
        !(width > 0) ||
        !Number.isFinite(width) ||
        !(density >= 0) ||
        !Number.isFinite(density) ||
        (rgb === undefined ? !Number.isInteger(color) || color < 0 || color >= palette.length :
          !finiteVector(rgb, 3) || !Array.from(rgb).every(value => value >= 0 && value <= 1))
      ) {
        throw new Error('A stroke needs a positive width, a palette index and a nonnegative density');
      }
      const packed = rgb === undefined ? palette[color] :
        Math.round(rgb[0] * 255) + Math.round(rgb[1] * 255) * 256 + Math.round(rgb[2] * 255) * 65536;
      return { width, packed, density, flags: emissive ? NO_DEPTH | EMISSIVE : NO_DEPTH };
    }

    function putStreak(a, b, paint) {
      const delta = V.sub(b, a);
      const length = V.len(delta);
      const [x, y, z] = V.lerp(a, b, 0.5);
      const i = pool.first + used++;
      const axis = length > 1e-9 ? V.mul(delta, 1 / length) : null;
      pool.put(stage, i, x, y, z, paint.width, paint.packed, paint.density, axis, Math.max(paint.width, length / 2));
      // Restore stroke flags if this slot previously held a model.
      stage.D[i * 16 + 11] = paint.flags;
    }

    const draw = Object.freeze({
      point(position, options) {
        return draw.streak(position, position, options);
      },

      streak(a, b, options = {}) {
        requireFrame();
        if (!finiteVector(a, 3) || !finiteVector(b, 3)) throw new Error('A streak needs two finite endpoints');
        const paint = style(options);
        if (!paint.density) return true;
        if (used === capacity) return false;
        putStreak(a, b, paint);
        return true;
      },

      model(model, at, { matrix = identity, opacity = 1 } = {}) {
        requireFrame();
        const rows = models.get(model);
        if (
          !rows ||
          !finiteVector(at, 3) ||
          !finiteVector(matrix, 9) ||
          !Number.isFinite(opacity) ||
          opacity < 0 ||
          opacity > 1
        ) {
          throw new Error('A model instance needs a captured model, finite transform and opacity from 0 to 1');
        }
        if (!opacity) return true;
        if (used + model.count > capacity) return false;
        const D = stage.D;
        const transpose = M.tr(matrix);
        for (let r = 0; r < rows.length; r += SNAPSHOT_STRIDE) {
          const i = pool.first + used++;
          const o = i * 16;
          const [x, y, z] = M.app(matrix, rows.subarray(r, r + 3));
          D[o] = x + at[0];
          D[o + 1] = y + at[1];
          D[o + 2] = z + at[2];
          D[o + 3] = rows[r + 3] * opacity;
          const c00 = rows[r + 4],
            c01 = rows[r + 5],
            c02 = rows[r + 6];
          const c11 = rows[r + 8],
            c12 = rows[r + 9],
            c22 = rows[r + 10];
          const covariance = [c00, c01, c02, c01, c11, c12, c02, c12, c22];
          const C = M.mul(M.mul(matrix, covariance), transpose);
          D[o + 4] = C[0];
          D[o + 5] = C[1];
          D[o + 6] = C[2];
          D[o + 7] = rows[r + 7];
          D[o + 8] = C[4];
          D[o + 9] = C[5];
          D[o + 10] = C[8];
          D[o + 11] = rows[r + 11];
          stage.touch(i);
        }
        return true;
      },

      vortex(center, options = {}) {
        requireFrame();
        const {
          axis = [0, 1, 0],
          radius = [0.3, 1.2],
          height = 2,
          turns = 1,
          phase = 0,
          arms = 3,
          segments = 16
        } = options;
        const radii = typeof radius === 'number' ? [radius, radius] : radius;
        const axisLength = finiteVector(axis, 3) ? V.len(axis) : 0;
        if (
          !finiteVector(center, 3) ||
          !(axisLength > 1e-9) ||
          !Number.isFinite(axisLength) ||
          !finiteVector(radii, 2) ||
          radii[0] < 0 ||
          radii[1] < 0 ||
          ![height, turns, phase].every(Number.isFinite) ||
          !Number.isSafeInteger(arms) ||
          arms < 1 ||
          !Number.isSafeInteger(segments) ||
          segments < 1
        ) {
          throw new Error('A vortex needs finite geometry, a nonzero axis and positive integer arm and segment counts');
        }
        const paint = style(options);
        if (!paint.density) return true;
        if (used + arms * segments > capacity) return false;
        const up = V.mul(axis, 1 / axisLength);
        const side = V.perp(up);
        const across = V.cross(up, side);
        for (let arm = 0; arm < arms; arm++) {
          const start = phase + TAU * (arm / arms);
          let prev = V.mad(V.mad(center, side, radii[0] * Math.cos(start)), across, radii[0] * Math.sin(start));
          for (let j = 1; j <= segments; j++) {
            const u = j / segments;
            const angle = start + TAU * turns * u;
            const r = K.mix(radii[0], radii[1], u);
            const ring = V.mad(center, up, height * u);
            const p = V.mad(V.mad(ring, side, r * Math.cos(angle)), across, r * Math.sin(angle));
            putStreak(prev, p, paint);
            prev = p;
          }
        }
        return true;
      }
    });

    return {
      first: pool.first,
      count: capacity,
      bind(st) {
        if (stage) throw new Error('A frame splat system can only be attached once');
        if (pool.first + capacity > st.N) throw new Error('Allocate frame splats before finishing the world');
        stage = st;
      },
      update(dt, t, st) {
        if (stage !== st || !stage) throw new Error('Attach the frame splat system to a stage before drawing');
        if (drawing) throw new Error('A frame splat system cannot draw recursively');
        drawing = true;
        used = 0;
        try {
          render(draw, dt, t);
        } finally {
          for (let j = used; j < previous; j++) pool.hide(st, pool.first + j);
          previous = used;
          drawing = false;
        }
      }
    };
  };

  K.frameSplats.capture = (world, origin = [0, 0, 0]) => {
    if (
      !(world?.data instanceof Float32Array) ||
      !Number.isSafeInteger(world.count) ||
      world.count < 0 ||
      world.count * 16 > world.data.length ||
      !finiteVector(origin, 3)
    ) {
      throw new Error('Capture needs a baked world and a finite model origin');
    }
    const { data, count } = world;
    const visible = [];
    for (let i = 0; i < count; i++) if (data[i * 16 + 3] > 0) visible.push(i * 16);
    const rows = new Float32Array(visible.length * SNAPSHOT_STRIDE);
    for (let i = 0; i < visible.length; i++) {
      const r = i * SNAPSHOT_STRIDE;
      rows.set(data.subarray(visible[i], visible[i] + SNAPSHOT_STRIDE), r);
      for (let j = 0; j < 3; j++) rows[r + j] -= origin[j];
      // Retain the flags that render from the splat buffer alone.
      rows[r + 11] &= NO_DEPTH | EMISSIVE | GLASS;
    }
    const model = Object.freeze({ count: visible.length });
    models.set(model, rows);
    return model;
  };
})(KIT);
