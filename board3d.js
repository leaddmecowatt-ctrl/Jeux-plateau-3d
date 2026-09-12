import * as THREE from 'three';
import { OrbitControls } from './vendor/three/OrbitControls.js';
import { GLTFLoader } from './vendor/three/examples/jsm/loaders/GLTFLoader.js';

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
  commune:     { label:'Pioche du Prof. Chen',        value:'~0,68€',  tier:'flat',  swatch:'bronze' },
  booster8:    { label:'Booster du Marchand',         value:'8€',      tier:'float', swatch:'blue'   },
  alternative: { label:'Zone Safari',                 value:'~7,20€',  tier:'flat',  swatch:'red'    },
  gradee:      { label:'Duopack 30 ans',              value:'20-80€',  tier:'float', swatch:'gold'   },
  booster50:   { label:'Tripack 30 ans',              value:'50€',     tier:'float', swatch:'gold'   },
  etb:         { label:'Coffret 30 ans',              value:'150€',    tier:'float', swatch:'gold'   },
  jackpot300:  { label:'ETB 30 ans',                  value:'300€',    tier:'float', swatch:'gold'   },
  chance:      { label:'Chance',                     value:'tirage',  tier:'glyph', swatch:'purple' },
  chest:       { label:'Caisse Communautaire',       value:'tirage',  tier:'glyph', swatch:'green'  },
  prison:      { label:'Prison',                     value:'0€',      tier:'glyph', swatch:'danger' },
};

/* Pioches Chance / Caisse Communautaire (mêmes decks que le modèle
   de probabilités), tirées au sort quand le joueur appuie sur le
   bouton de révélation. */
/* Chaque carte a un "poids" : les cartes normales pèsent 4, la carte
   gradée rare ne pèse qu'1 sur un total de 25 -> 1 chance sur 25
   (4%) de tomber dessus, pour rester rarissime et ne pas casser la
   rentabilité (le q nécessaire remonte légèrement, 80,1% au lieu de
   79,6%, mais la marge reste pile à 50%, vérifié). */
const RARE_GRADEE_CARD = { text: '★ CARTE GRADÉE OFFERTE (20-80€) — TRÈS RARE ★', weight: 1, rare: true, effect:{type:'prize', cat:'gradee'} };
const CHANCE_DECK = [
  { text: 'Avancez de 3 cases', weight: 4, effect:{type:'move', delta:3} },
  { text: 'Reculez de 2 cases', weight: 4, effect:{type:'move', delta:-2} },
  { text: 'Rejouez gratuitement (relance bonus sans risque)', weight: 4, effect:{type:'replay'} },
  { text: 'Carte commune offerte (~0,68€)', weight: 4, effect:{type:'prize', cat:'commune'} },
  { text: "Prochain «je continue» : risque réduit de moitié", weight: 4, effect:{type:'riskHalved'} },
  { text: 'Carte alternative offerte (~7,20€ en moyenne)', weight: 4, effect:{type:'prize', cat:'alternative'} },
  RARE_GRADEE_CARD,
];
const CHEST_DECK = [
  { text: 'Carte commune offerte (~0,68€)', weight: 4, effect:{type:'prize', cat:'commune'} },
  { text: 'Rejouez gratuitement', weight: 4, effect:{type:'replay'} },
  { text: 'Avancez de 2 cases', weight: 4, effect:{type:'move', delta:2} },
  { text: 'Booster à 8€ offert', weight: 4, effect:{type:'prize', cat:'booster8'} },
  { text: 'Reculez de 1 case', weight: 4, effect:{type:'move', delta:-1} },
  { text: 'Rien de spécial', weight: 4, effect:{type:'none'} },
  RARE_GRADEE_CARD,
];
/* Garde-fou "pitié" : la carte rare (grosse carte gradée) tombe en
   moyenne 1 tirage sur 25, mais le pur hasard peut la faire attendre
   bien plus longtemps, ce qui plombe l'ambiance d'un live où les
   viewers ne voient défiler que des petits lots. Au-delà de
   PITY_THRESHOLD tirages Chance/Caisse consécutifs sans carte rare,
   elle est garantie au tirage suivant, puis le compteur repart à
   zéro et le hasard normal reprend. Sur la durée la fréquence
   moyenne ne change quasiment pas (elle plafonne juste les trous de
   malchance) : le pourcentage de reversement cible n'est pas
   affecté, seul le TIMING de cette carte l'est. Persistant
   (localStorage) pour survivre à un rechargement de page. */
// localStorage peut être bloqué (mode privé strict, cookies tiers
// désactivés, contexte d'iframe restreint comme un artifact) : la
// lecture peut alors lever une exception, pas juste renvoyer null —
// sans ce garde-fou, ça empêcherait carrément le jeu de démarrer.
function safeGetItem(key){
  try{ return localStorage.getItem(key); }catch(e){ return null; }
}

const PITY_KEY = 'pika_pity_counter';
const PITY_THRESHOLD = 32;
let pityCounter = parseInt(safeGetItem(PITY_KEY), 10) || 0;
function savePity(){ try{ localStorage.setItem(PITY_KEY, String(pityCounter)); }catch(e){} }

