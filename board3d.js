import * as THREE from 'three';
import { OrbitControls } from './vendor/three/OrbitControls.js';
import { EffectComposer } from './vendor/three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/three/examples/jsm/postprocessing/OutputPass.js';

/* =========================================================================
   Plateau de jeu en vraie 3D (WebGL / three.js) — 40 cases en anneau,
   pion articulé qui saute case par case, icônes de case fidèles au
   modèle de référence (❓ 💰 🎁 🏢 ⭐) qui flottent au-dessus de chaque
   case pour un plateau vivant, lumières + ombres portées, et une caméra
   orbitale pour explorer la scène.
   ========================================================================= */

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Disposition des 40 cases sur l'anneau 11x11 (coins tous
   les 10 cases, comme un plateau façon Monopoly) ---------- */
function ringPos(i){
  if(i===0) return {r:11,c:11};
  if(i<=10) return {r:11,c:11-i};
  if(i<=20) return {r:21-i,c:1};
  if(i<=30) return {r:1,c:i-19};
  return {r:i-29,c:11};
}
const CELL = 1;
function toWorld(r,c){ return new THREE.Vector3((c-6)*CELL, 0, (r-6)*CELL); }

/* dégradés (haut/bas) par catégorie, façon tuile glacée/glossy */
const TILE_GRADIENTS = {
  orange:['#ffc27a','#f2793a'],
  white: ['#e7f3ff','#a9c3d6'],
  yellow:['#ffe36b','#f2a71b'],
  green: ['#7be89a','#1f9d55'],
  pink:  ['#f6a0cf','#d6488f'],
  purple:['#cf9ff5','#8a3fd1'],
  red:   ['#ff8a8a','#e63946'],
  blue:  ['#9ec2ff','#3f6fd1']
};

/* catégorie / icône par case (même cycle que le modèle d'origine) */
const STYLES = [
  ['orange','star'],['white','q'],['yellow','coin'],['green','gift'],['pink','gift'],
  ['purple','q'],['white','none'],['yellow','coin'],['red','minus'],['green','gift'],
  ['purple','q'],['blue','tower']
];
function styleFor(i){ return i===0 ? ['orange','star'] : STYLES[i % STYLES.length]; }

/* ---------- Dessin des icônes (canvas -> texture) ---------- */
function drawStar(ctx,cx,cy,outerR,innerR,color,glow){
  ctx.save();
  if(glow){ ctx.shadowColor = glow; ctx.shadowBlur = outerR*0.6; }
  ctx.beginPath();
  const spikes=5;
  for(let k=0;k<spikes*2;k++){
    const ang=(k/(spikes*2))*Math.PI*2 - Math.PI/2;
    const r = k%2===0 ? outerR : innerR;
    const x=cx+Math.cos(ang)*r, y=cy+Math.sin(ang)*r;
    if(k===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.closePath();
  ctx.fillStyle=color;
  ctx.fill();
  ctx.restore();
}
function drawCoin(ctx,cx,cy,r){
  const grad = ctx.createRadialGradient(cx-r*0.3,cy-r*0.35,r*0.15,cx,cy,r);
  grad.addColorStop(0,'#fff5c2'); grad.addColorStop(.55,'#ffd83c'); grad.addColorStop(1,'#c9860e');
  ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fillStyle=grad; ctx.fill();
  ctx.lineWidth=r*0.14; ctx.strokeStyle='#8a5a06'; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx,cy,r*0.62,0,Math.PI*2);
  ctx.lineWidth=r*0.06; ctx.strokeStyle='rgba(255,255,255,.6)'; ctx.stroke();
}
function drawPokeball(ctx,cx,cy,r){
  ctx.save();
  // ombre douce sous la sphère
  const shadow = ctx.createRadialGradient(cx,cy+r*0.1,r*0.4,cx,cy+r*0.1,r*1.15);
  shadow.addColorStop(0,'rgba(0,0,0,.35)'); shadow.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle = shadow; ctx.beginPath(); ctx.arc(cx,cy,r*1.15,0,Math.PI*2); ctx.fill();

  const topGrad = ctx.createRadialGradient(cx-r*0.3,cy-r*0.55,r*0.1,cx,cy,r*1.05);
  topGrad.addColorStop(0,'#ff7b80'); topGrad.addColorStop(.55,'#f5484f'); topGrad.addColorStop(1,'#c22b34');
  ctx.beginPath(); ctx.arc(cx,cy,r,Math.PI,0); ctx.fillStyle=topGrad; ctx.fill();

  const botGrad = ctx.createRadialGradient(cx-r*0.3,cy+r*0.15,r*0.1,cx,cy,r*1.05);
  botGrad.addColorStop(0,'#ffffff'); botGrad.addColorStop(.6,'#f6fbff'); botGrad.addColorStop(1,'#c7d6e2');
  ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI); ctx.fillStyle=botGrad; ctx.fill();

  ctx.fillStyle='#152c46'; ctx.fillRect(cx-r,cy-r*0.1,r*2,r*0.2);
  ctx.lineWidth=r*0.05; ctx.strokeStyle='#0c1a2b';
  ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.stroke();

  const btnGrad = ctx.createRadialGradient(cx-r*0.12,cy-r*0.12,r*0.05,cx,cy,r*0.4);
  btnGrad.addColorStop(0,'#ffffff'); btnGrad.addColorStop(.7,'#eef6fb'); btnGrad.addColorStop(1,'#c7d6e2');
  ctx.beginPath(); ctx.arc(cx,cy,r*0.4,0,Math.PI*2); ctx.fillStyle=btnGrad; ctx.fill();
  ctx.lineWidth=r*0.09; ctx.strokeStyle='#152c46'; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx,cy,r*0.24,0,Math.PI*2); ctx.fillStyle='rgba(255,255,255,.9)'; ctx.fill();
  ctx.lineWidth=r*0.045; ctx.strokeStyle='#8fa6b8'; ctx.stroke();

  // reflet de brillance
  ctx.beginPath();
  ctx.ellipse(cx-r*0.42,cy-r*0.5,r*0.28,r*0.16,-0.5,0,Math.PI*2);
  ctx.fillStyle='rgba(255,255,255,.55)'; ctx.fill();
  ctx.restore();
}

