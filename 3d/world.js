/* Extinction Fighters — first-person 3D world ("animated film" look).
   A pure VIEW layer: the rules engine in index.html owns all game state and calls
   world.sync(state) whenever things change and world.fx(name, data) at dramatic
   moments. Nothing in here changes the game.
   Look: cel-shaded, ink-lined, Spider-Verse print texture (EFInk), procedural
   creatures (EFDinos), painterly Ghost-in-the-Shell-style backgrounds and anime skies.
   Requires THREE r149 + 3d/ink.js + 3d/dinos.js. Exposes window.EFWorld = { create }. */
(function(){
"use strict";
const T = window.THREE, INK = window.EFInk, DN = window.EFDinos;
if(!T || !INK || !DN) return;
const K = DN.kit;

const SP = 8;                       // world units between board spaces
const PI = Math.PI;
const WATER_Y = -0.35;

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
const fbm=(x,y)=>vnoise(x,y)*0.5+vnoise(x*2.03+5.3,y*2.03+1.7)*0.28+vnoise(x*4.1+9.1,y*4.1+3.3)*0.14+vnoise(x*8.3+2.2,y*8.3+7.7)*0.08;
const ridged=(x,y)=>(1-Math.abs(2*vnoise(x,y)-1))*0.62+(1-Math.abs(2*vnoise(x*2.1+4.4,y*2.1+1.3)-1))*0.38;
function angleLerp(a,b,t){ let d=((b-a+PI)%(2*PI)+2*PI)%(2*PI)-PI; return a+d*t; }
function resolveColor(c){
  if(typeof c==="string" && c.indexOf("var(")===0){
    const v=getComputedStyle(document.documentElement).getPropertyValue(c.slice(4,-1).trim()).trim();
    return v||"#ffffff";
  }
  return c||"#ffffff";
}

/* ------------------------------------------------------------ the trail */
function pathX(t){ return Math.sin(t*0.45)*8 + Math.sin(t*0.17+1)*5; }
function pathPoint(t,out){ return (out||new T.Vector3()).set(pathX(t),0,-t*SP); }
function pathTangent(t,out){ const e=0.05; return (out||new T.Vector3()).set(pathX(t+e)-pathX(t-e),0,-2*e*SP).normalize(); }
function pathRight(t,out){ const tg=pathTangent(t); return (out||new T.Vector3()).set(-tg.z,0,tg.x); }

/* --------------------------------------------------------------- biomes */
const BIOME = {
  forest:   { ground:0x4c8a3c, ground2:0x2f6b35, path:0x9a7b54, rock:0x7d7b72, top:0x4a93d8, hor:0xcfe6e2, sun:0xfff0d2, rim:0xfff0c4, cloud:0xffffff, cshade:0xa8b6d8, clouds:0.55, hill:7,  peak:10, ridge:34, amb:"pollen" },
  swamp:    { ground:0x4f7448, ground2:0x2c5140, path:0x6b6444, rock:0x5d6456, top:0x6aa3a4, hor:0xc4d8c4, sun:0xe8f4d0, rim:0xd6ffb8, cloud:0xf2f6ea, cshade:0x93a8a4, clouds:0.75, hill:1.4,peak:3,  ridge:14, amb:"fireflies" },
  plains:   { ground:0x92b24c, ground2:0x6a9a3c, path:0xb09060, rock:0x9a9282, top:0x4c9ce8, hor:0xe2f0e0, sun:0xfff3d6, rim:0xfff4c8, cloud:0xffffff, cshade:0xaebbe0, clouds:0.6,  hill:3,  peak:6,  ridge:18, amb:"pollen" },
  desert:   { ground:0xdcae68, ground2:0xc48a4a, path:0xc9985a, rock:0xb8683e, top:0x5b9ad8, hor:0xf6dcae, sun:0xffe4b4, rim:0xffc27a, cloud:0xfff4e4, cshade:0xd6b0a0, clouds:0.25, hill:5,  peak:14, ridge:34, amb:"dust", terrace:1 },
  volcano:  { ground:0x4a2c28, ground2:0x2a1c1c, path:0x362a26, rock:0x3a2a28, top:0x2a1a26, hor:0xa24a36, sun:0xff9a6a, rim:0xff6a2a, cloud:0x5a4448, cshade:0x2a1e22, clouds:0.8,  hill:7,  peak:18, ridge:40, amb:"embers" },
  mountains:{ ground:0x6a7a62, ground2:0x4a5a52, path:0x8a847a, rock:0x6f7682, top:0x4f86c8, hor:0xdde8f2, sun:0xf6f8ff, rim:0xd4ecff, cloud:0xffffff, cshade:0xa0b0d0, clouds:0.5,  hill:12, peak:46, ridge:80, amb:null, snow:1 },
  coast:    { ground:0xd8c48c, ground2:0x8aac5a, path:0xe6d2a0, rock:0x9a948a, top:0x3a9ce8, hor:0xd4eef6, sun:0xfff6e0, rim:0xfff0d0, cloud:0xffffff, cshade:0xa8c0e0, clouds:0.55, hill:3,  peak:6,  ridge:20, amb:null },
  tundra:   { ground:0xe8eff5, ground2:0xc8d8e4, path:0xb8c8d4, rock:0x7a8492, top:0x86a8d0, hor:0xe8eef4, sun:0xf0f6ff, rim:0xbfe6ff, cloud:0xf4f8ff, cshade:0xb0c0d8, clouds:0.85, hill:6,  peak:20, ridge:50, amb:"snow", snow:1 },
  nest:     { ground:0xa8b85a, ground2:0xd9b34f, path:0xe8c870, rock:0xb09a7a, top:0xf09a6a, hor:0xffe0a8, sun:0xffd28a, rim:0xffb070, cloud:0xfff0d8, cshade:0xe0a0a0, clouds:0.5,  hill:2,  peak:5,  ridge:18, amb:"gold" },
};
const AMB = {
  pollen:    { color:0xfff3b0, size:0.14, vel:[0.2,0.15,0],  wander:0.4, n:70  },
  fireflies: { color:0xd8ff6a, size:0.30, vel:[0,0,0],       wander:0.9, n:90, blink:true, add:true },
  dust:      { color:0xe7c78b, size:0.22, vel:[3,0.1,0.8],   wander:0.5, n:170 },
  embers:    { color:0xff6a1a, size:0.24, vel:[0.3,2.0,0],   wander:0.6, n:150, add:true },
  snow:      { color:0xffffff, size:0.26, vel:[0.4,-1.4,0],  wander:0.5, n:240 },
  gold:      { color:0xffd766, size:0.24, vel:[0,0.7,0],     wander:0.5, n:120, add:true },
};
const TYPE_COL  = { start:0xe8b93e, finish:0xe8b93e, adversity:0xd2553f, fight:0xd77f2e, bonus:0x39a3c8, empty:0x9a9489 };
const RUNE_COL  = { start:0xffd24a, finish:0xffd24a, adversity:0xff4a36, fight:0xff9a22, bonus:0x3fe6ff, empty:0xcfc6ae };
const EYE       = { apex:3.0, raptor:1.85, horned:2.1, armored:1.35, giant:4.8, grazer:2.8, flyer:2.9, marine:2.4 };
const PREDATORS = ["Tyrannosaurus rex","Allosaurus","Giganotosaurus","Carcharodontosaurus"];

/* ------------------------------------------------------ canvas textures */
function roundRect(x,X,Y,W,H,R){ x.beginPath(); x.moveTo(X+R,Y); x.arcTo(X+W,Y,X+W,Y+H,R); x.arcTo(X+W,Y+H,X,Y+H,R); x.arcTo(X,Y+H,X,Y,R); x.arcTo(X,Y,X+W,Y,R); x.closePath(); }
const FONT='"Arial Black","Helvetica Neue",ui-rounded,system-ui,sans-serif';
function dotTexture(){
  const c=document.createElement("canvas"); c.width=c.height=64; const x=c.getContext("2d");
  const g=x.createRadialGradient(32,32,0,32,32,32);
  g.addColorStop(0,"rgba(255,255,255,1)"); g.addColorStop(0.45,"rgba(255,255,255,.9)"); g.addColorStop(1,"rgba(255,255,255,0)");
  x.fillStyle=g; x.fillRect(0,0,64,64); return new T.CanvasTexture(c);
}
function sparkTexture(){
  const c=document.createElement("canvas"); c.width=c.height=64; const x=c.getContext("2d");
  x.translate(32,32); x.fillStyle="#fff";
  x.beginPath(); for(let k=0;k<8;k++){ const r=k%2?7:30, a=k/8*PI*2-PI/2; x.lineTo(Math.cos(a)*r,Math.sin(a)*r); } x.closePath(); x.fill();
  return new T.CanvasTexture(c);
}
function iconTexture(type, icon, num){
  const c=document.createElement("canvas"); c.width=256; c.height=330; const x=c.getContext("2d");
  const col="#"+new T.Color(RUNE_COL[type]||0x999999).getHexString();
  if(type!=="empty"){
    x.save(); x.beginPath(); x.arc(128,122,100,0,PI*2); x.fillStyle=col; x.fill(); x.clip();
    x.fillStyle="rgba(0,0,0,.16)"; for(let yy=20;yy<230;yy+=12) for(let xx=20+(yy/12%2)*6;xx<240;xx+=12){ x.beginPath(); x.arc(xx,yy,3.2,0,PI*2); x.fill(); }
    x.restore();
    x.beginPath(); x.arc(128,122,100,0,PI*2); x.lineWidth=12; x.strokeStyle="#15121a"; x.stroke();
    x.beginPath(); x.arc(128,122,84,0,PI*2); x.lineWidth=6; x.strokeStyle="rgba(255,255,255,.85)"; x.stroke();
    x.font="112px "+FONT; x.textAlign="center"; x.textBaseline="middle"; x.fillText(icon,128,130);
  }
  const ty=type==="empty"?160:282;
  x.save(); x.translate(128,ty); x.transform(1,0,-0.18,1,0,0);
  roundRect(x,-44,-30,88,60,8); x.fillStyle="#15121a"; x.fill(); x.restore();
  x.font="italic 900 46px "+FONT; x.textAlign="center"; x.textBaseline="middle"; x.fillStyle="#fff6c9"; x.fillText(String(num),130,ty+2);
  const t=new T.CanvasTexture(c); t.anisotropy=4; return t;
}
function labelTexture(p, hex){
  const c=document.createElement("canvas"); c.width=512; c.height=180; const x=c.getContext("2d");
  x.save(); x.translate(256,90); x.transform(1,0,-0.14,1,0,0);
  roundRect(x,-232,-72,464,144,10); x.fillStyle="#fff6c9"; x.fill();
  x.fillStyle=hex; x.fillRect(-232,-72,26,144);
  roundRect(x,-232,-72,464,144,10); x.lineWidth=10; x.strokeStyle="#15121a"; x.stroke();
  x.restore();
  x.textAlign="center"; x.textBaseline="middle";
  x.font="italic 900 56px "+FONT; x.fillStyle="#15121a"; x.fillText(((p.finished?"🏆 ":"")+p.name).toUpperCase(),270,60);
  const n=Math.max(1,p.maxHp), w=46, x0=270-(n-1)*w/2;
  x.font="44px sans-serif";
  for(let i=0;i<n;i++){ x.lineWidth=6; x.strokeStyle="#15121a"; x.strokeText("♥",x0+i*w,128); x.fillStyle=i<p.hp?"#ff3355":"#d9d0b2"; x.fillText("♥",x0+i*w,128); }
  const t=new T.CanvasTexture(c); t.anisotropy=4; return t;
}

/* --------------------------------------------------- comic sound effects */
const COMIC_CSS=`
.w3-comics{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:2}
.w3-comic{position:absolute;isolation:isolate;--r:-6deg;--s:64px;--c:#ffe14a;--b:#ff3d6e;--d:1.4s;
  font:italic 900 var(--s)/.9 "Arial Black","Helvetica Neue",Impact,system-ui,sans-serif;letter-spacing:-.01em;color:var(--c);white-space:nowrap;
  -webkit-text-stroke:calc(var(--s)*.08) #15121a;paint-order:stroke fill;text-shadow:calc(var(--s)*.07) calc(var(--s)*.07) 0 #15121a;
  transform:translate(-50%,-50%) rotate(var(--r));animation:w3pop var(--d) cubic-bezier(.2,.9,.3,1) forwards}
.w3-comic.burst::before{content:"";position:absolute;left:50%;top:50%;width:150%;height:240%;transform:translate(-50%,-50%);z-index:-1;
  background:radial-gradient(circle,rgba(0,0,0,.22) 26%,transparent 29%) 0 0/calc(var(--s)*.17) calc(var(--s)*.17),var(--b);
  clip-path:polygon(50% 0%,60% 20%,82% 6%,76% 30%,100% 34%,80% 50%,98% 70%,74% 70%,80% 96%,60% 80%,50% 100%,40% 80%,18% 94%,25% 70%,0% 68%,20% 50%,2% 32%,25% 30%,18% 5%,40% 20%)}
@keyframes w3pop{0%{transform:translate(-50%,-50%) rotate(var(--r)) scale(.3);opacity:0}9%{transform:translate(-50%,-50%) rotate(var(--r)) scale(1.3);opacity:1}
  17%{transform:translate(-50%,-50%) rotate(var(--r)) scale(.94)}25%{transform:translate(-50%,-50%) rotate(var(--r)) scale(1.04)}
  78%{transform:translate(-50%,-56%) rotate(var(--r)) scale(1);opacity:1}100%{transform:translate(-50%,-64%) rotate(var(--r)) scale(1.05);opacity:0}}
@keyframes w3fade{0%{opacity:0}10%{opacity:1}80%{opacity:1}100%{opacity:0}}
@media (prefers-reduced-motion:reduce){.w3-comic{animation-name:w3fade}}`;
function injectCSS(){ if(document.getElementById("w3-comic-css")) return; const s=document.createElement("style"); s.id="w3-comic-css"; s.textContent=COMIC_CSS; document.head.appendChild(s); }

/* ------------------------------------------------------- custom shaders */
const WATER_VS=`
attribute float depth; varying float vDepth; varying vec3 vW;
#include <fog_pars_vertex>
void main(){
  vDepth=depth;
  vec4 wp=vec4(position,1.0);
  #ifdef USE_INSTANCING
    wp=instanceMatrix*wp;
  #endif
  wp=modelMatrix*wp; vW=wp.xyz;
  vec4 mvPosition=viewMatrix*wp; gl_Position=projectionMatrix*mvPosition;
  #include <fog_vertex>
}`;
const WATER_FS=`
uniform float uTime; uniform vec3 deep; uniform vec3 shallow; uniform vec3 foam; uniform float opacity;
varying float vDepth; varying vec3 vW;
#include <fog_pars_fragment>
`+INK.NOISE_GLSL+`
void main(){
  float n=efNoise(vW.xz*0.16+vec2(uTime*0.05,uTime*0.03))*0.6+efNoise(vW.xz*0.45-vec2(uTime*0.08,0.0))*0.4;
  vec3 c=mix(shallow,deep,smoothstep(0.1,2.6,vDepth));
  c*=0.92+0.16*step(0.56,n);
  float gl=step(0.93,fract(n*5.0+uTime*0.12))*step(0.5,n);
  c=mix(c,foam,gl*0.75);
  float shore=1.0-smoothstep(0.04,0.4+0.12*sin(uTime*1.7+vW.x*0.35+vW.z*0.2),vDepth);
  float band=step(0.55,fract(vDepth*1.8-uTime*0.32))*(1.0-smoothstep(0.25,1.1,vDepth));
  c=mix(c,foam,max(shore,band*0.65));
  gl_FragColor=vec4(c,opacity);
  #include <fog_fragment>
}`;
const LAVA_FS=`
uniform float uTime; varying float vDepth; varying vec3 vW;
#include <fog_pars_fragment>
`+INK.NOISE_GLSL+`
void main(){
  vec2 p=vW.xz*0.32;
  float n=efNoise(p+vec2(0.0,uTime*0.22))*0.6+efNoise(p*2.4-vec2(uTime*0.35,0.0))*0.4;
  float crust=smoothstep(0.54,0.6,n);
  vec3 hot=mix(vec3(1.0,0.88,0.36),vec3(1.0,0.42,0.06),smoothstep(0.2,0.5,n));
  gl_FragColor=vec4(mix(hot,vec3(0.17,0.06,0.05),crust),1.0);
  #include <fog_fragment>
}`;
const SKY_VS=`varying vec3 vDir; void main(){ vDir=position; vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position=p.xyww; gl_Position.z=gl_Position.w*0.99999; }`;
const SKY_FS=`
uniform vec3 top; uniform vec3 hor; uniform vec3 sunCol; uniform vec3 sunDir; uniform vec3 cloudCol; uniform vec3 cloudShade;
uniform float clouds; uniform float uTime; varying vec3 vDir;
`+INK.NOISE_GLSL+`
void main(){
  vec3 d=normalize(vDir); float h=d.y;
  vec3 col=mix(hor,top,pow(smoothstep(-0.02,0.85,h),0.55));
  float sd=max(dot(d,sunDir),0.0);
  col+=sunCol*(pow(sd,900.0)*1.4+pow(sd,40.0)*0.25+pow(sd,6.0)*0.12);
  if(h>0.0){
    vec2 uv=d.xz/(h+0.1)*0.9+vec2(uTime*0.006,uTime*0.002);
    float n=efFbm(uv), n2=efFbm(uv+sunDir.xz*0.07);
    float th=0.62-clouds*0.22;
    float m=smoothstep(th,th+0.025,n)*smoothstep(0.0,0.2,h);
    float lit=smoothstep(-0.015,0.015,n-n2);
    vec3 cc=mix(cloudShade,cloudCol,lit);
    cc=mix(cc,sunCol,smoothstep(th+0.025,th,n)*0.5*pow(sd,3.0));
    col=mix(col,cc,m);
  }
  gl_FragColor=vec4(col,1.0);
}`;

/* ================================================================ WORLD */
function create(container, cfg){
  injectCSS();
  const BOARD=cfg.board, FIN=cfg.finish;
  const habAt=(t)=>cfg.habitatFor(clamp(Math.round(t),0,FIN));
  const BIO=(t)=>BIOME[habAt(t)]||BIOME.forest;
  const reduceMotion=!!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const mobile=!!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);

  /* renderer / camera / scene */
  const renderer=new T.WebGLRenderer({antialias:false, powerPreference:"high-performance"});
  const prMax=Math.min(window.devicePixelRatio||1, mobile?1.6:2);
  let prScale=1;
  renderer.setPixelRatio(prMax);
  renderer.shadowMap.enabled=true; renderer.shadowMap.type=T.PCFShadowMap; renderer.shadowMap.autoUpdate=false;
  const cv=renderer.domElement; cv.className="world3d-canvas";
  container.appendChild(cv);
  const flashEl=document.createElement("div"); flashEl.className="world3d-flash"; container.appendChild(flashEl);
  const comicsEl=document.createElement("div"); comicsEl.className="w3-comics"; container.appendChild(comicsEl);
  const hintEl=document.createElement("div"); hintEl.className="world3d-hint"; hintEl.textContent="👆 Drag to look around"; container.appendChild(hintEl);

  const scene=new T.Scene();
  scene.fog=new T.Fog(0xcfe6e2,40,330);
  const camera=new T.PerspectiveCamera(68,1,0.15,1000);
  camera.layers.enable(2);
  const hemi=new T.HemisphereLight(0xcfe6ff,0x4a5a3a,0.42); scene.add(hemi);
  const sun=new T.DirectionalLight(0xffffff,0.64);
  sun.castShadow=true; sun.shadow.mapSize.set(mobile?1024:2048,mobile?1024:2048); sun.shadow.bias=-0.0006; sun.shadow.normalBias=0.03;
  Object.assign(sun.shadow.camera,{left:-42,right:42,top:42,bottom:-42,near:1,far:160});
  scene.add(sun); scene.add(sun.target);
  const pipe=INK.Pipeline(renderer,scene,camera,{samples:mobile?2:4});
  if(reduceMotion) pipe.U.fx.value=0;

  /* smoothed per-space tables so biome transitions blend instead of popping */
  const T0=-12, T1=FIN+14;
  const NUMK=["hill","peak","ridge","clouds","terrace","snow"], COLK=["ground","ground2","path","rock","top","hor","sun","rim","cloud","cshade"];
  const tbl={ coast:[] }; NUMK.forEach(k=>tbl[k]=[]); COLK.forEach(k=>tbl[k]=[]);
  for(let i=T0;i<=T1;i++){
    const acc={}, cols={}; NUMK.forEach(k=>acc[k]=0); COLK.forEach(k=>cols[k]=new T.Color(0,0,0)); let coast=0, n=0;
    for(let k=-1.5;k<=1.5;k+=0.5){ const b=BIO(i+k); NUMK.forEach(key=>acc[key]+=b[key]||0); COLK.forEach(key=>cols[key].add(new T.Color(b[key]))); coast+=habAt(i+k)==="coast"?1:0; n++; }
    NUMK.forEach(k=>tbl[k].push(acc[k]/n)); COLK.forEach(k=>tbl[k].push(cols[k].multiplyScalar(1/n))); tbl.coast.push(coast/n);
  }
  function tnum(arr,t){ const f=clamp(t-T0,0,arr.length-1.001), i=Math.floor(f); return lerp(arr[i],arr[i+1],f-i); }
  function tcol(arr,t,out){ const f=clamp(t-T0,0,arr.length-1.001), i=Math.floor(f); return (out||new T.Color()).copy(arr[i]).lerp(arr[i+1],f-i); }

  function groundH(x,z){
    const t=-z/SP, side=x-pathX(t), d=Math.abs(side);
    let h=smooth(4.5,26,d)*(0.2+fbm(x*0.028,z*0.028))*tnum(tbl.hill,t);
    h+=smooth(14,60,d)*Math.pow(ridged(x*0.011+3,z*0.011),2.2)*tnum(tbl.peak,t);
    h+=(fbm(x*0.22,z*0.22)-0.5)*0.4*smooth(3,7,d);
    const ter=tnum(tbl.terrace,t);
    if(ter>0.01){ const st=3.2, k=h/st, f=k-Math.floor(k); h=lerp(h,(Math.floor(k)+smooth(0.35,0.65,f))*st,ter); }
    const cw=tnum(tbl.coast,t);
    if(cw>0.01 && side>6) h=lerp(h,-smooth(6,24,side)*4.5+h*0.08,cw);
    return h;
  }
  const _n=new T.Vector3();
  function groundN(x,z,out){ const e=0.6; return (out||_n).set(-(groundH(x+e,z)-groundH(x-e,z))/(2*e),1,-(groundH(x,z+e)-groundH(x,z-e))/(2*e)).normalize(); }
  const cA=new T.Color(), cB=new T.Color(), cP=new T.Color(), cR=new T.Color(), WHITE=new T.Color(0xf4f8fc), SAND=new T.Color(0xe6d3a0);
  function groundColor(x,z,h,n,out){
    const t=-z/SP, side=x-pathX(t), d=Math.abs(side);
    tcol(tbl.ground,t,cA); tcol(tbl.ground2,t,cB);
    const pn=fbm(x*0.045+11,z*0.045), lv=pn<0.44?0:pn<0.58?0.5:1;
    out.copy(cA).lerp(cB,lv*0.8);
    const slope=1-n.y;
    if(slope>0.22) out.lerp(tcol(tbl.rock,t,cR),smooth(0.22,0.45,slope));
    const sn=tnum(tbl.snow,t); if(sn>0.01) out.lerp(WHITE,sn*smooth(5,11,h)*smooth(0.6,0.25,slope));
    const cw=tnum(tbl.coast,t); if(cw>0.01 && side>4 && h<0.9) out.lerp(SAND,cw*smooth(0.9,0.1,h));
    const pw=2.4+(vnoise(t*2.3,7.7)-0.5)*1.0;
    if(d<pw+0.7){ tcol(tbl.path,t,cP).multiplyScalar(0.88+0.24*hash2(Math.floor(x*2.2),Math.floor(z*2.2))); out.lerp(cP,smooth(pw+0.7,pw-0.2,d)); }
    return out;
  }

  /* ---- painterly terrain (chunked, analytic normals so chunk seams never show) ---- */
  const groundMat=INK.toon({vertexColors:true,paint:true});
  (function buildGround(){
    const NU=mobile?120:160, U=150, zTop=-T0*SP+40, zBot=-T1*SP, dz=mobile?1.8:1.4, rows=Math.ceil((zTop-zBot)/dz), CH=44;
    const offs=[]; for(let i=0;i<=NU;i++){ const u=i/NU*2-1; offs.push(U*(0.1*u+0.9*u*Math.abs(u))); }
    const c=new T.Color(), N=new T.Vector3();
    for(let r0=0;r0<rows;r0+=CH){
      const r1=Math.min(rows,r0+CH), pos=[], col=[], nor=[], idx=[];
      for(let r=r0;r<=r1;r++){ const z=zTop-r*dz, t=-z/SP, px=pathX(t);
        for(let i=0;i<=NU;i++){ const x=px+offs[i], h=groundH(x,z); groundN(x,z,N); groundColor(x,z,h,N,c);
          pos.push(x,h,z); nor.push(N.x,N.y,N.z); col.push(c.r,c.g,c.b); } }
      const W=NU+1;
      for(let r=0;r<r1-r0;r++) for(let i=0;i<NU;i++){ const a=r*W+i, b=a+1, d2=a+W, e=d2+1; idx.push(a,b,d2, b,e,d2); }
      const g=new T.BufferGeometry();
      g.setAttribute("position",new T.Float32BufferAttribute(pos,3)); g.setAttribute("normal",new T.Float32BufferAttribute(nor,3)); g.setAttribute("color",new T.Float32BufferAttribute(col,3));
      g.setIndex(idx); g.computeBoundingSphere();
      const m=new T.Mesh(g,groundMat); m.receiveShadow=true; scene.add(m);
    }
  })();

  /* ---- sky dome (anime gradient, sun, two-tone cel clouds) ---- */
  const skyU={ top:{value:new T.Color()}, hor:{value:new T.Color()}, sunCol:{value:new T.Color()}, sunDir:{value:new T.Vector3(0.4,0.5,-0.7).normalize()},
    cloudCol:{value:new T.Color()}, cloudShade:{value:new T.Color()}, clouds:{value:0.5}, uTime:INK.SH.time };
  const sky=new T.Mesh(new T.SphereGeometry(800,40,20),new T.ShaderMaterial({uniforms:skyU,vertexShader:SKY_VS,fragmentShader:SKY_FS,side:T.BackSide,depthWrite:false,fog:false}));
  sky.renderOrder=-10; sky.frustumCulled=false; INK.layer(sky,2); scene.add(sky);

  /* ---- layered far ridges: painted backdrop silhouettes, no ink (Ghost in the Shell backgrounds) ---- */
  (function buildRidges(){
    const layers=[{dist:175,hm:1.0,shade:0.55,seed:1},{dist:290,hm:1.7,shade:0.78,seed:7}];
    const c=new T.Color(), top=new T.Color(), hz=new T.Color();
    layers.forEach(L=>[-1,1].forEach(side=>{
      const pos=[], col=[], idx=[]; let n=0;
      for(let t=T0-6;t<=T1+10;t+=0.2){
        const cw=tnum(tbl.coast,t);
        let H=tnum(tbl.ridge,t)*L.hm*(0.45+0.55*fbm(t*0.35+L.seed*13+side*5,L.seed));
        H+=tnum(tbl.peak,t)*L.hm*0.9*Math.pow(ridged(t*0.5+L.seed,side*3.3),2);
        const ter=tnum(tbl.terrace,t); if(ter>0.01) H=lerp(H,Math.round(H/9)*9+2,ter*0.85);
        if(side>0) H*=1-cw;
        const x=pathX(t)+side*(L.dist+(fbm(t*0.2,L.seed+side)-0.5)*40), z=-t*SP;
        tcol(tbl.ground,t,c).lerp(tcol(tbl.rock,t,top),0.5); tcol(tbl.hor,t,hz); c.lerp(hz,L.shade);
        top.copy(c).lerp(tcol(tbl.sun,t,cA),0.25); if(tnum(tbl.snow,t)>0.3 && H>40) top.lerp(WHITE,0.6);
        pos.push(x,-12,z, x,Math.max(-2,H),z); col.push(c.r*0.9,c.g*0.9,c.b*0.9, top.r,top.g,top.b);
        if(n>0){ const a=(n-1)*2, b=n*2; if(side>0) idx.push(a,b,a+1, a+1,b,b+1); else idx.push(a,a+1,b, a+1,b+1,b); }
        n++;
      }
      const g=new T.BufferGeometry(); g.setAttribute("position",new T.Float32BufferAttribute(pos,3)); g.setAttribute("color",new T.Float32BufferAttribute(col,3)); g.setIndex(idx); g.computeBoundingSphere();
      const m=new T.Mesh(g,new T.MeshBasicMaterial({vertexColors:true,side:T.DoubleSide})); INK.layer(m,2); scene.add(m);
    }));
  })();

  /* ---- water & lava materials ---- */
  const U_FOG=()=>T.UniformsUtils.clone(T.UniformsLib.fog);
  function waterMat(deep,shallow,opacity){
    const m=new T.ShaderMaterial({ uniforms:Object.assign(U_FOG(),{ uTime:INK.SH.time, deep:{value:new T.Color(deep)}, shallow:{value:new T.Color(shallow)},
      foam:{value:new T.Color(0xf4fbff)}, opacity:{value:opacity==null?1:opacity} }), vertexShader:WATER_VS, fragmentShader:WATER_FS, fog:true, transparent:opacity!=null&&opacity<1 });
    return m;
  }
  const lavaMat=new T.ShaderMaterial({ uniforms:Object.assign(U_FOG(),{uTime:INK.SH.time}), vertexShader:WATER_VS, fragmentShader:LAVA_FS, fog:true });
  const oceanMat=waterMat(0x1f6fa8,0x3fc4d6), poolMat=waterMat(0x2d5a4a,0x5a9a7a), pondMat=waterMat(0x1f7fb0,0x55d0e0,0.95);
  function depthDisc(r,seg){ const g=new T.CircleGeometry(r,seg||40); const P=g.attributes.position, d=new Float32Array(P.count);
    for(let i=0;i<P.count;i++) d[i]=(1-Math.hypot(P.getX(i),P.getY(i))/r)*2.2; g.setAttribute("depth",new T.BufferAttribute(d,1)); g.rotateX(-PI/2); return g; }

  /* ---- props: merged vertex-coloured geometries, instanced per kind + trail chunk ---- */
  const propMat=INK.toon({vertexColors:true,rim:0.55});
  const swayMat=INK.toon({vertexColors:true,rim:false,sway:0.1});
  const grassMat=INK.toon({vertexColors:true,rim:false,sway:0.16});
  const C={ bark:0x5e4630, bark2:0x7a5a3a, pine:0x2c5e34, pine2:0x3f7a3e, leaf:0x4f8a38, leaf2:0x77a848, fern:0x4d8a3a, bone:0xf0e6cc,
    reed:0x8a9a52, cat:0x6a4a2a, palm:0x8a6a44, frond:0x3f8a44, ice:0xbfe6ff, snow:0xf4f8ff, egg:0xfff1d6, twig:0x7a5a33 };
  const {prep,merge,M4,blob,segGeo,sweep,noise3}=K;
  function col(fn){ return fn; }
  function canopyNormals(g,cx,cy,cz,k){ const P=g.attributes.position, N=g.attributes.normal, v=new T.Vector3(), n=new T.Vector3();
    for(let i=0;i<P.count;i++){ v.set(P.getX(i)-cx,P.getY(i)-cy,P.getZ(i)-cz).normalize(); n.set(N.getX(i),N.getY(i),N.getZ(i)).lerp(v,k).normalize(); N.setXYZ(i,n.x,n.y,n.z); } return g; }
  function jaggedCone(r,h,seg,seed){ const g=K.weld(new T.ConeGeometry(r,h,seg,3)), P=g.attributes.position;
    for(let i=0;i<P.count;i++){ const x=P.getX(i), y=P.getY(i), z=P.getZ(i); if(y>h*0.49) continue; const a=Math.atan2(z,x);
      const k=1+(noise3(Math.cos(a)*2+seed,y*1.3,Math.sin(a)*2)-0.5)*0.55+(Math.sin(a*seg)*0.08); P.setXYZ(i,x*k,y-(y<-h*0.45?0.12*h*(noise3(a*3,seed,1)):0),z*k); }
    g.computeVertexNormals(); return g; }
  const trunkCol=(base)=>(s,sa,ca,Cc)=>{ Cc.set(base).multiplyScalar(0.8+0.25*(ca*0.5+0.5)); };
  function trunk(h,r0,r1,base){ return prep(segGeo(h,r0,r1,trunkCol(base)),null,M4(0,h,0,PI,0,0)); }

  const PROP_BUILD={
    conifer(snowy,seed){ const parts=[trunk(1.6,0.3,0.18,C.bark)], tiers=5;
      for(let k=0;k<tiers;k++){ const r=1.9-k*0.33, h=1.9-k*0.12, y=1.2+k*1.05+h/2, g=jaggedCone(r,h,11,seed+k);
        const gg=prep(g,(x,yy,z,Cc)=>{ Cc.set(k%2?C.pine:C.pine2).multiplyScalar(0.8+0.35*smooth(-h/2,h/2,yy)); if(snowy && yy>-h*0.1) Cc.lerp(new T.Color(C.snow),smooth(-h*0.1,h*0.3,yy)); },M4(0,y,0));
        canopyNormals(gg,0,y-0.3,0,0.45); parts.push(gg); }
      return merge(parts); },
    broadleaf(seed){ const parts=[trunk(2.4,0.34,0.2,C.bark2)];
      parts.push(prep(segGeo(1.4,0.16,0.08,trunkCol(C.bark2)),null,M4(0.2,2.0,0,0,0,-2.3)));
      parts.push(prep(segGeo(1.2,0.14,0.07,trunkCol(C.bark2)),null,M4(-0.2,2.2,0.1,0.3,0,2.2)));
      const blobs=[]; const r=mulberry32(seed*97+3);
      for(let k=0;k<7;k++){ const a=k/7*PI*2, rr=k===0?0:1.25, s=k===0?1.8:1.2+r()*0.5;
        const g=prep(blob(2,0.16,1.4,seed+k),(x,y,z,Cc)=>{ Cc.set(k%2?C.leaf:C.leaf2).multiplyScalar(0.78+0.4*smooth(2.3,4.6,y)); },
          M4(Math.cos(a)*rr,3.4+(k===0?0.8:r()*0.7),Math.sin(a)*rr,0,0,0,s,s*0.85,s)); blobs.push(g); }
      blobs.forEach(g=>canopyNormals(g,0,3.6,0,0.72)); return merge(parts.concat(blobs)); },
    treefern(seed){ const parts=[prep(segGeo(3.0,0.26,0.2,(s,sa,ca,Cc)=>{ Cc.set(C.bark).multiplyScalar(Math.floor(s*6)%2?0.8:1.05); }),null,M4(0,3.0,0,PI,0,0))];
      for(let k=0;k<11;k++){ const a=k/11*PI*2+seed, L=2.4+0.4*Math.sin(k*2.3);
        const g=sweep([[0,0,0.04,0.02],[L*0.35,0.35,0.3,0.03],[L*0.7,0.2,0.24,0.025],[L,-0.45,0.02,0.01]],{seg:6,belly:1,density:5,color:(s,sa,ca,Cc)=>Cc.set(C.fern).multiplyScalar(0.75+0.25*(s/3)+(sa>0?0.12:0))}).geo;
        parts.push(prep(g,null,M4(0,3.0,0,-0.2,a,0))); }
      return merge(parts); },
    fern(seed){ const parts=[];
      for(let k=0;k<8;k++){ const a=k/8*PI*2+seed, L=1.0+0.3*Math.sin(k*1.7);
        const g=sweep([[0,0,0.03,0.015],[L*0.4,0.45,0.17,0.02],[L*0.75,0.4,0.13,0.015],[L,0.05,0.02,0.01]],{seg:5,belly:1,density:6,color:(s,sa,ca,Cc)=>Cc.set(C.fern).multiplyScalar(0.7+0.35*(s/3))}).geo;
        parts.push(prep(g,null,M4(0,0,0,0,a,0))); }
      return merge(parts); },
    cypress(seed){ const parts=[prep(sweep([[0,0,0.9,0.9],[0.6,0,0.45,0.45],[3,0,0.32,0.32],[6,0,0.22,0.22]],{seg:10,belly:1,density:3,color:trunkCol(0x5a4a3a)}).geo,null,M4(0,0,0,-PI/2,0,0))];
      const r=mulberry32(seed*31+1);
      for(let k=0;k<5;k++){ const a=k/5*PI*2, g=prep(blob(1,0.2,1.3,seed+k),(x,y,z,Cc)=>Cc.set(0x3f6a3a).multiplyScalar(0.8+0.3*smooth(5,6.6,y)),M4(Math.cos(a)*1.4,5.8+r()*0.6,Math.sin(a)*1.4,0,0,0,1.8,0.9,1.8)); canopyNormals(g,0,5.8,0,0.6); parts.push(g); }
      for(let k=0;k<7;k++){ const a=k/7*PI*2+0.3; parts.push(prep(K.CONE,0x9aa870,M4(Math.cos(a)*1.9,4.7,Math.sin(a)*1.9,PI,0,0,0.1,1.6,0.1))); }
      return merge(parts); },
    deadtree(seed){ const parts=[trunk(3.2,0.28,0.12,0x5a4e44)]; const r=mulberry32(seed*13+5);
      for(let k=0;k<4;k++){ const a=r()*PI*2, y=1.6+k*0.45; parts.push(prep(segGeo(1.1+r()*0.6,0.1,0.03,trunkCol(0x5a4e44)),null,M4(0,y,0,0,a,PI-0.9-r()*0.5))); }
      return merge(parts); },
    reeds(seed){ const parts=[]; const r=mulberry32(seed*7+2);
      for(let k=0;k<9;k++){ const x=(r()-0.5)*1.4, z=(r()-0.5)*1.4, h=1.4+r()*1.2;
        parts.push(prep(segGeo(h,0.04,0.025,(s,sa,ca,Cc)=>Cc.set(C.reed).multiplyScalar(0.7+0.2*s)),null,M4(x,h,z,PI,0,0)));
        if(k%2) parts.push(prep(K.SPHERE_LO,C.cat,M4(x,h-0.1,z,0,0,0,0.07,0.24,0.07))); }
      return merge(parts); },
    rock(seed){ return prep(blob(2,0.3,1.2,seed),(x,y,z,Cc)=>{ Cc.setRGB(0.86,0.86,0.86).multiplyScalar(0.82+0.3*smooth(-0.2,0.8,y)); if(noise3(x*2,y*2,z*2)>0.66) Cc.multiplyScalar(0.85); },M4(0,0.35,0,0,0,0,1,0.72,1.15)); },
    boulder(seed){ return prep(blob(2,0.28,0.9,seed),(x,y,z,Cc)=>{ Cc.setRGB(0.88,0.88,0.88).multiplyScalar(0.8+0.3*smooth(-0.4,0.9,y)); },M4(0,0.6,0,0,0,0,2.2,1.6,2.0)); },
    mesa(seed){ const g=K.weld(new T.CylinderGeometry(1,1.18,1,18,8)), P=g.attributes.position;
      for(let i=0;i<P.count;i++){ const x=P.getX(i), y=P.getY(i), z=P.getZ(i), a=Math.atan2(z,x), r=Math.hypot(x,z); if(r<0.01) continue;
        const k=1+(noise3(Math.cos(a)*1.6+seed,y*2.2,Math.sin(a)*1.6)-0.5)*0.35; P.setXYZ(i,x*k,y,z*k); }
      g.computeVertexNormals();
      return prep(g,(x,y,z,Cc)=>{ const b=Math.floor((y+0.5)*7+noise3(x*2,0,z*2)*0.8); Cc.set([0xc8704a,0xe0a070,0xb65a3a,0xf0c890][((b%4)+4)%4]); if(y>0.49) Cc.set(0xd89a60); },M4(0,0.5,0)); },
    hoodoo(seed){ const parts=[]; let y=0; for(let k=0;k<4;k++){ const s=0.9-k*0.12+(k===3?0.3:0); parts.push(prep(blob(1,0.2,1.4,seed+k),k===3?0x8a5a3a:[0xc8784a,0xe0a070][k%2],M4(0,y+s*0.6,0,0,0,0,s,s*0.75,s))); y+=s*1.05; } return merge(parts); },
    scrub(seed){ const parts=[]; const r=mulberry32(seed*3+9); for(let k=0;k<5;k++) parts.push(prep(blob(1,0.25,2,seed+k),(x,y,z,Cc)=>Cc.set(0x8a8a4a).multiplyScalar(0.8+0.3*y),M4((r()-0.5)*1.2,0.35,(r()-0.5)*1.2,0,0,0,0.5+r()*0.3,0.4,0.5+r()*0.3))); return merge(parts); },
    flowers(seed){ const parts=[]; const r=mulberry32(seed*5+1), pal=[0xff7eb6,0xffd54a,0xff6b6b,0xffffff,0xb58aff];
      for(let k=0;k<7;k++){ const x=(r()-0.5)*1.4, z=(r()-0.5)*1.4, h=0.5+r()*0.4, c=pal[Math.floor(r()*pal.length)];
        parts.push(prep(segGeo(h,0.025,0.02,(s,sa,ca,Cc)=>Cc.set(C.leaf)),null,M4(x,h,z,PI,0,0)));
        for(let p=0;p<5;p++){ const a=p/5*PI*2; parts.push(prep(K.SPHERE_LO,c,M4(x+Math.cos(a)*0.09,h,z+Math.sin(a)*0.09,0,0,0,0.08,0.035,0.08))); }
        parts.push(prep(K.SPHERE_LO,0xffe070,M4(x,h+0.02,z,0,0,0,0.05))); }
      return merge(parts); },
    cycad(seed){ const parts=[prep(segGeo(1.1,0.42,0.34,(s,sa,ca,Cc)=>{ Cc.set(0x6a5a3a).multiplyScalar(Math.floor(s*8)%2?0.82:1.05); }),null,M4(0,1.1,0,PI,0,0))];
      for(let k=0;k<12;k++){ const a=k/12*PI*2+seed, L=1.8;
        parts.push(prep(sweep([[0,0,0.05,0.02],[L*0.4,0.5,0.24,0.02],[L,0.35,0.02,0.01]],{seg:5,belly:1,density:5,color:(s,sa,ca,Cc)=>Cc.set(0x4a8a3a).multiplyScalar(0.72+0.3*s/2)}).geo,null,M4(0,1.1,0,-0.25,a,0))); }
      return merge(parts); },
    palm(seed){ const parts=[]; const lean=0.9+0.3*Math.sin(seed*3);
      const tg=sweep([[0,0,0.3,0.3],[2,0.25*lean,0.24,0.24],[4,0.9*lean,0.2,0.2],[5.6,1.8*lean,0.17,0.17]],{seg:10,belly:1,density:3,color:(s,sa,ca,Cc)=>Cc.set(C.palm).multiplyScalar(Math.floor(s*9)%2?0.85:1.05)}).geo;
      parts.push(prep(tg,null,M4(0,0,0,-PI/2,0,0)));
      const top=new T.Vector3(0,5.6,-1.8*lean);
      for(let k=0;k<9;k++){ const a=k/9*PI*2, L=3;
        parts.push(prep(sweep([[0,0,0.05,0.02],[L*0.35,0.45,0.42,0.025],[L*0.75,0.1,0.3,0.02],[L,-0.8,0.02,0.01]],{seg:5,belly:1,density:4,color:(s,sa,ca,Cc)=>Cc.set(C.frond).multiplyScalar(0.72+0.3*s/3+(sa>0?0.1:0))}).geo,null,M4(top.x,top.y,top.z,-0.1,a,0))); }
      for(let k=0;k<3;k++) parts.push(prep(K.SPHERE_LO,0x6b4a2b,M4(top.x+Math.cos(k*2.1)*0.3,top.y-0.25,top.z+Math.sin(k*2.1)*0.3,0,0,0,0.2)));
      return merge(parts); },
    ice(seed){ const parts=[]; const r=mulberry32(seed*11+3);
      for(let k=0;k<4;k++){ const s=0.6+r()*0.9; parts.push(prep(new T.OctahedronGeometry(1,0),(x,y,z,Cc)=>Cc.set(C.ice).multiplyScalar(0.85+0.3*smooth(-1,1,y)),M4((r()-0.5)*1.4,s*0.9,(r()-0.5)*1.4,(r()-0.5)*0.6,r()*3,(r()-0.5)*0.6,s*0.45,s*1.3,s*0.45))); }
      return merge(parts); },
    drift(seed){ return prep(blob(2,0.15,1,seed),(x,y,z,Cc)=>Cc.set(C.snow).multiplyScalar(0.9+0.12*y),M4(0,0,0,0,0,0,2.4,0.7,1.6)); },
    bones(seed){ const parts=[]; for(let k=0;k<5;k++) parts.push(prep(new T.TorusGeometry(1-k*0.1,0.08,6,14,PI),C.bone,M4(0,0.05,k*0.5-1,0,PI/2,0)));
      parts.push(prep(segGeo(2.8,0.1,0.07,(s,sa,ca,Cc)=>Cc.set(C.bone)),null,M4(0,0.1,-1.3,-PI/2,0,0)));
      parts.push(prep(blob(1,0.2,1.5,seed),C.bone,M4(0,0.35,1.8,0,0,0,0.45,0.38,0.62)));
      [-1,1].forEach(s=>parts.push(prep(K.SPHERE_LO,0x3a3026,M4(s*0.22,0.48,1.95,0,0,0,0.12))));
      return merge(parts); },
    eggs(seed){ const parts=[prep(new T.TorusGeometry(1.0,0.34,8,20),(x,y,z,Cc)=>{ Cc.set(C.twig).multiplyScalar(0.75+0.45*noise3(x*6,y*6,z*6)); },M4(0,0.25,0,PI/2,0,0,1,1.25,1))];
      for(let k=0;k<4;k++){ const a=k/4*PI*2; parts.push(prep(K.SPHERE,(x,y,z,Cc)=>{ Cc.set(C.egg); if(noise3(x*9,y*9,z*9)>0.68) Cc.set(0xb89a6a); },M4(Math.cos(a)*0.45,0.45,Math.sin(a)*0.45,0.2,0,0.1,0.3,0.4,0.3))); }
      return merge(parts); },
    vent(seed){ return prep(blob(2,0.2,1.2,seed),(x,y,z,Cc)=>Cc.set(0x3a2622).multiplyScalar(0.8+0.3*y),M4(0,0.5,0,0,0,0,1.4,1.0,1.4)); },
    lavapool(){ const g=new T.CircleGeometry(1,24); g.rotateX(-PI/2); g.translate(0,0.08,0); const d=new Float32Array(g.attributes.position.count).fill(1); g.setAttribute("depth",new T.BufferAttribute(d,1)); return g; },
    grass(){ const parts=[]; for(let k=0;k<6;k++){ const a=k/6*PI*2+0.3, lean=0.25+0.2*Math.sin(k*3.1), h=0.55+0.3*Math.sin(k*1.9)*0.5+0.2;
        const g=new T.BufferGeometry(); const w=0.07;
        g.setAttribute("position",new T.Float32BufferAttribute([-w,0,0, w,0,0, 0,h,lean*h],3)); g.setAttribute("normal",new T.Float32BufferAttribute([0,1,0, 0,1,0, 0,1,0],3));
        g.setAttribute("color",new T.Float32BufferAttribute([0.55,0.55,0.55, 0.62,0.62,0.62, 1.2,1.2,1.2],3));
        g.applyMatrix4(M4(Math.cos(a)*0.18,0,Math.sin(a)*0.18,0,a,0)); parts.push(g); }
      const out=merge(parts); return out; },
  };
  const PROPS={};   // kind -> {geo, mat, layer, cast, radius}
  function propKind(kind,build,o){ o=o||{}; const geo=build(); geo.computeBoundingSphere();
    PROPS[kind]={geo, mat:o.mat||propMat, layer:o.layer||0, cast:o.cast!==false, radius:geo.boundingSphere.center.length()+geo.boundingSphere.radius}; }
  [0,1].forEach(v=>{
    propKind("conifer"+v,()=>PROP_BUILD.conifer(false,v*7+1)); propKind("coniferSnow"+v,()=>PROP_BUILD.conifer(true,v*7+3));
    propKind("broadleaf"+v,()=>PROP_BUILD.broadleaf(v*5+2)); propKind("rock"+v,()=>PROP_BUILD.rock(v*3+1));
  });
  propKind("treefern",()=>PROP_BUILD.treefern(1)); propKind("cypress",()=>PROP_BUILD.cypress(2)); propKind("deadtree",()=>PROP_BUILD.deadtree(3));
  propKind("boulder",()=>PROP_BUILD.boulder(4)); propKind("mesa",()=>PROP_BUILD.mesa(5)); propKind("hoodoo",()=>PROP_BUILD.hoodoo(6));
  propKind("scrub",()=>PROP_BUILD.scrub(7)); propKind("cycad",()=>PROP_BUILD.cycad(8)); propKind("palm",()=>PROP_BUILD.palm(9));
  propKind("ice",()=>PROP_BUILD.ice(10),{mat:INK.toon({vertexColors:true,rim:1.6})}); propKind("drift",()=>PROP_BUILD.drift(11)); propKind("bones",()=>PROP_BUILD.bones(12));
  propKind("eggs",()=>PROP_BUILD.eggs(13)); propKind("vent",()=>PROP_BUILD.vent(14));
  propKind("lavapool",()=>PROP_BUILD.lavapool(),{mat:lavaMat,layer:2,cast:false});
  propKind("fern",()=>PROP_BUILD.fern(1),{mat:swayMat,layer:2,cast:false}); propKind("reeds",()=>PROP_BUILD.reeds(2),{mat:swayMat,layer:2,cast:false});
  propKind("flowers",()=>PROP_BUILD.flowers(3),{mat:swayMat,layer:2,cast:false});
  propKind("grass",()=>PROP_BUILD.grass(),{mat:grassMat,layer:2,cast:false});

  const instances={};
  function addInst(kind,chunk,x,y,z,ry,s,sy,color){
    const key=kind+"|"+chunk; if(!instances[key]) instances[key]={kind,items:[]};
    instances[key].items.push({m:M4(x,y,z,0,ry,0,s,sy==null?s:sy,s), c:color||new T.Color(1,1,1), x, y, z, s:Math.max(s,sy||0)});
  }
  function flushInst(){
    Object.keys(instances).forEach(key=>{ const {kind,items}=instances[key], P=PROPS[kind]; if(!items.length) return;
      const g=new T.BufferGeometry(); Object.keys(P.geo.attributes).forEach(a=>g.setAttribute(a,P.geo.attributes[a]));
      const box=new T.Box3(); let ms=0; items.forEach(it=>{ box.expandByPoint(new T.Vector3(it.x,it.y,it.z)); ms=Math.max(ms,it.s); });
      const sph=box.getBoundingSphere(new T.Sphere()); sph.radius+=P.radius*ms; g.boundingSphere=sph;
      const mesh=new T.InstancedMesh(g,P.mat,items.length);
      items.forEach((it,i)=>{ mesh.setMatrixAt(i,it.m); mesh.setColorAt(i,it.c); });
      mesh.instanceMatrix.needsUpdate=true; if(mesh.instanceColor) mesh.instanceColor.needsUpdate=true;
      mesh.castShadow=P.cast; mesh.receiveShadow=true; INK.layer(mesh,P.layer); scene.add(mesh);
    });
  }
  const TABLE={
    forest:   [["conifer",5,5,60],["broadleaf",3,5,60],["treefern",2,4.5,30],["fern",4,3.4,24],["rock",1.5,3.6,40],["boulder",0.5,8,50]],
    swamp:    [["cypress",3,5,55],["deadtree",1.5,5,40],["reeds",3,3.4,20],["fern",2,3.4,20],["treefern",1,5,30],["rock",0.5,4,30],["pool",2,6,26]],
    plains:   [["broadleaf",1,6,70],["flowers",3,3.3,20],["rock",1.5,4,40],["bones",0.4,5,20],["scrub",1,4,30],["cycad",0.6,5,30]],
    desert:   [["mesa",1.2,28,90],["hoodoo",1,8,40],["rock",3,3.6,40],["scrub",2,3.6,30],["bones",1,5,25],["deadtree",0.6,6,30]],
    volcano:  [["rock",3,3.6,40],["deadtree",1.5,5,40],["lavapool",2,5,22],["vent",0.8,6,30],["boulder",1,8,50]],
    mountains:[["boulder",3,5,60],["rock",2,3.6,40],["coniferSnow",3,5,70]],
    coast:    [["palm",3,4.5,26],["cycad",1.5,4.5,24],["rock",1.5,3.6,20],["fern",1,3.4,15]],
    tundra:   [["coniferSnow",3,5,70],["ice",2,4,40],["drift",2,4,40],["rock",1,4,30]],
    nest:     [["broadleaf",1,6,50],["flowers",3,3.3,20],["fern",2,3.4,20],["cycad",1.5,4.5,24],["eggs",0.25,4,14]],
  };
  const pick=(tab,r)=>{ let tot=0; tab.forEach(e=>tot+=e[1]); let v=r()*tot; for(const e of tab){ v-=e[1]; if(v<=0) return e; } return tab[0]; };
  const pools=[];
  (function buildProps(){
    const rnd=mulberry32(20260923), c=new T.Color(), N=new T.Vector3();
    const place=(kind,t,x,z,sBase)=>{
      const y=groundH(x,z), chunk=Math.floor((t+12)/4);
      if(y<WATER_Y+0.1 && kind!=="rock") return false;
      const v=kind==="conifer"||kind==="coniferSnow"||kind==="broadleaf"||kind==="rock"?kind+(rnd()<0.5?0:1):kind;
      const s=sBase*(0.75+rnd()*0.6);
      let tint=new T.Color(1,1,1).multiplyScalar(0.88+rnd()*0.22);
      if(kind==="rock"||kind==="boulder") tint=tcol(tbl.rock,t,new T.Color()).multiplyScalar(1.15+rnd()*0.2);
      if(kind==="mesa"){ addInst(v,chunk,x,y-1,z,rnd()*PI*2,s*(8+rnd()*8),s*(7+rnd()*9),tint); return true; }
      addInst(v,chunk,x,y-0.05,z,rnd()*PI*2,kind==="lavapool"?s*2.2:s,kind==="lavapool"?1:null,tint); return true;
    };
    for(let i=-8;i<=FIN+10;i++){
      const hab=habAt(i), tab=TABLE[hab]||TABLE.forest;
      [-1,1].forEach(side=>{
        const n=(hab==="plains"||hab==="desert"||hab==="coast")?7:10;
        for(let k=0;k<n;k++){
          const e=pick(tab,rnd), t=i+(rnd()-0.5), d=e[2]+Math.pow(rnd(),0.8)*(e[3]-e[2]);
          if(hab==="coast" && side>0 && d>7) continue;
          const x=pathX(t)+side*d, z=-t*SP;
          if(e[0]==="pool"){ const y=groundH(x,z); if(y>WATER_Y) pools.push({x,y,z,r:2+rnd()*2.4}); continue; }
          place(e[0],t,x,z,e[0]==="mesa"?1:1);
        }
        // a sparser outer band of big trees/rocks for depth
        for(let k=0;k<4;k++){ const t=i+(rnd()-0.5), d=40+rnd()*90; if(hab==="coast"&&side>0) continue;
          const big=tab.filter(e=>/conifer|broadleaf|cypress|palm|boulder|mesa|coniferSnow/.test(e[0])); if(!big.length) continue;
          const e=pick(big,rnd); place(e[0],t,pathX(t)+side*d,-t*SP,1.2); }
      });
      // grass tufts (colour sampled from the ground so they melt into it)
      if(hab!=="desert" && hab!=="volcano" && hab!=="tundra"){
        const n=mobile?60:120;
        for(let k=0;k<n;k++){ const t=i+rnd(), side=rnd()<0.5?-1:1, d=3.4+Math.pow(rnd(),1.3)*30; if(hab==="coast"&&side>0&&d>6) continue;
          const x=pathX(t)+side*d, z=-t*SP, y=groundH(x,z); if(y<WATER_Y+0.2) continue;
          groundColor(x,z,y,groundN(x,z,N),c); const gs=0.45+rnd()*0.45+smooth(4,20,d)*0.4; addInst("grass",Math.floor((t+12)/4),x,y-0.02,z,rnd()*PI*2,gs,null,c.clone().multiplyScalar(1.1)); }
      }
    }
    flushInst();
    pools.forEach(p=>{ const m=new T.Mesh(depthDisc(p.r),poolMat); m.position.set(p.x,p.y+0.14,p.z); scene.add(m);
      const pads=[]; for(let k=0;k<4;k++){ const a=rnd()*PI*2, rr=rnd()*p.r*0.7; pads.push(prep(new T.CircleGeometry(0.35,10),0x3f8f47,M4(Math.cos(a)*rr,0.03,Math.sin(a)*rr,-PI/2,0,rnd()*3))); }
      const pm=new T.Mesh(merge(pads),swayMat); pm.position.copy(m.position); INK.layer(pm,2); scene.add(pm); });
  })();

  /* ---- board spaces: carved stepping-stones with glowing rune rings + comic icons ---- */
  const icons=[], runes=[];
  (function buildSpaces(){
    const prof=[[0,0],[1.62,0],[1.74,0.1],[1.7,0.26],[1.56,0.37],[1.2,0.42],[0,0.42]].map(p=>new T.Vector2(p[0],p[1]));
    const sg=K.weld(new T.LatheGeometry(prof,28)), P=sg.attributes.position;
    for(let i=0;i<P.count;i++){ const x=P.getX(i), y=P.getY(i), z=P.getZ(i), r=Math.hypot(x,z); if(r<0.1) continue; const k=1+(noise3(x*1.5,y*3,z*1.5)-0.5)*0.12; P.setXYZ(i,x*k,y,z*k); }
    sg.computeVertexNormals();
    const stoneGeo=prep(sg,(x,y,z,Cc)=>{ Cc.setRGB(0.62,0.6,0.56).multiplyScalar(0.85+0.3*smooth(0.1,0.42,y)); if(noise3(x*3,y*3,z*3)>0.64) Cc.multiplyScalar(0.86); });
    const stones=new T.InstancedMesh(stoneGeo,propMat,FIN+1); stones.castShadow=true; stones.receiveShadow=true; stones.frustumCulled=false;
    const ringGeo=new T.RingGeometry(0.95,1.24,48); ringGeo.rotateX(-PI/2);
    const dotGeo=new T.CircleGeometry(0.16,10); dotGeo.rotateX(-PI/2);
    for(let i=0;i<=FIN;i++){
      const type=BOARD[i], p=pathPoint(i);
      stones.setMatrixAt(i,M4(p.x,-0.02,p.z,0,i*1.7,0)); stones.setColorAt(i,new T.Color(1,1,1).multiplyScalar(0.9+hash2(i,3)*0.2));
      const rm=new T.MeshBasicMaterial({color:RUNE_COL[type]||0xcccccc, fog:true});
      const ring=new T.Mesh(ringGeo,rm); ring.position.set(p.x,0.425,p.z); INK.layer(ring,2); scene.add(ring);
      if(type!=="empty") for(let k=0;k<6;k++){ const a=k/6*PI*2+i; const dm=new T.Mesh(dotGeo,rm); dm.position.set(p.x+Math.cos(a)*1.45,0.4,p.z+Math.sin(a)*1.45); INK.layer(dm,2); scene.add(dm); }
      runes.push({m:rm,type,base:new T.Color(RUNE_COL[type]||0xcccccc),i});
      const spr=new T.Sprite(new T.SpriteMaterial({map:iconTexture(type,cfg.tileIcon[type]||"",i),transparent:true,depthTest:false,fog:false}));
      spr.scale.set(1.35,1.74,1); spr.position.set(p.x,3.4,p.z); spr.renderOrder=5; INK.layer(spr,3); scene.add(spr);
      icons.push({spr,i});
    }
    stones.instanceMatrix.needsUpdate=true; scene.add(stones);
  })();

  /* ---- landmarks: volcano, ocean, the finish nest + bone arch ---- */
  const firstOf=(h)=>{ for(let i=0;i<=FIN;i++) if(habAt(i)===h) return i; return -1; };
  let crater=null, ocean=null;
  (function buildLandmarks(){
    const v=firstOf("volcano");
    if(v>=0){ const t=v+5, x=pathX(t)-82, z=-t*SP;
      const g=K.weld(new T.CylinderGeometry(10,56,72,48,16,true)), P=g.attributes.position;
      for(let i=0;i<P.count;i++){ const px=P.getX(i), py=P.getY(i), pz=P.getZ(i), a=Math.atan2(pz,px); const k=1+(noise3(Math.cos(a)*3,py*0.08,Math.sin(a)*3)-0.5)*0.35+Math.sin(a*9)*0.03; P.setXYZ(i,px*k,py,pz*k); }
      g.computeVertexNormals();
      const vm=new T.Mesh(prep(g,(px,py,pz,Cc)=>{ Cc.set(0x4a2a26).multiplyScalar(0.75+0.35*noise3(px*0.2,py*0.2,pz*0.2)); if(py>18) Cc.lerp(new T.Color(0x2a1c1c),0.6); }),propMat);
      vm.position.set(x,33,z); scene.add(vm);
      const lip=new T.Mesh(depthDisc(9.6,32),lavaMat); lip.position.set(x,68.6,z); INK.layer(lip,2); scene.add(lip);
      // glowing lava streaks down the flank toward the trail
      for(let s=0;s<3;s++){ const a0=-0.2+s*0.35, pos=[], idx=[], dep=[];
        for(let k=0;k<=30;k++){ const u=k/30, r=10+u*47, a=a0+Math.sin(u*6+s)*0.08, y=69-u*72+1.2, w=1.0+u*1.8;
          const cx=Math.cos(a)*r, cz=Math.sin(a)*r, tx=-Math.sin(a), tz=Math.cos(a);
          pos.push(x+cx-tx*w,y,z+cz-tz*w, x+cx+tx*w,y,z+cz+tz*w); dep.push(1,1);
          if(k) idx.push((k-1)*2,k*2,(k-1)*2+1, (k-1)*2+1,k*2,k*2+1); }
        const lg=new T.BufferGeometry(); lg.setAttribute("position",new T.Float32BufferAttribute(pos,3)); lg.setAttribute("depth",new T.Float32BufferAttribute(dep,1)); lg.setIndex(idx);
        const lm=new T.Mesh(lg,lavaMat); lm.material.side=T.DoubleSide; INK.layer(lm,2); scene.add(lm); }
      crater=new T.Vector3(x,70,z);
      // a glowing lava river snaking beside the trail
      const pos=[], idx=[], dep=[]; let n=0;
      for(let tt=v-0.3;tt<=v+4.3;tt+=0.05){ const off=-7.5+Math.sin(tt*2.1)*1.6, R=pathRight(tt), P0=pathPoint(tt).addScaledVector(R,off), w=0.9+0.35*Math.sin(tt*5.3);
        const y0=groundH(P0.x-R.x*w,P0.z-R.z*w)+0.12, y1=groundH(P0.x+R.x*w,P0.z+R.z*w)+0.12;
        pos.push(P0.x-R.x*w,y0,P0.z-R.z*w, P0.x+R.x*w,y1,P0.z+R.z*w); dep.push(1,1);
        if(n) idx.push((n-1)*2,(n-1)*2+1,n*2, (n-1)*2+1,n*2+1,n*2); n++; }
      const rg=new T.BufferGeometry(); rg.setAttribute("position",new T.Float32BufferAttribute(pos,3)); rg.setAttribute("depth",new T.Float32BufferAttribute(dep,1)); rg.setIndex(idx); rg.computeBoundingSphere();
      const river=new T.Mesh(rg,lavaMat); INK.layer(river,2); scene.add(river); }
    const c=firstOf("coast");
    if(c>=0){ const t=c+1.5, len=SP*11, W=720, g=new T.PlaneGeometry(W,len,90,24); g.rotateX(-PI/2);
      const P=g.attributes.position, dep=new Float32Array(P.count), x0=pathX(t)+W/2-2;
      for(let i=0;i<P.count;i++){ const wx=P.getX(i)+x0, wz=P.getZ(i)-t*SP; dep[i]=Math.max(0,WATER_Y-groundH(wx,wz)); }
      g.setAttribute("depth",new T.BufferAttribute(dep,1));
      ocean=new T.Mesh(g,oceanMat); ocean.position.set(x0,WATER_Y,-t*SP); scene.add(ocean); }
    // the finish: a giant nest under a Game-of-Bones rib arch with a great skull
    const f=pathPoint(FIN);
    const nest=new T.Group(); nest.position.copy(f); scene.add(nest);
    const tw=K.weld(new T.TorusGeometry(3.6,1.05,14,48)), TP=tw.attributes.position;
    for(let i=0;i<TP.count;i++){ const x=TP.getX(i), y=TP.getY(i), z=TP.getZ(i); const k=1+(noise3(x*1.6,y*1.6,z*1.6)-0.5)*0.35; TP.setXYZ(i,x*k,y*k,z*(1+(k-1)*0.5)); }
    tw.computeVertexNormals();
    nest.add(new T.Mesh(prep(tw,(x,y,z,Cc)=>{ Cc.set(C.twig).multiplyScalar(0.7+0.5*noise3(x*5,y*5,z*5)); },M4(0,0.5,0,PI/2,0,0)),propMat));
    for(let k=0;k<5;k++){ const a=k/5*PI*2; nest.add(new T.Mesh(prep(K.SPHERE,(x,y,z,Cc)=>{ Cc.set(0xfff0cc); if(noise3(x*7+k,y*7,z*7)>0.66) Cc.set(0xc0a070); },M4(Math.cos(a)*1.5,0.75,Math.sin(a)*1.5,0.2,a,0.1,0.55,0.75,0.55)),propMat)); }
    const arch=new T.Group(); arch.position.copy(pathPoint(FIN-0.62)); arch.lookAt(pathPoint(FIN-1.5)); scene.add(arch);
    const boneC=(s,sa,ca,Cc)=>Cc.set(C.bone).multiplyScalar(0.82+0.22*(sa*0.5+0.5));
    const rib=sweep([[0,0,0.55,0.55],[0.25,3.2,0.46,0.46],[1.1,6.4,0.4,0.4],[2.6,8.6,0.34,0.34],[4.1,9.3,0.3,0.3]],{seg:12,belly:1,density:3,color:boneC}).geo;
    [-1,1].forEach(s=>{ const g=prep(rib,null,M4(s*4.2,0,0,0,-s*PI/2,0)); arch.add(new T.Mesh(g,propMat));
      arch.add(new T.Mesh(prep(blob(1,0.2,1.5,s+3),C.bone,M4(s*4.2,0.3,0,0,0,0,0.9,0.5,0.9)),propMat)); });
    const skull=merge([prep(sweep([[0,0,0.9,1.0],[0.8,0.1,1.05,1.1],[1.9,-0.2,0.7,0.7],[2.8,-0.45,0.45,0.45],[3.1,-0.5,0.05,0.08]],{seg:16,color:boneC}).geo),
      prep(K.SPHERE_LO,0x2a2018,M4(0.62,0.35,0.8,0,0,0,0.32,0.36,0.3)),prep(K.SPHERE_LO,0x2a2018,M4(-0.62,0.35,0.8,0,0,0,0.32,0.36,0.3)),
      ...Array.from({length:8},(_,k)=>prep(K.CONE,0xfff6dc,M4((k%2?1:-1)*0.5,-0.85,0.9+Math.floor(k/2)*0.45,PI,0,0,0.09,0.4,0.09)))]);
    const skullM=new T.Mesh(skull,propMat); skullM.position.set(0,9.6,-1.0); arch.add(skullM);
    const s0=pathPoint(-0.9); const sn=new T.Mesh(PROPS.eggs.geo,propMat); sn.position.copy(s0); sn.scale.setScalar(1.2); scene.add(sn);
    arch.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; } });
    nest.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; } });
  })();

  /* ---- ambient particles that follow the camera (snow, embers, fireflies…) ---- */
  const dotTex=dotTexture(), sparkTex=sparkTexture();
  const AMBN=260, ambPos=new Float32Array(AMBN*3), ambSeed=new Float32Array(AMBN);
  for(let i=0;i<AMBN;i++){ ambPos[i*3]=(Math.random()-0.5)*44; ambPos[i*3+1]=Math.random()*14; ambPos[i*3+2]=(Math.random()-0.5)*50; ambSeed[i]=Math.random()*100; }
  const ambGeo=new T.BufferGeometry(); ambGeo.setAttribute("position",new T.BufferAttribute(ambPos,3));
  const ambMat=new T.PointsMaterial({size:0.25,map:dotTex,transparent:true,depthWrite:false,opacity:0.9});
  const amb=new T.Points(ambGeo,ambMat); amb.frustumCulled=false; INK.layer(amb,2); scene.add(amb);
  let ambKind=null;

  /* ---- toon puffs: inked smoke / dust / fire clumps (very anime) ---- */
  const PUFFN=260, puffGeo=prep(blob(1,0.22,1.6,5),0xffffff);
  const smokeMat=INK.toon({vertexColors:true,rim:0.4});
  const smokes=new T.InstancedMesh(puffGeo,smokeMat,PUFFN); smokes.frustumCulled=false; smokes.count=0; scene.add(smokes);
  const fires=new T.InstancedMesh(puffGeo,new T.MeshBasicMaterial({vertexColors:true}),PUFFN); fires.frustumCulled=false; fires.count=0; scene.add(fires);
  smokes.setColorAt(0,new T.Color()); fires.setColorAt(0,new T.Color());
  const puffList=[];
  function puff(o){ if(puffList.length>=PUFFN*2) return;
    puffList.push({ fire:!!o.fire, p:o.pos.clone(), v:(o.vel||new T.Vector3()).clone(), age:0, life:o.life||1.5, s0:o.s0||0.5, s1:o.s1||1.6,
      c:new T.Color(o.color==null?0xdddddd:o.color), c1:o.color1!=null?new T.Color(o.color1):null, rise:o.rise||0, drag:o.drag==null?1.2:o.drag, rot:Math.random()*PI*2 }); }
  const _pm=new T.Matrix4(), _pq=new T.Quaternion(), _ps=new T.Vector3(), _pc=new T.Color(), _eu=new T.Euler();
  function updatePuffs(dt){
    let ns=0, nf=0;
    for(let i=puffList.length-1;i>=0;i--){ const q=puffList[i]; q.age+=dt; if(q.age>=q.life){ puffList.splice(i,1); continue; }
      q.v.multiplyScalar(Math.exp(-q.drag*dt)); q.v.y+=q.rise*dt; q.p.addScaledVector(q.v,dt);
      const u=q.age/q.life, s=lerp(q.s0,q.s1,easeOut(Math.min(1,u*1.6)))*(u>0.72?1-(u-0.72)/0.28:1);
      _pq.setFromEuler(_eu.set(q.rot,q.rot*0.7,0)); _ps.set(s,s,s); _pm.compose(q.p,_pq,_ps);
      _pc.copy(q.c); if(q.c1) _pc.lerp(q.c1,smooth(0,0.7,u));
      if(q.fire){ if(nf<PUFFN){ fires.setMatrixAt(nf,_pm); fires.setColorAt(nf,_pc); nf++; } }
      else if(ns<PUFFN){ smokes.setMatrixAt(ns,_pm); smokes.setColorAt(ns,_pc); ns++; } }
    smokes.count=ns; fires.count=nf;
    smokes.instanceMatrix.needsUpdate=true; fires.instanceMatrix.needsUpdate=true;
    if(smokes.instanceColor) smokes.instanceColor.needsUpdate=true; if(fires.instanceColor) fires.instanceColor.needsUpdate=true;
  }

  /* ---- transient effects ---- */
  const bursts=[], meteors=[], timers=[];
  let shake=0, sink=0, sinkTarget=0, flood=null, tar=null, fovKick=0, roll=0, frost=0, haze=0, impact=0;
  const tint={col:new T.Color(0,0,0),amt:0,fogCut:0};
  function after(sec,fn){ timers.push({t:sec,fn}); }
  function flash(color,alpha,ms){
    flashEl.style.transition="none"; flashEl.style.background=color; flashEl.style.opacity=String(alpha==null?0.45:alpha);
    requestAnimationFrame(()=>{ flashEl.style.transition="opacity "+(ms||600)+"ms ease-out"; flashEl.style.opacity="0"; });
  }
  function setTint(hex,amt,fogCut){ tint.col.set(hex); tint.amt=amt; tint.fogCut=fogCut||0; }
  function hit(amount){ if(reduceMotion) return; impact=Math.max(impact,amount); fovKick=Math.max(fovKick,6*amount); }
  function burst(o){
    const n=o.n||60, pos=new Float32Array(n*3), col=new Float32Array(n*3), vel=[];
    const cols=(o.colors||[o.color||0xffffff]).map(h=>new T.Color(h));
    for(let i=0;i<n;i++){
      pos[i*3]=o.pos.x+(Math.random()-0.5)*(o.spread||1); pos[i*3+1]=o.pos.y+(Math.random()-0.5)*(o.spreadY||o.spread||1); pos[i*3+2]=o.pos.z+(Math.random()-0.5)*(o.spread||1);
      const a=Math.random()*PI*2, e=(Math.random()*2-1), sp=(o.speed||4)*(0.4+Math.random()*0.6), r=Math.sqrt(1-e*e);
      vel.push(new T.Vector3(Math.cos(a)*r*sp+(o.vx||0), Math.abs(e)*sp*(o.upBias||1)+(o.up||0), Math.sin(a)*r*sp+(o.vz||0)));
      const c=cols[i%cols.length]; col[i*3]=c.r; col[i*3+1]=c.g; col[i*3+2]=c.b;
    }
    const g=new T.BufferGeometry(); g.setAttribute("position",new T.BufferAttribute(pos,3)); g.setAttribute("color",new T.BufferAttribute(col,3));
    const m=new T.PointsMaterial({size:o.size||0.35,map:o.spark?sparkTex:dotTex,vertexColors:true,transparent:true,depthWrite:false,
      blending:o.add?T.AdditiveBlending:T.NormalBlending});
    const pts=new T.Points(g,m); pts.frustumCulled=false; INK.layer(pts,2); scene.add(pts);
    bursts.push({pts,pos,vel,n,age:0,life:o.life||1.6,gravity:o.gravity==null?-6:o.gravity,drag:o.drag||0.6});
  }
  const meteorGeo=blob(1,0.3,1.4,9);
  function meteor(target,delay){
    const m=new T.Mesh(meteorGeo,lavaMat); m.scale.setScalar(1.0+Math.random()*0.6); m.visible=false; scene.add(m);
    const from=target.clone().add(new T.Vector3((Math.random()-0.5)*24,30+Math.random()*10,-10-Math.random()*14));
    meteors.push({m,from,to:target.clone(),t:-(delay||0),dur:0.8+Math.random()*0.5});
  }

  /* ---- comic sound effects ---- */
  const _cv=new T.Vector3();
  function comic(text,o){
    o=o||{};
    const el=document.createElement("div"); el.className="w3-comic"+(o.burst?" burst":"");
    el.textContent=text;
    const w=container.clientWidth||1, h=container.clientHeight||1;
    let x=w*(o.x==null?0.5:o.x), y=h*(o.y==null?0.42:o.y);
    if(o.at){ _cv.copy(o.at).project(camera); if(_cv.z<1 && Math.abs(_cv.x)<1.2 && Math.abs(_cv.y)<1.2){ x=(_cv.x*0.5+0.5)*w; y=(-_cv.y*0.5+0.5)*h; } }
    x=clamp(x,w*0.18,w*0.82); y=clamp(y,h*0.2,h*0.62);
    const s=Math.round((o.size||1)*clamp(Math.min(w,h)*0.11,34,96));
    el.style.left=x+"px"; el.style.top=y+"px";
    el.style.setProperty("--s",s+"px"); el.style.setProperty("--r",(o.rot==null?(Math.random()*14-7):o.rot)+"deg");
    el.style.setProperty("--c",o.color||"#ffe14a"); el.style.setProperty("--b",o.bg||"#ff3d6e"); el.style.setProperty("--d",(o.dur||1.4)+"s");
    comicsEl.appendChild(el);
    setTimeout(()=>el.remove(),(o.dur||1.4)*1000+80);
  }

  /* ---- player models & transient actors ---- */
  const models={};          // idx -> entry
  const actors=[];          // wild dinos etc.
  let S=null, lastActive=null;
  function camGround(){ return pathPoint(camT); }

  function makeDino(arch,hex,species,wild){
    const b=DN.build(arch,species,hex,{wild});
    const root=new T.Group(); root.rotation.order="YXZ"; root.add(b.group);
    const holder=new T.Group(); holder.add(root);
    if(b.marine){ const pond=new T.Mesh(depthDisc(Math.max(2.2,b.length*0.38),48),pondMat); pond.position.y=0.3; holder.add(pond); }
    return { holder, root, rig:b.rig, height:b.height, scale:1, mats:b.mats, arch, species:b.species, flyer:b.flyer,
      phase:Math.random()*10, anim:{mode:"idle",t:0}, yaw:0, moving:0, opacity:1, poseAcc:1,
      base:new T.Vector3(), target:new T.Vector3(), face:new T.Vector3(), side:1 };
  }
  function setAnim(e,mode){ if(!e) return; e.anim.mode=mode; e.anim.t=0; }
  function setOpacity(e,o){
    if(Math.abs(o-e.opacity)<0.001) return; e.opacity=o;
    e.mats.forEach(m=>{ if(!m.transparent){ m.transparent=true; m.needsUpdate=true; } m.opacity=o; });
    if(e.label) e.label.material.opacity=o;
  }
  function disposeEntry(e){
    scene.remove(e.holder);
    e.holder.traverse(o=>{ if(o.isMesh && o.geometry) o.geometry.dispose(); });
    e.mats.forEach(m=>m.dispose());
    if(e.label){ e.label.material.map.dispose(); e.label.material.dispose(); }
  }
  function spawnActor(arch,hex,opts){
    opts=opts||{};
    const e=makeDino(arch,hex,opts.species,opts.wild!==false); scene.add(e.holder); actors.push(e);
    const t=S?activePos():0, big=Math.max(1,(e.height||2)/2.6);
    pathPoint(t+(opts.ahead||0.6)*big+(e.flyer?0.2:0),e.base); e.target.copy(e.base);
    e.face.copy(camGround()); e.yaw=Math.atan2(e.face.x-e.base.x,e.face.z-e.base.z);
    e.side=Math.random()<0.5?-1:1; e.tag=opts.tag;
    setAnim(e,"enter"); e.holder.position.copy(e.base);
    return e;
  }
  function findActor(tag){ return actors.find(a=>a.tag===tag && !a.dead); }
  function dismissActors(){ actors.forEach(a=>{ if(a.anim.mode!=="exit") setAnim(a,"exit"); }); }
  function headPos(e,out){ return (out||new T.Vector3()).copy(e.holder.position).setY(e.height*0.8); }

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
  let camT=0, targetT=0, eyeS=2.5, eyeT=2.5, liftS=0, glide=0;
  let lookYaw=0, lookPitch=0, yawS=0, pitchS=0, lastDrag=-99, time=0;

  function sync(state,snap){
    S=state;
    const act=activeP(), shown=[];
    state.players.forEach(p=>{
      const hex=resolveColor(p.color);
      let e=models[p.idx];
      if(!e || e.arch!==p.arch || e.hex!==hex || (p.species && e.wantSpecies!==p.species)){
        if(e) disposeEntry(e);
        e=models[p.idx]=makeDino(p.arch,hex,p.species,false); e.hex=hex; e.wantSpecies=p.species; scene.add(e.holder); e.fresh=true;
      }
      const key=p.name+"|"+p.hp+"|"+p.maxHp+"|"+(p.finished?1:0);
      if(e.labelKey!==key){
        e.labelKey=key;
        if(e.label){ e.label.material.map.dispose(); e.label.material.map=labelTexture(p,hex); e.label.material.needsUpdate=true; }
        else { e.label=new T.Sprite(new T.SpriteMaterial({map:labelTexture(p,hex),depthTest:false,transparent:true,fog:false})); e.label.renderOrder=10; e.label.scale.set(2.0,0.7,1); INK.layer(e.label,3); e.holder.add(e.label); }
        e.label.position.set(0,e.height+0.8,0);
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
  const ahead=(at,dz,dx)=>at.clone().add(pathTangent(activePos()).multiplyScalar(dz||6)).add(pathRight(activePos()).multiplyScalar(dx||0));
  const HAZ={
    "Asteroid Shower":  (at)=>{ setTint(0xff8a3d,0.45); comic("KA-BOOM!",{burst:true,bg:"#ff7a1a",y:0.3});
      for(let k=0;k<10;k++) meteor(ahead(at,11+Math.random()*16,(Math.random()-0.5)*18),k*0.18); },
    "Volcanic Eruption":(at)=>{ setTint(0xff3b1a,0.55); shake=Math.max(shake,0.35); comic("RUMBLE!",{burst:true,bg:"#ff4a1a",y:0.3});
      for(let k=0;k<5;k++) after(k*0.35,()=>{ const p=ahead(at,10+Math.random()*6,(Math.random()-0.5)*10);
        burst({pos:p,n:70,colors:[0xff6a1a,0xffb13d,0xff3b1a],speed:9,upBias:2,size:0.5,life:2,add:true});
        for(let j=0;j<4;j++) puff({pos:p.clone().add(new T.Vector3(0,1,0)),vel:new T.Vector3((Math.random()-0.5)*3,6+Math.random()*4,(Math.random()-0.5)*3),life:3,s0:0.8,s1:3,color:0x5a4a48,color1:0x2a2224,rise:0.5});
        for(let j=0;j<3;j++) puff({fire:true,pos:p.clone(),vel:new T.Vector3((Math.random()-0.5)*4,7,(Math.random()-0.5)*4),life:0.9,s0:0.6,s1:1.4,color:0xffd060,color1:0xff4a10}); }); },
    "Predator Ambush":  ()=>{ setTint(0x3a2a2a,0.35); const e=spawnActor("apex",0x3b3530,{tag:"predator",ahead:0.55,species:PREDATORS[Math.floor(Math.random()*PREDATORS.length)]});
      shake=Math.max(shake,0.2); after(0.5,()=>comic("ROAAAR!",{burst:true,at:headPos(e),bg:"#e8264f",size:1.15})); },
    "Disease":          (at)=>{ setTint(0x7cff5a,0.4); comic("ACHOO!",{color:"#c8ff6a",bg:"#3a8a3a",burst:true});
      for(let k=0;k<14;k++) puff({pos:ahead(at,3+Math.random()*5,(Math.random()-0.5)*6).setY(0.5+Math.random()*2),vel:new T.Vector3((Math.random()-0.5)*1.5,0.6,(Math.random()-0.5)*1.5),life:3,s0:0.3,s1:1.2,color:0x9cff6a,color1:0x4a9a3a,drag:0.4});
      burst({pos:ahead(at,4).setY(0.5),n:70,color:0x9cff6a,speed:1.2,gravity:1.2,up:0.6,spread:8,size:0.5,life:3}); },
    "Cold Snap":        (at)=>{ setTint(0xcfe9ff,0.6); frost=1; comic("BRRRR!",{color:"#ffffff",bg:"#4aa8ff",burst:true});
      burst({pos:at.clone().add(new T.Vector3(0,12,-4)),n:260,color:0xffffff,speed:0.8,gravity:-1.2,spread:26,spreadY:6,size:0.3,life:4}); },
    "Flash Flood":      (at)=>{ setTint(0x3a8fd0,0.4); comic("SPLASH!",{color:"#e8fbff",bg:"#1e8fe0",burst:true});
      if(flood){ scene.remove(flood.mesh); flood.mesh.geometry.dispose(); }
      flood={t:0,mesh:(()=>{ const m=new T.Mesh(depthDisc(45,48),oceanMat); m.position.copy(at).setY(-0.5); scene.add(m); return m; })()};
      for(let k=0;k<14;k++) puff({pos:ahead(at,5+Math.random()*9,(Math.random()-0.5)*12).setY(0.3),vel:new T.Vector3((Math.random()-0.5)*3,4+Math.random()*3,(Math.random()-0.5)*3),life:1.2,s0:0.3,s1:0.8,color:0xeaf8ff,rise:-6});
      burst({pos:at.clone().add(new T.Vector3(0,14,-6)),n:220,color:0x9fd8ff,speed:0.4,gravity:-26,spread:28,spreadY:4,size:0.18,life:1.4}); },
    "Tar Pit":          (at)=>{ setTint(0x221a16,0.35); comic("GLOOP!",{color:"#c8b8a8",bg:"#2a2220",burst:true});
      if(tar){ scene.remove(tar.mesh); tar.mesh.geometry.dispose(); tar.mesh.material.dispose(); }
      tar={t:0,next:0,mesh:(()=>{ const m=new T.Mesh(new T.CircleGeometry(1,32),INK.toon({color:0x17110e,rim:2})); m.rotation.x=-PI/2; m.position.copy(at).setY(0.45); scene.add(m); return m; })()}; sinkTarget=-0.45; },
    "Sandstorm":        (at)=>{ setTint(0xe0b872,0.6,0.75); comic("WHOOOSH!",{color:"#fff0c8",bg:"#c08a3a",burst:true});
      for(let k=0;k<22;k++) after(k*0.07,()=>puff({pos:at.clone().add(new T.Vector3(-16+Math.random()*4,0.5+Math.random()*4,-4-Math.random()*12)),vel:new T.Vector3(16+Math.random()*6,0.5,Math.random()*2),life:2.2,s0:1,s1:2.6,color:0xe8c88a,color1:0xc89a5a,drag:0.2}));
      burst({pos:at.clone().add(new T.Vector3(-18,2,-6)),n:300,color:0xe7c78b,speed:1,vx:14,gravity:0,spread:30,spreadY:5,size:0.3,life:2.5,drag:0}); },
    "Drought":          (at)=>{ setTint(0xff9a3d,0.45,0.3); haze=1; comic("SIZZLE!",{color:"#ffe08a",bg:"#ff7a1a",burst:true});
      burst({pos:ahead(at,6).setY(1),n:80,color:0xe0b16b,speed:1.5,gravity:0.4,spread:14,size:0.4,life:2.5}); },
    "Food Shortage":    (at)=>{ setTint(0xb07a3a,0.3); comic("GRUMBLE…",{color:"#ffd08a",bg:"#8a5a2a",burst:true,size:0.85});
      burst({pos:at.clone().add(new T.Vector3(0,9,-5)),n:90,colors:[0xc0712b,0xd9a13b,0x8a4f22],speed:0.6,gravity:-1.4,spread:14,spreadY:4,size:0.45,life:4}); },
  };

  function fx(name,d){
    d=d||{};
    const at=pathPoint(activePos());
    switch(name){
      case "hazard":{ lookYaw=lookPitch=0; (HAZ[d.name]||((a)=>setTint(0xff6a3d,0.35)))(at); break; }
      case "hazardResult":{
        if(d.dodged){ flash("rgba(160,230,255,.9)",0.3,700); burst({pos:at.clone().setY(2),n:60,colors:[0xbff0ff,0xffffff],speed:5,size:0.4,life:1,add:true,spark:true}); comic("DODGED!",{color:"#aef3ff",bg:"#1e8fe0",burst:true,y:0.36}); }
        else if(d.ok){ flash("rgba(120,255,150,.9)",0.2,700); comic("PHEW!",{color:"#b8ffb0",bg:"#2a9a4a",y:0.36}); }
        else if(d.kind==="wash"){ flash("rgba(90,170,255,.9)",0.35,800); shake=Math.max(shake,0.3); comic("WASHED BACK!",{color:"#dff4ff",bg:"#1e6fd0",burst:true,size:0.8,y:0.36}); }
        else { flash("rgba(255,40,40,.95)",0.4,700); shake=Math.max(shake,0.55); hit(0.7); comic("OUCH!",{color:"#ffffff",bg:"#e8264f",burst:true,y:0.36,size:1.15}); }
        const pred=findActor("predator");
        if(pred){ if(!d.ok && !d.dodged){ setAnim(pred,"lunge"); after(0.7,()=>setAnim(pred,"exit")); } else setAnim(pred,"exit"); }
        after(1.2,()=>{ tint.amt*=0.5; });
        break; }
      case "wild":{ lookYaw=lookPitch=0; const e=spawnActor(d.arch||"apex",0x7a5c3a,{tag:"wild",species:d.name}); shake=Math.max(shake,0.15);
        after(0.75,()=>comic("ROAR!",{burst:true,at:headPos(e),bg:"#ff7a1a"})); break; }
      case "wildResult":{
        const w=findActor("wild");
        if(d.win){ if(w){ setAnim(w,"hop"); after(0.6,()=>setAnim(w,"exit")); }
          flash("rgba(120,255,150,.9)",0.2,700); hit(0.35);
          comic(d.aggressive?"CHOMP!":"POW!",{burst:true,bg:d.aggressive?"#ff3d6e":"#ffb800",color:d.aggressive?"#ffe14a":"#ffffff",at:w?headPos(w):null,size:1.1});
          if(d.aggressive) burst({pos:at.clone().setY(1.5),n:70,colors:[0xff6b8a,0xffd1dc,0xffffff],speed:3,gravity:1,size:0.4,life:1.4,add:true,spark:true}); }
        else { if(w){ setAnim(w,"lunge"); after(0.7,()=>setAnim(w,"exit")); }
          after(0.22,()=>{ flash("rgba(255,40,40,.95)",0.4,700); shake=Math.max(shake,0.55); hit(0.9); comic("CRUNCH!",{burst:true,bg:"#e8264f",color:"#ffffff",size:1.15}); }); }
        break; }
      case "clash":{ lookYaw=lookPitch=0; const e=models[d.defender]; if(e) setAnim(e,"roar"); shake=Math.max(shake,0.2); if(!reduceMotion) roll=0.12;
        comic("VS!",{burst:true,bg:"#8a3aff",color:"#ffe14a",size:1.35,rot:-10}); break; }
      case "clashResult":{
        const act=activeP(); if(d.loser==null){ shake=Math.max(shake,0.15); break; }
        if(act && d.loser===act.idx){ const w=models[d.other]; if(w) setAnim(w,"lunge");
          after(0.25,()=>{ flash("rgba(255,40,40,.95)",0.45,700); shake=Math.max(shake,0.5); hit(1); comic("BAM!",{burst:true,bg:"#e8264f",color:"#ffffff",size:1.3}); }); }
        else { const e=models[d.loser]; if(e) setAnim(e,"hop"); flash("rgba(255,220,120,.9)",0.2,500); shake=Math.max(shake,0.25); hit(0.45);
          comic("POW!",{burst:true,bg:"#ffb800",color:"#ffffff",at:e?headPos(e):null,size:1.2}); }
        break; }
      case "oasis":{ flash("rgba(120,230,255,.9)",0.25,900); comic("AHHH~",{color:"#dffcff",bg:"#18b8d8",burst:true,size:0.95});
        burst({pos:at.clone().setY(0.6),n:110,colors:[0x7fe7ff,0xffffff,0xbaffd8],speed:2.2,gravity:2.5,up:1,spread:3,size:0.45,life:2,add:true,spark:true}); break; }
      case "extinct":{ const act=activeP();
        if(act && d.idx===act.idx){ flash("rgba(40,20,20,.95)",0.75,1400); sinkTarget=-(eyeT-0.5); shake=Math.max(shake,0.4); after(1.1,()=>{ sinkTarget=0; });
          comic("NOOOO!",{color:"#ffffff",bg:"#3a2a4a",burst:true,size:1.2}); }
        else { const e=models[d.idx]; if(e){ e.holder.visible=true; setAnim(e,"fall"); comic("EXTINCT!",{color:"#ffffff",bg:"#5a4a6a",at:headPos(e),size:0.8}); } }
        break; }
      case "respawn":{ after(0.4,()=>{ const p=S.players.find(q=>q.idx===d.idx); if(!p) return;
          const mine=activeP() && d.idx===activeP().idx, where=mine?pathPoint(p.pos+0.8):pathPoint(p.pos);
          burst({pos:where.clone().setY(1),n:90,colors:[0xfff3dc,0xffffff,0xe8d9b5],speed:5,size:0.45,life:1.6,spark:true});
          for(let k=0;k<8;k++) puff({pos:where.clone().setY(0.6),vel:new T.Vector3((Math.random()-0.5)*5,3+Math.random()*3,(Math.random()-0.5)*5),life:1.2,s0:0.25,s1:0.6,color:0xfff3dc,rise:-8});
          comic("HATCH!",{color:"#fff6c9",bg:"#ff9a3a",burst:true,at:where.clone().setY(1.5)});
          if(mine) flash("rgba(255,250,235,.95)",0.5,900); }); break; }
      case "nest":{ const f=pathPoint(FIN).setY(6); flash("rgba(255,215,90,.9)",0.35,900); comic("MADE IT!",{color:"#fff6c9",bg:"#ffb800",burst:true,size:1.2});
        for(let k=0;k<5;k++) after(k*0.35,()=>burst({pos:f.clone().add(new T.Vector3((Math.random()-0.5)*8,Math.random()*3,(Math.random()-0.5)*6)),n:90,colors:[0xffd766,0xff7eb6,0x5db0ff,0x7ed957,0xffffff],speed:8,gravity:-5,size:0.45,life:2.2,add:true,spark:true})); break; }
      case "tiebreak":{ lookYaw=lookPitch=0; shake=Math.max(shake,0.3); if(!reduceMotion) roll=0.1; flash("rgba(255,215,90,.9)",0.3,600); const e=models[d.other]; if(e) setAnim(e,"roar");
        comic("SHOWDOWN!",{burst:true,bg:"#8a3aff",color:"#ffe14a",size:1.1}); break; }
      case "roar":{ const e=models[d.idx]; if(e) setAnim(e,"roar"); break; }
    }
  }

  /* ---- input: drag to look around ---- */
  let drag=null;
  cv.addEventListener("pointerdown",e=>{ drag={x:e.clientX,y:e.clientY}; cv.setPointerCapture(e.pointerId); hintEl.classList.add("gone"); });
  cv.addEventListener("pointermove",e=>{ if(!drag) return;
    lookYaw=clamp(lookYaw+(e.clientX-drag.x)*0.006,-1.4,1.4); lookPitch=clamp(lookPitch-(e.clientY-drag.y)*0.004,-0.55,0.5);
    drag.x=e.clientX; drag.y=e.clientY; lastDrag=time; });
  const endDrag=e=>{ drag=null; try{ cv.releasePointerCapture(e.pointerId); }catch(_){} };
  cv.addEventListener("pointerup",endDrag); cv.addEventListener("pointercancel",endDrag);
  setTimeout(()=>hintEl.classList.add("gone"),6000);

  /* ---- per-frame updates ---- */
  const v1=new T.Vector3(), v2=new T.Vector3(), v3=new T.Vector3(), up=new T.Vector3(0,1,0);
  const cHor=new T.Color(), cTop=new T.Color(), cSun=new T.Color();

  function updateCamera(dt){
    const prev=camT;
    camT+=(targetT-camT)*(1-Math.exp(-dt*2.6));
    if(Math.abs(targetT-camT)<0.002) camT=targetT;
    const speed=Math.abs(camT-prev)/Math.max(dt,1e-4), dist=Math.abs(targetT-camT);
    glide=lerp(glide,clamp((speed-0.8)/3,0,1),1-Math.exp(-dt*6));
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
    const pitch=pitchS-0.02-eyeS*0.025-liftS*0.035;
    camera.lookAt(camera.position.x+fx_*10, camera.position.y+Math.tan(pitch)*10, camera.position.z+fz_*10);
    fovKick*=Math.exp(-dt*5); roll*=Math.exp(-dt*2.2);
    const fov=68+fovKick+glide*6;
    if(Math.abs(camera.fov-fov)>0.01){ camera.fov=fov; camera.updateProjectionMatrix(); }
    camera.rotation.z+=roll;
    if(shake>0.001 && !reduceMotion){ camera.position.x+=(Math.random()-0.5)*shake*0.5; camera.position.y+=(Math.random()-0.5)*shake*0.5; camera.rotation.z+=(Math.random()-0.5)*shake*0.06; }
    shake*=Math.exp(-dt*5);
  }

  const A={jaw:0,up:0,lunge:0};
  function animate(e,dt){
    const k=1-Math.exp(-dt*3.2);
    v1.copy(e.base); e.base.lerp(e.target,k);
    const spd=v1.distanceTo(e.base)/Math.max(dt,1e-4);
    const a=e.anim; a.t+=dt;
    let walking=clamp(spd/2,0,1);
    const desired=Math.atan2(e.face.x-e.base.x,e.face.z-e.base.z);
    e.yaw=angleLerp(e.yaw,desired,1-Math.exp(-dt*4));
    const fwd=v2.set(Math.sin(e.yaw),0,Math.cos(e.yaw));
    const off=v3.set(0,0,0);
    let extraYaw=0, jaw=0, upA=0, lunge=0, pulse=1, tip=0;
    switch(a.mode){
      case "enter":{ const q=clamp(a.t/0.9,0,1), e2=easeOut(q);
        off.copy(pathRight(camT)).multiplyScalar(e.side*(1-e2)*9).addScaledVector(up,Math.sin(PI*q)*1.6); walking=1-q*0.6;
        if(q>=1) setAnim(e,"roar"); break; }
      case "roar":{ const q=clamp(a.t/1.2,0,1), s=Math.sin(PI*q); jaw=s; upA=s; pulse=1+s*0.05; if(q>=1) setAnim(e,"idle"); break; }
      case "lunge":{ const q=clamp(a.t/0.55,0,1), s=Math.sin(PI*q); off.addScaledVector(fwd,s*2.6); jaw=s; lunge=s; if(q>=1) setAnim(e,"idle"); break; }
      case "hop":{ const q=clamp(a.t/0.6,0,1), s=Math.sin(PI*q); off.addScaledVector(fwd,-s*1.4).addScaledVector(up,s*0.9); upA=-s*0.4; if(q>=1) setAnim(e,"idle"); break; }
      case "exit":{ extraYaw=PI*easeInOut(clamp(a.t/0.5,0,1)); off.addScaledVector(fwd,-Math.max(0,a.t-0.4)*5.5); walking=1;
        setOpacity(e,1-clamp((a.t-0.9)/1.0,0,1)); if(a.t>2.0) e.dead=true; break; }
      case "fall":{ tip=easeOut(clamp(a.t/0.6,0,1))*PI/2; setOpacity(e,1-clamp((a.t-1.0)/0.7,0,1)); if(a.t>1.8){ e.holder.visible=false; setOpacity(e,1); setAnim(e,"idle"); } break; }
    }
    e.moving=lerp(e.moving,walking,1-Math.exp(-dt*6));
    // pose on twos: skeletons update ~12x a second, like hand-drawn animation
    e.poseAcc+=dt;
    if(e.poseAcc>=1/12){ e.poseAcc=0; A.jaw=jaw; A.up=upA; A.lunge=lunge; DN.pose(e.rig,time+e.phase,e.moving,A); }
    e.root.scale.set(pulse,pulse,pulse);
    e.holder.position.copy(e.base).add(off);
    e.root.rotation.set(0,e.yaw+extraYaw,tip);
  }

  function updateEnv(dt){
    tcol(tbl.hor,camT,cHor); tcol(tbl.top,camT,cTop); tcol(tbl.sun,camT,cSun);
    tint.amt*=Math.exp(-dt*0.3); tint.fogCut*=Math.exp(-dt*0.3);
    if(tint.amt>0.002){ cHor.lerp(tint.col,tint.amt); cTop.lerp(tint.col,tint.amt*0.7); }
    scene.fog.color.copy(cHor); renderer.setClearColor(cHor,1);
    scene.fog.near=lerp(40,4,tint.fogCut); scene.fog.far=lerp(330,34,tint.fogCut);
    skyU.top.value.copy(cTop); skyU.hor.value.copy(cHor); skyU.sunCol.value.copy(cSun);
    tcol(tbl.cloud,camT,skyU.cloudCol.value); tcol(tbl.cshade,camT,skyU.cloudShade.value); skyU.clouds.value=tnum(tbl.clouds,camT);
    tcol(tbl.rim,camT,INK.SH.rimColor.value);
    hemi.color.copy(cTop).lerp(cHor,0.5); sun.color.copy(cSun);
    const g=pathPoint(camT,v1), fw=pathTangent(camT,v2);
    const low=habAt(camT)==="nest"?0.32:0.62;
    skyU.sunDir.value.set(0.72,low,0.38).normalize();
    sun.position.set(g.x+fw.x*18+skyU.sunDir.value.x*70, skyU.sunDir.value.y*70, g.z+fw.z*18+skyU.sunDir.value.z*70);
    sun.target.position.set(g.x+fw.x*18,0,g.z+fw.z*18); sun.target.updateMatrixWorld();
    sky.position.copy(camera.position);
    icons.forEach(ic=>{ ic.spr.position.y=3.4+Math.sin(time*1.6+ic.i)*0.12; const d=Math.abs(ic.i-camT); ic.spr.visible=d>0.35; ic.spr.material.opacity=clamp((d-0.35)/0.5,0,1); });
    runes.forEach(r=>{ const pulse=r.type==="bonus"||r.type==="finish"?0.75+0.35*Math.sin(time*2.4+r.i):0.9; r.m.color.copy(r.base).multiplyScalar(pulse); });
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
        const dx=x-cp.x, dz=z-cp.z;
        if(dx>22) x-=44; else if(dx<-22) x+=44;
        if(dz>25) z-=50; else if(dz<-25) z+=50;
        if(y>cp.y+10) y-=14; else if(y<cp.y-4) y+=14;
        ambPos[i*3]=x; ambPos[i*3+1]=y; ambPos[i*3+2]=z; }
      ambGeo.attributes.position.needsUpdate=true;
      ambMat.opacity=c.blink?0.55+Math.sin(time*3)*0.35:0.9; }
    // volcano plume: inked smoke clumps
    if(crater && camera.position.distanceTo(crater)<260){ plumeAcc+=dt;
      while(plumeAcc>0.14){ plumeAcc-=0.14; puff({pos:crater.clone().add(new T.Vector3((Math.random()-0.5)*5,0,(Math.random()-0.5)*5)),vel:new T.Vector3(1.2+Math.random(),5+Math.random()*2,(Math.random()-0.5)),life:8,s0:3,s1:11,color:0x5a4a4a,color1:0x2c2426,drag:0.05,rise:0.1}); } }
    // post-process uniforms
    frost*=Math.exp(-dt*0.45); haze*=Math.exp(-dt*0.4); impact*=Math.exp(-dt*9);
    const hb=habAt(camT);
    pipe.U.frost.value=frost; pipe.U.haze.value=haze+(hb==="desert"||hb==="volcano"?0.25:0); pipe.U.impact.value=impact; pipe.U.speed.value=reduceMotion?0:glide;
    pipe.U.time.value=time; INK.SH.time.value=time;
  }
  let plumeAcc=0;

  function updateFx(dt){
    for(let i=timers.length-1;i>=0;i--){ timers[i].t-=dt; if(timers[i].t<=0){ const f=timers[i].fn; timers.splice(i,1); try{ f(); }catch(err){ console.warn(err); } } }
    for(let i=bursts.length-1;i>=0;i--){ const b=bursts[i]; b.age+=dt;
      for(let j=0;j<b.n;j++){ const v=b.vel[j]; v.y+=b.gravity*dt; v.multiplyScalar(1-b.drag*dt*0.5);
        b.pos[j*3]+=v.x*dt; b.pos[j*3+1]+=v.y*dt; b.pos[j*3+2]+=v.z*dt; }
      b.pts.geometry.attributes.position.needsUpdate=true; b.pts.material.opacity=1-clamp(b.age/b.life,0,1);
      if(b.age>=b.life){ scene.remove(b.pts); b.pts.geometry.dispose(); b.pts.material.dispose(); bursts.splice(i,1); } }
    for(let i=meteors.length-1;i>=0;i--){ const m=meteors[i]; m.t+=dt; if(m.t<0) continue; m.m.visible=true;
      const q=clamp(m.t/m.dur,0,1); m.m.position.lerpVectors(m.from,m.to,q*q); m.m.rotation.x+=dt*4;
      if(Math.random()<0.85) puff({fire:true,pos:m.m.position,vel:new T.Vector3(0,0.5,0),life:0.5,s0:0.8,s1:1.4,color:0xffd060,color1:0xff4a10});
      if(Math.random()<0.18) puff({pos:m.m.position,vel:new T.Vector3(0,0.6,0),life:0.9,s0:0.25,s1:0.7,color:0x9a8a80,color1:0x5a5048,rise:0.3});
      if(q>=1){ burst({pos:m.to.clone().setY(0.5),n:50,colors:[0xff6a1a,0xffd06a,0x5a4a44],speed:7,upBias:1.6,size:0.45,life:1.3,add:true});
        for(let j=0;j<4;j++) puff({pos:m.to.clone().setY(0.4),vel:new T.Vector3((Math.random()-0.5)*6,2+Math.random()*3,(Math.random()-0.5)*6),life:1.3,s0:0.4,s1:1.3,color:0xa8988a,color1:0x6a5e56});
        for(let j=0;j<3;j++) puff({fire:true,pos:m.to.clone().setY(0.4),vel:new T.Vector3((Math.random()-0.5)*4,3,(Math.random()-0.5)*4),life:0.6,s0:0.6,s1:1.5,color:0xffe080,color1:0xff4a10});
        shake=Math.max(shake,0.25); hit(0.22); scene.remove(m.m); meteors.splice(i,1); } }
    if(flood){ flood.t+=dt; const t=flood.t; flood.mesh.position.y=t<1.2?lerp(-0.5,1.1,easeOut(t/1.2)):t<2.8?1.1:lerp(1.1,-0.6,(t-2.8)/1.6);
      if(t>4.4){ scene.remove(flood.mesh); flood.mesh.geometry.dispose(); flood=null; } }
    if(tar){ tar.t+=dt; const t=tar.t; tar.mesh.scale.setScalar(t<0.8?easeOut(t/0.8)*4.5:4.5); tar.mesh.material.opacity=1;
      tar.next-=dt; if(tar.next<0 && t<2.6){ tar.next=0.12; const a=Math.random()*PI*2, r=Math.random()*3.5;
        puff({pos:tar.mesh.position.clone().add(new T.Vector3(Math.cos(a)*r,0,Math.sin(a)*r)),vel:new T.Vector3(0,0.4,0),life:0.7,s0:0.1,s1:0.35,color:0x2a2018,drag:2}); }
      if(t>2.2) sinkTarget=0;
      if(t>3.2){ tar.mesh.scale.setScalar(4.5*(1-clamp((t-3.2)/0.6,0,1))+0.001); }
      if(t>3.8){ scene.remove(tar.mesh); tar.mesh.geometry.dispose(); tar.mesh.material.dispose(); tar=null; } }
    for(let i=actors.length-1;i>=0;i--){ const a=actors[i]; animate(a,dt); if(a.dead){ disposeEntry(a); actors.splice(i,1); } }
    updatePuffs(dt);
  }

  /* ---- loop (with adaptive resolution so slower devices stay smooth) ---- */
  let running=false, last=0, raf=0, perfT=0, perfN=0, perfAcc=0;
  function frame(now){
    if(!running) return;
    raf=requestAnimationFrame(frame);
    const raw=(now-last)/1000; const dt=Math.min(0.05,raw||0.016); last=now; time+=dt;
    if(!container.getClientRects().length) return;   // hidden (e.g. 2D view or another screen) — skip rendering
    try{
      updateCamera(dt);
      const cp=camera.position;
      Object.values(models).forEach(e=>{
        if(!e.holder.visible) return;
        animate(e,dt);
        const d=Math.hypot(e.holder.position.x-cp.x,e.holder.position.z-cp.z);
        e.root.visible=d>2.6+e.height*0.3 || e.anim.mode==="fall";
        if(e.label) e.label.visible=d>5;
      });
      updateFx(dt); updateEnv(dt);
      pipe.render();
    }catch(err){ console.warn("[world3d]",err); }
    // adaptive resolution
    if(raw>0 && raw<0.5){ perfAcc+=raw; perfN++; }
    if(time-perfT>2.5 && perfN>20){ const avg=perfAcc/perfN;
      if(avg>0.034 && prScale>0.55){ prScale=Math.max(0.55,prScale-0.15); resize(); }
      else if(avg<0.019 && prScale<1){ prScale=Math.min(1,prScale+0.1); resize(); }
      perfT=time; perfN=0; perfAcc=0; }
  }
  function resize(){
    const w=container.clientWidth||window.innerWidth, h=container.clientHeight||window.innerHeight;
    let pr=prMax*prScale; const cap=Math.sqrt(4.6e6/Math.max(1,w*h)); pr=Math.max(0.5,Math.min(pr,cap));
    renderer.setPixelRatio(pr); renderer.setSize(w,h,false); cv.style.width="100%"; cv.style.height="100%";
    camera.aspect=w/Math.max(1,h); camera.updateProjectionMatrix();
    pipe.setSize(w,h,pr);
  }
  const ro=("ResizeObserver" in window)?new ResizeObserver(resize):null;
  if(ro) ro.observe(container); else window.addEventListener("resize",resize);
  resize();

  window.__efw={ groundColor, groundH, groundN, tbl, scene, camera, renderer, pipe, models, PROPS };   // debugging handle (harmless)
  return {
    sync, fx,
    setActive(on){ if(on && !running){ running=true; last=performance.now(); resize(); raf=requestAnimationFrame(frame); } else if(!on){ running=false; cancelAnimationFrame(raf); } },
    resize,
    reset(){ actors.forEach(disposeEntry); actors.length=0; bursts.forEach(b=>scene.remove(b.pts)); bursts.length=0; puffList.length=0;
      lastActive=null; tint.amt=0; sinkTarget=0; frost=0; haze=0; impact=0; comicsEl.innerHTML=""; },
  };
}

window.EFWorld={ create };
})();
