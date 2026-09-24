/* Extinction Fighters — procedural prehistoric creatures for the 3D view.
   Every animal is sculpted in code: a smooth body "swept" along a spine curve and
   skinned to a skeleton (so necks and tails bend), jointed legs with a walk cycle,
   and species details — T. rex's tiny arms, Spinosaurus's sail, frills, plates,
   feathers, pterosaur wings, flippers. Players' colours show up as stripes, crests,
   frills, sails and feathers so every dino stays recognisable.
   Requires THREE r149 + EFInk. Exposes window.EFDinos = { build, pose, kit }. */
(function(){
"use strict";
const T = window.THREE, INK = window.EFInk;
if(!T || !INK) return;
const PI = Math.PI;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const smooth=(a,b,x)=>{ const t=clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); };
const fract=(x)=>x-Math.floor(x);

/* ================================================================ geometry kit */
function hash3(i,j,k){ const s=Math.sin(i*127.1+j*311.7+k*74.7)*43758.5453; return s-Math.floor(s); }
function noise3(x,y,z){
  const i=Math.floor(x), j=Math.floor(y), k=Math.floor(z), fx=x-i, fy=y-j, fz=z-k;
  const u=fx*fx*(3-2*fx), v=fy*fy*(3-2*fy), w=fz*fz*(3-2*fz);
  return lerp(lerp(lerp(hash3(i,j,k),hash3(i+1,j,k),u), lerp(hash3(i,j+1,k),hash3(i+1,j+1,k),u), v),
              lerp(lerp(hash3(i,j,k+1),hash3(i+1,j,k+1),u), lerp(hash3(i,j+1,k+1),hash3(i+1,j+1,k+1),u), v), w);
}
const _q=new T.Quaternion(), _e=new T.Euler(), _p=new T.Vector3(), _s=new T.Vector3();
function M4(x,y,z,rx,ry,rz,sx,sy,sz){
  _e.set(rx||0,ry||0,rz||0); _q.setFromEuler(_e); _p.set(x||0,y||0,z||0);
  const a=sx==null?1:sx; _s.set(a, sy==null?a:sy, sz==null?a:sz);
  return new T.Matrix4().compose(_p,_q,_s);
}
/* non-indexed copy with position/normal/color only (colour = constant, fn(x,y,z,C) or keep existing) */
function prep(geo, col, m){
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  ["uv","uv2","skinIndex","skinWeight"].forEach(a=>{ if(g.attributes[a]) g.deleteAttribute(a); });
  if(!g.attributes.normal) g.computeVertexNormals();
  if(m) g.applyMatrix4(m);
  if(col!=null || !g.attributes.color){
    const P=g.attributes.position, n=P.count, a=new Float32Array(n*3), C=new T.Color(0xffffff);
    for(let i=0;i<n;i++){ if(typeof col==="function") col(P.getX(i),P.getY(i),P.getZ(i),C); else if(col!=null) C.set(col);
      a[i*3]=C.r; a[i*3+1]=C.g; a[i*3+2]=C.b; }
    g.setAttribute("color", new T.BufferAttribute(a,3));
  }
  return g;
}
function merge(list){
  let n=0; list.forEach(g=>n+=g.attributes.position.count);
  const P=new Float32Array(n*3), N=new Float32Array(n*3), C=new Float32Array(n*3); let o=0;
  list.forEach(g=>{ P.set(g.attributes.position.array,o*3); N.set(g.attributes.normal.array,o*3); C.set(g.attributes.color.array,o*3); o+=g.attributes.position.count; });
  const out=new T.BufferGeometry();
  out.setAttribute("position",new T.BufferAttribute(P,3)); out.setAttribute("normal",new T.BufferAttribute(N,3)); out.setAttribute("color",new T.BufferAttribute(C,3));
  out.computeBoundingSphere(); return out;
}
/* weld duplicate vertices so displaced shapes stay watertight with smooth normals */
function weld(geo){
  const P=geo.attributes.position, map=new Map(), remap=new Uint32Array(P.count), pos=[];
  for(let i=0;i<P.count;i++){ const x=P.getX(i), y=P.getY(i), z=P.getZ(i);
    const k=Math.round(x*1e4)+","+Math.round(y*1e4)+","+Math.round(z*1e4);
    let j=map.get(k); if(j===undefined){ j=pos.length/3; pos.push(x,y,z); map.set(k,j); } remap[i]=j; }
  const idx=[], I=geo.index;
  if(I){ for(let k=0;k<I.count;k++) idx.push(remap[I.getX(k)]); } else for(let i=0;i<P.count;i++) idx.push(remap[i]);
  const g=new T.BufferGeometry(); g.setAttribute("position",new T.Float32BufferAttribute(pos,3)); g.setIndex(idx); return g;
}
function blob(detail, amp, freq, seed){
  const g=weld(new T.IcosahedronGeometry(1,detail)), P=g.attributes.position;
  for(let i=0;i<P.count;i++){ const x=P.getX(i), y=P.getY(i), z=P.getZ(i);
    const d=1+(noise3(x*freq+seed,y*freq,z*freq)-0.5)*2*amp; P.setXYZ(i,x*d,y*d,z*d); }
  g.computeVertexNormals(); return g;
}

/* ---- Catmull-Rom sweep: a smooth tube with an elliptical, belly-flattened cross-section ---- */
function crPoint(nodes,s,out){
  const n=nodes.length, i=Math.min(n-2,Math.max(0,Math.floor(s))), t=s-i;
  const p0=nodes[Math.max(0,i-1)], p1=nodes[i], p2=nodes[i+1], p3=nodes[Math.min(n-1,i+2)];
  const t2=t*t, t3=t2*t;
  for(let k=0;k<4;k++){ const a=p0[k], b=p1[k], c=p2[k], d=p3[k];
    out[k]=0.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t2+(-a+3*b-3*c+d)*t3); }
  return out;
}
/* nodes: [[z, y, halfWidth, halfHeight], ...] with z increasing. Returns {geo, frame(s), surf(s,a)} */
function sweep(nodes, o){
  o=o||{};
  const seg=o.seg||18, n=nodes.length, belly=o.belly==null?0.85:o.belly, dens=o.density||12;
  const v=[0,0,0,0], va=[0,0,0,0], vb=[0,0,0,0];
  function frame(s){
    crPoint(nodes,s,v); crPoint(nodes,Math.max(0,s-0.01),va); crPoint(nodes,Math.min(n-1,s+0.01),vb);
    let tz=vb[0]-va[0], ty=vb[1]-va[1]; const l=Math.hypot(tz,ty)||1; tz/=l; ty/=l;
    return { z:v[0], y:v[1], w:Math.max(0.004,v[2]), h:Math.max(0.004,v[3]), uy:tz, uz:-ty };
  }
  function vert(f,a,out){
    const ca=Math.cos(a), sa=Math.sin(a), hy=sa<0?sa*belly:sa;
    out.set(ca*f.w, f.y+f.uy*hy*f.h, f.z+f.uz*hy*f.h); return out;
  }
  const ss=[0];
  for(let i=0;i<n-1;i++){ const L=Math.hypot(nodes[i+1][0]-nodes[i][0],nodes[i+1][1]-nodes[i][1]); const k=Math.max(2,Math.ceil(L*dens)); for(let j=1;j<=k;j++) ss.push(i+j/k); }
  const R=ss.length, pos=[], col=[], idx=[], sI=[], sW=[], C=new T.Color(), V=new T.Vector3();
  for(let r=0;r<R;r++){
    const s=ss[r], f=frame(s), sk=o.skin?o.skin(s):null;
    for(let k=0;k<seg;k++){
      const a=k/seg*PI*2-PI/2;
      vert(f,a,V);
      if(o.ridge){ const rh=o.ridge(s); if(rh){ const up=Math.pow(Math.max(0,Math.sin(a)),10)*rh; V.y+=f.uy*up; V.z+=f.uz*up; } }
      pos.push(V.x,V.y,V.z);
      if(o.color){ o.color(s,Math.sin(a),Math.cos(a),C,V.x,V.y,V.z); col.push(C.r,C.g,C.b); }
      if(sk){ sI.push(sk[0],sk[1],0,0); sW.push(sk[2],sk[3],0,0); }
    }
  }
  for(let r=0;r<R-1;r++) for(let k=0;k<seg;k++){
    const a=r*seg+k, b=r*seg+(k+1)%seg, c=(r+1)*seg+k, d=(r+1)*seg+(k+1)%seg;
    idx.push(a,b,c, b,d,c);
  }
  if(o.caps){
    [0,R-1].forEach((r,end)=>{
      const f=frame(ss[r]), ci=pos.length/3, sk=o.skin?o.skin(ss[r]):null;
      pos.push(0,f.y,f.z);
      if(o.color){ col.push(col[r*seg*3],col[r*seg*3+1],col[r*seg*3+2]); }
      if(sk){ sI.push(sk[0],sk[1],0,0); sW.push(sk[2],sk[3],0,0); }
      for(let k=0;k<seg;k++){ const a=r*seg+k, b=r*seg+(k+1)%seg; if(end) idx.push(ci,a,b); else idx.push(ci,b,a); }
    });
  }
  const geo=new T.BufferGeometry();
  geo.setAttribute("position",new T.Float32BufferAttribute(pos,3));
  if(o.color) geo.setAttribute("color",new T.Float32BufferAttribute(col,3));
  if(o.skin){ geo.setAttribute("skinIndex",new T.Uint16BufferAttribute(sI,4)); geo.setAttribute("skinWeight",new T.Float32BufferAttribute(sW,4)); }
  geo.setIndex(idx); geo.computeVertexNormals();
  return { geo, frame, surf(s,a){ const f=frame(s); const p=vert(f,a,new T.Vector3());
    const nx=Math.cos(a)/f.w, nu=Math.sin(a)/f.h; const nn=new T.Vector3(nx,f.uy*nu,f.uz*nu).normalize(); return {p,n:nn}; } };
}
/* a limb segment hanging down -Y from its joint */
function segGeo(len,r0,r1,col,o){
  o=o||{}; const fz=o.fz||1, bu=o.bulge||1.06, rm=lerp(r0,r1,0.3)*bu;
  const g=sweep([[0,0,r0,r0*fz],[len*0.4,0,rm,rm*fz],[len,0,r1,r1*fz]],{seg:12,belly:1,density:10,caps:true,color:col}).geo;
  g.rotateX(PI/2); return g;
}
/* a flat extruded shape (sails, frills, plates, wing membranes, fins) */
function slab(points, depth, col, bevel){
  const sh=new T.Shape(); points.forEach((p,i)=>i?sh.lineTo(p[0],p[1]):sh.moveTo(p[0],p[1]));
  const g=new T.ExtrudeGeometry(sh,{depth, bevelEnabled:!!bevel, bevelThickness:bevel||0, bevelSize:bevel||0, bevelSegments:1, curveSegments:4});
  g.translate(0,0,-depth/2);
  return prep(g,col);
}
/* a half-disc slab with interior rings (radial colour gradients need interior vertices):
   points at (cos θ·rw·prof(θ)·r, sin θ·rh·prof(θ)·r), θ∈[0,π], r∈[0,1] */
function polarSlab(rw,rh,prof,thick,col,rings,segs){
  rings=rings||6; segs=segs||30; const pos=[], idx=[], per=(rings+1)*(segs+1);
  [thick/2,-thick/2].forEach(z=>{ for(let i=0;i<=rings;i++) for(let j=0;j<=segs;j++){ const th=PI*j/segs, r=i/rings, pr=prof?prof(th):1;
    pos.push(Math.cos(th)*rw*pr*r, Math.sin(th)*rh*pr*r, z); } });
  const V=(f,i,j)=>f*per+i*(segs+1)+j;
  for(let i=0;i<rings;i++) for(let j=0;j<segs;j++){
    idx.push(V(0,i,j),V(0,i+1,j),V(0,i,j+1), V(0,i,j+1),V(0,i+1,j),V(0,i+1,j+1));
    idx.push(V(1,i,j),V(1,i,j+1),V(1,i+1,j), V(1,i,j+1),V(1,i+1,j+1),V(1,i+1,j)); }
  for(let j=0;j<segs;j++) idx.push(V(0,rings,j),V(1,rings,j),V(0,rings,j+1), V(0,rings,j+1),V(1,rings,j),V(1,rings,j+1));
  for(let i=0;i<rings;i++){ idx.push(V(0,i,0),V(1,i,0),V(0,i+1,0), V(0,i+1,0),V(1,i,0),V(1,i+1,0));
    idx.push(V(0,i,segs),V(0,i+1,segs),V(1,i,segs), V(0,i+1,segs),V(1,i+1,segs),V(1,i,segs)); }
  const g=new T.BufferGeometry(); g.setAttribute("position",new T.Float32BufferAttribute(pos,3)); g.setIndex(idx); g.computeVertexNormals();
  return prep(g,col);
}
const CONE=new T.ConeGeometry(1,1,6), SPHERE=new T.SphereGeometry(1,14,10), SPHERE_LO=new T.SphereGeometry(1,10,7);
/* orient +Z of `obj` along worldDir (with an up hint) inside `parent` (all built at the origin) */
const _m=new T.Matrix4(), _pq=new T.Quaternion(), _o=new T.Vector3();
function orient(obj,parent,worldPos,worldDir,up){
  parent.updateMatrixWorld(true);
  obj.position.copy(parent.worldToLocal(worldPos.clone()));
  _m.lookAt(worldDir, _o.set(0,0,0), up||new T.Vector3(0,1,0));
  const q=new T.Quaternion().setFromRotationMatrix(_m);
  parent.getWorldQuaternion(_pq); obj.quaternion.copy(_pq.invert().multiply(q));
  parent.add(obj); return obj;
}

