/* Recessed courses on a convex gravity skirt, with a continuous bearing behind the joints. */
(function(K) {
  const P=K.procedural||K.authoring, clamp=K.clamp;
  P.supportCourses=(skirt, options={})=>{
    const {unit=[.46,.22],joint=.035,depth=.035,budget=4096}=options;
    if(!skirt?.outline||!Array.isArray(unit)||unit.length!==2||
       !unit.every(v=>Number.isFinite(v)&&v>=.025)||!Number.isFinite(joint)||joint<0||
       !Number.isFinite(depth)||depth<0||depth>.25||!Number.isSafeInteger(budget)||budget<4||budget>65536)
      throw Error('Support courses need a skirt and bounded course dimensions');
    const poly=skirt.outline;
    let width=0;
    const edges=poly.map((a,i)=>{
      const b=poly[(i+1)%poly.length],dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz);
      const edge={a,length,start:width,tx:dx/length,tz:dz/length,nx:dz/length,nz:-dx/length};
      width+=length;
      return edge;
    });
    const miters=edges.map((e,i)=>{
      const p=edges[(i+edges.length-1)%edges.length], denominator=1+e.nx*p.nx+e.nz*p.nz;
      return [(e.nx+p.nx)/denominator,(e.nz+p.nz)/denominator];
    });
    let relief=depth, metric=1;
    for(let i=0;i<edges.length;i++){
      const e=edges[i];
      e.ma=miters[i];e.mb=miters[(i+1)%edges.length];
      e.ta=e.tx*e.ma[0]+e.tz*e.ma[1];e.tb=e.tx*e.mb[0]+e.tz*e.mb[1];
      if(e.tb>e.ta)relief=Math.min(relief,.3*e.length/(e.tb-e.ta));
      metric=Math.min(metric,.7/Math.hypot(1,Math.max(Math.abs(e.ta),Math.abs(e.tb))));
    }
    const top=skirt.bounds.max[1], visibleHeight=Math.max(.001,top-skirt.bounds.min[1]);
    // Coarsen before allocation. Whole rows count down from the top datum.
    let scale=1, layout;
    while(!layout){
      const ux=unit[0]*scale, vy=unit[1]*scale, rows=Math.ceil(visibleHeight/vy), columns=Math.max(1,Math.round(width/ux));
      if(columns*rows+Math.floor(rows/2)<=budget){
        const mortar=Math.min(joint,Math.min(width/columns,vy)*.3);
        layout=P.fittedCourses({width,height:rows*vy,unit:[ux,vy],joint:mortar,stagger:.5,periodic:true,budget});
      }else scale*=1.4;
    }
    if(!layout.joint)relief=0;
    const at0=skirt.top(0,0), slope=Math.hypot(skirt.top(1,0)-at0,skirt.top(0,1)-at0);
    const topScale=1/Math.hypot(1,slope), bottomScale=1/Math.hypot(1,slope,skirt.ground.slopeBound);
    function chart([x,y,z]){
      let side=-Infinity, edge;
      for(const e of edges){
        const h=(x-e.a[0])*e.nx+(z-e.a[2])*e.nz;
        if(h>side){side=h;edge=e;}
      }
      const d=clamp(side,-relief,0), ratio=1+d*(edge.tb-edge.ta)/edge.length;
      const run=((x-edge.a[0])*edge.tx+(z-edge.a[2])*edge.tz-d*edge.ta)/ratio;
      return{edge,side,u:edge.start+clamp(run,0,edge.length),v:top-y};
    }
    function lookup(point){
      const q=chart(point), v=clamp(q.v,0,layout.height);
      return {u:q.u,v,side:q.side,cell:layout.at(q.u,v),joint:layout.jointDistance(q.u,v)};
    }
    function distance(point){
      const base=skirt.distance(point);
      if(!relief||base<=-2*relief||base>=layout.joint)return base;
      const q=chart(point);
      if(q.v<0||q.v>layout.height)return base;
      const [x,y,z]=point, recess=Math.max(0,Math.min(relief,
        (skirt.top(x,z)+skirt.overlap-y)*topScale,(y-skirt.bottom(x,z))*bottomScale));
      const grooved=Math.max(base,Math.min((q.side+recess)*.5,metric*layout.jointDistance(q.u,q.v)));
      return base<-relief?base+(grooved-base)*clamp(2+base/relief,0,1):grooved;
    }
    function position(edge,u,y,d=0){
      const t=(u-edge.start)/edge.length;
      return [edge.a[0]+edge.tx*(u-edge.start)+d*(edge.ma[0]+(edge.mb[0]-edge.ma[0])*t),y,
        edge.a[2]+edge.tz*(u-edge.start)+d*(edge.ma[1]+(edge.mb[1]-edge.ma[1])*t)];
    }
    function sample(spacing,put,opts={}){
      if(typeof put!=='function')throw Error('Support course sampling needs an emitter');
      const limit=opts.budget??100000;
      let count=0;
      function emit(p){
        if(++count>limit)throw Error('Support courses exceed their sample budget');
        put(p);
      }
      function finish(p){
        const q=chart(p);
        if(!relief||Math.abs(q.side)>1e-7||distance(p)<=1e-7){emit(p);return;}
        let low=0, high=relief;
        for(let k=0;k<10;k++){
          const d=(low+high)*.5;
          if(distance(position(q.edge,q.u,p[1],-d))>0)low=d;
          else high=d;
        }
        emit(position(q.edge,q.u,p[1],-high));
      }
      skirt.sample(spacing,finish,opts);
      if(!relief)return count;
      // Supply candidates inside narrow joints as well as on the regular carrier grid.
      function seam(u,y,e){
        const p=position(e,u,y);
        if(y>skirt.bottom(p[0],p[2])+.002&&y<skirt.top(p[0],p[2])+skirt.overlap-.002)finish(p);
      }
      for(const row of layout.rows){
        if(row.index)for(const e of edges){
          const n=Math.max(1,Math.ceil(e.length/spacing));
          for(let i=0;i<n;i++)seam(e.start+e.length*(i+.5)/n,top-row.min,e);
        }
        for(const c of row.cells){
          const u=c.bounds.min[0],v=(row.min+row.max)*.5;
          if(layout.jointDistance(u,v)<=0)continue;
          const e=edges.find(e=>u<e.start+e.length)||edges.at(-1);
          seam(u,top-v,e);
        }
      }
      return count;
    }
    return Object.freeze({layout,depth:relief,top,lookup,distance,sample});
  };
})(KIT);
