const test=require('node:test');
const assert=require('node:assert/strict');
const {landingContact}=require('..').load().KIT.procedural;

test('a landing must support the full approach and stay near the requested sill',()=>{
  const q=landingContact.create({sill:[0,1.5,1],facing:[0,0,2],width:1});
  assert.equal(q.points.length,6);
  assert(q.bounds.min[2]>1&&q.bounds.max[2]<1.28);
  const candidates=[
    {id:'narrow',height:(x,z)=>Math.abs(x)<.18?1.5:null},
    {id:'edge',height:(x,z)=>z<1.18?1.5:null},
    {id:'sloped',height:(x,z)=>1.5+x*.2},
    {id:'below',height:()=>.8},
    {id:'deck',height:()=>1.53}
  ];
  assert.deepEqual(q.match(candidates),{id:'deck',height:1.53,range:[1.53,1.53]});
  assert.equal(q.match(candidates.slice(0,4)),null);
  assert.throws(()=>q.match([{id:'invalid',height:()=>Infinity}]),/finite/);
});

test('a landing rotates with the opening and ties resolve by retained identity',()=>{
  const q=landingContact.create({sill:[2,2,3],facing:[-1,0,0],width:2,
    near:.1,far:.6,fraction:.5,verticalTolerance:.25,elevationSpread:.12});
  assert.deepEqual(q.bounds,{min:[1.4,1.75,2.5],max:[1.9,2.25,3.5]});
  const candidates=[{id:'wider',height:(x,z)=>2+z/100},{id:'first',height:(x,z)=>2+z/100}];
  assert.deepEqual(q.match(candidates),{id:'first',height:2.035,range:[2.025,2.035]});
  assert.deepEqual(q.match(candidates.slice().reverse()),q.match(candidates));
  assert.throws(()=>landingContact.create({sill:[0,0,0],facing:[0,1,0],width:1}),/horizontal/);
});
