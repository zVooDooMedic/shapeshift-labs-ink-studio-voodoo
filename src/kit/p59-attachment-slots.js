/* Stable attachment selection. A host supplies the frames and physical fit. */
(function (K) {
  const P = K.procedural || K.authoring, V = K.V;
  const name = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
  const vector = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
  const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const tags = value => Array.isArray(value) && value.length <= 32 && value.every(name);
  const unit = value => V.len(value) > 1e-8;
  const draw = (name, seed) => ((P.data.hash(name, seed) >>> 0) + 1) / 4294967297;

  function layout(slots, families, { seed = 0, fits = () => true, budget = 32768 } = {}) {
    if (!Array.isArray(slots) || slots.length > 1024 || !Array.isArray(families) || families.length > 128 ||
        !Number.isSafeInteger(seed) || typeof fits !== 'function' || !Number.isSafeInteger(budget) || budget < 1 || budget > 131072)
      throw Error('Attachment layout needs bounded slots, families and evaluation budget');

    const familyIds = new Set(), candidates = families.map(raw => {
      const { id, weight = 1, size, requires = [], data = null } = raw || {};
      if (!name(id) || familyIds.has(id) || !Number.isFinite(weight) || weight <= 0 ||
          !vector(size) || size.some(v => v <= 0) || !tags(requires)) throw Error('Invalid attachment family');
      familyIds.add(id);
      return P.data.freeze({ id, weight, size: size.slice(), requires: requires.slice(), data: P.data.clone(data) });
    });

    const ids = new Set(), frames = slots.map(raw => {
      const { id, point, normal, tangent, room, tags: labels = [], chance = 1, priority = 0, variant = 0, pin = null, data = null } = raw || {};
      if (!name(id) || ids.has(id) || ![point, normal, tangent].every(vector) || !unit(normal) ||
          !vector(room) || room.some(v => v < 0) || !tags(labels) || !Number.isFinite(chance) || chance < 0 || chance > 1 ||
          !Number.isFinite(priority) || !Number.isSafeInteger(variant) || pin !== null && !familyIds.has(pin))
        throw Error('Invalid attachment slot');
      ids.add(id);
      const n = V.norm(normal), along = V.mad(tangent, n, -V.dot(tangent, n));
      if (!unit(along)) throw Error('Attachment slot axes must span a frame');
      const t = V.norm(along);
      return P.data.freeze({ id, point: point.slice(), normal: n, tangent: t, bitangent: V.cross(n, t),
        room: room.slice(), tags: labels.slice(), chance, priority, variant, pin, data: P.data.clone(data) });
    }).sort((a, b) => b.priority - a.priority || order(a.id, b.id));

    let checks = 0;
    const placements = [];
    for (const slot of frames) {
      const local = P.data.hash(slot.id, seed ^ slot.variant);
      if (!slot.pin && draw('occupancy', local) >= slot.chance) continue;
      const compatible = candidates.filter(family => {
        if (++checks > budget) throw Error('Attachment layout exceeds its candidate budget');
        return (!slot.pin || slot.pin === family.id) && family.requires.every(tag => slot.tags.includes(tag)) &&
          family.size.every((v, i) => v <= slot.room[i]);
      }).map(family => ({ family, score: -Math.log(draw(family.id, local)) / family.weight }))
        .sort((a, b) => a.score - b.score || order(a.family.id, b.family.id));
      for (const { family } of compatible) {
        const proposal = P.data.freeze({ key: slot.id, slot, family, seed: P.data.hash(family.id, local) });
        if (!fits(proposal, placements.slice())) continue;
        placements.push(proposal);
        break;
      }
    }
    return P.data.freeze(placements);
  }

  P.attachments = Object.freeze({ layout });
})(KIT);
