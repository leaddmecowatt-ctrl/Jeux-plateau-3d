import * as THREE from 'three';
import { OrbitControls } from './vendor/three/OrbitControls.js';

/* =========================================================================
   Plateau de jeu en vraie 3D (WebGL / three.js) — 40 cases en anneau,
   pion articulé qui saute case par case, props flottants animés
   (étoile, cadeaux, pièces...) pour un plateau vivant et réaliste,
   lumières + ombres portées, et une caméra orbitale pour explorer la scène.
   ========================================================================= */

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Disposition des 40 cases sur l'anneau 11x11 (identique à
   la logique d'origine : coins tous les 10 cases) ---------- */
function ringPos(i){
  if(i===0) return {r:11,c:11};
  if(i<=10) return {r:11,c:11-i};
  if(i<=20) return {r:21-i,c:1};
  if(i<=30) return {r:1,c:i-19};
  return {r:i-29,c:11};
}
const CELL = 1;
function toWorld(r,c){ return new THREE.Vector3((c-6)*CELL, 0, (r-6)*CELL); }

const COLORS = {
  orange:0xff9455, white:0xd9edff, yellow:0xffce33, green:0x2ecb7a,
  pink:0xdf5c9a, purple:0xa85cdb, red:0xef4a58, blue:0x5c85e0
};

/* catégorie / prop dynamique par case (même cycle que l'original) */
const STYLES = [
  ['orange','star'],['white','q'],['yellow','coin'],['green','gift'],['pink','gift'],
  ['purple','q'],['white','none'],['yellow','coin'],['red','orb'],['green','gift'],
  ['purple','q'],['blue','tower']
];
function styleFor(i){ return i===0 ? ['orange','star'] : STYLES[i % STYLES.length]; }

/* ---------- Textures canvas (numéro de case, icônes plates) ---------- */
function makeLabelTexture(text, opts={}){
  const size = 128;
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = size;
  const ctx = cvs.getContext('2d');
  ctx.clearRect(0,0,size,size);
  if(opts.badge){
    ctx.beginPath();
    ctx.arc(size/2,size/2,size*0.42,0,Math.PI*2);
    ctx.fillStyle = opts.badgeColor || 'rgba(8,20,40,.72)';
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = opts.ring || 'rgba(140,225,255,.85)';
    ctx.stroke();
  }
  ctx.fillStyle = opts.color || '#ffffff';
  ctx.font = (opts.weight||900)+' '+(opts.fontSize||70)+'px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, size/2, size/2 + (opts.dy||2));
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeSprite(texture, scale){
  const mat = new THREE.SpriteMaterial({ map:texture, transparent:true, depthWrite:false });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(scale,scale,scale);
  return spr;
}

/* ---------- Props 3D dynamiques posés sur certaines cases ---------- */
function buildProp(kind){
  const group = new THREE.Group();
  group.userData.bob = 0.1;
  group.userData.spin = 0.6;
  switch(kind){
    case 'star': {
      const shape = new THREE.Shape();
      const spikes = 5, outerR = 0.22, innerR = 0.09;
      for(let k=0;k<spikes*2;k++){
        const ang = (k/(spikes*2))*Math.PI*2 - Math.PI/2;
        const r = k%2===0 ? outerR : innerR;
        const x = Math.cos(ang)*r, y = Math.sin(ang)*r;
        if(k===0) shape.moveTo(x,y); else shape.lineTo(x,y);
      }
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape,{depth:0.09,bevelEnabled:true,bevelThickness:0.02,bevelSize:0.02,bevelSegments:2});
      geo.rotateX(Math.PI/2);
      geo.center();
      const mat = new THREE.MeshStandardMaterial({color:0xffd54a,emissive:0xaa6a00,emissiveIntensity:.55,metalness:.55,roughness:.3});
      const mesh = new THREE.Mesh(geo,mat);
      mesh.castShadow = true;
      group.add(mesh);
      group.userData.bob = 0.14; group.userData.spin = 1.1;
      break;
    }
    case 'gift': {
      const bodyMat = new THREE.MeshStandardMaterial({color:0xe0455f,roughness:.55,metalness:.08});
      const lidMat = new THREE.MeshStandardMaterial({color:0xffe066,roughness:.45,metalness:.1});
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.3,0.22,0.3),bodyMat);
      body.position.y = 0.11;
      const lid = new THREE.Mesh(new THREE.BoxGeometry(0.34,0.08,0.34),lidMat);
      lid.position.y = 0.26;
      const ribbonA = new THREE.Mesh(new THREE.BoxGeometry(0.07,0.24,0.32),lidMat);
      ribbonA.position.y = 0.11;
      const ribbonB = new THREE.Mesh(new THREE.BoxGeometry(0.32,0.24,0.07),lidMat);
      ribbonB.position.y = 0.11;
      [body,lid,ribbonA,ribbonB].forEach(m=>{m.castShadow=true;group.add(m);});
      group.userData.bob = 0.09; group.userData.spin = 0.5;
      break;
    }
    case 'coin': {
      const geo = new THREE.CylinderGeometry(0.17,0.17,0.05,24);
      const mat = new THREE.MeshStandardMaterial({color:0xffd83c,metalness:.85,roughness:.22,emissive:0x664400,emissiveIntensity:.25});
      const mesh = new THREE.Mesh(geo,mat);
      mesh.rotation.x = Math.PI/2;
      mesh.castShadow = true;
      group.add(mesh);
      group.userData.bob = 0.07; group.userData.spin = 2.4;
      group.userData.spinAxis = 'y2';
      break;
    }
    case 'orb': {
      const geo = new THREE.SphereGeometry(0.16,20,16);
      const mat = new THREE.MeshStandardMaterial({color:0xff4552,emissive:0xff2233,emissiveIntensity:.7,roughness:.4});
      const mesh = new THREE.Mesh(geo,mat);
      mesh.castShadow = true;
      group.add(mesh);
      group.userData.pulse = true;
      group.userData.bob = 0.06; group.userData.spin = 0.3;
      break;
    }
    case 'tower': {
      const mat = new THREE.MeshStandardMaterial({color:0x8fb2ff,roughness:.5,metalness:.15});
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.26,0.22,0.26),mat);
      base.position.y = 0.11;
      const mid = new THREE.Mesh(new THREE.BoxGeometry(0.18,0.16,0.18),mat);
      mid.position.y = 0.28;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(0.16,0.18,4),mat);
      roof.position.y = 0.44; roof.rotation.y = Math.PI/4;
      [base,mid,roof].forEach(m=>{m.castShadow=true;group.add(m);});
      group.userData.bob = 0.04; group.userData.spin = 0.25;
      break;
    }
    case 'q': {
      const tex = makeLabelTexture('?',{color:'#fff5ff',fontSize:88});
      const spr = makeSprite(tex,0.34);
      group.add(spr);
      group.userData.bob = 0.11; group.userData.spin = 0; group.userData.isSprite = true;
      break;
    }
    default: return null;
  }
  return group;
}

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
renderer.toneMappingExposure = 1.05;

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