function drawCard(deck){
  if(pityCounter >= PITY_THRESHOLD && deck.includes(RARE_GRADEE_CARD)){
    pityCounter = 0; savePity();
    return RARE_GRADEE_CARD;
  }
  const total = deck.reduce((s,c)=>s+c.weight,0);
  let r = Math.random()*total;
  for(const c of deck){
    r -= c.weight;
    if(r<=0){
      pityCounter = c.rare ? 0 : pityCounter+1;
      savePity();
      return c;
    }
  }
  pityCounter = deck[deck.length-1].rare ? 0 : pityCounter+1;
  savePity();
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

/* Éclaircit (percent>0) ou assombrit (percent<0) une couleur hex,
   pour dériver un dégradé lisible/vif à partir d'une seule couleur
   d'accent (au lieu de retomber sur du noir plat). */
function shadeHex(hex, percent){
  const n = parseInt(hex.slice(1), 16);
  const r = (n>>16)&255, g = (n>>8)&255, b = n&255;
  const mix = (c)=> Math.max(0, Math.min(255, Math.round(c + (percent>0 ? 255-c : c)*percent)));
  return '#'+[mix(r),mix(g),mix(b)].map(v=>v.toString(16).padStart(2,'0')).join('');
}

function roundRectPath(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.roundRect(x,y,w,h,r);
}

/* Affiche le nom d'un lot dans le bandeau en bas de case, en
   réduisant la taille de police jusqu'à ce qu'il tienne sur une
   ligne, ou en le répartissant sur deux lignes si même la taille
   minimale ne suffit pas (noms plus longs que les prix qu'ils
   remplacent, ex. "Butin de la Ligue Pokémon"). Suppose
   ctx.textAlign='center' et ctx.textBaseline='middle' déjà réglés. */
function drawFittedBandLabel(ctx, text, cx, cy, maxWidth, maxFont, minFont){
  const family = 'Arial,Helvetica,sans-serif';
  let fontSize = maxFont;
  ctx.font = '900 '+fontSize+'px '+family;
  while(fontSize > minFont && ctx.measureText(text).width > maxWidth){
    fontSize -= 2;
    ctx.font = '900 '+fontSize+'px '+family;
  }
  if(ctx.measureText(text).width <= maxWidth){
    ctx.fillText(text, cx, cy);
    return;
  }
  // ne tient toujours pas : coupe en 2 lignes au meilleur espace
  const words = text.split(' ');
  let bestSplit = Math.max(1, Math.ceil(words.length/2)), bestDiff = Infinity;
  for(let i=1;i<words.length;i++){
    const diff = Math.abs(words.slice(0,i).join(' ').length - words.slice(i).join(' ').length);
    if(diff < bestDiff){ bestDiff = diff; bestSplit = i; }
  }
  const line1 = words.slice(0,bestSplit).join(' '), line2 = words.slice(bestSplit).join(' ');
  fontSize = minFont;
  ctx.font = '900 '+fontSize+'px '+family;
  while(fontSize > minFont*0.7 && (ctx.measureText(line1).width>maxWidth || ctx.measureText(line2).width>maxWidth)){
    fontSize -= 1.5;
    ctx.font = '900 '+fontSize+'px '+family;
  }
  const lineGap = fontSize*1.08;
  ctx.fillText(line1, cx, cy - lineGap/2);
  ctx.fillText(line2, cx, cy + lineGap/2);
}

/* Texture "carte plate" : la vraie photo du lot, encadrée noir & or,
   utilisée directement sur la face de la case (cartes communes,
   boosters 8€, alternatives) pour ne pas surcharger le plateau. */
let _maxAniso = 8;
function getMaxAniso(){ return renderer ? renderer.capabilities.getMaxAnisotropy() : _maxAniso; }
const flatFaceCache = new Map();
function getFlatPhotoFace(catKey, accentColor, badge){
  // Clé de cache SANS le numéro de case : le rendu ne dépend que de
  // la catégorie/couleur/badge, jamais du numéro affiché à côté (qui
  // est un sprite séparé) — sinon chacune des 40 cases générait sa
  // propre texture 960×960 au lieu de partager les ~8 variantes
  // réelles, ce qui pouvait saturer la mémoire GPU sur mobile et
  // faire clignoter des cases en noir le temps qu'une texture évincée
  // soit rechargée.
  const key = catKey+'|'+badge;
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

    // Fond en dégradé dans la couleur d'accent de la catégorie (déjà
    // utilisée pour la bordure de la case) : évite les bandes noires
    // sur les côtés (carte plus étroite que la case) sans jamais
    // rogner la carte elle-même au premier plan, et reste cohérent
    // avec le code couleur déjà en place plutôt qu'un flou terne.
    const bgGrad = ctx.createRadialGradient(
      pad+bw/2, pad+bh*0.42, bh*0.05,
      pad+bw/2, pad+bh/2, bh*0.75
    );
    bgGrad.addColorStop(0, shadeHex(accentColor, 0.4));
    bgGrad.addColorStop(0.55, accentColor);
    bgGrad.addColorStop(1, shadeHex(accentColor, -0.55));
    ctx.save();
    roundRectPath(ctx, pad, pad, bw, bh, r*0.7); ctx.clip();
    ctx.fillStyle = bgGrad;
    ctx.fillRect(pad, pad, bw, bh);
    ctx.restore();

    // "contain" fit (jamais "cover") : on voit toujours la carte/l'objet
    // en entier, jamais coupé en haut ou en bas, tout en remplissant
    // au maximum la case (zoom optimal sans rognage).
    const scale = Math.min(bw/img.width, bh/img.height);
    const iw = img.width*scale, ih = img.height*scale;
    ctx.filter = 'saturate(1.14) contrast(1.07) brightness(1.06)';
    ctx.drawImage(img, pad+(bw-iw)/2, pad+(bh-ih)/2, iw, ih);
    ctx.filter = 'none';
  } else if(CATS[catKey] && CATS[catKey].tier === 'glyph'){
    // Chance / Caisse Communautaire / Prison n'ont pas de photo, mais
    // ne doivent plus rester une case plate noire : même fond dégradé
    // coloré que les lots, avec le symbole en grand au centre.
    const pad = size*0.028;
    const bw = size-2*pad, bh = size-2*pad-size*0.19;
    const bgGrad = ctx.createRadialGradient(
      pad+bw/2, pad+bh*0.42, bh*0.05,
      pad+bw/2, pad+bh/2, bh*0.75
    );
    bgGrad.addColorStop(0, shadeHex(accentColor, 0.4));
    bgGrad.addColorStop(0.55, accentColor);
    bgGrad.addColorStop(1, shadeHex(accentColor, -0.55));
    ctx.save();
    roundRectPath(ctx, pad, pad, bw, bh, r*0.7); ctx.clip();
    ctx.fillStyle = bgGrad;
    ctx.fillRect(pad, pad, bw, bh);
    ctx.restore();

    const glyphChar = { chance:'?', chest:'🗃️', prison:'🔒' }[catKey];
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = size*0.03;
    ctx.fillStyle = '#fff9e6';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    if(catKey==='chance'){
      ctx.font = '900 '+(bh*0.6)+'px Arial,Helvetica,sans-serif';
    } else {
      ctx.font = (bh*0.52)+'px "Segoe UI Emoji","Apple Color Emoji",Arial,sans-serif';
    }
    ctx.fillText(glyphChar, pad+bw/2, pad+bh*0.46);
    ctx.restore();
  }
  const gloss = ctx.createLinearGradient(0,0,0,size);
  gloss.addColorStop(0,'rgba(255,255,255,.06)'); gloss.addColorStop(.22,'rgba(255,255,255,0)');
  ctx.fillStyle = gloss; ctx.fillRect(0,0,size,size);
  ctx.restore();

  roundRectPath(ctx,9,9,size-18,size-18,r);
  ctx.shadowColor = accentColor; ctx.shadowBlur = size*0.035;
  ctx.lineWidth = 10; ctx.strokeStyle = accentColor; ctx.stroke();
  ctx.shadowBlur = 0;
  roundRectPath(ctx,15,15,size-30,size-30,r*0.85);
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.stroke();

  // bandeau nom du lot en bas (jamais le prix)
  const bandH = size*0.22;
  ctx.fillStyle = accentColor;
  roundRectPath(ctx,9,size-9-bandH,size-18,bandH,r*0.7); ctx.fill();
  ctx.fillStyle = '#0c0c0c'; ctx.globalAlpha=.28;
  roundRectPath(ctx,9,size-9-bandH,size-18,bandH,r*0.7); ctx.fill(); ctx.globalAlpha=1;
  ctx.fillStyle = '#fff9e6';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  drawFittedBandLabel(ctx, CATS[catKey].label, size/2, size-9-bandH/2+2, size-18-size*0.06, size*0.088, size*0.045);

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

/* Texture dédiée à la case "Départ" (case 1) : ni photo ni prix, pour
   qu'elle ne se lise jamais comme un lot — même dans le cas rare où
   une carte Chance ferait reculer un joueur jusque-là (le côté
   mécanique est bloqué séparément dans updateWinButton). */
let _departFace = null;
function getDepartFace(){
  if(_departFace) return _departFace;
  const size = 960;
  const cvs = document.createElement('canvas'); cvs.width=cvs.height=size;
  const ctx = cvs.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const r = size*0.16;

  ctx.save();
  roundRectPath(ctx,9,9,size-18,size-18,r); ctx.clip();
  ctx.fillStyle = '#0c0c0c'; ctx.fillRect(0,0,size,size);

  const pad = size*0.028;
  const bw = size-2*pad, bh = size-2*pad-size*0.19;
  const bgGrad = ctx.createRadialGradient(
    pad+bw/2, pad+bh*0.42, bh*0.05,
    pad+bw/2, pad+bh/2, bh*0.75
  );
  bgGrad.addColorStop(0, shadeHex(GOLD, 0.4));
  bgGrad.addColorStop(0.55, GOLD);
  bgGrad.addColorStop(1, shadeHex(GOLD, -0.55));
  ctx.save();
  roundRectPath(ctx, pad, pad, bw, bh, r*0.7); ctx.clip();
  ctx.fillStyle = bgGrad;
  ctx.fillRect(pad, pad, bw, bh);
  ctx.restore();

  // mini Pokeball centrée, même style que la plaque centrale
  const pbY = pad+bh*0.4, pbR = bh*0.15;
  ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = size*0.015;
  ctx.beginPath(); ctx.arc(pad+bw/2,pbY,pbR,Math.PI,0); ctx.fillStyle='#f5484f'; ctx.fill();
  ctx.beginPath(); ctx.arc(pad+bw/2,pbY,pbR,0,Math.PI); ctx.fillStyle='#f6fbff'; ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle='#12283f'; ctx.fillRect(pad+bw/2-pbR,pbY-pbR*0.09,pbR*2,pbR*0.18);
  ctx.lineWidth=pbR*0.09; ctx.strokeStyle='#12283f';
  ctx.beginPath(); ctx.arc(pad+bw/2,pbY,pbR,0,Math.PI*2); ctx.stroke();
  ctx.beginPath(); ctx.arc(pad+bw/2,pbY,pbR*0.34,0,Math.PI*2); ctx.fillStyle='#fff'; ctx.fill(); ctx.stroke();

  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.font='900 '+(bh*0.17)+'px Arial,Helvetica,sans-serif';
  ctx.lineJoin='round'; ctx.lineWidth=size*0.01; ctx.strokeStyle='rgba(0,0,0,.8)';
  const txtY = pad+bh*0.78;
  ctx.strokeText('DÉPART', pad+bw/2, txtY);
  ctx.fillStyle = '#fff9e6';
  ctx.fillText('DÉPART', pad+bw/2, txtY);

  const gloss = ctx.createLinearGradient(0,0,0,size);
  gloss.addColorStop(0,'rgba(255,255,255,.06)'); gloss.addColorStop(.22,'rgba(255,255,255,0)');
  ctx.fillStyle = gloss; ctx.fillRect(0,0,size,size);
  ctx.restore();

  roundRectPath(ctx,9,9,size-18,size-18,r);
  ctx.shadowColor = GOLD; ctx.shadowBlur = size*0.035;
  ctx.lineWidth = 10; ctx.strokeStyle = GOLD; ctx.stroke();
  ctx.shadowBlur = 0;
  roundRectPath(ctx,15,15,size-30,size-30,r*0.85);
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.stroke();

  const bandH = size*0.22;
  ctx.fillStyle = GOLD;
  roundRectPath(ctx,9,size-9-bandH,size-18,bandH,r*0.7); ctx.fill();
  ctx.fillStyle = '#0c0c0c'; ctx.globalAlpha=.28;
  roundRectPath(ctx,9,size-9-bandH,size-18,bandH,r*0.7); ctx.fill(); ctx.globalAlpha=1;
  ctx.fillStyle = '#fff9e6';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  drawFittedBandLabel(ctx, 'Point de départ', size/2, size-9-bandH/2+2, size-18-size*0.06, size*0.088, size*0.045);

  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = getMaxAniso();
  _departFace = tex;
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

/* Icônes "glyphe" pour Chance, Caisse Communautaire, Prison : un
   médaillon rond dégradé dans la couleur d'accent de la case (façon
   jeton) derrière le symbole, sinon le glyphe flottait nu et minuscule
   dans le décor, à peine lisible depuis la caméra par défaut. */
const glyphCache = new Map();
function getGlyphTexture(kind, accentColor){
  const key = kind+'|'+(accentColor||'');
  if(glyphCache.has(key)) return glyphCache.get(key);
  const size = 240;
  const cvs = document.createElement('canvas'); cvs.width=cvs.height=size;
  const ctx = cvs.getContext('2d');
  const cx=size/2, cy=size/2;
  ctx.textAlign='center'; ctx.textBaseline='middle';
  if(kind==='visite'){
    ctx.shadowColor = 'rgba(255,255,255,.6)'; ctx.shadowBlur = size*0.12;
    ctx.font=(size*0.4)+'px "Segoe UI Emoji","Apple Color Emoji",Arial,sans-serif';
    ctx.fillText('🔓',cx,cy+size*0.03);
  } else {
    const medal = accentColor || GOLD;
    // liseré sombre + anneau blanc épais autour du médaillon : sans ça,
    // il se fond dans une case dont la face a maintenant le même fond
    // coloré (depuis la refonte des cases Chance/Caisse/Prison).
    const rimR = size*0.46;
    ctx.beginPath(); ctx.arc(cx,cy,rimR,0,Math.PI*2);
    ctx.fillStyle = 'rgba(8,6,4,.85)'; ctx.fill();

    const radius = size*0.40;
    const grad = ctx.createRadialGradient(cx,cy-radius*0.3,radius*0.08, cx,cy,radius);
    grad.addColorStop(0, shadeHex(medal,0.45));
    grad.addColorStop(0.6, medal);
    grad.addColorStop(1, shadeHex(medal,-0.5));
    ctx.beginPath(); ctx.arc(cx,cy,radius,0,Math.PI*2);
    ctx.fillStyle = grad; ctx.fill();
    ctx.lineWidth = size*0.045; ctx.strokeStyle = '#fff9e6'; ctx.stroke();

    ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = size*0.05;
    ctx.fillStyle = '#fff9e6';
    if(kind==='chance'){
      ctx.font='900 '+(size*0.44)+'px Arial,Helvetica,sans-serif';
      ctx.fillText('?',cx,cy+size*0.02);
    } else if(kind==='chest'){
      ctx.font=(size*0.38)+'px "Segoe UI Emoji","Apple Color Emoji",Arial,sans-serif';
      ctx.fillText('🗃️',cx,cy+size*0.02);
    } else if(kind==='prison'){
      ctx.font=(size*0.36)+'px "Segoe UI Emoji","Apple Color Emoji",Arial,sans-serif';
      ctx.fillText('🔒',cx,cy+size*0.02);
    }
  }
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  glyphCache.set(key,tex);
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
  /* premultipliedAlpha:false causait une teinte visible sur tout ce
     qui se voit à travers le canvas transparent (comparé au fond
     direct hors du plateau) — revenu au comportement par défaut
     (true), plus fidèle en couleur pour la composition avec la photo
     derrière. */
  renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:true, powerPreference:'high-performance' });
}catch(e){
  const fb = document.createElement('div');
  fb.className = 'gl-fallback';
  fb.textContent = "Impossible d'afficher le plateau 3D (WebGL indisponible sur cet appareil).";
  wrap.appendChild(fb);
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
/* alpha:true permet la transparence mais ne l'active pas : Three.js
   efface quand même chaque image en noir opaque (alpha 1) par
   défaut. Sans ceci, le canvas reste un rectangle noir plein là où
   il n'y a ni case ni centre, quel que soit le fond de scène. */
renderer.setClearAlpha(0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
/* Le tone mapping filmic (ACES) adoucit/assombrit légèrement les
   couleurs — pensé pour un fond noir, mais ça fait paraître le
   plateau "terne" à côté de la photo vive qui l'entoure maintenant.
   Exposure remontée pour que le plateau garde du punch. */
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;

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
/* Pas de fond de scène opaque : le canvas (alpha:true) reste
   transparent partout où il n'y a ni case ni centre, pour que le
   fond de la page (photo derrière le plateau) touche directement
   les cases, sans rectangle noir tout autour. */

const BASE_FOV = 40;
const camera = new THREE.PerspectiveCamera(BASE_FOV,1,0.1,100);
camera.position.set(0,13.5,11);
scene.add(camera);

/* Garde-fou anti-rognage des coins : au lieu d'un recul de caméra
   fixe (qui rapetissait tout le plateau en permanence, y compris de
   face où ce n'était pas nécessaire), on élargit le champ de vision
   au fil de la rotation UNIQUEMENT le strict minimum requis pour que
   les 4 coins restent visibles sous l'angle courant, et on revient à
   BASE_FOV dès que l'angle redevient sûr (vue de face par défaut =
   plateau au maximum, comme avant). */
const BOARD_CORNER_R = 5.65;
const boardCorners = [
  new THREE.Vector3(-BOARD_CORNER_R, 0.5, -BOARD_CORNER_R),
  new THREE.Vector3( BOARD_CORNER_R, 0.5, -BOARD_CORNER_R),
  new THREE.Vector3( BOARD_CORNER_R, 0.5,  BOARD_CORNER_R),
  new THREE.Vector3(-BOARD_CORNER_R, 0.5,  BOARD_CORNER_R),
];
let cameraPunchActive = false;
const _cornerView = new THREE.Vector3();
function updateCornerSafety(dt){
  if(cameraPunchActive) return;
  camera.updateMatrixWorld();
  let maxTan = Math.tan(THREE.MathUtils.degToRad(BASE_FOV/2));
  for(const corner of boardCorners){
    _cornerView.copy(corner).applyMatrix4(camera.matrixWorldInverse);
    const depth = -_cornerView.z;
    if(depth <= 0.01) continue;
    const tanV = Math.abs(_cornerView.y)/depth;
    const tanH = (Math.abs(_cornerView.x)/depth)/camera.aspect;
    maxTan = Math.max(maxTan, tanV, tanH);
  }
  // marge de 7% pour ne jamais laisser un coin à ras du bord
  const targetFov = THREE.MathUtils.clamp(
    THREE.MathUtils.radToDeg(2*Math.atan(maxTan/0.93)),
    BASE_FOV, 72
  );
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt*6);
  camera.updateProjectionMatrix();
}

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

/* Sur un écran portrait étroit (téléphone), le cadre est plus haut
   que large. Reculer la caméra pile assez pour ne jamais rogner un
   bord (facteur = 1/aspect) garde tout visible mais rapetisse le
   plateau et laisse de grandes bandes vides en haut/bas. On ne
   recule que partiellement (racine carrée, plafonnée) : le plateau
   reste bien plus grand à l'écran, quitte à rogner très légèrement
   les coins les plus excentrés sur les cadres très hauts. */
{
  const aspect0 = wrap.clientWidth / wrap.clientHeight;
  if(aspect0 > 0 && aspect0 < 1){
    const factor = Math.min(Math.pow(1/aspect0, 0.5), 1.6);
    const dir = camera.position.clone().sub(controls.target).normalize();
    const dist = camera.position.distanceTo(controls.target) * factor;
    camera.position.copy(controls.target).add(dir.multiplyScalar(dist));
    controls.minDistance *= factor;
    controls.maxDistance *= factor;
  }
}
controls.update();

/* Pas d'effet de bloom (halo lumineux) : son flou à large rayon
   "bavait" sur le sol transparent du plateau autour des anneaux/
   lumières, empêchant la photo de fond de se voir correctement même
   là où rien n'est dessiné — au lieu d'un halo doux, on préfère un
   plateau qui reste vraiment transparent là où il doit l'être. */

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

/* ---------- Plateau central ----------
   Pas de plinthe/socle : le plateau (cases + centre) est isolé de
   son environnement, sans aucune surface rectangulaire opaque ou
   translucide autour — l'arrière-plan de la page doit être visible
   directement sur les 4 côtés, jusqu'au contour réel des cases. */
const boardGroup = new THREE.Group();
scene.add(boardGroup);

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
  // Pas de fond du tout, pas même un voile discret : le sol du
  // plateau reste entièrement transparent jusqu'au centre, la photo
  // derrière doit se voir sans aucune couche. La lisibilité du texte
  // vient uniquement de son ombre portée (plus bas), pas d'un fond.

  // anneaux dorés concentriques façon roue — ombre portée sombre pour
  // rester lisibles quel que soit ce qui se voit derrière (photo)
  ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = size*0.01;
  for(let i=0;i<3;i++){
    ctx.beginPath(); ctx.arc(size/2,size/2,size*(0.46-i*0.07),0,Math.PI*2);
    ctx.lineWidth = size*0.012; ctx.strokeStyle = i===1?GOLD_BRIGHT:GOLD; ctx.globalAlpha=0.85-i*0.15;
    ctx.stroke();
  }
  ctx.globalAlpha=1; ctx.shadowBlur=0;

  // mini Pokeball classique rouge/blanc au-dessus du texte — ombre
  // sombre pour se détacher de n'importe quel fond derrière
  const pbY = size*0.30, pbR = size*0.075;
  ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = size*0.015;
  ctx.beginPath(); ctx.arc(size/2,pbY,pbR,Math.PI,0); ctx.fillStyle='#f5484f'; ctx.fill();
  ctx.beginPath(); ctx.arc(size/2,pbY,pbR,0,Math.PI); ctx.fillStyle='#f6fbff'; ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle='#12283f'; ctx.fillRect(size/2-pbR,pbY-pbR*0.09,pbR*2,pbR*0.18);
  ctx.lineWidth=pbR*0.09; ctx.strokeStyle='#12283f';
  ctx.beginPath(); ctx.arc(size/2,pbY,pbR,0,Math.PI*2); ctx.stroke();
  ctx.beginPath(); ctx.arc(size/2,pbY,pbR*0.34,0,Math.PI*2); ctx.fillStyle='#fff'; ctx.fill(); ctx.stroke();

  // texte PIKAJACKPOT — contour sombre systématique (pas juste une
  // lueur dorée) pour rester lisible même sur une photo très claire
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.font='900 '+(size*0.108)+'px Arial,Helvetica,sans-serif';
  ctx.lineJoin='round'; ctx.lineWidth=size*0.014; ctx.strokeStyle='rgba(0,0,0,.8)';
  ctx.save();
  ctx.translate(size/2, size*0.53);
  ctx.strokeText('PIKA', -size*0.001, -size*0.06);
  ctx.strokeText('JACKPOT', 0, size*0.075);
  ctx.shadowColor = 'rgba(255,210,110,.9)'; ctx.shadowBlur = size*0.02;
  ctx.fillStyle = GOLD_BRIGHT;
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
  new THREE.MeshStandardMaterial({map:makeCenterPlateTexture(),roughness:.7,metalness:.1,transparent:true})
);
centerPlate.position.y = 0.07;
boardGroup.add(centerPlate);