/* icône "plate" (texte/emoji/dessin) rendue au centre d'un canvas carré */
function drawGlyph(ctx,size,kind){
  const cx=size/2, cy=size/2;
  ctx.textAlign='center'; ctx.textBaseline='middle';
  switch(kind){
    case 'star': drawStar(ctx,cx,cy,size*0.34,size*0.14,'#ffe066','#c98a00'); break;
    case 'q':
      ctx.font='900 '+(size*0.62)+'px Arial,Helvetica,sans-serif';
      ctx.fillStyle='#ffffff';
      ctx.fillText('?',cx,cy+size*0.02);
      break;
    case 'coin': drawCoin(ctx,cx,cy,size*0.34); break;
    case 'minus':
      ctx.fillStyle='#ffffff';
      ctx.fillRect(cx-size*0.22,cy-size*0.05,size*0.44,size*0.1);
      break;
    case 'gift':
      ctx.font=(size*0.56)+'px "Segoe UI Emoji","Apple Color Emoji",Arial,sans-serif';
      ctx.fillText('🎁',cx,cy+size*0.03);
      break;
    case 'tower':
      ctx.font=(size*0.5)+'px "Segoe UI Emoji","Apple Color Emoji",Arial,sans-serif';
      ctx.fillText('🏢',cx,cy+size*0.03);
      break;
    case 'pokeball': drawPokeball(ctx,cx,cy,size*0.34); break;
  }
}

/* Texture de la face de case : tuile arrondie "glossy" façon jeu mobile,
   dégradé diagonal + reflet + icône + petit numéro dans le coin. */
const faceTextureCache = new Map();
function getFaceTexture(cat, kind, isStart){
  const key = cat+'|'+kind+'|'+(isStart?'S':'');
  if(faceTextureCache.has(key)) return faceTextureCache.get(key);
  const size = 384;
  const cvs = document.createElement('canvas'); cvs.width=cvs.height=size;
  const ctx = cvs.getContext('2d');
  const [top,bot] = TILE_GRADIENTS[cat];
  const r = size*0.16;
  ctx.save();
  ctx.beginPath(); ctx.roundRect(9,9,size-18,size-18,r); ctx.clip();
  const grad = ctx.createLinearGradient(0,0,size,size);
  grad.addColorStop(0,top); grad.addColorStop(1,bot);
  ctx.fillStyle = grad; ctx.fillRect(0,0,size,size);
  const gloss = ctx.createRadialGradient(size*0.32,size*0.24,4,size*0.32,size*0.24,size*0.62);
  gloss.addColorStop(0,'rgba(255,255,255,.6)');
  gloss.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle = gloss; ctx.fillRect(0,0,size,size);
  const innerShadow = ctx.createRadialGradient(size*0.5,size*0.5,size*0.3,size*0.5,size*0.5,size*0.52);
  innerShadow.addColorStop(0,'rgba(0,0,0,0)'); innerShadow.addColorStop(1,'rgba(0,0,0,.18)');
  ctx.fillStyle = innerShadow; ctx.fillRect(0,0,size,size);
  ctx.restore();
  ctx.beginPath(); ctx.roundRect(9,9,size-18,size-18,r);
  ctx.lineWidth = 9; ctx.strokeStyle = 'rgba(255,255,255,.68)'; ctx.stroke();

  if(kind && kind!=='none'){ drawGlyph(ctx,size, isStart ? 'star' : kind); }

  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  faceTextureCache.set(key,tex);
  return tex;
}

