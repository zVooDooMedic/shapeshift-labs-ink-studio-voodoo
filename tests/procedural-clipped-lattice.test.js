const { test } = require('node:test');
const assert = require('node:assert/strict');
const { clippedLattice, pieces } = require('..').load().KIT.procedural;

const panels = [
  { key: 'left', polygon: [[0, 0], [1, 0], [1, 2], [0, 1]] },
  { key: 'right', polygon: [[1, 0], [2, 0], [2, 1], [1, 2]] }
];
const runs = [
  { axis: [1, 0], pitch: .4, width: .1 },
  { axis: [0, 1], pitch: .98, width: .08 }
];
const build = lattice => lattice.pieces({
  direction: [0, 0, 1], depth: [-.07, .15],
  map: (panel, [u, v]) => [u, v, 0],
  key: 'gate', owner: 'panel', material: 'metal', frameMaterial: 'wood'
});

test('a profiled lattice clips members to several convex patches and retains open cells', () => {
  const lattice = clippedLattice({ panels, runs, edges: [[[0, 0], [2, 0]]], edgeWidth: .16 });
  const rail = lattice.members.find(m => m.key === 'run/1/0');
  assert.deepEqual(rail.fragments.map(f => f.panel), ['left', 'right']);
  const realized = build(lattice), union = pieces.union(realized);
  assert(realized.every(p => p.owner === 'panel' && p.mesh.positions.every(Number.isFinite)));
  assert(realized.some(p => p.material === 'wood' && p.role === 'frame'));
  assert.deepEqual(realized.map(p => p.key), build(lattice).map(p => p.key));
  const cast = (x, y) => union.raycast([x, y, 1], [0, 0, -1]);
  assert.equal(cast(.27, .7), null);
  assert.equal(cast(.2, 1.7), null);
  assert(Math.abs(cast(.2, .7).distance - .85) < 1e-6);
  assert.equal(cast(.27, .02).material, 'wood');
});

test('lattices accept oblique runs and reject invalid geometry, width and budgets', () => {
  const l = clippedLattice({ panels, runs: [{axis: [1, -1], pitch: .48, width: .1, phase: .25}] });
  assert(build(l).length > 3);
  assert.throws(() => clippedLattice({ panels, runs, budget: 2 }), /budget/);
  assert.throws(() => clippedLattice({ panels, runs: [{axis: [0, 1], pitch: .1, width: .13}] }), /pitch/);
  assert.throws(() => clippedLattice({ panels: [...panels, panels[0]], runs }), /unique/);
  assert.throws(() => l.pieces({ direction: [0, 0, 0], depth: [0, .2], map: (_, [u, v]) => [u, v, 0] }), /direction/);
});