/* ================================================================ species */
const HEADS = {
  theropod:{ z:[0,.22,.5,.78,.95,1], dy:[0,.01,-.045,-.09,-.12,-.13],  w:[.85,1,.8,.56,.34,.04], h:[.8,1,.8,.56,.38,.06] },
  rex:     { z:[0,.22,.5,.78,.95,1], dy:[0,.01,-.04,-.08,-.11,-.12],   w:[.9,1,.86,.64,.44,.05],  h:[.85,1,.92,.72,.48,.08] },
  croc:    { z:[0,.18,.42,.72,.92,1], dy:[0,0,-.03,-.05,-.055,-.06],   w:[.8,1,.52,.38,.46,.04],  h:[.8,1,.52,.34,.32,.05] },
  beak:    { z:[0,.3,.55,.8,.95,1], dy:[0,.02,-.05,-.1,-.14,-.16],     w:[.8,1,.7,.44,.24,.03],   h:[.8,1,.7,.44,.24,.03] },
  dome:    { z:[0,.25,.52,.78,.95,1], dy:[0,.14,-.02,-.08,-.12,-.13],  w:[.85,1,.82,.56,.38,.05], h:[.9,1.6,.86,.56,.38,.06] },
  duck:    { z:[0,.22,.5,.78,.95,1], dy:[0,0,-.1,-.2,-.25,-.26],       w:[.8,1,.72,.8,.74,.1],    h:[.8,1,.68,.42,.3,.06] },
  iguano:  { z:[0,.22,.5,.78,.95,1], dy:[0,0,-.08,-.16,-.2,-.21],      w:[.8,1,.72,.52,.34,.04],  h:[.8,1,.74,.5,.34,.05] },
  cerat:   { z:[0,.25,.55,.8,.95,1], dy:[0,0,-.1,-.2,-.28,-.34],       w:[.85,1,.7,.46,.28,.04],  h:[.9,1,.82,.64,.46,.06] },
  ankylo:  { z:[0,.3,.6,.85,.97,1], dy:[0,0,-.04,-.08,-.1,-.11],       w:[.9,1,.92,.78,.56,.06],  h:[.85,1,.8,.6,.42,.06] },
  stego:   { z:[0,.25,.55,.8,.95,1], dy:[0,0,-.05,-.1,-.13,-.14],      w:[.85,1,.7,.45,.28,.04],  h:[.85,1,.75,.5,.32,.05] },
  sauro:   { z:[0,.25,.5,.75,.93,1], dy:[0,.02,-.06,-.14,-.2,-.22],    w:[.8,1,.86,.76,.6,.08],   h:[.85,1,.8,.6,.42,.06] },
  brachio: { z:[0,.25,.5,.75,.93,1], dy:[0,.1,-.04,-.14,-.2,-.22],     w:[.8,1,.86,.72,.56,.08],  h:[.85,1.4,.92,.6,.42,.06] },
  diplo:   { z:[0,.22,.5,.78,.95,1], dy:[0,.01,-.06,-.12,-.16,-.17],   w:[.8,1,.8,.72,.66,.08],   h:[.85,1,.7,.46,.34,.05] },
  swim:    { z:[0,.3,.6,.85,.97,1], dy:[0,0,-.02,-.04,-.05,-.05],      w:[.85,1,.6,.34,.2,.03],   h:[.85,1,.6,.34,.2,.03] },
  plio:    { z:[0,.2,.5,.8,.95,1], dy:[0,0,-.03,-.06,-.07,-.075],      w:[.9,1,.76,.52,.38,.04],  h:[.9,1,.72,.48,.34,.05] },
  mosa:    { z:[0,.22,.5,.78,.94,1], dy:[0,0,-.03,-.06,-.08,-.09],     w:[.85,1,.74,.5,.3,.04],   h:[.85,1,.7,.46,.3,.04] },
  tylo:    { z:[0,.22,.5,.78,.94,1], dy:[0,0,-.03,-.05,-.06,-.06],     w:[.85,1,.7,.42,.2,.02],   h:[.85,1,.66,.4,.22,.03] },
  ichthy:  { z:[0,.18,.35,.65,.93,1], dy:[0,0,-.02,-.04,-.05,-.05],    w:[.9,1,.45,.2,.12,.02],   h:[.9,1,.5,.22,.14,.02] },
  ptero:   { z:[0,.2,.45,.75,.93,1], dy:[0,.02,-.01,-.03,-.04,-.045],  w:[.8,1,.55,.3,.14,.02],   h:[.85,1,.6,.34,.16,.02] },
  turtle:  { z:[0,.3,.6,.85,.97,1], dy:[0,0,-.04,-.1,-.16,-.2],        w:[.9,1,.9,.7,.4,.04],     h:[.9,1,.9,.7,.46,.05] },
};
const IRIS={ hunter:0xf2b33d, calm:0x5a3a22, sea:0x2f3a44, sky:0xd88a30 };
const SPECIES = {
  // apex predators
  "Tyrannosaurus rex":   {b:"theropod",h:3.9,head:"rex",skull:1.5,skullH:.64,skullW:.54,neck:.72,arm:.34,body:1.9,bodyH:.8,bodyW:.64,tail:3.3,jawH:.38,c:[0x5b4633,0xd8c29a],p:"stripes",a:0xa8452e},
  "Giganotosaurus":      {b:"theropod",h:3.9,skull:1.65,skullH:.56,skullW:.42,neck:.8,arm:.5,body:2.0,bodyH:.74,bodyW:.56,tail:3.7,brow:1,c:[0x6b5d4c,0xd6c7a6],p:"bands",a:0x8a3a2a},
  "Carcharodontosaurus": {b:"theropod",h:3.8,skull:1.6,skullH:.55,skullW:.4,arm:.5,body:1.95,bodyH:.74,bodyW:.56,tail:3.6,brow:1,c:[0x8a6a48,0xe2cfa8],p:"stripes",a:0xc2703a},
  "Allosaurus":          {b:"theropod",h:3.4,skull:1.3,skullH:.5,skullW:.38,arm:.66,browHorn:.24,c:[0x7a5a3c,0xdcc59c],p:"stripes",a:0xc04a2a},
  "Carnotaurus":         {b:"theropod",h:3.2,skull:.95,skullH:.58,skullW:.46,neck:.72,arm:.22,horns:.45,body:1.7,tail:3.2,thigh:1.05,shin:1.12,c:[0x8c3e2e,0xe0c09a],p:"spots",a:0x2f2522},
  "Ceratosaurus":        {b:"theropod",h:3.2,skull:1.25,skullH:.52,skullW:.36,arm:.55,noseHorn:.34,brow:1,ridge:.1,c:[0x57493c,0xcdb896],p:"bands",a:0xd9a13b},
  "Spinosaurus":         {b:"theropod",h:4.3,head:"croc",skull:1.8,skullH:.4,skullW:.28,neck:1.05,neckUp:.7,arm:.85,sail:1.8,body:2.1,bodyH:.66,bodyW:.52,tail:3.8,tailDeep:1,thigh:.85,shin:.8,meta:.45,c:[0x566656,0xd8cfae],p:"stripes",a:0xc2583a},
  // raptors & small theropods
  "Velociraptor":  {b:"theropod",h:1.6,skull:.95,skullH:.34,skullW:.24,neck:.75,neckUp:.95,arm:.95,body:1.25,bodyH:.46,bodyW:.34,tail:3.0,thigh:.8,shin:.95,meta:.6,feathers:1,sickle:1,c:[0x9a7a52,0xe8dcc0],p:"stripes",a:0x6b4a2e},
  "Deinonychus":   {b:"theropod",h:1.95,skull:1.0,skullH:.4,skullW:.28,neck:.75,neckUp:.9,arm:.95,body:1.35,bodyH:.52,bodyW:.38,tail:3.1,thigh:.85,shin:.95,meta:.55,feathers:1,sickle:1,c:[0x5a5048,0xd0c4ae],p:"bands",a:0x2f4f6f},
  "Utahraptor":    {b:"theropod",h:2.5,skull:1.05,skullH:.44,skullW:.32,neck:.8,neckUp:.85,arm:.95,body:1.5,bodyH:.6,bodyW:.44,tail:3.0,thigh:.9,shin:.9,meta:.5,feathers:1,sickle:1,c:[0x6a5a48,0xd6c8ae],p:"stripes",a:0xb05a2a},
  "Troodon":       {b:"theropod",h:1.6,skull:.8,skullH:.34,skullW:.26,neck:.8,neckUp:.95,arm:.85,body:1.2,bodyH:.44,bodyW:.32,tail:2.8,thigh:.85,shin:1.0,meta:.65,feathers:1,bigEye:1.7,c:[0xa08a60,0xece0c4],p:"spots",a:0x5a7a3a},
  "Microraptor":   {b:"theropod",h:1.25,skull:.7,skullH:.28,skullW:.2,neck:.7,neckUp:.95,arm:1.1,body:1.0,bodyH:.36,bodyW:.26,tail:3.0,thigh:.75,shin:.85,meta:.5,feathers:1,legFeathers:1,c:[0x1f2430,0x3a4050],p:"none",a:0x2a6fd6,iris:0xd8e04a},
  "Compsognathus": {b:"theropod",h:1.05,skull:.7,skullH:.3,skullW:.22,neck:.8,neckUp:.9,arm:.6,body:1.0,bodyH:.4,bodyW:.3,tail:2.9,thigh:.8,shin:.95,meta:.6,c:[0x7a8a4a,0xe0e0b0],p:"stripes",a:0x5a6a2a},
  "Dilophosaurus": {b:"theropod",h:2.7,skull:1.1,skullH:.42,skullW:.3,neck:.9,neckUp:.8,arm:.75,body:1.6,bodyH:.58,bodyW:.44,tail:3.2,crests:1,c:[0x6a7a4a,0xe0d6a8],p:"stripes",a:0xd9433a},
  "Gallimimus":    {b:"theropod",h:2.9,head:"beak",beak:1,skull:.6,skullH:.24,skullW:.2,neck:1.6,neckUp:1.1,neckW:.14,arm:.8,body:1.3,bodyH:.52,bodyW:.4,tail:2.6,thigh:1.1,shin:1.3,meta:.85,feathers:1,iris:IRIS.calm,c:[0xa08a6a,0xefe4cc],p:"none",a:0x6a4a2a},
  // horned
  "Triceratops":      {b:"ceratopsian",h:2.8,frill:1.35,frillH:1.1,browHorn:1.05,noseHorn:.34,c:[0x66664a,0xd6ceae],p:"bands",a:0xc0582a},
  "Styracosaurus":    {b:"ceratopsian",h:2.8,frill:1.0,frillH:.85,spikes:6,noseHorn:.95,browHorn:.14,c:[0x7a5a3e,0xdccaa6],p:"stripes",a:0x3a70b0},
  "Pachyrhinosaurus": {b:"ceratopsian",h:2.5,frill:.95,frillH:.8,boss:1,spikes:2,c:[0x5e5a48,0xd2c8aa],p:"spots",a:0xd0a040},
  "Protoceratops":    {b:"ceratopsian",h:1.5,frill:.85,frillH:.7,skullS:1.1,c:[0xb09a70,0xece0c4],p:"bands",a:0x9a6a3a},
  // armored
  "Ankylosaurus":   {b:"ankylosaur",h:1.75,club:1,c:[0x6a5e46,0xcdbb94],p:"saddle",a:0xb0442a},
  "Euoplocephalus": {b:"ankylosaur",h:1.65,club:1,c:[0x7a6a4a,0xd6c6a0],p:"bands",a:0x5a7a3a},
  "Sauropelta":     {b:"ankylosaur",h:1.6,club:0,shoulder:1,tail:2.9,c:[0x5e5040,0xc9b996],p:"stripes",a:0xd07a2a},
  "Stegosaurus":    {b:"stegosaur",h:3.1,c:[0x6a7050,0xd8cfa0],p:"bands",a:0xd05a2a},
  "Kentrosaurus":   {b:"stegosaur",h:2.4,kentro:1,c:[0x8a7a50,0xe0d4a8],p:"stripes",a:0x3a8a6a},
  // giants
  "Brachiosaurus":   {b:"sauropod",h:7.4,neck:4.6,neckUp:1.12,chestUp:.95,tail:4.2,head:"brachio",c:[0x6a7a6a,0xc9ccb0],p:"bands",a:0x3a6a8a},
  "Diplodocus":      {b:"sauropod",h:5.0,neck:5.4,neckUp:.34,tail:7.4,chestUp:-.12,head:"diplo",spines:1,c:[0x7a6a50,0xd8ccaa],p:"stripes",a:0xa05a2a},
  "Apatosaurus":     {b:"sauropod",h:5.4,neck:4.2,neckW:1.35,neckUp:.52,tail:6.2,c:[0x6a6048,0xcfc4a2],p:"bands",a:0x4a7a8a},
  "Brontosaurus":    {b:"sauropod",h:5.6,neck:4.4,neckW:1.3,neckUp:.56,tail:6.2,c:[0x7a6a5a,0xd6cab0],p:"saddle",a:0x5a8a3a},
  "Mamenchisaurus":  {b:"sauropod",h:6.6,neck:6.8,neckUp:.62,tail:4.8,c:[0x8a7a5a,0xe0d4b4],p:"stripes",a:0xb04a5a},
  "Argentinosaurus": {b:"sauropod",h:6.9,neck:4.8,neckUp:.72,body:3.6,bodyH:1.4,bodyW:1.25,tail:5.2,osteo:1,c:[0x6a625a,0xcfc8b8],p:"spots",a:0x8a5a3a},
  "Patagotitan":     {b:"sauropod",h:6.6,neck:5.0,neckUp:.7,body:3.5,bodyH:1.35,tail:5.4,osteo:1,c:[0x7a6e60,0xd8d0c0],p:"bands",a:0x3a5a8a},
  // grazers
  "Corythosaurus":      {b:"hadrosaur",h:3.5,crest:"helmet",c:[0x5a7a5a,0xdcd6b0],p:"stripes",a:0xd05a3a},
  "Edmontosaurus":      {b:"hadrosaur",h:3.2,crest:"none",c:[0x6a6a5a,0xd8d0b8],p:"bands",a:0x4a7a9a},
  "Iguanodon":          {b:"hadrosaur",h:3.2,head:"iguano",thumb:1,crest:"none",c:[0x6a7a4a,0xd6d2a8],p:"spots",a:0x9a5a2a},
  "Maiasaura":          {b:"hadrosaur",h:3.1,crest:"bumps",c:[0x8a6a4a,0xe2d2b0],p:"stripes",a:0x3a8a8a},
  "Pachycephalosaurus": {b:"theropod",h:2.3,head:"dome",herb:1,skull:.72,skullH:.46,skullW:.36,neck:.6,neckUp:.6,arm:.35,body:1.5,bodyH:.62,bodyW:.52,tail:2.4,thigh:.9,shin:.85,meta:.45,iris:IRIS.calm,c:[0x7a6a4a,0xe0d0b0],p:"spots",a:0xc05a8a},
  "Parasaurolophus":    {b:"hadrosaur",h:3.7,crest:"tube",c:[0x6a5a3a,0xe2d2a8],p:"stripes",a:0xd07a2a},
  // flyers
  "Pteranodon":      {b:"pterosaur",span:6.4,skull:1.25,crest:"long",toothless:1,neck:.6,c:[0x8a8a90,0xf0ece0],a:0x3a6aa0},
  "Quetzalcoatlus":  {b:"pterosaur",span:7.8,skull:1.75,neck:1.35,crest:"small",toothless:1,bodyL:1.1,hover:2.5,c:[0x9a8a78,0xf0e6d8],a:0xd05a3a},
  "Rhamphorhynchus": {b:"pterosaur",span:4.4,skull:.8,neck:.4,longTail:1,c:[0x7a6a52,0xe8dcc0],a:0x3a8a4a},
  "Dimorphodon":     {b:"pterosaur",span:4.0,skull:.75,skullH:.3,neck:.38,longTail:1,c:[0x5a5a6a,0xd8d0c4],a:0xe0b030},
  "Pterodactylus":   {b:"pterosaur",span:3.8,skull:.85,neck:.42,crest:"small",c:[0x8a7a6a,0xece2d2],a:0xb05a8a},
  // marine
  "Plesiosaurus":  {b:"swim",kind:"plesio",L:6.5,neck:2.4,c:[0x4a6a7a,0xd8e4e0],p:"spots",a:0x2a5a8a},
  "Elasmosaurus":  {b:"swim",kind:"plesio",L:8.5,neck:4.0,c:[0x5a6a6a,0xdce4de],p:"bands",a:0x3a8a7a},
  "Kronosaurus":   {b:"swim",kind:"plio",L:7,c:[0x3f5566,0xd0dcdc],p:"spots",a:0x8a3a3a},
  "Liopleurodon":  {b:"swim",kind:"plio",L:7,c:[0x4a4f60,0xd8dcd8],p:"stripes",a:0x5a6aa0},
  "Mosasaurus":    {b:"swim",kind:"mosa",L:8,c:[0x3a5a6a,0xdce6e0],p:"stripes",a:0x2f6f8f},
  "Tylosaurus":    {b:"swim",kind:"mosa",head:"tylo",L:7.5,c:[0x4a5a5a,0xd8e0d8],p:"bands",a:0x8a4a2a},
  "Ichthyosaurus": {b:"swim",kind:"ichthy",L:4.6,c:[0x4a6a8a,0xe8eef0],p:"none",a:0x2a4a6a},
  "Archelon":      {b:"turtle",L:3.8,c:[0x4a5a44,0xd8d4b0],p:"none",a:0x6a8a4a},
};
const ARCH_DEFAULT = { apex:"Tyrannosaurus rex", raptor:"Velociraptor", horned:"Triceratops", armored:"Ankylosaurus",
  giant:"Brachiosaurus", grazer:"Parasaurolophus", flyer:"Pteranodon", marine:"Plesiosaurus" };

