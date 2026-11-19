const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('..').load().KIT.procedural;

const slot = (id, changes = {}) => ({ id, point: [1, 2, 3], normal: [0, 2, 0], tangent: [2, .1, 0],
  room: [1, 1, 1], tags: ['deck'], ...changes });
const choices = [
  { id: 'wooden', weight: 2, size: [.5, .7, .4], requires: ['deck'] },
  { id: 'metal', size: [.4, .7, .7], requires: ['deck'] },
  { id: 'wall', size: [.1, .1, .1], requires: ['wall'] },
  { id: 'wide', size: [1.2, .4, .3] }
];

test('framed slots keep choices independent of input order, unrelated slots, and host pose', () => {
  const inputs = [slot('one'), slot('two')], a = P.attachments.layout(inputs, choices, { seed: 6 });
  const b = P.attachments.layout([slot('more'), slot('two', { point: [4, 2, 1] }), inputs[0]], choices.slice().reverse(), { seed: 6 });
  assert.deepEqual(a.map(x => [x.key, x.family.id, x.seed]), b.filter(x => x.key !== 'more').map(x => [x.key, x.family.id, x.seed]));
  assert.deepEqual(a[0].slot.normal, [0, 1, 0]);
  assert.deepEqual(a[0].slot.tangent, [1, 0, 0]);
  assert.deepEqual(a[0].slot.bitangent, [0, 0, -1]);
  assert(a.every(x => ['wooden', 'metal'].includes(x.family.id)));
});

test('fit can choose a ranked alternative and reserve earlier named slots', () => {
  const selected = P.attachments.layout([slot('lower'), slot('preferred', { priority: 2 })], choices, {
    seed: 12, fits: (candidate, placed) => !placed.length && candidate.family.id === 'metal'
  });
  assert.deepEqual(selected.map(x => [x.key, x.family.id]), [['preferred', 'metal']]);
  const pinned = P.attachments.layout([slot('free', { chance: 0 }), slot('fixed', { chance: 0, pin: 'wooden' })], choices);
  assert.deepEqual(pinned.map(x => x.key), ['fixed']);
  assert.throws(() => P.attachments.layout([slot('one')], choices, { budget: 1 }), /candidate budget/);
});

test('source metadata remains mutable and can pass a serializable attachment recipe', () => {
  const recipe = { anchor: { id: 'edge' } };
  const result = P.attachments.layout([slot('sill', { data: recipe })], choices);
  recipe.anchor.id = 'moved';
  assert.equal(result[0].slot.data.anchor.id, 'edge');
  assert(Object.isFrozen(result[0].slot.data.anchor));
});
