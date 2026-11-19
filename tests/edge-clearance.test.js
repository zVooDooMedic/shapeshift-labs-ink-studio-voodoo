const test=require('node:test'),assert=require('node:assert/strict');
const {edgeClearance:{strip,ranges}}=require('..').load().KIT.procedural;

test('ordered retained spans handle overlapping angled access, reversed edges and complete removal',()=>{
  const a=[-4,2,0],b=[4,2,0];
  const first=strip([-1,2,-3],[-1,2,3],{halfWidth:1});
  const second=strip([.5,1,-2],[.5,3,2],{halfWidth:1});
  assert.deepEqual(ranges(a,b,[second,first]),{kept:[[0,.25],[.6875,1]],removed:[[.25,.6875]]});
  assert.deepEqual(ranges(b,a,[first,second]),{kept:[[0,.3125],[.75,1]],removed:[[.3125,.75]]});
  const skew=strip([-2,2,-2],[2,2,2],{halfWidth:Math.SQRT1_2});
  for(const x of ranges(a,b,[skew]).removed[0].map((t,i)=>t-[.375,.625][i]))assert(Math.abs(x)<1e-10);
  assert.deepEqual(ranges(a,b,[strip([0,2,-1],[0,2,1],{halfWidth:4})]),{kept:[],removed:[[0,1]]});
});

test('vertical bands protect underpasses, and end extensions and tangent contacts are bounded',()=>{
  const thin=strip([0,1,-2],[0,1,0],{halfWidth:1,extension:.1,above:.2,below:.1});
  const untouched={kept:[[0,1]],removed:[]};
  assert.deepEqual(ranges([-2,2,0],[2,2,0],[thin]),untouched);
  assert.deepEqual(ranges([-2,1,.11],[2,1,.11],[thin]),untouched);
  assert.deepEqual(ranges([-2,1,0],[-1,1,0],[thin]),untouched);
  assert.deepEqual(ranges([-2,1,.09],[2,1,.09],[thin]),{kept:[[0,.25],[.75,1]],removed:[[.25,.75]]});
  assert.throws(()=>strip([0,0,0],[0,1,0],{halfWidth:1}),/horizontal span/);
});