/* Icône flottante transparente (même dessin, sans fond) pour l'effet
   "case dynamique" : elle plane et tourne au-dessus de la case. */
const iconSpriteCache = new Map();
function getFloatingIconTexture(kind, isStart){
  const key = isStart ? 'star' : kind;
  if(iconSpriteCache.has(key)) return iconSpriteCache.get(key);
  const size = 160;
  const cvs = document.createElement('canvas'); cvs.width=cvs.height=size;
  const ctx = cvs.getContext('2d');
  drawGlyph(ctx,size, isStart ? 'star' : kind);
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  iconSpriteCache.set(key,tex);
  return tex;
}

function makeSprite(texture, scale){
  const mat = new THREE.SpriteMaterial({ map:texture, transparent:true, depthWrite:false });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(scale,scale,scale);
  return spr;
}

function numberTexture(n){
  const size=128;
  const cvs=document.createElement('canvas'); cvs.width=cvs.height=size;
  const ctx=cvs.getContext('2d');
  ctx.font='800 '+(size*0.5)+'px Arial'; ctx.fillStyle='rgba(10,25,45,.55)';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(String(n), size/2, size/2+2);
  const tex=new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* vitesses/amplitudes d'animation "dynamique" par type de case */
const MOTION = {
  star:  {bob:0.16, spin:1.3},
  gift:  {bob:0.10, spin:0.5},
  coin:  {bob:0.08, spin:2.6},
  minus: {bob:0.05, spin:0,  pulse:true},
  tower: {bob:0.05, spin:0.3},
  q:     {bob:0.12, spin:0},
  none:  {bob:0,    spin:0}
};

/* ---------- Construction de la scène ---------- */
const wrap = document.getElementById('boardWrap');
const canvas = document.getElementById('gl');
const hint3d = document.getElementById('hint3d');

let renderer;
try{
  renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:true, powerPreference:'high-performance' });
}catch(e){
  const fb = document.createElement('div');
  fb.className = 'gl-fallback';
  fb.textContent = "Impossible d'afficher le plateau 3D (WebGL indisponible sur cet appareil).";
  wrap.appendChild(fb);
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const scene = new THREE.Scene();

/* fond "studio" façon plateau télé/casino : dégradé profond avec une
   lueur douce au centre-haut, plutôt qu'un canvas transparent — ça
   permet aussi d'ajouter un vrai effet de brillance (bloom) sans que
   le fond ne devienne noir. */
function makeStudioBackdrop(){
  const w=512,h=512;
  const cvs=document.createElement('canvas'); cvs.width=w; cvs.height=h;
  const ctx=cvs.getContext('2d');
  const grad = ctx.createRadialGradient(w*0.5,h*0.22,10,w*0.5,h*0.55,h*0.95);
  grad.addColorStop(0,'#154a82');
  grad.addColorStop(0.4,'#0b2c58');
  grad.addColorStop(0.75,'#051733');
  grad.addColorStop(1,'#020714');
  ctx.fillStyle=grad; ctx.fillRect(0,0,w,h);
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
scene.background = makeStudioBackdrop();

const camera = new THREE.PerspectiveCamera(40,1,0.1,100);
camera.position.set(0,17,14);
scene.add(camera);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0,0.3,0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 14;
controls.maxDistance = 26;
controls.minPolarAngle = 0.35;
controls.maxPolarAngle = 1.15;
controls.enablePan = false;
controls.autoRotate = !reduceMotion;
controls.autoRotateSpeed = 0.55;
controls.update();

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(1,1), 0.45, 0.55, 0.8);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

let idleTimer = null;
controls.addEventListener('start', ()=>{
  controls.autoRotate = false;
  if(hint3d) hint3d.style.opacity = '0';
  clearTimeout(idleTimer);
});
controls.addEventListener('end', ()=>{
  clearTimeout(idleTimer);
  idleTimer = setTimeout(()=>{ if(!reduceMotion) controls.autoRotate = true; }, 3500);
});
if(hint3d){ setTimeout(()=>{ hint3d.style.opacity = '0'; }, 5000); }

/* ---------- Lumières : ambiance stade nocturne ---------- */
scene.add(new THREE.HemisphereLight(0x8fd0ff, 0x081226, 0.65));

const key = new THREE.DirectionalLight(0xfff2df, 1.35);
key.position.set(4.2,7,3.4);
key.castShadow = true;
key.shadow.mapSize.set(1024,1024);
key.shadow.camera.left = -7; key.shadow.camera.right = 7;
key.shadow.camera.top = 7; key.shadow.camera.bottom = -7;
key.shadow.camera.near = 1; key.shadow.camera.far = 20;
key.shadow.bias = -0.0025;
scene.add(key);

const rim = new THREE.DirectionalLight(0x4fc9ff, 0.55);
rim.position.set(-5,4,-4);
scene.add(rim);

/* projecteurs de stade (halos additifs aux quatre coins, comme sur la
   photo de référence) */
function addFloodlight(x,z){
  const glowTex = (function(){
    const c = document.createElement('canvas'); c.width=c.height=128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64,64,0,64,64,64);
    grad.addColorStop(0,'rgba(255,255,255,.9)');
    grad.addColorStop(0.4,'rgba(180,225,255,.45)');
    grad.addColorStop(1,'rgba(180,225,255,0)');
    g.fillStyle = grad; g.fillRect(0,0,128,128);
    return new THREE.CanvasTexture(c);
  })();
  const mat = new THREE.SpriteMaterial({map:glowTex,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending});
  const glow = new THREE.Sprite(mat);
  glow.position.set(x,4.6,z);
  glow.scale.set(2.6,2.6,2.6);
  scene.add(glow);
  const pl = new THREE.PointLight(0xcfe9ff, 0.5, 12, 2);
  pl.position.set(x,4.2,z);
  scene.add(pl);
}
[[7.5,7.5],[-7.5,7.5],[7.5,-7.5],[-7.5,-7.5]].forEach(([x,z])=>addFloodlight(x,z));

