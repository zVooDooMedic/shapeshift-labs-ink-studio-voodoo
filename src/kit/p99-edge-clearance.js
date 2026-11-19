/* Exact retained spans of an edge passing through sloped rectangular strips. */
(function(K){
  const P=K.procedural||K.authoring,{V}=K,EPS=1e-8;
  const point=p=>Array.isArray(p)&&p.length===3&&Array.from(p).every(Number.isFinite);

  function strip(a,b,{halfWidth,extension=0,above=.20,below=.20}={}){
    if(!point(a)||!point(b)||![halfWidth,extension,above,below].every(Number.isFinite)||
        halfWidth<=0||extension<0||above<0||below<0||above+below<=0)
      throw Error('A clearance strip needs finite endpoints, width and vertical limits');
    const dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz);
    if(!Number.isFinite(length)||length<EPS)throw Error('A clearance strip needs a horizontal span');
    const along=[dx/length,0,dz/length],across=[-along[2],0,along[0]],
      grade=(b[1]-a[1])/length,vertical=[-grade*along[0],1,-grade*along[2]];
    if(!Number.isFinite(grade))throw Error('Clearance strip grade must be finite');
    return Object.freeze({
      origin:Object.freeze(a.slice()),along:Object.freeze(along),across:Object.freeze(across),length,
      slabs:Object.freeze([[along,-extension,length+extension],[across,-halfWidth,halfWidth],
        [Object.freeze(vertical),-below,above]].map(Object.freeze))
    });
  }

  function ranges(a,b,strips){
    if(!point(a)||!point(b)||!Array.isArray(strips))throw Error('Edge clearance needs endpoints and a strip list');
    const delta=V.sub(b,a),cuts=[];
    for(const {origin,slabs} of strips){
      const relative=V.sub(a,origin);
      let start=0,end=1;
      for(const [normal,low,high] of slabs){
        const x=V.dot(relative,normal),dx=V.dot(delta,normal);
        if(Math.abs(dx)<EPS){
          if(x<low||x>high){end=0;break;}
          continue;
        }
        const entry=(low-x)/dx,exit=(high-x)/dx;
        start=Math.max(start,Math.min(entry,exit));
        end=Math.min(end,Math.max(entry,exit));
        if(start>=end)break;
      }
      if(end-start>EPS)cuts.push([start,end]);
    }
    cuts.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    const removed=[],kept=[];
    for(const cut of cuts){
      const last=removed.at(-1);
      if(last&&cut[0]<=last[1]+EPS)last[1]=Math.max(last[1],cut[1]);
      else removed.push(cut);
    }
    let start=0;
    for(const [low,high] of removed){
      if(low-start>EPS)kept.push([start,low]);
      start=high;
    }
    if(1-start>EPS)kept.push([start,1]);
    return {kept,removed};
  }

  P.edgeClearance=Object.freeze({strip,ranges});
})(KIT);
