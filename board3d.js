import * as THREE from 'three';
import { OrbitControls } from './vendor/three/OrbitControls.js';

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
  ctx.beginPath(); ctx.arc(cx,cy,r,Math.PI,0); ctx.fillStyle='#f5484f'; ctx.fill();
  ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI); ctx.fillStyle='#f6fbff'; ctx.fill();
  ctx.fillStyle='#173a5c'; ctx.fillRect(cx-r,cy-r*0.09,r*2,r*0.18);
  ctx.beginPath(); ctx.arc(cx,cy,r*0.36,0,Math.PI*2); ctx.fillStyle='#f6fbff'; ctx.fill();
  ctx.lineWidth=r*0.14; ctx.strokeStyle='#173a5c'; ctx.stroke();
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
  const size = 256;
  const cvs = document.createElement('canvas'); cvs.width=cvs.height=size;
  const ctx = cvs.getContext('2d');
  const [top,bot] = TILE_GRADIENTS[cat];
  const r = size*0.16;
  ctx.save();
  ctx.beginPath(); ctx.roundRect(6,6,size-12,size-12,r); ctx.clip();
  const grad = ctx.createLinearGradient(0,0,size,size);
  grad.addColorStop(0,top); grad.addColorStop(1,bot);
  ctx.fillStyle = grad; ctx.fillRect(0,0,size,size);
  const gloss = ctx.createRadialGradient(size*0.32,size*0.26,4,size*0.32,size*0.26,size*0.6);
  gloss.addColorStop(0,'rgba(255,255,255,.55)');
  gloss.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle = gloss; ctx.fillRect(0,0,size,size);
  ctx.restore();
  ctx.beginPath(); ctx.roundRect(6,6,size-12,size-12,r);
  ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(255,255,255,.65)'; ctx.stroke();

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
  new THREE.MeshStandardMaterial({map:makePokeballFieldTexture(),roughness:.4,metalness:.1})
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

  const faceMat = new THREE.MeshStandardMaterial({map:getFaceTexture(cat,kind,isStart),roughness:.35,metalness:.08});
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

  const skin = new THREE.MeshStandardMaterial({color:0xf0b98a,roughness:.6});
  const jacket = new THREE.MeshStandardMaterial({color:0x2f7de0,roughness:.5,metalness:.08});
  const jeans = new THREE.MeshStandardMaterial({color:0x35528a,roughness:.65});
  const cap = new THREE.MeshStandardMaterial({color:0xe0333f,roughness:.5});
  const dark = new THREE.MeshStandardMaterial({color:0x14202f,roughness:.6});
  const bag = new THREE.MeshStandardMaterial({color:0xc23b3b,roughness:.55});

  function limb(mat,r,len){
    const g = new THREE.Group();
    const geo = new THREE.CapsuleGeometry(r,len,4,8);
    const mesh = new THREE.Mesh(geo,mat);
    mesh.position.y = -len/2 - r;
    mesh.castShadow = true;
    g.add(mesh);
    return g;
  }

  const hipY = 0.34;
  const legL = limb(jeans,0.055,0.22); legL.position.set(-0.09,hipY,0); root.add(legL);
  const legR = limb(jeans,0.055,0.22); legR.position.set(0.09,hipY,0); root.add(legR);

  const shoulderY = 0.56;
  const armL = limb(jacket,0.045,0.2); armL.position.set(-0.16,shoulderY,0); root.add(armL);
  const armR = limb(jacket,0.045,0.2); armR.position.set(0.16,shoulderY,0); root.add(armR);

  const torso = new THREE.Group();
  torso.position.y = hipY;
  root.add(torso);
  const torsoMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.13,0.22,4,10), jacket);
  torsoMesh.position.y = 0.24;
  torsoMesh.castShadow = true;
  torso.add(torsoMesh);

  const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.15,0.19,0.1), bag);
  backpack.position.set(0,0.24,-0.14);
  backpack.castShadow = true;
  torso.add(backpack);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.135,20,16), skin);
  head.position.y = 0.52;
  head.castShadow = true;
  torso.add(head);

  const capMesh = new THREE.Mesh(new THREE.SphereGeometry(0.145,20,16,0,Math.PI*2,0,Math.PI*0.55), cap);
  capMesh.position.y = 0.565;
  capMesh.castShadow = true;
  torso.add(capMesh);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.1,0.1,0.02,16), cap);
  brim.position.set(0,0.535,0.09);
  torso.add(brim);

  const eyeGeo = new THREE.SphereGeometry(0.014,8,8);
  const eyeMat = new THREE.MeshBasicMaterial({color:0x18304f});
  const eyeL = new THREE.Mesh(eyeGeo,eyeMat); eyeL.position.set(-0.045,0.52,0.125); torso.add(eyeL);
  const eyeR = new THREE.Mesh(eyeGeo,eyeMat); eyeR.position.set(0.045,0.52,0.125); torso.add(eyeR);

  [legL,legR].forEach(g=>{
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.09,0.05,0.13), dark);
    s.position.set(0,-0.24,0.02);
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
let hopState = null;

