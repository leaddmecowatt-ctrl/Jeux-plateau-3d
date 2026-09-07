import * as THREE from 'three';
import { OrbitControls } from './vendor/three/OrbitControls.js';
import { EffectComposer } from './vendor/three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/three/examples/jsm/postprocessing/OutputPass.js';

/* =========================================================================
   PIKAJACKPOT — plateau 40 cases en vraie 3D (WebGL / three.js)
   Thème noir & or façon jeu télévisé / roue de la fortune, avec les
   vraies photos des lots intégrées sur les cases correspondantes, des
   lieux Pokémon mythiques à la place des noms de rues, et des
   animations de gain qui montent en intensité pour les gros lots.
   ========================================================================= */

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Écran public séparé (?view=display) : une deuxième
   fenêtre, ouverte sur le même ordinateur, qui n'affiche que le
   plateau (aucun bouton) et se synchronise en temps réel avec la
   fenêtre de contrôle via BroadcastChannel — pas besoin de serveur,
   ça marche tant que les deux fenêtres sont dans le même navigateur.
   ---------- */
const isDisplay = document.documentElement.classList.contains('display-mode');
const syncChannel = ('BroadcastChannel' in window) ? new BroadcastChannel('pikajackpot-sync') : null;
function broadcastSync(msg){ if(syncChannel && !isDisplay) syncChannel.postMessage(msg); }

/* ---------- Disposition des 40 cases sur l'anneau 11x11 (coins tous
   les 10 cases, comme un plateau façon Monopoly). tiles[0] = Case 1
   ... tiles[39] = Case 40 (jackpot final) : pas de case "Départ"
   séparée, les 40 cases sont toutes des lots réels. ---------- */
function ringPos(i){
  if(i===0) return {r:11,c:11};
  if(i<=10) return {r:11,c:11-i};
  if(i<=20) return {r:21-i,c:1};
  if(i<=30) return {r:1,c:i-19};
  return {r:i-29,c:11};
}
const CELL = 1;
function toWorld(r,c){ return new THREE.Vector3((c-6)*CELL, 0, (r-6)*CELL); }
/* Oriente chaque case pour que le "bas" de la carte (le bandeau prix)
   pointe toujours vers l'extérieur du plateau, sur les 4 côtés — pas
   seulement sur la rangée du bas (orientation par défaut). */
function outwardYaw(r,c){
  if(r===11) return 0;
  if(c===1)  return -Math.PI/2;
  if(r===1)  return Math.PI;
  return Math.PI/2; // c===11
}

/* =========================================================================
   Le plateau RICHE (q=79,6%, marge 50% sur mise moyenne de 9€) :
   40 cases, catégories confirmées avec l'utilisateur.
   ========================================================================= */
const CATS = {
  commune:     { label:'Carte commune / holo rare', value:'~0,68€',  tier:'flat',  swatch:'bronze' },
  booster8:    { label:'Booster Pokémon',            value:'8€',      tier:'flat',  swatch:'blue'   },
  alternative: { label:'Carte alternative',          value:'~7,20€',  tier:'flat',  swatch:'red'    },
  gradee:      { label:'★ Carte gradée aléatoire',   value:'20-80€',  tier:'float', swatch:'gold'   },
  booster50:   { label:'GROS BOOSTER',               value:'50€',     tier:'float', swatch:'gold'   },
  etb:         { label:'JACKPOT — ETB',               value:'150€',    tier:'float', swatch:'gold'   },
  jackpot300:  { label:'JACKPOT FINAL — carte',        value:'300€',    tier:'float', swatch:'gold'   },
  chance:      { label:'Chance',                     value:'tirage',  tier:'glyph', swatch:'purple' },
  chest:       { label:'Caisse Communautaire',       value:'tirage',  tier:'glyph', swatch:'green'  },
  prison:      { label:'ALLEZ EN PRISON',            value:'0€',      tier:'glyph', swatch:'danger' },
};

/* Pioches Chance / Caisse Communautaire (mêmes decks que le modèle
   de probabilités), tirées au sort quand le joueur appuie sur le
   bouton de révélation. */
/* Chaque carte a un "poids" : les cartes normales pèsent 4, la carte
   gradée rare ne pèse qu'1 sur un total de 25 -> 1 chance sur 25
   (4%) de tomber dessus, pour rester rarissime et ne pas casser la
   rentabilité (le q nécessaire remonte légèrement, 80,1% au lieu de
   79,6%, mais la marge reste pile à 50%, vérifié). */
const RARE_GRADEE_CARD = { text: '★ CARTE GRADÉE OFFERTE (20-80€) — TRÈS RARE ★', weight: 1, rare: true, effect:{type:'prize'} };
const CHANCE_DECK = [
  { text: 'Avancez de 3 cases', weight: 4, effect:{type:'move', delta:3} },
  { text: 'Reculez de 2 cases', weight: 4, effect:{type:'move', delta:-2} },
  { text: 'Rejouez gratuitement (relance bonus sans risque)', weight: 4, effect:{type:'replay'} },
  { text: 'Carte commune offerte (~0,68€)', weight: 4, effect:{type:'prize'} },
  { text: "Prochain «je continue» : risque réduit de moitié", weight: 4, effect:{type:'riskHalved'} },
  { text: 'Carte alternative offerte (~7,20€ en moyenne)', weight: 4, effect:{type:'prize'} },
  RARE_GRADEE_CARD,
];
const CHEST_DECK = [
  { text: 'Carte commune offerte (~0,68€)', weight: 4, effect:{type:'prize'} },
  { text: 'Rejouez gratuitement', weight: 4, effect:{type:'replay'} },
  { text: 'Avancez de 2 cases', weight: 4, effect:{type:'move', delta:2} },
  { text: 'Booster à 8€ offert', weight: 4, effect:{type:'prize'} },
  { text: 'Reculez de 1 case', weight: 4, effect:{type:'move', delta:-1} },
  { text: 'Rien de spécial', weight: 4, effect:{type:'none'} },
  RARE_GRADEE_CARD,
];
function drawCard(deck){
  const total = deck.reduce((s,c)=>s+c.weight,0);
  let r = Math.random()*total;
  for(const c of deck){ r -= c.weight; if(r<=0) return c; }
  return deck[deck.length-1];
}

/* Case 1 -> Case 40, dans l'ordre (index 0-based). */
const BOARD_DATA = [
  'booster8','alternative','chest','commune','commune','commune','commune','chance','commune','commune',
  'gradee','booster8','alternative','gradee','commune','commune','chest','commune','commune','commune',
  'commune','chance','commune','commune','commune','commune','gradee','commune','booster50','prison',
  'commune','commune','commune','commune','booster8','booster8','chance','commune','etb','jackpot300',
].map((cat,i)=>({ cat, isVisite: i===9 })); // case 10 (index 9) = "Prison, simple visite" (thématique uniquement)
// NB : cases 5 et 22 remises en commune/chance (au lieu de gradée) car
// ça cassait la rentabilité même à risque maximal (marge 20%). En
// attente d'une solution de compensation pour les réintroduire.

/* Lieux Pokémon mythiques affichés à la place des noms de rues type
   Monopoly ("vous marchez vers ..."). */
const POKEMON_PLACES = [
  'Bourg Palette','Route 1','Jadielle','Centre Pokémon','Forêt de Jade','Mont Sélénite','Argenta','Azuria',
  'Cascade d\'Azuria','Carmin-sur-Mer','Route 24','Lavanville','Tour Pokémon','Zone Safari','Céladopole',
  'Casino de Céladopole','Fuchsia','Île Écume','Parmanie','Manoir Pokémon','Île Cramoisie','Route 21',
  'Doublonville','Centrale Électrique','Ligue Pokémon','Plateau Indigo','Grotte Taupiqueur','Route 11',
  'Chenaptôme','Verdaphage','Bourg Geon','Écorcia','Rosalia','Cerisia','Blackthorn','Route 46','Grotte Sombre',
  'Antre Draco','Salle du Conseil des 4','Ligue Pokémon — Salle du Champion',
];

