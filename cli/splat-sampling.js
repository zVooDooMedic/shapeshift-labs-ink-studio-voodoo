const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

function opacity(logWeight, gain, hard) {
  if (logWeight < -4.5 || logWeight > 0) return 0;
  const gaussian = gain * Math.exp(logWeight);
  if (!hard) return Math.min(.99, gaussian);
  const blend = clamp((gaussian - .38) / .24, 0, 1);
  return .99 * blend * blend * (3 - 2 * blend);
}

function footprint(dx, dy, k0, k1, k2, gain, hard) {
  let total = 0;
  for (const v of [-.25, .25]) for (const u of [-.25, .25]) {
    const x = dx + u, y = dy + v;
    total += opacity(-.5 * (k0 * x * x + k2 * y * y) - k1 * x * y, gain, hard);
  }
  return total * .25;
}

function sampledDepth(ray, normal, center, depth, reach) {
  if (!normal) return depth;
  const { direction, origin, axial } = ray;
  const facing = normal[0] * direction[0] + normal[1] * direction[1] + normal[2] * direction[2];
  if (Math.abs(facing) < .025) return depth;
  const distance = (normal[0] * (center[0] - origin[0]) + normal[1] * (center[1] - origin[1]) +
    normal[2] * (center[2] - origin[2])) / facing;
  return distance > 0 ? depth + clamp(axial * distance - depth, -reach, reach) : depth;
}
module.exports = { footprint, sampledDepth };