/* ---------- Ornements dorés dans les 4 angles du plateau ----------
   Petites "boucles" en volutes façon gravure, comme sur le visuel
   promotionnel du jeu : un médaillon en losange d'où partent deux
   spirales symétriques, posé bien à plat au tout coin du plateau. */
function drawScrollSpiral(ctx, cx, cy, dir, turns, maxR){
  ctx.beginPath();
  const steps = 48;
  for(let i=0;i<=steps;i++){
    const t = i/steps;
    const ang = t*turns*Math.PI*2*dir - Math.PI/2;
    const r = maxR*t;
    const x = cx + Math.cos(ang)*r, y = cy + Math.sin(ang)*r;
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.stroke();
}
function makeCornerOrnamentTexture(){
  const size = 512;
  const cvs = document.createElement('canvas'); cvs.width=cvs.height=size;
  const ctx = cvs.getContext('2d');
  const cx = size/2, gemY = size*0.30, scrollY = size*0.52, r = size*0.16;

  ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = size*0.015;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  // tige centrale reliant le médaillon aux volutes
  ctx.lineWidth = size*0.02; ctx.strokeStyle = GOLD;
  ctx.beginPath(); ctx.moveTo(cx, gemY+size*0.06); ctx.lineTo(cx, scrollY-size*0.02); ctx.stroke();

  // deux volutes symétriques
  ctx.lineWidth = size*0.028;
  const grad = ctx.createLinearGradient(0,0,0,size);
  grad.addColorStop(0, GOLD_BRIGHT); grad.addColorStop(1, '#b6862a');
  ctx.strokeStyle = grad;
  drawScrollSpiral(ctx, cx-r*0.85, scrollY, 1, 1.65, r);
  drawScrollSpiral(ctx, cx+r*0.85, scrollY, -1, 1.65, r);

  // petits fleurons aux extrémités des volutes
  ctx.shadowBlur = size*0.01;
  ctx.fillStyle = GOLD_BRIGHT;
  [[cx-r*0.85-r, scrollY],[cx+r*0.85+r, scrollY]].forEach(([fx,fy])=>{
    ctx.beginPath(); ctx.arc(fx,fy,size*0.02,0,Math.PI*2); ctx.fill();
  });

  // médaillon en losange (même motif que la gemme du bandeau)
  const gs = size*0.11;
  ctx.beginPath();
  ctx.moveTo(cx, gemY-gs); ctx.lineTo(cx+gs*0.62, gemY); ctx.lineTo(cx, gemY+gs); ctx.lineTo(cx-gs*0.62, gemY);
  ctx.closePath();
  ctx.fillStyle = GOLD_BRIGHT; ctx.fill();
  ctx.lineWidth = size*0.015; ctx.strokeStyle = '#8a6a1e'; ctx.stroke();
  ctx.shadowBlur = 0;

  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
{
  const ornTex = makeCornerOrnamentTexture();
  const ornSize = 2.1;
  const cornerHalf = (11*CELL+0.7)/2;
  [[1,1],[-1,1],[-1,-1],[1,-1]].forEach(([sx,sz])=>{
    const mat = new THREE.MeshBasicMaterial({map:ornTex, transparent:true, depthWrite:false});
    const orn = new THREE.Mesh(new THREE.PlaneGeometry(ornSize,ornSize), mat);
    orn.rotation.x = -Math.PI/2;
    orn.rotation.z = Math.atan2(sx,sz) + Math.PI; // pointe vers l'extérieur du plateau
    orn.position.set(sx*cornerHalf, 0.025, sz*cornerHalf);
    boardGroup.add(orn);
  });
}

/* ---------- Les 40 cases ---------- */
const TILE = 0.95;
const tiles = [];

/* vitesses/amplitudes d'animation par catégorie */
const MOTION = {
  booster8:  {bob:0.10, swing:0.3},
  gradee:    {bob:0.11, swing:0.35},
  booster50: {bob:0.13, swing:0.3},
  etb:       {bob:0.15, swing:0.28},
  jackpot300:{bob:0.17, swing:0.25},
  chance:    {bob:0.12, spin:0},
  chest:     {bob:0.09, spin:0},
  prison:    {bob:0.07, pulse:true},
};

/* Matériaux/géométries partagés par les 40 cases pour le socle
   "compartiment encastré" (collerette dorée qui dépasse légèrement,
   liseré noir en retrait, rivets aux coins) — un seul jeu d'objets
   réutilisé partout, pour rester léger malgré le surcroît de détail. */
const tileGoldMat = new THREE.MeshStandardMaterial({
  color:new THREE.Color(GOLD), roughness:.32, metalness:.78,
  emissive:new THREE.Color(GOLD), emissiveIntensity:.16
});
const tileBezelMat = new THREE.MeshStandardMaterial({color:0x0a0a0a, roughness:.5, metalness:.25});
const tileCollarGeo = new THREE.BoxGeometry(TILE+0.09,0.04,TILE+0.09);
const tileBezelGeo = new THREE.BoxGeometry(TILE*0.97,0.02,TILE*0.97);
const tileRivetGeo = new THREE.CylinderGeometry(0.035,0.035,0.02,8);
const RIVET_OFFSETS = [[-1,-1],[1,-1],[-1,1],[1,1]];

// Ces trois éléments sont identiques sur les 40 cases (mêmes
// géométrie/matériau, seule la position/rotation change) : un seul
// InstancedMesh chacun plutôt que 40 (ou 160) mesh séparés, pour
// garder le rendu léger malgré le surcroît de détail.
// frustumCulled=false est indispensable ici : par défaut, Three.js
// calcule la sphère de culling d'un InstancedMesh à partir de la
// seule géométrie de base (centrée à l'origine), sans tenir compte
// de l'étalement réel des 40 instances sur tout le plateau — sans
// ça, le moteur peut faire disparaître tout le lot (collerette,
// liseré, rivets) selon l'angle de caméra, d'où des cases qui
// "deviennent noires" par intermittence en tournant la vue.
const tileCollarInst = new THREE.InstancedMesh(tileCollarGeo, tileGoldMat, 40);
tileCollarInst.castShadow = false; tileCollarInst.receiveShadow = false;
tileCollarInst.frustumCulled = false;
boardGroup.add(tileCollarInst);
const tileBezelInst = new THREE.InstancedMesh(tileBezelGeo, tileBezelMat, 40);
tileBezelInst.receiveShadow = false;
tileBezelInst.frustumCulled = false;
boardGroup.add(tileBezelInst);
const tileRivetInst = new THREE.InstancedMesh(tileRivetGeo, tileGoldMat, 40*RIVET_OFFSETS.length);
tileRivetInst.frustumCulled = false;
boardGroup.add(tileRivetInst);
const _instDummy = new THREE.Object3D();
const _yAxis = new THREE.Vector3(0,1,0);

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

  // collerette dorée qui dépasse légèrement du corps coloré : donne
  // au socle un vrai relief de "compartiment encastré" plutôt qu'une
  // simple case plate, façon coffret physique
  _instDummy.position.set(world.x, 0.10, world.z);
  _instDummy.rotation.set(0, outwardYaw(r,c), 0);
  _instDummy.updateMatrix();
  tileCollarInst.setMatrixAt(i, _instDummy.matrix);

  const accentColor = SWATCH_COLORS[catDef.swatch];
  const sideMat = new THREE.MeshStandardMaterial({
    color:new THREE.Color(accentColor),roughness:.7,metalness:.12,
    emissive:new THREE.Color(accentColor),emissiveIntensity:.32
  });
  const bodyTile = new THREE.Mesh(new THREE.BoxGeometry(TILE,0.08,TILE), sideMat);
  bodyTile.position.y = 0.16;
  bodyTile.castShadow = true;
  bodyTile.receiveShadow = true;
  group.add(bodyTile);

  // liseré noir en léger retrait entre le corps coloré et la carte,
  // avec quatre rivets dorés aux coins façon plaque vissée
  _instDummy.position.set(world.x, 0.21, world.z);
  _instDummy.updateMatrix();
  tileBezelInst.setMatrixAt(i, _instDummy.matrix);

  const rivetOffset = TILE*0.40;
  RIVET_OFFSETS.forEach(([dx,dz], k)=>{
    const local = new THREE.Vector3(dx*rivetOffset, 0.222, dz*rivetOffset);
    local.applyAxisAngle(_yAxis, outwardYaw(r,c));
    _instDummy.position.set(world.x+local.x, local.y, world.z+local.z);
    _instDummy.updateMatrix();
    tileRivetInst.setMatrixAt(i*RIVET_OFFSETS.length+k, _instDummy.matrix);
  });

  const tileTopY = 0.22;

  let faceTex;
  if(i === 0){
    // Case 1 : le joueur y démarre sans lancer, jamais de lot associé
    // à l'affichage — voir aussi updateWinButton qui bloque le côté
    // mécanique si un recul y ramène le joueur plus tard.
    faceTex = getDepartFace();
  } else if(catDef.tier === 'flat'){
    faceTex = getFlatPhotoFace(catKey, accentColor, data.isVisite ? '🔓' : null);
  } else {
    // "float" (le lot flotte déjà en carte au-dessus, la case reste
    // sobre) / "glyph" (Chance, Caisse, Prison : pas de photo, mais
    // getFlatPhotoFace dessine désormais son propre fond + symbole)
    faceTex = getFlatPhotoFace(catKey, accentColor, null);
  }
  const faceMat = new THREE.MeshBasicMaterial({map:faceTex});
  const face = new THREE.Mesh(new THREE.PlaneGeometry(TILE*0.94,TILE*0.94), faceMat);
  face.rotation.x = -Math.PI/2;
  // Marge généreuse au-dessus du liseré noir (case fixe à y=0.22,
  // non affectée par la "respiration") : la case elle-même respire
  // (group.scale.y oscille ±1.2%), donc à y=tileTopY+0.002 la carte
  // pouvait redescendre sous le liseré à chaque cycle et se faire
  // entièrement cacher par lui — d'où des cases qui semblaient
  // clignoter en noir. +0.02 reste largement au-dessus même au creux
  // de l'oscillation.
  face.position.y = tileTopY+0.02;
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
  // Case 1 (Départ) : aucune décoration flottante, même si sa catégorie
  // de fond ('booster8') en aurait normalement une — voir getDepartFace
  // plus haut, la case n'est thématiquement pas un vrai lot.
  if(i !== 0 && catDef.tier === 'float'){
    const { tex, aspect } = getFramedPhotoTexture(catKey);
    const scaleByCat = { gradee:0.5, booster50:0.6, etb:0.7, jackpot300:0.8 }[catKey] || 0.5;
    const h = scaleByCat, w = h*aspect;
    // double face : sinon la carte flottante devient invisible dès
    // qu'on regarde le plateau depuis le côté opposé (le plan tourné
    // vers l'extérieur montre alors sa face arrière, non texturée par
    // défaut avec THREE.FrontSide).
    const mat = new THREE.MeshBasicMaterial({map:tex, transparent:true, side:THREE.DoubleSide});
    floatObj = new THREE.Mesh(new THREE.PlaneGeometry(w,h), mat);
    floatObj.position.y = tileTopY + 0.32 + h*0.5;
    group.add(floatObj);
    floatBaseScale = h;
  } else if(i !== 0 && catDef.tier === 'glyph'){
    const glyphKind = data.isVisite ? 'visite' : catKey;
    floatObj = makeSprite(getGlyphTexture(glyphKind, accentColor), data.isVisite ? 0.3 : 0.6);
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
    } else if(catDef.tier==='glyph' && !data.isVisite){
      // même halo scintillant, plus discret, sous le médaillon
      // Chance/Caisse/Prison pour qu'il ne se perde pas dans le décor.
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map:goldDotTex, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, opacity:.45
      }));
      glow.position.y = tileTopY+0.05;
      glow.scale.set(0.68,0.68,0.68);
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
tileCollarInst.instanceMatrix.needsUpdate = true;
tileBezelInst.instanceMatrix.needsUpdate = true;
tileRivetInst.instanceMatrix.needsUpdate = true;