/* ---------- Chargement des vraies photos des lots ---------- */
const LOT_IMAGE_URLS = {
  commune:    './assets/lots/commune.jpg',
  booster8:   './assets/lots/booster8.jpg',
  alternative:'./assets/lots/alternative.jpg',
  gradee:     './assets/lots/gradee.jpg',
  booster50:  './assets/lots/booster50.jpg',
  etb:        './assets/lots/etb150.jpg',
  jackpot300: './assets/lots/jackpot300.jpg',
};
function loadImage(url){
  return new Promise((resolve)=>{
    const img = new Image();
    img.onload = ()=>resolve(img);
    img.onerror = ()=>resolve(null);
    img.src = url;
  });
}
const LOT_IMAGES = {};
await Promise.all(Object.entries(LOT_IMAGE_URLS).map(async ([k,url])=>{ LOT_IMAGES[k] = await loadImage(url); }));

/* ---------- Palette noir & or, avec accents Pokémon bleu/blanc/rouge ---------- */
const GOLD = '#e9c34a';
const GOLD_BRIGHT = '#ffe27a';
const SWATCH_COLORS = {
  bronze:'#a9793a', blue:'#2f6fdc', red:'#e0323f', purple:'#9a5fe0',
  green:'#33b46a', gold:'#e9c34a', danger:'#d62b2b',
};

function roundRectPath(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.roundRect(x,y,w,h,r);
}

/* Texture "carte plate" : la vraie photo du lot, encadrée noir & or,
   utilisée directement sur la face de la case (cartes communes,
   boosters 8€, alternatives) pour ne pas surcharger le plateau. */
let _maxAniso = 8;
function getMaxAniso(){ return renderer ? renderer.capabilities.getMaxAnisotropy() : _maxAniso; }
const flatFaceCache = new Map();
function getFlatPhotoFace(catKey, caseNum, accentColor, badge){
  const key = catKey+'|'+caseNum+'|'+badge;
  if(flatFaceCache.has(key)) return flatFaceCache.get(key);
  const size = 960;
  const cvs = document.createElement('canvas'); cvs.width=cvs.height=size;
  const ctx = cvs.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const r = size*0.16;

  ctx.save();
  roundRectPath(ctx,9,9,size-18,size-18,r); ctx.clip();
  ctx.fillStyle = '#0c0c0c'; ctx.fillRect(0,0,size,size);

  const img = LOT_IMAGES[catKey];
  if(img){
    const pad = size*0.028;
    const bw = size-2*pad, bh = size-2*pad-size*0.19;
    // "contain" fit (jamais "cover") : on voit toujours la carte/l'objet
    // en entier, jamais coupé en haut ou en bas, tout en remplissant
    // au maximum la case (zoom optimal sans rognage).
    const scale = Math.min(bw/img.width, bh/img.height);
    const iw = img.width*scale, ih = img.height*scale;
    ctx.filter = 'saturate(1.14) contrast(1.07) brightness(1.06)';
    ctx.drawImage(img, pad+(bw-iw)/2, pad+(bh-ih)/2, iw, ih);
    ctx.filter = 'none';
  }
  const gloss = ctx.createLinearGradient(0,0,0,size);
  gloss.addColorStop(0,'rgba(255,255,255,.06)'); gloss.addColorStop(.22,'rgba(255,255,255,0)');
  ctx.fillStyle = gloss; ctx.fillRect(0,0,size,size);
  ctx.restore();

  roundRectPath(ctx,9,9,size-18,size-18,r);
  ctx.lineWidth = 10; ctx.strokeStyle = GOLD; ctx.stroke();
  roundRectPath(ctx,15,15,size-30,size-30,r*0.85);
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.stroke();

  // bandeau valeur en bas
  const bandH = size*0.22;
  ctx.fillStyle = accentColor;
  roundRectPath(ctx,9,size-9-bandH,size-18,bandH,r*0.7); ctx.fill();
  ctx.fillStyle = '#0c0c0c'; ctx.globalAlpha=.28;
  roundRectPath(ctx,9,size-9-bandH,size-18,bandH,r*0.7); ctx.fill(); ctx.globalAlpha=1;
  ctx.fillStyle = '#fff9e6'; ctx.font='900 '+(size*0.1)+'px Arial,Helvetica,sans-serif';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(CATS[catKey].value, size/2, size-9-bandH/2+2);

  if(badge){
    ctx.font=(size*0.15)+'px "Segoe UI Emoji","Apple Color Emoji",Arial,sans-serif';
    ctx.textAlign='left'; ctx.textBaseline='top';
    ctx.fillText(badge, 16, 16);
  }

  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = getMaxAniso();
  flatFaceCache.set(key,tex);
  return tex;
}

/* Texture "carte flottante encadrée or" : utilisée pour les gros lots
   (gradée, gros booster, ETB, jackpot final) qui flottent au-dessus
   de leur case, avec un cadre doré plus riche et un halo. */
const framedCache = new Map();
function drawCornerMark(ctx, cx, cy, len, hDir, vDir){
  ctx.beginPath();
  ctx.moveTo(cx, cy + len*vDir);
  ctx.lineTo(cx, cy);
  ctx.lineTo(cx + len*hDir, cy);
  ctx.stroke();
}
function getFramedPhotoTexture(catKey){
  if(framedCache.has(catKey)) return framedCache.get(catKey);
  const img = LOT_IMAGES[catKey];
  const iw = img ? img.width : 3, ih = img ? img.height : 4;
  const size = 1100;
  const h = size, w = Math.round(size*(iw/ih));
  const cvs = document.createElement('canvas'); cvs.width=w; cvs.height=h;
  const ctx = cvs.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // Les cartes (gradée / jackpot final) gardent un vrai cadre "carte de
  // collection" façon slab doré ; les produits (ETB, booster) flottent
  // en photo nette avec juste des accents dorés aux coins, pour garder
  // une forme fidèle à ce qu'ils sont réellement (une boîte/un pack,
  // pas une carte) — sans contour blanc disgracieux.
  const isCardLike = (catKey === 'gradee' || catKey === 'jackpot300');
  const r = w*(isCardLike ? 0.06 : 0.09);

  if(isCardLike){
    const frameGrad = ctx.createLinearGradient(0,0,w,h);
    frameGrad.addColorStop(0,GOLD_BRIGHT); frameGrad.addColorStop(.5,GOLD); frameGrad.addColorStop(1,'#8a6a1e');
    roundRectPath(ctx,0,0,w,h,r); ctx.fillStyle=frameGrad; ctx.fill();

    const inset = w*0.045;
    ctx.save();
    roundRectPath(ctx,inset,inset,w-2*inset,h-2*inset,r*0.7); ctx.clip();
    ctx.fillStyle = '#0c0c0c'; ctx.fillRect(0,0,w,h);
    ctx.filter = 'saturate(1.12) contrast(1.06) brightness(1.05)';
    if(img) ctx.drawImage(img, inset, inset, w-2*inset, h-2*inset);
    ctx.filter = 'none';
    const vign = ctx.createRadialGradient(w/2,h*0.35,h*0.15,w/2,h/2,h*0.75);
    vign.addColorStop(0,'rgba(0,0,0,0)'); vign.addColorStop(1,'rgba(0,0,0,.12)');
    ctx.fillStyle=vign; ctx.fillRect(0,0,w,h);
    ctx.restore();

    roundRectPath(ctx,inset,inset,w-2*inset,h-2*inset,r*0.7);
    ctx.lineWidth=w*0.01; ctx.strokeStyle='rgba(255,224,140,.5)'; ctx.stroke();
  } else {
    ctx.save();
    roundRectPath(ctx,0,0,w,h,r); ctx.clip();
    ctx.fillStyle = '#0c0c0c'; ctx.fillRect(0,0,w,h);
    ctx.filter = 'saturate(1.1) contrast(1.05) brightness(1.06)';
    if(img) ctx.drawImage(img, 0, 0, w, h);
    ctx.filter = 'none';
    const vign = ctx.createRadialGradient(w/2,h*0.4,h*0.12,w/2,h/2,h*0.78);
    vign.addColorStop(0,'rgba(0,0,0,0)'); vign.addColorStop(1,'rgba(0,0,0,.18)');
    ctx.fillStyle=vign; ctx.fillRect(0,0,w,h);
    ctx.restore();

    const cornerLen = Math.min(w,h)*0.13;
    const ci = w*0.04;
    ctx.strokeStyle = GOLD_BRIGHT; ctx.lineWidth = w*0.014; ctx.lineCap='round';
    drawCornerMark(ctx, ci, ci, cornerLen, 1, 1);
    drawCornerMark(ctx, w-ci, ci, cornerLen, -1, 1);
    drawCornerMark(ctx, ci, h-ci, cornerLen, 1, -1);
    drawCornerMark(ctx, w-ci, h-ci, cornerLen, -1, -1);
  }

  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = getMaxAniso();
  const entry = { tex, aspect: w/h };
  framedCache.set(catKey, entry);
  return entry;
}

