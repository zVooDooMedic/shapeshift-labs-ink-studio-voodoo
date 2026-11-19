const test=require('node:test'),assert=require('node:assert/strict');
const {railGuard}=require('..').load().KIT.procedural;

test('rail guards fit sloping runs, share corner posts and leave physical gaps between bars',()=>{
  const path=[[0,0,0],[.4,.2,0],[1,.5,0],[1,.5,1]],pieces=railGuard({path,postSpacing:.46},
    {key:'fence',material:'wood'});
  const bars=pieces.filter(p=>p.key.includes('/bar/')),posts=pieces.filter(p=>p.key.includes('/post/'));
  assert.equal(bars.length,4);
  assert.equal(posts.length,7);
  assert(pieces.every(p=>p.material==='wood'&&p.mesh.positions.every(Number.isFinite)));
  assert(posts.filter(p=>p.distance([1,.8,0])<0).length===1);
  assert(bars.some(p=>p.distance([.5,.89,0])<0));
  assert(!pieces.some(p=>p.distance([.53,.67,0])<0));
  assert.throws(()=>railGuard({path,maxPieces:4}),/piece budget/);
});