/* ---------- Plinthe + plateau central ---------- */
const boardGroup = new THREE.Group();
scene.add(boardGroup);

const plinthMat = new THREE.MeshStandardMaterial({color:0x0a2a52,emissive:0x0c3d6b,emissiveIntensity:.35,roughness:.55,metalness:.2});
const plinth = new THREE.Mesh(new THREE.BoxGeometry(11*CELL+0.7,0.5,11*CELL+0.7), plinthMat);
plinth.position.y = -0.25;
plinth.receiveShadow = true;
plinth.castShadow = true;
boardGroup.add(plinth);

const rimGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(11*CELL+0.7,0.5,11*CELL+0.7));
const rimLine = new THREE.LineSegments(rimGeo, new THREE.LineBasicMaterial({color:0x7fe9ff}));
rimLine.position.copy(plinth.position);
boardGroup.add(rimLine);

/* liseré de loupiotes façon plateau de jeu télévisé/casino, qui
   "chassent" tout autour du bord du plateau */
function makeGlowDotTexture(colorCss){
  const c=document.createElement('canvas'); c.width=c.height=64;
  const g=c.getContext('2d');
  const grad=g.createRadialGradient(32,32,0,32,32,32);
  grad.addColorStop(0,colorCss);
  grad.addColorStop(1,'rgba(0,0,0,0)');
  g.fillStyle=grad; g.fillRect(0,0,64,64);
  return new THREE.CanvasTexture(c);
}
const goldDotTex = makeGlowDotTexture('rgba(255,214,120,1)');
const cyanDotTex = makeGlowDotTexture('rgba(140,225,255,1)');
const trimLights = [];
{
  const half = (11*CELL+0.7)/2;
  const perEdge = 13;
  const pts = [];
  for(let i=0;i<perEdge;i++){ pts.push([-half+(i/(perEdge-1))*half*2, -half]); }
  for(let i=1;i<perEdge;i++){ pts.push([half, -half+(i/(perEdge-1))*half*2]); }
  for(let i=1;i<perEdge;i++){ pts.push([half-(i/(perEdge-1))*half*2, half]); }
  for(let i=1;i<perEdge-1;i++){ pts.push([-half, half-(i/(perEdge-1))*half*2]); }
  pts.forEach(([x,z],idx)=>{
    const mat = new THREE.SpriteMaterial({
      map: idx%2===0 ? goldDotTex : cyanDotTex,
      transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, opacity:.6
    });
    const spr = new THREE.Sprite(mat);
    spr.scale.set(0.26,0.26,0.26);
    spr.position.set(x,0.03,z);
    boardGroup.add(spr);
    trimLights.push({ spr, idx });
  });
}