/* Icônes "glyphe" or/noir pour Chance, Caisse Communautaire, Prison */
const glyphCache = new Map();
function getGlyphTexture(kind){
  if(glyphCache.has(kind)) return glyphCache.get(kind);
  const size = 200;
  const cvs = document.createElement('canvas'); cvs.width=cvs.height=size;
  const ctx = cvs.getContext('2d');
  const cx=size/2, cy=size/2;
  ctx.textAlign='center'; ctx.textBaseline='middle';
  if(kind==='chance'){
    ctx.shadowColor = 'rgba(154,95,224,.9)'; ctx.shadowBlur = size*0.22;
    ctx.font='900 '+(size*0.62)+'px Arial,Helvetica,sans-serif';
    ctx.fillStyle = GOLD_BRIGHT;
    ctx.fillText('?',cx,cy+size*0.02);
  } else if(kind==='chest'){
    ctx.shadowColor = 'rgba(51,180,106,.9)'; ctx.shadowBlur = size*0.2;
    ctx.font=(size*0.58)+'px "Segoe UI Emoji","Apple Color Emoji",Arial,sans-serif';
    ctx.fillText('🗃️',cx,cy+size*0.03);
  } else if(kind==='prison'){
    ctx.shadowColor = 'rgba(214,43,43,.95)'; ctx.shadowBlur = size*0.28;
    ctx.font=(size*0.56)+'px "Segoe UI Emoji","Apple Color Emoji",Arial,sans-serif';
    ctx.fillText('🔒',cx,cy+size*0.03);
  } else if(kind==='visite'){
    ctx.shadowColor = 'rgba(255,255,255,.6)'; ctx.shadowBlur = size*0.12;
    ctx.font=(size*0.4)+'px "Segoe UI Emoji","Apple Color Emoji",Arial,sans-serif';
    ctx.fillText('🔓',cx,cy+size*0.03);
  }
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  glyphCache.set(kind,tex);
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
  ctx.font='800 '+(size*0.5)+'px Arial'; ctx.fillStyle=GOLD_BRIGHT;
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(String(n), size/2, size/2+2);
  const tex=new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
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
renderer.toneMappingExposure = 0.96;

const scene = new THREE.Scene();

/* fond "studio jeu télévisé" noir & or : dégradé profond avec une
   lueur dorée douce au centre-haut. */
function makeStudioBackdrop(){
  const w=1024,h=1024;
  const cvs=document.createElement('canvas'); cvs.width=w; cvs.height=h;
  const ctx=cvs.getContext('2d');
  const grad = ctx.createRadialGradient(w*0.5,h*0.22,10,w*0.5,h*0.55,h*0.95);
  grad.addColorStop(0,'#3a2e0f');
  grad.addColorStop(0.35,'#1c1608');
  grad.addColorStop(0.72,'#0a0805');
  grad.addColorStop(1,'#000000');
  ctx.fillStyle=grad; ctx.fillRect(0,0,w,h);

  /* Identité "mur de studio" PikaJackpot : grands anneaux façon
     Pokéball très estompés au centre-haut, + un mot-symbole
     "PIKAJACKPOT" répété en diagonale, discret mais reconnaissable
     — comme le fond de plateau d'une vraie émission télé. */
  ctx.save();
  ctx.translate(w*0.5, h*0.24);
  ctx.strokeStyle = 'rgba(255,226,122,.10)';
  [0.16,0.24,0.32].forEach((r,i)=>{
    ctx.lineWidth = w*(0.012-i*0.002);
    ctx.beginPath(); ctx.arc(0,0,w*r,0,Math.PI*2); ctx.stroke();
  });
  ctx.fillStyle = 'rgba(255,226,122,.14)';
  ctx.beginPath(); ctx.arc(0,0,w*0.045,0,Math.PI*2); ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.rotate(-0.34);
  ctx.font = '900 '+(w*0.052)+'px Georgia, "Times New Roman", serif';
  ctx.fillStyle = 'rgba(255,226,122,.075)';
  ctx.textAlign = 'center'; ctx.textBaseline='middle';
  for(let row=-1; row<=6; row++){
    const y = row*h*0.22 - h*0.3;
    for(let col=-1; col<=2; col++){
      const x = col*w*0.85 + (row%2===0 ? 0 : w*0.42) - w*0.1;
      ctx.fillText('★ PIKAJACKPOT ★', x, y);
    }
  }
  ctx.restore();

  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
scene.background = makeStudioBackdrop();

const camera = new THREE.PerspectiveCamera(40,1,0.1,100);
camera.position.set(0,13.5,11);
scene.add(camera);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0,0.3,0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 10.5;
controls.maxDistance = 21;
controls.minPolarAngle = 0.35;
controls.maxPolarAngle = 1.15;
controls.enablePan = false;
controls.autoRotate = !reduceMotion;
controls.autoRotateSpeed = 0.55;

/* Sur un écran portrait étroit (téléphone), le plateau carré ne
   remplit qu'une petite bande au centre si on garde le cadrage
   large par défaut (la caméra a un champ de vision vertical fixe,
   donc un cadre plus haut que large réduit surtout le champ
   horizontal et rogne les bords). On recule la caméra pour garder
   tout le plateau visible en largeur — l'effet bonus est que ça
   révèle plus de décor en haut/bas et que le plateau occupe
   presque tout l'écran au lieu de laisser de grandes bandes vides. */
{
  const aspect0 = wrap.clientWidth / wrap.clientHeight;
  if(aspect0 > 0 && aspect0 < 1){
    const factor = Math.min(1/aspect0, 2.2);
    const dir = camera.position.clone().sub(controls.target).normalize();
    const dist = camera.position.distanceTo(controls.target) * factor;
    camera.position.copy(controls.target).add(dir.multiplyScalar(dist));
    controls.minDistance *= factor;
    controls.maxDistance *= factor;
  }
}
controls.update();

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(1,1), 0.28, 0.55, 0.82);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

let idleTimer = null;
let gameStarted = false;
controls.addEventListener('start', ()=>{
  controls.autoRotate = false;
  if(hint3d) hint3d.style.opacity = '0';
  clearTimeout(idleTimer);
});
controls.addEventListener('end', ()=>{
  clearTimeout(idleTimer);
  idleTimer = setTimeout(()=>{ if(!reduceMotion && !gameStarted) controls.autoRotate = true; }, 3500);
});
if(hint3d){ setTimeout(()=>{ hint3d.style.opacity = '0'; }, 5000); }

/* ---------- Lumières : ambiance "roue de la fortune" dorée ---------- */
scene.add(new THREE.HemisphereLight(0xffdca0, 0x0a0805, 0.55));

const key = new THREE.DirectionalLight(0xfff2df, 1.05);
key.position.set(4.2,7,3.4);
key.castShadow = true;
key.shadow.mapSize.set(1024,1024);
key.shadow.camera.left = -7; key.shadow.camera.right = 7;
key.shadow.camera.top = 7; key.shadow.camera.bottom = -7;
key.shadow.camera.near = 1; key.shadow.camera.far = 20;
key.shadow.bias = -0.0025;
scene.add(key);

const rim = new THREE.DirectionalLight(0xffcf6b, 0.55);
rim.position.set(-5,4,-4);
scene.add(rim);

/* projecteurs de studio dorés aux quatre coins */
function addFloodlight(x,z){
  const glowTex = (function(){
    const c = document.createElement('canvas'); c.width=c.height=128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64,64,0,64,64,64);
    grad.addColorStop(0,'rgba(255,240,200,.9)');
    grad.addColorStop(0.4,'rgba(255,210,120,.45)');
    grad.addColorStop(1,'rgba(255,210,120,0)');
    g.fillStyle = grad; g.fillRect(0,0,128,128);
    return new THREE.CanvasTexture(c);
  })();
  const mat = new THREE.SpriteMaterial({map:glowTex,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,opacity:.6});
  const glow = new THREE.Sprite(mat);
  glow.position.set(x,4.6,z);
  glow.scale.set(1.9,1.9,1.9);
  scene.add(glow);
  const pl = new THREE.PointLight(0xffe3ae, 0.32, 12, 2);
  pl.position.set(x,4.2,z);
  scene.add(pl);
}
[[7.5,7.5],[-7.5,7.5],[7.5,-7.5],[-7.5,-7.5]].forEach(([x,z])=>addFloodlight(x,z));