let userInteracting = false, idleTimer = null;
controls.addEventListener('start', ()=>{
  userInteracting = true;
  controls.autoRotate = false;
  if(hint3d) hint3d.style.opacity = '0';
  clearTimeout(idleTimer);
});
controls.addEventListener('end', ()=>{
  userInteracting = false;
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
  const spr = makeSprite(makeLabelTexture('',{}),0);
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

function makePokeballTexture(){
  const size = 512;
  const cvs = document.createElement('canvas'); cvs.width=cvs.height=size;
  const ctx = cvs.getContext('2d');
  const grad = ctx.createRadialGradient(size*0.35,size*0.32,size*0.05,size*0.5,size*0.5,size*0.62);
  grad.addColorStop(0,'#22b6e8'); grad.addColorStop(1,'#0a6fac');
  ctx.fillStyle = grad; ctx.fillRect(0,0,size,size);
  const cx=size/2, cy=size/2, r=size*0.17;
  ctx.beginPath(); ctx.arc(cx,cy,r,Math.PI,0); ctx.fillStyle='#f5484f'; ctx.fill();
  ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI); ctx.fillStyle='#f6fbff'; ctx.fill();
  ctx.fillStyle='#173a5c'; ctx.fillRect(cx-r,cy-size*0.017,r*2,size*0.034);
  ctx.beginPath(); ctx.arc(cx,cy,r*0.34,0,Math.PI*2); ctx.fillStyle='#f6fbff'; ctx.fill();
  ctx.lineWidth = size*0.02; ctx.strokeStyle='#173a5c'; ctx.stroke();
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const centerPlate = new THREE.Mesh(
  new THREE.BoxGeometry(9*CELL,0.14,9*CELL),
  new THREE.MeshStandardMaterial({map:makePokeballTexture(),roughness:.4,metalness:.1})
);
centerPlate.position.y = 0.07;
centerPlate.receiveShadow = true;
boardGroup.add(centerPlate);

/* ---------- Les 40 cases ---------- */
const TILE = 0.9;
const tiles = []; // {group, world, top, category, halo, prop, num, base}

for(let i=0;i<40;i++){
  const {r,c} = ringPos(i);
  const world = toWorld(r,c);
  const [cat, kind] = styleFor(i);

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

  const topMat = new THREE.MeshStandardMaterial({color:COLORS[cat],roughness:.45,metalness:.12});
  const topTile = new THREE.Mesh(new THREE.BoxGeometry(TILE,0.16,TILE), topMat);
  topTile.position.y = 0.16;
  topTile.castShadow = true;
  topTile.receiveShadow = true;
  group.add(topTile);
  const tileTopY = 0.24;

  const numTex = makeLabelTexture(i===0?'D':String(i), {fontSize:i===0?60:56, color:'#eaf6ff', badge:false});
  const numSpr = makeSprite(numTex, 0.26);
  numSpr.position.set(TILE*0.32, tileTopY+0.01, TILE*0.32);
  numSpr.rotation.x = -Math.PI/2;
  numSpr.material.rotation = 0;
  group.add(numSpr);

  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(TILE*0.52,0.035,8,32),
    new THREE.MeshBasicMaterial({color:0xffe873,transparent:true,opacity:0,blending:THREE.AdditiveBlending})
  );
  halo.rotation.x = Math.PI/2;
  halo.position.y = tileTopY+0.03;
  group.add(halo);

  let prop = null, shadowDisc = null;
  if(kind && kind!=='none'){
    prop = buildProp(kind);
    if(prop){
      prop.position.y = tileTopY + 0.24;
      group.add(prop);
      shadowDisc = new THREE.Mesh(
        new THREE.CircleGeometry(0.2,20),
        new THREE.MeshBasicMaterial({color:0x000000,transparent:true,opacity:.28})
      );
      shadowDisc.rotation.x = -Math.PI/2;
      shadowDisc.position.y = tileTopY+0.005;
      group.add(shadowDisc);
    }
  }

  tiles.push({
    group, world, tileTopY, category:cat, kind,
    halo, prop, shadowDisc,
    phase: Math.random()*Math.PI*2,
    breathePhase: ((r+c)%8)*0.4
  });
}

/* ---------- Pion articulé (façon dresseur) ---------- */
function buildToken(){
  const root = new THREE.Group();

  const skin = new THREE.MeshStandardMaterial({color:0xf0b98a,roughness:.6});
  const jacket = new THREE.MeshStandardMaterial({color:0x2f7de0,roughness:.5,metalness:.08});
  const pants = new THREE.MeshStandardMaterial({color:0x27354a,roughness:.6});
  const cap = new THREE.MeshStandardMaterial({color:0xe0333f,roughness:.5});
  const dark = new THREE.MeshStandardMaterial({color:0x14202f,roughness:.6});

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
  const legL = limb(pants,0.055,0.22); legL.position.set(-0.09,hipY,0); root.add(legL);
  const legR = limb(pants,0.055,0.22); legR.position.set(0.09,hipY,0); root.add(legR);

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

  const shoes = [legL,legR].map(g=>{
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.09,0.05,0.13), dark);
    s.position.set(0,-0.24,0.02);
    g.add(s);
    return s;
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
let hopState = null; // {from,to,start,duration,fromY,toY}

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

  // respiration + props dynamiques
  tiles.forEach(tile=>{
    if(!reduceMotion){
      const breathe = 1 + Math.sin(t*1.9 + tile.breathePhase)*0.012;
      tile.group.scale.set(1,breathe,1);
    }
    if(tile.prop){
      const ud = tile.prop.userData;
      const bobAmt = reduceMotion ? 0 : ud.bob;
      const bob = Math.sin(t*2 + tile.phase)*bobAmt;
      tile.prop.position.y = tile.tileTopY + 0.24 + bob;
      if(!reduceMotion && ud.spin){
        tile.prop.rotation.y += dt*ud.spin;
      }
      if(ud.pulse && !ud.isSprite){
        const mesh = tile.prop.children[0];
        if(mesh && mesh.material) mesh.material.emissiveIntensity = 0.5 + Math.sin(t*4+tile.phase)*0.35;
      }
      if(tile.shadowDisc){
        const k = 1 - Math.min(Math.abs(bob)/ (ud.bob||1), 1)*0.55;
        tile.shadowDisc.scale.set(k,k,k);
        tile.shadowDisc.material.opacity = 0.28*k;
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
   Interface Animateur (logique de jeu, identique dans l'esprit à l'original)
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
