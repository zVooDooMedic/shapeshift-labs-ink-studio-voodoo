/* Orientation-aware contact for bounded solids. */
(function (K) {
  const P = K.procedural || K.authoring, { V } = K;
  const epsilon = 1e-8;
  const vector = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
  const boxes = new WeakSet();

  function orientedBox(center, half, frame = [1,0,0,0,1,0,0,0,1]) {
    if (!vector(center) || !vector(half) || half.some(x => x <= 0) ||
      !Array.isArray(frame) || frame.length !== 9 || !frame.every(Number.isFinite))
      throw Error('An oriented box needs a center, positive half extents and an orthonormal frame');
    const axes = [0,1,2].map(i => [frame[i],frame[i+3],frame[i+6]]);
    if (axes.some((axis, i) => Math.abs(V.dot(axis,axis)-1) > epsilon ||
      axes.slice(0,i).some(other => Math.abs(V.dot(axis,other)) > epsilon)))
      throw Error('An oriented box needs an orthonormal frame');
    const extent = center.map((_, axis) => axes.reduce((sum, normal, i) => sum+Math.abs(normal[axis])*half[i],0));
    const bounds = { min:V.sub(center,extent),max:V.add(center,extent) };
    if (!bounds.min.every(Number.isFinite) || !bounds.max.every(Number.isFinite))
      throw Error('An oriented box needs finite world bounds');
    const box = P.data.freeze({ center:center.slice(),half:half.slice(),axes,bounds });
    boxes.add(box);
    return box;
  }

  function boxContact(a, b, tolerance = 0) {
    if (!boxes.has(a) || !boxes.has(b) || !Number.isFinite(tolerance) || tolerance < 0)
      throw Error('Box contact needs two oriented boxes and a nonnegative tolerance');
    for (let axis=0; axis<3; axis++)
      if (a.bounds.min[axis]-tolerance-epsilon>b.bounds.max[axis] ||
        b.bounds.min[axis]-tolerance-epsilon>a.bounds.max[axis]) return false;
    const delta = V.sub(b.center,a.center);
    function separated(axis) {
      const cells = a.half[0]*Math.abs(V.dot(a.axes[0],axis)) +
        a.half[1]*Math.abs(V.dot(a.axes[1],axis)) + a.half[2]*Math.abs(V.dot(a.axes[2],axis)) +
        b.half[0]*Math.abs(V.dot(b.axes[0],axis)) + b.half[1]*Math.abs(V.dot(b.axes[1],axis)) +
        b.half[2]*Math.abs(V.dot(b.axes[2],axis));
      return Math.abs(V.dot(delta,axis))>cells+tolerance+epsilon;
    }
    if (a.axes.some(separated) || b.axes.some(separated)) return false;
    for (const x of a.axes) for (const y of b.axes) {
      const axis = V.cross(x,y), length = V.len(axis);
      if (length>epsilon && separated(V.mul(axis,1/length))) return false;
    }
    return true;
  }

  Object.assign(P.contacts ||= {}, { orientedBox, boxContact });
})(KIT);