function makePokeballFieldTexture(){
  const size = 512;
  const cvs = document.createElement('canvas'); cvs.width=cvs.height=size;
  const ctx = cvs.getContext('2d');
  const grad = ctx.createRadialGradient(size*0.35,size*0.32,size*0.05,size*0.5,size*0.5,size*0.62);
  grad.addColorStop(0,'#22b6e8'); grad.addColorStop(1,'#0a6fac');
  ctx.fillStyle = grad; ctx.fillRect(0,0,size,size);
  drawPokeball(ctx,size/2,size/2,size*0.17);
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const centerPlate = new THREE.Mesh(
  new THREE.BoxGeometry(9*CELL,0.14,9*CELL),
  new THREE.MeshPhysicalMaterial({map:makePokeballFieldTexture(),roughness:.28,metalness:.05,clearcoat:.9,clearcoatRoughness:.18})
);
centerPlate.position.y = 0.07;
centerPlate.receiveShadow = true;
boardGroup.add(centerPlate);

/* ---------- Les 40 cases ---------- */
const TILE = 0.9;
const tiles = [];

for(let i=0;i<40;i++){
  const {r,c} = ringPos(i);
  const world = toWorld(r,c);
  const [cat, kind] = styleFor(i);
  const isStart = i===0;

  const group = new THREE.Group();
  group.position.copy(world);
  boardGroup.add(group);

  const baseTile = new THREE.Mesh(
    new THREE.BoxGeometry(TILE+0.05,0.08,TILE+0.05),
    new THREE.MeshStandardMaterial({color:0x0b2242,roughness:.7})
  );
  baseTile.position.y = 0.04;
  baseTile.receiveShadow = true;
  group.add(baseTile);

  const sideMat = new THREE.MeshStandardMaterial({color:new THREE.Color(TILE_GRADIENTS[cat][1]),roughness:.55,metalness:.1});
  const bodyTile = new THREE.Mesh(new THREE.BoxGeometry(TILE,0.14,TILE), sideMat);
  bodyTile.position.y = 0.15;
  bodyTile.castShadow = true;
  bodyTile.receiveShadow = true;
  group.add(bodyTile);
  const tileTopY = 0.22;

  const faceMat = new THREE.MeshPhysicalMaterial({map:getFaceTexture(cat,kind,isStart),roughness:.32,metalness:.06,clearcoat:.7,clearcoatRoughness:.25});
  const face = new THREE.Mesh(new THREE.PlaneGeometry(TILE*0.94,TILE*0.94), faceMat);
  face.rotation.x = -Math.PI/2;
  face.position.y = tileTopY+0.002;
  face.receiveShadow = true;
  group.add(face);

  const numSpr = makeSprite(numberTexture(isStart?'D':i), 0.22);
  numSpr.position.set(TILE*0.35, tileTopY+0.01, TILE*0.36);
  numSpr.rotation.x = -Math.PI/2;
  group.add(numSpr);

  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(TILE*0.56,0.035,8,32),
    new THREE.MeshBasicMaterial({color:0xffe873,transparent:true,opacity:0,blending:THREE.AdditiveBlending})
  );
  halo.rotation.x = Math.PI/2;
  halo.position.y = tileTopY+0.03;
  group.add(halo);

  const motionKind = isStart ? 'star' : kind;
  const motion = MOTION[motionKind] || MOTION.none;
  let iconSprite = null, shadowDisc = null;
  if(motionKind !== 'none'){
    iconSprite = makeSprite(getFloatingIconTexture(kind,isStart), 0.34);
    iconSprite.position.y = tileTopY + 0.3;
    group.add(iconSprite);
    shadowDisc = new THREE.Mesh(
      new THREE.CircleGeometry(0.22,20),
      new THREE.MeshBasicMaterial({color:0x000000,transparent:true,opacity:.25})
    );
    shadowDisc.rotation.x = -Math.PI/2;
    shadowDisc.position.y = tileTopY+0.005;
    group.add(shadowDisc);
  }

  tiles.push({
    group, world, tileTopY, category:cat, kind:motionKind,
    halo, iconSprite, shadowDisc, motion,
    phase: Math.random()*Math.PI*2,
    breathePhase: ((r+c)%8)*0.4
  });
}