/* ================================================================ colour */
function palette(P, accentHex, wild){
  const top=new T.Color(P.c[0]), bel=new T.Color(P.c[1]);
  const acc=new T.Color(wild ? (P.a||P.c[0]) : accentHex);
  const pat=wild ? top.clone().multiplyScalar(0.55) : acc.clone().lerp(top,0.2).multiplyScalar(0.9);
  const carn=/theropod/.test(P.b) && !P.herb && !P.beak;
  return { top, bel, acc, pat, dark:top.clone().multiplyScalar(0.5), claw:new T.Color(0x3b342c), tooth:new T.Color(0xfff4d8),
    mouth:new T.Color(0x8e3442), beak:new T.Color(0x3a3024),
    iris:new T.Color(P.iris || (P.b==="swim"||P.b==="turtle" ? IRIS.sea : P.b==="pterosaur" ? IRIS.sky : carn ? IRIS.hunter : IRIS.calm)),
    slit:carn };
}
/* countershaded skin with a species pattern; `extra` can override per region */
function skinColor(pal, P, extra){
  const pt=P.p||"stripes";
  return (s,sa,ca,C,x,y,z)=>{
    C.copy(pal.bel).lerp(pal.top, smooth(-0.45,0.35,sa));
    let m=0;
    if(pt==="stripes") m=(fract(z*1.25+Math.abs(x)*0.2+noise3(z*1.7,y*1.7,0.5)*0.4)<0.3?1:0)*smooth(-0.1,0.45,sa);
    else if(pt==="bands") m=(fract(z*0.6+noise3(z,y,1.5)*0.25)<0.36?1:0)*smooth(0,0.5,sa);
    else if(pt==="spots") m=(noise3(x*3.1+7,y*3.1,z*3.1)>0.66?1:0)*smooth(-0.3,0.3,sa);
    else if(pt==="saddle") m=smooth(0.2,0.6,sa)*(noise3(x*0.9,y*0.9,z*0.9)>0.47?1:0);
    if(m>0) C.lerp(pal.pat, m*0.85);
    if(sa>0.93) C.lerp(pal.pat,0.3);
    if(extra) extra(s,sa,ca,C,x,y,z);
  };
}
const limbColor=(pal)=>(s,sa,ca,C)=>{ C.copy(pal.top).lerp(pal.pat,0.3).lerp(pal.bel,0.12+smooth(0.2,-0.9,ca)*0.2).multiplyScalar(lerp(1.05,0.72,s/2)); };

/* ================================================================ rig helpers */
function newRig(){ return { legs:[], arms:[], tail:[], neck:[], wings:[], flippers:[], eyes:[],
  tailAmp:1, neckAmp:1, gait:7, bob:0.05, jawRest:0, jawMax:0.55, flap:5.5, blinkOff:Math.random()*5, bodyY:0 }; }
function makeBones(nodes, spec){
  const B={}, list=[];
  spec.forEach(b=>{ const bone=new T.Bone(); bone.name=b.name; const nd=nodes[b.node];
    bone.userData.rest=new T.Vector3(0,nd[1],nd[0]); B[b.name]=bone; list.push(bone);
    if(b.parent){ const P=B[b.parent]; P.add(bone); bone.position.copy(bone.userData.rest).sub(P.userData.rest); }
    else bone.position.copy(bone.userData.rest); });
  return { B, list };
}
function skinFn(order){
  return (s)=>{
    if(s<=order[0].s) return [order[0].i,0,1,0];
    for(let k=0;k<order.length-1;k++){ const A=order[k], Bn=order[k+1]; if(s<=Bn.s){ const t=(s-A.s)/(Bn.s-A.s); return [A.i,Bn.i,1-t,t]; } }
    const L=order[order.length-1]; return [L.i,0,1,0];
  };
}
function skinned(r, nodes, spec, color, mat, o){
  const { B, list }=makeBones(nodes,spec);
  const order=spec.map((b,i)=>({s:b.node,i})).sort((a,b)=>a.s-b.s);
  const sw=sweep(nodes,Object.assign({seg:20,color,skin:skinFn(order)},o||{}));
  const mesh=new T.SkinnedMesh(sw.geo,mat);
  mesh.add(list[0]); mesh.updateMatrixWorld(true);
  mesh.bind(new T.Skeleton(list));
  mesh.castShadow=true; mesh.receiveShadow=true; mesh.frustumCulled=false;
  r.B=B; r.sweep=sw; r.hips=B.hips; r.chest=B.chest;
  return mesh;
}
const rel=(bone,x,y,z)=>new T.Vector3(x,y,z).sub(bone.userData.rest);
function legDrop(segs){ let a=0, d=0; segs.forEach(sg=>{ a+=sg.rest; d+=(sg.len||0)*Math.cos(a); }); return d; }
function limb(parent, at, segs, col, mat, side){
  const joints=[]; let p=parent;
  segs.forEach((sg,i)=>{
    const j=new T.Group(); if(i===0) j.position.copy(at); else j.position.set(0,-(segs[i-1].len||0),0);
    j.rotation.x=sg.rest; if(sg.rz) j.rotation.z=sg.rz*(side||1);
    p.add(j); joints.push(j);
    if(sg.len>0){ const m=new T.Mesh(segGeo(sg.len,sg.r0,sg.r1,col,sg),mat); m.castShadow=true; j.add(m); }
    p=j;
  });
  return joints;
}
/* three toes with claws (+ optional raised raptor sickle claw), pointing along -Y of the toe joint */
function toes(pal, len, r, o){
  o=o||{}; const parts=[], cl=pal.claw, sk=pal.top.clone().multiplyScalar(0.72);
  [-1,0,1].forEach(k=>{
    const L=len*(k===0?1:0.78), rz=k*0.36;
    parts.push(prep(segGeo(L,r,r*0.55,(s,sa,ca,C)=>C.copy(sk)),null,M4(0,0,0,0,0,rz)));
    const tip=new T.Vector3(0,-L,0).applyAxisAngle(new T.Vector3(0,0,1),rz);
    parts.push(prep(CONE,cl,M4(tip.x,tip.y,tip.z-r*0.25,-PI/2-0.5,0,rz,r*0.5,r*1.8,r*0.5)));
  });
  if(o.sickle) parts.push(prep(CONE,cl,M4(o.side*r*0.6,-len*0.28,r*1.4,PI*0.72,0,0,r*0.55,r*3.2,r*0.55)));
  if(o.hoof) return merge([prep(segGeo(len*0.5,r*1.1,r*1.2,(s,sa,ca,C)=>C.copy(sk)))]);
  return merge(parts);
}
function pads(pal, r){  // elephant-like foot with toenails, at the end of a pillar leg
  const parts=[prep(SPHERE_LO,pal.top.clone().multiplyScalar(0.7),M4(0,-r*0.1,r*0.15,0,0,0,r*1.12,r*0.42,r*1.2))];
  for(let k=-1;k<=1;k++) parts.push(prep(SPHERE_LO,0x5a5040,M4(k*r*0.45,-r*0.18,r*1.12,0,0,0,r*0.22,r*0.2,r*0.18)));
  return merge(parts);
}
/* feather leaf + fan (for raptors / Microraptor) */
function leaf(len,wid,c0,c1){
  return sweep([[0,0,0.004,0.003],[len*0.3,0,wid,0.012],[len*0.75,0,wid*0.72,0.009],[len,0,0.004,0.003]],{seg:6,belly:1,density:8,
    color:(s,sa,ca,C)=>{ C.copy(c0).lerp(c1,s/3); if(s>2.45) C.multiplyScalar(0.45); }}).geo;
}
function fan(count,len,wid,spread,c0,c1,axis){
  const parts=[];
  for(let i=0;i<count;i++){ const a=count===1?0:lerp(-spread,spread,i/(count-1)), L=len*(1-Math.abs(a)/(spread||1)*0.25);
    parts.push(prep(leaf(L,wid,c0,c1),null,axis==="y"?M4(0,0,0,0,a,0):M4(0,0,0,a,0,0))); }
  return merge(parts);
}

