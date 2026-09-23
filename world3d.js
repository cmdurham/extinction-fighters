/* Extinction Fighters — first-person 3D world.
   A pure VIEW layer: the rules engine in index.html owns every bit of game
   state and simply calls world.sync(state) whenever things change and
   world.fx(name, data) at dramatic moments. Nothing in here changes the game.
   Requires THREE (vendor/three.min.js — r149 UMD build, sets window.THREE). */
(function(){
"use strict";
const T = window.THREE;
if(!T){ return; }

const SP = 8;                       // world units between board spaces
const PI = Math.PI;

/* ------------------------------------------------------------------ utils */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const smooth=(a,b,x)=>{ const t=clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); };
const easeOut=(q)=>1-Math.pow(1-q,3);
const easeInOut=(q)=>q<.5?4*q*q*q:1-Math.pow(-2*q+2,3)/2;
function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function hash2(i,j){ const s=Math.sin(i*127.1+j*311.7)*43758.5453; return s-Math.floor(s); }
function vnoise(x,y){
  const i=Math.floor(x), j=Math.floor(y), fx=x-i, fy=y-j, u=fx*fx*(3-2*fx), v=fy*fy*(3-2*fy);
  const a=hash2(i,j), b=hash2(i+1,j), c=hash2(i,j+1), d=hash2(i+1,j+1);
  return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;
}
const fbm=(x,y)=>vnoise(x,y)*0.65+vnoise(x*2.1+5.3,y*2.1+1.7)*0.35;
function angleLerp(a,b,t){ let d=((b-a+PI)%(2*PI)+2*PI)%(2*PI)-PI; return a+d*t; }
function resolveColor(c){
  if(typeof c==="string" && c.indexOf("var(")===0){
    const name=c.slice(4,-1).trim();
    const v=getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v||"#ffffff";
  }
  return c||"#ffffff";
}

/* ------------------------------------------------------------ the trail */
// The board is a winding trail; board space i sits at path parameter t=i.
function pathX(t){ return Math.sin(t*0.45)*8 + Math.sin(t*0.17+1)*5; }
function pathPoint(t,out){ return (out||new T.Vector3()).set(pathX(t),0,-t*SP); }
function pathTangent(t,out){ const e=0.05; return (out||new T.Vector3()).set(pathX(t+e)-pathX(t-e),0,-2*e*SP).normalize(); }
function pathRight(t,out){ const tg=pathTangent(t); return (out||new T.Vector3()).set(-tg.z,0,tg.x); }

/* --------------------------------------------------------------- biomes */
const BIOME = {
  forest:   { ground:0x3f7a39, path:0x8a6a44, sky:0x9fd6f5, fog:0xbfe3cf, sun:0xfff1d6, hill:6,  amb:"pollen"    },
  swamp:    { ground:0x3b6750, path:0x5c5638, sky:0x9ec8bd, fog:0x9dbfb2, sun:0xe6f5d8, hill:1.6,amb:"fireflies" },
  plains:   { ground:0x8db04b, path:0xa98a56, sky:0xb9e4ff, fog:0xdcefd2, sun:0xfff4d8, hill:3,  amb:"pollen"    },
  desert:   { ground:0xd8b26a, path:0xc29656, sky:0xffd89a, fog:0xf2d9a8, sun:0xffe2b0, hill:5,  amb:"dust"      },
  volcano:  { ground:0x55302a, path:0x2f2522, sky:0x74403a, fog:0x7a4038, sun:0xffb08a, hill:7,  amb:"embers"    },
  mountains:{ ground:0x6f7682, path:0x7e7a78, sky:0xa9c3da, fog:0xbac8d8, sun:0xf2f6ff, hill:16, amb:null        },
  coast:    { ground:0xdcc88f, path:0xe6d49e, sky:0x8fd4ff, fog:0xbfe7f7, sun:0xfff6e0, hill:3,  amb:null        },
  tundra:   { ground:0xe4eef4, path:0xc3d3de, sky:0xcfe3f2, fog:0xe3edf5, sun:0xeaf4ff, hill:6,  amb:"snow"      },
  nest:     { ground:0xd9b34f, path:0xe8c870, sky:0xffe7a4, fog:0xfff0c6, sun:0xfff2cc, hill:2,  amb:"gold"      },
};
const AMB = {
  pollen:    { color:0xfff3b0, size:0.14, vel:[0.2,0.15,0],  wander:0.4, n:70  },
  fireflies: { color:0xd8ff6a, size:0.30, vel:[0,0,0],       wander:0.9, n:90, blink:true },
  dust:      { color:0xe7c78b, size:0.22, vel:[3,0.1,0.8],   wander:0.5, n:170 },
  embers:    { color:0xff6a1a, size:0.22, vel:[0.3,2.0,0],   wander:0.6, n:150, add:true },
  snow:      { color:0xffffff, size:0.26, vel:[0.4,-1.4,0],  wander:0.5, n:240 },
  gold:      { color:0xffd766, size:0.24, vel:[0,0.7,0],     wander:0.5, n:120, add:true },
};
const TYPE_COL = { start:0xe8b93e, finish:0xe8b93e, adversity:0xd2553f, fight:0xd77f2e, bonus:0x39a3c8, empty:0x9a9489 };
const NATURAL  = { apex:0x7a5c3a, raptor:0x8c6f3a, horned:0x6d7a4a, armored:0x6b5b45, giant:0x6f8a5a, grazer:0x5f8a6a, flyer:0x9a6a4a, marine:0x4a7890 };
const EYE      = { apex:3.0, raptor:1.85, horned:2.1, armored:1.35, giant:4.8, grazer:2.8, flyer:2.9, marine:2.4 };

/* ------------------------------------------------------ shared geometry */
const GEO = {
  ico:  new T.IcosahedronGeometry(1,0),
  ico1: new T.IcosahedronGeometry(1,1),
  dode: new T.DodecahedronGeometry(1,0),
  oct:  new T.OctahedronGeometry(1,0),
  box:  new T.BoxGeometry(1,1,1),
  cyl:  new T.CylinderGeometry(1,1,1,7),
  cone: new T.ConeGeometry(1,1,7),
  disc: new T.CylinderGeometry(1,1,0.1,18),
  rib:  new T.TorusGeometry(1,0.1,5,12,PI),
  neckG:new T.CylinderGeometry(0.28,0.55,3.2,8),
  tailG:new T.CylinderGeometry(0.06,0.5,4.2,8),
  neckM:new T.CylinderGeometry(0.16,0.34,1.9,8),
};
const matCache = {};
function mat(color,opts){
  const k=color+"|"+(opts?JSON.stringify(opts):"");
  return matCache[k] || (matCache[k]=new T.MeshLambertMaterial(Object.assign({color, flatShading:true}, opts||{})));
}
function P(parent,geo,m,x,y,z,sx,sy,sz,rx,ry,rz){
  const o=new T.Mesh(geo,m); o.position.set(x,y,z); o.scale.set(sx,sy,sz);
  if(rx||ry||rz) o.rotation.set(rx||0,ry||0,rz||0);
  o.castShadow=true; parent.add(o); return o;
}
function pivot(parent,x,y,z){ const g=new T.Group(); g.position.set(x,y,z); parent.add(g); return g; }

/* ---------------------------------------------------------------- dinos */
function dinoMats(hex){
  const base=new T.Color(hex);
  const std=(c,o)=>new T.MeshStandardMaterial(Object.assign({color:c, flatShading:true, roughness:0.82, metalness:0}, o||{}));
  return {
    base:std(base), belly:std(base.clone().lerp(new T.Color(0xfff3dc),0.5)),
    dark:std(base.clone().multiplyScalar(0.55)), accent:std(base.clone().offsetHSL(0.07,0.12,0.04)),
    eye:std(0xffffff,{roughness:0.3}), pupil:std(0x111111,{roughness:0.2}), tooth:std(0xfffbe8),
  };
}
function eyes(head,M,x,y,z,r){
  [-1,1].forEach(s=>{
    P(head,GEO.ico1,M.eye,s*x,y,z,r,r,r);
    P(head,GEO.ico1,M.pupil,s*(x+r*0.45),y+r*0.1,z+r*0.35,r*0.5,r*0.6,r*0.5);
  });
}
function legs2(g,M,parts,hipY,spread,sc){
  [-1,1].forEach(s=>{ const L=pivot(g,s*spread,hipY,-0.15*sc); parts.legs.push(L);
    P(L,GEO.ico1,M.base,0,-0.25*sc,0,0.42*sc,0.62*sc,0.55*sc);
    P(L,GEO.cyl,M.base,0,-0.95*sc,0.08*sc,0.19*sc,0.9*sc,0.19*sc);
    P(L,GEO.box,M.dark,0,-1.45*sc,0.3*sc,0.42*sc,0.16*sc,0.75*sc); });
}
function legs4(g,M,parts,hipY,pts,r,len){
  pts.forEach(([x,z])=>{ const L=pivot(g,x,hipY,z); parts.legs.push(L);
    P(L,GEO.cyl,M.base,0,-len/2,0,r,len,r);
    P(L,GEO.box,M.dark,0,-len+0.05,0.06,r*1.45,0.12,r*1.7); });
}
const BUILD = {
  apex(M){
    const g=new T.Group(), parts={legs:[]};
    P(g,GEO.ico1,M.base,0,1.95,0,0.95,0.95,1.5,-0.28,0,0);
    P(g,GEO.ico1,M.belly,0,1.72,0.28,0.78,0.72,1.1,-0.28,0,0);
    for(let k=0;k<4;k++) P(g,GEO.cone,M.dark,0,2.86-k*0.12,0.5-k*0.55,0.12,0.36,0.2,-0.2,0,0);
    P(g,GEO.ico1,M.base,0,2.55,0.95,0.55,0.6,0.6);
    const head=pivot(g,0,2.85,1.25); parts.head=head;
    P(head,GEO.box,M.base,0,0.12,0.45,0.85,0.62,1.25);
    P(head,GEO.box,M.dark,0,0.47,0.2,0.9,0.12,0.5);
    eyes(head,M,0.43,0.3,0.35,0.14);
    for(let k=0;k<4;k++) P(head,GEO.cone,M.tooth,0.3-k*0.2,-0.22,0.95,0.05,0.16,0.05,PI,0,0);
    const jaw=pivot(head,0,-0.18,-0.05); parts.jaw=jaw;
    P(jaw,GEO.box,M.belly,0,-0.1,0.5,0.78,0.22,1.05);
    [-1,1].forEach(s=>P(g,GEO.cyl,M.base,s*0.5,2.05,1.05,0.09,0.42,0.09,0.9,0,0));
    legs2(g,M,parts,1.55,0.55,1);
    const tail=pivot(g,0,1.95,-1.2); parts.tail=tail;
    P(tail,GEO.cone,M.base,0,-0.1,-1.25,0.55,2.6,0.55,-PI/2+0.12,0,0);
    return {root:g,parts,height:3.4};
  },
  raptor(M){
    const g=new T.Group(), parts={legs:[]};
    P(g,GEO.ico1,M.base,0,1.2,0,0.45,0.45,0.95,-0.1,0,0);
    P(g,GEO.ico1,M.belly,0,1.08,0.12,0.36,0.34,0.72,-0.1,0,0);
    for(let k=0;k<5;k++) P(g,GEO.cone,M.accent,0,1.62-k*0.03,0.55-k*0.32,0.07,0.3,0.12,-0.5,0,0);
    P(g,GEO.cyl,M.base,0,1.55,0.75,0.16,0.6,0.16,0.7,0,0);
    const head=pivot(g,0,1.82,1.02); parts.head=head;
    P(head,GEO.box,M.base,0,0.05,0.28,0.34,0.3,0.72);
    eyes(head,M,0.17,0.13,0.2,0.07);
    const jaw=pivot(head,0,-0.1,0); parts.jaw=jaw;
    P(jaw,GEO.box,M.belly,0,-0.04,0.3,0.3,0.1,0.62);
    [-1,1].forEach(s=>P(g,GEO.box,M.accent,s*0.36,1.25,0.45,0.06,0.18,0.5,0.4,0,0));
    [-1,1].forEach(s=>{ const L=pivot(g,s*0.26,1.02,-0.1); parts.legs.push(L);
      P(L,GEO.ico1,M.base,0,-0.12,0,0.2,0.34,0.28);
      P(L,GEO.cyl,M.base,0,-0.58,0.04,0.07,0.62,0.07);
      P(L,GEO.box,M.dark,0,-0.92,0.14,0.2,0.08,0.34);
      P(L,GEO.cone,M.tooth,0,-0.8,0.26,0.04,0.22,0.04,1.2,0,0); });
    const tail=pivot(g,0,1.22,-0.85); parts.tail=tail;
    P(tail,GEO.cone,M.base,0,0,-1.0,0.24,2.0,0.24,-PI/2,0,0);
    P(tail,GEO.cone,M.accent,0,0.08,-1.65,0.12,0.6,0.18,-PI/2,0,0);
    return {root:g,parts,height:2.1};
  },
  horned(M){
    const g=new T.Group(), parts={legs:[]};
    P(g,GEO.ico1,M.base,0,1.3,0,1.05,0.92,1.55);
    P(g,GEO.ico1,M.belly,0,1.02,0.1,0.9,0.6,1.3);
    legs4(g,M,parts,0.95,[[0.62,0.95],[-0.62,0.95],[0.62,-0.85],[-0.62,-0.85]],0.26,0.95);
    const head=pivot(g,0,1.35,1.55); parts.head=head;
    P(head,GEO.box,M.base,0,0,0.35,0.8,0.7,0.95);
    P(head,GEO.cyl,M.dark,0,0.43,-0.16,1.12,0.08,1.12,PI/2-0.45,0,0);
    P(head,GEO.cyl,M.accent,0,0.45,-0.1,1.0,0.1,1.0,PI/2-0.45,0,0);
    P(head,GEO.cone,M.tooth,0.25,0.48,0.62,0.08,0.9,0.08,1.1,0,0);
    P(head,GEO.cone,M.tooth,-0.25,0.48,0.62,0.08,0.9,0.08,1.1,0,0);
    P(head,GEO.cone,M.tooth,0,0.12,0.95,0.08,0.4,0.08,0.9,0,0);
    P(head,GEO.cone,M.dark,0,-0.1,0.95,0.2,0.4,0.2,PI/2,0,0);
    eyes(head,M,0.4,0.18,0.45,0.1);
    const jaw=pivot(head,0,-0.3,0.2); parts.jaw=jaw;
    P(jaw,GEO.box,M.belly,0,-0.05,0.25,0.6,0.18,0.6);
    const tail=pivot(g,0,1.25,-1.4); parts.tail=tail;
    P(tail,GEO.cone,M.base,0,-0.1,-0.7,0.35,1.4,0.35,-PI/2-0.3,0,0);
    return {root:g,parts,height:2.6};
  },
  armored(M){
    const g=new T.Group(), parts={legs:[]};
    P(g,GEO.ico1,M.base,0,0.95,0,1.2,0.62,1.6);
    P(g,GEO.ico1,M.dark,0,1.15,0,1.08,0.42,1.42);
    for(let r=0;r<3;r++) for(let k=0;k<4;k++) P(g,GEO.cone,M.belly,(r-1)*0.55,1.5-Math.abs(r-1)*0.12,0.9-k*0.6,0.1,0.3,0.1);
    [-1,1].forEach(s=>{ for(let k=0;k<4;k++) P(g,GEO.cone,M.belly,s*1.18,0.95,0.9-k*0.6,0.1,0.45,0.1,0,0,-s*PI/2); });
    legs4(g,M,parts,0.6,[[0.72,0.9],[-0.72,0.9],[0.72,-0.9],[-0.72,-0.9]],0.24,0.58);
    const head=pivot(g,0,0.95,1.55); parts.head=head;
    P(head,GEO.box,M.base,0,0,0.25,0.62,0.45,0.6);
    P(head,GEO.cone,M.dark,0.32,0.15,0.1,0.08,0.3,0.08,0,0,-1.2);
    P(head,GEO.cone,M.dark,-0.32,0.15,0.1,0.08,0.3,0.08,0,0,1.2);
    eyes(head,M,0.3,0.1,0.35,0.08);
    const jaw=pivot(head,0,-0.2,0.05); parts.jaw=jaw;
    P(jaw,GEO.box,M.belly,0,-0.03,0.25,0.5,0.12,0.45);
    const tail=pivot(g,0,0.95,-1.45); parts.tail=tail;
    P(tail,GEO.cone,M.base,0,0,-0.85,0.22,1.7,0.22,-PI/2,0,0);
    P(tail,GEO.ico1,M.dark,0,0,-1.75,0.45,0.32,0.4);
    return {root:g,parts,height:1.8};
  },
  giant(M){
    const g=new T.Group(), parts={legs:[]};
    P(g,GEO.ico1,M.base,0,2.55,0,1.35,1.2,2.1);
    P(g,GEO.ico1,M.belly,0,2.2,0.1,1.15,0.85,1.8);
    for(let k=0;k<5;k++) P(g,GEO.ico,M.accent,(k%2?0.5:-0.4),3.55,1.1-k*0.55,0.3,0.12,0.35);
    legs4(g,M,parts,1.9,[[0.8,1.25],[-0.8,1.25],[0.8,-1.2],[-0.8,-1.2]],0.4,1.85);
    const neck=pivot(g,0,3.0,1.55); parts.neck=neck;
    P(neck,GEO.neckG,M.base,0,1.3,0.9,1,1,1,0.6,0,0);
    const head=pivot(neck,0,2.75,1.95); parts.head=head;
    P(head,GEO.ico1,M.base,0,0,0.15,0.36,0.3,0.55);
    eyes(head,M,0.26,0.1,0.2,0.08);
    const jaw=pivot(head,0,-0.12,0.05); parts.jaw=jaw;
    P(jaw,GEO.box,M.belly,0,-0.04,0.28,0.3,0.1,0.42);
    const tail=pivot(g,0,2.45,-1.9); parts.tail=tail;
    P(tail,GEO.tailG,M.base,0,-0.35,-1.9,1,1,1,-PI/2-0.2,0,0);
    return {root:g,parts,height:6.2,scale:0.85};
  },
  grazer(M){
    const g=new T.Group(), parts={legs:[]};
    P(g,GEO.ico1,M.base,0,1.65,0,0.78,0.82,1.35,-0.35,0,0);
    P(g,GEO.ico1,M.belly,0,1.45,0.2,0.62,0.62,1.0,-0.35,0,0);
    P(g,GEO.cyl,M.base,0,2.35,0.85,0.28,0.8,0.28,0.45,0,0);
    const head=pivot(g,0,2.75,1.15); parts.head=head;
    P(head,GEO.box,M.base,0,0,0.2,0.45,0.45,0.7);
    P(head,GEO.box,M.belly,0,-0.12,0.62,0.58,0.14,0.42);
    P(head,GEO.cyl,M.accent,0,0.5,-0.45,0.1,1.35,0.12,-1.0,0,0);
    eyes(head,M,0.23,0.1,0.25,0.08);
    const jaw=pivot(head,0,-0.22,0.2); parts.jaw=jaw;
    P(jaw,GEO.box,M.belly,0,-0.03,0.35,0.5,0.1,0.4);
    [-1,1].forEach(s=>P(g,GEO.cyl,M.base,s*0.45,1.7,0.75,0.08,0.55,0.08,0.6,0,0));
    legs2(g,M,parts,1.35,0.46,0.8);
    const tail=pivot(g,0,1.55,-1.05); parts.tail=tail;
    P(tail,GEO.cone,M.base,0,-0.1,-1.1,0.42,2.2,0.42,-PI/2-0.1,0,0);
    return {root:g,parts,height:3.4};
  },
  flyer(M){
    const g=new T.Group(), parts={legs:[],wings:[]};
    const hover=pivot(g,0,0,0); parts.hover=hover;
    P(hover,GEO.ico1,M.base,0,2.4,0,0.36,0.36,0.78);
    P(hover,GEO.ico1,M.belly,0,2.3,0.05,0.28,0.26,0.6);
    const head=pivot(hover,0,2.62,0.72); parts.head=head;
    P(head,GEO.ico1,M.base,0,0,0,0.25,0.25,0.34);
    P(head,GEO.cone,M.belly,0,-0.02,0.65,0.1,1.0,0.1,PI/2,0,0);
    P(head,GEO.cone,M.accent,0,0.18,-0.45,0.08,0.9,0.08,-1.15,0,0);
    eyes(head,M,0.17,0.08,0.1,0.06);
    const jaw=pivot(head,0,-0.08,0.2); parts.jaw=jaw;
    P(jaw,GEO.cone,M.belly,0,-0.03,0.35,0.06,0.7,0.06,PI/2,0,0);
    [-1,1].forEach(s=>{ const W=pivot(hover,s*0.28,2.45,0.05); W.userData.side=s; parts.wings.push(W);
      P(W,GEO.box,M.accent,s*1.35,0,-0.05,2.7,0.05,1.0);
      P(W,GEO.cyl,M.base,s*1.35,0.02,0.45,0.06,2.7,0.06,0,0,PI/2);
      P(W,GEO.box,M.accent,s*2.9,0,-0.25,0.8,0.04,0.55,0,s*0.4,0); });
    [-1,1].forEach(s=>P(hover,GEO.cyl,M.dark,s*0.12,2.05,-0.2,0.04,0.35,0.04));
    P(hover,GEO.cone,M.base,0,2.4,-0.95,0.08,0.5,0.08,-PI/2,0,0);
    return {root:g,parts,height:3.3};
  },
  marine(M){
    const g=new T.Group(), parts={legs:[],flippers:[]};
    const puddle=new T.Mesh(GEO.disc,new T.MeshLambertMaterial({color:0x3aa6d8,transparent:true,opacity:0.6}));
    puddle.scale.set(2.3,1,2.6); puddle.position.y=0.04; g.add(puddle);
    P(g,GEO.ico1,M.base,0,0.85,0,0.95,0.55,1.35);
    P(g,GEO.ico1,M.belly,0,0.72,0.05,0.8,0.35,1.15);
    [[1,0.55],[-1,0.55],[1,-0.65],[-1,-0.65]].forEach(([s,z])=>{ const F=pivot(g,s*0.85,0.68,z); F.userData.side=s; parts.flippers.push(F);
      P(F,GEO.ico1,M.dark,s*0.5,0,0,0.62,0.07,0.26,0,s*0.3,0); });
    const neck=pivot(g,0,1.0,1.05); parts.neck=neck;
    P(neck,GEO.neckM,M.base,0,0.75,0.55,1,1,1,0.65,0,0);
    const head=pivot(neck,0,1.55,1.18); parts.head=head;
    P(head,GEO.ico1,M.base,0,0,0.12,0.28,0.22,0.42);
    eyes(head,M,0.2,0.08,0.12,0.06);
    const jaw=pivot(head,0,-0.08,0.05); parts.jaw=jaw;
    P(jaw,GEO.box,M.belly,0,-0.03,0.25,0.26,0.07,0.36);
    for(let k=0;k<3;k++) P(head,GEO.cone,M.tooth,0.12-k*0.12,-0.1,0.42,0.03,0.1,0.03,PI,0,0);
    const tail=pivot(g,0,0.85,-1.3); parts.tail=tail;
    P(tail,GEO.cone,M.base,0,0,-0.6,0.3,1.2,0.3,-PI/2,0,0);
    return {root:g,parts,height:2.8};
  },
};
function makeDino(arch, hex){
  const M=dinoMats(hex);
  const b=(BUILD[arch]||BUILD.apex)(M);
  const sc=b.scale||1;
  b.root.scale.setScalar(sc);
  b.root.rotation.order="YXZ";
  const holder=new T.Group(); holder.add(b.root);
  return { holder, root:b.root, parts:b.parts, height:b.height*sc, scale:sc, mats:Object.values(M), arch,
           phase:Math.random()*10, anim:{mode:"idle",t:0}, yaw:0, moving:0, opacity:1,
           base:new T.Vector3(), target:new T.Vector3(), face:new T.Vector3(), side:1 };
}

/* ------------------------------------------------------ canvas textures */
function roundRect(x,X,Y,W,H,R){ x.beginPath(); x.moveTo(X+R,Y); x.arcTo(X+W,Y,X+W,Y+H,R); x.arcTo(X+W,Y+H,X,Y+H,R); x.arcTo(X,Y+H,X,Y,R); x.arcTo(X,Y,X+W,Y,R); x.closePath(); }
const FONT='ui-rounded,"Arial Rounded MT Bold","Trebuchet MS",sans-serif';
function dotTexture(){
  const c=document.createElement("canvas"); c.width=c.height=64; const x=c.getContext("2d");
  const g=x.createRadialGradient(32,32,0,32,32,32);
  g.addColorStop(0,"rgba(255,255,255,1)"); g.addColorStop(0.4,"rgba(255,255,255,.85)"); g.addColorStop(1,"rgba(255,255,255,0)");
  x.fillStyle=g; x.fillRect(0,0,64,64); return new T.CanvasTexture(c);
}
function iconTexture(type, icon, num){
  const c=document.createElement("canvas"); c.width=128; c.height=172; const x=c.getContext("2d");
  const col="#"+new T.Color(TYPE_COL[type]||0x999999).getHexString();
  if(type!=="empty"){
    x.beginPath(); x.arc(64,64,56,0,PI*2); x.fillStyle=col; x.fill();
    x.lineWidth=7; x.strokeStyle="rgba(255,255,255,.9)"; x.stroke();
    x.font="62px "+FONT; x.textAlign="center"; x.textBaseline="middle"; x.fillText(icon,64,68);
  }
  x.font="800 40px "+FONT; x.textAlign="center"; x.textBaseline="middle";
  x.lineWidth=8; x.strokeStyle="rgba(0,0,0,.7)"; x.strokeText(String(num),64,type==="empty"?110:148);
  x.fillStyle="#fff"; x.fillText(String(num),64,type==="empty"?110:148);
  return new T.CanvasTexture(c);
}
function labelTexture(p, hex){
  const c=document.createElement("canvas"); c.width=320; c.height=116; const x=c.getContext("2d");
  roundRect(x,4,4,312,108,28); x.fillStyle="rgba(10,22,14,.74)"; x.fill();
  x.lineWidth=5; x.strokeStyle=hex; x.stroke();
  x.textAlign="center"; x.textBaseline="middle";
  x.font="800 40px "+FONT; x.fillStyle=hex; x.fillText((p.finished?"🏆 ":"")+p.name,160,42);
  const n=Math.max(1,p.maxHp), w=34, x0=160-(n-1)*w/2;
  x.font="32px sans-serif";
  for(let i=0;i<n;i++){ x.fillStyle=i<p.hp?"#ff5b6e":"rgba(255,255,255,.22)"; x.fillText("♥",x0+i*w,84); }
  return new T.CanvasTexture(c);
}

/* ================================================================ WORLD */
function create(container, cfg){
  const BOARD=cfg.board, FIN=cfg.finish;
  const habAt=(t)=>cfg.habitatFor(clamp(Math.round(t),0,FIN));
  const BIO=(t)=>BIOME[habAt(t)]||BIOME.forest;

  /* renderer / camera / scene */
  const renderer=new T.WebGLRenderer({antialias:true, powerPreference:"high-performance"});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  renderer.shadowMap.enabled=true; renderer.shadowMap.type=T.PCFSoftShadowMap;
  const cv=renderer.domElement; cv.className="world3d-canvas";
  container.appendChild(cv);
  const flashEl=document.createElement("div"); flashEl.className="world3d-flash"; container.appendChild(flashEl);
  const hintEl=document.createElement("div"); hintEl.className="world3d-hint"; hintEl.textContent="👆 Drag to look around"; container.appendChild(hintEl);

  const scene=new T.Scene();
  scene.background=new T.Color(0x9fd6f5);
  scene.fog=new T.Fog(0xbfe3cf,28,125);
  const camera=new T.PerspectiveCamera(70,1,0.1,175);
  const hemi=new T.HemisphereLight(0xffffff,0x445533,0.8); scene.add(hemi);
  const sun=new T.DirectionalLight(0xffffff,0.85);
  sun.castShadow=true; sun.shadow.mapSize.set(1024,1024);
  Object.assign(sun.shadow.camera,{left:-24,right:24,top:24,bottom:-24,near:1,far:90});
  scene.add(sun); scene.add(sun.target);

  /* smoothed per-space tables so biome transitions blend instead of popping */
  const T0=-12, T1=FIN+14;
  const tbl={ hill:[], ground:[], path:[], sky:[], fog:[], sun:[], coast:[] };
  for(let i=T0;i<=T1;i++){
    let hill=0, coast=0; const g=new T.Color(0,0,0), p=new T.Color(0,0,0), sk=new T.Color(0,0,0), fg=new T.Color(0,0,0), sn=new T.Color(0,0,0);
    let n=0;
    for(let k=-2;k<=2;k+=0.5){ const b=BIO(i+k), h=habAt(i+k); hill+=b.hill; coast+=(h==="coast")?1:0;
      g.add(new T.Color(b.ground)); p.add(new T.Color(b.path)); sk.add(new T.Color(b.sky)); fg.add(new T.Color(b.fog)); sn.add(new T.Color(b.sun)); n++; }
    tbl.hill.push(hill/n); tbl.coast.push(coast/n);
    tbl.ground.push(g.multiplyScalar(1/n)); tbl.path.push(p.multiplyScalar(1/n)); tbl.sky.push(sk.multiplyScalar(1/n)); tbl.fog.push(fg.multiplyScalar(1/n)); tbl.sun.push(sn.multiplyScalar(1/n));
  }
  function tnum(arr,t){ const f=clamp(t-T0,0,arr.length-1.001), i=Math.floor(f); return lerp(arr[i],arr[i+1],f-i); }
  function tcol(arr,t,out){ const f=clamp(t-T0,0,arr.length-1.001), i=Math.floor(f); return (out||new T.Color()).copy(arr[i]).lerp(arr[i+1],f-i); }

  function groundH(x,z){
    const t=-z/SP, side=x-pathX(t), d=Math.abs(side);
    const h=smooth(5.5,26,d)*(0.35+fbm(x*0.045,z*0.045))*tnum(tbl.hill,t);
    const cw=tnum(tbl.coast,t);
    if(cw>0 && side>6) return lerp(h,-smooth(6,20,side)*3.2+h*0.15,cw);
    return h;
  }

  /* ---- ground: faceted low-poly terrain that hugs the trail ---- */
  (function buildGround(){
    const NU=64, U=140, du=2*U/NU, zTop=-T0*SP+40, zBot=-T1*SP, NZ=Math.ceil((zTop-zBot)/3);
    const pos=[], col=[], c=new T.Color(), tmp=new T.Color(), white=new T.Color(0xf4f8fb);
    const V=(u,zi)=>{ const z=zTop-zi*3, t=-z/SP, x=pathX(t)+(-U+u*du); return [x,groundH(x,z),z]; };
    for(let zi=0;zi<NZ;zi++) for(let u=0;u<NU;u++){
      const a=V(u,zi), b=V(u+1,zi), cc=V(u,zi+1), d=V(u+1,zi+1);
      [[a,cc,b],[b,cc,d]].forEach(tri=>{
        const cx=(tri[0][0]+tri[1][0]+tri[2][0])/3, cy=(tri[0][1]+tri[1][1]+tri[2][1])/3, cz=(tri[0][2]+tri[1][2]+tri[2][2])/3;
        const t=-cz/SP; tcol(tbl.ground,t,c);
        c.multiplyScalar(0.86+0.24*hash2(Math.floor(cx*1.3),Math.floor(cz*1.3)));
        if(cy>10) c.lerp(white,smooth(10,15,cy));
        if(cy<-0.3) c.lerp(tmp.set(0xb89e6a),0.6);
        tri.forEach(v=>{ pos.push(v[0],v[1],v[2]); col.push(c.r,c.g,c.b); });
      });
    }
    const g=new T.BufferGeometry();
    g.setAttribute("position",new T.Float32BufferAttribute(pos,3));
    g.setAttribute("color",new T.Float32BufferAttribute(col,3));
    g.computeVertexNormals();
    const m=new T.Mesh(g,new T.MeshLambertMaterial({vertexColors:true,flatShading:true}));
    m.receiveShadow=true; scene.add(m);
  })();

  /* ---- the trail ribbon ---- */
  (function buildTrail(){
    const pos=[], col=[], c=new T.Color(), A=new T.Vector3(), B=new T.Vector3(), R=new T.Vector3(), R2=new T.Vector3();
    const W=2.2, step=0.08;
    for(let t=-6;t<FIN+6;t+=step){
      pathPoint(t,A); pathPoint(t+step,B); pathRight(t,R); pathRight(t+step,R2);
      const w1=W+(hash2(Math.floor(t*10),3)-0.5)*0.5, w2=W+(hash2(Math.floor((t+step)*10),3)-0.5)*0.5;
      const q=[A.x-R.x*w1,0.04,A.z-R.z*w1, A.x+R.x*w1,0.04,A.z+R.z*w1, B.x-R2.x*w2,0.04,B.z-R2.z*w2, B.x+R2.x*w2,0.04,B.z+R2.z*w2];
      tcol(tbl.path,t,c).multiplyScalar(0.9+0.2*hash2(Math.floor(t*12),7));
      [0,2,1, 1,2,3].forEach(k=>{ pos.push(q[k*3],q[k*3+1],q[k*3+2]); col.push(c.r,c.g,c.b); });
    }
    const g=new T.BufferGeometry();
    g.setAttribute("position",new T.Float32BufferAttribute(pos,3));
    g.setAttribute("color",new T.Float32BufferAttribute(col,3));
    g.computeVertexNormals();
    const m=new T.Mesh(g,new T.MeshLambertMaterial({vertexColors:true,polygonOffset:true,polygonOffsetFactor:-2}));
    m.receiveShadow=true; scene.add(m);
  })();

  /* ---- board spaces: stepping-stones + floating type icons ---- */
  const icons=[], glowDiscs=[];
  const stone=mat(0x8b8378);
  for(let i=0;i<=FIN;i++){
    const type=BOARD[i], p=pathPoint(i);
    const g=new T.Group(); g.position.copy(p); scene.add(g);
    const base=P(g,GEO.cyl,stone,0,0.16,0,1.55,0.32,1.55); base.receiveShadow=true;
    const top=new T.Mesh(GEO.disc,new T.MeshLambertMaterial({color:TYPE_COL[type]||0x999999,emissive:TYPE_COL[type]||0,emissiveIntensity:(type==="bonus"||type==="finish"||type==="start")?0.35:0.12}));
    top.scale.set(1.28,0.6,1.28); top.position.y=0.34; top.receiveShadow=true; g.add(top);
    if(type==="bonus") glowDiscs.push(top);
    const spr=new T.Sprite(new T.SpriteMaterial({map:iconTexture(type,cfg.tileIcon[type]||"",i),transparent:true}));
    spr.scale.set(1.5,2.0,1); spr.position.set(0,3.3,0); g.add(spr);
    icons.push({spr,i,world:p.clone().setY(3.3)});
  }

  /* ---- scenery props ---- */
  const C={ trunk:0x6b4a2b, pine:0x2f6b35, pine2:0x3e8243, leaf:0x5a9a3c, leaf2:0x77ad48, rock:0x8b8680, sand:0xcfae6d,
            cactus:0x4f8a3e, bone:0xf1ead7, reed:0x8fa35a, water:0x3aa6d8, lily:0x3f8f47, pink:0xff8fc2, lava:0x2b2220,
            ice:0xbfe8ff, snow:0xf7fbff, palm:0x8a6a3e, frond:0x3f9a4a, grey:0x6f7682, yellow:0xffd54a, red:0xff6b6b, egg:0xfff3dc };
  const PROPS={
    pine(g,r,snowy){ const s=0.8+r()*0.9; P(g,GEO.cyl,mat(C.trunk),0,0.6*s,0,0.22*s,1.2*s,0.22*s);
      for(let k=0;k<3;k++){ P(g,GEO.cone,mat(k%2?C.pine:C.pine2),0,(1.5+k*0.95)*s,0,(1.5-k*0.38)*s,1.7*s,(1.5-k*0.38)*s);
        if(snowy) P(g,GEO.cone,mat(C.snow),0,(1.95+k*0.95)*s,0,(0.8-k*0.2)*s,0.8*s,(0.8-k*0.2)*s); } },
    snowpine(g,r){ PROPS.pine(g,r,true); },
    tree(g,r){ const s=0.8+r()*0.8; P(g,GEO.cyl,mat(C.trunk),0,1*s,0,0.25*s,2*s,0.25*s); P(g,GEO.ico,mat(r()<.5?C.leaf:C.leaf2),0,2.6*s,0,1.5*s,1.3*s,1.5*s); },
    bush(g,r){ const s=0.5+r()*0.7; P(g,GEO.ico,mat(C.leaf),0,0.5*s,0,1*s,0.75*s,1*s); if(r()<.4) P(g,GEO.ico,mat(C.red),0.4*s,0.9*s,0.3*s,0.12,0.12,0.12); },
    rock(g,r){ const s=0.5+r()*1.4; P(g,GEO.dode,mat(C.rock),0,0.4*s,0,s,0.7*s,s*1.2,r()*3,r()*3,0); },
    boulder(g,r){ const s=1.6+r()*2.4; P(g,GEO.dode,mat(C.grey),0,0.6*s,0,s,0.8*s,s,r()*3,r()*3,0); },
    reeds(g,r){ for(let k=0;k<6;k++) P(g,GEO.cyl,mat(C.reed),(r()-.5)*1.2,0.9,(r()-.5)*1.2,0.05,1.8+r(),0.05,(r()-.5)*.3,0,(r()-.5)*.3); },
    pool(g,r){ const s=1.5+r()*2.2; const w=new T.Mesh(GEO.disc,mat(C.water,{transparent:true,opacity:0.75})); w.scale.set(s,1,s*1.3); w.position.y=0.08; g.add(w);
      for(let k=0;k<3;k++) P(g,GEO.disc,mat(C.lily),(r()-.5)*s,0.14,(r()-.5)*s,0.45,1,0.45); if(r()<.6) P(g,GEO.ico,mat(C.pink),0,0.3,0,0.18,0.18,0.18); },
    dead(g,r){ const s=0.9+r()*0.6; P(g,GEO.cyl,mat(0x5d5046),0,1.4*s,0,0.18*s,2.8*s,0.18*s); P(g,GEO.cyl,mat(0x5d5046),0.5*s,2.2*s,0,0.08*s,1.4*s,0.08*s,0,0,-0.8); P(g,GEO.cyl,mat(0x5d5046),-0.4*s,1.8*s,0,0.07*s,1.1*s,0.07*s,0,0,0.9); },
    grass(g,r){ for(let k=0;k<4;k++) P(g,GEO.cone,mat(C.leaf2),(r()-.5)*.8,0.35,(r()-.5)*.8,0.12,0.7+r()*.4,0.12); },
    flower(g,r){ const c=[C.pink,C.yellow,C.red,0xffffff][Math.floor(r()*4)]; for(let k=0;k<3;k++){ const x=(r()-.5)*1.2,z=(r()-.5)*1.2; P(g,GEO.cyl,mat(C.leaf),x,0.3,z,0.03,0.6,0.03); P(g,GEO.ico,mat(c),x,0.65,z,0.16,0.12,0.16); } },
    cactus(g,r){ const s=0.8+r()*0.8; const m=mat(C.cactus); P(g,GEO.cyl,m,0,1.3*s,0,0.35*s,2.6*s,0.35*s);
      P(g,GEO.cyl,m,0.55*s,1.4*s,0,0.18*s,0.7*s,0.18*s,0,0,PI/2); P(g,GEO.cyl,m,0.85*s,1.85*s,0,0.18*s,0.9*s,0.18*s);
      if(r()<.6){ P(g,GEO.cyl,m,-0.5*s,1.0*s,0,0.16*s,0.6*s,0.16*s,0,0,PI/2); P(g,GEO.cyl,m,-0.75*s,1.35*s,0,0.16*s,0.7*s,0.16*s); } },
    dune(g,r){ const s=2+r()*3; P(g,GEO.ico,mat(C.sand),0,0,0,s*1.6,s*0.45,s); },
    bones(g,r){ const m=mat(C.bone); for(let k=0;k<4;k++) P(g,GEO.rib,m,0,0.05,k*0.55-0.8,0.9-k*0.08,0.9-k*0.08,1,0,PI/2,0);
      P(g,GEO.cyl,m,0,0.08,0,0.1,2.6,0.1,PI/2,0,0); P(g,GEO.ico1,m,0,0.35,1.7,0.45,0.35,0.55); },
    lavarock(g,r){ const s=0.6+r()*1.4; P(g,GEO.dode,mat(C.lava),0,0.4*s,0,s,0.75*s,s*1.1,r()*3,r()*3,0);
      if(r()<.6) P(g,GEO.ico,mat(0xff5a1a,{emissive:0xff4400,emissiveIntensity:0.9}),0.2*s,0.75*s,0,0.2*s,0.08*s,0.3*s); },
    vent(g,r){ P(g,GEO.cone,mat(0x3a2622),0,0.6,0,1.2,1.2,1.2); P(g,GEO.disc,mat(0xff6a1a,{emissive:0xff4400,emissiveIntensity:1}),0,1.18,0,0.35,1,0.35); },
    palm(g,r){ const s=0.9+r()*0.5; let y=0, x=0; const lean=(r()<.5?-1:1)*0.12;
      for(let k=0;k<5;k++){ P(g,GEO.cyl,mat(C.palm),x,y+0.55*s,0,0.2*s,1.15*s,0.2*s,0,0,lean*k*0.5); y+=1.1*s; x+=Math.sin(lean*k*0.5)*-1.1*s; }
      for(let k=0;k<7;k++){ const a=k/7*PI*2; const f=P(g,GEO.cone,mat(C.frond),x+Math.cos(a)*1.1*s,y+0.1,Math.sin(a)*1.1*s,0.35*s,2.4*s,0.1*s); f.rotation.set(0,-a,PI/2-0.35); }
      P(g,GEO.ico,mat(0x6b4a2b),x,y-0.15,0,0.22,0.22,0.22); },
    shell(g,r){ P(g,GEO.cone,mat([0xffc1a8,0xfff0d6,0xf5b6c8][Math.floor(r()*3)]),0,0.15,0,0.35,0.3,0.35,0,0,r()); },
    ice(g,r){ const s=0.6+r()*1.4; P(g,GEO.oct,mat(C.ice,{transparent:true,opacity:0.8}),0,0.7*s,0,s*0.8,s*1.3,s*0.8,r(),r()*3,r()*.4); },
    drift(g,r){ const s=1+r()*2; P(g,GEO.ico,mat(C.snow),0,0,0,s*1.5,s*0.5,s); },
    eggs(g,r){ P(g,GEO.rib,mat(0x8a6a3e),0,0.1,0,1.0,1.0,1.4,PI/2,0,0); for(let k=0;k<3;k++) P(g,GEO.ico1,mat(C.egg),(k-1)*0.45,0.35,0,0.3,0.4,0.3); },
  };
  const TABLE={
    forest:[["pine",5],["tree",3],["bush",2],["rock",1]],
    swamp:[["pool",3],["reeds",3],["dead",2],["bush",1],["tree",1]],
    plains:[["grass",5],["flower",3],["tree",1],["rock",1],["bones",0.5]],
    desert:[["cactus",4],["rock",3],["bones",1],["dune",2]],
    volcano:[["lavarock",4],["rock",2],["dead",1],["vent",1]],
    mountains:[["rock",4],["boulder",2],["snowpine",2]],
    coast:[["palm",4],["rock",1],["shell",2],["grass",1]],
    tundra:[["snowpine",4],["ice",3],["drift",3],["rock",1]],
    nest:[["flower",3],["tree",1],["bush",2],["eggs",1]],
  };
  function pick(tab,r){ let tot=0; tab.forEach(e=>tot+=e[1]); let v=r()*tot; for(const e of tab){ v-=e[1]; if(v<=0) return e[0]; } return tab[0][0]; }
  (function buildProps(){
    const rnd=mulberry32(20260923);
    for(let i=-6;i<=FIN+8;i++){
      const hab=habAt(i), tab=TABLE[hab]||TABLE.forest;
      [-1,1].forEach(side=>{
        const n=(hab==="plains"||hab==="desert"||hab==="coast")?3:4;
        for(let k=0;k<n;k++){
          const t=i+(rnd()-0.5), d=5+Math.pow(rnd(),0.7)*34;
          if(hab==="coast" && side>0 && d>7) continue;              // the sea is on the right along the coast
          const x=pathX(t)+side*d, z=-t*SP, y=groundH(x,z);
          if(y<-0.4) continue;
          const g=new T.Group(); g.position.set(x,y,z); g.rotation.y=rnd()*PI*2;
          PROPS[pick(tab,rnd)](g,rnd);
          if(d>13) g.traverse(o=>{ o.castShadow=false; });
          scene.add(g);
        }
      });
    }
  })();

  /* ---- landmarks: volcano, mountains, ocean, nests, bone arch ---- */
  const firstOf=(h)=>{ for(let i=0;i<=FIN;i++) if(habAt(i)===h) return i; return -1; };
  let crater=null, ocean=null;
  (function buildLandmarks(){
    const v=firstOf("volcano");
    if(v>=0){ const t=v+2, x=pathX(t)-62, z=-t*SP;
      P(scene,GEO.cone,mat(0x4a2620),x,14,z,28,30,28).castShadow=false;
      P(scene,GEO.cone,mat(0x3a1e1a),x,24,z,11,10,11).castShadow=false;
      P(scene,GEO.disc,mat(0xff5a1a,{emissive:0xff4400,emissiveIntensity:1}),x,29.2,z,5.5,1,5.5).castShadow=false;
      crater=new T.Vector3(x,29.5,z); }
    const m=firstOf("mountains");
    if(m>=0){ const rnd=mulberry32(77);
      for(let k=0;k<8;k++){ const t=m-1+k*0.8, side=k%2?1:-1, d=50+rnd()*40, x=pathX(t)+side*d, z=-t*SP, h=30+rnd()*28, r=16+rnd()*12;
        P(scene,GEO.cone,mat(0x5f6672),x,h/2-2,z,r,h,r).castShadow=false;
        P(scene,GEO.cone,mat(C.snow),x,h*0.78-2,z,r*0.44,h*0.44,r*0.44).castShadow=false; } }
    const c=firstOf("coast");
    if(c>=0){ const t=c+1.5, len=SP*8;
      ocean=new T.Mesh(new T.PlaneGeometry(260,len,1,1),new T.MeshLambertMaterial({color:0x2f8fbf,transparent:true,opacity:0.88}));
      ocean.rotation.x=-PI/2; ocean.position.set(pathX(t)+138,-0.35,-t*SP); scene.add(ocean); }
    // giant nest at the finish + a bone archway ("the Game of Bones")
    const f=pathPoint(FIN);
    const nest=new T.Group(); nest.position.copy(f); scene.add(nest);
    P(nest,GEO.rib,mat(0x8a6a3e),0,0.35,0,3.4,3.4,4,PI/2,0,0);
    P(nest,GEO.rib,mat(0x7a5a33),0,0.35,0,3.4,3.4,4,-PI/2,0,0);
    for(let k=0;k<5;k++){ const a=k/5*PI*2; P(nest,GEO.ico1,mat(C.egg),Math.cos(a)*1.6,0.55,Math.sin(a)*1.6,0.45,0.6,0.45); }
    const arch=new T.Group(); arch.position.copy(pathPoint(FIN-0.55)); arch.lookAt(pathPoint(FIN-1.5)); scene.add(arch);
    const bm=mat(C.bone);
    [-1,1].forEach(s=>{ P(arch,GEO.cyl,bm,s*3.6,3.5,0,0.45,7,0.45); P(arch,GEO.ico1,bm,s*3.6+0.35,7.1,0,0.6,0.6,0.6); P(arch,GEO.ico1,bm,s*3.6-0.35,7.1,0,0.6,0.6,0.6);
      P(arch,GEO.ico1,bm,s*3.6+0.35,0.3,0,0.6,0.5,0.6); P(arch,GEO.ico1,bm,s*3.6-0.35,0.3,0,0.6,0.5,0.6); });
    P(arch,GEO.cyl,bm,0,7.3,0,0.35,7.2,0.35,0,0,PI/2);
    // starting nest
    const s0=pathPoint(-0.9); const sn=new T.Group(); sn.position.copy(s0); scene.add(sn); PROPS.eggs(sn,mulberry32(3));
  })();

  /* ---- ambient particles that follow the camera (snow, embers, fireflies…) ---- */
  const dotTex=dotTexture();
  const AMBN=260, ambPos=new Float32Array(AMBN*3), ambSeed=new Float32Array(AMBN);
  for(let i=0;i<AMBN;i++){ ambPos[i*3]=(Math.random()-0.5)*44; ambPos[i*3+1]=Math.random()*14; ambPos[i*3+2]=(Math.random()-0.5)*50; ambSeed[i]=Math.random()*100; }
  const ambGeo=new T.BufferGeometry(); ambGeo.setAttribute("position",new T.BufferAttribute(ambPos,3));
  const ambMat=new T.PointsMaterial({size:0.25,map:dotTex,transparent:true,depthWrite:false,opacity:0.9});
  const amb=new T.Points(ambGeo,ambMat); amb.frustumCulled=false; scene.add(amb);
  let ambKind=null;

  // volcano smoke plume
  let smoke=null;
  if(crater){ const n=90, pos=new Float32Array(n*3), age=new Float32Array(n);
    for(let i=0;i<n;i++) age[i]=Math.random()*8;
    const g=new T.BufferGeometry(); g.setAttribute("position",new T.BufferAttribute(pos,3));
    const m=new T.PointsMaterial({size:9,map:dotTex,transparent:true,depthWrite:false,color:0x4a3f3c,opacity:0.55});
    smoke={pts:new T.Points(g,m),pos,age,n}; smoke.pts.frustumCulled=false; scene.add(smoke.pts); }

  /* ---- transient effects ---- */
  const bursts=[], meteors=[], timers=[];
  let shake=0, sink=0, sinkTarget=0, flood=null, tar=null;
  const tint={col:new T.Color(0,0,0),amt:0,fogCut:0};
  function after(sec,fn){ timers.push({t:sec,fn}); }
  function flash(color,alpha,ms){
    flashEl.style.transition="none"; flashEl.style.background=color; flashEl.style.opacity=String(alpha==null?0.45:alpha);
    requestAnimationFrame(()=>{ flashEl.style.transition="opacity "+(ms||600)+"ms ease-out"; flashEl.style.opacity="0"; });
  }
  function setTint(hex,amt,fogCut){ tint.col.set(hex); tint.amt=amt; tint.fogCut=fogCut||0; }
  function burst(o){
    const n=o.n||60, pos=new Float32Array(n*3), col=new Float32Array(n*3), vel=[];
    const cols=(o.colors||[o.color||0xffffff]).map(h=>new T.Color(h));
    for(let i=0;i<n;i++){
      pos[i*3]=o.pos.x+(Math.random()-0.5)*(o.spread||1); pos[i*3+1]=o.pos.y+(Math.random()-0.5)*(o.spreadY||o.spread||1); pos[i*3+2]=o.pos.z+(Math.random()-0.5)*(o.spread||1);
      const a=Math.random()*PI*2, e=(Math.random()*2-1), sp=(o.speed||4)*(0.4+Math.random()*0.6);
      const r=Math.sqrt(1-e*e);
      vel.push(new T.Vector3(Math.cos(a)*r*sp+(o.vx||0), Math.abs(e)*sp*(o.upBias||1)+(o.up||0), Math.sin(a)*r*sp+(o.vz||0)));
      const c=cols[i%cols.length]; col[i*3]=c.r; col[i*3+1]=c.g; col[i*3+2]=c.b;
    }
    const g=new T.BufferGeometry(); g.setAttribute("position",new T.BufferAttribute(pos,3)); g.setAttribute("color",new T.BufferAttribute(col,3));
    const m=new T.PointsMaterial({size:o.size||0.35,map:dotTex,vertexColors:true,transparent:true,depthWrite:false,
      blending:o.add?T.AdditiveBlending:T.NormalBlending});
    const pts=new T.Points(g,m); pts.frustumCulled=false; scene.add(pts);
    bursts.push({pts,pos,vel,n,age:0,life:o.life||1.6,gravity:o.gravity==null?-6:o.gravity,drag:o.drag||0.6});
  }
  function meteor(target,delay){
    const m=new T.Mesh(GEO.ico1,new T.MeshBasicMaterial({color:0xffa040})); m.scale.setScalar(0.55+Math.random()*0.4); m.visible=false; scene.add(m);
    const from=target.clone().add(new T.Vector3((Math.random()-0.5)*18,26+Math.random()*8,-12-Math.random()*10));
    meteors.push({m,from,to:target.clone(),t:-(delay||0),dur:0.8+Math.random()*0.5});
  }

  /* ---- player models & transient actors ---- */
  const models={};          // idx -> entry
  const actors=[];          // wild dinos etc.
  let S=null, lastActive=null;
  function camGround(){ return pathPoint(camT); }

  function setAnim(e,mode){ if(!e) return; e.anim.mode=mode; e.anim.t=0; }
  function setOpacity(e,o){
    if(Math.abs(o-e.opacity)<0.001) return; e.opacity=o;
    e.mats.forEach(m=>{ if(!m.transparent){ m.transparent=true; m.needsUpdate=true; } m.opacity=o; });
    if(e.label) e.label.material.opacity=o;
  }
  function disposeEntry(e){
    scene.remove(e.holder);
    e.mats.forEach(m=>m.dispose());
    if(e.label){ e.label.material.map.dispose(); e.label.material.dispose(); }
  }
  function spawnActor(arch,hex,opts){
    const e=makeDino(arch,hex); scene.add(e.holder); actors.push(e);
    const t=S?activePos():0;
    pathPoint(t+(opts&&opts.ahead||0.55),e.base); e.target.copy(e.base);
    e.face.copy(camGround()); e.yaw=Math.atan2(e.face.x-e.base.x,e.face.z-e.base.z);
    e.side=Math.random()<0.5?-1:1; e.tag=opts&&opts.tag;
    setAnim(e,"enter"); e.holder.position.copy(e.base);
    return e;
  }
  function findActor(tag){ return actors.find(a=>a.tag===tag && !a.dead); }
  function dismissActors(){ actors.forEach(a=>{ if(a.anim.mode!=="exit") setAnim(a,"exit"); }); }

  function activeP(){ return S && S.players.find(p=>p.idx===S.active); }
  function activePos(){ const a=activeP(); return a?a.pos:0; }

  function layout(snap){
    const act=activeP(); const groups={};
    S.players.forEach(p=>{ if(!act || p.idx!==act.idx) (groups[p.pos]=groups[p.pos]||[]).push(p); });
    Object.keys(groups).forEach(k=>{
      const arr=groups[k], pos=+k, n=arr.length, withCam=act && pos===act.pos;
      arr.forEach((p,j)=>{
        // rivals sharing the camera's space stand well ahead and off-centre so they never fill the view
        const e=models[p.idx], big=Math.max(1,(e.height||2)/2.5);
        const off=withCam?((j-(n-1)/2)*3+(n===1?1.8:0))*big:(j-(n-1)/2)*2.5;
        const t=withCam?pos+0.55*big+0.15:pos;
        pathPoint(t,e.target).addScaledVector(pathRight(t),n>1||withCam?off:0);
        if(withCam) e.face.copy(pathPoint(pos-0.3)); else pathPoint(pos+1.2,e.face).addScaledVector(pathRight(pos),off);
        if(snap){ e.base.copy(e.target); e.yaw=Math.atan2(e.face.x-e.base.x,e.face.z-e.base.z); }
      });
    });
  }

  /* ---- camera state ---- */
  let camT=0, targetT=0, eyeS=2.5, eyeT=2.5, liftS=0;
  let lookYaw=0, lookPitch=0, yawS=0, pitchS=0, lastDrag=-99, time=0;

  function sync(state,snap){
    S=state;
    const act=activeP(), shown=[];
    state.players.forEach(p=>{
      const hex=resolveColor(p.color);
      let e=models[p.idx];
      if(!e || e.arch!==p.arch || e.hex!==hex){
        if(e) disposeEntry(e);
        e=models[p.idx]=makeDino(p.arch,hex); e.hex=hex; scene.add(e.holder); e.fresh=true;
      }
      const key=p.name+"|"+p.hp+"|"+p.maxHp+"|"+(p.finished?1:0);
      if(e.labelKey!==key){
        e.labelKey=key;
        if(e.label){ e.label.material.map.dispose(); e.label.material.map=labelTexture(p,hex); e.label.material.needsUpdate=true; }
        else { e.label=new T.Sprite(new T.SpriteMaterial({map:labelTexture(p,hex),depthTest:false,transparent:true})); e.label.renderOrder=10; e.label.scale.set(1.9,0.7,1); e.holder.add(e.label); }
        e.label.position.set(0,e.height+0.9,0);
      }
      const hide=(act && p.idx===act.idx) || (p.extinct && e.anim.mode!=="fall");
      if(!hide && !e.holder.visible){ e.holder.visible=true; setOpacity(e,1); e.root.rotation.z=0; shown.push(e); }
      if(hide && e.anim.mode!=="fall") e.holder.visible=false;
    });
    Object.keys(models).forEach(k=>{ if(!state.players.some(p=>p.idx===+k)){ disposeEntry(models[k]); delete models[k]; } });
    const fresh=Object.values(models).some(e=>e.fresh);
    layout(snap||fresh);
    Object.values(models).forEach(e=>{ if(e.fresh || shown.indexOf(e)>=0){ e.base.copy(e.target); e.yaw=Math.atan2(e.face.x-e.base.x,e.face.z-e.base.z); e.fresh=false; } });
    if(act){
      targetT=act.pos; eyeT=EYE[act.arch]||2.5;
      if(snap){ camT=targetT; eyeS=eyeT; liftS=0; }
      if(lastActive!==act.idx){ lastActive=act.idx; lookYaw=lookPitch=0; dismissActors(); }
    }
  }

  /* ---- hazards ---- */
  const HAZ={
    "Asteroid Shower":  (at)=>{ setTint(0xff8a3d,0.45); for(let k=0;k<10;k++) meteor(at.clone().add(new T.Vector3((Math.random()-0.5)*14,0,-6-Math.random()*16)),k*0.18); },
    "Volcanic Eruption":(at)=>{ setTint(0xff3b1a,0.55); shake=Math.max(shake,0.35);
      for(let k=0;k<4;k++) after(k*0.35,()=>burst({pos:at.clone().add(new T.Vector3((Math.random()-0.5)*10,0.5,-10)),n:80,colors:[0xff6a1a,0xffb13d,0xff3b1a],speed:9,upBias:2,size:0.5,life:2,add:true})); },
    "Predator Ambush":  ()=>{ setTint(0x3a2a2a,0.35); spawnActor("apex",0x3b3530,{tag:"predator",ahead:0.5}); shake=Math.max(shake,0.2); },
    "Disease":          (at)=>{ setTint(0x7cff5a,0.4); burst({pos:at.clone().add(new T.Vector3(0,0.5,-4)),n:70,color:0x9cff6a,speed:1.2,gravity:1.2,up:0.6,spread:8,size:0.5,life:3}); },
    "Cold Snap":        (at)=>{ setTint(0xcfe9ff,0.6); burst({pos:at.clone().add(new T.Vector3(0,12,-4)),n:260,color:0xffffff,speed:0.8,gravity:-1.2,spread:26,spreadY:6,size:0.3,life:4}); },
    "Flash Flood":      (at)=>{ setTint(0x3a8fd0,0.4); flood={t:0,mesh:(()=>{ const m=new T.Mesh(new T.CircleGeometry(45,32),new T.MeshLambertMaterial({color:0x3aa6d8,transparent:true,opacity:0.72})); m.rotation.x=-PI/2; m.position.copy(at).setY(-0.5); scene.add(m); return m; })()};
                             burst({pos:at.clone().add(new T.Vector3(0,14,-6)),n:220,color:0x9fd8ff,speed:0.4,gravity:-26,spread:28,spreadY:4,size:0.18,life:1.4}); },
    "Tar Pit":          (at)=>{ setTint(0x221a16,0.35); tar={t:0,mesh:(()=>{ const m=new T.Mesh(new T.CircleGeometry(1,24),new T.MeshLambertMaterial({color:0x15110f,transparent:true,opacity:0.92})); m.rotation.x=-PI/2; m.position.copy(at).setY(0.42); scene.add(m); return m; })()}; sinkTarget=-0.45; },
    "Sandstorm":        (at)=>{ setTint(0xe0b872,0.6,0.75); burst({pos:at.clone().add(new T.Vector3(-18,2,-6)),n:300,color:0xe7c78b,speed:1,vx:14,gravity:0,spread:30,spreadY:5,size:0.3,life:2.5,drag:0}); },
    "Drought":          (at)=>{ setTint(0xff9a3d,0.45,0.3); burst({pos:at.clone().add(new T.Vector3(0,1,-6)),n:80,color:0xe0b16b,speed:1.5,gravity:0.4,spread:14,size:0.4,life:2.5}); },
    "Food Shortage":    (at)=>{ setTint(0xb07a3a,0.3); burst({pos:at.clone().add(new T.Vector3(0,9,-5)),n:90,colors:[0xc0712b,0xd9a13b,0x8a4f22],speed:0.6,gravity:-1.4,spread:14,spreadY:4,size:0.45,life:4}); },
  };

  function fx(name,d){
    d=d||{};
    const at=pathPoint(activePos());
    switch(name){
      case "hazard":{ lookYaw=lookPitch=0; (HAZ[d.name]||((a)=>setTint(0xff6a3d,0.35)))(at); break; }
      case "hazardResult":{
        if(d.dodged){ flash("rgba(160,230,255,.9)",0.35,700); burst({pos:at.clone().setY(2),n:60,colors:[0xbff0ff,0xffffff],speed:5,size:0.3,life:1,add:true}); }
        else if(d.ok){ flash("rgba(120,255,150,.9)",0.25,700); }
        else if(d.kind==="wash"){ flash("rgba(90,170,255,.9)",0.4,800); shake=Math.max(shake,0.3); }
        else { flash("rgba(255,40,40,.95)",0.5,700); shake=Math.max(shake,0.55); }
        const pred=findActor("predator");
        if(pred){ if(!d.ok && !d.dodged){ setAnim(pred,"lunge"); after(0.7,()=>setAnim(pred,"exit")); } else setAnim(pred,"exit"); }
        after(1.2,()=>{ tint.amt*=0.5; });
        break; }
      case "wild":{ lookYaw=lookPitch=0; spawnActor(d.arch||"apex",NATURAL[d.arch]||0x7a5c3a,{tag:"wild"}); shake=Math.max(shake,0.15); break; }
      case "wildResult":{
        const w=findActor("wild");
        if(d.win){ if(w){ setAnim(w,"hop"); after(0.6,()=>setAnim(w,"exit")); }
          flash("rgba(120,255,150,.9)",0.25,700);
          if(d.aggressive) burst({pos:at.clone().setY(1.5),n:70,colors:[0xff6b8a,0xffd1dc,0xffffff],speed:3,gravity:1,size:0.35,life:1.4,add:true}); }
        else { if(w){ setAnim(w,"lunge"); after(0.7,()=>setAnim(w,"exit")); } after(0.2,()=>{ flash("rgba(255,40,40,.95)",0.5,700); shake=Math.max(shake,0.55); }); }
        break; }
      case "clash":{ lookYaw=lookPitch=0; const e=models[d.defender]; if(e) setAnim(e,"roar"); shake=Math.max(shake,0.2); break; }
      case "clashResult":{
        const act=activeP(); if(d.loser==null){ shake=Math.max(shake,0.15); break; }
        if(act && d.loser===act.idx){ const w=models[d.other]; if(w) setAnim(w,"lunge"); after(0.25,()=>{ flash("rgba(255,40,40,.95)",0.5,700); shake=Math.max(shake,0.5); }); }
        else { const e=models[d.loser]; if(e) setAnim(e,"hop"); flash("rgba(255,220,120,.9)",0.2,500); shake=Math.max(shake,0.25); }
        break; }
      case "oasis":{ flash("rgba(120,230,255,.9)",0.3,900);
        burst({pos:at.clone().setY(0.6),n:110,colors:[0x7fe7ff,0xffffff,0xbaffd8],speed:2.2,gravity:2.5,up:1,spread:3,size:0.35,life:2,add:true}); break; }
      case "extinct":{ const act=activeP();
        if(act && d.idx===act.idx){ flash("rgba(40,20,20,.95)",0.8,1400); sinkTarget=-(eyeT-0.5); shake=Math.max(shake,0.4); after(1.1,()=>{ sinkTarget=0; }); }
        else { const e=models[d.idx]; if(e){ e.holder.visible=true; setAnim(e,"fall"); } }
        break; }
      case "respawn":{ after(0.4,()=>{ const p=S.players.find(q=>q.idx===d.idx); if(!p) return;
          const where=(activeP() && d.idx===activeP().idx)?pathPoint(p.pos+0.8):pathPoint(p.pos);
          burst({pos:where.setY(1),n:90,colors:[0xfff3dc,0xffffff,0xe8d9b5],speed:5,size:0.4,life:1.6});
          if(activeP() && d.idx===activeP().idx) flash("rgba(255,250,235,.95)",0.55,900); }); break; }
      case "nest":{ const f=pathPoint(FIN).setY(6); flash("rgba(255,215,90,.9)",0.4,900);
        for(let k=0;k<4;k++) after(k*0.35,()=>burst({pos:f.clone().add(new T.Vector3((Math.random()-0.5)*8,Math.random()*3,(Math.random()-0.5)*6)),n:90,colors:[0xffd766,0xff7eb6,0x5db0ff,0x7ed957,0xffffff],speed:8,gravity:-5,size:0.4,life:2.2,add:true})); break; }
      case "tiebreak":{ lookYaw=lookPitch=0; shake=Math.max(shake,0.3); flash("rgba(255,215,90,.9)",0.3,600); const e=models[d.other]; if(e) setAnim(e,"roar"); break; }
      case "roar":{ const e=models[d.idx]; if(e) setAnim(e,"roar"); break; }
    }
  }

  /* ---- input: drag to look around ---- */
  let drag=null;
  cv.addEventListener("pointerdown",e=>{ drag={x:e.clientX,y:e.clientY}; cv.setPointerCapture(e.pointerId); hintEl.classList.add("gone"); });
  cv.addEventListener("pointermove",e=>{ if(!drag) return;
    lookYaw=clamp(lookYaw+(e.clientX-drag.x)*0.006,-1.4,1.4); lookPitch=clamp(lookPitch-(e.clientY-drag.y)*0.004,-0.55,0.45);
    drag.x=e.clientX; drag.y=e.clientY; lastDrag=time; });
  const endDrag=e=>{ drag=null; try{ cv.releasePointerCapture(e.pointerId); }catch(_){} };
  cv.addEventListener("pointerup",endDrag); cv.addEventListener("pointercancel",endDrag);
  setTimeout(()=>hintEl.classList.add("gone"),6000);

  /* ---- per-frame updates ---- */
  const v1=new T.Vector3(), v2=new T.Vector3(), v3=new T.Vector3(), up=new T.Vector3(0,1,0);
  const cSky=new T.Color(), cFog=new T.Color(), cSun=new T.Color();

  function updateCamera(dt){
    const prev=camT;
    camT+= (targetT-camT)*(1-Math.exp(-dt*2.6));
    if(Math.abs(targetT-camT)<0.002) camT=targetT;
    const speed=Math.abs(camT-prev)/Math.max(dt,1e-4), dist=Math.abs(targetT-camT);
    liftS=lerp(liftS,clamp((dist-1.5)*1.6,0,20),1-Math.exp(-dt*3));
    eyeS=lerp(eyeS,eyeT,1-Math.exp(-dt*3));
    sink=lerp(sink,sinkTarget,1-Math.exp(-dt*4));
    if(time-lastDrag>2.5){ lookYaw*=Math.exp(-dt*1.6); lookPitch*=Math.exp(-dt*1.6); }
    yawS=lerp(yawS,lookYaw,1-Math.exp(-dt*10)); pitchS=lerp(pitchS,lookPitch,1-Math.exp(-dt*10));
    const p=pathPoint(camT-0.18,v1);   // stand at the back edge of the stone so it doesn't fill the view
    const bob=Math.sin(time*9.5)*0.07*clamp(speed*0.9,0,1);
    camera.position.set(p.x,eyeS+liftS+bob+sink,p.z);
    const f=v2.subVectors(pathPoint(camT+1.4,v3),p).setY(0).normalize();
    const c=Math.cos(yawS), s=Math.sin(yawS);
    const fx_=f.x*c+f.z*s, fz_=-f.x*s+f.z*c;
    const pitch=pitchS-0.02-eyeS*0.025-liftS*0.035;   // short dinos look more level
    camera.lookAt(camera.position.x+fx_*10, camera.position.y+Math.tan(pitch)*10, camera.position.z+fz_*10);
    if(shake>0.001){ camera.position.x+=(Math.random()-0.5)*shake*0.5; camera.position.y+=(Math.random()-0.5)*shake*0.5; camera.rotation.z+=(Math.random()-0.5)*shake*0.06; shake*=Math.exp(-dt*5); }
  }

  function animate(e,dt){
    const k=1-Math.exp(-dt*3.2);
    v1.copy(e.base); e.base.lerp(e.target,k);
    const spd=v1.distanceTo(e.base)/Math.max(dt,1e-4);
    e.moving=lerp(e.moving,clamp(spd/2,0,1),1-Math.exp(-dt*6));
    const desired=Math.atan2(e.face.x-e.base.x,e.face.z-e.base.z);
    e.yaw=angleLerp(e.yaw,desired,1-Math.exp(-dt*4));
    const a=e.anim; a.t+=dt;
    const fwd=v2.set(Math.sin(e.yaw),0,Math.cos(e.yaw));
    const off=v3.set(0,0,0);
    let extraYaw=0, jaw=0, headP=0, pulse=1, tip=0;
    switch(a.mode){
      case "enter":{ const q=clamp(a.t/0.7,0,1), e2=easeOut(q);
        off.copy(pathRight(camT)).multiplyScalar(e.side*(1-e2)*8).addScaledVector(up,Math.sin(PI*q)*2.4);
        if(q>=1) setAnim(e,"roar"); break; }
      case "roar":{ const q=clamp(a.t/1.1,0,1); jaw=Math.sin(PI*q)*0.65; headP=-Math.sin(PI*q)*0.3; pulse=1+Math.sin(PI*q)*0.07; if(q>=1) setAnim(e,"idle"); break; }
      case "lunge":{ const q=clamp(a.t/0.55,0,1); off.addScaledVector(fwd,Math.sin(PI*q)*2.4); jaw=Math.sin(PI*q)*0.55; if(q>=1) setAnim(e,"idle"); break; }
      case "hop":{ const q=clamp(a.t/0.6,0,1); off.addScaledVector(fwd,-Math.sin(PI*q)*1.4).addScaledVector(up,Math.sin(PI*q)*0.9); if(q>=1) setAnim(e,"idle"); break; }
      case "exit":{ extraYaw=PI*easeInOut(clamp(a.t/0.45,0,1)); off.addScaledVector(fwd,-Math.max(0,a.t-0.35)*5.5);
        setOpacity(e,1-clamp((a.t-0.8)/1.0,0,1)); if(a.t>1.9) e.dead=true; break; }
      case "fall":{ tip=easeOut(clamp(a.t/0.6,0,1))*PI/2; setOpacity(e,1-clamp((a.t-1.0)/0.7,0,1)); if(a.t>1.8){ e.holder.visible=false; setOpacity(e,1); setAnim(e,"idle"); } break; }
    }
    const P_=e.parts, t=time+e.phase;
    if(P_.tail) P_.tail.rotation.y=Math.sin(t*2.2)*0.18;
    P_.legs.forEach((L,i)=>{ L.rotation.x=Math.sin(t*9+(i%2)*PI+(i>1?PI/2:0))*0.5*e.moving; });
    if(P_.jaw) P_.jaw.rotation.x=jaw+Math.max(0,Math.sin(t*0.9))*0.04;
    if(P_.head) P_.head.rotation.x=headP+Math.sin(t*1.3)*0.04;
    if(P_.neck){ P_.neck.rotation.y=Math.sin(t*0.7)*0.12; P_.neck.rotation.x=headP*0.5; }
    if(P_.wings) P_.wings.forEach(W=>{ W.rotation.z=W.userData.side*Math.sin(t*6)*0.45; });
    if(P_.hover) P_.hover.position.y=Math.sin(t*2)*0.25+0.3;
    if(P_.flippers) P_.flippers.forEach(F=>{ F.rotation.z=F.userData.side*Math.sin(t*2.5)*0.3; });
    const sc=e.scale*pulse;
    e.root.scale.set(sc,sc*(1+Math.sin(t*2)*0.012),sc);
    e.holder.position.copy(e.base).add(off);
    e.root.rotation.set(0,e.yaw+extraYaw,tip);
  }

  function updateEnv(dt){
    tcol(tbl.sky,camT,cSky); tcol(tbl.fog,camT,cFog); tcol(tbl.sun,camT,cSun);
    tint.amt*=Math.exp(-dt*0.3); tint.fogCut*=Math.exp(-dt*0.3);
    if(tint.amt>0.002){ cSky.lerp(tint.col,tint.amt); cFog.lerp(tint.col,tint.amt); }
    scene.background.copy(cSky); scene.fog.color.copy(cFog);
    scene.fog.near=lerp(28,4,tint.fogCut); scene.fog.far=lerp(125,30,tint.fogCut);
    hemi.color.copy(cSky); sun.color.copy(cSun);
    const g=pathPoint(camT,v1);
    sun.position.set(g.x+22,38,g.z+12); sun.target.position.copy(g); sun.target.updateMatrixWorld();
    icons.forEach(ic=>{ ic.spr.position.y=3.3+Math.sin(time*1.6+ic.i)*0.12; const d=Math.abs(ic.i-camT); ic.spr.visible=d>0.35; ic.spr.material.opacity=clamp((d-0.35)/0.5,0,1); });
    glowDiscs.forEach((m,i)=>{ m.material.emissiveIntensity=0.3+Math.sin(time*2.4+i)*0.2; });
    if(ocean) ocean.position.y=-0.35+Math.sin(time*0.8)*0.06;
    // ambient particles
    const kind=(BIOME[habAt(camT)]||{}).amb||null;
    if(kind!==ambKind){ ambKind=kind; const c=AMB[kind];
      if(c){ ambMat.color.set(c.color); ambMat.size=c.size; ambMat.blending=c.add?T.AdditiveBlending:T.NormalBlending; ambMat.needsUpdate=true; ambGeo.setDrawRange(0,c.n); amb.visible=true; }
      else amb.visible=false; }
    const c=AMB[ambKind];
    if(c){ const cp=camera.position;
      for(let i=0;i<c.n;i++){ const s=ambSeed[i];
        let x=ambPos[i*3]+(c.vel[0]+Math.sin(time*0.7+s)*c.wander)*dt,
            y=ambPos[i*3+1]+(c.vel[1]+Math.cos(time*0.9+s*1.3)*c.wander*0.6)*dt,
            z=ambPos[i*3+2]+(c.vel[2]+Math.sin(time*0.5+s*0.7)*c.wander)*dt;
        let dx=x-cp.x, dz=z-cp.z;
        if(dx>22) x-=44; else if(dx<-22) x+=44;
        if(dz>25) z-=50; else if(dz<-25) z+=50;
        if(y>cp.y+10) y-=14; else if(y<cp.y-4) y+=14;
        ambPos[i*3]=x; ambPos[i*3+1]=y; ambPos[i*3+2]=z; }
      ambGeo.attributes.position.needsUpdate=true;
      ambMat.opacity=c.blink?0.55+Math.sin(time*3)*0.35:0.9; }
    // volcano smoke plume
    if(smoke){ const on=camera.position.distanceTo(crater)<230; smoke.pts.visible=on;
      if(on){ for(let i=0;i<smoke.n;i++){ smoke.age[i]+=dt; if(smoke.age[i]>8) smoke.age[i]-=8; const a=smoke.age[i], r=a*1.4;
        smoke.pos[i*3]=crater.x+Math.sin(i*1.7)*r+a*1.5; smoke.pos[i*3+1]=crater.y+a*4.5; smoke.pos[i*3+2]=crater.z+Math.cos(i*2.3)*r; }
        smoke.pts.geometry.attributes.position.needsUpdate=true; } }
  }

  function updateFx(dt){
    for(let i=timers.length-1;i>=0;i--){ timers[i].t-=dt; if(timers[i].t<=0){ const f=timers[i].fn; timers.splice(i,1); try{ f(); }catch(err){ console.warn(err); } } }
    for(let i=bursts.length-1;i>=0;i--){ const b=bursts[i]; b.age+=dt;
      for(let j=0;j<b.n;j++){ const v=b.vel[j]; v.y+=b.gravity*dt; v.multiplyScalar(1-b.drag*dt*0.5);
        b.pos[j*3]+=v.x*dt; b.pos[j*3+1]+=v.y*dt; b.pos[j*3+2]+=v.z*dt; }
      b.pts.geometry.attributes.position.needsUpdate=true; b.pts.material.opacity=1-clamp(b.age/b.life,0,1);
      if(b.age>=b.life){ scene.remove(b.pts); b.pts.geometry.dispose(); b.pts.material.dispose(); bursts.splice(i,1); } }
    for(let i=meteors.length-1;i>=0;i--){ const m=meteors[i]; m.t+=dt; if(m.t<0) continue; m.m.visible=true;
      const q=clamp(m.t/m.dur,0,1); m.m.position.lerpVectors(m.from,m.to,q*q);
      if(Math.random()<0.7) burst({pos:m.m.position,n:3,color:0xffb13d,speed:0.5,gravity:0,size:0.6,life:0.5,add:true});
      if(q>=1){ burst({pos:m.to.clone().setY(0.5),n:60,colors:[0xff6a1a,0xffd06a,0x5a4a44],speed:7,upBias:1.6,size:0.45,life:1.3,add:true});
        shake=Math.max(shake,0.25); scene.remove(m.m); m.m.material.dispose(); meteors.splice(i,1); } }
    if(flood){ flood.t+=dt; const t=flood.t; flood.mesh.position.y=t<1.2?lerp(-0.5,1.1,easeOut(t/1.2)):t<2.8?1.1:lerp(1.1,-0.6,(t-2.8)/1.6);
      if(t>4.4){ scene.remove(flood.mesh); flood.mesh.geometry.dispose(); flood.mesh.material.dispose(); flood=null; } }
    if(tar){ tar.t+=dt; const t=tar.t; tar.mesh.scale.setScalar(t<0.8?easeOut(t/0.8)*4.5:4.5); tar.mesh.material.opacity=0.92*(1-clamp((t-2.6)/1.2,0,1));
      if(t>2.2) sinkTarget=0; if(t>3.8){ scene.remove(tar.mesh); tar.mesh.geometry.dispose(); tar.mesh.material.dispose(); tar=null; } }
    for(let i=actors.length-1;i>=0;i--){ const a=actors[i]; animate(a,dt); if(a.dead){ disposeEntry(a); actors.splice(i,1); } }
  }

  /* ---- loop ---- */
  let running=false, last=0, raf=0;
  function frame(now){
    if(!running) return;
    raf=requestAnimationFrame(frame);
    const dt=Math.min(0.05,((now-last)/1000)||0.016); last=now; time+=dt;
    if(container.offsetParent===null) return;   // hidden (e.g. 2D view or another screen) — skip rendering
    try{
      updateCamera(dt);
      const cp=camera.position;
      Object.values(models).forEach(e=>{
        if(!e.holder.visible) return;
        animate(e,dt);
        // while the camera glides past a rival, hide it rather than clip through its body
        const d=Math.hypot(e.holder.position.x-cp.x,e.holder.position.z-cp.z);
        e.root.visible=d>2.6+e.height*0.3 || e.anim.mode==="fall";
        if(e.label) e.label.visible=d>5;
      });
      updateFx(dt); updateEnv(dt);
      renderer.render(scene,camera);
    }catch(err){ console.warn("[world3d]",err); }
  }
  function resize(){
    const w=container.clientWidth||window.innerWidth, h=container.clientHeight||window.innerHeight;
    renderer.setSize(w,h,false); cv.style.width="100%"; cv.style.height="100%";
    camera.aspect=w/Math.max(1,h); camera.updateProjectionMatrix();
  }
  const ro=("ResizeObserver" in window)?new ResizeObserver(resize):null;
  if(ro) ro.observe(container); else window.addEventListener("resize",resize);
  resize();

  return {
    sync, fx,
    setActive(on){ if(on && !running){ running=true; last=performance.now(); resize(); raf=requestAnimationFrame(frame); } else if(!on){ running=false; cancelAnimationFrame(raf); } },
    resize,
    reset(){ actors.forEach(disposeEntry); actors.length=0; bursts.forEach(b=>scene.remove(b.pts)); bursts.length=0; lastActive=null; tint.amt=0; sinkTarget=0; },
  };
}

window.EFWorld={ create };
})();
