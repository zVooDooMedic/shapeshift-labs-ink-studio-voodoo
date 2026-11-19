/* Persistent wetness, drying, temperature and phase deposits on an XZ grid. */
(function (K) {
  const P=K.procedural,M=P.motion,V=K.V,
    integer=(n,a,b)=>Number.isSafeInteger(n)&&n>=a&&n<=b,
    between=(n,a,b)=>Number.isFinite(n)&&n>=a&&n<=b,
    unit=n=>between(n,0,1),
    clamp=(n,a,b)=>Math.max(a,Math.min(b,n)),
    vector=(p,n)=>Array.isArray(p)&&p.length===n&&p.every(Number.isFinite);

  function surfaceWeather(options={}){
    const d=M.gridDomain(options),{width,height,size,open,dx,dz,center,inside}=d,
      {initial,normal,clock,maxDt=0.2,maxRunoff=0.8,maxWork=52000000, wetDiffusion=0.024,
        heatDiffusion=0.018, capacity=1, snowCapacity=3, freezePoint=0, exchange=0.72,
        sunHeat=12, evaporation=0.29, meltRate=0.11, freezeRate=0.08}=options;
    if([initial,normal].some(fn=>fn!==undefined&&typeof fn!=='function')||
      !between(maxDt,1e-5,3)||!between(maxRunoff,0,1000)||!integer(maxWork,1,180000000)||
      !between(capacity,1e-5,1e4)||!between(snowCapacity,1e-5,1e4)||!between(freezePoint,-120,120)||
      ![wetDiffusion,heatDiffusion,exchange,sunHeat,evaporation,meltRate,freezeRate].every(v=>between(v,0,1e4))||
      (clock!==undefined&&(!clock||typeof clock!=='object'||Array.isArray(clock))))
      throw new Error('Surface weather needs bounded thermal and moisture controls');
    const solar=clock===undefined?null:P.data.freeze(P.data.clone(clock)), normals=[],
      fields={wetness:new Float64Array(size),temperature:new Float64Array(size),
        snow:new Float64Array(size),frost:new Float64Array(size),exposure:new Float64Array(size)};
    if(solar)P.environmentFields.evaluate(solar,0);
    for(let i=0;i<size;i++){
      if(!open[i])continue;
      const p=center(i),n=normal?normal(...p,i):[0,1,0],
        {wetness=0,temperature=10,snow=0,frost=0,exposure=0}=initial?initial(...p,i)??{}:{};
      if(!vector(n,3)||V.len(n)<1e-9||!between(wetness,0,capacity)||
        !between(temperature,-240,550)||!between(snow,0,snowCapacity)||!between(frost,0,capacity)||
        !between(exposure,0,1e14))throw new Error('Initial surface weather must be finite and within each field capacity');
      normals[i]=V.norm(n);
      fields.wetness[i]=wetness;
      fields.temperature[i]=temperature;
      fields.snow[i]=snow;
      fields.frost[i]=frost;
      fields.exposure[i]=exposure;
    }
    const X=1/(dx*dx),Z=1/(dz*dz),
      stability=2*Math.max(wetDiffusion,heatDiffusion)*(X+Z)+maxRunoff*(1/dx+1/dz),
      timeStep=Math.min(maxDt,stability?0.47/stability:Infinity);
    let time=0;
    function snapshot(substeps=0){
      const data=Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,value.slice()]));
      return Object.freeze({time,width,height,bounds:d.bounds,...data,substeps,
        sample(x,z){
          if(!inside(x,z))return null;
          return Object.fromEntries(Object.entries(data).map(([key,value])=>[key,d.sample(value,x,z)]));
        }});
    }
    function step(duration,{forcing=()=>({})}={}){
      if(!between(duration,0,120)||typeof forcing!=='function')throw new Error('Surface weather needs a bounded interval and forcing field');
      if(!duration)return snapshot();
      const steps=Math.ceil(duration/timeStep),dt=duration/steps;
      if(steps>16000||steps*size*22>maxWork)throw new Error('Surface weather exceeds its integration budget');
      const wet=fields.wetness.slice(),temperature=fields.temperature.slice(),snow=fields.snow.slice(),
        frost=fields.frost.slice(),exposure=fields.exposure.slice(),
        dw=new Float64Array(size),dT=new Float64Array(size),records=new Array(size);
      function transfer(i,j,axis,coefficient,spacing){
        const flow=(records[i].runoff[axis]+records[j].runoff[axis])*0.5,
          move=(wet[i]-wet[j])*wetDiffusion*coefficient+
            (flow>=0?wet[i]:wet[j])*flow/spacing,
          heat=(temperature[i]-temperature[j])*heatDiffusion*coefficient;
        dw[i]-=move;
        dw[j]+=move;
        dT[i]-=heat;
        dT[j]+=heat;
      }
      for(let k=0;k<steps;k++){
        const t=time+k*dt,sun=solar?P.environmentFields.evaluate(solar,t).sun:null;
        for(let i=0;i<size;i++){
          if(!open[i])continue;
          const state={wetness:wet[i],temperature:temperature[i],snow:snow[i],frost:frost[i],
            exposure:exposure[i],normal:normals[i].slice()};
          const {rain=0,snowfall=0,precipitationExposure=1,air=10,humidity=0.44,wind=0.35,shelter=0,heat=0,runoff=[0,0],
            light=sun?clamp(V.dot(sun,normals[i]),0,1):0}=forcing(...center(i),t,state)??{};
          if(!between(rain,0,1000)||!between(snowfall,0,1000)||!between(air,-240,500)||
            ![humidity,wind,shelter,light,precipitationExposure].every(unit)||!between(heat,-240,250)||!vector(runoff,2)||
            Math.hypot(...runoff)>maxRunoff+1e-10)
            throw new Error('Surface forcing values must be finite and within their configured limits');
          records[i]={rain:rain*precipitationExposure,snowfall:snowfall*precipitationExposure,
            air,humidity,wind,shelter,heat,light:light*(1-shelter),runoff:runoff.slice()};
        }
        dw.fill(0);dT.fill(0);
        for(let z=0,i=0;z<height;z++)for(let x=0;x<width;x++,i++){
          if(!open[i])continue;
          if(x+1<width&&open[i+1])transfer(i,i+1,0,X,dx);
          if(z+1<height&&open[i+width])transfer(i,i+width,1,Z,dz);
        }
        for(let i=0;i<size;i++){
          if(!open[i])continue;
          const {rain,snowfall,air,humidity,wind,shelter,heat,light}=records[i],
            source=clamp(air+light*sunHeat+heat,-240,550),
            nextT=temperature[i]+dt*dT[i],
            temp=nextT+(source-nextT)*(-Math.expm1(-exchange*dt)),
            hot=Math.max(0,temp-freezePoint),cold=Math.max(0,freezePoint-temp),
            catchment=snowfall?P.environmentFields.deposition({normal:normals[i],load:1,shelter}):0,
            packed=Math.min(snowCapacity,snow[i]+dt*snowfall*catchment),snowMelt=Math.min(packed,dt*meltRate*hot),
            thaw=Math.min(frost[i],dt*meltRate*hot*0.73),
            wet0=Math.max(0,wet[i]+dt*(dw[i]+rain))+snowMelt+thaw,
            freeze=Math.min(wet0,Math.max(0,capacity-frost[i]+thaw),freezeRate*cold*dt),
            drying=evaporation*(1-humidity)*(0.38+0.62*wind)*(1+light*0.78+0.04*hot);
          temperature[i]=temp;
          wet[i]=clamp((wet0-freeze)*Math.exp(-drying*dt),0,capacity);
          snow[i]=packed-snowMelt;
          frost[i]+=freeze-thaw;
          exposure[i]+=light*dt;
        }
      }
      Object.assign(fields,{wetness:wet,temperature,snow,frost,exposure});
      time+=duration;
      return snapshot(steps);
    }
    return Object.freeze({step,snapshot});
  }
  M.surfaceWeather=surfaceWeather;
})(KIT);