/* ---------- Plinthe + plateau central ---------- */
const boardGroup = new THREE.Group();
scene.add(boardGroup);

const plinthMat = new THREE.MeshStandardMaterial({color:0x0a0a0a,emissive:0x1c1204,emissiveIntensity:.25,roughness:.65,metalness:.25});
const plinth = new THREE.Mesh(new THREE.BoxGeometry(11*CELL+0.7,0.5,11*CELL+0.7), plinthMat);
plinth.position.y = -0.25;
plinth.receiveShadow = true;
plinth.castShadow = true;
boardGroup.add(plinth);

const rimGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(11*CELL+0.7,0.5,11*CELL+0.7));
const rimLine = new THREE.LineSegments(rimGeo, new THREE.LineBasicMaterial({color:0xffd76a}));
rimLine.position.copy(plinth.position);
boardGroup.add(rimLine);

/* petit liseré tricolore (clin d'oeil Pokémon bleu/blanc/rouge) au
   pied du plinthe, discret sous le thème noir & or */
{
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(11*CELL+0.74,0.06,0.09),
    new THREE.MeshStandardMaterial({color:0xffffff, roughness:.5})
  );
  [[0x1a56db,-0.10],[0xffffff,0],[0xe0323f,0.10]].forEach(([c,dz])=>{
    const s = new THREE.Mesh(new THREE.BoxGeometry(11*CELL+0.74,0.02,0.03), new THREE.MeshStandardMaterial({color:c,roughness:.5}));
    s.position.set(0,-0.49,(11*CELL+0.7)/2+0.05+dz);
    boardGroup.add(s);
  });
}

/* points lumineux dorés qui tournent en continu autour du plateau,
   façon roue de jeu télévisé (en plus du liseré de loupiotes fixes) */
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
const brightGoldTex = makeGlowDotTexture('rgba(255,245,210,1)');
const trimLights = [];
const perimeterPts = [];
{
  const half = (11*CELL+0.7)/2;
  const perEdge = 13;
  for(let i=0;i<perEdge;i++){ perimeterPts.push([-half+(i/(perEdge-1))*half*2, -half]); }
  for(let i=1;i<perEdge;i++){ perimeterPts.push([half, -half+(i/(perEdge-1))*half*2]); }
  for(let i=1;i<perEdge;i++){ perimeterPts.push([half-(i/(perEdge-1))*half*2, half]); }
  for(let i=1;i<perEdge-1;i++){ perimeterPts.push([-half, half-(i/(perEdge-1))*half*2]); }
  perimeterPts.forEach(([x,z],idx)=>{
    const mat = new THREE.SpriteMaterial({
      map: goldDotTex,
      transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, opacity:.55
    });
    const spr = new THREE.Sprite(mat);
    spr.scale.set(0.26,0.26,0.26);
    spr.position.set(x,0.03,z);
    boardGroup.add(spr);
    trimLights.push({ spr, idx });
  });
}
/* 4 loupiotes brillantes qui parcourent réellement le pourtour, en
   continu, comme sur une roue de la fortune */
const orbiterLights = [];
for(let k=0;k<4;k++){
  const spr = makeSprite(brightGoldTex, 0.42);
  spr.material.blending = THREE.AdditiveBlending;
  spr.position.y = 0.04;
  boardGroup.add(spr);
  orbiterLights.push({ spr, offset:k/4 });
}
function perimeterPosAt(u){ // u in [0,1)
  const n = perimeterPts.length;
  const f = ((u%1)+1)%1 * n;
  const i0 = Math.floor(f), i1=(i0+1)%n, lp=f-i0;
  const [x0,z0]=perimeterPts[i0], [x1,z1]=perimeterPts[i1];
  return [x0+(x1-x0)*lp, z0+(z1-z0)*lp];
}

