/* Extinction Fighters — "ink" rendering kit for the 3D view.
   Cel-shaded materials plus a hand-built post-process that turns the render
   into an animated-film frame:
     • ink outlines from depth + normal edges (thin in the distance, like painted backgrounds)
     • Spider-Verse print tricks: halftone dots and hatching in the shadows, colour
       misregistration on out-of-focus distance, grain that "boils" at 12 fps
     • anime impact frames, speed lines, bloom on lava / glowing runes
   Render layers:  0 = inked world · 2 = colour only (sky, grass, particles) · 3 = HUD overlay (labels, icons).
   Requires THREE r149 (window.THREE). Exposes window.EFInk. */
(function(){
"use strict";
const T = window.THREE;
if(!T) return;

/* uniforms shared by every toon material (updated once per frame by the world) */
const SH = {
  rimColor:   { value: new T.Color(0xfff0c8) },
  rimStrength:{ value: 0.6 },
  time:       { value: 0 },
  wind:       { value: 1 },
};

/* 4-texel light ramp: shadow side stays flat, a crisp terminator, then a highlight band */
function ramp(vals){
  const data = new Uint8Array(vals.length*4);
  vals.forEach((v,i)=>{ const c=Math.round(v*255); data[i*4]=c; data[i*4+1]=c; data[i*4+2]=c; data[i*4+3]=255; });
  const t = new T.DataTexture(data, vals.length, 1, T.RGBAFormat);
  t.minFilter = t.magFilter = T.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return t;
}
const RAMP = ramp([0.3, 0.36, 0.84, 1.0]);

const NOISE_GLSL = `
float efHash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float efNoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(efHash(i),efHash(i+vec2(1.0,0.0)),u.x), mix(efHash(i+vec2(0.0,1.0)),efHash(i+vec2(1.0,1.0)),u.x), u.y); }
float efFbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<4;i++){ s+=a*efNoise(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return s; }
`;

/* One patch for all toon materials; features switch on via material.defines:
   EF_RIM (strength) · EF_PAINT (posterised painterly noise, for terrain) · EF_SWAY (wind, colour-only layer) */
function patchToon(sh){
  sh.uniforms.uRimColor = SH.rimColor; sh.uniforms.uRimStrength = SH.rimStrength;
  sh.uniforms.uTime = SH.time; sh.uniforms.uWind = SH.wind;
  sh.vertexShader = sh.vertexShader
    .replace("#include <common>", "#include <common>\nuniform float uTime; uniform float uWind; varying vec3 vEfW;")
    .replace("#include <begin_vertex>", `#include <begin_vertex>
#ifdef EF_SWAY
{ vec2 ip = modelMatrix[3].xz;
  #ifdef USE_INSTANCING
    ip += instanceMatrix[3].xz;
  #endif
  float h = max(position.y, 0.0);
  float s = sin(uTime*1.7 + ip.x*0.21 + ip.y*0.17) + 0.5*sin(uTime*2.9 + ip.x*0.53);
  transformed.x += s*h*h*EF_SWAY*uWind;
  transformed.z += 0.6*cos(uTime*1.3 + ip.y*0.23)*h*h*EF_SWAY*uWind; }
#endif`)
    .replace("#include <project_vertex>", `#include <project_vertex>
{ vec4 efw = vec4(transformed,1.0);
  #ifdef USE_INSTANCING
    efw = instanceMatrix*efw;
  #endif
  vEfW = (modelMatrix*efw).xyz; }`);
  sh.fragmentShader = sh.fragmentShader
    .replace("#include <common>", "#include <common>\nuniform vec3 uRimColor; uniform float uRimStrength; uniform float uTime; varying vec3 vEfW;\n"+NOISE_GLSL)
    .replace("#include <color_fragment>", `#include <color_fragment>
#ifdef EF_PAINT
{ float pn = efNoise(vEfW.xz*0.13)*0.5 + efNoise(vEfW.xz*0.55+3.1)*0.32 + efNoise(vEfW.xz*2.1+7.7)*0.18;
  pn = floor(pn*5.0+0.5)/5.0;
  diffuseColor.rgb *= 0.83 + 0.32*pn; }
#endif`)
    .replace("#include <output_fragment>", `
#ifdef EF_RIM
{ float rf = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
  outgoingLight += uRimColor * smoothstep(0.56, 0.64, rf) * uRimStrength * EF_RIM * (0.35 + 0.65*diffuseColor.rgb); }
#endif
#include <output_fragment>`);
}

function toon(o){
  o = o || {};
  const m = new T.MeshToonMaterial({
    color: o.color!==undefined ? o.color : 0xffffff, gradientMap: RAMP, vertexColors: !!o.vertexColors,
    transparent: !!o.transparent, opacity: o.opacity==null ? 1 : o.opacity, side: o.side || T.FrontSide,
    emissive: o.emissive || 0x000000, emissiveIntensity: o.emissiveIntensity==null ? 1 : o.emissiveIntensity,
    fog: o.fog!==false, depthWrite: o.depthWrite!==false,
  });
  m.defines = {};
  if(o.rim!==false && !o.paint) m.defines.EF_RIM = (o.rim||1).toFixed(3);
  if(o.paint) m.defines.EF_PAINT = "";
  if(o.sway) m.defines.EF_SWAY = o.sway.toFixed(4);
  m.onBeforeCompile = patchToon;
  m.customProgramCacheKey = () => "efToon";
  return m;
}

/* ------------------------------------------------------------ post-process */
const VS = "varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }";

const BRIGHT_FS = `
uniform sampler2D tColor; uniform vec2 texel; varying vec2 vUv;
void main(){
  vec3 c = texture2D(tColor, vUv+texel*vec2(-1.0,-1.0)).rgb + texture2D(tColor, vUv+texel*vec2(1.0,-1.0)).rgb
         + texture2D(tColor, vUv+texel*vec2(-1.0,1.0)).rgb + texture2D(tColor, vUv+texel*vec2(1.0,1.0)).rgb;
  c *= 0.25;
  float mx = max(c.r,max(c.g,c.b)), mn = min(c.r,min(c.g,c.b));
  float w = smoothstep(0.7,0.97,mx) * smoothstep(0.22,0.55,mx-mn);   // only bright *saturated* things glow (lava, runes), not snow
  gl_FragColor = vec4(c*w, 1.0);
}`;

const BLUR_FS = `
uniform sampler2D tInput; uniform vec2 dir; varying vec2 vUv;
void main(){
  vec3 c = texture2D(tInput,vUv).rgb*0.227;
  c += (texture2D(tInput,vUv+dir*1.384).rgb + texture2D(tInput,vUv-dir*1.384).rgb)*0.316;
  c += (texture2D(tInput,vUv+dir*3.230).rgb + texture2D(tInput,vUv-dir*3.230).rgb)*0.070;
  gl_FragColor = vec4(c,1.0);
}`;

const COMP_FS = `
uniform sampler2D tColor; uniform sampler2D tNormal; uniform sampler2D tDepth; uniform sampler2D tBloom;
uniform vec2 res; uniform float px; uniform float near; uniform float far; uniform float time;
uniform float impact; uniform float speed; uniform float haze; uniform float halftone; uniform float bloom;
uniform float lineFar; uniform float frost; uniform float fx;
uniform vec3 inkCol; uniform vec3 shadeTint; uniform vec3 hiTint; uniform vec3 impactCol;
varying vec2 vUv;
float h21(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
float lin(vec2 uv){ float z=texture2D(tDepth,uv).x; float n=z*2.0-1.0; return 2.0*near*far/(far+near-n*(far-near)); }
vec3 nrm(vec2 uv){ return texture2D(tNormal,uv).xyz*2.0-1.0; }
void main(){
  vec2 uv = vUv;
  if(haze>0.001){ uv.x += sin(uv.y*70.0+time*7.0)*0.0022*haze; uv.y += cos(uv.x*55.0+time*5.0)*0.0014*haze; }
  vec2 tp = 1.0/res;
  vec2 toC = uv-0.5;
  float rad = length(toC*vec2(res.x/res.y,1.0));
  float d0 = lin(uv);

  // colour misregistration: grows with distance ("print" defocus) and on impacts
  float ca = (smoothstep(50.0,190.0,d0)*1.7 + impact*7.0 + speed*2.2)*px*fx;
  vec3 col;
  col.r = texture2D(tColor, uv+vec2(ca,0.0)*tp).r;
  col.g = texture2D(tColor, uv).g;
  col.b = texture2D(tColor, uv-vec2(ca,-0.45*ca)*tp).b;

  // ink: laplacian of inverse depth (zero on flat ground) + normal creases
  vec2 o = tp*max(1.0,px);
  float dl=lin(uv-vec2(o.x,0.0)), dr=lin(uv+vec2(o.x,0.0)), dd=lin(uv-vec2(0.0,o.y)), du=lin(uv+vec2(0.0,o.y));
  float w0 = 1.0/d0;
  float lap = (abs(1.0/dl+1.0/dr-2.0*w0) + abs(1.0/dd+1.0/du-2.0*w0))/w0;
  float eD = smoothstep(0.05,0.16,lap);
  vec3 n0 = nrm(uv);
  float nd = 1.0-dot(n0,nrm(uv-vec2(o.x,0.0)));
  nd = max(nd, 1.0-dot(n0,nrm(uv+vec2(o.x,0.0))));
  nd = max(nd, 1.0-dot(n0,nrm(uv-vec2(0.0,o.y))));
  nd = max(nd, 1.0-dot(n0,nrm(uv+vec2(0.0,o.y))));
  float eN = smoothstep(0.24,0.5,nd);
  float edge = max(eD,eN) * (1.0 - 0.9*smoothstep(lineFar*0.4, lineFar, d0));

  col += texture2D(tBloom, vUv).rgb*bloom;

  // grade: a little extra saturation, cool shadows, warm highlights
  float l = dot(col, vec3(0.299,0.587,0.114));
  col = mix(vec3(l), col, 1.14);
  col = mix(col*shadeTint, col, smoothstep(0.04,0.58,l));
  col = mix(col, col*hiTint, smoothstep(0.62,1.0,l)*0.55);
  col = (col-0.5)*1.05+0.5;

  // halftone print dots + hatching in the shadows
  vec2 fc = gl_FragCoord.xy;
  float cell = 4.6*px;
  vec2 q = mat2(0.7071,0.7071,-0.7071,0.7071)*fc/cell;
  vec2 f = fract(q)-0.5;
  float r = sqrt(clamp(1.0-l/0.44,0.0,1.0))*0.6;
  float aa = 1.2/cell;
  float dotm = 1.0-smoothstep(r-aa, r+aa, length(f));
  col *= 1.0 - dotm*0.3*halftone;
  float hatch = step(0.62, fract((fc.x-fc.y)/(5.0*px))) * (1.0-smoothstep(0.07,0.17,l));
  col *= 1.0 - hatch*0.28*halftone;

  // coloured ink (a dark, slightly purple line that picks up the colour underneath)
  col = mix(col, mix(inkCol, col*0.28, 0.25), clamp(edge,0.0,1.0));

  // frost creeping in from the edges (cold snap)
  if(frost>0.001){ float fr = smoothstep(0.35,1.05,rad + (h21(floor(fc/(3.0*px)))-0.5)*0.12);
    col = mix(col, vec3(0.86,0.95,1.0), fr*frost*0.8); }

  // anime speed lines & impact frames
  float sl = (speed*0.55 + impact)*fx;
  if(sl>0.01){
    float ang = atan(toC.y,toC.x);
    float k = floor(ang*46.0/3.14159);
    float ray = step(0.78, h21(vec2(k, floor(time*18.0))));
    col = mix(col, vec3(1.0), ray*smoothstep(0.34,0.9,rad)*clamp(sl,0.0,1.0)*0.6);
  }
  if(impact*fx>0.01){
    float li = dot(col, vec3(0.299,0.587,0.114));
    vec3 pst = li>0.5 ? vec3(1.0,0.97,0.9) : (li>0.2 ? impactCol : vec3(0.03,0.01,0.04));
    col = mix(col, pst, smoothstep(0.5,0.9,impact*fx));
  }

  // vignette + paper grain that re-rolls 12x a second, like hand-drawn frames
  col *= 1.0 - smoothstep(0.6,1.15,rad)*0.38;
  float g = h21(floor(fc/(1.6*px)) + floor(time*12.0)*vec2(3.17,7.31)) - 0.5;
  col += g*0.032;
  gl_FragColor = vec4(clamp(col,0.0,1.0), 1.0);
}`;

function Pipeline(renderer, scene, camera, opts){
  opts = opts || {};
  const gl2 = renderer.capabilities.isWebGL2;
  const rtColor = new T.WebGLRenderTarget(4,4,{ samples: gl2 ? (opts.samples||4) : 0 });
  const depthTex = new T.DepthTexture(4,4); depthTex.type = T.UnsignedIntType;
  const rtNorm = new T.WebGLRenderTarget(4,4,{ depthTexture: depthTex, minFilter: T.NearestFilter, magFilter: T.NearestFilter });
  const rtB1 = new T.WebGLRenderTarget(4,4), rtB2 = new T.WebGLRenderTarget(4,4);
  const normalMat = new T.MeshNormalMaterial();

  const quadCam = new T.OrthographicCamera(-1,1,1,-1,0,1);
  const tri = new T.BufferGeometry();
  tri.setAttribute("position", new T.Float32BufferAttribute([-1,-1,0, 3,-1,0, -1,3,0],3));
  tri.setAttribute("uv", new T.Float32BufferAttribute([0,0, 2,0, 0,2],2));
  const quad = new T.Mesh(tri); quad.frustumCulled = false;
  const qs = new T.Scene(); qs.add(quad);
  const mk = (fs,u)=>new T.ShaderMaterial({ uniforms:u, vertexShader:VS, fragmentShader:fs, depthTest:false, depthWrite:false });
  const bright = mk(BRIGHT_FS, { tColor:{value:null}, texel:{value:new T.Vector2()} });
  const blur = mk(BLUR_FS, { tInput:{value:null}, dir:{value:new T.Vector2()} });
  const U = {
    tColor:{value:rtColor.texture}, tNormal:{value:rtNorm.texture}, tDepth:{value:depthTex}, tBloom:{value:rtB1.texture},
    res:{value:new T.Vector2(4,4)}, px:{value:1}, near:{value:camera.near}, far:{value:camera.far}, time:{value:0},
    impact:{value:0}, speed:{value:0}, haze:{value:0}, halftone:{value:1}, bloom:{value:0.9}, lineFar:{value:140},
    frost:{value:0}, fx:{value:1},
    inkCol:{value:new T.Color(0x1a1024)}, shadeTint:{value:new T.Color(0.82,0.86,1.08)}, hiTint:{value:new T.Color(1.06,1.02,0.94)},
    impactCol:{value:new T.Color(0xe8264f)},
  };
  const comp = mk(COMP_FS, U);
  let W=4, H=4, bw=1, bh=1;

  function setSize(w,h,pr){
    W = Math.max(1, Math.floor(w*pr)); H = Math.max(1, Math.floor(h*pr));
    rtColor.setSize(W,H); rtNorm.setSize(W,H);
    bw = Math.max(1, W>>2); bh = Math.max(1, H>>2);
    rtB1.setSize(bw,bh); rtB2.setSize(bw,bh);
    U.res.value.set(W,H); U.px.value = Math.max(1, H/820);
  }
  const clear = new T.Color();
  function render(){
    renderer.getClearColor(clear); const clearA = renderer.getClearAlpha();
    // 1) colour: inked world + colour-only layer (shadow map refreshed once per frame, here)
    camera.layers.set(0); camera.layers.enable(2);
    renderer.shadowMap.needsUpdate = true;
    renderer.setRenderTarget(rtColor); renderer.clear(); renderer.render(scene,camera);
    // 2) normals + depth of the inked layer only
    camera.layers.set(0);
    scene.overrideMaterial = normalMat;
    renderer.setClearColor(0x7f7fff,1); renderer.setRenderTarget(rtNorm); renderer.clear(); renderer.render(scene,camera);
    scene.overrideMaterial = null; renderer.setClearColor(clear,clearA);
    // 3) bloom at quarter resolution
    quad.material = bright; bright.uniforms.tColor.value = rtColor.texture; bright.uniforms.texel.value.set(1/W,1/H);
    renderer.setRenderTarget(rtB1); renderer.render(qs,quadCam);
    quad.material = blur; blur.uniforms.tInput.value = rtB1.texture; blur.uniforms.dir.value.set(1.6/bw,0);
    renderer.setRenderTarget(rtB2); renderer.render(qs,quadCam);
    blur.uniforms.tInput.value = rtB2.texture; blur.uniforms.dir.value.set(0,1.6/bh);
    renderer.setRenderTarget(rtB1); renderer.render(qs,quadCam);
    // 4) composite to the screen
    U.near.value = camera.near; U.far.value = camera.far;
    quad.material = comp; renderer.setRenderTarget(null); renderer.render(qs,quadCam);
    // 5) HUD overlay (labels, icons) drawn crisp on top, untouched by the ink pass
    camera.layers.set(3);
    const ac = renderer.autoClear; renderer.autoClear = false;
    renderer.render(scene,camera);
    renderer.autoClear = ac;
    camera.layers.set(0); camera.layers.enable(2);
  }
  return { U, setSize, render };
}

/* put an object (and its children) on one render layer */
function layer(obj, n){ obj.traverse(o=>o.layers.set(n)); return obj; }

window.EFInk = { SH, RAMP, toon, Pipeline, layer, NOISE_GLSL };
})();
