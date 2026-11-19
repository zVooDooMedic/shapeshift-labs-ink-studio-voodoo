const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT } = require('..').load();
const P = KIT.procedural;

const outline = [[-1.2, -1.3], [1.3, -1.3], [1.8, 0], [1.1, 1.35], [-.9, 1.35], [-1.6, 0]];
const recess = [[-.2, -.8], [.2, -.8], [.2, -.25], [.65, -.25], [.65, .2], [.2, .2],
  [.2, .8], [-.2, .8], [-.2, .2], [-.65, .2], [-.65, -.25], [-.2, -.25]];
const spec = { outline, recess: recess.slice().reverse(), span: [-.9, .1], inset: .36 };

test('a profiled blind recess has a closed mesh and one field across the shell and backing', () => {
  const shape = P.geometry.recessedProfile(spec);
  assert(shape.distance([0, 0, 0]) > 0);
  assert(shape.distance([0, 0, -.5]) < 0);
  assert(shape.distance([.7, .35, 0]) < 0);
  assert(shape.distance([-1.75, 1, 0]) > 0);
  const mesh = shape.mesh({owner:'sample',surface:'recess',material:'stone'});
  assert.equal(KIT.mesh.info(P.geometry.toKitMesh(mesh, () => [.3,.5,.7])).open, 0);
  for (let i = 0; i < mesh.positions.length; i += 3)
    assert(Math.abs(shape.distance(Array.from(mesh.positions.slice(i,i+3)))) < 1e-6);
  let count = 0;
  shape.sample(.38, p => {
    assert(Math.abs(shape.distance(p)) < 1e-8);
    count++;
  });
  assert(count > 100);
});

test('recess profiles reject crossed boundaries, an invalid center and insufficient backing', () => {
  for (const patch of [{ inset: 1.2 }, { center: [2, 2] }, { outline: [[-1,-1],[1,1],[1,-1],[-1,1]] },
    { recess: [[-.3,-.3],[2,-.3],[2,.3],[-.3,.3]] }])
    assert.throws(() => P.geometry.recessedProfile({...spec,...patch}), /profile|Recess/i);
});
