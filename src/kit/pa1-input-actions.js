/* Device controls mapped to named actions in each caller-owned context. */
(function (K) {
  const P=K.procedural||K.authoring;
  const name=value=>typeof value==='string'&&/^[a-z][a-z0-9_-]{0,47}$/i.test(value);
  const control=value=>typeof value==='string'&&/^[a-z][a-z0-9_-]{0,47}:[a-z0-9][a-z0-9_-]{0,47}$/i.test(value);

  function compile(contexts) {
    const entries=Object.entries(contexts||{}), maps=new Map();
    if (!entries.length||entries.length>16) throw Error('Input needs 1..16 contexts');
    for (const [context,actions] of entries) {
      const list=Object.entries(actions||{}), byControl=new Map(), byAction=new Map();
      if (!name(context)||!list.length||list.length>128) throw Error('Invalid input context');
      for (const [action,bindings] of list) {
        if (!name(action)||!Array.isArray(bindings)||bindings.length>16) throw Error('Invalid input action');
        const owned=Array.from(bindings,binding=>{
          const { input, deadZone=0, scale=1 }=typeof binding==='string'?{input:binding}:binding||{};
          if (!control(input)||!Number.isFinite(deadZone)||deadZone<0||deadZone>=1||
              !Number.isFinite(scale)||Math.abs(scale)>1) throw Error('Invalid action binding');
          if (byControl.has(input)) throw Error('A control already has an action in '+context+': '+input);
          const value=Object.freeze({ input, deadZone, scale });
          byControl.set(input,{action,binding:value});
          return value;
        });
        byAction.set(action,Object.freeze(owned));
      }
      maps.set(context,{byControl,byAction});
    }
    function get(context) {
      if (!maps.has(context)) throw Error('Unknown input context: '+context);
      return maps.get(context);
    }
    function level(raw,{deadZone,scale}) {
      if (!Number.isFinite(raw)||Math.abs(raw)>1) throw Error('Input values must be in [-1, 1]');
      const magnitude=Math.abs(raw);
      return magnitude<=deadZone ? 0 : Math.sign(raw)*(magnitude-deadZone)/(1-deadZone)*scale;
    }
    function resolve(context,input,raw=1) {
      const match=get(context).byControl.get(input);
      return match?{action:match.action,value:level(raw,match.binding)}:null;
    }
    function sample(context,sources) {
      const {byControl,byAction}=get(context), values=new Map([...byAction.keys()].map(id=>[id,0]));
      for (const source of sources) for (const [input,raw] of Object.entries(source)) {
        const match=byControl.get(input);
        if (!match) continue;
        const value=level(raw,match.binding);
        if (Math.abs(value)>Math.abs(values.get(match.action))) values.set(match.action,value);
      }
      return Object.freeze(Object.fromEntries(values));
    }
    return Object.freeze({ resolve, sample, bindings:(context,action)=>get(context).byAction.get(action) });
  }

  function radial(x,y,deadZone=0) {
    if (![x,y].every(value=>Number.isFinite(value)&&Math.abs(value)<=1) ||
        !Number.isFinite(deadZone)||deadZone<0||deadZone>=1)
      throw Error('Radial input needs two axes in [-1, 1] and a dead zone below 1');
    const length=Math.hypot(x,y);
    if (length<=deadZone) return [0,0];
    const strength=(Math.min(1,length)-deadZone)/(1-deadZone);
    return [x/length*strength,y/length*strength];
  }

  P.inputActions=Object.freeze({compile,radial});
})(KIT);
