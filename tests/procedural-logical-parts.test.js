const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('..').load().KIT.procedural;
const { compile } = P.logicalParts;

test('a wrapped stock key selects every physical fragment and retains order', () => {
  const layout = require('..').load().KIT.stripCourses({
    sections: [{ s: 0, lower: 0, upper: 1 }, { s: 1, lower: .1, upper: 1 },
      { s: 2, lower: 0, upper: 1 }],
    unit: [.5, .3], joint: .04, stagger: .5, closed: true
  });
  const stock = compile(layout.pieces, piece => piece.id);
  const wrapped = stock.groups.find(group => group.fragments.some(piece => piece.stockColumn < 0));
  assert(wrapped);
  assert(wrapped.fragments.some(piece => piece.stockColumn > 0));
  assert.deepEqual(stock.get(wrapped.key), wrapped.fragments);
  assert(Object.isFrozen(wrapped.fragments));
  const change = stock.partition(new Set([wrapped.key, 'unknown']));
  assert.deepEqual(change.omitted, layout.pieces.filter(piece => piece.id === wrapped.key));
  assert.deepEqual(change.visible, layout.pieces.filter(piece => piece.id !== wrapped.key));
  assert.deepEqual(stock.partition().visible, layout.pieces);
});

test('unkeyed backing remains visible and invalid keys fail early', () => {
  const backing = { id: null }, tile = { id: 'tile-0' }, input = [backing, tile];
  const assembly = compile(input, part => part.id);
  input.reverse();
  assert.deepEqual(assembly.partition(), { visible: [backing, tile], omitted: [] });
  assert.deepEqual(assembly.partition(['tile-0']), { visible: [backing], omitted: [tile] });
  assert.deepEqual(assembly.get('unknown'), []);
  assert.throws(() => compile([tile], () => ''), /keys/);
  assert.throws(() => assembly.partition([null]), /keys/);
});
