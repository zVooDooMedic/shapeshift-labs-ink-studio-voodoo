const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('..').load().KIT.procedural;

test('surface masks retain brush stations while measuring width in a resized chart', () => {
  const strokes = [{ points: [[.35, .4], [.65, .4]], width: 1, softness: .1 }];
  const wide = P.surfaceMasks.compile(strokes, { size: [8, 4] });
  const tall = P.surfaceMasks.compile(strokes, { size: [8, 10] });
  for (const mask of [wide, tall]) assert.equal(mask.weight(.51, .4), 1);
  assert.equal(wide.weight(.51, .525), .5);
  assert.equal(tall.weight(.51, .525), 0);
  assert.equal(wide.weight(-.02, .4, .3), .3);
  assert.equal(wide.weight(.55, 1.1, .3), .3);
  const remove = { operation: 'erase', width: .4, points: [[.51, .4]] };
  const erased = P.surfaceMasks.compile([...strokes, remove], { size: [8, 4] });
  assert.equal(erased.weight(.51, .4, .3), 0);
  assert.equal(erased.weight(.62, .4, .3), 1);
  assert.equal(P.surfaceMasks.compile([remove, ...strokes], { size: [8, 4] }).weight(.51, .4), 1);
});

test('periodic surface strokes cross the shortest seam and can make multiple turns', () => {
  const brush = { points: [[.95, .5], [.05, .5]], width: .42, softness: .04 };
  const chart = { size: [10, 4], periodic: true };
  const round = P.surfaceMasks.compile([brush], chart);
  assert.equal(round.weight(0, .5), 1);
  assert.equal(round.weight(1, .5), 1);
  assert.equal(round.weight(-1.001, .5), 1);
  assert.equal(round.weight(.5, .5), 0);
  assert.equal(P.surfaceMasks.compile([brush], { ...chart, periodic: false }).weight(.5, .5), 1);
  const winding = P.surfaceMasks.compile([{ ...brush, points: [
    [.8, .1], [.03, .2], [.29, .31], [.55, .43], [.8, .57], [.02, .69], [.24, .8]
  ] }], chart);
  assert.equal(winding.weight(0, .19), 1);
  assert.equal(winding.weight(0, .68), 1);
  assert.equal(winding.weight(0, .43), 0);
  assert.equal(winding.weight(.8, .57), 1);
  const erase = { ...brush, operation: 'erase', points: [[0, .5]] };
  assert.equal(P.surfaceMasks.compile([brush, erase], chart).weight(.99, .5, .7), 0);
  assert.equal(P.surfaceMasks.compile([brush, erase], chart).weight(.04, .5, .7), 1);
});

test('surface masks reject invalid or unbounded charts, strokes and queries', () => {
  const options = { size: [1, 1] }, stroke = { points: [[.5, .5]], width: .1 };
  for (const change of [{ size: [0, 1] }, { size: [1, Infinity] }, { periodic: 2 }])
    assert.throws(() => P.surfaceMasks.compile([stroke], { ...options, ...change }));
  for (const change of [{ points: [[1.1, .5]] }, { width: 0 }, { softness: -1 }, { operation: 'blur' }])
    assert.throws(() => P.surfaceMasks.compile([{ ...stroke, ...change }], options));
  assert.throws(() => P.surfaceMasks.compile([{ ...stroke, points: Array(8193).fill([.5, .5]) }], options), /budget/);
  assert.throws(() => P.surfaceMasks.compile([stroke], options).weight(Infinity, 0));
});
