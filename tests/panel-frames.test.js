const test=require('node:test'),assert=require('node:assert/strict');
const P=require('..').load().KIT.procedural;
const standard={width:5,height:3,unit:[1,1],beam:.16,braces:'cross'};

test('a retained opening clips crossing members and fits keyed headers, sills and jambs',()=>{
  const original=P.panelFrames(standard);
  const frame=P.panelFrames({...standard,openings:[{key:'bay',min:[1.65,.58],max:[2.65,1.59]}]});
  assert(original.distance(2,1)<0);
  assert(frame.distance(2,1)>0);
  assert(frame.distance(1.59,1.38)<0);
  assert(frame.distance(2.42,1.64)<0);
  assert(frame.parts.some(p=>p.key==='opening/bay/header'));
  assert(frame.parts.some(p=>p.key==='rail/3'));
  for(const part of frame.parts){
    const center=part.polygon.reduce(([x,y],[u,v])=>[x+u/part.polygon.length,y+v/part.polygon.length],[0,0]);
    assert(frame.distance(...center)<=1e-8);
  }
});

test('seam openings clip the two chart ends with one set of logical keys',()=>{
  const opening={key:'seam',min:[4.7,.62],max:[5.42,1.72]};
  const frame=P.panelFrames({...standard,periodic:true,openings:[opening]});
  for(const u of [-.1,0,.18,4.8,5.19])assert(frame.distance(u,1)>0);
  assert.equal(frame.parts.filter(p=>p.key==='opening/seam/header').length,2);
  const unframed=P.panelFrames({...standard,periodic:true,openings:[{...opening,rim:false}]});
  assert(unframed.parts.every(p=>!p.key.startsWith('opening/')));
});