/* ---------- Pion articulé (façon dresseur, sac à dos inclus) ---------- */
function buildToken(){
  const root = new THREE.Group();

  const skin = new THREE.MeshPhysicalMaterial({color:0xf3c39c,roughness:.55,clearcoat:.3,clearcoatRoughness:.4});
  const jacket = new THREE.MeshPhysicalMaterial({color:0x2a5fc4,roughness:.45,metalness:.05,clearcoat:.4,clearcoatRoughness:.3});
  const jacketLight = new THREE.MeshPhysicalMaterial({color:0xf3f7fb,roughness:.5,clearcoat:.3});
  const jeans = new THREE.MeshStandardMaterial({color:0x3f63a8,roughness:.7});
  const cap = new THREE.MeshPhysicalMaterial({color:0xe23b3f,roughness:.4,clearcoat:.5,clearcoatRoughness:.3});
  const capDark = new THREE.MeshStandardMaterial({color:0xb32a2e,roughness:.5});
  const hair = new THREE.MeshStandardMaterial({color:0x3b2a1e,roughness:.6});
  const shoe = new THREE.MeshStandardMaterial({color:0x6b4226,roughness:.6});
  const bag = new THREE.MeshStandardMaterial({color:0xb23a3a,roughness:.55});
  const strap = new THREE.MeshStandardMaterial({color:0x5a2020,roughness:.6});

  function limb(mat,r,len){
    const g = new THREE.Group();
    const geo = new THREE.CapsuleGeometry(r,len,4,10);
    const mesh = new THREE.Mesh(geo,mat);
    mesh.position.y = -len/2 - r;
    mesh.castShadow = true;
    g.add(mesh);
    return g;
  }

  const hipY = 0.3;
  const legL = limb(jeans,0.06,0.2); legL.position.set(-0.085,hipY,0); root.add(legL);
  const legR = limb(jeans,0.06,0.2); legR.position.set(0.085,hipY,0); root.add(legR);

  const shoulderY = 0.53;
  const armL = limb(jacket,0.05,0.19); armL.position.set(-0.165,shoulderY,0); root.add(armL);
  const armR = limb(jacket,0.05,0.19); armR.position.set(0.165,shoulderY,0); root.add(armR);

  const torso = new THREE.Group();
  torso.position.y = hipY;
  root.add(torso);
  const torsoMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.145,0.19,4,12), jacket);
  torsoMesh.position.y = 0.23;
  torsoMesh.castShadow = true;
  torso.add(torsoMesh);

  const chestPanel = new THREE.Mesh(new THREE.SphereGeometry(0.1,16,12,0,Math.PI*2,0,Math.PI*0.5), jacketLight);
  chestPanel.rotation.x = Math.PI;
  chestPanel.position.set(0,0.29,0.1);
  chestPanel.scale.set(1,1,0.6);
  torso.add(chestPanel);

  const strapL = new THREE.Mesh(new THREE.BoxGeometry(0.035,0.24,0.03), strap);
  strapL.position.set(-0.07,0.28,0.09); strapL.rotation.z = 0.18;
  torso.add(strapL);
  const strapR = new THREE.Mesh(new THREE.BoxGeometry(0.035,0.24,0.03), strap);
  strapR.position.set(0.07,0.28,0.09); strapR.rotation.z = -0.18;
  torso.add(strapR);

  const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.17,0.2,0.12), bag);
  backpack.position.set(0,0.25,-0.15);
  backpack.castShadow = true;
  torso.add(backpack);
  const backpackFlap = new THREE.Mesh(new THREE.BoxGeometry(0.13,0.09,0.03), strap);
  backpackFlap.position.set(0,0.31,-0.09);
  torso.add(backpackFlap);

  const headGroup = new THREE.Group();
  headGroup.position.y = 0.5;
  torso.add(headGroup);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.155,24,20), skin);
  head.castShadow = true;
  headGroup.add(head);

  [-1,1].forEach(side=>{
    const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.05,10,8), hair);
    tuft.position.set(side*0.135,0.01,0.03);
    tuft.scale.set(0.7,1,1);
    headGroup.add(tuft);
  });
  const fringe = new THREE.Mesh(new THREE.SphereGeometry(0.09,16,10,0,Math.PI*2,0,Math.PI*0.4), hair);
  fringe.position.set(0,0.09,0.07);
  fringe.rotation.x = Math.PI*0.05;
  headGroup.add(fringe);

  const capMesh = new THREE.Mesh(new THREE.SphereGeometry(0.168,22,16,0,Math.PI*2,0,Math.PI*0.56), cap);
  capMesh.position.y = 0.045;
  capMesh.castShadow = true;
  headGroup.add(capMesh);
  const capBand = new THREE.Mesh(new THREE.TorusGeometry(0.147,0.014,8,20,Math.PI),capDark);
  capBand.position.y = 0.02; capBand.rotation.x = Math.PI/2; capBand.rotation.z = Math.PI;
  headGroup.add(capBand);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.11,0.115,0.018,20,1,false,0,Math.PI), cap);
  brim.position.set(0,0,0.1);
  brim.rotation.x = -0.08;
  headGroup.add(brim);
  const buttonTop = new THREE.Mesh(new THREE.SphereGeometry(0.018,8,8), capDark);
  buttonTop.position.set(0,0.165,0);
  headGroup.add(buttonTop);

  const eyeGeo = new THREE.SphereGeometry(0.016,8,8);
  const eyeMat = new THREE.MeshBasicMaterial({color:0x18304f});
  const eyeL = new THREE.Mesh(eyeGeo,eyeMat); eyeL.position.set(-0.05,0,0.145); headGroup.add(eyeL);
  const eyeR = new THREE.Mesh(eyeGeo,eyeMat); eyeR.position.set(0.05,0,0.145); headGroup.add(eyeR);
  const blushGeo = new THREE.CircleGeometry(0.018,10);
  const blushMat = new THREE.MeshBasicMaterial({color:0xff9a8a,transparent:true,opacity:.55});
  const blushL = new THREE.Mesh(blushGeo,blushMat); blushL.position.set(-0.09,-0.03,0.125); blushL.rotation.y=-0.6; headGroup.add(blushL);
  const blushR = new THREE.Mesh(blushGeo,blushMat); blushR.position.set(0.09,-0.03,0.125); blushR.rotation.y=0.6; headGroup.add(blushR);

  [legL,legR].forEach(g=>{
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.095,0.06,0.15), shoe);
    s.position.set(0,-0.22,0.025);
    s.castShadow = true;
    g.add(s);
  });

  return { root, legL, legR, armL, armR, torso };
}