/* Index catégorie -> liste des cases correspondantes, utilisé par le
   système de lot prédéterminé (voir plus bas) pour amener visuellement
   le pion sur une case qui correspond exactement au lot déjà décidé
   d'avance, sans jamais afficher une photo qui ne correspond pas à la
   case où il est posé. */
const TILES_BY_CAT = {};
tiles.forEach((t,i)=>{ (TILES_BY_CAT[t.catKey] = TILES_BY_CAT[t.catKey] || []).push(i); });

/* ---------- Effet spécial "Carte Darkrai" (jackpot final) : le
   plateau tremble comme un petit séisme puis vole en éclats, avant
   de se reformer pile au moment où la carte apparaît avec les
   feux d'artifice de la célébration. Les éclats sont un seul
   InstancedMesh (léger), la physique est juste une chute + une
   vitesse radiale, pas une vraie fracture du maillage. ---------- */
const SHAKE_MS = 1300, SHATTER_MS = 2400, SHATTER_FADE_MS = 700;
const SHARD_ROWS = 18, SHARD_COUNT = SHARD_ROWS*SHARD_ROWS;
const shardMat = new THREE.MeshStandardMaterial({
  color:0x171208, roughness:.5, metalness:.4,
  emissive:new THREE.Color(GOLD), emissiveIntensity:.22,
  transparent:true
});
const boardShards = new THREE.InstancedMesh(new THREE.BoxGeometry(0.82,0.14,0.82), shardMat, SHARD_COUNT);
boardShards.visible = false;
boardShards.frustumCulled = false;
scene.add(boardShards);
const shardState = [];
{
  const span = 11*CELL, cell = span/SHARD_ROWS, half = (SHARD_ROWS-1)/2;
  for(let row=0; row<SHARD_ROWS; row++){
    for(let col=0; col<SHARD_ROWS; col++){
      const x0=(col-half)*cell, z0=(row-half)*cell;
      shardState.push({ x0, z0, dist:Math.hypot(x0,z0) });
    }
  }
}
const shardMaxDist = shardState.reduce((m,s)=>Math.max(m,s.dist), 1);

// éclat doré central au moment de l'impact, pour un rendu plus premium
const shatterFlash = new THREE.Sprite(new THREE.SpriteMaterial({
  map:goldDotTex, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, opacity:0
}));
shatterFlash.position.set(0, 0.4, 0);
scene.add(shatterFlash);

let shakeUntil = 0, shatterUntil = 0, shatterActive = false, shatterStartT = 0;
const _shardDummy = new THREE.Object3D();
function startBoardShatter(){
  const now = clock.getElapsedTime();
  shakeUntil = now + SHAKE_MS/1000;
  shatterUntil = shakeUntil + SHATTER_MS/1000;
  shatterActive = false;
  shardMat.opacity = 1;
  shardState.forEach(s=>{
    s.x = s.x0; s.y = 0.1; s.z = s.z0;
    s.rx = 0; s.ry = Math.random()*Math.PI; s.rz = 0;
    const ang = Math.atan2(s.z0, s.x0) + (Math.random()-0.5)*0.6;
    const spd = 1.5 + Math.random()*2.1;
    s.vx = Math.cos(ang)*spd; s.vz = Math.sin(ang)*spd;
    s.vy = 2.6 + Math.random()*2.2;
    s.vrx = (Math.random()-0.5)*4.5; s.vry = (Math.random()-0.5)*4.5; s.vrz = (Math.random()-0.5)*4.5;
    // onde de choc en cascade : le centre part en premier, les bords
    // suivent avec un léger retard, pour un éclatement qui se lit
    // bien à l'oeil plutôt qu'un "pop" instantané de toutes les pièces
    s.delay = (s.dist/shardMaxDist) * 0.32 * (SHATTER_MS/1000);
    // taille variable par éclat, pour un aspect plus organique qu'une
    // simple grille de cubes identiques
    s.sx = 0.65 + Math.random()*0.55;
    s.sy = 0.7 + Math.random()*0.5;
    s.sz = 0.65 + Math.random()*0.55;
  });
}

/* Le "Départ" n'est pas une case à part hors plateau : le joueur
   démarre directement sur la case 1 elle-même (pas de lot réclamé
   tant qu'aucun lancer n'a eu lieu). Pas de décor supplémentaire sur
   cette case : rien ne doit apparaître au-dessus. */
const START_NODE = tiles[0];

/* Dégradé doux à 4 paliers (plutôt que le noir/blanc tranché par
   défaut de MeshToonMaterial) : un ombrage plus proche d'un rendu de
   jeu mobile soigné que d'un cel-shading dur à la BD. */
let _toonGradient = null;
function toonGradient(){
  if(_toonGradient) return _toonGradient;
  const data = new Uint8Array([90,150,205,255]);
  const tex = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  tex.needsUpdate = true;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  _toonGradient = tex;
  return tex;
}

/* ---------- Pion articulé (façon dresseur, sac à dos inclus) ----------
   Rendu "toon" avec dégradé doux (au lieu du rendu plastique/PBR
   d'avant), sans contour noir — retiré après essai, jugé trop
   "autocollant" pour le rendu recherché. */
/* Pion du joueur : vrai modèle 3D animé (licence CC0, Kenney/Kay
   Lousberg — "Animated Characters"), plutôt que des formes géométriques
   assemblées à la main. Visage, cheveux, mains et vêtements sont
   sculptés ; la marche utilise la vraie animation du modèle (pilotée
   par un AnimationMixer), plus une transition douce vers l'animation
   "idle" à l'arrêt. */
const PLAYER_TARGET_HEIGHT = 0.82; // hauteur visée sur le plateau (mêmes proportions que l'ancien pion)

/* Crée immédiatement un pion "vide" (groupe + mixer/setWalking neutres)
   pour que le plateau puisse démarrer sa boucle de rendu tout de suite :
   le vrai modèle 3D est ensuite chargé en tâche de fond (voir
   loadPlayerModel ci-dessous) et vient se greffer dans `root` une fois
   prêt, sans jamais bloquer le reste du jeu si ce chargement échoue ou
   traîne (réseau lent, navigateur qui bute sur le GLB, etc.). */
function createPlayer(){
  return { root: new THREE.Group(), mixer: { update(){} }, setWalking(){} };
}

/* Charge le vrai modèle 3D animé en arrière-plan et le greffe dans le
   pion `player` déjà présent dans la scène. Ne doit jamais être await-é
   au niveau racine du script : une erreur ou une lenteur ici ne doit
   jamais empêcher le plateau de s'afficher et de tourner. */
async function loadPlayerModel(player){
  const gltf = await new Promise((resolve, reject)=>{
    new GLTFLoader().load('./assets/character/player.glb', resolve, undefined, reject);
  });
  const model = gltf.scene;

  // Redimensionne le modèle (unités d'export arbitraires) pour qu'il
  // occupe la même hauteur que l'ancien pion, et pose ses pieds
  // exactement sur y=0 (le reste du code positionne `root` au sol).
  const box = new THREE.Box3().setFromObject(model);
  const rawHeight = box.max.y - box.min.y;
  const scale = rawHeight>0 ? PLAYER_TARGET_HEIGHT/rawHeight : 1;
  model.scale.setScalar(scale);
  model.position.y = -box.min.y*scale;
  model.traverse(o=>{ if(o.isMesh){ o.castShadow = true; } });

  player.root.add(model);

  const mixer = new THREE.AnimationMixer(model);
  const clip = name => THREE.AnimationClip.findByName(gltf.animations, name);

  // La pose de repos d'origine ("idle") garde les bras à l'horizontale
  // (pose de liaison du squelette) : on corrige juste cette animation,
  // bras le long du corps, sans toucher à la marche/saut qui sont déjà
  // naturelles.
  const idleClip = clip('idle');
  if(idleClip){
    const armFix = { RightArm: 78, LeftArm: -78 };
    idleClip.tracks.forEach(track=>{
      const boneName = track.name.split('.')[0];
      const deg = armFix[boneName];
      if(!deg || !track.name.endsWith('.quaternion')) return;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1), THREE.MathUtils.degToRad(deg));
      for(let i=0;i<track.values.length;i+=4){
        const v = track.values;
        const orig = new THREE.Quaternion(v[i],v[i+1],v[i+2],v[i+3]).multiply(q);
        v[i]=orig.x; v[i+1]=orig.y; v[i+2]=orig.z; v[i+3]=orig.w;
      }
    });
  }

  const actions = {
    idle: idleClip && mixer.clipAction(idleClip),
    walk: clip('walk') && mixer.clipAction(clip('walk')),
  };
  Object.values(actions).forEach(a=>{ if(a) a.play(); });
  if(actions.idle) actions.idle.setEffectiveWeight(1);
  if(actions.walk) actions.walk.setEffectiveWeight(0);
  let activeAction = actions.idle || actions.walk;
  function setWalking(isWalking, speedScale){
    const target = isWalking ? actions.walk : actions.idle;
    if(target && target!==activeAction){
      activeAction.fadeOut(0.15);
      target.reset().fadeIn(0.15);
      activeAction = target;
    }
    if(isWalking && actions.walk) actions.walk.timeScale = Math.max(0.2, speedScale||1);
  }

  player.mixer = mixer;
  player.setWalking = setWalking;
}

const player = createPlayer();
scene.add(player.root);
loadPlayerModel(player).catch(err=>{
  console.error('Chargement du personnage 3D échoué, le plateau continue sans lui :', err);
});

/* ---------- État de jeu ---------- */
let currentIndex = -1; // -1 = au départ, pas encore sur le plateau
let moving = false;
let generation = 0;
let finished = false;
// Règle du jeu : 3 lancers par partie, +1 lancer supplémentaire à
// chaque double obtenu (cumulable). Une fois les lancers épuisés, le
// joueur garde le lot de la case où il se trouve — il ne pouvait
// jusqu'ici jamais être bloqué, ce qui laissait enchaîner des lancers
// illimités sur une seule mise.
let rollsUsed = 0;
let rollsAllowed = 3;
// Lot déjà décidé d'avance pour la partie en cours (voir le système de
// lot prédéterminé plus bas) : null tant qu'aucune mise n'a démarré.
let pendingOutcome = null;

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

/* Un dépassement de la case 40 (tirage qui va plus loin que la case
   finale) fait continuer le pion depuis la case 1, comme un tour de
   plateau complet (ex : case 33 + 10 → dépasse de 3 → case 3). Seul
   un tirage qui atterrit exactement sur la case 40 remporte le
   jackpot final. Un recul qui dépasserait la case 1 s'arrête
   simplement là (pas de tour en arrière). */
function landingIndex(fromIdx, count){
  const start = fromIdx === -1 ? 0 : fromIdx;
  return count>=0 ? (start+count) % 40 : Math.max(0, start+count);
}

