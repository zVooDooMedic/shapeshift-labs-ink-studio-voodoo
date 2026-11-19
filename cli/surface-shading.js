// Bind the common shader to the software renderer's camera and splat buffers.
const SurfaceLook = require('../src/surface-look.js');

function surfaceShading(world, options, camera) {
  if (options.surface === false || !world.surfaceData || !world.surfaces?.length) return null;
  const { data, surfaceData } = world;
  const stageBase = world.anim?.base;
  const rest = stageBase instanceof Float32Array && stageBase.length >= data.length ? stageBase : world.rest || data;
  const rig = world.anim?.rig;
  const rigFrames = new Map();
  const projected = i => materials[surfaceData[i * STRIDE] - 1]?.projected;

  function rigFrame(i) {
    const part = rig?.bid[i];
    if (!part || rig.free?.[i] || !projected(i)) return null;
    if (!rigFrames.has(part)) {
      const { M } = require('../index.js').load().KIT;
      const matrix = rig.M.subarray(part * 12, part * 12 + 9);
      if (Math.abs(M.det(matrix)) < 1e-8) return null;
      const inverse = M.inv(matrix);
      rigFrames.set(part, { inverse, normal: M.tr(inverse), apply: M.app });
    }
    return rigFrames.get(part);
  }
  const { eye, parallel, footprint, time, reflection } = camera;
  const { STRIDE } = SurfaceLook;
  const liveLight = world.surfaceLight === undefined ? undefined : SurfaceLook.prepareLightTrack(world.surfaceLight)(time);
  const materials = world.surfaces.map(({ settings, light }) =>
    SurfaceLook.prepare(settings, world.pal, liveLight ?? light, world.surfaceEffects));
  const ids = new Map();
  const palettes = [];
  for (const material of materials) {
    for (const { effect } of material.layers) {
      if (!effect?.palette) continue;
      palettes.push(effect.palette);
      ids.set(effect.palette, palettes.length);
    }
  }
  const planarMaterials = materials.map(
    material =>
      reflection && material.layers.some(layer => layer.type === 'planarReflection' && reflection.has(layer.plane))
  );
  const sample = {
    position: [0, 0, 0],
    worldPosition: [0, 0, 0],
    normal: [0, 0, 0],
    view: [0, 0, 0],
    footprint,
    time,
    visibility: 1
  };
  const rgb = [0, 0, 0];
  const result = [0, 0, 0, 1, 0];
  const rotation = i => {
    const offset = i * 16;
    return Math.round(data[offset + 11]) % 16 === 5 ? time * data[offset + 13] : 0;
  };
  const has = i => surfaceData[i * STRIDE] > 0;

  function normalAt(i, normal) {
    const angle = rotation(i);
    if (!angle) return normal;
    const c = Math.cos(angle),
      s = Math.sin(angle);
    return [c * normal[0] + s * normal[2], normal[1], c * normal[2] - s * normal[0]];
  }

  function planar(i) {
    return !!planarMaterials[surfaceData[i * STRIDE] - 1];
  }

  function surfaceNormal(i) {
    const offset = i * STRIDE;
    const normal = [surfaceData[offset + 1], surfaceData[offset + 2], surfaceData[offset + 3]];
    const frame = rigFrame(i);
    return normalAt(i, frame ? frame.apply(frame.normal, normal) : normal);
  }

  function shade(i, x, y, z, centerX, centerY, centerZ, r, g, b, sx, sy) {
    const offset = i * STRIDE;
    const { position, normal, view } = sample;
    const prepared = materials[surfaceData[offset] - 1];
    const dab = i * 16;
    const dx = x - centerX,
      dz = z - centerZ;
    const angle = rotation(i);
    const c = Math.cos(angle),
      s = Math.sin(angle);
    const source = prepared.projected ? rest : data;
    const frame = rigFrame(i);
    const ox = c * dx - s * dz, oy = y - centerY, oz = s * dx + c * dz;
    if (frame) {
      const offsetFromCenter = frame.apply(frame.inverse, [ox, oy, oz]);
      for (let k = 0; k < 3; k++) position[k] = source[dab + k] + offsetFromCenter[k];
    } else {
      position[0] = source[dab] + ox;
      position[1] = source[dab + 1] + oy;
      position[2] = source[dab + 2] + oz;
    }
    sample.worldPosition[0] = x;
    sample.worldPosition[1] = y;
    sample.worldPosition[2] = z;
    normal[0] = surfaceData[offset + 1];
    normal[1] = surfaceData[offset + 2];
    normal[2] = surfaceData[offset + 3];
    sample.visibility = surfaceData[offset + 4];
    const tx = surfaceData[offset + 5],
      ty = surfaceData[offset + 6],
      tz = surfaceData[offset + 7];
    sample.tangent = tx || ty || tz ? [tx, ty, tz] : undefined;
    const vx = parallel ? parallel[0] : eye[0] - x;
    const vz = parallel ? parallel[2] : eye[2] - z;
    view[0] = c * vx - s * vz;
    view[1] = parallel ? parallel[1] : eye[1] - y;
    view[2] = s * vx + c * vz;
    const [lx, ly, lz] = prepared.sun;
    sample.lightDirection = angle ? [c * lx - s * lz, ly, s * lx + c * lz] : undefined;
    if (frame) {
      const localView = frame.apply(frame.inverse, view);
      for (let k = 0; k < 3; k++) view[k] = localView[k];
      const ray = frame.apply(frame.inverse, sample.lightDirection || prepared.sun);
      const length = Math.hypot(...ray);
      sample.lightDirection = ray.map(x => x / length);
    }
    sample.reflection =
      planar(i) && sx !== undefined
        ? (layer, n, original) => {
            const dx = n[0] - original[0],
              dz = n[2] - original[2];
            return reflection(layer, sx, sy, c * dx + s * dz, n[1] - original[1], c * dz - s * dx);
          }
        : undefined;
    rgb[0] = r;
    rgb[1] = g;
    rgb[2] = b;
    SurfaceLook.shade(prepared, sample, rgb, result);
    if (ids.size) result[5] = ids.get(result[5]) || 0;
    return result;
  }

  return {
    has, normalAt, surfaceNormal, planar, shade, palettes,
    projected,
    reveals: i => materials[surfaceData[i * STRIDE] - 1]?.reveals
  };
}

module.exports = surfaceShading;