/* ---- heads: jaw, teeth, eyes, brow — all in "head-local" space (origin = skull base) ---- */
function profileAt(hp,u,sl,sh,sw){
  const z=hp.z; let i=0; while(i<z.length-2 && u>z[i+1]) i++;
  const t=clamp((u-z[i])/(z[i+1]-z[i]),0,1);
  return { dy:lerp(hp.dy[i],hp.dy[i+1],t)*sl, w:lerp(hp.w[i],hp.w[i+1],t)*sw, h:lerp(hp.h[i],hp.h[i+1],t)*sh };
}
function headNodes(hp, z0, y0, sl, sh, sw){ return hp.z.map((u,i)=>[z0+u*sl, y0+hp.dy[i]*sl, Math.max(0.02,hp.w[i]*sw), Math.max(0.02,hp.h[i]*sh)]); }
function eye(r, parent, pos, rad, pal, side){
  const g=new T.Group(); g.position.copy(pos); parent.add(g);
  const d=new T.Vector3(side*0.86,0.06,0.5).normalize();
  const parts=[prep(SPHERE,pal.iris,M4(0,0,0,0,0,0,rad))];
  const pp=d.clone().multiplyScalar(rad*0.8);
  parts.push(prep(SPHERE_LO,0x0c0a0c,M4(pp.x,pp.y,pp.z,0,0,0, pal.slit?rad*0.2:rad*0.36, pal.slit?rad*0.56:rad*0.36, pal.slit?rad*0.2:rad*0.36)));
  const hp=d.clone().multiplyScalar(rad*0.93).add(new T.Vector3(0,rad*0.36,rad*0.12));
  parts.push(prep(SPHERE_LO,0xffffff,M4(hp.x,hp.y,hp.z,0,0,0,rad*0.2)));
  const m=new T.Mesh(merge(parts),r.mat); g.add(m); r.eyes.push(g);
  return g;
}
function headKit(r, head, hp, sl, sh, sw, pal, P, o){
  o=o||{};
  const jawH=sh*(P.jawH||o.jawH||0.3);
  const hinge=(()=>{ const q=profileAt(hp,0.1,sl,sh,sw); return new T.Vector3(0,q.dy-q.h*0.72,0.1*sl); })();
  const us=[0.1,0.38,0.66,0.88,0.97,1.0];
  const jn=us.map((u,i)=>{ const q=profileAt(hp,u,sl,sh,sw), jh=jawH*lerp(1,0.4,u)*(i===us.length-1?0.15:1);
    return [u*sl-hinge.z, (q.dy-q.h*0.8-jh*0.5)-hinge.y, i===us.length-1?0.02:q.w*0.84, Math.max(0.02,jh)]; });
  const beakTip=P.beak||P.toothless||o.beak;
  const jawGeo=[prep(sweep(jn,{seg:14,belly:0.9,color:(s,sa,ca,C)=>{ C.copy(pal.bel).lerp(pal.top,smooth(-0.5,0.4,sa)*0.5);
    if(sa>0.55) C.copy(pal.mouth); if(beakTip && s>3.2) C.copy(pal.beak); }}).geo)];
  const upper=[];
  const teeth=!(P.herb||beakTip||o.noTeeth);
  if(teeth){
    const tl=sh*(o.toothLen||0.14);
    for(let u=0.28;u<0.94;u+=o.toothStep||0.085){
      const q=profileAt(hp,u,sl,sh,sw), L=tl*(1.1-u*0.45);
      [-1,1].forEach(sd=>{
        upper.push(prep(CONE,pal.tooth,M4(sd*q.w*0.7,q.dy-q.h*0.78-L*0.35,u*sl,PI,0,0,L*0.3,L,L*0.3)));
        const jz=u*sl-hinge.z, jy=(q.dy-q.h*0.8+jawH*lerp(1,0.4,u)*0.5)-hinge.y;
        jawGeo.push(prep(CONE,pal.tooth,M4(sd*q.w*0.6,jy+L*0.2,jz,0,0,0,L*0.26,L*0.85,L*0.26)));
      });
    }
  }
  const jaw=new T.Group(); jaw.position.copy(hinge); head.add(jaw);
  const jm=new T.Mesh(merge(jawGeo),r.mat); jm.castShadow=true; jaw.add(jm);
  r.jaw=jaw; r.jawMax=o.jawMax||0.55;
  // eyes + brows
  const eu=o.eyeU||0.26, q=profileAt(hp,eu,sl,sh,sw), er=sh*0.13*(P.bigEye||1)*(o.eyeScale||1);
  [-1,1].forEach(sd=>{
    eye(r, head, new T.Vector3(sd*q.w*0.8, q.dy+q.h*(o.eyeY||0.34), eu*sl), er, pal, sd);
    if(!o.noBrow) upper.push(prep(SPHERE_LO,pal.top.clone().multiplyScalar(0.7),M4(sd*q.w*0.72,q.dy+q.h*(o.eyeY||0.34)+er*0.95,eu*sl+er*0.2,0,0,0,er*1.25,er*(P.brow?0.7:0.45),er*1.7)));
  });
  if(upper.length){ const um=new T.Mesh(merge(upper),r.mat); um.castShadow=true; head.add(um); }
  return { hinge, eu, q, er };
}

/* ================================================================ builders */
/* ---------- bipedal theropods (also Pachycephalosaurus) ---------- */
function theropod(P,pal,mat){
  const r=newRig(); r.mat=mat;
  const tail=P.tail||3.2, body=P.body||1.7, bh=P.bodyH||0.62, bw=P.bodyW||0.5;
  const nl=P.neck||0.85, na=P.neckUp==null?0.8:P.neckUp, nw=P.neckW||bw*0.46;
  const sl=P.skull||1.3, sh=P.skullH||0.5, sw=P.skullW||0.38, hp=HEADS[P.head||"theropod"];
  const legS=[{len:P.thigh||1.0,r0:bh*0.68,r1:0.16*bh/0.62,rest:-0.38,fz:1.3,bulge:1.12},
              {len:P.shin||1.0,r0:0.16*bh/0.62,r1:0.1*bh/0.62,rest:0.9,fz:1.1},
              {len:P.meta||0.58,r0:0.1*bh/0.62,r1:0.075*bh/0.62,rest:-0.92},
              {len:0,rest:-PI/2+0.4}];
  const toeR=0.065*bh/0.62, H=legDrop(legS)+toeR+bh*0.1;
  const hbZ=body+nl*Math.cos(na)*0.95, hbY=0.1+nl*Math.sin(na);
  const td=P.tailDeep?1.5:1;
  const N=[[-tail,-0.14,0.02,0.03],[-tail*0.75,-0.09,bw*0.16,bh*0.18*td],[-tail*0.5,-0.04,bw*0.3,bh*0.32*td],[-tail*0.25,0.01,bw*0.52,bh*0.54],
           [0,0.03,bw*0.82,bh*0.86],[body*0.5,-0.03,bw,bh],[body,0.05,bw*0.8,bh*0.8],
           [body+nl*Math.cos(na)*0.45,0.1+nl*Math.sin(na)*0.5,nw,nw*1.2]];
  const HS=N.length; headNodes(hp,hbZ,hbY,sl,sh,sw).forEach(n=>N.push(n));
  N.forEach(n=>n[1]+=H);
  const spec=[{name:"hips",node:4},{name:"tail1",node:3,parent:"hips"},{name:"tail2",node:2,parent:"tail1"},{name:"tail3",node:1,parent:"tail2"},
              {name:"chest",node:6,parent:"hips"},{name:"neck",node:7,parent:"chest"},{name:"head",node:HS,parent:"neck"}];
  const color=skinColor(pal,P,(s,sa,ca,C)=>{ if(s>HS+0.3 && sa<-0.62) C.copy(pal.mouth); if(P.beak && s>HS+3.4) C.copy(pal.beak); if(P.head==="dome" && s>HS+0.4 && s<HS+1.8 && sa>0.35) C.copy(pal.acc).lerp(pal.bel,0.25); });
  const G=new T.Group(), bodyG=new T.Group(); G.add(bodyG);
  bodyG.add(skinned(r,N,spec,color,mat,{belly:0.82,ridge:P.ridge?((s)=>s>1&&s<HS?P.ridge*(fract(s*3)<0.5?1:0.4):0):null}));
  const B=r.B; r.body=bodyG; r.tail=[B.tail1,B.tail2,B.tail3]; r.neck=[B.neck]; r.head=B.head;
  const lc=limbColor(pal);
  headKit(r,B.head,hp,sl,sh,sw,pal,P,{jawMax:0.62});
  // head ornaments
  const orn=[], q=profileAt(hp,0.24,sl,sh,sw);
  if(P.browHorn) [-1,1].forEach(sd=>orn.push(prep(CONE,pal.acc,M4(sd*q.w*0.55,q.dy+q.h*0.95,0.2*sl,0.35,0,-sd*0.2,sh*0.12,sh*P.browHorn*1.2,sh*0.18))));
  if(P.horns) [-1,1].forEach(sd=>orn.push(prep(CONE,pal.acc.clone().lerp(pal.top,0.3),M4(sd*q.w*0.72,q.dy+q.h*0.82,0.12*sl,0,0,-sd*0.95,sh*0.15,P.horns,sh*0.15))));
  if(P.noseHorn){ const q2=profileAt(hp,0.68,sl,sh,sw); orn.push(prep(CONE,pal.acc,M4(0,q2.dy+q2.h*0.85+P.noseHorn*0.35,0.68*sl,0.25,0,0,0.04,P.noseHorn,0.2))); }
  if(P.crests) [-1,1].forEach(sd=>{ const cw=0.32*sl;
    const g=polarSlab(cw,sh*0.95,(a)=>1+0.12*Math.sin(a*7),0.035,(x,y,z,C)=>{ C.copy(pal.acc).lerp(pal.bel,smooth(0.7,0,y/sh)*0.35); if(Math.hypot(x/cw,y/(sh*0.95))>0.85) C.multiplyScalar(0.7); },4,16);
    g.rotateY(-PI/2); g.translate(sd*0.07,profileAt(hp,0.5,sl,sh,sw).dy+sh*0.55,0.54*sl); orn.push(g); });
  if(P.head==="dome") for(let k=0;k<7;k++){ const a=-PI*0.8+k*PI*0.27; orn.push(prep(CONE,pal.bel,M4(Math.cos(a)*sw*0.9,sh*0.45+Math.sin(a)*0.04,-0.02+Math.sin(a)*0.12,-0.6,0,Math.cos(a)*0.9,0.05,0.14,0.05))); }
  if(orn.length){ const m=new T.Mesh(merge(orn),mat); m.castShadow=true; B.head.add(m); }
  // sail (Spinosaurus) — rides on the hips
  if(P.sail){ const pts=[]; const z0=-0.35, z1=body+0.15;
    for(let k=0;k<=18;k++){ const u=k/18; pts.push([lerp(z0,z1,u), 0.15+P.sail*Math.pow(Math.sin(PI*Math.pow(u,0.85)),0.75)*(1+0.05*Math.sin(u*47))]); }
    pts.push([z1,0],[z0,0]);
    const g=slab(pts,0.07,(x,y,z,C)=>{ C.copy(pal.top).lerp(pal.acc,smooth(0.2,P.sail*0.8,y)); if(fract(x*3.2)<0.13) C.multiplyScalar(0.7); },0.02);
    g.rotateY(-PI/2); const m=new T.Mesh(g,mat); m.castShadow=true; m.position.copy(rel(B.hips,0,H+bh*0.55,0)); B.hips.add(m); r.sailTop=H+bh*0.55+P.sail; }
  // arms
  if(P.arm){ const a=P.arm;
    [-1,1].forEach(sd=>{
      const segs=[{len:a*0.5,r0:0.07*a+bh*0.06,r1:0.05*a+bh*0.04,rest:-0.75,rz:0.28},{len:a*0.45,r0:0.05*a+bh*0.04,r1:0.035*a+bh*0.03,rest:-0.95},{len:0,rest:-0.35}];
      const j=limb(B.chest,rel(B.chest,sd*bw*0.66,N[6][1]-bh*0.38,body+0.12),segs,lc,mat,sd);
      const cl=[]; const hr=0.03*a+bh*0.025;
      (P.arm<0.4?[-1,1]:[-1,0,1]).forEach(k=>cl.push(prep(CONE,pal.claw,M4(k*hr*0.9,-hr*1.6,hr*0.4,PI+0.35,0,0,hr*0.45,hr*2.6,hr*0.45))));
      const hm=new T.Mesh(merge(cl),mat); j[2].add(hm);
      r.arms.push({j,rest:segs.map(s=>s.rest)});
    });
  }
  // legs + toes
  [-1,1].forEach(sd=>{
    const j=limb(B.hips,rel(B.hips,sd*bw*0.6,H-bh*0.1,0.05),legS,lc,mat,sd);
    const tm=new T.Mesh(toes(pal,0.42*bh/0.62,toeR,{sickle:P.sickle,side:-sd}),mat); tm.castShadow=true; j[3].add(tm);
    r.legs.push({j,rest:legS.map(s=>s.rest),ph:sd>0?0:PI,amp:0.42});
  });
  // feathers
  G.updateMatrixWorld(true);
  if(P.feathers){
    const c0=pal.acc.clone().lerp(pal.top,0.3), c1=pal.acc.clone().multiplyScalar(1.15);
    const tailFan=new T.Mesh(fan(9,tail*0.32,0.07*bh/0.46,0.55,c0,c1,"y"),mat);
    const tp=new T.Vector3(0,N[1][1],N[1][0]+0.1);
    orient(tailFan,B.tail3,tp,new T.Vector3(0,-0.05,-1));
    r.arms.forEach((A,i)=>{ const fm=new T.Mesh(fan(6,P.arm*0.55,0.06*bh/0.46,0.45,c0,c1,"x"),mat); const wp=new T.Vector3(); A.j[1].getWorldPosition(wp);
      orient(fm,A.j[1],wp,new T.Vector3(i?0.25:-0.25,-0.55,-1)); });
    const crest=new T.Mesh(fan(5,sh*0.9,0.035,0.4,c1,c0,"y"),mat);
    orient(crest,B.head,new T.Vector3(0,N[HS+1][1]+sh*0.6,N[HS+1][0]-0.05*sl),new T.Vector3(0,0.55,-1));
    if(P.legFeathers) r.legs.forEach((L,i)=>{ const fm=new T.Mesh(fan(6,0.7,0.06,0.4,c0,c1,"x"),mat); const wp=new T.Vector3(); L.j[1].getWorldPosition(wp);
      orient(fm,L.j[1],wp,new T.Vector3(i?0.2:-0.2,-0.4,-1)); });
  }
  r.tailAmp=P.feathers?0.7:1; r.jawMax=0.62;
  return { G, r, top:Math.max(N[HS+1][1]+sh, r.sailTop||0) };
}

