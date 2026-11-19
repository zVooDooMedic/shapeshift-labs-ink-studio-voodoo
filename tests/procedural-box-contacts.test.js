const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('..').load().KIT;
const { orientedBox, boxContact } = K.procedural.contacts;

test('box contacts include a face join and reject separated diagonal volumes with overlapping bounds', () => {
  const yaw = Math.PI/4, c = Math.cos(yaw), s = Math.sin(yaw);
  const frame = [c,0,-s,0,1,0,s,0,c];
  const center = [0,1,0], half = [3,.10,.14];
  const a = orientedBox(center,half,frame);
  const at = gap => orientedBox([-s*gap,1,c*gap],half,frame);
  assert(boxContact(a,at(.28)));
  assert(!boxContact(a,at(.31)));
  assert(boxContact(a,at(.31),.035));
  assert(K.procedural.spatial.overlap(a.bounds,at(.8).bounds));
  assert(!boxContact(a,at(.8)));
  assert(!boxContact(at(.8),a));
  assert(boxContact(a,orientedBox(center,[.14,.1,3],frame)));
  assert(!boxContact(a,orientedBox([0,1.4,0],[3,.1,3])));
  center[0] = 42;
  assert.equal(a.center[0],0);
  assert(Object.isFrozen(a.bounds.min));
  assert.throws(() => orientedBox(center,half,[2,0,0,0,1,0,0,0,1]),/orthonormal/);
  assert.throws(() => boxContact(a,a,-1),/tolerance/);
});

test('a skew pair can separate on an edge cross axis while all its face axes overlap', () => {
  const a = orientedBox([0,0,0],[2,.25,.25]);
  const b = orientedBox([-1,.25,1.48],[1.6,.22,.22],K.M.mul(
    K.M.rot([0,1,0],.7),K.M.rot([1,0,0],1.1)
  ));
  const delta = K.V.sub(b.center,a.center);
  const extent = (box,axis) => box.axes.reduce((sum,v,i)=>sum+Math.abs(K.V.dot(v,axis))*box.half[i],0);
  assert([...a.axes,...b.axes].every(axis=>Math.abs(K.V.dot(delta,axis))<extent(a,axis)+extent(b,axis)));
  assert(!boxContact(a,b));
  assert(!boxContact(b,a));
});
