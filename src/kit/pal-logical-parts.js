/* A manufactured part can be split by clip planes, spans, and wrapped seams. */
(function (K) {
  const P = K.procedural || K.authoring;
  const empty = Object.freeze([]);
  const validKey = key => typeof key === 'string' && key.length > 0;

  function compile(parts, identify) {
    if (!Array.isArray(parts) || parts.length > 65536 || typeof identify !== 'function')
      throw Error('Logical parts need a bounded list of pieces and a key function');
    const byKey = new Map(), pieces = parts.slice();
    const keys = pieces.map((part, index) => {
      const key = identify(part, index);
      if (key == null) return null;
      if (!validKey(key)) throw Error('Part keys must be nonempty strings');
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(part);
      return key;
    });
    const groups = Object.freeze([...byKey].map(([key, fragments]) =>
      Object.freeze({ key, fragments: Object.freeze(fragments) })));

    function partition(hidden = []) {
      if ((!Array.isArray(hidden) && !(hidden instanceof Set)) || (hidden.length ?? hidden.size) > 65536)
        throw Error('Part exclusions need a bounded list of keys');
      const omit = new Set(hidden);
      for (const key of omit) if (!validKey(key)) throw Error('Part exclusions need nonempty keys');
      const visible = [], omitted = [];
      for (let i = 0; i < pieces.length; i++)
        (omit.has(keys[i]) ? omitted : visible).push(pieces[i]);
      return { visible, omitted };
    }

    return Object.freeze({ groups, get: key => byKey.get(key) || empty, partition });
  }

  P.logicalParts = Object.freeze({ compile });
})(KIT);