/* ---------- shared quadruped assembly ---------- */
function quadruped(P,pal,mat,D){
  const r=newRig(); r.mat=mat;
  const hind=D.hind, front=D.front, HS=D.headStart;
  const H=legDrop(hind)+(D.footR||0.1)-D.hindAt[1];
  const N=D.nodes.map(n=>[n[0],n[1]+H,n[2],n[3]]);
  const color=skinColor(pal,P,(s,sa,ca,C,x,y,z)=>{ if(s>HS+0.3 && sa<-0.6) C.copy(pal.mouth); if(D.beak && s>HS+3.3) C.copy(pal.beak); if(D.extraColor) D.extraColor(s,sa,ca,C,x,y,z); });
  const G=new T.Group(), bodyG=new T.Group(); G.add(bodyG);
  bodyG.add(skinned(r,N,D.bones,color,mat,{belly:D.belly||0.8,ridge:D.ridge||null}));
  const B=r.B; r.body=bodyG; r.head=B.head;
  r.tail=D.bones.filter(b=>/^tail/.test(b.name)).map(b=>B[b.name]);
  r.neck=D.bones.filter(b=>/^neck/.test(b.name)).map(b=>B[b.name]);
  const lc=limbColor(pal);
  // legs: hind on the hips, front on the chest (auto-fitted so every foot touches the ground)
  const chestN=N[D.chestNode];
  const fAtY=chestN[1]+D.frontAt[1];
  const fk=(fAtY-(D.footR||0.1))/legDrop(front);
  const fsegs=front.map(sg=>Object.assign({},sg,{len:(sg.len||0)*fk}));
  const order=D.gaitOrder||[0,PI,PI*0.5,PI*1.5];   // hindL, hindR, frontL, frontR (lateral-sequence walk)
  [-1,1].forEach((sd,i)=>{
    const j=limb(B.hips,rel(B.hips,sd*D.hindAt[0],H+D.hindAt[1],D.hindAt[2]),hind,lc,mat,sd);
    const hr=hind.filter(sg=>sg.r1).pop().r1;
    const f=new T.Mesh(D.foot?D.foot(pal,hr):pads(pal,hr),mat); f.castShadow=true;
    f.position.y=-(hind[hind.length-1].len||0); j[j.length-1].add(f);
    r.legs.push({j,rest:hind.map(s=>s.rest),ph:order[i],amp:D.amp||0.3});
  });
  [-1,1].forEach((sd,i)=>{
    const j=limb(B.chest,rel(B.chest,sd*D.frontAt[0],fAtY,chestN[0]+D.frontAt[2]),fsegs,lc,mat,sd);
    const f=new T.Mesh(D.hand?D.hand(pal,fsegs[fsegs.length-1].r1,sd):pads(pal,fsegs[fsegs.length-1].r1),mat); f.castShadow=true;
    f.position.y=-(fsegs[fsegs.length-1].len||0); j[j.length-1].add(f);
    r.legs.push({j,rest:fsegs.map(s=>s.rest),ph:order[2+i],amp:D.amp||0.3,front:true});
  });
  headKit(r,B.head,D.hp,D.sl,D.sh,D.sw,pal,P,D.headOpts);
  G.updateMatrixWorld(true);
  return { G, r, N, H, B };
}

/* ---------- sauropods ---------- */
function sauropod(P,pal,mat){
  const nl=P.neck||4.4, na=P.neckUp==null?0.62:P.neckUp, tail=P.tail||5.5, body=P.body||3.2, bh=P.bodyH||1.25, bw=P.bodyW||1.1, cu=P.chestUp||0.15, nwm=P.neckW||1;
  const sl=0.9, sh=0.36, sw=0.3;
  let p={z:body+0.2,y:cu+0.2}; const np=[]; const segL=nl/4;
  [na*0.55,na*0.95,na,na*0.88].forEach(a=>{ p={z:p.z+segL*Math.cos(a), y:p.y+segL*Math.sin(a)}; np.push(p); });
  const nb=bw*0.52*nwm, nws=[nb*0.8,nb*0.6,nb*0.46,sw*0.95];
  const nodes=[[-tail,-0.6,0.015,0.015],[-tail*0.8,-0.52,bw*0.06,bh*0.06],[-tail*0.6,-0.4,bw*0.13,bh*0.15],[-tail*0.38,-0.2,bw*0.28,bh*0.3],[-tail*0.17,-0.02,bw*0.55,bh*0.58],
    [0,0.08,bw*0.85,bh*0.9],[body*0.5,0.04+cu*0.5,bw,bh],[body,cu,bw*0.8,bh*0.85],
    [np[0].z,np[0].y,nws[0],nws[0]*1.2],[np[1].z,np[1].y,nws[1],nws[1]*1.2],[np[2].z,np[2].y,nws[2],nws[2]*1.15]];
  const HS=nodes.length;
  headNodes(HEADS[P.head||"sauro"],np[3].z-0.1,np[3].y,sl,sh,sw).forEach(n=>nodes.push(n));
  const bones=[{name:"hips",node:5},{name:"tail1",node:4,parent:"hips"},{name:"tail2",node:3,parent:"tail1"},{name:"tail3",node:2,parent:"tail2"},{name:"tail4",node:1,parent:"tail3"},
    {name:"chest",node:7,parent:"hips"},{name:"neck1",node:8,parent:"chest"},{name:"neck2",node:9,parent:"neck1"},{name:"neck3",node:10,parent:"neck2"},{name:"head",node:HS,parent:"neck3"}];
  const res=quadruped(P,pal,mat,{
    nodes, bones, headStart:HS, chestNode:7, hp:HEADS[P.head||"sauro"], sl, sh, sw, belly:0.8,
    hind:[{len:1.8,r0:bh*0.62,r1:0.36,rest:-0.06,fz:1.25,bulge:1.1},{len:1.55,r0:0.36,r1:0.31,rest:0.1},{len:0.22,r0:0.34,r1:0.37,rest:-0.04}],
    front:[{len:1.7,r0:bh*0.46,r1:0.31,rest:0.05,fz:1.15},{len:1.55,r0:0.31,r1:0.28,rest:-0.06},{len:0.2,r0:0.31,r1:0.34,rest:0.01}],
    hindAt:[bw*0.58,-bh*0.12,0.1], frontAt:[bw*0.58,-bh*0.15,-0.05], footR:0.14, amp:0.22,
    ridge:P.spines?((s)=>s>1&&s<HS?0.09*(fract(s*4)<0.5?1:0.2):0):null,
    headOpts:{noTeeth:true,eyeU:0.32,jawMax:0.4,toothStep:0.2},
  });
  const r=res.r; r.gait=4.5; r.bob=0.08; r.tailAmp=0.8; r.neckAmp=1.4;
  if(P.osteo){ const parts=[], B=res.B, sw2=r.sweep; for(let k=0;k<26;k++){ const s=4.6+k/26*2.6, a=PI/2+(k%2?0.5:-0.5)*(0.4+0.5*hash3(k,1,2)); const {p,n}=sw2.surf(s,a);
      const m=M4(p.x,p.y,p.z,0,0,0,0.13,0.13,0.13); const q=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),n); m.compose(p,q,new T.Vector3(0.12,0.1,0.12)); parts.push(prep(SPHERE_LO,pal.bel.clone().lerp(pal.top,0.5),m)); }
    const om=new T.Mesh(merge(parts),mat); om.position.copy(B.hips.userData.rest).negate(); B.hips.add(om); }
  return { G:res.G, r, top:Math.max(...res.N.map(n=>n[1]+n[3])) };
}