function startWalk(fromIdx, count, stepDuration){
  // Le pion démarre visuellement SUR la case 1 (pas sur une case
  // "0" séparée) : un lancer de N doit donc avancer de N cases
  // PLEINES depuis la case 1, comme depuis n'importe quelle autre
  // case déjà atteinte. `count` peut être négatif (cartes "Reculez
  // de N cases"), auquel cas le pion recule case par case sans
  // dépasser la case 1. Vers l'avant, un dépassement de la case 40
  // boucle sur la case 1 (voir landingIndex).
  const startPos = fromIdx === -1 ? 0 : fromIdx;
  const dir = count >= 0 ? 1 : -1;
  const n = dir>0 ? Math.abs(count) : Math.min(Math.abs(count), startPos);
  const path = [ tiles[startPos] ];
  const indices = [ fromIdx ];
  let idx = startPos;
  let steps = 0;
  for(let i=0;i<n;i++){
    idx = dir>0 ? (idx+1)%40 : idx-1;
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
  updateCornerSafety(dt);

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
      if(walk.lastSeg >= 0) playHop();
      walk.lastSeg = segIdx;
      currentIndex = walk.indices[segIdx];
      setActive(currentIndex);
    }

    if(!reduceMotion){
      const leanTarget = -0.09*gaitAmp;
      player.root.rotation.x += (leanTarget - player.root.rotation.x)*Math.min(1,dt*10);
    }
    player.setWalking(true, gaitAmp);

    if(walk.done){
      currentIndex = walk.indices[walk.indices.length-1];
      setActive(currentIndex);
      walk = null;
    }
  } else if(!reduceMotion){
    // au repos : la marche revient doucement en position neutre,
    // l'animation "idle" du modèle prend le relais.
    player.root.rotation.x *= 0.8;
    player.setWalking(false);
  }
  player.mixer.update(dt);

  // Séisme puis éclatement du plateau (effet "Carte Darkrai")
  if(shakeUntil>0 && t<shakeUntil){
    // le tremblement monte en intensité à l'approche de l'éclatement,
    // plus lisible qu'une secousse à amplitude constante
    const progress = 1 - Math.max(0, shakeUntil-t)/(SHAKE_MS/1000);
    const mag = Math.pow(progress, 1.6) * 0.14;
    boardGroup.position.set((Math.random()-0.5)*mag, 0, (Math.random()-0.5)*mag);
    boardGroup.rotation.z = (Math.random()-0.5)*mag*0.15;
  } else if(shatterUntil>0 && t<shatterUntil){
    if(!shatterActive){
      shatterActive = true;
      shatterStartT = t;
      boardGroup.position.set(0,0,0); boardGroup.rotation.z = 0;
      boardGroup.visible = false;
      boardShards.visible = true;
      shatterFlash.scale.set(0.1,0.1,0.1);
      shatterFlash.material.opacity = 1;
    }
    const since = t - shatterStartT;
    const remain = shatterUntil - t, fadeStart = SHATTER_FADE_MS/1000;
    shardMat.opacity = remain < fadeStart ? Math.max(0, remain/fadeStart) : 1;
    shardState.forEach((s,i)=>{
      if(since >= s.delay){
        s.x += s.vx*dt; s.z += s.vz*dt; s.y += s.vy*dt; s.vy -= 6*dt;
        s.rx += s.vrx*dt; s.ry += s.vry*dt; s.rz += s.vrz*dt;
      }
      _shardDummy.position.set(s.x, s.y, s.z);
      _shardDummy.rotation.set(s.rx, s.ry, s.rz);
      _shardDummy.scale.set(s.sx, s.sy, s.sz);
      _shardDummy.updateMatrix();
      boardShards.setMatrixAt(i, _shardDummy.matrix);
    });
    boardShards.instanceMatrix.needsUpdate = true;
    if(shatterFlash.material.opacity > 0){
      shatterFlash.scale.multiplyScalar(1 + dt*9);
      shatterFlash.material.opacity = Math.max(0, shatterFlash.material.opacity - dt*3.2);
    }
  } else if(shatterUntil>0){
    boardGroup.visible = true;
    boardGroup.position.set(0,0,0); boardGroup.rotation.z = 0;
    boardShards.visible = false;
    shatterFlash.material.opacity = 0;
    shakeUntil = 0; shatterUntil = 0; shatterActive = false;
  }

  renderer.render(scene, camera);
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
const validate = document.getElementById('validate');
const resetBtn = document.getElementById('reset');
const winBtn = document.getElementById('winBtn');
const undoBtn = document.getElementById('undoBtn');
const startBtn = document.getElementById('startBtn');
const topNum = document.getElementById('topNum');
const statusEl = document.getElementById('status');
const placeBanner = document.getElementById('placeBanner');
const cardDrawOverlay = document.getElementById('cardDrawOverlay');
const cardGrid = document.getElementById('cardGrid');
const cardDrawTotal = document.getElementById('cardDrawTotal');
const impactFlash = document.getElementById('impactFlash');
const lightningBolt = document.getElementById('lightningBolt');
function triggerLightning(){
  if(!lightningBolt || reduceMotion) return;
  lightningBolt.classList.remove('strike'); void lightningBolt.offsetWidth;
  lightningBolt.classList.add('strike');
  setTimeout(()=>lightningBolt.classList.remove('strike'), 850);
}

/* ---------- Rendement cible (entièrement automatique, invisible) :
   comme le taux de reversement affiché sur une vraie machine à sous,
   le jeu vise ~50% de tout ce qui a été misé, reversé en lots, quelle
   que soit la façon dont les parties se jouent (peu de tirages ou
   beaucoup, joueur prudent ou qui pousse toujours vers le gros lot).
   À chaque lot à distribuer, si l'annoncer ferait dépasser le plafond
   cible cumulé, il redescend d'un cran vers un lot moins cher — le
   tirage reste honnête (la case/carte tirée est réellement aléatoire),
   seul le montant réellement valorisé est plafonné. Une carte commune
   reste toujours distribuée au minimum (jamais 0€ pour ne pas casser
   l'ambiance). Suivi et persistant (localStorage), sans jamais
   s'afficher. */
const TOTAL_MISE_KEY = 'pika_total_mise';
const TOTAL_PAID_KEY = 'pika_total_paid';
const AVG_MISE = 9;
const CEILING_RATIO = 0.50;  // plafond de reversement cible (~50%, vérifié par simulation)
let totalMise = parseFloat(safeGetItem(TOTAL_MISE_KEY)) || 0;
let totalPaid = parseFloat(safeGetItem(TOTAL_PAID_KEY)) || 0;
function saveTotals(){
  try{
    localStorage.setItem(TOTAL_MISE_KEY, String(totalMise));
    localStorage.setItem(TOTAL_PAID_KEY, String(totalPaid));
  }catch(e){}
}

/* Bouton "Démarrage cagnotte" : repart d'un compteur vierge pour un nouveau
   direct, puis disparaît pour ne pas être recliqué par erreur en
   cours de stream. Réapparaît au prochain chargement de page. */
const resetBankBtn = document.getElementById('resetBankBtn');
const bankResetFlash = document.getElementById('bankResetFlash');
let bankResetFlashTimer = null;
function flashBankResetToken(){
  if(!bankResetFlash) return;
  clearTimeout(bankResetFlashTimer);
  bankResetFlash.classList.remove('show');
  void bankResetFlash.offsetWidth; // relance l'animation même en rafale
  bankResetFlash.classList.add('show');
  bankResetFlashTimer = setTimeout(()=>{ bankResetFlash.classList.remove('show'); }, 1400);
}
if(resetBankBtn) resetBankBtn.addEventListener('click', ()=>{
  totalMise = 0;
  totalPaid = 0;
  saveTotals();
  resetOutcomeBatch();
  resetBankBtn.hidden = true;
  flashBankResetToken();
  clearWinUndo();
});

/* Paliers du plus cher au moins cher : un lot qui ferait dépasser le
   plafond de reversement cumulé redescend au premier palier qui
   passe encore sous ce plafond. */
const PAYOUT_LADDER = [
  { cat:'jackpot300', cost:300 },
  { cat:'etb',         cost:150 },
  { cat:'booster50',   cost:50  },
  { cat:'gradee',      cost:26  },
  { cat:'booster8',    cost:8   },
  { cat:'alternative', cost:7.2 },
  { cat:'commune',     cost:0.68 },
];
const LADDER_IDX = {};
PAYOUT_LADDER.forEach((t,i)=>{ LADDER_IDX[t.cat] = i; });

function fundedCategory(catKey){
  const startIdx = LADDER_IDX[catKey];
  if(startIdx===undefined) return catKey;
  for(let i=startIdx;i<PAYOUT_LADDER.length;i++){
    const tier = PAYOUT_LADDER[i];
    const projected = totalMise>0 ? (totalPaid+tier.cost)/totalMise : 0;
    if(projected <= CEILING_RATIO || i===PAYOUT_LADDER.length-1){
      totalPaid += tier.cost;
      saveTotals();
      return tier.cat;
    }
  }
  return catKey;
}

/* ---------- Lot prédéterminé (façon carte à gratter / machine à sous)
   ----------
   Les dés, les lancers et l'animation du pion restent un vrai spectacle
   (rien n'est truqué visuellement), mais le lot réellement remporté à
   chaque mise ne dépend plus de la case où le hasard des dés amène le
   pion : il est tiré à l'avance, dans un LOT (batch) de résultats déjà
   calculé et mélangé pour respecter exactement le taux de reversement
   cible (CEILING_RATIO), plutôt que de dépendre d'une moyenne sur le
   long terme qui peut dériver (cf. simulation : ~130% de reversement
   moyen avec des dés honnêtes sur ce plateau, très au-dessus des 50%
   visés, à cause des cases ETB/jackpot final à elles seules). À la fin
   de la partie, le pion est amené sur une case qui correspond VRAIMENT
   au lot déjà décidé, pour que la photo affichée corresponde toujours
   exactement à la case sur laquelle il est posé. */
const OUTCOME_BATCH_KEY = 'pika_outcome_batch';
const OUTCOME_BATCH_SIZE = 1000;
// Proportions calibrées (vérifiées par simulation) pour que la moyenne
// du lot sur l'ensemble du batch tombe autour de CEILING_RATIO (50%) de
// la mise moyenne (9€) : gros lots très rares, lots moyens raisonnables,
// une case "prison" (aucun lot) et le reste en commune.
const OUTCOME_RECIPE = [
  { cat:'jackpot300',  p:0.001 },
  { cat:'etb',         p:0.004 },
  { cat:'booster50',   p:0.01  },
  { cat:'gradee',      p:0.038 },
  { cat:'booster8',    p:0.095 },
  { cat:'alternative', p:0.13  },
  { cat:'prison',      p:0.15  },
  // le reste (~57%) part en commune, calculé plus bas
];

// Coût réel de chaque catégorie (PAYOUT_LADDER + prison, qui n'y
// figure pas puisqu'il ne coûte jamais rien).
const OUTCOME_COST = { prison: 0 };
PAYOUT_LADDER.forEach(t=>{ OUTCOME_COST[t.cat] = t.cost; });

function buildOutcomeBatch(size){
  const counts = {};
  let assigned = 0;
  OUTCOME_RECIPE.forEach(r=>{
    const n = Math.round(r.p*size);
    counts[r.cat] = n;
    assigned += n;
  });
  counts.commune = Math.max(0, size-assigned);
  const remaining = [];
  Object.keys(counts).forEach(cat=>{
    for(let i=0;i<counts[cat];i++) remaining.push(cat);
  });

  // Séquencement sous contrainte de solvabilité : un mélange au hasard
  // pur ne garantit le taux de reversement que sur l'ENSEMBLE du lot —
  // rien n'empêcherait alors un gros lot (ETB, jackpot final) de
  // tomber dès la 10e partie, quand seulement ~90€ de mises sont
  // encaissées. Ici, à chaque position du lot, on ne tire au hasard
  // que parmi les résultats restants qui tiennent ENCORE sous le
  // plafond de reversement calculé sur les mises déjà "encaissées"
  // jusqu'à cette position précise : impossible qu'un gros lot sorte
  // avant d'avoir été effectivement couvert par assez de mises.
  const arr = [];
  let cumMise = 0, cumPaid = 0;
  for(let pos=0; pos<size; pos++){
    cumMise += AVG_MISE;
    const headroom = cumMise*CEILING_RATIO - cumPaid;
    const eligible = [];
    for(let i=0;i<remaining.length;i++){
      if(OUTCOME_COST[remaining[i]] <= headroom) eligible.push(i);
    }
    let pickAt;
    if(eligible.length){
      pickAt = eligible[Math.floor(Math.random()*eligible.length)];
    } else {
      // Filet de sécurité (ne devrait jamais arriver avec la recette
      // calibrée) : on place le moins cher restant plutôt que de
      // risquer de dépasser le plafond.
      pickAt = 0;
      for(let i=1;i<remaining.length;i++){
        if(OUTCOME_COST[remaining[i]] < OUTCOME_COST[remaining[pickAt]]) pickAt = i;
      }
    }
    const cat = remaining.splice(pickAt,1)[0];
    cumPaid += OUTCOME_COST[cat];
    arr.push(cat);
  }
  return arr;
}

