/* A deterministic withdrawal order for retained samples. The packed rank is
   independent of the low motion bits and stays exact in a Float32. */
const SampleCoverage = (() => {
  const bins = 128, stride = 65536, enabled = 32768;

  function cohort(x, y, z, spacing, seed) {
    if (![x, y, z, spacing, seed].every(Number.isFinite) || spacing <= 0)
      throw new RangeError('Coverage cohorts need finite coordinates, seed and positive spacing');
    const h = Math.imul(Math.floor(x / spacing), 0x7feb352d) ^
      Math.imul(Math.floor(y / spacing), 0x846ca68b) ^
      Math.imul(Math.floor(z / spacing), 0x9e3779b9) ^ seed;
    const mixed = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    return ((mixed ^ (mixed >>> 16)) >>> 0) % bins;
  }

  function pack(rank) {
    if (!Number.isInteger(rank) || rank < 0 || rank >= bins)
      throw new RangeError('Sample coverage rank must be between 0 and ' + (bins - 1));
    return enabled + rank * stride;
  }

  function amount(value) {
    if (!Number.isFinite(value) || value < 0 || value > 1)
      throw new RangeError('Sample withdrawal amount must be between 0 and 1');
    return value;
  }

  function visible(code, withdrawal) {
    return !(code & enabled) || withdrawal < (Math.floor(code / stride) + .5) / bins;
  }

  const glsl = `
bool sampleCoverageVisible(int code, float withdrawal) {
  return (code & ${enabled}) == 0 || withdrawal < (float(code / ${stride}) + 0.5) / ${bins}.0;
}
`;
  return Object.freeze({ bins, enabled, cohort, pack, amount, visible, glsl });
})();
if (typeof module !== 'undefined') module.exports = SampleCoverage;