/* ---------- ceratopsians ---------- */
function ceratopsian(P,pal,mat){
  const body=1.95, bh=1.0, bw=0.95, tail=1.8, ss=P.skullS||1, sl=1.55*ss, sh=0.66*ss, sw=0.56*ss, hp=HEADS.cerat;
  const nodes=[[-tail,-0.3,0.02,0.02],[-tail*0.6,-0.15,bw*0.25,bh*0.28],[-tail*0.25,-0.02,bw*0.52,bh*0.55],[0,0.05,bw*0.85,bh*0.9],[body*0.5,-0.02,bw,bh],[body,-0.14,bw*0.84,bh*0.86],[body+0.42,-0.2,bw*0.55,bh*0.6]];
  const HS=nodes.length; headNodes(hp,body+0.72,-0.12,sl,sh,sw).forEach(n=>nodes.push(n));
  const res=quadruped(P,pal,mat,{
    nodes, headStart:HS, chestNode:5, hp, sl, sh, sw, beak:1, belly:0.78,
    bones:[{name:"hips",node:3},{name:"tail1",node:2,parent:"hips"},{name:"tail2",node:1,parent:"tail1"},{name:"chest",node:5,parent:"hips"},{name:"neck",node:6,parent:"chest"},{name:"head",node:HS,parent:"neck"}],
    hind:[{len:0.85,r0:0.56,r1:0.22,rest:-0.18,fz:1.25},{len:0.72,r0:0.22,r1:0.17,rest:0.42},{len:0.18,r0:0.19,r1:0.22,rest:-0.24}],
    front:[{len:0.62,r0:0.38,r1:0.18,rest:0.22,rz:0.16},{len:0.58,r0:0.18,r1:0.15,rest:-0.3},{len:0.15,r0:0.16,r1:0.19,rest:0.08}],
    hindAt:[bw*0.58,-bh*0.1,0.05], frontAt:[bw*0.6,-bh*0.2,-0.05], footR:0.08, amp:0.3,
    headOpts:{eyeU:0.3,eyeY:0.4,jawMax:0.4},
  });
  const B=res.B, r=res.r, parts=[];
  // frill with painted eye-spots in the player's colour
  const fr=P.frill||1.1, fh=P.frillH||0.9;
  const frill=polarSlab(fr,fh,(a)=>1+0.05*Math.sin(a*16),0.09,(x,y,z,C)=>{ const d=Math.hypot(x/fr,y/fh);
    C.copy(pal.top).lerp(pal.acc,smooth(0.2,0.55,d)); if(d>0.86) C.copy(pal.dark);
    if(Math.hypot(Math.abs(x)-fr*0.45,y-fh*0.52)<0.17*fr) C.copy(pal.bel); if(Math.hypot(Math.abs(x)-fr*0.45,y-fh*0.52)<0.08*fr) C.copy(pal.dark); },8,40);
  frill.rotateX(-0.5); frill.translate(0,sh*0.5,0.12); parts.push(frill);
  if(P.spikes){ const n=P.spikes; for(let k=0;k<n;k++){ const a=lerp(0.35,PI-0.35,n===1?0.5:k/(n-1));
      const base=new T.Vector3(Math.cos(a)*fr*0.95, Math.sin(a)*fh*0.95,0).applyAxisAngle(new T.Vector3(1,0,0),-0.5).add(new T.Vector3(0,sh*0.5,0.12));
      const dir=new T.Vector3(Math.cos(a),Math.sin(a),0).applyAxisAngle(new T.Vector3(1,0,0),-0.5); const q=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),dir);
      const L=(n>2?0.85:0.5)*(0.8+0.4*Math.sin(a)); parts.push(prep(CONE,pal.bel.clone().lerp(pal.acc,0.3),new T.Matrix4().compose(base.add(dir.clone().multiplyScalar(L*0.45)),q,new T.Vector3(0.09,L,0.09)))); } }
  // horns: gently curved sweeps
  const horn=(L,rad)=>{ const g=sweep([[0,0,rad,rad],[L*0.5,L*0.1,rad*0.62,rad*0.62],[L,L*0.26,0.015,0.015]],{seg:10,belly:1,density:10,color:(s,sa,ca,C)=>C.copy(pal.bel).lerp(pal.claw,s/2*0.8)}).geo; return g; };
  const q=profileAt(HEADS.cerat,0.3,sl,sh,sw);
  if(P.browHorn) [-1,1].forEach(sd=>parts.push(prep(horn(P.browHorn,0.1),null,M4(sd*q.w*0.55,q.dy+q.h*0.8,0.3*sl,-0.55,sd*0.12,0))));
  if(P.noseHorn){ const q2=profileAt(HEADS.cerat,0.72,sl,sh,sw); parts.push(prep(horn(P.noseHorn,0.09),null,M4(0,q2.dy+q2.h*0.7,0.72*sl,-1.05,0,0))); }
  if(P.boss){ const q2=profileAt(HEADS.cerat,0.62,sl,sh,sw); parts.push(prep(SPHERE_LO,pal.bel.clone().lerp(pal.top,0.4),M4(0,q2.dy+q2.h*0.85,0.62*sl,0,0,0,0.2,0.1,0.32))); }
  const m=new T.Mesh(merge(parts),mat); m.castShadow=true; B.head.add(m);
  r.gait=6; r.tailAmp=0.6;
  return { G:res.G, r, top:Math.max(...res.N.map(n=>n[1]+n[3]))+fh*0.6 };
}

/* ---------- ankylosaurs ---------- */
function ankylosaur(P,pal,mat){
  const body=2.5, bh=0.62, bw=1.1, tail=P.tail||2.3, sl=0.8, sh=0.45, sw=0.6, hp=HEADS.ankylo;
  const nodes=[[-tail,0.02,0.05,0.05],[-tail*0.75,0.04,bw*0.12,bh*0.2],[-tail*0.5,0.05,bw*0.22,bh*0.32],[-tail*0.22,0.07,bw*0.46,bh*0.58],[0,0.1,bw*0.86,bh*0.95],[body*0.5,0.08,bw,bh],[body,-0.02,bw*0.82,bh*0.82],[body+0.32,-0.06,bw*0.48,bh*0.55]];
  const HS=nodes.length; headNodes(hp,body+0.55,-0.08,sl,sh,sw).forEach(n=>nodes.push(n));
  const res=quadruped(P,pal,mat,{
    nodes, headStart:HS, chestNode:6, hp, sl, sh, sw, beak:1, belly:0.55,
    bones:[{name:"hips",node:4},{name:"tail1",node:3,parent:"hips"},{name:"tail2",node:2,parent:"tail1"},{name:"tail3",node:1,parent:"tail2"},{name:"chest",node:6,parent:"hips"},{name:"neck",node:7,parent:"chest"},{name:"head",node:HS,parent:"neck"}],
    hind:[{len:0.6,r0:0.44,r1:0.2,rest:-0.12,fz:1.2},{len:0.52,r0:0.2,r1:0.16,rest:0.32},{len:0.14,r0:0.17,r1:0.2,rest:-0.2}],
    front:[{len:0.5,r0:0.33,r1:0.16,rest:0.25,rz:0.25},{len:0.46,r0:0.16,r1:0.14,rest:-0.3},{len:0.13,r0:0.15,r1:0.18,rest:0.05}],
    hindAt:[bw*0.6,-bh*0.08,0.05], frontAt:[bw*0.6,-bh*0.2,-0.05], footR:0.07, amp:0.28,
    headOpts:{eyeU:0.34,eyeY:0.3,jawMax:0.35},
  });
  const B=res.B, r=res.r, sw2=r.sweep;
  // osteoderms: rows of armour bumps across the back
  const bumps=(s0,s1,rows,bone)=>{ const parts=[];
    for(let i=0;i<rows.length;i++) for(let s=s0;s<=s1;s+=0.28){ const a=rows[i]; const {p,n}=sw2.surf(s,a);
      const q=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),n); const big=a<0.4?1.5:1;
      parts.push(prep(CONE,pal.bel.clone().lerp(pal.top,0.45),new T.Matrix4().compose(p.clone().add(n.clone().multiplyScalar(0.05)),q,new T.Vector3(0.1*big,0.16*big,0.1*big)))); }
    const m=new T.Mesh(merge(parts),mat); m.castShadow=true; m.position.copy(bone.userData.rest).negate(); bone.add(m); };
  bumps(3.9,6.3,[PI/2,PI/2-0.45,PI/2+0.45,PI/2-0.9,PI/2+0.9,0.12,PI-0.12],B.hips);
  bumps(2.1,3.7,[PI/2-0.35,PI/2+0.35],B.tail1);
  const sp=[];
  if(P.shoulder) [-1,1].forEach(sd=>{ for(let k=0;k<3;k++){ const {p}=sw2.surf(5.6+k*0.18,sd>0?0.15:PI-0.15); sp.push(prep(CONE,pal.bel,M4(p.x,p.y,p.z,0,0,-sd*(PI/2-0.25)+0.2*k*sd,0.08,0.7-k*0.15,0.08))); } });
  if(sp.length){ const m=new T.Mesh(merge(sp),mat); m.position.copy(B.chest.userData.rest).negate(); B.chest.add(m); }
  // squamosal horns + tail club
  const q=profileAt(HEADS.ankylo,0.1,sl,sh,sw), hh=[];
  [-1,1].forEach(sd=>hh.push(prep(CONE,pal.bel,M4(sd*q.w*0.9,q.dy+q.h*0.5,0.05,-1.9,0,sd*0.5,0.07,0.28,0.07))));
  const hm=new T.Mesh(merge(hh),mat); B.head.add(hm);
  if(P.club){ const cp=res.N[0]; const club=[]; [-1,1].forEach(sd=>club.push(prep(SPHERE,pal.bel.clone().lerp(pal.top,0.3),M4(sd*0.2,0,0.1,0,0,0,0.32,0.22,0.42))));
    const cm=new T.Mesh(merge(club),mat); cm.castShadow=true; cm.position.copy(rel(B.tail3,0,cp[1],cp[0]+0.15)); B.tail3.add(cm); }
  r.gait=6; r.tailAmp=1.3;
  return { G:res.G, r, top:Math.max(...res.N.map(n=>n[1]+n[3]))+0.15 };
}

/* ---------- stegosaurs ---------- */
function stegosaur(P,pal,mat){
  const body=2.5, bh=0.9, bw=0.72, tail=2.7, sl=0.75, sh=0.32, sw=0.28, hp=HEADS.stego;
  const nodes=[[-tail,-0.22,0.02,0.02],[-tail*0.75,-0.02,bw*0.14,bh*0.16],[-tail*0.5,0.1,bw*0.26,bh*0.3],[-tail*0.24,0.16,bw*0.48,bh*0.55],[0,0.14,bw*0.8,bh*0.88],[body*0.42,0.12,bw,bh*1.05],[body*0.85,-0.32,bw*0.8,bh*0.78],[body*1.08,-0.62,bw*0.38,bh*0.4]];
  const HS=nodes.length; headNodes(hp,body*1.22,-0.76,sl,sh,sw).forEach(n=>nodes.push(n));
  const res=quadruped(P,pal,mat,{
    nodes, headStart:HS, chestNode:6, hp, sl, sh, sw, beak:1, belly:0.8,
    bones:[{name:"hips",node:4},{name:"tail1",node:3,parent:"hips"},{name:"tail2",node:2,parent:"tail1"},{name:"tail3",node:1,parent:"tail2"},{name:"chest",node:6,parent:"hips"},{name:"neck",node:7,parent:"chest"},{name:"head",node:HS,parent:"neck"}],
    hind:[{len:1.05,r0:0.54,r1:0.22,rest:-0.1,fz:1.2},{len:0.95,r0:0.22,r1:0.16,rest:0.28},{len:0.16,r0:0.18,r1:0.21,rest:-0.18}],
    front:[{len:0.55,r0:0.34,r1:0.16,rest:0.12},{len:0.5,r0:0.16,r1:0.13,rest:-0.1},{len:0.13,r0:0.14,r1:0.17,rest:0}],
    hindAt:[bw*0.6,-bh*0.1,0.05], frontAt:[bw*0.58,-bh*0.2,-0.05], footR:0.08, amp:0.28,
    headOpts:{eyeU:0.3,jawMax:0.3},
  });
  const B=res.B, r=res.r, sw2=r.sweep;
  const boneFor=(s)=>s<1.5?B.tail3:s<2.5?B.tail2:s<3.5?B.tail1:s<5.3?B.hips:s<6.6?B.chest:B.neck;
  const place=(geo,s,side,tilt)=>{ const {p}=sw2.surf(s,PI/2); const bone=boneFor(s); const m=new T.Mesh(geo,mat); m.castShadow=true;
    m.position.copy(p).add(new T.Vector3(side*0.07,-0.06,0)).sub(bone.userData.rest); m.rotation.z=side*tilt; bone.add(m); };
  const N=13;
  for(let i=0;i<N;i++){ const s=lerp(7.2,1.3,i/(N-1)), side=i%2?1:-1;
    const spike=P.kentro && s<4.6;
    if(spike){ const g=prep(CONE,pal.bel.clone().lerp(pal.acc,0.35),M4(0,0.3,0,-0.5,0,0,0.07,0.75,0.07)); place(g,s,side,0.45); continue; }
    const sz=0.35+0.7*Math.exp(-Math.pow((s-4.4)/1.9,2)), w=sz*0.9, hgt=sz*(P.kentro?0.8:1.05);
    const g=polarSlab(w*0.5,hgt,(a)=>1-0.22*Math.pow(Math.abs(Math.cos(a)),0.7),0.06,(x,y,z,C)=>{ const d=Math.hypot(x/(w*0.5),y/hgt);
      C.copy(pal.acc).lerp(pal.bel,0.25*(1-d)); if(d>0.72) C.copy(pal.acc).multiplyScalar(0.62); if(Math.abs(x)<0.02*w) C.multiplyScalar(0.85); },5,20);
    g.rotateY(-PI/2); place(g,s,side,0.1);
  }
  // thagomizer
  [[0.7,1],[0.7,-1],[1.05,1],[1.05,-1]].forEach(([s,sd])=>{ const {p}=sw2.surf(s,PI/2); const g=prep(CONE,pal.bel,M4(0,0.3,0,-1.0,0,0,0.06,0.8,0.06));
    const m=new T.Mesh(g,mat); m.position.copy(p).sub(B.tail3.userData.rest); m.rotation.z=sd*0.9; B.tail3.add(m); });
  if(P.kentro) [-1,1].forEach(sd=>{ const {p}=sw2.surf(5.9,sd>0?0.2:PI-0.2); const m=new T.Mesh(prep(CONE,pal.bel,M4(0,0,0,-2.0,0,-sd*0.6,0.07,0.9,0.07)),mat); m.position.copy(p).sub(B.chest.userData.rest); B.chest.add(m); });
  r.gait=5.5; r.tailAmp=1.2;
  return { G:res.G, r, top:Math.max(...res.N.map(n=>n[1]+n[3]))+1.0 };
}