function loadOutcomeState(){
  try{
    const raw = safeGetItem(OUTCOME_BATCH_KEY);
    if(raw){
      const parsed = JSON.parse(raw);
      if(parsed && Array.isArray(parsed.batch) && typeof parsed.pos==='number' && parsed.pos < parsed.batch.length){
        return parsed;
      }
    }
  }catch(e){}
  return { batch: buildOutcomeBatch(OUTCOME_BATCH_SIZE), pos: 0 };
}
let outcomeState = loadOutcomeState();
function saveOutcomeState(){
  try{ localStorage.setItem(OUTCOME_BATCH_KEY, JSON.stringify(outcomeState)); }catch(e){}
}
// Un nouveau lot de résultats est régénéré automatiquement à
// l'épuisement du précédent (jamais de rupture de stock) et à chaque
// remise à zéro de la cagnotte (nouveau direct = nouveau lot).
function nextPredeterminedOutcome(){
  if(outcomeState.pos >= outcomeState.batch.length){
    outcomeState = { batch: buildOutcomeBatch(OUTCOME_BATCH_SIZE), pos: 0 };
  }
  const cat = outcomeState.batch[outcomeState.pos];
  outcomeState.pos++;
  saveOutcomeState();
  return cat;
}
function resetOutcomeBatch(){
  outcomeState = { batch: buildOutcomeBatch(OUTCOME_BATCH_SIZE), pos: 0 };
  saveOutcomeState();
}

/* ---------- Mise en scène du tirage : suspense sonore/visuel autour
   du tirage honnête existant (aucun impact sur le résultat, juste du
   spectacle). Sons synthétisés en direct via Web Audio, pas de
   fichier externe à charger. ---------- */
let audioCtx = null;
function getAudioCtx(){
  if(reduceMotion) return null;
  try{
    if(!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
    if(audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }catch(e){ return null; }
}
function playRiser(durationMs){
  const ctx = getAudioCtx(); if(!ctx) return;
  try{
    const now = ctx.currentTime, dur = durationMs/1000;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(170, now);
    osc.frequency.exponentialRampToValueAtTime(760, now+dur);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.22, now+dur*0.88);
    gain.gain.exponentialRampToValueAtTime(0.0001, now+dur+0.12);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(now); osc.stop(now+dur+0.15);
  }catch(e){}
}
function playImpact(){
  const ctx = getAudioCtx(); if(!ctx) return;
  try{
    const now = ctx.currentTime;
    const bufSize = Math.floor(ctx.sampleRate*0.18);
    const buffer = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for(let i=0;i<bufSize;i++){ data[i] = (Math.random()*2-1) * (1-i/bufSize); }
    const noise = ctx.createBufferSource(); noise.buffer = buffer;
    const lowpass = ctx.createBiquadFilter(); lowpass.type='lowpass'; lowpass.frequency.value=1100;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.32, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now+0.18);
    noise.connect(lowpass); lowpass.connect(gain); gain.connect(ctx.destination);
    noise.start(now);
  }catch(e){}
}
/* Petit "tap" à chaque case franchie pendant le déplacement du pion
   — pitch légèrement aléatoire à chaque fois pour ne pas devenir
   monotone sur un grand déplacement. */
function playHop(){
  const ctx = getAudioCtx(); if(!ctx) return;
  try{
    const now = ctx.currentTime;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'triangle';
    const freq = 300 + Math.random()*70;
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq*0.6, now+0.08);
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now+0.09);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(now); osc.stop(now+0.1);
  }catch(e){}
}
/* "Cha-ching" façon pièces qui tombent, à la validation d'un lot. */
function playCoin(){
  const ctx = getAudioCtx(); if(!ctx) return;
  try{
    const now = ctx.currentTime;
    [[1180,0],[1760,0.07]].forEach(([freq,delay])=>{
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now+delay);
      gain.gain.setValueAtTime(0.0001, now+delay);
      gain.gain.exponentialRampToValueAtTime(0.26, now+delay+0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now+delay+0.3);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now+delay); osc.stop(now+delay+0.32);
    });
  }catch(e){}
}
/* Fanfare qui s'étoffe avec le niveau du lot (1 = juste le cha-ching,
   5 = arpège complet en plus). */
function playFanfare(level){
  playCoin();
  const ctx = getAudioCtx(); if(!ctx || level<3) return;
  try{
    const now = ctx.currentTime;
    const notes = level>=5 ? [523.25,659.25,783.99,1046.5] : [523.25,659.25,783.99];
    notes.forEach((freq,i)=>{
      const delay = 0.16 + i*0.1;
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now+delay);
      gain.gain.setValueAtTime(0.0001, now+delay);
      gain.gain.exponentialRampToValueAtTime(0.2, now+delay+0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now+delay+0.5);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now+delay); osc.stop(now+delay+0.52);
    });
  }catch(e){}
}
/* Punch-zoom caméra via le champ de vision (pas la position) pour ne
   jamais entrer en conflit avec OrbitControls (auto-rotation, zoom
   utilisateur en cours, etc.). */