const player = buildToken();
scene.add(player.root);

/* ---------- État de jeu ---------- */
let currentIndex = 0;
let selected = 1;
let moving = false;
let generation = 0;

function setActive(index){
  tiles.forEach((t,i)=>{ t.isActive = (i===index); if(!t.isActive){ t.halo.material.opacity = 0; } });
}
setActive(0);

function placeTokenInstant(index){
  const t = tiles[index];
  player.root.position.set(t.world.x, t.tileTopY, t.world.z);
}
placeTokenInstant(0);

/* ---------- Boucle d'animation ---------- */
const clock = new THREE.Clock();

/* Marche continue : un seul mouvement fluide du départ jusqu'à la
   case finale, sans jamais s'arrêter aux cases intermédiaires. La
   vitesse suit un profil trapézoïdal (accélération, croisière,
   décélération sur tout le trajet) et le cycle de marche est calé sur
   la distance parcourue, donc parfaitement continu même dans les
   virages du plateau. */
let walk = null;

function startWalk(fromIdx, count, stepDuration){
  const path = [fromIdx];
  let idx = fromIdx;
  for(let i=0;i<count;i++){ idx=(idx+1)%40; path.push(idx); }
  const vCruise = 1/stepDuration;
  const rampUnits = Math.min(0.5, count/2);
  const accelTime = rampUnits>0 ? (2*rampUnits)/vCruise : 0;
  const cruiseUnits = count - 2*rampUnits;
  const cruiseTime = cruiseUnits/vCruise;
  walk = {
    path, steps:count, vCruise, rampUnits, accelTime, cruiseTime,
    totalTime: accelTime*2+cruiseTime,
    t0: clock.getElapsedTime(), lastSeg:-1
  };
  return walk;
}

function animate(){
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.getElapsedTime();

  controls.update();

  trimLights.forEach(tl=>{
    tl.spr.material.opacity = reduceMotion ? 0.6 : 0.32 + 0.55*Math.max(0, Math.sin(t*2.2 - tl.idx*0.5));
  });

  // respiration + icônes dynamiques
  tiles.forEach(tile=>{
    if(!reduceMotion){
      const breathe = 1 + Math.sin(t*1.9 + tile.breathePhase)*0.012;
      tile.group.scale.set(1,breathe,1);
    }
    if(tile.iconSprite){
      const m = tile.motion;
      const bobAmt = reduceMotion ? 0 : m.bob;
      const bob = Math.sin(t*2 + tile.phase)*bobAmt;
      tile.iconSprite.position.y = tile.tileTopY + 0.3 + bob;
      if(!reduceMotion && m.spin){
        const s = 1 + Math.sin(t*m.spin*2 + tile.phase)*0.18;
        tile.iconSprite.scale.set(0.34*s,0.34*s,0.34*s);
      }
      if(m.pulse){
        tile.iconSprite.material.opacity = 0.75 + Math.sin(t*4+tile.phase)*0.25;
      }
      if(tile.shadowDisc){
        const k = 1 - Math.min(Math.abs(bob)/ (m.bob||1), 1)*0.55;
        tile.shadowDisc.scale.set(k,k,k);
        tile.shadowDisc.material.opacity = 0.25*k;
      }
    }
    if(tile.isActive){
      tile.halo.material.opacity = reduceMotion ? 0.55 : 0.4 + Math.sin(t*5)*0.25;
      tile.halo.rotation.z += dt*0.6;
    }
  });

  // marche continue du pion sur tout le trajet demandé
  if(walk){
    const te = t - walk.t0;
    let dist, vel;
    if(te >= walk.totalTime){
      dist = walk.steps; vel = 0; walk.done = true;
    } else if(walk.accelTime>0 && te < walk.accelTime){
      vel = walk.vCruise*(te/walk.accelTime);
      dist = 0.5*walk.vCruise*te*te/walk.accelTime;
    } else if(te < walk.accelTime+walk.cruiseTime){
      vel = walk.vCruise;
      dist = walk.rampUnits + walk.vCruise*(te-walk.accelTime);
    } else {
      const te2 = Math.max(0, walk.totalTime - te);
      vel = walk.accelTime>0 ? walk.vCruise*(te2/walk.accelTime) : 0;
      dist = walk.steps - 0.5*walk.vCruise*te2*te2/walk.accelTime;
    }
    dist = Math.max(0, Math.min(walk.steps, dist));
    const segIdx = Math.min(Math.floor(dist), walk.steps-1);
    const localP = dist - segIdx;
    const aTile = tiles[walk.path[segIdx]], bTile = tiles[walk.path[segIdx+1]];
    const x = aTile.world.x + (bTile.world.x-aTile.world.x)*localP;
    const z = aTile.world.z + (bTile.world.z-aTile.world.z)*localP;
    const gaitAmp = walk.vCruise>0 ? vel/walk.vCruise : 0;
    const bob = reduceMotion ? 0 : Math.abs(Math.sin(dist*Math.PI*2))*0.028*gaitAmp;
    player.root.position.set(x, aTile.tileTopY + bob, z);

    const targetYaw = Math.atan2(bTile.world.x-aTile.world.x, bTile.world.z-aTile.world.z);
    let dyaw = targetYaw - player.root.rotation.y;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    player.root.rotation.y += dyaw*Math.min(1,dt*16);

    if(segIdx !== walk.lastSeg){
      walk.lastSeg = segIdx;
      currentIndex = walk.path[segIdx];
      setActive(currentIndex);
    }

    if(!reduceMotion){
      const swing = Math.sin(dist*Math.PI*2)*0.5*gaitAmp;
      player.legL.rotation.x = swing;
      player.legR.rotation.x = -swing;
      player.armL.rotation.x = -swing;
      player.armR.rotation.x = swing;
      player.torso.position.y = 0.3 + Math.abs(Math.sin(dist*Math.PI*2))*0.016*gaitAmp;
      const leanTarget = -0.09*gaitAmp;
      player.root.rotation.x += (leanTarget - player.root.rotation.x)*Math.min(1,dt*10);
      player.torso.rotation.z = Math.sin(dist*Math.PI*2 + Math.PI/2)*0.05*gaitAmp;
    }

    if(walk.done){
      currentIndex = walk.path[walk.steps];
      setActive(currentIndex);
      walk = null;
    }
  } else if(!reduceMotion){
    // au repos : tout revient doucement en position neutre
    player.legL.rotation.x *= 0.8; player.legR.rotation.x *= 0.8;
    player.armL.rotation.x *= 0.8; player.armR.rotation.x *= 0.8;
    player.torso.position.y += (0.3 - player.torso.position.y)*0.2;
    player.root.rotation.x *= 0.8;
    player.torso.rotation.z *= 0.8;
  }

  composer.render();
}
animate();

