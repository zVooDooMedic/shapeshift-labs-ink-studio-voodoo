/* Closed fitted bands on paired world-space rails. */
(function(K) {
  const P=K.procedural||K.authoring,{V}=K;
  const EPS=1e-7;
  const vector=p=>Array.isArray(p)&&p.length===3&&Array.from(p).every(Number.isFinite);
  function fittedRailBand(spec={}) {
    const {inner,outer,pitch,gap=0,closed=false,phase=0,sections,measure,depth,direction,cellStyle,budget=1024}=spec;
    const validDepth=range=>Array.isArray(range)&&range.length===2&&range.every(Number.isFinite)&&range[1]-range[0]>=EPS;
    if(!validDepth(depth)||cellStyle!==undefined&&typeof cellStyle!=='function'||
       typeof direction!=='function'||!Array.isArray(inner)||!Array.isArray(outer)||
       !Array.from(inner).every(vector)||!Array.from(outer).every(vector))
      throw new Error('Fitted rail bands need paired 3D rails, a direction sampler and increasing depths');
    const layout=P.fittedRibbon({inner,outer,pitch,gap,closed,phase,sections,measure,budget});
    const triangleFaces=[[0,1,2],[3,4,5],[0,1,4,3],[1,2,5,4],[2,0,3,5]];
    const quadFaces=[[0,1,2,3],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]];
    return Object.freeze({layout,pieces(meta={}) {
      const parts=[];
      for(const cell of layout.cells){
        const treatment=cellStyle?.(cell), range=treatment?.depth??depth, material=treatment?.material;
        if(!validDepth(range)||material!==undefined&&(typeof material!=='string'||!material))
          throw new Error('Fitted band cell treatment needs valid depths and material');
        const [lo,hi]=range;
        for(const [index,part] of cell.fragments.entries()){
          const q=part.points,center=V.mul(q.reduce((sum,p)=>V.add(sum,p),[0,0,0]),.25);
          const axis=direction(center,part,cell);
          if(!vector(axis)||V.len(axis)<EPS)throw new Error('Fitted band direction must be a finite nonzero vector');
          const n=V.norm(axis);
          const normal=V.cross(V.sub(q[1],q[0]),V.sub(q[2],q[0]));
          const planar=V.len(normal)>EPS&&Math.abs(V.dot(V.norm(normal),V.sub(q[3],q[0])))<EPS;
          const convex=planar&&q.every((p,i)=>{
            const a=q[(i+1)%4],b=q[(i+2)%4];
            return V.dot(V.cross(V.sub(a,p),V.sub(b,a)),V.norm(normal))>EPS;
          });
          const sections=convex?[q]:[[q[0],q[1],q[2]],[q[0],q[2],q[3]]];
          for(const [side,section] of sections.entries()){
            const normal=V.cross(V.sub(section[1],section[0]),V.sub(section[2],section[0]));
            if(Math.abs(V.dot(normal,n))<=EPS)continue;
            const vertices=[lo,hi].flatMap(h=>section.map(p=>V.mad(p,n,h)));
            const faces=convex?quadFaces:triangleFaces;
            parts.push(P.pieces.convex(vertices,faces,{...meta,...(material!==undefined&&{material}),
              ...(cell.section!==undefined&&{section:cell.section}),cell:cell.key,fragment:index,side,
              key:`${meta.key??'band'}/${cell.key}/${index}/${side}`}));
          }
        }
      }
      return parts;
    }});
  }
  P.fittedRailBand=fittedRailBand;
})(KIT);