/* ---------- Plaque centrale "PIKAJACKPOT" ---------- */
function makeCenterPlateTexture(){
  const size = 640;
  const cvs = document.createElement('canvas'); cvs.width=cvs.height=size;
  const ctx = cvs.getContext('2d');
  const grad = ctx.createRadialGradient(size*0.5,size*0.4,size*0.05,size*0.5,size*0.5,size*0.66);
  grad.addColorStop(0,'#241a06'); grad.addColorStop(0.55,'#120d02'); grad.addColorStop(1,'#000000');
  ctx.fillStyle = grad; ctx.fillRect(0,0,size,size);

  // anneaux dorés concentriques façon roue
  for(let i=0;i<3;i++){
    ctx.beginPath(); ctx.arc(size/2,size/2,size*(0.46-i*0.07),0,Math.PI*2);
    ctx.lineWidth = size*0.012; ctx.strokeStyle = i===1?GOLD_BRIGHT:GOLD; ctx.globalAlpha=0.85-i*0.15;
    ctx.stroke();
  }
  ctx.globalAlpha=1;

  // mini Pokeball classique rouge/blanc au-dessus du texte
  const pbY = size*0.30, pbR = size*0.075;
  ctx.beginPath(); ctx.arc(size/2,pbY,pbR,Math.PI,0); ctx.fillStyle='#f5484f'; ctx.fill();
  ctx.beginPath(); ctx.arc(size/2,pbY,pbR,0,Math.PI); ctx.fillStyle='#f6fbff'; ctx.fill();
  ctx.fillStyle='#12283f'; ctx.fillRect(size/2-pbR,pbY-pbR*0.09,pbR*2,pbR*0.18);
  ctx.lineWidth=pbR*0.09; ctx.strokeStyle='#12283f';
  ctx.beginPath(); ctx.arc(size/2,pbY,pbR,0,Math.PI*2); ctx.stroke();
  ctx.beginPath(); ctx.arc(size/2,pbY,pbR*0.34,0,Math.PI*2); ctx.fillStyle='#fff'; ctx.fill(); ctx.stroke();

  // texte PIKAJACKPOT
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.font='900 '+(size*0.108)+'px Arial,Helvetica,sans-serif';
  ctx.fillStyle = GOLD_BRIGHT;
  ctx.shadowColor = 'rgba(255,210,110,.9)'; ctx.shadowBlur = size*0.02;
  ctx.save();
  ctx.translate(size/2, size*0.53);
  ctx.fillText('PIKA', -size*0.001, -size*0.06);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('JACKPOT', 0, size*0.075);
  ctx.restore();
  ctx.shadowBlur = 0;

  // liseré tricolore (clin d'oeil Pokémon) sous le texte
  const stripeY = size*0.66, stripeW = size*0.42, stripeH = size*0.018;
  [[-1,'#1a56db'],[0,'#ffffff'],[1,'#e0323f']].forEach(([d,c])=>{
    ctx.fillStyle = c;
    ctx.fillRect(size/2 - stripeW/2, stripeY + d*stripeH, stripeW, stripeH);
  });

  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const centerPlate = new THREE.Mesh(
  new THREE.BoxGeometry(9*CELL,0.14,9*CELL),
  new THREE.MeshStandardMaterial({map:makeCenterPlateTexture(),roughness:.7,metalness:.1})
);
centerPlate.position.y = 0.07;
centerPlate.receiveShadow = true;
boardGroup.add(centerPlate);

/* ---------- Les 40 cases ---------- */
const TILE = 0.95;
const tiles = [];

/* vitesses/amplitudes d'animation par catégorie */
const MOTION = {
  gradee:    {bob:0.11, swing:0.35},
  booster50: {bob:0.13, swing:0.3},
  etb:       {bob:0.15, swing:0.28},
  jackpot300:{bob:0.17, swing:0.25},
  chance:    {bob:0.12, spin:0},
  chest:     {bob:0.09, spin:0},
  prison:    {bob:0.07, pulse:true},
};

for(let i=0;i<40;i++){
  const {r,c} = ringPos(i);
  const world = toWorld(r,c);
  const data = BOARD_DATA[i];
  const catKey = data.cat;
  const catDef = CATS[catKey];
  const caseNum = i+1;

  const group = new THREE.Group();
  group.position.copy(world);
  group.rotation.y = outwardYaw(r,c);
  boardGroup.add(group);

  const baseTile = new THREE.Mesh(
    new THREE.BoxGeometry(TILE+0.05,0.08,TILE+0.05),
    new THREE.MeshStandardMaterial({color:0x050505, roughness:.6, metalness:.3})
  );
  baseTile.position.y = 0.04;
  baseTile.receiveShadow = true;
  group.add(baseTile);

  const accentColor = SWATCH_COLORS[catDef.swatch];
  const sideMat = new THREE.MeshStandardMaterial({color:new THREE.Color(accentColor),roughness:.7,metalness:.12});
  const bodyTile = new THREE.Mesh(new THREE.BoxGeometry(TILE,0.14,TILE), sideMat);
  bodyTile.position.y = 0.15;
  bodyTile.castShadow = true;
  bodyTile.receiveShadow = true;
  group.add(bodyTile);
  const tileTopY = 0.22;

  let faceTex;
  if(catDef.tier === 'flat'){
    faceTex = getFlatPhotoFace(catKey, caseNum, accentColor, data.isVisite ? '🔓' : null);
  } else {
    // pour les cases "float"/"glyph", la face reste sobre noir & or
    faceTex = getFlatPhotoFace(catKey, caseNum, accentColor, null);
  }
  const faceMat = new THREE.MeshBasicMaterial({map:faceTex});
  const face = new THREE.Mesh(new THREE.PlaneGeometry(TILE*0.94,TILE*0.94), faceMat);
  face.rotation.x = -Math.PI/2;
  face.position.y = tileTopY+0.002;
  face.receiveShadow = true;
  group.add(face);

  const numSpr = makeSprite(numberTexture(caseNum), 0.2);
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

  let floatObj = null, shadowDisc = null, floatBaseScale = 0.34;
  if(catDef.tier === 'float'){
    const { tex, aspect } = getFramedPhotoTexture(catKey);
    const scaleByCat = { gradee:0.5, booster50:0.6, etb:0.7, jackpot300:0.8 }[catKey] || 0.5;
    const h = scaleByCat, w = h*aspect;
    const mat = new THREE.MeshBasicMaterial({map:tex, transparent:true});
    floatObj = new THREE.Mesh(new THREE.PlaneGeometry(w,h), mat);
    floatObj.position.y = tileTopY + 0.32 + h*0.5;
    group.add(floatObj);
    floatBaseScale = h;
  } else if(catDef.tier === 'glyph'){
    const glyphKind = data.isVisite ? 'visite' : catKey;
    floatObj = makeSprite(getGlyphTexture(glyphKind), 0.3);
    floatObj.position.y = tileTopY + 0.3;
    group.add(floatObj);
  }
  if(floatObj){
    shadowDisc = new THREE.Mesh(
      new THREE.CircleGeometry(catDef.tier==='float' ? 0.28 : 0.22,20),
      new THREE.MeshBasicMaterial({color:0x000000,transparent:true,opacity:.3})
    );
    shadowDisc.rotation.x = -Math.PI/2;
    shadowDisc.position.y = tileTopY+0.005;
    group.add(shadowDisc);

    // halo doré supplémentaire sous les gros lots (plus intense = plus gros)
    if(catDef.tier==='float'){
      const glowScale = { gradee:0.58, booster50:0.72, etb:0.86, jackpot300:1.05 }[catKey] || 0.58;
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map:goldDotTex, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, opacity:.55
      }));
      glow.position.y = tileTopY+0.06;
      glow.scale.set(glowScale,glowScale,glowScale);
      group.add(glow);
    }
  }

  tiles.push({
    group, world, tileTopY, catKey, catDef, caseNum, isVisite:data.isVisite,
    halo, floatObj, shadowDisc, floatBaseScale, motion: MOTION[catKey]||{bob:0.08},
    phase: Math.random()*Math.PI*2,
    breathePhase: ((r+c)%8)*0.4
  });
}

/* Le "Départ" n'est pas une case à part hors plateau : le joueur
   démarre directement sur la case 1 elle-même (pas de lot réclamé
   tant qu'aucun lancer n'a eu lieu), avec juste un anneau doré au
   sol pour marquer visuellement ce point de départ. */
const START_NODE = tiles[0];
{
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.56,0.03,8,28), new THREE.MeshBasicMaterial({color:0xffe27a}));
  ring.rotation.x = Math.PI/2; ring.position.copy(START_NODE.world); ring.position.y = 0.03;
  boardGroup.add(ring);
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
let currentIndex = -1; // -1 = au départ, pas encore sur le plateau
let moving = false;
let generation = 0;
let finished = false;

function tileAt(idx){ return idx===-1 ? START_NODE : tiles[idx]; }

function setActive(index){
  tiles.forEach((t,i)=>{ t.isActive = (i===index); if(!t.isActive){ t.halo.material.opacity = 0; } });
}
setActive(-1);

