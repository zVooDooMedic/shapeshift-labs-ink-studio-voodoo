const { test } = require('node:test');
const assert = require('node:assert/strict');
const { KIT } = require('..').load();
const { clipConvexFaces } = KIT.procedural.geometry;
const { V } = KIT;

const points = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]
];
const faces = KIT.procedural.pieces.boxFaces.map((face, tag) => ({ points: face.map(i => points[i]), tag }));

test('face clipping keeps quad faces whole and produces a single outward cap for each cut', () => {
  const planes = [{ normal: [2, 0, 0], offset: 0, tag: 'x' }, { normal: [0, 1, 0], offset: .2 }];
  const result = clipConvexFaces(faces, planes, { capTag: 'top' });
  assert.equal(result.length, 6);
  assert(result.every(face => face.points.length === 4));
  for (const [tag, normal] of [['x', [1, 0, 0]], ['top', [0, 1, 0]]]) {
    const [a, b, c] = result.find(face => face.tag === tag).points;
    assert(V.dot(V.cross(V.sub(b, a), V.sub(c, a)), normal) > 0);
  }
  assert(result.flatMap(face => face.points).every(p => p[0] <= 0 && p[1] <= .2 + 1e-8));
  assert(points.some(p => p[0] > 0));
});

test('an oblique cut through existing edges closes the section without duplicating cap vertices', () => {
  const plane = { normal: [1, 1, 0], offset: 0 };
  const result = clipConvexFaces(faces, [plane], { capTag: 'cut' });
  const cap = result.find(face => face.tag === 'cut').points;
  assert.equal(cap.length, 4);
  assert.equal(new Set(cap.map(p => p.join(','))).size, 4);
  assert(cap.every(p => Math.abs(V.dot(plane.normal, p)) < 1e-8));
  assert.deepEqual(clipConvexFaces(faces, [{ normal: [1, 0, 0], offset: -2 }]), []);
  assert.deepEqual(clipConvexFaces(faces, [{ normal: [1, 0, 0], offset: 1 }]), faces);
  assert.throws(() => clipConvexFaces(faces, [{ normal: [0, 0, 0], offset: 1 }]), /half spaces/);
});
