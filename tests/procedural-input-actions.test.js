const test=require('node:test');
const assert=require('node:assert/strict');
const { inputActions }=require('..').load().KIT.procedural;

test('the same physical control has independent semantic actions across contexts',()=>{
  const edit={select:['key:Enter','pad:South'], undo:['key:KeyZ']};
  const map=inputActions.compile({edit, menu:{confirm:['key:Enter','pad:South'],back:['pad:East']}});
  edit.select.fill('key:KeyK');
  assert.deepEqual(map.resolve('edit','pad:South'),{action:'select',value:1});
  assert.deepEqual(map.resolve('menu','pad:South'),{action:'confirm',value:1});
  assert.equal(map.resolve('menu','key:KeyZ'),null);
  assert.equal(map.bindings('edit','select')[0].input,'key:Enter');
  assert.throws(()=>map.resolve('unknown','pad:South'),/Unknown/);
  assert.throws(()=>inputActions.compile({edit:{select:['key:Enter'],undo:['key:Enter']}}),/already/);
});

test('independent devices combine without dead-zone drift or doubling the same action',()=>{
  const map=inputActions.compile({edit:{
    rotate:[{input:'pad:RightX',deadZone:.25,scale:-1},'key:ArrowLeft'],
    pan:['pad:LeftX']
  }});
  const centered={'pad:RightX':.18,'pad:LeftX':0};
  assert.deepEqual(map.sample('edit',[centered]),{rotate:0,pan:0});
  assert.deepEqual(map.sample('edit',[{'pad:RightX':-.625,'pad:LeftX':-.3}]),{rotate:.5,pan:-.3});
  assert.deepEqual(map.sample('edit',[{'pad:RightX':-.625},{'key:ArrowLeft':1},{'key:ArrowLeft':1}]),{rotate:1,pan:0});
  assert.deepEqual(map.sample('edit',[]),{rotate:0,pan:0});
  assert.throws(()=>map.resolve('edit','pad:RightX',2),/Input values/);
});

test('radial pairs keep headings, reject drift, and cap travel on diagonals',()=>{
  const {radial}=inputActions;
  assert.deepEqual(radial(.09,-.14,.2),[0,0]);
  const near=(value,target)=>assert(Math.abs(value-target)<1e-9);
  near(radial(0,-.6,.2)[1],-.5);
  const [x,y]=radial(.3,.4,.2);
  near(x/y,.75);
  near(Math.hypot(x,y),.375);
  near(Math.hypot(...radial(-1,1,.2)),1);
  assert.throws(()=>radial(NaN,0),/Radial input/);
  assert.throws(()=>radial(0,1,1),/Radial input/);
});
