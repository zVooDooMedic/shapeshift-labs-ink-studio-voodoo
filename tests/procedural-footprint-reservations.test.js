const test = require('node:test');
const assert = require('node:assert/strict');
const {createFootprintReservations} = require('..').load().KIT.procedural;

const at = (point, size=[1,1,1], tangent=[1,0,0]) => ({point,size,tangent});

test('reservation uses oriented volume overlap and preserves space on other levels', () => {
  const field=createFootprintReservations({cellSize:.2});
  const axis=[1,0,1], halfAngle=Math.SQRT1_2;
  const beam=at([0,0,0],[2,.5,.2],axis);
  assert(field.reserve(beam));
  assert(!field.reserve(at([0,.25,0],[.2,.2,.2])));
  assert(field.reserve({...beam,point:[0,.5,0]}));
  assert(field.reserve({...beam,point:[-.3*halfAngle,0,.3*halfAngle]}));
  assert(!field.fits(at([.5,0,.5],[.1,.2,.1])));
});

test('reserve is atomic and authored volumes can overlap in the same field', () => {
  const field=createFootprintReservations({clearance:.12,cellSize:.4});
  field.occupy(at([0,0,0]));
  field.occupy(at([.25,0,0]));
  assert(!field.reserve(at([1.36,0,0])));
  assert(field.reserve(at([1.38,0,0])));
  assert(field.fits(at([-3,0,0])));
  field.occupy(at([300,0,0],[300,.2,2]));
  assert(!field.reserve(at([250,0,0])));
  assert.throws(()=>field.occupy(at([0,0,0],[1,1,1],[0,1,0])),/horizontal/);
});

test('clearance intervals keep exact touching positions and ignore separate levels',()=>{
  const field=createFootprintReservations({cellSize:.25});
  field.occupy(at([0,0,0]));
  field.occupy(at([2,0,0]));
  field.occupy(at([4,1,0]));
  assert.deepEqual(field.freeIntervals(at([0,0,0]),[2,0,0],[-3,5]),[[-3,-1],[1,1],[3,5]]);
  assert.deepEqual(field.freeIntervals(at([0,0,0]),[1,0,0],[0,0]),[]);
  assert.deepEqual(field.freeIntervals(at([0,0,0]),[1,0,0],[1,1]),[[1,1]]);
  assert.throws(()=>field.freeIntervals(at([0,0,0]),[0,1,0],[-2,2]),/horizontal/);
});

test('clearance intervals match rotated physical overlap over continuous signed offsets',()=>{
  const field=createFootprintReservations({cellSize:.24,clearance:.16});
  field.occupy(at([0,0,0],[1.8,.5,.25],[1,0,1]));
  field.occupy(at([2.1,.1,0],[.9,.25,.65],[1,0,-1]));
  const sample=at([0,.1,.18],[.45,.4,.42],[0,0,1]),dir=[.8,0,.6];
  const free=field.freeIntervals(sample,dir,[-3,3]);
  assert(free.some(([a,b])=>b-a>.5));
  for(let i=0;i<=600;i++){
    const step=(i-300)/100,point=sample.point.map((x,j)=>x+dir[j]*step);
    assert.equal(field.fits({...sample,point}),free.some(([lo,hi])=>lo<=step&&step<=hi));
  }
});