/* ---------- hadrosaurs & Iguanodon ---------- */
function hadrosaur(P,pal,mat){
  const body=2.4, bh=0.8, bw=0.62, tail=3.1, sl=1.0, sh=0.42, sw=0.34, hp=HEADS[P.head||"duck"];
  const nodes=[[-tail,-0.18,0.02,0.02],[-tail*0.75,-0.1,bw*0.14,bh*0.2],[-tail*0.5,-0.03,bw*0.28,bh*0.34],[-tail*0.25,0.02,bw*0.5,bh*0.56],[0,0.04,bw*0.82,bh*0.86],[body*0.5,-0.04,bw,bh],[body,-0.24,bw*0.72,bh*0.76],[body+0.42,0.04,0.3,0.36]];
  const HS=nodes.length; headNodes(hp,body+0.74,0.42,sl,sh,sw).forEach(n=>nodes.push(n));
  const hoofed=(pal,r1)=>toes(pal,0.34,r1*0.9,{});
  const res=quadruped(P,pal,mat,{
    nodes, headStart:HS, chestNode:6, hp, sl, sh, sw, beak:1, belly:0.82,
    bones:[{name:"hips",node:4},{name:"tail1",node:3,parent:"hips"},{name:"tail2",node:2,parent:"tail1"},{name:"tail3",node:1,parent:"tail2"},{name:"chest",node:6,parent:"hips"},{name:"neck",node:7,parent:"chest"},{name:"head",node:HS,parent:"neck"}],
    hind:[{len:1.1,r0:0.58,r1:0.2,rest:-0.32,fz:1.25,bulge:1.1},{len:1.0,r0:0.2,r1:0.13,rest:0.8},{len:0.6,r0:0.13,r1:0.1,rest:-0.72},{len:0,rest:-PI/2+0.24}],
    front:[{len:0.8,r0:0.22,r1:0.11,rest:0.15},{len:0.75,r0:0.11,r1:0.09,rest:-0.2},{len:0.1,r0:0.09,r1:0.11,rest:0.05}],
    hindAt:[bw*0.58,-bh*0.06,0.05], frontAt:[bw*0.56,-bh*0.28,0.02], footR:0.07, amp:0.34,
    foot:hoofed,
    hand:(pal,r1,sd)=>{ const parts=[prep(SPHERE_LO,pal.top.clone().multiplyScalar(0.7),M4(0,-0.02,0.04,0,0,0,r1*1.2,r1*0.5,r1*1.4))];
      if(P.thumb) parts.push(prep(CONE,pal.claw,M4(-sd*r1*1.1,r1*0.9,r1*0.5,0.4,0,sd*0.6,r1*0.35,r1*2.4,r1*0.35))); return merge(parts); },
    headOpts:{herb:true,eyeU:0.24,eyeY:0.38,jawMax:0.35},
  });
  const B=res.B, r=res.r, parts=[];
  const q=profileAt(hp,0.2,sl,sh,sw);
  if(P.crest==="tube"){ const g=sweep([[0,0,0.1,0.12],[0.5,0.3,0.1,0.11],[1.05,0.55,0.085,0.1],[1.35,0.6,0.06,0.07]],{seg:12,belly:1,density:10,caps:true,
      color:(s,sa,ca,C)=>C.copy(pal.acc).lerp(pal.top,0.2).multiplyScalar(sa>0.3?1.1:0.85)}).geo;
    g.rotateY(PI); parts.push(prep(g,null,M4(0,q.dy+q.h*0.6,0.28*sl))); }
  if(P.crest==="helmet"){
    const g=polarSlab(0.42,0.5,null,0.14,(x,y,z,C)=>C.copy(pal.acc).lerp(pal.top,smooth(0.45,0.1,y)*0.5).multiplyScalar(Math.hypot(x/0.42,y/0.5)>0.9?0.7:1)); g.rotateY(-PI/2); g.translate(0,q.dy+q.h*0.45,0.2*sl); parts.push(g); }
  if(P.crest==="bumps") [-1,1].forEach(sd=>parts.push(prep(SPHERE_LO,pal.acc,M4(sd*0.08,q.dy+q.h*0.95,0.35*sl,0,0,0,0.08,0.08,0.14))));
  if(parts.length){ const m=new T.Mesh(merge(parts),mat); m.castShadow=true; B.head.add(m); }
  r.gait=6.5; r.tailAmp=0.45;
  return { G:res.G, r, top:Math.max(...res.N.map(n=>n[1]+n[3]))+(P.crest==="tube"?0.6:P.crest==="helmet"?0.45:0) };
}

/* ---------- pterosaurs (rigid groups, hovering on flapping wings) ---------- */
function pterosaur(P,pal,mat){
  const r=newRig(); r.mat=mat;
  const G=new T.Group(), hover=new T.Group(); hover.position.y=P.hover||2.1; G.add(hover);
  r.hover=hover; r.hoverY=hover.position.y; r.flap=P.span>6?4.2:5.6;
  const bl=P.bodyL||1.25, col=skinColor(pal,Object.assign({},P,{p:"none"}));
  const torso=sweep([[-bl*0.55,-0.02,0.02,0.02],[-bl*0.35,0,0.16,0.17],[0,0.02,0.27,0.29],[bl*0.3,0.05,0.24,0.26],[bl*0.5,0.08,0.14,0.15]],{seg:14,color:col});
  const tm=new T.Mesh(torso.geo,mat); tm.castShadow=true; hover.add(tm);
  // neck + head
  const nl=P.neck||0.55, neck=new T.Group(); neck.position.set(0,0.08,bl*0.45); hover.add(neck); r.neck=[neck];
  const ns=sweep([[0,0,0.12,0.13],[nl*0.5,nl*0.35,0.095,0.1],[nl,nl*0.62,0.08,0.09]],{seg:12,color:col});
  const nm=new T.Mesh(ns.geo,mat); nm.castShadow=true; neck.add(nm);
  const head=new T.Group(); head.position.set(0,nl*0.62,nl); neck.add(head); r.head=head;
  const sl=P.skull||1.1, sh=P.skullH||0.26, sw=0.19, hp=HEADS.ptero;
  const sk=sweep(headNodes(hp,0,0,sl,sh,sw),{seg:14,color:skinColor(pal,{p:"none"},(s,sa,ca,C)=>{ if(sa<-0.6&&s>0.4) C.copy(pal.mouth); if(P.toothless&&s>3.2) C.copy(pal.beak); })});
  const sm=new T.Mesh(sk.geo,mat); sm.castShadow=true; head.add(sm);
  headKit(r,head,hp,sl,sh,sw,pal,P,{beak:P.toothless,noTeeth:P.toothless,toothLen:0.22,toothStep:0.12,eyeU:0.16,eyeScale:1.2,jawH:0.35,noBrow:true});
  if(P.crest){ const L=P.crest==="long"?sl*0.95:sl*0.3, Hh=P.crest==="long"?sh*1.3:sh*0.9;
    const g=slab([[0,0],[-L,Hh*0.9],[-L*0.9,Hh*1.1],[sl*0.1,Hh*0.55],[sl*0.25,0]],0.04,(x,y,z,C)=>C.copy(pal.acc).lerp(pal.dark,smooth(Hh*0.3,Hh,y)*0.4),0.01);
    g.rotateY(-PI/2); g.translate(0,sh*0.6,0.05); const cm=new T.Mesh(g,mat); head.add(cm); }
  // wings: inner panel (shoulder→wrist) and outer panel (the long wing finger)
  const span=P.span||5;
  const mem=(pts,sd)=>{ const g=slab(pts.map(p=>[p[0]*sd,p[1]]),0.03,(x,y,z,C)=>{
      C.copy(pal.acc).lerp(pal.bel,smooth(-0.3,0.15,y)*0.35); if(y<-0.5) C.multiplyScalar(0.78); });
    g.rotateX(PI/2); return g; };
  const rod=(L,rad)=>{ const g=sweep([[0,0,rad,rad],[L,0,rad*0.5,rad*0.5]],{seg:8,belly:1,density:6,caps:true,color:(s,sa,ca,C)=>C.copy(pal.top).multiplyScalar(0.8)}).geo; return g; };
  [-1,1].forEach(sd=>{
    const shd=new T.Group(); shd.position.set(sd*0.2,0.08,bl*0.28); hover.add(shd);
    const w=span*0.42, ch=span*0.2, im=new T.Mesh(merge([mem([[0,0.1],[w,0.16],[w*0.97,-ch*0.25],[w*0.6,-ch*0.75],[0.05,-ch*1.05]],sd),prep(rod(w,0.07),null,M4(0,0,0.12,0,sd*PI/2,0))]),mat);
    im.castShadow=true; shd.add(im);
    const wr=new T.Group(); wr.position.set(sd*w,0,0.1); shd.add(wr);
    const o=span*0.58, om=new T.Mesh(merge([mem([[0,0.06],[o,-ch*0.55],[o*0.62,-ch*0.62],[o*0.2,-ch*0.4],[0,-ch*0.28]],sd),prep(rod(o,0.05),null,M4(0,0,0.04,0,sd*PI/2,-sd*0.08))]),mat);
    om.castShadow=true; wr.add(om);
    r.wings.push({root:shd,outer:wr,side:sd});
    // dangling legs
    const lg=new T.Mesh(prep(segGeo(0.6,0.08,0.04,(s,sa,ca,C)=>C.copy(pal.top).multiplyScalar(0.75)),null,M4(sd*0.12,-0.05,-bl*0.4,0.9,0,0)),mat); hover.add(lg);
  });
  if(P.longTail){ const tg=sweep([[-bl*1.9,0,0.01,0.01],[-bl*1.2,0,0.025,0.025],[-bl*0.5,0,0.04,0.04]],{seg:8,belly:1,color:(s,sa,ca,C)=>C.copy(pal.top)}).geo;
    const vane=slab([[-bl*1.95,0],[-bl*1.75,0.14],[-bl*1.55,0],[-bl*1.75,-0.1]],0.02,pal.acc); vane.rotateY(-PI/2);
    hover.add(new T.Mesh(merge([prep(tg),vane]),mat)); }
  G.updateMatrixWorld(true);
  return { G, r, top:hover.position.y+nl*0.62+sh*2.2, pterosaur:true };
}