function placeTokenInstant(idx){
  const t = tileAt(idx);
  player.root.position.set(t.world.x, t.tileTopY, t.world.z);
}
placeTokenInstant(-1);

/* ---------- Boucle d'animation ---------- */
const clock = new THREE.Clock();

/* Marche continue : un seul mouvement fluide du départ jusqu'à la
   case finale demandée, sans jamais s'arrêter aux cases
   intermédiaires. Le trajet est capé à la case 40 (jackpot final) :
   pas de retour à la case 1, la partie s'arrête là. */
let walk = null;

function startWalk(fromIdx, count, stepDuration){
  // Le pion démarre visuellement SUR la case 1 (pas sur une case
  // "0" séparée) : un lancer de N doit donc avancer de N cases
  // PLEINES depuis la case 1, comme depuis n'importe quelle autre
  // case déjà atteinte. `count` peut être négatif (cartes "Reculez
  // de N cases") : le pion recule alors case par case, sans jamais
  // dépasser la case 1.
  const startPos = fromIdx === -1 ? 0 : fromIdx;
  const dir = count >= 0 ? 1 : -1;
  const n = Math.abs(count);
  const path = [ tiles[startPos] ];
  const indices = [ fromIdx ];
  let idx = startPos;
  let steps = 0;
  for(let i=0;i<n;i++){
    const next = idx + dir;
    if(next < 0 || next > 39) break;
    idx = next;
    path.push(tiles[idx]);
    indices.push(idx);
    steps++;
  }
  const vCruise = steps>0 ? 1/stepDuration : 0;
  const rampUnits = Math.min(0.5, steps/2);
  const accelTime = rampUnits>0 ? (2*rampUnits)/vCruise : 0;
  const cruiseUnits = steps - 2*rampUnits;
  const cruiseTime = vCruise>0 ? cruiseUnits/vCruise : 0;
  walk = {
    path, indices, steps, vCruise, rampUnits, accelTime, cruiseTime,
    totalTime: Math.max(0.001, accelTime*2+cruiseTime),
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
    tl.spr.material.opacity = reduceMotion ? 0.5 : 0.28 + 0.45*Math.max(0, Math.sin(t*2.2 - tl.idx*0.5));
  });
  if(!reduceMotion){
    orbiterLights.forEach(ol=>{
      const u = (t*0.06 + ol.offset) % 1;
      const [x,z] = perimeterPosAt(u);
      ol.spr.position.set(x,0.05,z);
      ol.spr.material.opacity = 0.85 + Math.sin(t*6)*0.15;
    });
  }

  // respiration + icônes/lots dynamiques
  tiles.forEach(tile=>{
    if(!reduceMotion){
      const breathe = 1 + Math.sin(t*1.9 + tile.breathePhase)*0.012;
      tile.group.scale.set(1,breathe,1);
    }
    if(tile.floatObj){
      const m = tile.motion;
      const bobAmt = reduceMotion ? 0 : m.bob;
      const bob = Math.sin(t*2 + tile.phase)*bobAmt;
      const baseY = tile.tileTopY + 0.32 + (tile.catDef.tier==='float' ? tile.floatBaseScale*0.5 : -0.02);
      tile.floatObj.position.y = baseY + bob;
      if(!reduceMotion && m.swing){
        tile.floatObj.rotation.y = Math.sin(t*0.7 + tile.phase)*m.swing;
      }
      if(!reduceMotion && tile.catDef.tier==='glyph' && !m.pulse){
        const s = 1 + Math.sin(t*1.6 + tile.phase)*0.14;
        tile.floatObj.scale.set(0.3*s,0.3*s,0.3*s);
      }
      if(m.pulse){
        tile.floatObj.material.opacity = 0.7 + Math.sin(t*4.5+tile.phase)*0.3;
      }
      if(tile.shadowDisc){
        const k = 1 - Math.min(Math.abs(bob)/ (m.bob||1), 1)*0.5;
        tile.shadowDisc.scale.set(k,k,k);
        tile.shadowDisc.material.opacity = 0.3*k;
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
    if(walk.steps===0 || te >= walk.totalTime){
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
    const segIdx = Math.min(Math.floor(dist), Math.max(0,walk.steps-1));
    const localP = walk.steps>0 ? dist - segIdx : 0;
    const aTile = walk.path[segIdx], bTile = walk.path[Math.min(segIdx+1, walk.path.length-1)];
    const x = aTile.world.x + (bTile.world.x-aTile.world.x)*localP;
    const z = aTile.world.z + (bTile.world.z-aTile.world.z)*localP;
    const gaitAmp = walk.vCruise>0 ? vel/walk.vCruise : 0;
    const bob = reduceMotion ? 0 : Math.abs(Math.sin(dist*Math.PI*2))*0.028*gaitAmp;
    player.root.position.set(x, aTile.tileTopY + bob, z);

    if(bTile!==aTile){
      const targetYaw = Math.atan2(bTile.world.x-aTile.world.x, bTile.world.z-aTile.world.z);
      let dyaw = targetYaw - player.root.rotation.y;
      dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      player.root.rotation.y += dyaw*Math.min(1,dt*16);
    }

    if(segIdx !== walk.lastSeg){
      walk.lastSeg = segIdx;
      currentIndex = walk.indices[segIdx];
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
      currentIndex = walk.indices[walk.indices.length-1];
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
const validate = document.getElementById('validate');
const resetBtn = document.getElementById('reset');
const winBtn = document.getElementById('winBtn');
const startBtn = document.getElementById('startBtn');
const topNum = document.getElementById('topNum');
const statusEl = document.getElementById('status');
const placeBanner = document.getElementById('placeBanner');
const cardDrawOverlay = document.getElementById('cardDrawOverlay');
const cardGrid = document.getElementById('cardGrid');
const cardDrawTotal = document.getElementById('cardDrawTotal');

function shortPlaceName(idx){ return idx<0 ? 'Départ' : POKEMON_PLACES[idx]; }
let placeBannerGen = 0;
/* Le nom du lieu reste affiché en grand tant que le pion y est —
   on ne fait un fondu (sortie/entrée) que lors d'un changement de
   case, pas une simple apparition éclair qui disparaît toute seule. */
function updatePlaceBanner(idx, traveling){
  if(!placeBanner) return;
  const gen = ++placeBannerGen;
  const nextText = traveling ? '➜ '+shortPlaceName(idx) : (idx<0 ? 'Départ' : '📍 Rendez-vous : '+shortPlaceName(idx));
  const applyText = ()=>{
    if(gen !== placeBannerGen) return;
    placeBanner.textContent = nextText;
    placeBanner.classList.add('show');
  };
  if(placeBanner.classList.contains('show')){
    placeBanner.classList.remove('show');
    setTimeout(applyText, 460);
  } else {
    applyText();
  }
}

/* ---------- Tirage de 2 cartes qui remplace les 2 dés ----------
   Même distribution exacte que 2 dés (1-6 chacune, indépendantes) :
   un double déclenche un nouveau tirage de 2 cartes, jusqu'à 3
   tirages enchaînés maximum — identique à la mécanique physique. */
function shuffledSlots(){
  const a = [...Array(12).keys()];
  for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}
function computeCardDraw(){
  // Un seul tirage de 2 cartes par clic. Sur un double, l'hôte
  // relance lui-même manuellement (nouveau clic sur "TIRER LES
  // CARTES") pour la paire bonus, au lieu d'un enchaînement
  // automatique dans le logiciel.
  const a = 1+Math.floor(Math.random()*6);
  const b = 1+Math.floor(Math.random()*6);
  return { pairs: [{a,b}], total: a+b, isDouble: a===b, slotOrder: shuffledSlots() };
}
async function playCardDrawAnimation(draw){
  if(!cardDrawOverlay || !cardGrid) return;
  cardGrid.innerHTML = '';
  const cardEls = [];
  for(let i=0;i<12;i++){
    const c = document.createElement('div');
    c.className = 'mini-card';
    c.innerHTML = '<div class="face back"></div><div class="face front"></div>';
    cardGrid.appendChild(c);
    cardEls.push(c);
  }
  cardDrawOverlay.classList.add('show');
  if(cardDrawTotal) cardDrawTotal.textContent = '';
  await wait(400);

  const {a,b} = draw.pairs[0];
  const s1 = draw.slotOrder[0], s2 = draw.slotOrder[1];
  const f1 = cardEls[s1].querySelector('.front'), f2 = cardEls[s2].querySelector('.front');
  if(f1) f1.textContent = a;
  if(f2) f2.textContent = b;
  cardEls[s1].classList.add('flipped');
  cardEls[s2].classList.add('flipped');
  await wait(700);
  if(cardDrawTotal){
    cardDrawTotal.textContent = 'Total : '+draw.total + (draw.isDouble ? '  —  DOUBLE ! ⚡ Relancez pour la paire bonus' : '');
  }
  await wait(draw.isDouble ? 1600 : 900);
  cardDrawOverlay.classList.remove('show');
}

function placeLabel(idx){
  if(idx<0) return 'Départ';
  return POKEMON_PLACES[idx] + ' (case ' + (idx+1) + ')';
}

function updateWinButton(){
  if(!winBtn) return;
  const onPrize = currentIndex>=0 && !moving;
  const cat = onPrize ? tiles[currentIndex].catKey : null;
  // Chance / Caisse Communautaire se révèlent tout seuls (pas de
  // bouton à cliquer, la partie continue automatiquement après).
  const autoResolved = cat==='chance' || cat==='chest';
  winBtn.hidden = !onPrize || autoResolved;
  if(onPrize && !autoResolved){
    winBtn.textContent = cat==='prison' ? '💀 FIN DE PARTIE' : '🎉 LOT REMPORTÉ';
    winBtn.dataset.tier = cat;
  }
}

const wait = ms => new Promise(r=>setTimeout(r,ms));
const HOP_DURATION = 0.36;

async function move(forcedCount, forcedCard){
  if(moving || finished) return;
  moving = true;
  const myGen = ++generation;
  validate.disabled = true;
  if(winBtn) winBtn.hidden = true;
  const count = forcedCount!=null ? forcedCount : 1;
  const destIdx = Math.min(39, (currentIndex===-1?0:currentIndex) + count);
  const destCat = tiles[destIdx].catKey;
  // Si la case d'arrivée est Chance/Caisse, on tire la carte TOUT DE
  // SUITE (avant l'animation) pour pouvoir l'envoyer d'un coup à
  // l'écran public : les deux écrans doivent afficher la même carte.
  let card = forcedCard || null;
  if(!card && (destCat==='chance' || destCat==='chest')){
    card = drawCard(destCat==='chance' ? CHANCE_DECK : CHEST_DECK);
  }
  broadcastSync({type:'move', count, card});

  statusEl.textContent = 'Le joueur avance vers '+placeLabel(destIdx)+'…';
  updatePlaceBanner(destIdx, true);

  const w = startWalk(currentIndex, count, HOP_DURATION);
  await wait(w.totalTime*1000 + 30);

  if(myGen!==generation) return;
  // Filet de sécurité : si la fenêtre était en arrière-plan (ex. un
  // navigateur qui met en pause l'animation d'un onglet/fenêtre
  // caché·e), l'état logique se corrige quand même à la bonne case
  // au lieu de rester bloqué sur l'ancienne position.
  if(currentIndex !== destIdx){
    currentIndex = destIdx;
    walk = null;
    placeTokenInstant(destIdx);
    setActive(destIdx);
  }
  if(currentIndex===39){
    statusEl.textContent = '🏆 Arrivé à '+placeLabel(39)+' — JACKPOT FINAL !';
    finished = true;
  } else {
    statusEl.textContent = 'Le joueur est arrivé à '+placeLabel(currentIndex)+' !';
  }
  updatePlaceBanner(currentIndex, false);

  const arrivedCat = currentIndex>=0 ? tiles[currentIndex].catKey : null;
  if(!finished && (arrivedCat==='chance' || arrivedCat==='chest')){
    await resolveChanceChest(myGen, card);
    if(myGen!==generation) return;
  }

  moving = false;
  validate.disabled = finished;
  updateWinButton();
}

/* Chance / Caisse Communautaire se révèlent automatiquement (pas de
   bouton à cliquer) : la carte s'affiche, son effet éventuel
   (avancer/reculer) est joué directement sur le plateau, puis
   l'annonce disparaît toute seule et la partie continue. */
async function resolveChanceChest(myGen, forcedCard){
  const idx = currentIndex;
  const catKey = tiles[idx].catKey;
  const deck = catKey==='chance' ? CHANCE_DECK : CHEST_DECK;
  const card = forcedCard || drawCard(deck);
  celebrate(catKey, card);

  await wait(card.rare ? 2600 : 1900);
  if(myGen!==generation) return;

  if(card.effect && card.effect.type==='move' && card.effect.delta){
    const goingForward = card.effect.delta>0;
    statusEl.textContent = 'La carte le fait '+(goingForward?'avancer':'reculer')+' automatiquement de '+Math.abs(card.effect.delta)+' case'+(Math.abs(card.effect.delta)>1?'s':'')+'…';
    const w = startWalk(idx, card.effect.delta, HOP_DURATION);
    await wait(w.totalTime*1000 + 30);
    if(myGen!==generation) return;
    const expectedIdx = Math.max(0, Math.min(39, idx + card.effect.delta));
    if(currentIndex !== expectedIdx){
      currentIndex = expectedIdx;
      walk = null;
      placeTokenInstant(expectedIdx);
      setActive(expectedIdx);
    }
    if(currentIndex===39){
      statusEl.textContent = '🏆 Arrivé à '+placeLabel(39)+' — JACKPOT FINAL !';
      finished = true;
    } else {
      statusEl.textContent = 'Le joueur est arrivé à '+placeLabel(currentIndex)+' !';
    }
    updatePlaceBanner(currentIndex, false);
  }
  clearCelebration();
}

function restart(){
  generation++;
  moving = false;
  finished = false;
  walk = null;
  currentIndex = -1;
  player.root.scale.set(1,1,1);
  player.root.rotation.x = 0;
  player.torso.rotation.z = 0;
  player.legL.rotation.x = player.legR.rotation.x = player.armL.rotation.x = player.armR.rotation.x = 0;
  placeTokenInstant(-1);
  setActive(-1);
  statusEl.textContent = 'Le joueur est prêt sur Départ.';
  updatePlaceBanner(-1, false);
  topNum.textContent = '—';
  validate.disabled = false;
  if(winBtn) winBtn.hidden = true;
  clearCelebration();
  gameStarted = false;
  controls.autoRotate = !reduceMotion;
  if(startBtn){ startBtn.hidden = false; startBtn.textContent = '▶ DÉMARRER LA PARTIE'; }
  broadcastSync({type:'restart'});
}

function startGame(){
  gameStarted = true;
  controls.autoRotate = false;
  clearTimeout(idleTimer);
  if(startBtn) startBtn.hidden = true;
  broadcastSync({type:'start'});
}

async function drawAndMove(){
  if(moving || finished) return;
  validate.disabled = true;
  const draw = computeCardDraw();
  broadcastSync({type:'draw', draw});
  topNum.textContent = draw.total;
  await playCardDrawAnimation(draw);
  await move(draw.total);
}

validate.addEventListener('click', drawAndMove);
resetBtn.addEventListener('click', restart);
if(startBtn) startBtn.addEventListener('click', startGame);
if(winBtn) winBtn.addEventListener('click', ()=>{
  if(currentIndex<0) return;
  const cat = tiles[currentIndex].catKey;
  celebrate(cat);
  broadcastSync({type:'celebrate', catKey:cat});
});

if(syncChannel && isDisplay){
  syncChannel.onmessage = (e)=>{
    const m = e.data || {};
    if(m.type==='draw'){ topNum.textContent = m.draw.total; playCardDrawAnimation(m.draw); }
    else if(m.type==='move') move(m.count, m.card);
    else if(m.type==='celebrate') celebrate(m.catKey);
    else if(m.type==='restart') restart();
    else if(m.type==='start') startGame();
  };
}

const openDisplayBtn = document.getElementById('openDisplayBtn');
if(openDisplayBtn){
  openDisplayBtn.addEventListener('click', ()=>{
    const url = new URL(location.href);
    url.searchParams.set('view','display');
    window.open(url.toString(), 'pikajackpot_display', 'width=1280,height=820');
  });
}
[validate,resetBtn,winBtn,startBtn].forEach(btn=>{
  if(!btn) return;
  btn.addEventListener('touchend', e=>{ e.preventDefault(); btn.click(); }, {passive:false});
});
updatePlaceBanner(-1, false);

/* ==========================================================================
   Célébration "Lot remporté" — intensité croissante selon le lot :
   commune/booster8/alt/chance/chest (1) < gradée (2) < gros booster (3)
   < ETB 150€ (4) < jackpot final 300€ (5). Esprit Pokémon : étincelles
   électriques façon Pikachu, éclat façon Pokéball qui s'ouvre, pluie
   dorée pour le jackpot.
   ========================================================================= */
const TIER_LEVEL = {
  commune:1, booster8:1, alternative:1, chance:1, chest:1,
  gradee:2, booster50:3, etb:4, jackpot300:5, prison:0,
};
const celeb = document.getElementById('celebration');
const celebCanvas = document.getElementById('celebCanvas');
const celebText = document.getElementById('celebText');
const celebMain = document.getElementById('celebMain');
const celebSub = document.getElementById('celebSub');
let celebCtx = celebCanvas ? celebCanvas.getContext('2d') : null;
let celebParticles = [], celebRAF = null, celebEndAt = 0;

function resizeCelebCanvas(){
  if(!celebCanvas) return;
  celebCanvas.width = window.innerWidth;
  celebCanvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCelebCanvas, {passive:true});

function spawnParticles(level){
  const W = celebCanvas.width, H = celebCanvas.height;
  const count = [0,24,40,60,90,140][level];
  const colors = level>=4 ? ['#ffe27a','#fff2c2','#ffffff','#ffd200'] : ['#ffe27a','#e0323f','#1a56db','#ffffff'];
  for(let i=0;i<count;i++){
    const ang = Math.random()*Math.PI*2;
    const spd = (2+Math.random()*5) * (1+level*0.25);
    celebParticles.push({
      x:W/2, y:H*0.4, vx:Math.cos(ang)*spd, vy:Math.sin(ang)*spd - 2,
      g: 0.12+Math.random()*0.06, size: 3+Math.random()*5,
      color: colors[(Math.random()*colors.length)|0], life:1, decay: 0.006+Math.random()*0.006,
      shape: Math.random()<0.5?'rect':'circle', rot:Math.random()*Math.PI, vr:(Math.random()-0.5)*0.3
    });
  }
}

function celebFrame(){
  if(!celebCtx) return;
  const W = celebCanvas.width, H = celebCanvas.height;
  celebCtx.clearRect(0,0,W,H);
  celebParticles.forEach(p=>{
    p.x += p.vx; p.y += p.vy; p.vy += p.g; p.life -= p.decay; p.rot += p.vr;
    celebCtx.save();
    celebCtx.globalAlpha = Math.max(0,p.life);
    celebCtx.translate(p.x,p.y); celebCtx.rotate(p.rot);
    celebCtx.fillStyle = p.color;
    if(p.shape==='rect') celebCtx.fillRect(-p.size/2,-p.size/2,p.size,p.size*0.6);
    else { celebCtx.beginPath(); celebCtx.arc(0,0,p.size/2,0,Math.PI*2); celebCtx.fill(); }
    celebCtx.restore();
  });
  celebParticles = celebParticles.filter(p=>p.life>0 && p.y<H+50);
  if(performance.now() < celebEndAt || celebParticles.length){
    celebRAF = requestAnimationFrame(celebFrame);
  } else {
    celeb.classList.remove('show');
  }
}

function clearCelebration(){
  if(celebRAF) cancelAnimationFrame(celebRAF);
  celebParticles = [];
  if(celeb) celeb.classList.remove('show','shake');
}

/* Annonce propre à chaque catégorie de lot (plutôt qu'un message
   générique par palier) : le nom du lot réellement gagné s'affiche. */
const CATEGORY_MESSAGES = {
  commune:     '🃏 UNE CARTE DANS LA POCHE !',
  booster8:    '🎁 BOOSTER POKÉMON GAGNÉ !',
  alternative: '✨ CARTE ALTERNATIVE GAGNÉE ! ✨',
  gradee:      '⭐ CARTE GRADÉE DÉCROCHÉE ! ⭐',
  booster50:   '🎰 MINI JACKPOT ! 🎰',
  etb:         '🎰 MAJOR JACKPOT ! 🎰',
  jackpot300:  '👑 GRAND JACKPOT ! 👑',
};

function celebrate(catKey, forcedCard){
  const level = TIER_LEVEL[catKey] ?? 1;
  if(level===0){
    if(celebMain) celebMain.textContent = '💀 Fin de partie...';
    if(celebSub) celebSub.hidden = true;
    if(celeb){ celeb.classList.add('show'); celeb.dataset.level='0'; }
    setTimeout(clearCelebration, 1800);
    return;
  }
  if(!celeb || !celebCanvas) return;
  resizeCelebCanvas();
  celeb.dataset.level = String(level);
  celeb.classList.add('show');
  if(level>=4) celeb.classList.add('shake');

  let rareCardDrawn = false;
  if(catKey==='chance' || catKey==='chest'){
    const deck = catKey==='chance' ? CHANCE_DECK : CHEST_DECK;
    const card = forcedCard || drawCard(deck);
    rareCardDrawn = !!card.rare;
    if(celebMain) celebMain.textContent = rareCardDrawn
      ? '🌟 JACKPOT DE PIOCHE ! 🌟'
      : (catKey==='chance' ? '🎴 CARTE CHANCE' : '🗃️ CAISSE COMMUNAUTAIRE');
    if(celebSub){ celebSub.textContent = card.text; celebSub.hidden = false; }
    if(rareCardDrawn) celeb.classList.add('shake');
  } else {
    if(celebMain) celebMain.textContent = CATEGORY_MESSAGES[catKey] || '🎉 Lot remporté !';
    if(celebSub) celebSub.hidden = true;
  }

  const effectiveLevel = rareCardDrawn ? 5 : level;
  const bursts = effectiveLevel;
  for(let b=0;b<bursts;b++){ setTimeout(()=>spawnParticles(effectiveLevel), b*220); }
  celebEndAt = performance.now() + 1400 + effectiveLevel*350;
  if(!celebRAF) celebFrame();
  setTimeout(()=>{ celeb.classList.remove('shake'); }, rareCardDrawn ? 900 : 700);
}
