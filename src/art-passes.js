/* Shared art-pixel buffer names and splat ownership rules for CPU and shader hosts. */
const ArtPasses = (() => {
  const channels = Object.freeze(['coverage', 'depth', 'normal', 'objectId', 'materialId', 'emission', 'splatId', 'position', 'objectPosition', 'protected', 'emissionDepth', 'motion', 'emissionMotion']);
  const cutoff = 0.5;
  const ownsSurface = (alpha, writesDepth, depth, nearest) => writesDepth && alpha > cutoff && depth <= nearest;
  const over = (value, below, alpha) => value * alpha + below * (1 - alpha);

  function select(request) {
    if (!request) return [];
    if (request === true) return channels;
    if (!Array.isArray(request) || request.some(channel => !channels.includes(channel)))
      throw new RangeError('Unknown art pass. Available passes: ' + channels.join(', '));
    return [...new Set(request)];
  }

  function subset(passes, selected) {
    const output = { w: passes.w, h: passes.h };
    for (const channel of selected) output[channel] = passes[channel];
    if (output.objectId) output.objects = passes.objects;
    if (output.materialId) output.materials = passes.materials;
    return output;
  }

  const glsl = `
bool inkOwnsSurface(float alpha, bool writesDepth, float depth, float nearestDepth) {
  return writesDepth && alpha > 0.5 && depth <= nearestDepth;
}
float inkCoverageOver(float alpha, float below) { return alpha + below * (1.0 - alpha); }
vec3 inkEmissionOver(vec3 emission, vec3 below, float alpha) {
  return emission * alpha + below * (1.0 - alpha);
}
`;

  return Object.freeze({ channels, select, subset, cutoff, ownsSurface, over, glsl });
})();
if (typeof module !== 'undefined') module.exports = ArtPasses;