function easeInOutQuad(x){ return x<0.5 ? 2*x*x : 1-Math.pow(-2*x+2,2)/2; }

function startHop(fromIdx,toIdx,duration){
  const a = tiles[fromIdx].world, b = tiles[toIdx].world;
  const yaw = Math.atan2(b.x-a.x, b.z-a.z);
  hopState = { fromIdx, toIdx, t0: clock.getElapsedTime(), duration, yaw };
}

function animate(){
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.getElapsedTime();

  controls.update();

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

  // saut du pion
  if(hopState){
    const dur = hopState.duration;
    let p = (t - hopState.t0) / dur;
    if(p >= 1){
      p = 1;
      const toTile = tiles[hopState.toIdx];
      player.root.position.set(toTile.world.x, toTile.tileTopY, toTile.world.z);
      player.root.scale.set(1.08,0.85,1.08);
      hopState.landT0 = t;
      hopState.done = true;
    } else {
      const a = tiles[hopState.fromIdx].world, b = tiles[hopState.toIdx].world;
      const e = easeInOutQuad(p);
      const x = a.x + (b.x-a.x)*e;
      const z = a.z + (b.z-a.z)*e;
      const hopH = Math.sin(p*Math.PI) * (reduceMotion?0.02:0.32);
      player.root.position.set(x, tiles[hopState.fromIdx].tileTopY + hopH, z);
      let dyaw = hopState.yaw - player.root.rotation.y;
      dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      player.root.rotation.y += dyaw*Math.min(1,dt*12);

      if(!reduceMotion){
        const swing = Math.sin(p*Math.PI*2)*0.55;
        player.legL.rotation.x = swing;
        player.legR.rotation.x = -swing;
        player.armL.rotation.x = -swing;
        player.armR.rotation.x = swing;
        player.torso.position.y = 0.34 + Math.abs(Math.sin(p*Math.PI*2))*0.02;
      }
    }
  }
  if(hopState && hopState.done){
    const landP = Math.min((t-hopState.landT0)/0.15, 1);
    const s = 0.85 + (1-0.85)*landP;
    const sx = 1.08 + (1-1.08)*landP;
    player.root.scale.set(sx,s,sx);
    if(!reduceMotion){
      player.legL.rotation.x *= (1-landP);
      player.legR.rotation.x *= (1-landP);
      player.armL.rotation.x *= (1-landP);
      player.armR.rotation.x *= (1-landP);
    } else {
      player.legL.rotation.x = player.legR.rotation.x = player.armL.rotation.x = player.armR.rotation.x = 0;
    }
    if(landP>=1){ hopState = null; }
  }

  renderer.render(scene,camera);
}
animate();

/* ---------- Redimensionnement ---------- */
function resize(){
  const w = wrap.clientWidth, h = wrap.clientHeight;
  if(w===0||h===0) return;
  renderer.setSize(w,h,false);
  camera.aspect = w/h;
  camera.updateProjectionMatrix();
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
const HOP_DURATION = 0.42;

async function move(){
  if(moving) return;
  moving = true;
  const myGen = ++generation;
  validate.disabled = minus.disabled = plus.disabled = true;
  statusEl.textContent = 'Le joueur avance de '+selected+' case'+(selected>1?'s':'')+'…';

  for(let n=0;n<selected;n++){
    if(myGen!==generation) return;
    const from = currentIndex;
    currentIndex = (currentIndex+1)%40;
    setActive(currentIndex);
    startHop(from,currentIndex,HOP_DURATION);
    await wait(HOP_DURATION*1000 + 60);
  }

  if(myGen!==generation) return;
  statusEl.textContent = currentIndex===0 ? 'Le joueur est arrivé sur Départ !' : 'Le joueur est arrivé sur la case '+currentIndex+' !';
  moving = false;
  validate.disabled = minus.disabled = plus.disabled = false;
}

function restart(){
  generation++;
  moving = false;
  hopState = null;
  currentIndex = 0;
  player.root.scale.set(1,1,1);
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