/* ---------- Redimensionnement ---------- */
function resize(){
  const w = wrap.clientWidth, h = wrap.clientHeight;
  if(w===0||h===0) return;
  renderer.setSize(w,h,false);
  camera.aspect = w/h;
  camera.updateProjectionMatrix();
  composer.setSize(w,h);
  bloomPass.setSize(w,h);
}
window.addEventListener('resize',resize,{passive:true});
window.addEventListener('orientationchange',()=>setTimeout(resize,150),{passive:true});
if(window.ResizeObserver){ new ResizeObserver(resize).observe(wrap); }
resize();

/* ==========================================================================
   Interface Animateur
   ========================================================================== */
const minus = document.getElementById('minus');
const plus = document.getElementById('plus');
const validate = document.getElementById('validate');
const resetBtn = document.getElementById('reset');
const sel = document.getElementById('sel');
const topNum = document.getElementById('topNum');
const statusEl = document.getElementById('status');

function setSelected(v){
  selected = v<1?12:(v>12?1:v);
  sel.textContent = selected;
  topNum.textContent = selected;
}

const wait = ms => new Promise(r=>setTimeout(r,ms));
const HOP_DURATION = 0.36;

async function move(){
  if(moving) return;
  moving = true;
  const myGen = ++generation;
  validate.disabled = minus.disabled = plus.disabled = true;
  statusEl.textContent = 'Le joueur avance de '+selected+' case'+(selected>1?'s':'')+'…';

  const w = startWalk(currentIndex, selected, HOP_DURATION);
  await wait(w.totalTime*1000 + 30);

  if(myGen!==generation) return;
  statusEl.textContent = currentIndex===0 ? 'Le joueur est arrivé sur Départ !' : 'Le joueur est arrivé sur la case '+currentIndex+' !';
  moving = false;
  validate.disabled = minus.disabled = plus.disabled = false;
}

function restart(){
  generation++;
  moving = false;
  walk = null;
  currentIndex = 0;
  player.root.scale.set(1,1,1);
  player.root.rotation.x = 0;
  player.torso.rotation.z = 0;
  player.legL.rotation.x = player.legR.rotation.x = player.armL.rotation.x = player.armR.rotation.x = 0;
  placeTokenInstant(0);
  setActive(0);
  statusEl.textContent = 'Le joueur est prêt sur Départ.';
  validate.disabled = minus.disabled = plus.disabled = false;
}

minus.addEventListener('click', ()=>setSelected(selected-1));
plus.addEventListener('click', ()=>setSelected(selected+1));
validate.addEventListener('click', move);
resetBtn.addEventListener('click', restart);
[minus,plus,validate,resetBtn].forEach(btn=>{
  btn.addEventListener('touchend', e=>{ e.preventDefault(); btn.click(); }, {passive:false});
});

setSelected(1);