function cameraPunch(){
  if(reduceMotion) return;
  const baseFov = camera.fov;
  const punchFov = baseFov*0.93;
  const start = performance.now();
  const outDur=140, holdDur=60, inDur=260, total=outDur+holdDur+inDur;
  cameraPunchActive = true;
  function step(now){
    const el = now-start;
    if(el>=total){ camera.fov = baseFov; camera.updateProjectionMatrix(); cameraPunchActive = false; return; }
    let fov;
    if(el<outDur) fov = baseFov + (punchFov-baseFov)*(el/outDur);
    else if(el<outDur+holdDur) fov = punchFov;
    else fov = punchFov + (baseFov-punchFov)*((el-outDur-holdDur)/inDur);
    camera.fov = fov; camera.updateProjectionMatrix();
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
function triggerImpactFlash(){
  if(!impactFlash || reduceMotion) return;
  impactFlash.classList.add('hit');
  setTimeout(()=>impactFlash.classList.remove('hit'), 90);
}
function revealImpact(){
  playImpact();
  cameraPunch();
  triggerImpactFlash();
}

/* Version courte pour la bannière (case 40 : le nom complet "Ligue
   Pokémon — Salle du Champion" est trop long pour tenir, la partie
   utile est "Salle du Champion"). placeLabel() garde le nom complet
   pour le texte de statut, qui a plus de place. */
function shortPlaceName(idx){
  if(idx<0) return 'Départ';
  if(idx===39) return 'Salle du Champion';
  return POKEMON_PLACES[idx];
}

/* Préposition naturelle pour "Rendez-vous ..." selon le lieu (vide =
   simple virgule façon "Rendez-vous, Azuria" pour les villes/routes ;
   "au"/"à la"/"à l'" pour les lieux génériques qui en ont besoin,
   ex. "Rendez-vous au Centre Pokémon"). Indices alignés sur
   POKEMON_PLACES. */
const PLACE_PREP = [
  /* 0 Bourg Palette */                        '',
  /* 1 Route 1 */                              '',
  /* 2 Jadielle */                             '',
  /* 3 Centre Pokémon */                       'au ',
  /* 4 Forêt de Jade */                        'à la ',
  /* 5 Mont Sélénite */                        'au ',
  /* 6 Argenta */                              '',
  /* 7 Azuria */                               '',
  /* 8 Cascade d'Azuria */                     'à la ',
  /* 9 Carmin-sur-Mer */                       '',
  /* 10 Route 24 */                            '',
  /* 11 Lavanville */                          '',
  /* 12 Tour Pokémon */                        'à la ',
  /* 13 Zone Safari */                         'à la ',
  /* 14 Céladopole */                          '',
  /* 15 Casino de Céladopole */                'au ',
  /* 16 Fuchsia */                             '',
  /* 17 Île Écume */                           "à l'",
  /* 18 Parmanie */                            '',
  /* 19 Manoir Pokémon */                      'au ',
  /* 20 Île Cramoisie */                       "à l'",
  /* 21 Route 21 */                            '',
  /* 22 Doublonville */                        '',
  /* 23 Centrale Électrique */                 'à la ',
  /* 24 Ligue Pokémon */                       'à la ',
  /* 25 Plateau Indigo */                      'au ',
  /* 26 Grotte Taupiqueur */                   'à la ',
  /* 27 Route 11 */                            '',
  /* 28 Chenaptôme */                          '',
  /* 29 Verdaphage */                          '',
  /* 30 Bourg Geon */                          '',
  /* 31 Écorcia */                             '',
  /* 32 Rosalia */                             '',
  /* 33 Cerisia */                             '',
  /* 34 Blackthorn */                          '',
  /* 35 Route 46 */                            '',
  /* 36 Grotte Sombre */                       'à la ',
  /* 37 Antre Draco */                         "à l'",
  /* 38 Salle du Conseil des 4 */              'à la ',
  /* 39 Ligue Pokémon — Salle du Champion */   'à la ',
];
function placePhrase(idx){
  const name = shortPlaceName(idx);
  const prep = PLACE_PREP[idx] || '';
  return prep ? ' '+prep+name : ', '+name;
}

let placeBannerGen = 0;
/* Certains lieux donnent un texte long ("Rendez-vous à la Ligue
   Pokémon — Salle du Champion") qui déborderait du bandeau à taille
   fixe — on repart de la taille CSS max à chaque nouveau texte, puis
   on réduit tant que ça dépasse la largeur disponible. */
function fitPlaceBanner(){
  if(!placeBanner) return;
  placeBanner.style.fontSize = '';
  const wrap = placeBanner.parentElement;
  if(!wrap) return;
  const maxW = wrap.clientWidth*0.96;
  let size = parseFloat(getComputedStyle(placeBanner).fontSize);
  let guard = 0;
  while(placeBanner.scrollWidth > maxW && size > 13 && guard < 40){
    size -= 1;
    placeBanner.style.fontSize = size+'px';
    guard++;
  }
}
/* Le nom du lieu reste affiché en grand tant que le pion y est —
   on ne fait un fondu (sortie/entrée) que lors d'un changement de
   case, pas une simple apparition éclair qui disparaît toute seule. */
function updatePlaceBanner(idx, traveling){
  if(!placeBanner) return;
  const gen = ++placeBannerGen;
  const nextText = traveling ? '➜ '+shortPlaceName(idx) : (idx<0 ? 'Départ' : '📍 Rendez-vous'+placePhrase(idx));
  const applyText = ()=>{
    if(gen !== placeBannerGen) return;
    placeBanner.textContent = nextText;
    fitPlaceBanner();
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

  // Suspense : les 2 cartes qui vont être retournées se mettent à
  // luire avant la révélation, avec un son qui monte en tension —
  // aucune incidence sur le tirage, déjà déterminé au-dessus.
  cardEls[s1].classList.add('suspense');
  cardEls[s2].classList.add('suspense');
  playRiser(680);
  await wait(680);
  cardEls[s1].classList.remove('suspense');
  cardEls[s2].classList.remove('suspense');

  cardEls[s1].classList.add('flipped');
  cardEls[s2].classList.add('flipped');
  await wait(700);
  revealImpact();
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
  // La case 1 (Départ) n'offre jamais de lot, même si un recul (carte
  // Chance) y ramène le joueur plus tard en cours de partie.
  const onPrize = currentIndex>0 && !moving;
  const cat = onPrize ? tiles[currentIndex].catKey : null;
  // Chance / Caisse Communautaire se révèlent tout seuls (pas de
  // bouton à cliquer, la partie continue automatiquement après).
  const autoResolved = cat==='chance' || cat==='chest';
  winBtn.hidden = !onPrize || autoResolved;
  if(onPrize && !autoResolved){
    winBtn.disabled = false;
    winBtn.textContent = cat==='prison' ? '💀 FIN DE PARTIE' : '🎉 LOT REMPORTÉ';
    winBtn.dataset.tier = cat;
    // Dès l'arrivée sur la case, on montre le lot en grand au milieu
    // du plateau (avant même de décider de le garder), pour qu'il
    // soit lisible en filmant. Il ne disparaît que si l'animateur
    // relance un tirage (il continue), et reste affiché si le lot
    // est validé, jusqu'au prochain "RECOMMENCER".
    if(cat!=='prison') showLotPreview(cat);
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
  const destIdx = landingIndex(currentIndex, count);
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
  updateWinButton();
  const rollsExhausted = rollsUsed>=rollsAllowed;
  const finalCat = currentIndex>=0 ? tiles[currentIndex].catKey : null;
  const canClaim = currentIndex>0 && finalCat!=='chance' && finalCat!=='chest';
  if(rollsExhausted && !finished && canClaim){
    // Plus aucun lancer possible et le joueur n'a pas choisi de
    // s'arrêter avant : la règle du jeu dit qu'il garde alors le lot
    // sur lequel il est resté — validé automatiquement, sans action
    // de l'animateur.
    statusEl.textContent = 'Plus de lancer disponible (3 lancers, +1 par double) — le lot est automatiquement remporté.';
    await claimCurrentLot();
  } else {
    validate.disabled = finished || rollsExhausted;
  }
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
    const expectedIdx = landingIndex(idx, card.effect.delta);
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
  rollsUsed = 0;
  rollsAllowed = 3;
  pendingOutcome = null;
  walk = null;
  currentIndex = -1;
  player.root.scale.set(1,1,1);
  player.root.rotation.x = 0;
  player.setWalking(false);
  placeTokenInstant(-1);
  setActive(-1);
  statusEl.textContent = 'Le joueur est prêt sur Départ.';
  updatePlaceBanner(-1, false);
  topNum.textContent = '—';
  validate.disabled = false;
  if(winBtn) winBtn.hidden = true;
  clearCelebration();
  clearWinUndo();
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
  if(moving || finished || rollsUsed>=rollsAllowed) return;
  // Premier lancer d'une partie (le pion est encore sur Départ) : une
  // partie complète = une mise, créditée automatiquement à la
  // cagnotte interne, sans aucune saisie manuelle.
  if(currentIndex===-1){
    totalMise += AVG_MISE;
    saveTotals();
    // Le lot de cette mise est décidé maintenant, tiré du lot
    // pré-calculé — les dés qui vont suivre restent honnêtes à
    // l'écran, mais ne décident plus du lot réellement remporté.
    pendingOutcome = nextPredeterminedOutcome();
  }
  // On continue plutôt que de garder le lot affiché : l'aperçu (ou le
  // lot validé) de la case précédente s'efface avant le nouveau tirage.
  clearCelebration();
  clearWinUndo();
  validate.disabled = true;
  const draw = computeCardDraw();
  // Règle des 3 lancers (+1 par double, cumulable) : consommé dès le
  // lancer effectué, pas seulement à la validation du lot, sinon un
  // joueur pourrait enchaîner les lancers sans jamais les épuiser tant
  // qu'il ne valide rien.
  rollsUsed++;
  if(draw.isDouble) rollsAllowed++;
  broadcastSync({type:'draw', draw});
  topNum.textContent = draw.total;
  await playCardDrawAnimation(draw);
  await move(draw.total);
}

validate.addEventListener('click', drawAndMove);
resetBtn.addEventListener('click', restart);
if(startBtn) startBtn.addEventListener('click', startGame);
/* "Annuler le dernier lot" : filet de sécurité pour un mauvais clic
   sur LOT REMPORTÉ pendant un direct. Reste disponible jusqu'au
   prochain tirage/redémarrage, pas juste quelques secondes — le
   temps que l'animatrice remarque l'erreur en filmant. */
let lastWinUndo = null;
function clearWinUndo(){
  lastWinUndo = null;
  if(undoBtn) undoBtn.hidden = true;
}

/* Valider un lot (bouton "LOT REMPORTÉ", ou automatique quand les
   lancers sont épuisés) MET FIN au tour : "s'arrêter pour garder le
   lot" et "continuer à lancer" sont mutuellement exclusifs — sinon un
   joueur pourrait valider un lot puis continuer à lancer et en
   valider un second sur la même mise, ce qui double la rentabilité
   attendue par mise. */
/* Amène visuellement le pion sur une case qui correspond VRAIMENT au
   lot déjà décidé d'avance (pendingOutcome), quand la case sur
   laquelle les dés l'ont posé ne correspond pas. La case la plus
   proche en avançant (avec bouclage case 40 -> case 1, comme un tour
   de plateau normal) est choisie, puis le pion y marche visuellement
   à vitesse accélérée — jamais de téléportation silencieuse — pour
   que la photo affichée corresponde toujours exactement à la case sur
   laquelle il est posé. */
async function forceOutcomeArrival(targetCat){
  if(!targetCat || currentIndex<0) return;
  if(tiles[currentIndex].catKey === targetCat) return;
  const candidates = TILES_BY_CAT[targetCat];
  if(!candidates || !candidates.length) return;
  let best = candidates[0], bestDist = Infinity;
  candidates.forEach(idx=>{
    const dist = ((idx - currentIndex) % 40 + 40) % 40;
    const d = dist===0 ? 40 : dist;
    if(d < bestDist){ bestDist = d; best = idx; }
  });
  moving = true;
  const myGen = ++generation;
  if(winBtn) winBtn.hidden = true;
  statusEl.textContent = 'Le pion termine sa course vers '+placeLabel(best)+'…';
  updatePlaceBanner(best, true);
  // Distance variable (1 à 39 cases) ramenée à une durée totale à peu
  // près constante : une simple correction de fin de partie ne doit
  // jamais sembler plus longue qu'un lancer de dés normal.
  const targetTotal = 1.4;
  const stepDuration = Math.min(HOP_DURATION, Math.max(0.045, targetTotal/bestDist));
  const w = startWalk(currentIndex, bestDist, stepDuration);
  await wait(w.totalTime*1000 + 30);
  if(myGen!==generation) return;
  currentIndex = best;
  walk = null;
  placeTokenInstant(best);
  setActive(best);
  updatePlaceBanner(best, false);
  if(targetCat==='jackpot300'){
    statusEl.textContent = '🏆 Arrivé à '+placeLabel(39)+' — JACKPOT FINAL !';
    finished = true;
  } else {
    statusEl.textContent = 'Le joueur est arrivé à '+placeLabel(currentIndex)+' !';
  }
  moving = false;
  if(winBtn) winBtn.hidden = false;
}

async function claimCurrentLot(){
  if(currentIndex<0 || (winBtn && winBtn.disabled)) return;
  if(winBtn) winBtn.disabled = true;
  if(validate) validate.disabled = true;
  // Filet de sécurité EN DIRECT, en plus de la construction du lot déjà
  // sûre par elle-même : si la cagnotte réelle n'a pas encore
  // effectivement encaissé assez pour couvrir ce lot précis (petits
  // lots Chance/Caisse déjà distribués entre-temps, partie
  // recommencée sans avoir validé, etc.), ce lot est reporté à plus
  // tard dans la file et remplacé par un lot sûr pour cette mise —
  // jamais un lot qui ferait dépasser le plafond de reversement en vrai.
  let outcomeToAward = pendingOutcome;
  if(pendingOutcome && OUTCOME_COST[pendingOutcome]!==undefined){
    const projected = totalMise>0 ? (totalPaid+OUTCOME_COST[pendingOutcome])/totalMise : 0;
    if(projected > CEILING_RATIO){
      outcomeState.batch.splice(outcomeState.pos, 0, pendingOutcome);
      saveOutcomeState();
      outcomeToAward = 'commune';
    }
  }
  // Le lot réellement remporté est celui décidé d'avance pour cette
  // mise — si le pion n'est pas déjà sur une case correspondante, il y
  // est amené visuellement avant l'annonce, pour ne jamais réafficher
  // une photo qui ne correspond pas à sa case. Diffusé à l'écran public
  // AVANT d'attendre l'animation : sinon son propre pion resterait sur
  // l'ancienne case pendant que le message "celebrate" lui dirait déjà
  // d'afficher la photo du nouveau lot — retour du bug photo/case qui
  // ne correspondent pas, mais cette fois sur l'écran secondaire.
  broadcastSync({type:'forceArrival', targetCat:outcomeToAward});
  await forceOutcomeArrival(outcomeToAward);
  const realCat = tiles[currentIndex].catKey;
  // Le plafond de reversement continue de calculer et suivre le
  // pourcentage payé exactement comme avant (mêmes 50%, même formule),
  // mais on affiche et on remet toujours le vrai lot de la case tirée,
  // jamais une version dégradée vers un palier moins cher.
  const paidBefore = totalPaid;
  const rollsUsedBefore = rollsUsed;
  fundedCategory(realCat);
  celebrate(realCat, null, {locked:true});
  broadcastSync({type:'celebrate', catKey:realCat});
  lastWinUndo = { amountAdded: totalPaid - paidBefore, rollsUsedBefore };
  if(undoBtn) undoBtn.hidden = false;
  // Un lot gardé épuise le tour : plus aucun lancer sur cette mise.
  rollsUsed = rollsAllowed;
  if(winBtn) winBtn.disabled = true;
  validate.disabled = true;
}

if(winBtn) winBtn.addEventListener('click', claimCurrentLot);

if(undoBtn) undoBtn.addEventListener('click', ()=>{
  if(!lastWinUndo) return;
  totalPaid = Math.max(0, totalPaid - lastWinUndo.amountAdded);
  saveTotals();
  if(lastResults.length){ lastResults.shift(); renderResultsTicker(); }
  clearCelebration();
  celebLocked = false;
  // Annuler un lot validé par erreur redonne aussi le tour : sinon le
  // joueur resterait bloqué sans lancer alors qu'aucun lot n'a
  // réellement été gardé.
  rollsUsed = lastWinUndo.rollsUsedBefore;
  if(!finished) validate.disabled = (rollsUsed>=rollsAllowed);
  clearWinUndo();
  updateWinButton();
  statusEl.textContent = 'Dernière validation annulée — le lot de '+placeLabel(currentIndex)+' reste à distribuer.';
});

/* Raccourcis clavier pour piloter le jeu sans viser précisément les
   boutons à l'écran (pratique en filmant en direct) : A = démarrer,
   B = tirer les cartes, C = recommencer la partie, D = valider le lot
   remporté, E = démarrage cagnotte (remet la cagnotte à 0€), Z = annuler
   le dernier lot validé par erreur. Ignorés si on est en train de taper
   dans un champ de texte. */
window.addEventListener('keydown', (e)=>{
  const tag = (document.activeElement && document.activeElement.tagName) || '';
  if(tag==='INPUT' || tag==='TEXTAREA') return;
  const k = e.key.toLowerCase();
  if(k==='a'){ if(startBtn && !startBtn.hidden) startBtn.click(); }
  else if(k==='b'){ if(!validate.disabled) validate.click(); }
  else if(k==='c'){ resetBtn.click(); }
  else if(k==='d'){ if(winBtn && !winBtn.hidden) winBtn.click(); }
  else if(k==='e'){ if(resetBankBtn && !resetBankBtn.hidden) resetBankBtn.click(); }
  else if(k==='z'){ if(undoBtn && !undoBtn.hidden) undoBtn.click(); }
});

if(syncChannel && isDisplay){
  syncChannel.onmessage = (e)=>{
    const m = e.data || {};
    if(m.type==='draw'){ topNum.textContent = m.draw.total; playCardDrawAnimation(m.draw); }
    else if(m.type==='move') move(m.count, m.card);
    else if(m.type==='forceArrival') forceOutcomeArrival(m.targetCat);
    else if(m.type==='celebrate') celebrate(m.catKey);
    else if(m.type==='restart') restart();
    else if(m.type==='start') startGame();
  };
}

const openDisplayBtn = document.getElementById('openDisplayBtn');
if(openDisplayBtn){
  // Un vrai lien <a target="_blank"> plutôt qu'un window.open() : sur
  // mobile et dans les navigateurs intégrés (in-app), une fenêtre
  // ouverte par script est très souvent bloquée silencieusement,
  // alors qu'un vrai lien cliqué par l'utilisateur passe presque
  // toujours.
  const url = new URL(location.href);
  url.searchParams.set('view','display');
  openDisplayBtn.href = url.toString();
  const fallbackInput = document.getElementById('openDisplayUrl');
  if(fallbackInput) fallbackInput.value = url.toString();
}
[validate,resetBtn,winBtn,startBtn,undoBtn].forEach(btn=>{
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
const celebPhoto = document.getElementById('celebPhoto');

/* Bandeau "derniers gains" affiché sur l'écran public : chaque
   camp (contrôle et affichage) reçoit exactement les mêmes appels
   à celebrate(), donc chacun peut construire sa propre liste en
   toute autonomie, sans message de sync supplémentaire. */
const resultsTicker = document.getElementById('resultsTicker');
let lastResults = [];
function renderResultsTicker(){
  if(!resultsTicker) return;
  resultsTicker.innerHTML = '';
  lastResults.forEach((r,i)=>{
    const item = document.createElement('div');
    item.className = 'ticker-item' + (i===0 ? ' new' : '');
    const img = document.createElement('img');
    img.src = r.url; img.alt = '';
    item.appendChild(img);
    resultsTicker.appendChild(item);
  });
}
function pushResult(catKey){
  const url = LOT_IMAGE_URLS[catKey];
  if(!url || !resultsTicker) return;
  lastResults = [{catKey,url}, ...lastResults].slice(0,5);
  renderResultsTicker();
}
let celebCtx = celebCanvas ? celebCanvas.getContext('2d') : null;
let celebParticles = [], celebRockets = [], celebRAF = null, celebEndAt = 0, celebLocked = false;
// Compteur de génération : la carte Darkrai (jackpot300) affiche son
// verdict après un délai (tremblement + éclats du plateau). Si entre
// temps l'animateur relance une partie ou valide un autre lot, ce
// jeton empêche l'affichage différé, désormais périmé, d'écraser plus
// tard la photo du lot réellement à l'écran avec celle du jackpot.
let celebGen = 0;

function resizeCelebCanvas(){
  if(!celebCanvas) return;
  celebCanvas.width = window.innerWidth;
  celebCanvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCelebCanvas, {passive:true});

/* Vrai feu d'artifice : une fusée part du bas de l'écran avec une
   traînée, ralentit en montant, puis éclate en boule à l'apex avec
   un flash lumineux + des étincelles qui retombent. Plusieurs fusées
   sont lancées en décalé pour un petit spectacle, pas un simple
   confetti qui tombe d'un point fixe. */
function spawnFirework(x, y, level, colors){
  const cols = colors || (level>=4 ? ['#ffe27a','#fff2c2','#ffffff','#ffd200'] : ['#ffe27a','#e0323f','#1a56db','#ffffff']);
  const count = 26 + level*10;
  celebParticles.push({
    x, y, px:x, py:y, vx:0, vy:0, g:0, size: 26+level*7, color:'#fff6d8',
    life:1, decay:0.085, shape:'flash', rot:0, vr:0, spark:false
  });
  for(let i=0;i<count;i++){
    const ang = (i/count)*Math.PI*2 + (Math.random()-0.5)*0.3;
    const spd = (2.3+Math.random()*3)*(1+level*0.12);
    const isSpark = Math.random() < 0.4;
    celebParticles.push({
      x, y, px:x, py:y, vx:Math.cos(ang)*spd, vy:Math.sin(ang)*spd,
      g: 0.09+Math.random()*0.035, size: isSpark ? 1.6+Math.random()*1.6 : 2.6+Math.random()*3.2,
      color: cols[(Math.random()*cols.length)|0], life:1, decay: 0.011+Math.random()*0.009,
      shape: isSpark ? 'spark' : (Math.random()<0.5?'rect':'circle'), rot:Math.random()*Math.PI, vr:(Math.random()-0.5)*0.3,
      spark:isSpark
    });
  }
}

function launchFireworksShow(level){
  if(!celebCanvas) return;
  const palettes = level>=4
    ? [['#ffe27a','#fff2c2','#ffffff','#ffd200'], ['#ffb347','#ffe27a','#ffffff']]
    : [['#ffe27a','#e0323f','#1a56db','#ffffff'], ['#1a56db','#ffffff','#ffe27a']];
  const W = celebCanvas.width, H = celebCanvas.height;
  const rocketCount = 2 + level;
  for(let i=0;i<rocketCount;i++){
    setTimeout(()=>{
      const x = W*(0.18+Math.random()*0.64);
      const y1 = H*(0.22+Math.random()*0.2);
      const colors = palettes[(Math.random()*palettes.length)|0];
      celebRockets.push({
        x, y:H*1.05, y0:H*1.05, y1, px:x, py:H*1.05,
        start: performance.now(), dur: 480+Math.random()*220,
        exploded:false, level, colors
      });
      if(!celebRAF) celebFrame();
    }, i*(200+Math.random()*140));
  }
}

function celebFrame(){
  if(!celebCtx) return;
  const W = celebCanvas.width, H = celebCanvas.height;
  celebCtx.clearRect(0,0,W,H);

  const now = performance.now();
  celebRockets.forEach(r=>{
    const frac = Math.min(1, (now - r.start) / r.dur);
    const eased = 1 - Math.pow(1-frac, 2);
    r.py = r.y;
    r.y = r.y0 + (r.y1 - r.y0) * eased;
    if(frac >= 1 && !r.exploded){
      r.exploded = true;
      spawnFirework(r.x, r.y1, r.level, r.colors);
    }
  });
  celebCtx.save();
  celebCtx.globalCompositeOperation = 'lighter';
  celebRockets.forEach(r=>{
    if(r.exploded) return;
    celebCtx.globalAlpha = 0.9;
    celebCtx.strokeStyle = r.colors[0]; celebCtx.lineWidth = 2;
    celebCtx.beginPath(); celebCtx.moveTo(r.x,r.py); celebCtx.lineTo(r.x,r.y); celebCtx.stroke();
    celebCtx.fillStyle = '#fff6d8';
    celebCtx.beginPath(); celebCtx.arc(r.x,r.y,2.2,0,Math.PI*2); celebCtx.fill();
  });
  celebCtx.restore();
  celebRockets = celebRockets.filter(r=>!r.exploded);

  celebParticles.forEach(p=>{
    p.px = p.x; p.py = p.y;
    p.x += p.vx; p.y += p.vy; p.vy += p.g; p.life -= p.decay; p.rot += p.vr;
    celebCtx.save();
    celebCtx.globalAlpha = Math.max(0,p.life);
    if(p.shape==='flash'){
      const rad = p.size * (1.15 - p.life*0.3);
      const grad = celebCtx.createRadialGradient(p.x,p.y,0, p.x,p.y,rad);
      grad.addColorStop(0, p.color);
      grad.addColorStop(1, 'rgba(255,240,200,0)');
      celebCtx.globalCompositeOperation = 'lighter';
      celebCtx.fillStyle = grad;
      celebCtx.beginPath(); celebCtx.arc(p.x,p.y,rad,0,Math.PI*2); celebCtx.fill();
    } else if(p.spark){
      celebCtx.strokeStyle = p.color; celebCtx.lineWidth = p.size;
      celebCtx.beginPath(); celebCtx.moveTo(p.px,p.py); celebCtx.lineTo(p.x,p.y); celebCtx.stroke();
    } else {
      celebCtx.translate(p.x,p.y); celebCtx.rotate(p.rot);
      celebCtx.fillStyle = p.color;
      if(p.shape==='rect') celebCtx.fillRect(-p.size/2,-p.size/2,p.size,p.size*0.6);
      else { celebCtx.beginPath(); celebCtx.arc(0,0,p.size/2,0,Math.PI*2); celebCtx.fill(); }
    }
    celebCtx.restore();
  });
  celebParticles = celebParticles.filter(p=>p.life>0 && p.y<H+50);
  if(performance.now() < celebEndAt || celebParticles.length || celebRockets.length){
    celebRAF = requestAnimationFrame(celebFrame);
  } else {
    celebRAF = null;
    // Un lot validé ("LOT REMPORTÉ") reste affiché à l'écran tant que
    // l'animateur n'a pas cliqué sur "RECOMMENCER" — seuls les
    // confettis (animés ci-dessus) s'arrêtent une fois retombés.
    if(!celebLocked) celeb.classList.remove('show');
  }
}

function clearCelebration(){
  celebGen++;
  if(celebRAF) cancelAnimationFrame(celebRAF);
  celebRAF = null;
  celebParticles = [];
  celebRockets = [];
  celebLocked = false;
  if(celeb) celeb.classList.remove('show','shake');
}

/* Aperçu du lot dès l'arrivée sur la case, avant toute décision de le
   garder ou de continuer : juste la photo, en grand, sans confettis,
   qui s'efface toute seule après quelques secondes pour laisser les
   boutons "TIRER LES CARTES" / "LOT REMPORTÉ" bien dégagés — un
   nouveau tirage l'efface aussi immédiatement s'il arrive avant.
   Si le lot est validé entre-temps, celebrate() le verrouille à
   l'écran (celebLocked) et cet effacement automatique est annulé. */
let previewGen = 0;
function showLotPreview(catKey){
  if(!celeb || !celebCanvas) return;
  const url = LOT_IMAGE_URLS[catKey];
  if(!url) return;
  // Un nouvel aperçu de case invalide tout reveal différé du jackpot
  // encore en attente (voir celebGen dans celebrate()) : il ne doit
  // plus pouvoir s'afficher par-dessus cette nouvelle case.
  celebGen++;
  celebLocked = false;
  celeb.dataset.level = '';
  celeb.classList.remove('shake');
  if(celebMain) celebMain.hidden = true;
  if(celebSub) celebSub.hidden = true;
  if(celebPhoto){ celebPhoto.src = url; celebPhoto.hidden = false; }
  celeb.classList.add('show');
  const myPreviewGen = ++previewGen;
  setTimeout(()=>{
    if(myPreviewGen===previewGen && !celebLocked) celeb.classList.remove('show');
  }, 2600);
}

/* Annonce propre à chaque catégorie de lot (plutôt qu'un message
   générique par palier) : le nom du lot réellement gagné s'affiche,
   sans jamais mentionner de prix. */
const CATEGORY_MESSAGES = {
  commune:     '🃏 PIOCHE DU PROF. CHEN GAGNÉE ! 🃏',
  booster8:    '🎁 BOOSTER DU MARCHAND GAGNÉ ! 🎁',
  alternative: '✨ ZONE SAFARI GAGNÉE ! ✨',
  gradee:      '⭐ DUOPACK 30 ANS GAGNÉ ! ⭐',
  booster50:   '🎁 TRIPACK 30 ANS GAGNÉ ! 🎁',
  etb:         '🎁 COFFRET 30 ANS GAGNÉ ! 🎁',
  jackpot300:  '👑 ETB 30 ANS GAGNÉ ! 👑',
};

function celebrate(catKey, forcedCard, opts){
  celebLocked = !!(opts && opts.locked);
  const myCelebGen = ++celebGen;
  const level = TIER_LEVEL[catKey] ?? 1;
  if(level===0){
    // La case Prison arrête la partie, mais ne repart jamais totalement
    // les mains vides : une carte commune de consolation est offerte
    // (même logique de plafond de reversement que les autres lots).
    const payoutCat = fundedCategory('commune');
    if(celebPhoto){
      const url = LOT_IMAGE_URLS[payoutCat];
      if(url){ celebPhoto.src = url; celebPhoto.hidden = false; }
      else celebPhoto.hidden = true;
    }
    if(celebMain){ celebMain.hidden = false; celebMain.textContent = '🔒 FIN DE PARTIE'; }
    if(celebSub){ celebSub.textContent = 'Le joueur est envoyé en prison — une carte de consolation est offerte quand même !'; celebSub.hidden = false; }
    if(celeb){ celeb.classList.add('show','shake'); celeb.dataset.level='0'; }
    playImpact();
    pushResult(payoutCat);
    setTimeout(()=>{ if(celeb) celeb.classList.remove('shake'); }, 700);
    // Comme pour un lot validé : reste affiché tant que l'animateur n'a
    // pas relancé la partie, sauf sur l'écran secondaire (pas de verrou)
    // où l'affichage se referme tout seul après un délai.
    if(!celebLocked) setTimeout(clearCelebration, 3400);
    return;
  }
  if(!celeb || !celebCanvas) return;

  // Carte Darkrai (jackpot final) : le plateau tremble puis vole en
  // éclats avant que la carte n'apparaisse — la suite de la
  // célébration (photo, feux d'artifice) démarre une fois le
  // plateau reformé, pile au bon moment.
  if(catKey==='jackpot300'){
    // On efface tout de suite l'aperçu affiché en arrivant sur la case
    // (sinon sa photo resterait visible, figée, pendant tout le
    // tremblement du plateau) : rien ne s'affiche tant que le vrai
    // reveal n'est pas prêt, jamais une photo périmée d'un autre lot.
    celeb.classList.remove('show','shake');
    startBoardShatter();
    setTimeout(()=>{
      // Le jeton de génération protège contre un reveal différé qui
      // arriverait après coup (nouvelle partie, nouveau lot validé
      // entre-temps) : il ne doit jamais écraser un autre affichage.
      if(myCelebGen !== celebGen) return;
      revealCelebration(catKey, forcedCard, level);
    }, SHAKE_MS+SHATTER_MS+120);
    return;
  }
  revealCelebration(catKey, forcedCard, level);
}

function revealCelebration(catKey, forcedCard, level){
  resizeCelebCanvas();
  if(celebMain) celebMain.hidden = false;
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
    // Toute carte Chance/Caisse qui offre un lot en argent (rare ou
    // non) passe par le même plafond de reversement que les cases du
    // plateau — sinon ces petits lots automatiques échapperaient au
    // calcul du rendement cible.
    if(card.effect && card.effect.type==='prize' && card.effect.cat){
      const realCat = card.effect.cat;
      // Le plafond de reversement continue de calculer et suivre le
      // pourcentage payé exactement comme avant (mêmes 50%, même
      // formule), mais on affiche et on remet toujours le vrai lot
      // tiré par la carte Chance/Caisse, jamais une version dégradée.
      fundedCategory(realCat);
      if(celebPhoto){
        const url = LOT_IMAGE_URLS[realCat];
        if(url){ celebPhoto.src = url; celebPhoto.hidden = false; }
        else celebPhoto.hidden = true;
      }
      pushResult(realCat);
    } else if(celebPhoto){
      celebPhoto.hidden = true;
    }
  } else {
    if(celebMain) celebMain.textContent = CATEGORY_MESSAGES[catKey] || '🎉 Lot remporté !';
    if(celebSub) celebSub.hidden = true;
    // le cœur de la demande : on ne se contente plus d'un texte,
    // on montre la vraie photo du lot gagné en grand.
    if(celebPhoto){
      const url = LOT_IMAGE_URLS[catKey];
      if(url){ celebPhoto.src = url; celebPhoto.hidden = false; }
      else celebPhoto.hidden = true;
    }
    pushResult(catKey);
  }

  const effectiveLevel = rareCardDrawn ? 5 : level;
  playFanfare(effectiveLevel);
  // Pioche du Prof. Chen : reveal classique, sans confettis ni éclair
  // (sauf carte rare tirée d'une Chance/Caisse, qui garde son effet
  // quel que soit le lot obtenu). Le Booster du Marchand, lui, a
  // maintenant droit à son petit feu d'artifice (échelle réduite,
  // niveau 1) pour ne pas paraître trop terne face aux gros lots.
  const skipFx = !rareCardDrawn && catKey==='commune';
  if(!skipFx){
    launchFireworksShow(effectiveLevel);
    if(effectiveLevel>=3){ triggerLightning(); if(effectiveLevel>=4) setTimeout(triggerLightning, 380); }
  }
  celebEndAt = performance.now() + (skipFx ? 1200 : 1900 + effectiveLevel*500);
  if(!celebRAF) celebFrame();
  setTimeout(()=>{ celeb.classList.remove('shake'); }, rareCardDrawn ? 900 : 700);
}
