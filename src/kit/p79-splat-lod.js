/* Error-driven Gaussian splat merging with explicit ownership and silhouette guards. */
(function (K) {
  const P=K.procedural,V=K.V,EPS=1e-10,
    integer=(n,a,b)=>Number.isSafeInteger(n)&&n>=a&&n<=b,
    finite=(n,a,b)=>Number.isFinite(n)&&n>=a&&n<=b,
    name=s=>typeof s==='string'&&s.length<=240,
    vector=p=>Array.isArray(p)&&p.length===3&&p.every(v=>finite(v,-1e6,1e6)),
    covar=(n,r)=>{
      const f=r*r,k=f*0.9775,[x,y,z]=n;
      return [f-k*x*x,-k*x*y,-k*x*z,f-k*y*y,-k*y*z,f-k*z*z];
    },
    square=([x,y,z])=>[x*x,x*y,x*z,y*y,y*z,z*z];
  function covariance(raw){
    if(!Array.isArray(raw)||raw.length!==6||!raw.every(v=>finite(v,-1e12,1e12)))
      throw new Error('Splat covariances need six finite symmetric components');
    const [a,b,c,d,e,f]=raw, peak=Math.max(a,d,f),
      determinant=a*(d*f-e*e)-b*(b*f-e*c)+c*(b*e-d*c);
    if(a<=0||d<=0||f<=0||a*d<b*b-EPS*peak*peak||d*f<e*e-EPS*peak*peak||a*f<c*c-EPS*peak*peak||
      determinant < -EPS*peak**3)throw new Error('Splat covariance must be positive semidefinite');
    return raw.slice();
  }
  const area=(c,n)=>{
    const [x,y,z]=n,[a,b,d,e,f,g]=c;
    const projected=x*x*(e*g-f*f)+y*y*(a*g-d*d)+z*z*(a*e-b*b)+
      2*(x*y*(d*f-b*g)+x*z*(b*f-d*e)+y*z*(b*d-a*f));
    return Math.max(Math.sqrt(Math.max(0,projected)),Number.EPSILON*Math.max(a,e,g));
  };

  function mergeSplats(input,{
    target,ratio=0.5,maxDistance=0.16,minNormal=0.9,maxColor=0.18,maxError=1.4,
    maxRadius=maxDistance*1.65,viewDirections=[],silhouette=0.17,lockSeams=true,maxPairs=1900000
  }={}){
    if(!Array.isArray(input)||input.length>100000||
      (target!==undefined&&!integer(target,0,input.length))||!finite(ratio,0,1)||
      !finite(maxDistance,1e-6,1e4)||!finite(maxRadius,1e-6,1e5)||!finite(minNormal,0,0.999999)||
      !finite(maxColor,1e-6,3)||!finite(maxError,0,1e6)||
      !Array.isArray(viewDirections)||viewDirections.length>24||!viewDirections.every(v=>vector(v)&&V.len(v)>EPS)||
      !finite(silhouette,0,1)||typeof lockSeams!=='boolean'||!integer(maxPairs,1,10000000))
      throw new Error('Splat LOD needs bounded samples, error and view controls');
    const views=viewDirections.map(v=>V.norm(v)), goal=target??Math.floor(input.length*ratio),
      ids=new Set(), grid=new Map(), work={pairs:0,merged:0,protected:0,maxError:0},
      nodes=Array.from(input,(raw,i)=>{
        const {id=String(i),position,normal,radius,opacity=1,color,owner='',material='',surface='',protect=false}=raw??{};
        if(!name(id)||!id.length||ids.has(id)||!vector(position)||!vector(normal)||V.len(normal)<EPS||
          !vector(color)||!color.every(v=>finite(v,0,1))||!finite(opacity,1e-8,1)||
          ![owner,material,surface].every(name)||typeof protect!=='boolean'||
          (raw?.covariance===undefined&&!finite(radius,1e-6,1e5)))
          throw new Error('Splat LOD records need stable IDs, geometry and normalized color');
        ids.add(id);
        const n=V.norm(normal),c=raw.covariance===undefined?covar(n,radius):covariance(raw.covariance),
          projected=area(c,n),locked=protect||views.some(view=>Math.abs(V.dot(view,n))<=silhouette);
        return {index:i,id,position:position.slice(),normal:n,covariance:c,opacity,
          color:color.slice(),owner,material,surface,weight:projected*opacity,
          group:JSON.stringify([owner,material,surface]),locked,alive:true,first:i};
      });
    const cell=p=>p.map(v=>Math.floor(v/maxDistance)), key=q=>q.join('/');
    function put(n){
      n.slot=key(cell(n.position));
      if(!grid.has(n.slot))grid.set(n.slot,new Set());
      grid.get(n.slot).add(n);
    }
    function remove(n){
      n.alive=false;
      const group=grid.get(n.slot);
      group.delete(n);
      if(!group.size)grid.delete(n.slot);
    }
    function* near(n){
      const [x,y,z]=cell(n.position);
      for(let c=-1;c<=1;c++)for(let b=-1;b<=1;b++)for(let a=-1;a<=1;a++){
        const group=grid.get(key([x+a,y+b,z+c]));
        if(!group)continue;
        for(const m of group)if(m!==n)yield m;
      }
    }
    for(const n of nodes)put(n);
    let capped=false;
    function compare(){
      if(work.pairs>=maxPairs){capped=true;return false;}
      work.pairs++;
      return true;
    }
    if(lockSeams&&goal<nodes.length){
      scan:
      for(const n of nodes)for(const m of near(n)){
        if(n.index>=m.index)continue;
        if(!compare())break scan;
        if(n.group!==m.group&&V.dist(n.position,m.position)<=maxDistance)n.locked=m.locked=true;
      }
    }
    work.protected=nodes.filter(n=>n.locked).length;
    const heap=new ProceduralHeap((a,b)=>a.score<b.score||
      (a.score===b.score&&(a.a.first<b.a.first||(a.a.first===b.a.first&&a.b.first<b.b.first))));
    function enqueue(a,b){
      if(a.first>b.first)[a,b]=[b,a];
      if(a.locked||b.locked||a.group!==b.group||!compare())return;
      const d=V.dist(a.position,b.position), c=V.dist(a.color,b.color), alignment=V.dot(a.normal,b.normal);
      if(d>maxDistance||c>maxColor||alignment<minNormal)return;
      const weight=a.weight+b.weight,u=a.weight/weight,v=b.weight/weight,
        position=V.add(V.mul(a.position,u),V.mul(b.position,v)),
        normal=V.norm(V.add(V.mul(a.normal,u),V.mul(b.normal,v))),
        da=square(V.sub(a.position,position)),db=square(V.sub(b.position,position)),
        covariance=a.covariance.map((q,i)=>u*(q+da[i])+v*(b.covariance[i]+db[i])),
        size=Math.sqrt(Math.max(covariance[0],covariance[3],covariance[5])),
        score=(d/maxDistance)**2+0.45*(c/maxColor)**2+0.65*Math.max(0,1-alignment)/(1-minNormal);
      if(score>maxError||size>maxRadius)return;
      heap.push({a,b,position,normal,covariance,weight,score,opacity:Math.min(1,weight/area(covariance,normal)),
        color:V.add(V.mul(a.color,u),V.mul(b.color,v))});
    }
    let active=nodes.length;
    if(!capped&&goal<active){
      first:
      for(const n of nodes)for(const m of near(n)){
        if(n.index>=m.index)continue;
        enqueue(n,m);
        if(capped)break first;
      }
    }
    while(active>goal&&heap.size){
      const hit=heap.pop(),{a,b}=hit;
      if(!a.alive||!b.alive)continue;
      const n={index:nodes.length,id:a.id,position:hit.position,normal:hit.normal,covariance:hit.covariance,
        opacity:hit.opacity,color:hit.color,owner:a.owner,material:a.material,surface:a.surface,group:a.group,
        weight:hit.weight,locked:false,alive:true,first:a.first,parts:[a,b]};
      remove(a);
      remove(b);
      nodes.push(n);
      put(n);
      active--;
      work.merged++;
      work.maxError=Math.max(work.maxError,hit.score);
      if(active>goal&&!capped)for(const peer of near(n)){
        enqueue(n,peer);
        if(capped)break;
      }
    }
    const splats=nodes.filter(n=>n.alive).sort((a,b)=>a.first-b.first).map(n=>{
      const {id,position,normal,covariance,opacity,color,owner,material,surface,locked:protect}=n,
        members=[], pending=[n];
      while(pending.length){
        const node=pending.pop();
        if(node.parts)pending.push(node.parts[1],node.parts[0]);
        else members.push(node.id);
      }
      return {id,position,normal,covariance,opacity,color,owner,material,surface,protect,members};
    });
    return P.data.freeze({status:active<=goal?'ok':capped?'budget':'constrained',splats,work});
  }

  function packSplats(input,{alphaScale=3}={}){
    const splats=Array.isArray(input)?input:input?.splats;
    if(!Array.isArray(splats)||splats.length>100000||!finite(alphaScale,1e-6,10))
      throw new Error('Native splat packing needs a bounded static splat list');
    const data=new Float32Array(splats.length*16);
    for(const [i,p] of splats.entries()){
      if(!vector(p?.position)||!vector(p?.color)||!p.color.every(v=>finite(v,0,1))||!finite(p.opacity,0,1))
        throw new Error('Invalid native splat');
      const [r,g,b]=p.color.map(v=>Math.round(v*255)),
        [xx,xy,xz,yy,yz,zz]=covariance(p.covariance),
        [x,y,z]=p.position;
      data.set([x,y,z,p.opacity*alphaScale,xx,xy,xz,r+256*g+65536*b,yy,yz,zz,0,0,0,0,0],i*16);
    }
    return {count:splats.length,data};
  }

  P.lod={mergeSplats,packSplats};
})(KIT);