/* ---------- marine reptiles ---------- */
function flipper(L,W,pal){
  return sweep([[0,0,W*0.5,W*0.17],[L*0.3,0,W,W*0.15],[L*0.72,0,W*0.6,W*0.1],[L,0,0.03,0.02]],{seg:12,belly:1,density:10,
    color:(s,sa,ca,C)=>C.copy(pal.top).lerp(pal.bel,smooth(0.2,-0.6,sa)*0.7).multiplyScalar(s>2.2?0.85:1)}).geo;
}
function addFlippers(r,parentBone,pos,L,W,sd,front,pal,mat){
  const mount=new T.Group(); orient(mount,parentBone,pos,new T.Vector3(sd*0.9,-0.12,front?-0.25:-0.55));
  const paddle=new T.Group(); mount.add(paddle);
  const m=new T.Mesh(flipper(L,W,pal),mat); m.castShadow=true; paddle.add(m);
  r.flippers.push({paddle,side:sd,front});
}
function swimmer(P,pal,mat){
  const r=newRig(); r.mat=mat; const k=P.kind;
  const D={ plesio:{body:2.0,bh:0.6,bw:0.85,tail:1.2,neck:P.neck||2.4,angs:[0.5,0.9,0.7,0.25],sl:0.55,sh:0.24,sw:0.2,hp:"swim",fl:1.4},
            plio:  {body:2.4,bh:0.72,bw:0.9,tail:1.3,neck:0.6,angs:[0.25],sl:1.6,sh:0.55,sw:0.5,hp:"plio",fl:1.6},
            mosa:  {body:2.2,bh:0.6,bw:0.62,tail:3.2,neck:0.55,angs:[0.35],sl:1.35,sh:0.42,sw:0.36,hp:P.head||"mosa",fl:0.8},
            ichthy:{body:1.7,bh:0.62,bw:0.5,tail:1.5,neck:0.25,angs:[0.2],sl:1.0,sh:0.34,sw:0.3,hp:"ichthy",fl:0.6} }[k];
  const hp=HEADS[D.hp], bh=D.bh, bw=D.bw;
  const nodes=[[-D.tail,-0.02,0.02,0.03],[-D.tail*0.72,0,bw*0.14,bh*0.2],[-D.tail*0.45,0,bw*0.3,bh*0.38],[-D.tail*0.2,0,bw*0.55,bh*0.64],[0,0,bw*0.84,bh*0.9],[D.body*0.5,0.02,bw,bh],[D.body,0.04,bw*0.72,bh*0.78]];
  let p={z:D.body,y:0.04}; const segL=D.neck/D.angs.length, nb=k==="plesio"?0.3:bw*0.6;
  D.angs.forEach((a,i)=>{ p={z:p.z+segL*Math.cos(a),y:p.y+segL*Math.sin(a)}; const t=(i+1)/D.angs.length; const w=lerp(nb,D.sw*0.9,t); if(i<D.angs.length-1) nodes.push([p.z,p.y,w,w*1.1]); });
  const HS=nodes.length; headNodes(hp,p.z,p.y,D.sl,D.sh,D.sw).forEach(n=>nodes.push(n));
  const bones=[{name:"hips",node:4},{name:"tail1",node:3,parent:"hips"},{name:"tail2",node:2,parent:"tail1"},{name:"tail3",node:1,parent:"tail2"},{name:"chest",node:6,parent:"hips"}];
  let last="chest"; for(let i=7;i<HS;i++){ bones.push({name:"neck"+i,node:i,parent:last}); last="neck"+i; }
  bones.push({name:"head",node:HS,parent:last});
  const color=skinColor(pal,P,(s,sa,ca,C)=>{ if(s>HS+0.3&&sa<-0.62) C.copy(pal.mouth); });
  const G=new T.Group(), bodyG=new T.Group(); G.add(bodyG);
  bodyG.add(skinned(r,nodes,bones,color,mat,{belly:0.75}));
  const B=r.B; r.body=bodyG; r.head=B.head; r.tail=[B.tail1,B.tail2,B.tail3];
  r.neck=bones.filter(b=>/^neck/.test(b.name)).map(b=>B[b.name]); if(!r.neck.length) r.neck=[B.chest];
  headKit(r,B.head,hp,D.sl,D.sh,D.sw,pal,P,{toothLen:k==="plesio"?0.3:0.16,toothStep:k==="plesio"?0.1:0.075,eyeU:0.26,eyeScale:k==="ichthy"?2.2:1,jawMax:0.5});
  G.updateMatrixWorld(true);
  const sw2=r.sweep;
  [-1,1].forEach(sd=>{
    addFlippers(r,B.chest,sw2.surf(5.6,sd>0?-0.35:PI+0.35).p,D.fl,D.fl*0.3,sd,true,pal,mat);
    addFlippers(r,B.hips,sw2.surf(4.1,sd>0?-0.35:PI+0.35).p,D.fl*(k==="plesio"?0.95:0.7),D.fl*0.26,sd,false,pal,mat);
  });
  const fins=[];
  if(k==="mosa"){ const tp=nodes[0]; const g=slab([[0,0],[-0.55,-0.65],[-0.78,-0.6],[-0.4,0],[-0.6,0.22],[-0.1,0.08]],0.05,pal.top.clone().lerp(pal.acc,0.4),0.01); g.rotateY(-PI/2); g.translate(0,tp[1],tp[0]+0.2); fins.push([g,B.tail3]); }
  if(k==="ichthy"){ const tp=nodes[0]; const g=slab([[0,0],[-0.5,0.72],[-0.66,0.74],[-0.34,0],[-0.66,-0.74],[-0.5,-0.72]],0.05,pal.top.clone().lerp(pal.acc,0.4),0.01); g.rotateY(-PI/2); g.translate(0,tp[1],tp[0]+0.25); fins.push([g,B.tail3]);
    const d=slab([[-0.35,0],[0.08,0.62],[0.32,0.55],[0.35,0]],0.05,pal.top.clone().lerp(pal.acc,0.5),0.01); d.rotateY(-PI/2); d.translate(0,bh*0.85,D.body*0.35); fins.push([d,B.hips]); }
  fins.forEach(([g,bone])=>{ const m=new T.Mesh(g,mat); m.castShadow=true; m.position.copy(bone.userData.rest).negate(); bone.add(m); });
  r.tailAmp=k==="mosa"?1.6:1; r.neckAmp=k==="plesio"?1.6:0.8; r.jawMax=0.5;
  return { G, r, marine:true };
}
function turtle(P,pal,mat){
  const r=newRig(); r.mat=mat; const G=new T.Group(), bodyG=new T.Group(); G.add(bodyG); r.body=bodyG;
  const shell=sweep([[-1.25,0,0.04,0.03],[-1.0,0.04,0.75,0.3],[-0.4,0.1,1.15,0.46],[0.3,0.1,1.2,0.46],[0.9,0.05,0.85,0.32],[1.15,0.02,0.3,0.12],[1.2,0.02,0.02,0.02]],
    {seg:24,belly:0.28,color:(s,sa,ca,C,x,y,z)=>{ C.copy(pal.bel).lerp(pal.top,smooth(-0.2,0.2,sa));
      if(sa>0){ const c=noise3(x*2.2,0,z*2.2); if(c>0.55) C.multiplyScalar(0.8); if(Math.abs(x)<0.08||Math.abs(Math.abs(x)-0.55)<0.05) C.lerp(pal.acc,0.55); } }});
  const sm=new T.Mesh(shell.geo,mat); sm.castShadow=true; bodyG.add(sm);
  const neck=new T.Group(); neck.position.set(0,0.05,1.05); bodyG.add(neck); r.neck=[neck];
  const ng=sweep([[0,0,0.22,0.2],[0.3,0.08,0.2,0.18],[0.55,0.18,0.18,0.17]],{seg:12,color:(s,sa,ca,C)=>C.copy(pal.bel).lerp(pal.top,smooth(-0.3,0.3,sa))});
  neck.add(new T.Mesh(ng.geo,mat));
  const head=new T.Group(); head.position.set(0,0.2,0.55); neck.add(head); r.head=head;
  const hp=HEADS.turtle, sl=0.6, sh=0.3, sw=0.26;
  head.add(new T.Mesh(sweep(headNodes(hp,0,0,sl,sh,sw),{seg:14,color:(s,sa,ca,C)=>{ C.copy(pal.bel).lerp(pal.top,smooth(-0.3,0.3,sa)); if(s>3.3) C.copy(pal.beak); if(sa<-0.6&&s>0.4) C.copy(pal.mouth); }}).geo,mat));
  headKit(r,head,hp,sl,sh,sw,pal,P,{beak:true,noTeeth:true,eyeU:0.3,jawMax:0.4});
  G.updateMatrixWorld(true);
  [-1,1].forEach(sd=>{
    const m1=new T.Group(); orient(m1,bodyG,new T.Vector3(sd*0.8,-0.05,0.55),new T.Vector3(sd*0.9,-0.1,-0.1)); const p1=new T.Group(); m1.add(p1); p1.add(new T.Mesh(flipper(1.4,0.42,pal),mat)); r.flippers.push({paddle:p1,side:sd,front:true});
    const m2=new T.Group(); orient(m2,bodyG,new T.Vector3(sd*0.7,-0.05,-0.8),new T.Vector3(sd*0.8,-0.1,-0.6)); const p2=new T.Group(); m2.add(p2); p2.add(new T.Mesh(flipper(0.65,0.3,pal),mat)); r.flippers.push({paddle:p2,side:sd,front:false});
  });
  r.neckAmp=0.6;
  return { G, r, marine:true };
}

const BUILDERS = { theropod, sauropod, ceratopsian, ankylosaur, stegosaur, hadrosaur, pterosaur, swim:swimmer, turtle };

/* ================================================================ public */
function build(arch, species, accentHex, opts){
  opts=opts||{};
  const name=SPECIES[species]?species:ARCH_DEFAULT[arch]||"Tyrannosaurus rex";
  const P=SPECIES[name];
  const pal=palette(P,accentHex,opts.wild);
  const mat=INK.toon({vertexColors:true,rim:1});
  const res=BUILDERS[P.b](P,pal,mat);
  const G=res.G; G.updateMatrixWorld(true);
  const box=new T.Box3().setFromObject(G), size=box.getSize(new T.Vector3());
  let scale=1;
  if(P.L) scale=P.L/Math.max(0.1,size.z);
  else if(P.h) scale=P.h/Math.max(0.1,res.top||box.max.y);
  const inner=new T.Group(); inner.add(G); G.scale.setScalar(scale);
  if(res.marine) inner.position.y=0.18;
  res.r.blinkOff=Math.random()*5;
  G.traverse(o=>{ if(o.isMesh){ o.castShadow=true; } });
  return { group:inner, rig:res.r, mats:[mat], height:(res.marine?Math.max(1.6,box.max.y*scale+0.3):(res.top||box.max.y)*scale),
    length:size.z*scale, marine:!!res.marine, flyer:!!res.pterosaur, species:name };
}

/* one pose update — called at ~12 fps ("on twos") by the world for that hand-animated feel */
function pose(r, t, mv, A){
  A=A||{}; const up=A.up||0, lunge=A.lunge||0, jaw=A.jaw||0;
  const w=t*r.gait;
  for(const L of r.legs){ const ph=w+L.ph, s=Math.sin(ph)*mv, lift=Math.max(0,Math.cos(ph))*mv;
    L.j[0].rotation.x=L.rest[0]-s*L.amp;
    if(L.j[1]) L.j[1].rotation.x=L.rest[1]+lift*L.amp*1.3;
    if(L.j[2]) L.j[2].rotation.x=L.rest[2]-lift*L.amp*0.9;
    if(L.j[3]) L.j[3].rotation.x=L.rest[3]+Math.min(0,s)*0.3; }
  if(r.body){ r.body.position.y=r.bodyY-Math.abs(Math.sin(w))*r.bob*mv; r.body.rotation.z=Math.sin(w)*0.025*mv; r.body.rotation.x=-lunge*0.08; }
  if(r.chest){ const b=1+Math.sin(t*1.9)*0.018; r.chest.scale.set(b,b,1); }
  r.tail.forEach((b,i)=>{ b.rotation.y=Math.sin(t*1.5-i*0.75)*(0.05+0.07*mv)*(1+i*0.35)*r.tailAmp; b.rotation.x=-up*0.05*(i+1); });
  const n=Math.max(1,r.neck.length);
  r.neck.forEach((b,i)=>{ b.rotation.y=Math.sin(t*0.55-i*0.5)*0.05*r.neckAmp; b.rotation.x=(-up*0.4+lunge*0.3)/n+Math.sin(t*0.8-i*0.4)*0.02*r.neckAmp; });
  if(r.head){ r.head.rotation.x=up*0.42-lunge*0.1+Math.sin(t*1.1)*0.03; r.head.rotation.y=Math.sin(t*0.4)*0.08; }
  if(r.jaw) r.jaw.rotation.x=r.jawRest+jaw*r.jawMax+Math.max(0,Math.sin(t*0.9))*0.03;
  r.arms.forEach((a,i)=>{ a.j[0].rotation.x=a.rest[0]+Math.sin(t*1.3+i)*0.06-jaw*0.25; });
  r.wings.forEach(W=>{ const f=Math.sin(t*r.flap); W.root.rotation.z=W.side*(0.12+f*0.5); W.outer.rotation.z=W.side*Math.sin(t*r.flap-0.8)*0.38; });
  if(r.hover){ r.hover.position.y=r.hoverY-Math.sin(t*r.flap)*0.12+Math.sin(t*0.9)*0.15; r.hover.rotation.x=-0.1+Math.cos(t*r.flap)*0.05-lunge*0.2; }
  r.flippers.forEach(F=>{ const ph=t*2.1+(F.front?0:1.4); F.paddle.rotation.x=Math.sin(ph)*0.35; F.paddle.rotation.y=Math.cos(ph)*0.22*F.side; });
  const bl=((t+r.blinkOff)%4.7)<0.13?0.12:1; r.eyes.forEach(e=>{ e.scale.y=bl; });
}

window.EFDinos = { build, pose, SPECIES, kit:{ prep, merge, M4, sweep, weld, blob, noise3, segGeo, slab, CONE, SPHERE, SPHERE_LO, orient } };
})();
