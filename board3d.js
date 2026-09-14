import * as THREE from 'three';
import { OrbitControls } from './vendor/three/OrbitControls.js';
import { GLTFLoader } from './vendor/three/examples/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from './vendor/three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/three/examples/jsm/postprocessing/UnrealBloomPass.js';

/* =========================================================================
   PIKAPOLY — plateau 40 cases en vraie 3D (WebGL / three.js)
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

/* ---------- Disposition des cases sur l'anneau N_SIDE x N_SIDE ----------
   Un tour de plateau rectangulaire compte toujours 4·(N_SIDE−1) cases,
   donc un nombre pair : 36 pour 10 par côté, 32 pour 9. tiles[0] =
   Case 1 ... tiles[N_TILES−1] = dernière case (jackpot final) : pas de
   case "Départ" séparée, toutes les cases sont des lots réels.
   Le plateau est passé de 40 à 36 cases (une commune retirée par côté)
   pour que chaque case soit ~10 % plus grande à l'écran. La recette de
   rentabilité ne dépend PAS des cases (le lot est tiré dans la file de
   résultats, puis le pion est amené sur une case correspondante) : elle
   est strictement inchangée. Passer à 32 cases = changer N_SIDE et
   retirer une commune de plus par côté dans BOARD_DATA. */
const N_SIDE  = 10;
const N_TILES = 4*(N_SIDE-1);
const LAST    = N_TILES-1;
const SIDE    = N_SIDE-1;               // cases par côté, un coin compris
function ringPos(i){
  if(i===0)        return {r:N_SIDE, c:N_SIDE};
  if(i<=SIDE)      return {r:N_SIDE, c:N_SIDE-i};
  if(i<=2*SIDE)    return {r:N_SIDE-(i-SIDE), c:1};
  if(i<=3*SIDE)    return {r:1, c:1+(i-2*SIDE)};
  return {r:1+(i-3*SIDE), c:N_SIDE};
}
const CELL = 1;
const GRID_C = (N_SIDE+1)/2;            // centre de la grille
function toWorld(r,c){ return new THREE.Vector3((c-GRID_C)*CELL, 0, (r-GRID_C)*CELL); }
/* Oriente chaque case pour que le "bas" de la carte (le bandeau prix)
   pointe toujours vers l'extérieur du plateau, sur les 4 côtés — pas
   seulement sur la rangée du bas (orientation par défaut). */
function outwardYaw(r,c){
  if(r===N_SIDE) return 0;
  if(c===1)      return -Math.PI/2;
  if(r===1)      return Math.PI;
  return Math.PI/2; // c===N_SIDE
}

/* =========================================================================
   Le plateau RICHE (q=79,6%, marge 50% sur mise moyenne de 9€) :
   40 cases, catégories confirmées avec l'utilisateur.
   ========================================================================= */
const CATS = {
  commune:     { label:'Pioche du Prof. Chen',        value:'~0,68€',  tier:'flat',  swatch:'bronze' },
  booster8:    { label:'Booster du Marchand 30 ans',  value:'8€',      tier:'float', swatch:'blue'   },
  alternative: { label:'Zone Safari',                 value:'~7,20€',  tier:'flat',  swatch:'red'    },
  gradee:      { label:'Duopack 30 ans',              value:'20-80€',  tier:'float', swatch:'teal'   },
  booster50:   { label:'Tripack 30 ans',              value:'50€',     tier:'float', swatch:'rose'   },
  etb:         { label:'Coffret 30 ans',              value:'150€',    tier:'float', swatch:'orange' },
  jackpot300:  { label:'ETB 30 ans',                  value:'300€',    tier:'float', swatch:'jackpot'},
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
// 'commune*' = la commune "Prison, simple visite" (thématique uniquement).
// Chaque ligne = un côté (coin compris en tête) : 9 cases par côté.
const BOARD_DATA = [
  'booster8','alternative','chest','commune','commune','commune','chance','commune','commune*',
  'gradee','booster8','alternative','gradee','commune','commune','chest','commune','commune',
  'commune','chance','commune','commune','commune','gradee','commune','booster50','prison',
  'commune','commune','commune','booster8','booster8','chance','commune','etb','jackpot300',
].map(tok=>({ cat: tok.replace('*',''), isVisite: tok.endsWith('*') }));
if(BOARD_DATA.length !== N_TILES) throw new Error('BOARD_DATA: '+BOARD_DATA.length+' cases pour N_TILES='+N_TILES);
// NB : cases 5 et 22 remises en commune/chance (au lieu de gradée) car
// ça cassait la rentabilité même à risque maximal (marge 20%). En
// attente d'une solution de compensation pour les réintroduire.

/* Lieux Pokémon mythiques affichés à la place des noms de rues type
   Monopoly ("vous marchez vers ..."). */
const POKEMON_PLACES = [
  'Bourg Palette','Route 1','Jadielle','Centre Pokémon','Forêt de Jade','Mont Sélénite','Azuria',
  'Cascade d\'Azuria','Carmin-sur-Mer','Route 24','Lavanville','Tour Pokémon','Zone Safari','Céladopole',
  'Casino de Céladopole','Fuchsia','Île Écume','Parmanie','Île Cramoisie','Route 21',
  'Doublonville','Centrale Électrique','Ligue Pokémon','Grotte Taupiqueur','Route 11',
  'Chenaptôme','Verdaphage','Bourg Geon','Écorcia','Rosalia','Blackthorn','Route 46','Grotte Sombre',
  'Antre Draco','Salle du Conseil des 4','Ligue Pokémon — Salle du Champion',
];
if(POKEMON_PLACES.length !== N_TILES) throw new Error('POKEMON_PLACES: '+POKEMON_PLACES.length+' noms pour N_TILES='+N_TILES);

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
  // 4 teintes dédiées pour dissocier clairement les 4 gros lots
  // (Duopack/Tripack/Coffret/ETB 30 ans) qui partageaient tous le
  // même "gold" auparavant, sur la légende ET sur les cases du
  // plateau (même swatch = même couleur partout).
  jackpot:'#ffd700', orange:'#e8863c', rose:'#d6549c', teal:'#2fb8b0',
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

/* Icônes dessinées en vectoriel (pas des emoji) pour les médaillons
   de catégorie. Les emoji dépendent de la police du navigateur/webview
   qui affiche la page : certains (notamment 🎁, 🗃️, 🔒) se retrouvent
   rendus en glyphe de secours noir/monochrome sur des environnements
   à police d'emoji limitée (webview intégrée, etc.), ce qui donnait
   un "cadeau noir" au lieu de l'icône dorée attendue. Un dessin
   vectoriel rend exactement pareil partout. */
function drawVectorIcon(ctx, kind, cx, cy, r, color){
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = color; ctx.strokeStyle = color;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if(kind==='card'){
    const w=r*1.3, h=r*1.7;
    roundRectPath(ctx, -w/2, -h/2, w, h, r*0.18); ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    roundRectPath(ctx, -w*0.32, -h*0.26, w*0.64, h*0.4, r*0.08); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  } else if(kind==='box'){
    const s = r*1.5;
    roundRectPath(ctx, -s/2, -s/2, s, s, r*0.15); ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillRect(-s*0.09, -s/2, s*0.18, s);
    ctx.fillRect(-s/2, -s*0.09, s, s*0.18);
    ctx.globalCompositeOperation = 'source-over';
  } else if(kind==='compass'){
    ctx.beginPath(); ctx.arc(0,0,r*0.82,0,Math.PI*2);
    ctx.lineWidth = r*0.16; ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0,-r*0.58); ctx.lineTo(r*0.22,0); ctx.lineTo(0,r*0.58); ctx.lineTo(-r*0.22,0);
    ctx.closePath(); ctx.fill();
  } else if(kind==='star'){
    const spikes=5, outerR=r*0.95, innerR=r*0.42;
    ctx.beginPath();
    for(let i=0;i<spikes*2;i++){
      const ang = -Math.PI/2 + i*Math.PI/spikes;
      const rad = i%2===0 ? outerR : innerR;
      const x = Math.cos(ang)*rad, y = Math.sin(ang)*rad;
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.closePath(); ctx.fill();
  } else if(kind==='gift'){
    const w=r*1.5, h=r*1.15;
    roundRectPath(ctx, -w/2, -h*0.15, w, h*0.9, r*0.1); ctx.fill();
    roundRectPath(ctx, -w/2, -h*0.45, w, h*0.32, r*0.08); ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillRect(-w*0.09, -h*0.45, w*0.18, h*1.2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    ctx.ellipse(-w*0.13,-h*0.5,w*0.14,h*0.15,0,0,Math.PI*2);
    ctx.ellipse(w*0.13,-h*0.5,w*0.14,h*0.15,0,0,Math.PI*2);
    ctx.fill();
  } else if(kind==='lock'){
    const w=r*1.1, h=r*0.9;
    ctx.beginPath(); ctx.arc(0,-h*0.12,w*0.42,Math.PI,0);
    ctx.lineWidth = r*0.22; ctx.stroke();
    roundRectPath(ctx, -w/2, -h*0.1, w, h*0.75, r*0.12); ctx.fill();
  } else if(kind==='unlock'){
    const w=r*1.1, h=r*0.9;
    ctx.beginPath(); ctx.arc(-w*0.12,-h*0.3,w*0.42,Math.PI*0.95,Math.PI*1.85);
    ctx.lineWidth = r*0.22; ctx.stroke();
    roundRectPath(ctx, -w/2, -h*0.1, w, h*0.75, r*0.12); ctx.fill();
  }
  ctx.restore();
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

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = size*0.03;
    if(catKey==='chance'){
      ctx.fillStyle = '#fff9e6';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.font = '900 '+(bh*0.6)+'px Arial,Helvetica,sans-serif';
      ctx.fillText('?', pad+bw/2, pad+bh*0.46);
    } else {
      const glyphKind = { chest:'gift', prison:'lock' }[catKey];
      drawVectorIcon(ctx, glyphKind, pad+bw/2, pad+bh*0.46, bh*0.28, '#fff9e6');
    }
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
    drawVectorIcon(ctx, 'unlock', 16+size*0.075, 16+size*0.075, size*0.075, '#fff9e6');
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
    drawVectorIcon(ctx, 'unlock', cx, cy+size*0.02, size*0.22, '#fff9e6');
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
      drawVectorIcon(ctx, 'gift', cx, cy+size*0.02, size*0.24, '#fff9e6');
    } else if(kind==='prison'){
      drawVectorIcon(ctx, 'lock', cx, cy+size*0.02, size*0.22, '#fff9e6');
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
renderer.toneMappingExposure = 1.45;

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

  /* Identité "mur de studio" Pikapoly : grands anneaux façon
     Pokéball très estompés au centre-haut, + un mot-symbole
     "PIKAPOLY" répété en diagonale, discret mais reconnaissable
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
      ctx.fillText('★ PIKAPOLY ★', x, y);
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

/* Environnement de reflets pour l'or (bordures, cases, ornements) :
   sans lui, le métal ne réagit qu'aux lumières ponctuelles et reste
   plat/mat quel que soit son "metalness". On réutilise le dégradé
   studio doré/noir déjà dessiné ci-dessus comme carte équirectangulaire
   — même ambiance que le plateau, aucun fichier HDRI à charger. */
{
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  pmremGenerator.compileEquirectangularShader();
  const envRT = pmremGenerator.fromEquirectangular(makeStudioBackdrop());
  scene.environment = envRT.texture;
  pmremGenerator.dispose();
}

const BASE_FOV = 40;
const camera = new THREE.PerspectiveCamera(BASE_FOV,1,0.1,100);
camera.position.set(0,13.5,11);
scene.add(camera);

/* Post-traitement bloom : fait "exploser" en halo lumineux tout ce qui
   dépasse le seuil de luminosité (or émissif, sprites de gain, effets
   additifs de célébration) sans toucher au reste de la scène — c'est
   ce qui donne le rendu "jeu télévisé haut de gamme" au lieu d'un
   rendu plat. Seuil assez haut pour ne pas baver sur les textures
   photo/couleurs normales. */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(1,1), 0.55, 0.4, 0.82);
composer.addPass(bloomPass);

/* Garde-fou anti-rognage des coins : au lieu d'un recul de caméra
   fixe (qui rapetissait tout le plateau en permanence, y compris de
   face où ce n'était pas nécessaire), on élargit le champ de vision
   au fil de la rotation UNIQUEMENT le strict minimum requis pour que
   les 4 coins restent visibles sous l'angle courant, et on revient à
   BASE_FOV dès que l'angle redevient sûr (vue de face par défaut =
   plateau au maximum, comme avant). */
const BOARD_CORNER_R = (N_SIDE*CELL)/2 + 0.15;
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
    /* Exposant abaissé de 0,5 à 0,38 : on recule moins sur téléphone,
       le plateau occupe davantage la largeur de l'écran. Le garde-fou
       anti-rognage des coins (updateCornerSafety) rattrape ce qu'il faut. */
    const factor = Math.min(Math.pow(1/aspect0, 0.38), 1.6);
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
/* Un doigt sur l'écran reprend la main sur la caméra, même au milieu
   d'un mouvement cinématique : le joueur doit toujours pouvoir regarder
   le plateau où il veut. */
renderer.domElement.addEventListener('pointerdown', ()=>{ cineEnd(); }, {passive:true});

/* ---------- Lumières : ambiance "roue de la fortune" dorée ---------- */
/* Le sol (couleur "ground") reprend une touche de bleu-violet nocturne
   (au lieu d'un noir neutre) pour que les zones d'ombre du plateau
   captent un peu de la teinte froide du ciel en arrière-plan — sans ça,
   un plateau tout chaud posé sur un fond bleu-violet paraissait un peu
   "posé par-dessus" plutôt qu'intégré à la scène. */
scene.add(new THREE.HemisphereLight(0xffdca0, 0x141c33, 0.68));

/* Petit projecteur chaud au-dessus du centre du plateau : la légende
   des lots (photos + texte) doit rester bien lisible, pas juste
   éclairée par la lumière ambiante générale. */
const centerSpot = new THREE.PointLight(0xffe9c2, 0.7, 9, 2);
centerSpot.position.set(0, 3.2, 0);
scene.add(centerSpot);

const key = new THREE.DirectionalLight(0xfff2df, 1.15);
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

/* Fill light froide, opposée à la key light : débouche les zones
   sombres du personnage (toon shading) sans les aplatir, et fait aussi
   ressortir un peu de bleu-violet sur le plateau — cohérent avec le
   ciel nocturne de la photo de fond plutôt qu'un éclairage 100% chaud
   qui ferait paraître le plateau posé par-dessus le décor. */
const fill = new THREE.DirectionalLight(0x9db8ff, 0.6);
fill.position.set(-4,2.5,3.2);
scene.add(fill);

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
  const half = (N_SIDE*CELL+0.7)/2;
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

/* ---------- Plaque centrale "PIKAPOLY" + légende des lots ----------
   Reprend le même esprit que le visuel promotionnel "TOUS LES LOTS À
   GAGNER" : une carte sombre à bordure dorée, listant chaque
   catégorie réelle du plateau (couleur, icône, nom, valeur). Ce
   panneau est volontairement opaque (contrairement au reste du sol
   resté transparent) pour que la liste reste lisible par-dessus
   n'importe quelle photo de fond. */
// Les 7 vrais lots du plateau, triés du plus gros au plus petit (les
// tirages Chance/Caisse Communautaire n'en font pas partie : ce sont
// des cases spéciales, pas des lots, elles ont leur propre badge
// compact plus bas). catKey pointe vers CATS pour réutiliser le vrai
// libellé et la vraie photo de chaque lot, sans jamais les retaper.
const CENTER_LEGEND_ROWS = [
  {swatch:'jackpot', catKey:'jackpot300'},
  {swatch:'orange',  catKey:'etb'},
  {swatch:'rose',    catKey:'booster50'},
  {swatch:'teal',    catKey:'gradee'},
  {swatch:'blue',    catKey:'booster8'},
  {swatch:'red',     catKey:'alternative'},
  {swatch:'bronze',  catKey:'commune'},
];
// Chance / Caisse Communautaire : pas des lots, juste deux petits
// badges compacts (icône + nom) sous l'en-tête, bien visibles sans
// prendre la place d'une ligne de lot.
const CENTER_LEGEND_BADGES = [
  {swatch:'purple', icon:'question', title:'Chance'},
  {swatch:'green',  icon:'gift',     title:'Caisse'},
];
function makeCenterPlateTexture(){
  const size = 900;
  const cvs = document.createElement('canvas'); cvs.width=cvs.height=size;
  const ctx = cvs.getContext('2d');
  // Pas de fond opaque : comme sur la version d'origine, le sol du
  // plateau reste transparent jusqu'au centre, la photo derrière doit
  // se voir directement. La lisibilité vient des ombres portées
  // sombres derrière chaque élément (texte, médaillons, bandeaux),
  // pas d'un panneau plein.

  // mini Pokeball + PIKAPOLY compact en haut de la carte
  const pbY = size*0.115, pbR = size*0.04;
  ctx.beginPath(); ctx.arc(size/2,pbY,pbR,Math.PI,0); ctx.fillStyle='#f5484f'; ctx.fill();
  ctx.beginPath(); ctx.arc(size/2,pbY,pbR,0,Math.PI); ctx.fillStyle='#f6fbff'; ctx.fill();
  ctx.fillStyle='#12283f'; ctx.fillRect(size/2-pbR,pbY-pbR*0.09,pbR*2,pbR*0.18);
  ctx.lineWidth=pbR*0.09; ctx.strokeStyle='#12283f';
  ctx.beginPath(); ctx.arc(size/2,pbY,pbR,0,Math.PI*2); ctx.stroke();
  ctx.beginPath(); ctx.arc(size/2,pbY,pbR*0.34,0,Math.PI*2); ctx.fillStyle='#fff'; ctx.fill(); ctx.stroke();

  // Titre du plateau, dans la police et l'or d'origine — juste un peu
  // plus grand qu'avant.
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.font='900 '+(size*0.060)+'px Arial,Helvetica,sans-serif';
  ctx.shadowColor='rgba(255,210,110,.7)'; ctx.shadowBlur=size*0.01;
  ctx.fillStyle = GOLD_BRIGHT;
  ctx.fillText('PIKAPOLY', size/2, size*0.185);
  ctx.shadowBlur = 0;

  // en-tête de la légende — ombre sombre pour rester lisible sur
  // n'importe quel fond de photo, sans panneau derrière
  ctx.font='700 '+(size*0.028)+'px Arial,Helvetica,sans-serif';
  ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = size*0.012;
  ctx.fillStyle = GOLD_BRIGHT;
  ctx.fillText('★ TOUS LES LOTS À GAGNER ★', size/2, size*0.235);
  ctx.shadowBlur = 0;

  // Chance / Caisse : deux petits badges compacts côte à côte (pas
  // des lots, pas de ligne dédiée) — icône dans un rond + nom court.
  const badgeY = size*0.29, badgeR = size*0.024, badgeGap = size*0.22;
  CENTER_LEGEND_BADGES.forEach((b,i)=>{
    const bx = size/2 + (i===0 ? -1 : 1)*badgeGap/2;
    const color = SWATCH_COLORS[b.swatch];
    ctx.save();
    ctx.shadowColor = color; ctx.shadowBlur = size*0.016;
    ctx.beginPath(); ctx.arc(bx,badgeY,badgeR,0,Math.PI*2);
    ctx.fillStyle = '#0c0f16'; ctx.fill();
    ctx.restore();
    if(b.icon==='question'){
      ctx.font = '900 '+(badgeR*1.3)+'px Arial,Helvetica,sans-serif';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillStyle = '#fff9e6';
      ctx.fillText('?', bx, badgeY+badgeR*0.05);
    } else {
      drawVectorIcon(ctx, b.icon, bx, badgeY, badgeR*0.85, '#fff9e6');
    }
    ctx.lineWidth = size*0.0045; ctx.strokeStyle = color;
    ctx.beginPath(); ctx.arc(bx,badgeY,badgeR,0,Math.PI*2); ctx.stroke();
    ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.shadowColor = 'rgba(0,0,0,.9)'; ctx.shadowBlur = size*0.008;
    ctx.fillStyle = GOLD_BRIGHT;
    ctx.font='800 '+(size*0.024)+'px Arial,Helvetica,sans-serif';
    ctx.fillText(b.title, bx+badgeR*1.5, badgeY+size*0.001);
    ctx.shadowBlur = 0;
  });

  // une ligne par vrai lot, du plus gros au plus petit : bandeau
  // teinté + barre d'accent + médaillon (vraie photo du lot) — pour
  // retrouver le côté vif/coloré du visuel de référence au lieu de
  // lignes uniformément grises, avec une couleur dédiée par lot.
  const rowsTop = size*0.335, rowH = (0.93-0.335)*size/CENTER_LEGEND_ROWS.length, rowW = size*0.85, rowX = size*0.075;
  CENTER_LEGEND_ROWS.forEach((r,i)=>{
    const y = rowsTop + i*rowH;
    const rh = rowH*0.82;
    const color = SWATCH_COLORS[r.swatch];

    // pas de fond plein sur la ligne : juste un contour lumineux de la
    // couleur de la catégorie (avec une ombre sombre pour se détacher
    // de la photo derrière) + une barre d'accent fine sur le bord
    // gauche — le sol reste transparent jusqu'à la photo.
    ctx.save();
    roundRectPath(ctx, rowX, y, rowW, rh, rh*0.22);
    ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = size*0.014;
    ctx.lineWidth = size*0.004; ctx.strokeStyle = color;
    ctx.stroke();
    ctx.restore();
    ctx.save();
    roundRectPath(ctx, rowX, y, rowW, rh, rh*0.22);
    ctx.clip();
    ctx.fillStyle = color;
    ctx.fillRect(rowX, y, rh*0.14, rh);
    ctx.restore();

    // médaillon : vraie photo du lot si dispo, sinon icône dans un
    // rond de la couleur de la catégorie — avec halo lumineux
    const dotR = rh*0.38, dotX = rowX + rh*0.66, dotY = y + rh*0.5;
    ctx.save();
    ctx.shadowColor = color; ctx.shadowBlur = size*0.022;
    ctx.beginPath(); ctx.arc(dotX,dotY,dotR,0,Math.PI*2);
    ctx.fillStyle = '#0c0f16'; ctx.fill();
    ctx.restore();
    const img = r.catKey && LOT_IMAGES[r.catKey];
    if(img){
      ctx.save();
      ctx.beginPath(); ctx.arc(dotX,dotY,dotR*0.88,0,Math.PI*2); ctx.clip();
      const iw=img.width, ih=img.height, side=Math.min(iw,ih);
      ctx.drawImage(img,(iw-side)/2,(ih-side)/2,side,side, dotX-dotR*0.88,dotY-dotR*0.88,dotR*1.76,dotR*1.76);
      ctx.restore();
    } else {
      // secours si jamais la photo n'a pas pu charger : une étoile
      // plutôt qu'un médaillon vide
      drawVectorIcon(ctx, 'star', dotX, dotY, dotR*0.85, '#fff9e6');
    }
    ctx.lineWidth = size*0.0055; ctx.strokeStyle = color;
    ctx.beginPath(); ctx.arc(dotX,dotY,dotR,0,Math.PI*2); ctx.stroke();

    // titre du lot à droite du médaillon (pas de prix affiché : le
    // plateau doit rester une carte "quoi gagner", pas un tarif) —
    // noir gras avec un fin liseré doré (façon plaque de luxe/casino
    // haut de gamme) : lisible aussi bien sur les zones claires que
    // sombres de la photo derrière, plus "classe" qu'un simple aplat.
    // Taille de police maximisée : part encore plus grand (rh*0.52) et
    // ne réduit que si un nom précis (ex. "Booster du Marchand 30 ans",
    // le plus long) déborderait sinon de la ligne.
    const textX = dotX + dotR*1.5;
    const maxTextW = rowX + rowW - textX - size*0.012;
    ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.lineJoin = 'round';
    let fontSize = rh*0.52;
    ctx.font='900 '+fontSize+'px Arial,Helvetica,sans-serif';
    while(fontSize > rh*0.28 && ctx.measureText(CATS[r.catKey].label).width > maxTextW){
      fontSize -= 1;
      ctx.font='900 '+fontSize+'px Arial,Helvetica,sans-serif';
    }
    ctx.lineWidth = size*0.0052;
    ctx.strokeStyle = GOLD_BRIGHT;
    ctx.strokeText(CATS[r.catKey].label, textX, y+rh*0.52);
    ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = size*0.008;
    ctx.fillStyle = '#0a0a0a';
    ctx.fillText(CATS[r.catKey].label, textX, y+rh*0.52);
    ctx.shadowBlur = 0;
    ctx.textBaseline='alphabetic';
  });

  ctx.textAlign='center';
  ctx.font='italic 700 '+(size*0.03)+'px Georgia, serif';
  ctx.fillStyle = GOLD_BRIGHT;
  ctx.fillText('Bonne chance !', size/2, size*0.945);

  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const centerPlate = new THREE.Mesh(
  new THREE.BoxGeometry((N_SIDE-2)*CELL,0.14,(N_SIDE-2)*CELL),
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
  const cornerHalf = (N_SIDE*CELL+0.7)/2;
  [[1,1],[-1,1],[-1,-1],[1,-1]].forEach(([sx,sz])=>{
    const mat = new THREE.MeshBasicMaterial({map:ornTex, transparent:true, depthWrite:false});
    const orn = new THREE.Mesh(new THREE.PlaneGeometry(ornSize,ornSize), mat);
    orn.rotation.x = -Math.PI/2;
    orn.rotation.z = Math.atan2(sx,sz) + Math.PI; // pointe vers l'extérieur du plateau
    orn.position.set(sx*cornerHalf, 0.025, sz*cornerHalf);
    boardGroup.add(orn);
  });
}

/* ---------- Reflet holographique façon carte rare ----------
   Un bandeau diagonal clair qui défile en boucle sur les cartes-lots
   flottantes, comme le reflet d'une carte Pokémon holo qu'on incline
   à la lumière — de la "dopamine visuelle" en continu, même quand
   personne ne joue, sans dépendre d'une action du joueur. */
function makeHoloShineTexture(){
  const size = 256;
  const cvs = document.createElement('canvas'); cvs.width=cvs.height=size;
  const ctx = cvs.getContext('2d');
  ctx.save();
  ctx.translate(size/2,size/2); ctx.rotate(Math.PI/5); ctx.translate(-size/2,-size/2);
  const grad = ctx.createLinearGradient(0,0,size*0.16,0);
  grad.addColorStop(0,'rgba(255,255,255,0)');
  grad.addColorStop(0.5,'rgba(255,255,255,.4)');
  grad.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(-size,-size,size*3,size*3);
  ctx.restore();
  const tex = new THREE.CanvasTexture(cvs);
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}
const holoShineBaseTex = makeHoloShineTexture();

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
  color:new THREE.Color(GOLD), roughness:.2, metalness:.9,
  emissive:new THREE.Color(GOLD), emissiveIntensity:.12
});
const tileBezelMat = new THREE.MeshStandardMaterial({color:0x0a0a0a, roughness:.5, metalness:.25});
const tileCollarGeo = new THREE.BoxGeometry(TILE+0.09,0.07,TILE+0.09);
const tileBezelGeo = new THREE.BoxGeometry(TILE*0.97,0.035,TILE*0.97);
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
const tileCollarInst = new THREE.InstancedMesh(tileCollarGeo, tileGoldMat, N_TILES);
tileCollarInst.castShadow = false; tileCollarInst.receiveShadow = false;
tileCollarInst.frustumCulled = false;
boardGroup.add(tileCollarInst);
const tileBezelInst = new THREE.InstancedMesh(tileBezelGeo, tileBezelMat, N_TILES);
tileBezelInst.receiveShadow = false;
tileBezelInst.frustumCulled = false;
boardGroup.add(tileBezelInst);
const tileRivetInst = new THREE.InstancedMesh(tileRivetGeo, tileGoldMat, N_TILES*RIVET_OFFSETS.length);
tileRivetInst.frustumCulled = false;
boardGroup.add(tileRivetInst);
const _instDummy = new THREE.Object3D();
const _yAxis = new THREE.Vector3(0,1,0);

for(let i=0;i<N_TILES;i++){
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

  // Sous-groupe "carte" : tout ce qui doit flotter/rebondir ensemble
  // (corps coloré, photo, numéro, halo, lot flottant) — le socle
  // (base + collerette dorée) reste fixe, façon carte posée dans son
  // logement. Le liseré + les rivets suivent aussi ce mouvement via
  // leurs InstancedMesh, remis à jour chaque frame en même temps.
  const topGroup = new THREE.Group();
  group.add(topGroup);

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
  // Corps de la case légèrement épaissi (0.14 au lieu de 0.08 à
  // l'origine) : un vrai relief avec des flancs colorés visibles,
  // façon jeton de casino, sans pour autant faire une case si haute
  // qu'elle cache la photo de la case juste derrière elle dans la
  // même rangée (vu la caméra en plongée, une case trop épaisse
  // masque celle qui la suit — testé à 0.30, beaucoup trop).
  // Posé directement sur la collerette (qui culmine à 0.135).
  const BODY_H = 0.14, BODY_BOTTOM = 0.135;
  const bodyTile = new THREE.Mesh(new THREE.BoxGeometry(TILE,BODY_H,TILE), sideMat);
  bodyTile.position.y = BODY_BOTTOM + BODY_H/2;
  bodyTile.castShadow = true;
  bodyTile.receiveShadow = true;
  topGroup.add(bodyTile);

  // liseré noir en léger retrait entre le corps coloré et la carte,
  // avec quatre rivets dorés aux coins façon plaque vissée — leurs
  // positions de base sont conservées (bezelBase/rivetPositions) pour
  // que l'animation (vague/rebond) puisse les remettre à jour chaque
  // frame en même temps que le reste de la carte, sans jamais se
  // désynchroniser d'elle.
  const BEZEL_Y = BODY_BOTTOM + BODY_H + 0.0175;
  const bezelBase = { x: world.x, z: world.z, y: BEZEL_Y };
  _instDummy.position.set(world.x, BEZEL_Y, world.z);
  _instDummy.updateMatrix();
  tileBezelInst.setMatrixAt(i, _instDummy.matrix);

  const RIVET_Y = BEZEL_Y + 0.0195;
  const rivetOffset = TILE*0.40;
  const rivetPositions = [];
  RIVET_OFFSETS.forEach(([dx,dz], k)=>{
    const local = new THREE.Vector3(dx*rivetOffset, RIVET_Y, dz*rivetOffset);
    local.applyAxisAngle(_yAxis, outwardYaw(r,c));
    const rx = world.x+local.x, rz = world.z+local.z;
    rivetPositions.push({x:rx, z:rz});
    _instDummy.position.set(rx, local.y, rz);
    _instDummy.updateMatrix();
    tileRivetInst.setMatrixAt(i*RIVET_OFFSETS.length+k, _instDummy.matrix);
  });

  const tileTopY = BEZEL_Y + 0.0175;

  let faceTex;
  if(i === 0){
    // Case 1 : le joueur y démarre sans lancer, jamais de lot associé
    // à l'affichage — voir aussi updateWinButton qui bloque le côté
    // mécanique si un recul y ramène le joueur plus tard.
    faceTex = getDepartFace();
  } else if(catDef.tier === 'flat'){
    faceTex = getFlatPhotoFace(catKey, accentColor, data.isVisite);
  } else {
    // "float" (le lot flotte déjà en carte au-dessus, la case reste
    // sobre) / "glyph" (Chance, Caisse, Prison : pas de photo, mais
    // getFlatPhotoFace dessine désormais son propre fond + symbole)
    faceTex = getFlatPhotoFace(catKey, accentColor, null);
  }
  const faceMat = new THREE.MeshBasicMaterial({map:faceTex});
  const face = new THREE.Mesh(new THREE.PlaneGeometry(TILE*0.94,TILE*0.94), faceMat);
  face.rotation.x = -Math.PI/2;
  // Marge généreuse au-dessus du liseré : la carte (topGroup, qui
  // inclut la photo ET le liseré/rivets via leurs InstancedMesh remis
  // à jour chaque frame) respire et rebondit ensemble, donc l'écart
  // entre eux reste constant — +0.02 est juste une marge de rendu
  // pour éviter tout z-fighting entre la photo et le liseré.
  face.position.y = tileTopY+0.02;
  face.receiveShadow = true;
  topGroup.add(face);

  const numSpr = makeSprite(numberTexture(caseNum), 0.2);
  numSpr.position.set(TILE*0.35, tileTopY+0.01, TILE*0.36);
  numSpr.rotation.x = -Math.PI/2;
  topGroup.add(numSpr);

  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(TILE*0.56,0.035,8,32),
    new THREE.MeshBasicMaterial({color:0xffe873,transparent:true,opacity:0,blending:THREE.AdditiveBlending})
  );
  halo.rotation.x = Math.PI/2;
  halo.position.y = tileTopY+0.03;
  topGroup.add(halo);

  let floatObj = null, shadowDisc = null, floatBaseScale = 0.34, holoShine = null;
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
    topGroup.add(floatObj);
    floatBaseScale = h;

    // reflet holo qui défile en boucle sur la carte, comme une vraie
    // carte rare inclinée à la lumière — chaque carte a son propre
    // décalage de phase et de vitesse pour ne pas scintiller à l'unisson
    const shineTex = holoShineBaseTex.clone();
    shineTex.needsUpdate = true;
    const shineMat = new THREE.MeshBasicMaterial({
      map:shineTex, transparent:true, depthWrite:false, side:THREE.DoubleSide,
      blending:THREE.AdditiveBlending, opacity:.32
    });
    const shineMesh = new THREE.Mesh(new THREE.PlaneGeometry(w,h), shineMat);
    shineMesh.position.set(0,0,0.002);
    floatObj.add(shineMesh);
    holoShine = { tex:shineTex, speed:0.16+Math.random()*0.1, phase:Math.random() };
  } else if(i !== 0 && catDef.tier === 'glyph'){
    const glyphKind = data.isVisite ? 'visite' : catKey;
    floatObj = makeSprite(getGlyphTexture(glyphKind, accentColor), data.isVisite ? 0.3 : 0.6);
    floatObj.position.y = tileTopY + 0.3;
    topGroup.add(floatObj);
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
    group, topGroup, world, tileTopY, catKey, catDef, caseNum, isVisite:data.isVisite,
    halo, floatObj, shadowDisc, floatBaseScale, holoShine, motion: MOTION[catKey]||{bob:0.08},
    // Demi-hauteur réelle du lot flottant et sa hauteur de repos au-dessus
    // de la case : sert à calculer de combien il doit s'élever pour passer
    // AU-DESSUS du pion au lieu d'être traversé par lui (voir la boucle
    // d'animation). Le sprite "glyphe" (Chance/Caisse) mesure 0.6 de côté.
    floatHalfH: catDef.tier==='float' ? floatBaseScale*0.5 : 0.3,
    floatBaseOff: catDef.tier==='float' ? 0.32 + floatBaseScale*0.5 : 0.3,
    floatLiftCur: 0,
    bezelBase, rivetPositions, rivetY:RIVET_Y, bezelIndex:i,
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
  const span = N_SIDE*CELL, cell = span/SHARD_ROWS, half = (SHARD_ROWS-1)/2;
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

/* ---------- Impact à l'arrivée sur une case ----------
   Un anneau plat qui s'ouvre depuis la case, plus un bref flash au sol :
   c'est ce qui donne son poids à l'atterrissage. L'intensité suit le
   niveau du lot — si une pioche commune faisait le même effet qu'un
   gros lot, plus rien ne se distinguerait et l'effet ne voudrait plus
   rien dire.
   Le flash est un disque additif posé sur la case, pas une vraie
   lampe : une PointLight en atténuation quadratique éclaire en
   1/distance², donc la carte-lot qui flotte à ~40 cm au-dessus de la
   case recevait plus de six fois l'intensité réglée et cramait en
   blanc pur. Un disque additif donne le même éclat sans toucher à
   l'éclairage du reste de la scène, et ne coûte pas une lumière
   dynamique de plus. */
const shockRing = new THREE.Mesh(
  new THREE.RingGeometry(0.40, 0.50, 48),
  new THREE.MeshBasicMaterial({color:0xffe9ae, transparent:true, opacity:0,
    blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide})
);
shockRing.rotation.x = -Math.PI/2;
shockRing.visible = false;
scene.add(shockRing);
const impactGlow = new THREE.Mesh(
  new THREE.CircleGeometry(0.62, 32),
  new THREE.MeshBasicMaterial({color:0xffd98a, transparent:true, opacity:0,
    blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide})
);
impactGlow.rotation.x = -Math.PI/2;
impactGlow.visible = false;
scene.add(impactGlow);
let shockT0 = -1, shockLevel = 1;
function winShock(tile, level){
  if(reduceMotion) return;
  shockLevel = Math.max(1, level);
  shockRing.position.set(tile.world.x, tile.tileTopY + 0.04, tile.world.z);
  impactGlow.position.set(tile.world.x, tile.tileTopY + 0.03, tile.world.z);
  shockT0 = clock.getElapsedTime();
  shockRing.visible = true;
  impactGlow.visible = true;
}

let shakeUntil = 0, shatterUntil = 0, shatterActive = false, shatterStartT = 0;
const _shardDummy = new THREE.Object3D();
/* Pluie d'or du jackpot : un rideau de paillettes qui tombe sur toute la
   largeur du plateau pendant l'éclatement. C'est un système de points à
   part, pas le pool d'étincelles : le pool ne tient que 48 particules,
   partagées avec les impacts, et une pluie continue le vidait en une
   demi-seconde — les paillettes étaient recyclées avant même d'entrer
   dans le champ. Ici les particules bouclent en haut quand elles
   touchent le sol, donc le rideau reste plein du début à la fin, pour
   un seul draw call. */
const RAIN_COUNT = 150;
const rainPos = new Float32Array(RAIN_COUNT*3);
const rainVel = new Float32Array(RAIN_COUNT);
const rainGeo = new THREE.BufferGeometry();
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
const rainMat = new THREE.PointsMaterial({
  map: brightGoldTex, color: 0xffe2a0, size: 0.34, sizeAttenuation: true,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0
});
const goldRain = new THREE.Points(rainGeo, rainMat);
goldRain.frustumCulled = false;
goldRain.visible = false;
scene.add(goldRain);
let goldRainUntil = 0, goldRainT0 = 0;
function seedRainDrop(i, yMin, ySpan){
  rainPos[i*3]   = (Math.random()-0.5)*11.5;
  rainPos[i*3+1] = yMin + Math.random()*ySpan;
  rainPos[i*3+2] = (Math.random()-0.5)*11.5;
  rainVel[i] = 1.6 + Math.random()*2.6;
}
function startGoldRain(durSec){
  if(reduceMotion) return;
  const now = clock.getElapsedTime();
  goldRainUntil = now + durSec;
  goldRainT0 = now;
  /* Semé sur toute la hauteur dès le départ : si tout partait du haut,
     il ne se passerait rien à l'écran pendant la première seconde. */
  for(let i=0;i<RAIN_COUNT;i++) seedRainDrop(i, 0.8, 6.8);
  rainGeo.attributes.position.needsUpdate = true;
  rainMat.opacity = 0;
  goldRain.visible = true;
}
function updateGoldRain(t, dt){
  if(!goldRain.visible) return;
  if(t >= goldRainUntil){ goldRain.visible = false; rainMat.opacity = 0; return; }
  rainMat.opacity = 0.95 * Math.min(1, (t-goldRainT0)/0.25)
                         * Math.min(1, (goldRainUntil-t)/0.7);
  for(let i=0;i<RAIN_COUNT;i++){
    const y = rainPos[i*3+1] - rainVel[i]*dt;
    if(y < 0.05) seedRainDrop(i, 6.0, 2.0);
    else rainPos[i*3+1] = y;
  }
  rainGeo.attributes.position.needsUpdate = true;
}

function startBoardShatter(){
  const now = clock.getElapsedTime();
  startGoldRain((SHAKE_MS + SHATTER_MS)/1000 + 1.4);
  cameraPunch(2.2);
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
  return { root: new THREE.Group(), mixer: { update(){} }, setWalking(){}, updateBody(){} };
}

/* ============================================================================
   COUCHE D'ANIMATION PROCÉDURALE DU PION
   ----------------------------------------------------------------------------
   Tout ce qui suit se superpose aux clips du modèle (idle / walk) au lieu de
   les remplacer. Le principe tient en une ligne, appliquée à chaque os et à
   chaque frame :

       final = bind + (clip - bind) * poidsDuClip + repos + procédural

   `bind` est la pose du squelette relevée une fois, avant toute lecture de
   clip. Passer par elle règle deux défauts de la version précédente :

   — La DÉRIVE. Les micro-mouvements étaient ajoutés avec `+=` à la valeur
     courante de l'os. Sur les os que le clip ne pilote pas, rien ne remettait
     la valeur à zéro : elle s'accumulait sans limite (le bassin atteignait
     4 radians et le personnage finissait couché).
   — L'ÉPOUVANTAIL. La pose de repos était une rotation fixe de ±78° cuite
     dans les images-clés du SEUL clip idle, sur la seule épaule. Les coudes
     n'étaient jamais fléchis et, à la marche, les bras reprenaient la pose
     en T du rig. Ici le repos est une couche vivante, appliquée aux deux
     clips, épaules ET coudes ET poignets, volontairement asymétrique.
   ========================================================================== */

const RIG_BONES = [
  'Hips','Spine','Chest','UpperChest','Neck','Head',
  'LeftShoulder','RightShoulder','LeftArm','RightArm',
  'LeftForeArm','RightForeArm','LeftHand','RightHand',
  'LeftUpLeg','RightUpLeg','LeftLeg','RightLeg','LeftFoot','RightFoot',
];

/* Pose de repos. Les bras descendent le long du corps (z ≈ ∓1.45 rad, là où
   l'ancienne correction s'arrêtait à 1.36 sans fléchir les coudes), les
   coudes sont fléchis, les poignets relâchés. Le côté gauche et le côté
   droit ne sont JAMAIS identiques : une pose parfaitement symétrique est ce
   qui fait lire un mannequin plutôt qu'un être vivant. */
const REST_POSE = {
  LeftShoulder:  { z:  0.06, x: -0.02 },
  RightShoulder: { z: -0.05, x: -0.03 },
  /* Valeurs trouvées par recherche numérique sur le modèle lui-même et
     non à l'estime : on mesure l'angle épaule→main par rapport à la
     verticale et on descend jusqu'à ce que le bras pende vraiment. Les
     deux épaules n'ont pas la même orientation de liaison sur ce rig —
     AUCUNE valeur de z seule ne fait redescendre le bras droit, d'où
     les trois axes de ce côté. */
  LeftArm:       { z: -1.50, x:  0.10, y:  0.05 },
  RightArm:      { z: -0.39, x: -1.14, y:  1.01 },
  LeftForeArm:   { x: -0.30, y:  0.12 },
  RightForeArm:  { x: -0.24, y: -0.09 },
  LeftHand:      { x: -0.12, z:  0.07 },
  RightHand:     { x: -0.09, z: -0.05 },
  Spine:         { x:  0.030 },
  Chest:         { x: -0.018 },
  UpperChest:    { x:  0.012 },
  Neck:          { x:  0.022 },
  Head:          { x:  0.014, y: -0.02 },
  LeftUpLeg:     { x: -0.02 },
  RightUpLeg:    { x:  0.01 },
  LeftLeg:       { x:  0.05 },
  RightLeg:      { x:  0.04 },
};

/* Bruit lisse apériodique : somme de sinus aux périodes volontairement non
   harmoniques. Aucune de ces sommes ne se répète à une échelle que l'œil
   puisse retenir — c'est ce qui remplace l'ancienne boucle de 6,4 s, dont
   on voyait le début et la fin. */
function smoothNoise(t, seed){
  return (Math.sin(t*0.6180 + seed*1.7) * 0.55
        + Math.sin(t*0.2411 + seed*4.1) * 0.30
        + Math.sin(t*1.1279 + seed*2.3) * 0.15);
}

/* Rampe douce 0→1→0 sur [0,1], utilisée pour les gestes ponctuels. */
function bell(u){
  if(u <= 0 || u >= 1) return 0;
  const s = Math.sin(u*Math.PI);
  return s*s;
}
function smoothstep(a, b, v){
  const k = Math.max(0, Math.min(1, (v-a)/(b-a)));
  return k*k*(3-2*k);
}

/* ---------- Attention : ce que le personnage regarde ----------
   Le regard est ce qui donne l'impression que le pion COMPREND ce qui se
   passe. Une cible peut être posée par le jeu (la case visée, le lot qui
   vient d'apparaître) ; en l'absence de cible, il regarde de lui-même
   autour de lui, à intervalles irréguliers.
   Le modèle n'a pas d'yeux mobiles — ce sont deux ellipses peintes dans la
   texture, et les redessiner décalées reviendrait à retoucher un visage
   que je dois laisser intact. Le regard passe donc par la tête et la nuque,
   la tête menant toujours d'un cran sur le torse. */
const _lookTarget = new THREE.Vector3();
const _lookTmp = new THREE.Vector3();
let lookActive = false, lookUntil = 0, lookWeight = 0;
let glanceYaw = 0, glancePitch = 0, glanceNext = 3;
/* Curiosité : il vient d'arriver quelque part et il ne sait pas encore
   où il est. Il lève la tête vers le ciel, redescend sur le plateau,
   balaie autour de lui. C'est ce qui donne un personnage qui DÉCOUVRE
   plutôt qu'un pion qui attend. `glanceUp` mémorise à quel point il est
   en train de regarder en l'air : le buste s'ouvre d'autant, sinon seule
   la tête bouge et ça fait pantin. */
let glanceUp = 0, glanceEncore = 0;
let gazeYaw = 0, gazePitch = 0, gazeYawV = 0, gazePitchV = 0;

function lookAtPoint(x, y, z, holdSec){
  _lookTarget.set(x, y, z);
  lookActive = true;
  lookUntil = clock.getElapsedTime() + (holdSec || 1.6);
}
function lookAtTile(tile, holdSec){
  if(!tile) return;
  lookAtPoint(tile.world.x, tile.tileTopY + 0.55, tile.world.z, holdSec);
}

/* ---------- Petite "vie" du pion au repos (respiration, regard,
   clignement, gestes) ----------
   Superposée APRÈS mixer.update() : le mixer pose d'abord la pose de
   l'anim "idle" du modèle Kenney (statique, bras le long du corps),
   puis on ajoute ici de petites rotations locales sur quelques os —
   jamais de remplacement de la pose, juste un delta additif rejoué
   depuis la valeur que le mixer vient de poser à cette frame (donc
   sans dérive d'une frame à l'autre, purement fonction du temps
   écoulé). Toute la boucle est une fonction périodique exacte de
   période IDLE_LIFE_PERIOD : comme le jeu tourne en continu (pas une
   vidéo à durée fixe), c'est déjà une boucle parfaite — elle se
   répète à l'identique indéfiniment, sans aucune coupure visible. */
const IDLE_LIFE_PERIOD = 6.4;

function findBone(root, name){
  let found = null;
  root.traverse(o=>{ if(!found && o.isBone && o.name===name) found = o; });
  return found;
}

/* Bosse lisse centrée sur `center` (0..1, cyclique), de demi-largeur
   `width` : utile pour un geste ponctuel dans la boucle plutôt qu'une
   sinusoïde continue (un "regard" ou un petit geste doit avoir un
   début et une fin, pas juste osciller sans arrêt). */
function pulse(ph, center, width, power){
  let d = Math.abs(ph-center);
  d = Math.min(d, 1-d) / width;
  return d<1 ? Math.pow(1-d*d, power||2) : 0;
}

/* Découpe la texture de peau (déjà chargée pour le matériau du
   personnage) en un <canvas> qu'on peut redessiner : au repos, les
   yeux sont peints directement dans la texture (pas de géométrie de
   paupière séparée), donc "cligner des yeux" veut dire repeindre par-
   dessus un petit rectangle couleur peau à l'endroit des yeux pendant
   quelques dixièmes de seconde, puis revenir à la texture d'origine —
   un aller-retour bien moins coûteux qu'un changement de géométrie,
   et qui ne redessine que sur un changement d'état (pas à chaque
   frame). */
function setupBlink(material, srcTexture){
  const img = srcTexture.image;
  if(!img || !img.width) return { update(){} };
  const w = img.width, h = img.height;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = srcTexture.colorSpace;
  tex.flipY = srcTexture.flipY;
  tex.wrapS = srcTexture.wrapS;
  tex.wrapT = srcTexture.wrapT;
  material.map = tex;
  material.needsUpdate = true;

  // Zones des deux yeux dans la texture, en fractions 0..1 de la
  // largeur/hauteur. Elles sortent du script qui peint la texture du
  // pion (il les calcule à partir du cadre réservé au visage), pas
  // d'un relevé à l'œil : si le visage bouge dans l'atlas, ces
  // valeurs doivent être reprises de là.
  const EYES = [
    {x0:0.1695, y0:0.1293, x1:0.3066, y1:0.2343},
    {x0:0.3574, y0:0.1293, x1:0.4945, y1:0.2343},
  ];
  const SKIN = '#eeac84';
  let closed = false;
  function setClosed(v){
    if(v===closed) return;
    closed = v;
    ctx.drawImage(img, 0, 0, w, h);
    if(v){
      ctx.fillStyle = SKIN;
      EYES.forEach(e=>{
        const ex = e.x0*w, ey = e.y0*h;
        ctx.fillRect(ex, ey, (e.x1-e.x0)*w, (e.y1-e.y0)*h);
      });
    }
    tex.needsUpdate = true;
  }
  /* Clignement à intervalles IRRÉGULIERS. L'ancienne version clignait à
     deux instants fixes de la boucle de 6,4 s : au bout de quelques
     secondes l'œil anticipait le prochain. Ici l'attente suit une loi
     exponentielle (comme un vrai clignement, imprévisible), avec parfois
     un double clignement rapproché. */
  let closeFor = 0, nextIn = 1.5 + Math.random()*3, burst = 0;
  return {
    update(dt){
      if(closeFor > 0){
        closeFor -= dt;
        if(closeFor <= 0){
          setClosed(false);
          if(burst > 0){ burst--; nextIn = 0.10 + Math.random()*0.06; }
          else nextIn = 1.1 - Math.log(Math.random() + 1e-6) * 2.6;
        }
        return;
      }
      nextIn -= dt;
      if(nextIn <= 0){
        setClosed(true);
        closeFor = 0.075 + Math.random()*0.055;
        if(burst === 0 && Math.random() < 0.18) burst = 1;
      }
    },
  };
}

/* Hauteur RÉELLE du pion au-dessus de ses pieds, relevée une fois sur le
   modèle chargé. On ne peut pas se fier à PLAYER_TARGET_HEIGHT : c'est la
   hauteur visée, mais la mise à l'échelle du modèle est calculée sur une
   Box3 qui ignore le skinning, et le personnage rendu fait en pratique
   près du double. Un lot flottant calé sur 0.82 s'arrêtait donc au niveau
   du torse et coupait le pion en deux. computeBoundingBox() d'une
   SkinnedMesh, lui, applique les matrices d'os et donne la vraie
   silhouette — coûteux (il parcourt tous les sommets), d'où un relevé
   limité aux premières frames.
   Le relevé est pris sur des frames déjà POSÉES (l'appel se fait après
   mixer.update) et on garde le maximum : sur la toute première frame le
   squelette n'a pas encore ses matrices d'os, computeBoundingBox rend
   une boîte écrasée, et un relevé unique se figeait sur cette valeur
   fausse. */
let playerTopOffset = PLAYER_TARGET_HEIGHT;
let playerTopSamples = 0, playerTopSkip = 0;
let footCalSamples = 0, footCalDone = false;
function measurePlayerTop(){
  if(playerTopSamples >= 60 || !player.root.children.length) return;
  // un relevé toutes les 8 frames : la boucle "idle" dure 6,4 s, donc
  // 60 relevés d'affilée n'en couvriraient qu'une fraction et la
  // silhouette la plus haute du cycle passerait à côté.
  if(playerTopSkip-- > 0) return;
  playerTopSkip = 7;
  playerTopSamples++;
  let maxY = -Infinity, minY = Infinity;
  player.root.updateWorldMatrix(true, true);
  player.root.traverse(o=>{
    if(!o.isSkinnedMesh) return;
    if(typeof o.computeBoundingBox === 'function') o.computeBoundingBox();
    const src = o.boundingBox || o.geometry.boundingBox;
    if(!src) return;
    const bb = src.clone().applyMatrix4(o.matrixWorld);
    if(bb.max.y > maxY) maxY = bb.max.y;
    if(bb.min.y < minY) minY = bb.min.y;
  });
  if(maxY > -Infinity){
    playerTopOffset = Math.max(playerTopOffset, maxY - player.root.position.y);
  }
  /* Calage des pieds sur la case.
     Le modèle est posé au chargement avec `model.position.y = -box.min.y`,
     où box est une Box3 qui IGNORE le skinning : elle décrit la pose de
     liaison du maillage, pas l'endroit où les semelles se retrouvent une
     fois le squelette appliqué. Résultat, le pion flottait 0,20 unité
     au-dessus de la case — 14 % de sa hauteur — et ne pouvait donc
     jamais donner l'impression de prendre appui.
     On relève ici le point le plus bas RÉELLEMENT rendu, sur plusieurs
     frames posées, et on descend le modèle d'autant. */
  if(!footCalDone && !walk && minY < Infinity && player.model){
    // `sole` > 0 : le point le plus bas rendu est AU-DESSUS de la case,
    // donc le pion flotte. On descend le modèle d'une fraction de l'écart
    // à chaque relevé ; en une douzaine de relevés la semelle rejoint le
    // plateau. Amorti plutôt qu'appliqué d'un coup, parce que déplacer le
    // modèle change la mesure suivante.
    // Uniquement à l'arrêt : pendant un bond la semelle quitte le sol
    // pour de bonnes raisons, et corriger là-dessus l'enfoncerait.
    const sole = minY - player.root.position.y;
    player.model.position.y -= sole * 0.6;
    /* On profite de ce relevé, pris sur le pion réellement posé, pour
       fixer la géométrie de marche : hauteur de hanche et hauteur de
       pied AU REPOS, dans le repère de la racine. Les coder en dur
       marchait tant que rien d'autre ne bougeait le modèle — or la
       calibration ci-dessus le descend justement de quelques
       centièmes, et la cinématique inverse visait alors un pied sous
       la case. Mesurées ici, les deux valeurs restent cohérentes quoi
       qu'il arrive au modèle. */
    if(player.bones && player.bones.LeftFoot && player.bones.LeftUpLeg){
      const _v = new THREE.Vector3();
      player.root.updateWorldMatrix(true, true);
      player.bones.LeftUpLeg.getWorldPosition(_v);
      GAIT.hipY = _v.y - player.root.position.y;
      player.bones.LeftFoot.getWorldPosition(_v);
      GAIT.footY = _v.y - player.root.position.y;
    }
    if(++footCalSamples >= 14) footCalDone = true;
  }
}

/* ---------- Réactions, calibrées sur l'importance réelle de l'événement
   ----------------------------------------------------------------------
   L'ancienne version levait les bras de 1,15 rad multipliés par une force
   allant jusqu'à 1,6, soit 105° par bras : un geste de théâtre pour une
   case de plateau. Ici l'amplitude est plafonnée à ~0,55 rad (31°) même
   pour le jackpot, et les petits événements ne produisent QUE du regard et
   un changement de posture. Le geste doit rester rare pour vouloir dire
   quelque chose. */
const REACTIONS = {
  // niveau : [durée, levée de bras, hochement, saut, nb de sauts]
  1: { dur:1.10, arm:0.00, nod:0.055, hop:0.000, hops:0 },
  2: { dur:1.25, arm:0.10, nod:0.075, hop:0.000, hops:0 },
  3: { dur:1.45, arm:0.26, nod:0.090, hop:0.022, hops:1 },
  4: { dur:1.70, arm:0.42, nod:0.105, hop:0.038, hops:2 },
  5: { dur:1.95, arm:0.55, nod:0.120, hop:0.050, hops:2 },
};
let reactT0 = -1, reactSpec = null, reactSettle = false;
let reactArm = 0, reactNod = 0, reactWave = 0, reactHopY = 0, playerBaseY = 0;

function triggerReaction(level){
  if(reduceMotion) return;
  const spec = REACTIONS[Math.max(1, Math.min(5, Math.round(level)))] || REACTIONS[1];
  reactSpec = spec;
  reactT0 = clock.getElapsedTime();
  reactSettle = true;
}
/* Ancien nom conservé : le reste du jeu l'appelle encore. La force reçue
   est retraduite en niveau d'événement. */
function triggerCheer(strength){
  triggerReaction(Math.round(2 + (strength || 1) * 1.9));
}

function updateReaction(t){
  if(reactT0 < 0) return;
  const s = reactSpec;
  const u = (t - reactT0) / s.dur;
  if(u >= 1){ reactT0 = -1; reactArm = 0; reactNod = 0; reactWave = 0; reactHopY = 0; return; }

  /* Anticipation : avant de lever quoi que ce soit, le corps se tasse very
     légèrement — c'est ce contre-mouvement qui donne du poids au geste.
     Sans lui, un bras qui monte part de nulle part. */
  const antic = u < 0.13 ? -Math.sin(u/0.13 * Math.PI) * 0.30 : 0;
  const rise  = smoothstep(0.08, 0.34, u) * (1 - smoothstep(0.62, 1.0, u));

  reactArm = s.arm * (rise + antic*0.5);
  reactNod = s.nod * (rise + antic);
  // les deux bras ne montent pas exactement pareil ni en même temps
  reactWave = Math.sin(u*Math.PI*3.7) * 0.16 + 0.09;

  if(s.hops > 0){
    const hopPhase = u * s.hops * 1.9;
    const k = hopPhase < s.hops ? Math.abs(Math.sin(hopPhase*Math.PI)) : 0;
    reactHopY = k * s.hop * (1 - u*0.35);
  } else {
    reactHopY = 0;
  }
}

/* ---------- Le corps, frame par frame ----------
   `buildBodyLayer` renvoie la fonction appelée après chaque mixer.update.
   Elle compose, dans cet ordre : pose de repos → respiration et report du
   poids → corrections posturales → regard → marche → réaction. */
/* ---------- Géométrie de la foulée : SOURCE UNIQUE ----------
   La couche d'animation (trajectoire du pied) et le moteur de
   déplacement (avance de la phase) doivent employer exactement la même
   foulée. Si les deux valeurs divergent d'un pour cent, le pied posé
   patine. Elles sont donc calculées ici, à un seul endroit, à partir des
   dimensions relevées sur le modèle.

   Dimensions mesurées (pas estimées) : cuisse 0,1509, tibia 0,1746,
   hanche à 0,3668 et pied à 0,0492 au-dessus de la racine. La jambe fait
   0,3255 pour une hauteur hanche-pied de 0,3176 : elle est tendue à
   98 % debout. Une case fait 1,0, soit trois longueurs de jambe — il
   faut donc environ trois pas par case, et c'est cette contrainte qui
   fixe la vitesse maximale au-delà de laquelle le pied patinerait.
   On tient dans cette limite en allongeant la foulée avec la vitesse
   (le bassin descend, la jambe s'ouvre) plutôt qu'en accélérant la
   cadence : c'est ce qu'on fait en passant de la marche à la course. */
/* Réglages du squelette, tous relevés par balayage sur le modèle lui-même
   et non estimés :
     ankle -1,0   l'axe du pied est INVERSE à celui du genou sur ce rig ;
                  dans l'autre sens la pointe plongeait dans la case.
     hipsZ 0,022  à 0,075 le buste roulait de 4,8° à chaque pas, ce qui se
                  lisait comme un personnage de travers.
     clear 0,045  garde au sol : marge mesurée pour que la semelle ne
                  morde pas la case pendant l'appui.
     symL/symR    la main gauche pendait 6,6 cm EN ARRIÈRE de son épaule
                  pendant que la droite tombait à l'aplomb — les deux
                  épaules n'ont pas la même orientation de liaison. */
const RIG = { ankle:-1.0, hipsZ:0.022, clear:-0.002, toeIn:0.12,
              symL:0.135, symR:0.09, restLX:0.10, restRX:-1.14 };
const GAIT = {
  thigh: 0.1509, shin: 0.1746, hipY: 0.3668, footY: 0.0492,
  reach: (0.1509 + 0.1746) * 0.995,
  // descente du bassin : sans elle, jambe tendue, aucun pas n'est possible
  /* Descente du bassin AU DOUBLE APPUI (les deux jambes ouvertes). En
     appui simple le bassin remonte de `rise` (voir osc dans le pilote de
     marche) : c'est le pendule inversé de la marche, jambe d'appui
     presque tendue au passage à la verticale. Mesuré avant : genou
     entre 71° et 132° tout le cycle, jamais tendu. */
  crouch: sp => (0.033 + 0.003*sp) ,
  rise: 0.026,
  // pied : longueur cheville→orteils et angle sous l'horizontale, relevés
  footL: 0.085, footA: 0.663,
  // part du cycle passée au sol : >0,5 on marche, <0,5 on court
  /* Part du cycle passée au sol : constante, pour que la foulée reste
     EXACTEMENT 2/3 de case (3 pas par case) quelle que soit l'allure —
     chaque centre de case tombe sur une pose de pied. */
  duty:   sp => 0.42,
  lift:   sp => 0.035 + 0.025*sp,
  // inclinaison du plan de jambe, relevée sur le modèle (voir plus bas)
  tilt: 0.25,
  /* Résidu en cuvette relevé après la correction linéaire : cheville
     +1,8 cm trop haute pied devant (dz=+0,106), +0,5 cm pied derrière
     (dz=−0,139), minimum vers dz=−0,05. Terme quadratique relevé. */
  curv: 0.7, curvC: -0.05,
  /* Marge de sol. Relevé image par image pendant un appui : le pied
     descendait jusqu'à 0,02 sous la hauteur qu'il a debout, donc la
     semelle mordait légèrement la case. On relève la cible d'autant. */
  get clearance(){ return RIG.clear; },
  // demi-foulée = ouverture maximale de la jambe à la hauteur de bassin donnée
  /* Demi-foulée. On la calcule avec une allonge volontairement PLUS
     COURTE que l'allonge réelle : la jambe garde ainsi une réserve
     d'extension, et la micro-oscillation du bassin ne peut jamais la
     mettre en butée. Une jambe en butée n'atteint pas sa cible, et le
     pied rattrape la différence en glissant — c'était la principale
     source de patinage restante. */
  ext(sp){
    const gh = this.hipY - this.footY - this.crouch(sp);
    const r = this.reach * 0.985;
    const geo = Math.sqrt(Math.max(1e-4, r*r - gh*gh));
    /* Mesuré : à l'ouverture géométrique maximale, l'écart entre les
       deux pieds atteignait 0,49 pour une jambe de 0,33 — un grand
       écart, jambe tendue à chaque extrémité. Une marche rapide humaine
       ouvre les pieds d'environ 85 % de la longueur de jambe : on
       plafonne la demi-foulée, la jambe garde une vraie réserve de
       flexion et le genou ne claque plus en butée. */
    /* Foulée verrouillée : 3 pas par case, soit un cycle = 2/3 case,
       donc demi-foulée = duty/3. Avant, la foulée dépendait de l'allure
       (0,60 à 0,64 case par cycle) : le nombre de pas par case n'était
       pas entier, il finissait en plein pas, à cheval sur deux cases. */
    return Math.min(geo, this.duty(sp)/3);
  },
  /* Distance parcourue par UN cycle (deux pas), en cases.
     Pendant l'appui le pied recule de 2·ext par rapport à la hanche, et
     cet appui dure `duty` du cycle : pour que le pied reste immobile au
     sol, le corps doit donc avancer de 2·ext/duty sur le cycle entier.
     Cette égalité est la condition exacte du non-patinage. */
  stride(sp){ return 2*this.ext(sp)/this.duty(sp); },
  // angles hanche/genou du pion simplement debout, jambes sous le bassin
  standPose(){
    const d = Math.min(this.hipY - this.footY, this.reach);
    const c1 = (this.thigh*this.thigh + this.shin*this.shin - d*d)/(2*this.thigh*this.shin);
    const knee = Math.PI - Math.acos(Math.max(-1, Math.min(1, c1)));
    const c2 = (this.thigh*this.thigh + d*d - this.shin*this.shin)/(2*this.thigh*d);
    const hip = Math.acos(Math.max(-1, Math.min(1, c2)));
    return { hip, knee };
  },
};

let updateBodyReset = null;
function buildBodyLayer(bones, blink, model){
  /* Pose de référence, relevée AVANT que le moindre clip ne soit lu, et
     conservée en QUATERNION.
     Le passage par les angles d'Euler était une erreur : la pose de
     liaison de ce rig porte déjà des angles énormes sur les bras
     (x ≈ 2,19 rad, z ≈ -1,88). Additionner un décalage d'Euler à de
     telles valeurs ne compose pas les rotations, ça produit n'importe
     quoi — les bras partaient à l'horizontale dans des poses aberrantes.
     L'ancienne correction du code, elle, MULTIPLIAIT un quaternion ;
     c'était la bonne méthode, et c'est celle reprise ici. */
  const bind = {};
  for(const n of RIG_BONES){
    const b = bones[n];
    if(b) bind[n] = { q: b.quaternion.clone(), py: b.position.y };
  }
  // décalages de repos pré-composés une fois pour toutes
  const restQ = {};
  function rebuildRestQ(){
    REST_POSE.LeftArm.x  = RIG.restLX;
    REST_POSE.RightArm.x = RIG.restRX;
    for(const n of RIG_BONES){
      const r = REST_POSE[n];
      restQ[n] = r ? new THREE.Quaternion().setFromEuler(
        new THREE.Euler(r.x||0, r.y||0, r.z||0, 'XYZ')) : null;
    }
  }
  rebuildRestQ();
  const _qA = new THREE.Quaternion(), _qB = new THREE.Quaternion();
  const _eA = new THREE.Euler(0,0,0,'XYZ');

  // deltas de la frame courante
  const d = {};
  const resetDeltas = ()=>{
    for(const n of RIG_BONES) d[n] = { x:0, y:0, z:0, py:0 };
  };
  const add = (n, ax, v)=>{ if(d[n]) d[n][ax] += v; };
  /* Les deux bras de ce rig n'ont PAS des axes miroirs. Mesuré en
     déplaçant la main pour +0,5 rad sur chaque axe :
       LeftArm  x : main +13,9 cm devant, 0 latéral   (sagittal pur)
       RightArm x : main 11,1 cm DERRIÈRE, 7 cm dehors ; z : 7,8 cm devant, 11 cm dehors
       LeftForeArm  x : main 7,4 cm devant (coude se plie vers l'avant)
       RightForeArm x : main 5,8 cm DERRIÈRE (même signe = coude vers l'arrière)
     Le code appliquait le même signe aux deux : le coude gauche se pliait
     à l'envers et le bras gauche balançait presque uniquement vers
     l'arrière (mesuré : +4° devant / −52° derrière, contre +39°/−13° à
     droite). Ces deux aides expriment un mouvement « vers l'avant » en
     radians et le traduisent en rotations propres à chaque côté, avec
     la composante latérale annulée à droite. */
  const armFwd = (side, s)=>{
    if(side==='L'){ add('LeftArm','x', s); }
    else { add('RightArm','x', -0.86*s); add('RightArm','z', 0.55*s); }
  };
  const elbowFwd = (side, b)=>{
    if(side==='L'){ add('LeftForeArm','x', b); }
    else {
      add('RightForeArm','x', -0.80*b); add('RightForeArm','z', 0.63*b);
      /* La flexion du coude droit vrille l'avant-bras : mesuré, la
         normale de la main droite pointait à 79 % vers le ciel en marche
         (paume vers le haut), contre 0 % à gauche. Une rotation de −1,0
         sur l'axe long de l'avant-bras pour une flexion de 1,2 la remet
         horizontale, vers le corps, pouce en haut (vérifié sur l'os du
         pouce). Proportionnelle à la flexion : rien au repos. */
      add('RightForeArm','y', -0.85*b);
    }
  };

  /* Poids du clip par os.

     Mesuré os par os sur ce rig : au repos, le clip "idle" fourni avec
     le modèle fait balayer les bras sur ~130° en continu (main à 21° du
     corps puis 152°, soit au-dessus de l'épaule, toutes les 5 s). C'est
     très exactement l'effet épouvantail — il ne venait pas de
     l'animation procédurale, mais du clip lui-même, qu'on laissait
     passer à 100 %.

     On ne peut pas rééditer le clip depuis le jeu ; on l'atténue. Le
     slerp part de la pose de liaison (bras en croix) et REST_POSE les
     rabat le long du corps : à poids faible sur les bras, on obtient
     donc des bras qui pendent, et c'est le procédural (respiration,
     report de poids, regard) qui les fait vivre — discrètement.

     Le buste, le cou et les jambes gardent une part large du clip :
     c'est lui qui donne l'appui au sol et la respiration du torse. */
  /* Sens de rotation des os de jambe sur ce rig : la pose de liaison
     porte des angles proches de ±pi sur les cuisses, le signe n'est donc
     pas devinable — il est relevé sur le modèle. */
  const LEG_DIR = -1, KNEE_DIR = 1;
  /* Dimensions relevées sur le modèle (pas estimées) : la hanche est à
     0,3176 au-dessus du pied pour une jambe de 0,3255 — tendue à 98 %. */
  const LEG_THIGH = GAIT.thigh, LEG_SHIN = GAIT.shin;

  const CLIP_WEIGHT_IDLE = {
    LeftArm:0.10, RightArm:0.10, LeftForeArm:0.16, RightForeArm:0.16,
    LeftHand:0.22, RightHand:0.22, LeftShoulder:0.30, RightShoulder:0.30,
    Neck:0.55, Head:0.45,
  };
  // À la marche on laisse un peu plus de balancement : c'est le bras qui
  // contrebalance le pas. Toujours loin du 100 % d'origine.
  const CLIP_WEIGHT_WALK = {
    LeftArm:0.22, RightArm:0.22, LeftForeArm:0.28, RightForeArm:0.28,
    LeftHand:0.35, RightHand:0.35, LeftShoulder:0.45, RightShoulder:0.45,
    Spine:0.7, Chest:0.7, UpperChest:0.7, Neck:0.5, Head:0.4,
    // jambes : 0, le clip n'y met qu'un tremblement (voir plus bas)
    LeftUpLeg:0, RightUpLeg:0, LeftLeg:0, RightLeg:0,
    LeftFoot:0, RightFoot:0, Hips:0,
  };

  let breathPhase = Math.random()*10;
  let weightSide = 0, weightTarget = 0, weightNext = 2 + Math.random()*3;
  let postureT = 0;
  let lastT = 0;

  /* Remise à la pose de liaison AVANT chaque mixer.update().

     Sans elle, les os que le clip ne pilote pas (le buste, sur ce
     modèle) conservent d'une frame à l'autre la valeur que NOUS leur
     avons écrite : le décalage de repos et le procédural se
     remultiplient alors indéfiniment. Mesuré : le buste basculait de
     0° à 87° de la verticale en huit secondes, sans jamais revenir —
     le personnage se pliait en deux debout sur sa case. C'est la
     source des "figures" à l'écran.

     Le mixer réécrit ensuite les os qu'il pilote ; ceux qu'il ne
     pilote pas restent à la pose de liaison, propre, et notre couche
     repart chaque frame d'une base connue. */
  updateBodyReset = function(){
    for(const n of RIG_BONES){
      const b = bones[n], bd = bind[n];
      if(b && bd){ b.quaternion.copy(bd.q); b.position.y = bd.py; }
    }
  };

  return function updateBody(t, ctx){
    const dt = Math.max(0, Math.min(0.05, t - lastT));
    lastT = t;
    resetDeltas();
    /* Pieds dans l'axe : mesuré, les deux pointes s'ouvraient de 12° vers
       l'extérieur (pieds « en travers »). On les ramène à ~5°. Sur ce rig
       l'axe z du pied le fait pivoter à plat, même sens des deux côtés. */
    add('LeftFoot','z',   RIG.toeIn);
    add('RightFoot','z', -RIG.toeIn);

    const walking = ctx && ctx.walking;
    const gait    = ctx && ctx.gait || 0;     // 0..1, intensité de la marche
    const stepPh  = ctx && ctx.stepPhase || 0; // 0..1 sur un cycle complet

    /* ---- 1. Respiration ----
       Deux fréquences légèrement décalées pour que l'inspiration et
       l'expiration n'aient pas exactement la même durée, comme une vraie
       respiration. Amplitude volontairement minuscule : on doit la
       deviner, pas la voir. */
    breathPhase += dt * (0.26 + gait*0.22);
    const breath = Math.sin(breathPhase*Math.PI*2) * 0.55
                 + Math.sin(breathPhase*Math.PI*2*2.03 + 1.1) * 0.18;
    add('Chest','x', breath*0.019);
    add('UpperChest','x', -breath*0.009);
    add('Spine','x', breath*0.006);
    add('LeftShoulder','z', breath*0.012);
    add('RightShoulder','z', -breath*0.010);

    /* Symétrie des bras au repos. Mesuré : la main gauche pendait 6,6 cm
       EN ARRIÈRE de son épaule pendant que la droite tombait à l'aplomb —
       d'où la posture de travers à l'arrêt. Les deux épaules n'ayant pas
       la même orientation de liaison, aucune valeur de REST_POSE ne
       corrigeait ça (le décalage de repos se compose avant le
       procédural, donc sur un autre axe). On rattrape ici, sur l'axe
       dont on a vérifié qu'il fait bien avancer la main. */
    add('LeftArm','x',  RIG.symL);
    add('RightArm','x', RIG.symR);

    /* ---- 2. Report du poids d'un pied sur l'autre ----
       Au repos, personne ne tient son poids réparti également très
       longtemps. Le report change de côté à intervalles IRRÉGULIERS, et le
       genou du côté déchargé fléchit un peu : c'est ce détail qui fait
       lire un corps qui tient debout plutôt qu'un objet posé. */
    if(!walking){
      weightNext -= dt;
      if(weightNext <= 0){
        weightTarget = (Math.random()<0.5 ? -1 : 1) * (0.35 + Math.random()*0.65);
        weightNext = 2.6 + Math.random()*4.5;
      }
    } else {
      weightTarget = 0;
    }
    weightSide += (weightTarget - weightSide) * Math.min(1, dt*1.1);
    const w = weightSide * (1 - gait);
    add('Hips','z', w*0.045);
    add('Hips','y', w*0.02);
    d.Hips.py += -Math.abs(w)*0.004 + Math.abs(breath)*0.002;
    add('Spine','z', -w*0.022);
    add('Chest','z', -w*0.012);
    add('Neck','z', w*0.010);
    // le genou du côté déchargé fléchit
    add(w > 0 ? 'LeftLeg' : 'RightLeg', 'x', Math.abs(w)*0.10);
    add(w > 0 ? 'LeftUpLeg' : 'RightUpLeg', 'x', -Math.abs(w)*0.03);
    // les bras suivent le bassin avec un temps de retard (inertie)
    add('LeftArm','z', -w*0.030);
    add('RightArm','z', -w*0.028);

    /* ---- 3. Corrections posturales ----
       Bruit apériodique de très faible amplitude sur la colonne et la
       nuque. C'est ce qui empêche la silhouette de se figer entre deux
       gestes, sans jamais ressembler à un mouvement voulu. */
    postureT += dt;
    const pn = postureT * 0.55;
    add('Spine','x', smoothNoise(pn, 1)*0.010);
    add('Spine','y', smoothNoise(pn, 2)*0.014);
    add('Chest','y', smoothNoise(pn, 3)*0.010);
    add('Neck','x', smoothNoise(pn, 4)*0.012);
    add('Neck','y', smoothNoise(pn, 5)*0.016);
    add('LeftForeArm','x', smoothNoise(pn, 6)*0.020);
    add('RightForeArm','x', smoothNoise(pn, 7)*0.018);
    add('LeftHand','z', smoothNoise(pn, 8)*0.030);
    add('RightHand','z', smoothNoise(pn, 9)*0.026);

    /* ---- 4. Regard ----
       Une cible posée par le jeu l'emporte ; sinon le pion jette des coups
       d'œil autour de lui à intervalles irréguliers. La tête va plus loin
       que la nuque, qui va plus loin que le torse : le mouvement se
       propage au lieu de partir d'un bloc. */
    let wantYaw = 0, wantPitch = 0;
    const now = t;
    if(lookActive && now < lookUntil && bones.Head){
      bones.Head.updateWorldMatrix(true, false);
      _lookTmp.setFromMatrixPosition(bones.Head.matrixWorld);
      const dx = _lookTarget.x - _lookTmp.x;
      const dy = _lookTarget.y - _lookTmp.y;
      const dz = _lookTarget.z - _lookTmp.z;
      const horiz = Math.max(0.001, Math.hypot(dx, dz));
      const worldYaw = Math.atan2(dx, dz);
      wantYaw = Math.atan2(Math.sin(worldYaw - ctx.bodyYaw), Math.cos(worldYaw - ctx.bodyYaw));
      wantPitch = -Math.atan2(dy, horiz);
      lookWeight += (1 - lookWeight) * Math.min(1, dt*4.5);
    } else {
      if(lookActive && now >= lookUntil) lookActive = false;
      lookWeight += (0 - lookWeight) * Math.min(1, dt*2.2);
      /* ---- il découvre l'endroit ----
         Trois façons de regarder, tirées au sort, jamais au même
         rythme. L'ancienne version ne faisait varier le regard que de
         7° en hauteur : il ne levait jamais vraiment la tête, et ça se
         lisait comme un pion qui attend son tour, pas comme quelqu'un
         qui arrive quelque part. */
      glanceNext -= dt;
      if(glanceNext <= 0){
        const r = Math.random();
        if(glanceEncore > 0){
          // deuxième regard, un peu plus loin : il revérifie ce qu'il a vu
          glanceEncore--;
          glanceYaw   *= 1.25 + Math.random()*0.3;
          glancePitch *= 1.15 + Math.random()*0.25;
          glanceNext = 1.1 + Math.random()*1.4;
        } else if(r < 0.42){
          // EN L'AIR : émerveillement. C'est le regard dominant.
          glancePitch = -(0.26 + Math.random()*0.24);
          glanceYaw   = (Math.random()*2-1) * 0.70;
          glanceNext  = 1.9 + Math.random()*1.6;
          if(Math.random() < 0.45) glanceEncore = 1;
        } else if(r < 0.68){
          // VERS LE BAS : il regarde la case sous ses pieds
          glancePitch = 0.18 + Math.random()*0.16;
          glanceYaw   = (Math.random()*2-1) * 0.35;
          glanceNext  = 1.2 + Math.random()*1.0;
        } else if(r < 0.94){
          // AUTOUR : il balaie le plateau
          glancePitch = -0.05 + Math.random()*0.14;
          glanceYaw   = (Math.random()*2-1) * 0.88;
          glanceNext  = 1.0 + Math.random()*1.5;
          if(Math.random() < 0.3) glanceEncore = 1;
        } else {
          // il revient au centre, le temps de souffler
          glanceYaw *= 0.12; glancePitch *= 0.15;
          glanceNext = 1.4 + Math.random()*1.8;
        }
        glanceYaw   = Math.max(-0.95, Math.min(0.95, glanceYaw));
        glancePitch = Math.max(-0.52, Math.min(0.40, glancePitch));
      }
      wantYaw = glanceYaw; wantPitch = glancePitch;
    }
    if(walking){
      // en marchant il regarde plutôt où il va
      wantYaw *= 0.35; wantPitch = wantPitch*0.3 - 0.02;
    }
    // amortisseur à ressort : la tête ne se téléporte pas sur sa cible
    const kSpring = 26, kDamp = 9.5;
    gazeYawV   += ((wantYaw   - gazeYaw)   * kSpring - gazeYawV   * kDamp) * dt;
    gazePitchV += ((wantPitch - gazePitch) * kSpring - gazePitchV * kDamp) * dt;
    gazeYaw   += gazeYawV * dt;
    gazePitch += gazePitchV * dt;
    gazeYaw   = Math.max(-0.95, Math.min(0.95, gazeYaw));
    gazePitch = Math.max(-0.52, Math.min(0.40, gazePitch));
    add('Head','y', gazeYaw*0.62);  add('Head','x', gazePitch*0.66);
    add('Neck','y', gazeYaw*0.28);  add('Neck','x', gazePitch*0.26);
    add('Chest','y', gazeYaw*0.09);
    add('UpperChest','y', gazeYaw*0.07);
    // la tête s'incline légèrement du côté où elle tourne — un réflexe
    // qu'on ne remarque que quand il manque
    add('Head','z', -gazeYaw*0.10);

    /* Quand il regarde en l'air, le buste s'ouvre et le bassin recule un
       peu : c'est le corps entier qui lève les yeux. Sans ça, seule la
       tête bascule et on voit un pantin. */
    const versLeHaut = Math.max(0, -gazePitch);
    glanceUp += (versLeHaut - glanceUp) * Math.min(1, dt*3.5);
    if(!walking){
      add('Chest','x',       glanceUp*0.17);
      add('UpperChest','x',  glanceUp*0.13);
      add('Spine','x',       glanceUp*0.07);
      add('Hips','x',       -glanceUp*0.04);
      // les bras s'écartent très légèrement, comme quand on lève les yeux
      add('LeftArm','z',  -glanceUp*0.07);
      add('RightArm','z',  glanceUp*0.07);
    }

    /* ---- 5. Marche ----
       Le cycle du clip fournit les jambes ; on ajoute ici ce que le clip
       ne fait pas : bassin qui accompagne le pas, torse qui contrebalance,
       bras en opposition franche aux jambes, coudes qui restent fléchis. */
    if(gait > 0.001){
      const ph = stepPh * Math.PI * 2;
      const sw = Math.sin(ph);          // cycle complet (2 pas)
      const st = Math.sin(ph*2);        // 1 par pas
      const sp = (ctx && ctx.speedK) || 0;   // 0 = marche, 1 = course

      /* ---- jambes : cycle construit ici, de zéro, en cinématique inverse ----
         Le clip "walk" livré avec le modèle ne marche pas. Mesuré os par
         os sur un cycle complet : le pied avance de 0,0095 et se lève de
         0,012, pour une jambe de 0,326 de long — 3 % de la longueur de
         jambe. Ce n'est pas un pas, c'est un tremblement sur place, et
         c'est exactement ce qu'on voyait. Aucun verrouillage de phase ne
         pouvait en tirer une marche ; le bond de case en case n'était
         qu'un contournement.

         On ne fait donc pas tourner des angles en espérant que le pied
         tombe juste : on décrit la TRAJECTOIRE DU PIED (posé au sol
         pendant l'appui, arc en l'air pendant le transfert) et on résout
         la hanche et le genou pour l'atteindre. C'est ce qui garantit
         qu'un pied au sol y reste — pas de patinage — quelle que soit la
         vitesse.

         Debout, la jambe est tendue à 98 % : aucune longueur de pas
         n'est atteignable sans fléchir. Le bassin descend donc un peu
         pendant la marche (et davantage en course), ce qui ouvre la
         foulée. C'est cette descente qui rend la marche possible. */
      /* Hauteur de hanche RÉELLE : pendant la mise en route, la descente
         du bassin s'installe progressivement. Si la cinématique inverse
         raisonne sur la descente théorique alors que le bassin n'est pas
         encore descendu, elle vise un pied trop bas et le pied traverse
         la case. On lui transmet donc la valeur effectivement appliquée. */
      const gh = GAIT.hipY - GAIT.footY
               - (ctx && ctx.crouch != null ? ctx.crouch : GAIT.crouch(sp));
      /* Pose debout de référence, recalculée à partir de la géométrie
         relevée : les angles de la cinématique inverse sont absolus,
         alors que la couche procédurale s'ajoute à la pose de liaison.
         On retranche donc ce que vaut la pose debout. */
      const stand = GAIT.standPose();
      const LEG_HIP0 = stand.hip, LEG_KNEE0 = stand.knee;
      const LEG_SHIN0 = LEG_HIP0 - LEG_KNEE0;
      const reach = GAIT.reach;
      const ext   = GAIT.ext(sp);         // demi-foulée
      const lift  = GAIT.lift(sp);        // hauteur de passage du pied
      const duty  = GAIT.duty(sp);        // part du cycle passée au sol

      // résolution 2 os dans le plan sagittal, hanche à l'origine
      const solve = (dz, dy)=>{
        let d = Math.hypot(dz, dy);
        d = Math.min(d, reach);
        const c1 = (LEG_THIGH*LEG_THIGH + LEG_SHIN*LEG_SHIN - d*d)/(2*LEG_THIGH*LEG_SHIN);
        const knee = Math.PI - Math.acos(Math.max(-1, Math.min(1, c1)));
        const c2 = (LEG_THIGH*LEG_THIGH + d*d - LEG_SHIN*LEG_SHIN)/(2*LEG_THIGH*d);
        const hip = Math.atan2(dz, dy) + Math.acos(Math.max(-1, Math.min(1, c2)));
        return { hip, knee };
      };

      /* L'amplitude du pas suit la montée en régime, mais la POSE est
         recalculée pour cette amplitude au lieu d'être appliquée à
         fraction. Appliquer 60 % d'une pose calculée pour 100 % n'est pas
         la pose correcte à 60 % : la relation n'est pas linéaire, et le
         pied s'enfonçait de 3 cm pendant les phases d'accélération et de
         freinage. Ici la cinématique inverse reçoit la vraie hauteur de
         bassin et la vraie longueur de pas, donc le pied tombe juste à
         chaque instant. */
      const amp = Math.max(0.30, gait);
      const extN = ext * amp;
      const liftN = lift * amp;
      const legPose = (off)=>{
        const t = ((stepPh + off) % 1 + 1) % 1;
        let dz, up;
        if(t < duty){                      // APPUI : le pied ne bouge pas du sol
          dz = extN - 2*extN*(t/duty);
          up = 0;
        } else {                           // TRANSFERT : arc vers l'avant
          const u = (t - duty)/(1 - duty);
          const e = u*u*(3 - 2*u);
          dz = -extN + 2*extN*e;
          // le pied passe haut TÔT (talon relevé derrière, genou qui
          // vient devant) puis redescend tendu vers l'attaque du talon
          up = liftN*Math.sin(Math.PI*Math.pow(u, 0.72));
        }
        /* ---- cheville : attaque du talon / décollement ----
           Le pied ne reste plus rigide. pitch > 0 = pointe vers le bas.
             • début d'appui   : talon d'abord, orteils relevés (−0,30 → 0)
             • fin d'appui     : le talon décolle, la cheville monte sur
                                 les orteils (0 → +0,45)
             • transfert       : la pointe pend puis se relève avant de
                                 reposer le talon.
           Quand la pointe est vers le bas et au sol, ce sont les ORTEILS
           le point de contact : la cible cheville est décalée d'autant
           (vers le haut et l'avant), pour que la pointe reste plantée. */
        let pitch = 0;
        const HEEL = 0.10, TOEOFF = 0.14;
        if(t < duty){
          if(t < HEEL) pitch = -0.30*(1 - t/HEEL);
          else if(t > duty - TOEOFF){ const q=(t-(duty-TOEOFF))/TOEOFF; pitch = 0.45*q*q; }
        } else {
          const u = (t - duty)/(1 - duty);
          const a = Math.max(0, 1 - u/0.5), b = Math.max(0, (u-0.55)/0.45);
          pitch = 0.45*a*a - 0.30*b*b;
        }
        let ankY = 0, ankZ = 0;
        if(pitch > 0){
          ankY = GAIT.footL*(Math.sin(GAIT.footA + pitch) - Math.sin(GAIT.footA));
          ankZ = GAIT.footL*(Math.cos(GAIT.footA) - Math.cos(GAIT.footA + pitch));
        }
        dz += ankZ; up += ankY;
        /* Correction de plan. La résolution ci-dessus raisonne dans un
           plan sagittal parfait ; or sur ce rig les jambes sont
           légèrement écartées et l'axe de la hanche n'est pas
           rigoureusement horizontal. Résultat mesuré : le pied décrit un
           arc au lieu d'une ligne, trop bas de 0,029 quand il est devant
           et trop haut de 0,033 quand il est derrière — une inclinaison
           d'environ 9° du plan de la jambe. L'écart étant proportionnel à
           l'avancée du pied, on le corrige par un simple terme linéaire,
           relevé sur le modèle. */
        const r = solve(dz, gh - (up + GAIT.clearance + GAIT.tilt*dz) + GAIT.curv*(dz-GAIT.curvC)*(dz-GAIT.curvC));
        return { hip: r.hip, knee: r.knee, shin: r.hip - r.knee, pitch };
      };
      const L = legPose(0), R = legPose(0.5);
      // les angles sont ABSOLUS : on retranche la pose debout, car la
      // couche procédurale s'ajoute à la pose de liaison
      /* Poids PLEIN : la pose ci-dessus est déjà la bonne pour l'état
         courant (hauteur de bassin et longueur de pas réelles). */
      add('LeftUpLeg','x',  LEG_DIR*(L.hip - LEG_HIP0));
      add('RightUpLeg','x', LEG_DIR*(R.hip - LEG_HIP0));
      add('LeftLeg','x',    KNEE_DIR*(L.knee - LEG_KNEE0));
      add('RightLeg','x',   KNEE_DIR*(R.knee - LEG_KNEE0));
      // la cheville garde la semelle à plat au lieu de suivre le tibia
      /* Cheville : elle contre le tibia pour garder la semelle à plat,
         mais BORNÉE. Sans borne, elle suivait la flexion du genou en
         phase aérienne et pivotait jusqu'à 46° pointe en bas : la pointe
         passait alors 13 cm sous l'os du pied et traversait la case.
         C'est ce qu'on voyait comme « il marche dans le plateau ». */
      const ank = a => -KNEE_DIR*(a - LEG_SHIN0)*RIG.ankle;
      add('LeftFoot','x',   ank(L.shin) + L.pitch);
      add('RightFoot','x',  ank(R.shin) + R.pitch);
      // les hanches basculent du côté de la jambe d'appui
      add('Hips','z', sw*RIG.hipsZ*gait);
      add('Hips','y', sw*0.055*gait);
      add('Spine','y', -sw*0.045*gait);
      add('Chest','y', -sw*0.055*gait);
      add('UpperChest','y', -sw*0.030*gait);
      add('Chest','x', Math.abs(st)*0.020*gait);
      /* ---- bras ----
         Deux erreurs corrigées ici. D'abord la PHASE : les bras étaient
         pilotés par un sinus alors que les jambes le sont par un
         cosinus — un quart de cycle d'écart, ce qui ne correspond à
         aucune démarche humaine. Ensuite le SENS : mesuré, la
         corrélation bras gauche / jambe gauche valait +0,45, donc le
         bras gauche partait EN AVANT avec la jambe gauche. Un humain
         fait l'inverse : bras gauche avec jambe droite, c'est ce qui
         équilibre la rotation du corps.
         On reprend donc exactement la phase des jambes, en opposition. */
      const legFwdL = Math.cos(stepPh*Math.PI*2);   // +1 = jambe gauche devant
      const armFwdL = -legFwdL * 1;  // bras gauche = jambe droite
      const armFwdR =  legFwdL * 1;
      /* Amplitude asymétrique comme une vraie marche : le bras monte
         plus haut devant (jusqu'à ~30°) qu'il ne recule derrière (~18°),
         un bras qui part loin en arrière donne l'impression d'être
         déboîté. */
      /* Marche rapide : coudes pliés en permanence (~65°), les bras
         pompent d'avant en arrière près du corps, un peu plus loin
         devant que derrière. */
      const armA = 0.34 + 0.12*sp;
      const BACK = 0.75;
      const swingL = armFwdL > 0 ? armFwdL*armA : armFwdL*armA*BACK;
      const swingR = armFwdR > 0 ? armFwdR*armA : armFwdR*armA*BACK;
      armFwd('L', swingL*gait);
      armFwd('R', swingR*gait);
      // le coude se ferme (main vers l'avant) quand le bras avance
      const elbow = 0.20 + 0.15*sp;
      elbowFwd('L', (Math.max(0, armFwdL)*elbow + 1.05 + 0.15*sp)*gait);
      elbowFwd('R', (Math.max(0, armFwdR)*elbow + 1.05 + 0.15*sp)*gait);
      add('LeftShoulder','z', sw*0.020*gait);
      add('RightShoulder','z', sw*0.018*gait);
    }

    /* ---- 5bis. Bond de case en case ----
       Une seule impulsion par case : compression (le corps se tasse avant
       de partir, c'est elle qui donne le poids), extension à la poussée,
       jambes légèrement repliées en l'air, puis absorption à la
       réception. Sans la compression initiale, un saut part de nulle part
       et ressemble à un objet soulevé. */
    const hop = ctx && ctx.hop || 0;
    if(hop > 0.001){
      const u = ctx.hopPhase;
      const crouch = bell(Math.min(1, u/0.24));            // appel
      const land   = u > 0.70 ? bell((u-0.70)/0.30) : 0;   // réception
      const air    = (u > 0.24 && u < 0.80) ? bell((u-0.24)/0.56) : 0;
      const comp = (crouch*0.60 + land*0.95) * hop;
      const tuck = air * hop;

      // genoux : compression au contact, léger repli en l'air
      add('LeftLeg','x',  comp*0.62 + tuck*0.40);
      add('RightLeg','x', comp*0.58 + tuck*0.34);
      add('LeftUpLeg','x',  -tuck*0.20 - comp*0.12);
      add('RightUpLeg','x', -tuck*0.16 - comp*0.12);
      add('LeftFoot','x',  comp*0.26 - tuck*0.18);
      add('RightFoot','x', comp*0.22 - tuck*0.16);
      // le bassin descend à l'appel et à la réception
      d.Hips.py += -comp*0.030;
      add('Spine','x', comp*0.13 - tuck*0.05);
      add('Chest','x', comp*0.08 - tuck*0.03);
      // bras : en arrière à l'appel, portés en avant en l'air
      armFwd('L', -comp*0.34 + tuck*0.44);
      armFwd('R', -comp*0.30 + tuck*0.40);
      elbowFwd('L', tuck*0.30 + comp*0.12);
      elbowFwd('R', tuck*0.26 + comp*0.10);
      // la tête encaisse la réception avec un temps de retard
      add('Neck','x', land*hop*0.10);
      add('Head','x', land*hop*0.08);
    }

    /* ---- 6. Réaction ---- */
    if(reactArm > 0.0005 || reactNod > 0.0005){
      const a = reactArm, wv = reactWave;
      armFwd('R', a*(1 + wv));
      armFwd('L', a*(1 - wv));
      add('RightArm','z', a*0.30);   // z positif = bras qui s'écarte, des deux côtés
      add('LeftArm','z',  a*0.34);
      elbowFwd('R', a*0.55);
      elbowFwd('L', a*0.50);
      add('Head','x', -reactNod*1.5);
      add('Neck','x', -reactNod*0.8);
      add('Chest','x', -reactNod*0.9);
      add('Spine','x', -reactNod*0.4);
    }

    /* ---- application, entièrement en quaternions ----
          final = slerp(bind, clip, poids) × repos × procédural
       Le slerp atténue l'apport du clip sans jamais sortir du domaine des
       rotations valides, là où une interpolation d'Euler le pouvait. */
    for(const n of RIG_BONES){
      const b = bones[n];
      if(!b) continue;
      const bd = bind[n];
      /* Le barème dépend du clip réellement en train de tourner : pendant
         un bond c'est encore le clip "idle" qui joue (les jambes sont
         pilotées à la main), donc c'est le barème repos qui s'applique. */
      const wTab = ctx.gait > 0.02 ? CLIP_WEIGHT_WALK : CLIP_WEIGHT_IDLE;
      const cw = wTab[n] != null ? wTab[n] : 1;
      _qA.copy(bd.q);
      if(cw >= 0.999) _qA.copy(b.quaternion);
      else if(cw > 0.001) _qA.slerp(b.quaternion, cw);
      if(restQ[n]) _qA.multiply(restQ[n]);
      const dn = d[n];
      if(dn.x || dn.y || dn.z){
        _eA.set(dn.x, dn.y, dn.z);
        _qB.setFromEuler(_eA);
        _qA.multiply(_qB);
      }
      b.quaternion.copy(_qA);
      b.position.y = bd.py + dn.py;
    }

    blink.update(dt);
  };
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

  // Rendu "figurine" : shader toon (bandes d'ombre nettes plutôt qu'un
  // dégradé PBR lisse), sans contour noir.
  //
  // Le contour d'avant était une copie du maillage agrandie de 4,5% et
  // vue de l'intérieur. Agrandir depuis l'origine du modèle décale une
  // pièce d'autant plus qu'elle en est loin : le bord fin du chapeau,
  // tout en haut, se retrouvait décalé bien plus que son épaisseur et
  // disparaissait entièrement sous sa propre copie noire (chapeau de
  // paille qui s'affichait noir). Une vraie figurine plastique n'a de
  // toute façon pas de trait d'encre — et ça fait deux fois moins de
  // maillages à dessiner pour le pion.
  const toonGradientMap = (()=>{
    const n = 4;
    const data = new Uint8Array(n);
    for(let i=0;i<n;i++) data[i] = Math.round(255*((i+0.6)/n));
    const tex = new THREE.DataTexture(data, n, 1, THREE.RedFormat);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    return tex;
  })();
  let blink = { update(){} };
  let blinkAssigned = false;
  model.traverse(o=>{
    if(!o.isMesh) return;
    o.castShadow = true;
    const oldMat = o.material;
    const newMat = new THREE.MeshToonMaterial({
      map: oldMat.map || null,
      gradientMap: toonGradientMap,
      color: oldMat.color ? oldMat.color.clone() : new THREE.Color(0xffffff),
    });
    o.material = newMat;
    // Le matériau "peau" (texture visage/corps) est le seul avec une
    // map — casquette/bande/cheveux sont en couleur plate.
    if(oldMat.map && !blinkAssigned){
      blink = setupBlink(newMat, oldMat.map);
      blinkAssigned = true;
    }
  });

  player.root.add(model);
  player.model = model;

  const mixer = new THREE.AnimationMixer(model);
  const clip = name => THREE.AnimationClip.findByName(gltf.animations, name);

  // La pose de repos d'origine ("idle") garde les bras à l'horizontale
  // (pose de liaison du squelette) : on corrige juste cette animation,
  // bras le long du corps, sans toucher à la marche/saut qui sont déjà
  // naturelles.
  // Plus de correction cuite dans les images-clés : la pose de repos
  // (bras le long du corps, coudes fléchis, asymétrie gauche/droite) est
  // appliquée à chaque frame par la couche procédurale, donc aussi
  // pendant la marche — là où l'ancienne correction ne s'appliquait pas
  // et laissait les bras revenir à l'horizontale.
  const idleClip = clip('idle');

  const actions = {
    idle: idleClip && mixer.clipAction(idleClip),
    walk: clip('walk') && mixer.clipAction(clip('walk')),
  };
  Object.values(actions).forEach(a=>{ if(a) a.play(); });
  if(actions.idle) actions.idle.setEffectiveWeight(1);
  if(actions.walk) actions.walk.setEffectiveWeight(0);
  let activeAction = actions.idle || actions.walk;
  /* Le clip de marche n'avance plus tout seul : son temps est ÉCRIT à
     chaque frame à partir de la distance réellement parcourue (voir
     STRIDE et walkPhase). C'est la seule façon d'éliminer le glissement
     des pieds — tant que la vitesse des jambes est une fraction
     arbitraire de la vitesse de translation, le pied patine forcément. */
  if(actions.walk) actions.walk.paused = true;
  const walkDur = actions.walk ? actions.walk.getClip().duration : 1;
  function setWalking(isWalking, phase01){
    const target = isWalking ? actions.walk : actions.idle;
    if(target && target!==activeAction){
      activeAction.fadeOut(0.22);
      target.reset().fadeIn(0.22);
      if(isWalking) target.paused = true;
      activeAction = target;
    }
    if(isWalking && actions.walk){
      actions.walk.paused = true;
      actions.walk.time = ((phase01 % 1) + 1) % 1 * walkDur;
    }
  }
  player.walkClipDuration = walkDur;

  player.mixer = mixer;
  player.setWalking = setWalking;

  // tout le rig, indexé par son nom exact : la couche procédurale a
  // besoin des épaules, des poignets et des jambes, pas seulement des bras
  const bones = {};
  for(const n of RIG_BONES) bones[n] = findBone(model, n);
  player.updateBody = buildBodyLayer(bones, blink, model);
  player.bones = bones;
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
/* Décalage vertical courant de la carte d'une case. Les cartes ne sont
   pas immobiles : une vague de ±5 cm parcourt les 40 cases en continu,
   et la case sur laquelle le pion arrive rebondit de 16 cm. Le pion
   était posé sur la hauteur FIXE de la case (tileTopY) : dès que la
   carte montait sous ses pieds, il se retrouvait dedans — c'est très
   exactement « les pieds se noient dans le plateau ». Il doit se tenir
   sur la surface telle qu'elle est À CET INSTANT. */
/* L'image de la carte (face) est posée à tileTopY+0,02 dans le topGroup ;
   le pion était calé sur tileTopY, donc 2 cm DANS l'image, et le liseré
   passait par la cheville. Il doit se tenir sur la face visible.
   +0,008 : enfoncement résiduel de la semelle mesuré au repos. */
const CARD_FACE_LIFT = 0.02 + 0.008;
function tileSurfOffset(tile){
  return CARD_FACE_LIFT + ((tile && tile.topGroup) ? tile.topGroup.position.y : 0);
}

function setActive(index){
  tiles.forEach((t,i)=>{
    const wasActive = t.isActive;
    t.isActive = (i===index);
    if(!t.isActive){ t.halo.material.opacity = 0; }
    else if(!wasActive){ t.popT0 = clock.getElapsedTime(); }
  });
}
setActive(-1);

function placeTokenInstant(idx){
  const t = tileAt(idx);
  player.root.position.set(t.world.x, t.tileTopY, t.world.z);
  playerBaseY = t.tileTopY;
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
  return count>=0 ? (start+count) % N_TILES : Math.max(0, start+count);
}

/* Distance couverte par UN cycle complet (deux pas), en cases.
   Ce n'est plus une constante réglée à l'oreille : elle est DÉDUITE de la
   longueur de jambe et de la descente du bassin, exactement comme la
   trajectoire du pied dans la couche d'animation. Les deux se servent du
   même calcul, donc le pied posé reste au sol par construction, de la
   marche à la course.
     jambe 0,3255 · hanche 0,3176 au-dessus du pied · case = 1,0 */
const strideForSpeed = sp => GAIT.stride(sp);
/* Vitesse de croisière : bornée par la physique du personnage. Il a des
   jambes de 0,33 pour des cases de 1,0 — une case fait trois longueurs de
   jambe, donc il faut ~3 pas par case. Au-delà de ~2,2 cases/s la cadence
   dépasse celle d'un sprinteur et le pied se remet à patiner. On prend
   toute la plage : trajet court = petite foulée tranquille, trajet long =
   foulée de course, sans jamais franchir cette limite. */
/* Vitesse en cases/s. Avec une foulée de marche (et non de grand
   écart), 1,24–2,35 cases/s imposait 3 à 5 pas par seconde : des jambes
   qui s'agitent, pas un homme qui marche. 0,95–1,45 garde un déplacement
   vif (12 cases en ~9 s) avec une cadence de marche rapide. */
const WALK_V_MIN = 0.90, WALK_V_MAX = 1.25;
let walkBank = 0, walkGait = 0, walkStepPhase = 0, hopGait = 0, hopPhase = 0;
let walkSpeedK = 0, walkCrouch = 0;

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
    idx = dir>0 ? (idx+1)%N_TILES : idx-1;
    path.push(tiles[idx]);
    indices.push(idx);
    steps++;
  }
  /* Profil de déplacement complet :
        anticipation → démarrage → accélération → marche → décélération
        → dernier pas → stabilisation
     L'anticipation et la stabilisation sont comptées dans totalTime, car
     le reste du jeu attend cette durée pour enchaîner. Pendant
     l'anticipation le pion ne se translate pas encore : il tourne le
     regard vers sa destination et transfère son poids. */
  /* Deux allures, choisies sur la longueur du trajet.
     À 0,36 s par case (l'ancienne vitesse unique), le cycle de marche
     tournait à 7,7 pas/seconde — quatre fois le rythme d'un humain. Aucun
     cycle de jambes ne peut se lire à cette cadence : les jambes
     vibraient au lieu de marcher.
       • trajet court  → vraie marche, ralentie pour être lisible ;
       • trajet long   → bond de case en case, ce qu'un pion de plateau
         fait de toute façon, et qui reste honnête à grande vitesse.
     Le mode rapide (correction de fin de partie, jusqu'à 39 cases en
     1,4 s) garde la durée qu'on lui impose et bondit. */
  /* Une seule allure, qui s'étire de la marche à la course avec la
     longueur du trajet : c'est la même mécanique de jambes, seules la
     foulée et la cadence changent — comme un humain qui allonge le pas
     quand il a du chemin à faire. Plus de bond de case en case. */
  const forcedFast = stepDuration < 0.42;
  const gaitMode = 'walk';
  if(!forcedFast && steps > 0){
    const v = Math.min(WALK_V_MAX, WALK_V_MIN + (steps-1)*0.20);
    stepDuration = 1/v;
  }
  const vCruise = steps>0 ? 1/stepDuration : 0;
  // rampes courtes : 0,3 case au départ et à l'arrivée, sinon les premiers
  // et derniers pas s'étirent et la cadence paraît irrégulière
  const rampUnits = Math.min(0.3, steps/2);
  const accelTime = rampUnits>0 ? (2*rampUnits)/vCruise : 0;
  const cruiseUnits = steps - 2*rampUnits;
  const cruiseTime = vCruise>0 ? cruiseUnits/vCruise : 0;
  const prepTime = steps>0 ? 0.22 : 0;
  const settleTime = steps>0 ? 0.34 : 0;
  const moveTime = Math.max(0.001, accelTime*2+cruiseTime);
  walk = {
    path, indices, steps, vCruise, rampUnits, accelTime, cruiseTime,
    prepTime, settleTime, moveTime, gaitMode,
    totalTime: prepTime + moveTime + settleTime,
    t0: clock.getElapsedTime(), lastSeg:-1,
    /* Départ à mi-appui (phase 0,25) : les deux pieds sont sous le
       bassin, l'un au sol, l'autre qui passe. Avec 3 pas par case, la
       phase d'arrivée vaut 0,25 + 1,5·N = 0,25 mod 0,5 pour tout N :
       il s'arrête aussi pieds joints, net, sans glisser. */
    phase: 0.25, prevDist: 0, announced: false,
  };
  // le regard part en avant AVANT le corps
  if(steps>0) lookAtTile(path[path.length-1], prepTime + moveTime*0.5);
  // la caméra recule du gros plan précédent et repart en suivi
  if(steps>0) cineBegin('travel');
  return walk;
}

/* ---------- Éclats dorés à chaque case franchie ----------
   Petite pluie de particules à chaque case passée pendant le
   déplacement, et une pluie plus large + micro-punch caméra à
   l'arrivée finale : le jeu doit "réagir" visuellement à chaque coup
   de dé, pas seulement au gros gain final. Pool de sprites réutilisés
   pour ne rien allouer en boucle pendant l'animation. */
const SPARKLE_POOL_SIZE = 48;
const sparklePool = Array.from({length:SPARKLE_POOL_SIZE}, ()=>{
  const mat = new THREE.SpriteMaterial({map:brightGoldTex, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, opacity:0});
  const spr = new THREE.Sprite(mat);
  spr.visible = false;
  scene.add(spr);
  return { spr, vx:0, vy:0, vz:0, life:0, maxLife:1 };
});
let sparkleCursor = 0;
function spawnSparkles(x,y,z,count,spread,upSpeed,lifeMin,lifeMax){
  lifeMin = lifeMin ?? 0.45; lifeMax = lifeMax ?? 0.75;
  for(let i=0;i<count;i++){
    const p = sparklePool[sparkleCursor];
    sparkleCursor = (sparkleCursor+1)%sparklePool.length;
    const ang = Math.random()*Math.PI*2;
    const r = spread*(0.4+Math.random()*0.8);
    p.vx = Math.cos(ang)*r;
    p.vz = Math.sin(ang)*r;
    p.vy = upSpeed*(0.6+Math.random()*0.7);
    p.life = 0;
    p.maxLife = lifeMin + Math.random()*(lifeMax-lifeMin);
    p.spr.position.set(x, y, z);
    const s = 0.13+Math.random()*0.1;
    p.spr.scale.set(s,s,s);
    p.spr.material.opacity = 1;
    p.spr.visible = true;
  }
}
function updateSparkles(dt){
  for(const p of sparklePool){
    if(!p.spr.visible) continue;
    p.life += dt;
    if(p.life >= p.maxLife){ p.spr.visible = false; continue; }
    p.vy -= dt*1.8;
    p.spr.position.x += p.vx*dt;
    p.spr.position.y += p.vy*dt;
    p.spr.position.z += p.vz*dt;
    p.spr.material.opacity = 1 - p.life/p.maxLife;
  }
}

/* Poussière dorée ambiante qui monte doucement en continu autour du
   plateau, même sans qu'aucune partie soit en cours — pour que le
   plateau paraisse "vivant" au premier coup d'œil, pas seulement
   pendant un lancer de dé. */
let ambientSparkleTimer = 0;
function updateAmbientSparkles(dt){
  if(reduceMotion) return;
  ambientSparkleTimer -= dt;
  if(ambientSparkleTimer <= 0){
    ambientSparkleTimer = 0.28 + Math.random()*0.35;
    const [x,z] = perimeterPosAt(Math.random());
    const inward = 0.3+Math.random()*1.1;
    const ang = Math.atan2(-z,-x);
    const jx = x + Math.cos(ang)*inward, jz = z + Math.sin(ang)*inward;
    spawnSparkles(jx, 0.15+Math.random()*0.25, jz, 1, 0.12, 0.32, 1.3, 2.1);
  }
}

/* ---------- Caméra cinématique ----------
   Le plateau se regarde d'en haut (52°) pour que les 40 cases soient
   lisibles. Mais à cet angle le bord du chapeau de paille couvre la
   tête, les épaules et la moitié du torse : mesuré image par image, le
   personnage était réduit à un disque beige d'une quarantaine de
   pixels. Toute l'animation (marche, regard, réactions) était donc
   invisible — pas absente, invisible.

   La vue plateau reste la vue par défaut. Elle s'efface seulement
   pendant qu'il se passe quelque chose, en trois temps :
     • VOYAGE  — dès qu'il part, léger zoom ; la caméra suit son azimut
                 autour du plateau, ce qui fait tourner la vue de façon
                 naturelle au lieu d'un panoramique plaqué ;
     • ARRIVÉE — gros plan bas sur lui, sous le bord du chapeau : on
                 voit le visage, la pose, la réaction ;
     • RETOUR  — au lancer suivant on recule sur le plateau.
   Un doigt sur l'écran rend la main au joueur immédiatement. */
const CINE = {
  /* `lead` = à quel point la caméra se place devant le personnage plutôt
     que simplement à l'extérieur de l'anneau ; `side` = décalage fixe
     pour obtenir un trois-quarts et non un plein face figé. */
  travel:  { dist: 12.0, elev: 0.77, aim: 0.55, lead: 0.30, side: 0.00, ease: 1.7, aimY: 0.34 },
  /* `aimY` = hauteur du point visé au-dessus des pieds. À 0.34 (le
     torse) la tête arrivait à ras du bord haut du cadre sur un écran de
     téléphone : on vise plus haut pour dégager du ciel au-dessus du
     chapeau, et on recule un peu. */
  /* elev 0.20 = caméra 7° au-dessus de la tête. Balayé puis vérifié à
     l'image : au-delà de 14°, le bord du chapeau de paille recouvre le
     visage — c'est toute l'origine du "on ne le voit pas". */
  closeup: { dist:  3.55, elev: 0.20, aim: 1.00, lead: 1.00, side: 0.55, ease: 3.6, aimY: 0.50 },
};
let cineMode = null;          // null | 'travel' | 'closeup'
let cineBlend = 0;            // 0 = vue plateau, 1 = vue cinéma
let cineAz = 0, cineAzInit = false;
const _cineTarget = new THREE.Vector3();
const _cinePos = new THREE.Vector3();
const _boardTarget = new THREE.Vector3();
const _boardPos = new THREE.Vector3();

function angLerp(a, b, k){
  let d = b - a;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return a + d*k;
}

function cineBegin(mode){
  if(reduceMotion) return;
  /* On ne mémorise la vue plateau QUE si on en part vraiment. Si un
     nouveau lancer arrive pendant le retour (fondu encore en cours), la
     caméra est à mi-chemin : la prendre comme référence ferait dériver
     la vue plateau un peu plus à chaque tour, sans jamais y revenir. */
  if(cineMode === null && cineBlend <= 0.001){
    _boardTarget.copy(controls.target);
    _boardPos.copy(camera.position);
  }
  if(cineMode === null){
    controls.autoRotate = false;
    controls.enabled = false;
  }
  cineMode = mode;
}

function cineEnd(){
  if(cineMode === null) return;
  cineMode = null;
}

function updateCineCam(dt){
  if(cineMode === null && cineBlend <= 0.0001){
    if(!controls.enabled){
      controls.enabled = true;
      cineAzInit = false;
    }
    return false;
  }

  const want = cineMode ? 1 : 0;
  const cfg = CINE[cineMode || 'travel'];
  cineBlend += (want - cineBlend) * Math.min(1, dt*cfg.ease);
  if(want === 0 && cineBlend < 0.004) cineBlend = 0;

  const P = player.root.position;
  // azimut du pion autour du plateau : la caméra reste à l'extérieur de
  // l'anneau et tourne avec lui — c'est ce qui fait "tourner le plateau"
  const radialAz = Math.atan2(P.x, P.z);
  // ...légèrement ramenée vers l'avant du personnage pour un 3/4 plutôt
  // qu'un profil strict
  const wantAz = angLerp(radialAz, player.root.rotation.y + cfg.side, cfg.lead);
  if(!cineAzInit){ cineAz = wantAz; cineAzInit = true; }
  else cineAz = angLerp(cineAz, wantAz, Math.min(1, dt*2.2));

  // point visé : entre le centre du plateau et le pion selon l'étape
  _cineTarget.set(P.x*cfg.aim, P.y + cfg.aimY, P.z*cfg.aim);
  const ce = Math.cos(cfg.elev), se = Math.sin(cfg.elev);
  _cinePos.set(
    _cineTarget.x + Math.sin(cineAz)*ce*cfg.dist,
    _cineTarget.y + se*cfg.dist,
    _cineTarget.z + Math.cos(cineAz)*ce*cfg.dist
  );

  // fondu entre la vue plateau mémorisée et la vue cinéma
  const k = cineBlend*cineBlend*(3-2*cineBlend);
  _cineTarget.lerp(_boardTarget, 1-k);
  _cinePos.lerp(_boardPos, 1-k);

  // suivi amorti : la caméra ne se colle jamais instantanément
  const f = Math.min(1, dt*cfg.ease*1.5);
  controls.target.lerp(_cineTarget, f);
  camera.position.lerp(_cinePos, f);
  camera.lookAt(controls.target);

  if(!cameraPunchActive){
    camera.fov += (BASE_FOV - camera.fov) * Math.min(1, dt*3);
    camera.updateProjectionMatrix();
  }
  return true;
}

/* Le corps de la frame est isolé de la boucle d'affichage : la boucle
   fournit le temps réel, mais on peut aussi l'avancer pas à pas depuis
   l'extérieur (enregistrement d'une séquence à cadence régulière sur une
   machine qui ne tient pas le temps réel). */
function frameStep(dt, t){

  /* Quand la caméra cinématique a la main, ni OrbitControls ni le
     garde-fou anti-rognage des coins ne doivent la contredire : le
     garde-fou élargit le champ pour garder les 4 coins visibles, ce qui
     n'a aucun sens en gros plan sur le pion. */
  if(!updateCineCam(dt)){
    controls.update();
    updateCornerSafety(dt);
  }
  updateSparkles(dt);
  updateGoldRain(t, dt);
  updateAmbientSparkles(dt);

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
      tile.topGroup.scale.set(1,breathe,1);
      // vague qui parcourt en continu les 40 cases autour du plateau
      // (façon "ola" de stade), pour que le plateau entier ait l'air
      // vivant même sans aucune action du joueur — seule la "carte"
      // (topGroup) bouge, le socle (base + collerette) reste fixe.
      let posY = Math.sin(t*1.3 - (tile.caseNum-1)*0.35) * 0.05;
      // petit rebond "ressort" quand la case vient de devenir active
      // (le pion vient d'y arriver) : réaction visuelle immédiate,
      // amortie en ~0.5s, en plus des éclats/punch caméra déjà en jeu
      if(tile.popT0 != null){
        const pe = t - tile.popT0;
        if(pe < 0.6) posY += Math.exp(-pe*7)*Math.sin(pe*20)*0.16;
        else tile.popT0 = null;
      }
      tile.topGroup.position.y = posY;
      // le liseré + les rivets sont des InstancedMesh partagés (pas
      // des enfants de topGroup) : on les remet à jour ici pour
      // qu'ils suivent exactement le même mouvement que la carte,
      // sans jamais s'en désynchroniser.
      _instDummy.rotation.set(0,0,0);
      _instDummy.position.set(tile.bezelBase.x, tile.bezelBase.y+posY, tile.bezelBase.z);
      _instDummy.updateMatrix();
      tileBezelInst.setMatrixAt(tile.bezelIndex, _instDummy.matrix);
      tile.rivetPositions.forEach((rp,k)=>{
        _instDummy.position.set(rp.x, tile.rivetY+posY, rp.z);
        _instDummy.updateMatrix();
        tileRivetInst.setMatrixAt(tile.bezelIndex*RIVET_OFFSETS.length+k, _instDummy.matrix);
      });
    }
    if(tile.floatObj){
      const m = tile.motion;
      const bobAmt = reduceMotion ? 0 : m.bob;
      const bob = Math.sin(t*2 + tile.phase)*bobAmt;
      const baseY = tile.tileTopY + 0.32 + (tile.catDef.tier==='float' ? tile.floatBaseScale*0.5 : -0.02);
      // Le lot s'élève quand le pion approche, pour lui passer AU-DESSUS
      // de la tête. Au repos il flotte à hauteur de torse : le pion le
      // traversait et se retrouvait coupé en deux par la carte. La montée
      // est amortie dans le temps, donc le lot se soulève à l'approche et
      // se repose une fois le pion reparti, au lieu de sauter d'un coup.
      const pdx = player.root.position.x - tile.world.x;
      const pdz = player.root.position.z - tile.world.z;
      const pd = Math.hypot(pdx, pdz);
      // 1 quand le pion est sur la case, 0 au-delà d'une case d'écart
      const near = pd <= CELL*0.5 ? 1
                 : pd >= CELL*1.0 ? 0
                 : 1 - (pd - CELL*0.5)/(CELL*0.5);
      // marge au-dessus de la silhouette au repos : elle doit encaisser
      // le petit saut de joie (+0.16) et les bras levés, que le relevé de
      // chargement ne voit pas.
      const needOff = playerTopOffset + 0.30 + tile.floatHalfH;
      const wantLift = Math.max(0, needOff - tile.floatBaseOff) * (near*near*(3-2*near));
      tile.floatLiftCur += (wantLift - tile.floatLiftCur) * Math.min(1, dt*7);
      tile.floatObj.position.y = baseY + bob + tile.floatLiftCur;
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
        // plus le lot monte, plus son ombre s'élargit et s'efface
        const liftN = Math.min(1, tile.floatLiftCur/0.9);
        const sk = k*(1 + liftN*0.35);
        tile.shadowDisc.scale.set(sk,sk,sk);
        tile.shadowDisc.material.opacity = 0.3*k*(1 - liftN*0.55);
      }
      if(tile.holoShine && !reduceMotion){
        tile.holoShine.tex.offset.x = (t*tile.holoShine.speed + tile.holoShine.phase) % 1;
      }
    }
    if(tile.isActive){
      // Le halo de la case courante monte avec la valeur du lot : une
      // case "gros lot" doit se voir plus fort qu'une pioche commune,
      // sinon la hiérarchie des gains ne se lit plus à l'écran.
      const hl = (TIER_LEVEL[tile.catKey] ?? 1);
      const hk = 0.85 + hl*0.14;
      tile.halo.material.opacity = reduceMotion ? 0.55*hk : (0.4 + Math.sin(t*5)*0.25)*hk;
      tile.halo.rotation.z += dt*0.6;
      const hs = 1 + (hl-1)*0.05 + (reduceMotion ? 0 : Math.sin(t*5)*0.03);
      tile.halo.scale.set(hs, hs, 1);
    }
  });
  if(!reduceMotion){
    tileBezelInst.instanceMatrix.needsUpdate = true;
    tileRivetInst.instanceMatrix.needsUpdate = true;
  }

  // marche continue du pion sur tout le trajet demandé
  if(walk){
    const te = t - walk.t0;
    /* ---- phase 1 : anticipation, le corps n'avance pas encore ---- */
    const inPrep = te < walk.prepTime;
    const tm = te - walk.prepTime;              // temps dans la translation
    const inSettle = tm > walk.moveTime;

    let dist, vel;
    if(walk.steps===0){ dist = 0; vel = 0; }
    else if(inPrep){ dist = 0; vel = 0; }
    else if(tm >= walk.moveTime){ dist = walk.steps; vel = 0; }
    else if(walk.accelTime>0 && tm < walk.accelTime){
      vel = walk.vCruise*(tm/walk.accelTime);
      dist = 0.5*walk.vCruise*tm*tm/walk.accelTime;
    } else if(tm < walk.accelTime+walk.cruiseTime){
      vel = walk.vCruise;
      dist = walk.rampUnits + walk.vCruise*(tm-walk.accelTime);
    } else {
      const te2 = Math.max(0, walk.moveTime - tm);
      vel = walk.accelTime>0 ? walk.vCruise*(te2/walk.accelTime) : 0;
      dist = walk.steps - 0.5*walk.vCruise*te2*te2/walk.accelTime;
    }
    dist = Math.max(0, Math.min(walk.steps, dist));

    /* ---- phase du cycle de marche VERROUILLÉE SUR LA DISTANCE ----
       C'est le cœur de la correction du glissement : le clip n'avance que
       de ce que les jambes ont réellement à parcourir. STRIDE est la
       distance couverte par un cycle complet (deux pas) ; une valeur trop
       grande fait patiner vers l'avant, trop petite fait patiner vers
       l'arrière. */
    /* La phase du cycle n'avance QUE de ce que les jambes ont réellement
       parcouru, et la foulée employée est celle que la couche d'animation
       va reproduire : c'est cette égalité, et elle seule, qui empêche le
       pied posé de patiner. */
    const spNow = Math.max(0, Math.min(1, (walk.vCruise - WALK_V_MIN)/(WALK_V_MAX - WALK_V_MIN)));
    walk.phase += Math.max(0, dist - walk.prevDist) / strideForSpeed(spNow);
    walk.prevDist = dist;

    const segIdx = Math.min(Math.floor(dist), Math.max(0,walk.steps-1));
    const localP = walk.steps>0 ? dist - segIdx : 0;
    const aTile = walk.path[segIdx], bTile = walk.path[Math.min(segIdx+1, walk.path.length-1)];
    const x = aTile.world.x + (bTile.world.x-aTile.world.x)*localP;
    const z = aTile.world.z + (bTile.world.z-aTile.world.z)*localP;
    const gaitAmp = walk.vCruise>0 ? Math.min(1, vel/walk.vCruise) : 0;

    /* Oscillation verticale du centre de masse, calée sur le pas : deux
       creux par cycle, au moment où le pied se pose. */
    /* Bond : arc parabolique par case. Le point bas est au contact
       (u=0 et u=1), le sommet au milieu du saut. En marche, simple
       oscillation du centre de masse calée sur le pas. */
    /* Le bassin descend pendant la locomotion : debout, la jambe est
       tendue à 98 %, aucune longueur de pas n'est atteignable sans cette
       descente. Elle s'installe et se retire avec l'amplitude de marche,
       donc elle ne se voit pas à l'arrêt. On y ajoute une très légère
       oscillation par pas — la cinématique inverse l'absorbe dans les
       genoux sans décoller le pied. */
    const hopU = 0;
    /* La descente du bassin s'installe pendant l'ANTICIPATION, où le pion
       ne se translate pas encore, et reste pleine pendant tout le
       trajet. La faire suivre l'amplitude de marche paraissait naturel,
       mais la foulée, elle, est calculée pour la descente complète : tant
       que le bassin n'était pas descendu, la jambe ne pouvait pas
       atteindre le sol et le pied rattrapait en glissant. */
    const spC = Math.max(0, Math.min(1,
                  (walk.vCruise - WALK_V_MIN)/(WALK_V_MAX - WALK_V_MIN)));
    /* La descente du bassin suit EXACTEMENT la même amplitude que les
       jambes. Sur deux rampes différentes, le bassin descendait de 11 cm
       pendant que les jambes étaient encore tendues : le pion s'enfonçait
       alors de 15 cm dans la case. Mesuré : semelle à -0,150 avec deux
       rampes, contre -0,033 sans descente du tout. Une seule amplitude
       pour les deux, et le pied reste sur le plateau. */
    const crouch = GAIT.crouch(spC) * gaitAmp;
    const osc = reduceMotion ? 0
      : (-Math.abs(Math.cos(walk.phase*Math.PI*2)) * GAIT.rise + GAIT.rise) * gaitAmp;
    const bob = -crouch + osc;

    /* Transfert de poids pendant l'anticipation et la stabilisation :
       un petit creux avant de partir, un autre en posant le dernier pas. */
    let settleDip = 0;
    if(inPrep) settleDip = -Math.sin(te/walk.prepTime*Math.PI) * 0.016;
    else if(inSettle){
      const u = Math.min(1, (tm - walk.moveTime)/walk.settleTime);
      settleDip = -Math.sin(u*Math.PI) * 0.020 * (1-u*0.3);
    }
    // il marche sur la carte telle qu'elle est maintenant, pas sur sa
    // hauteur nominale : entre deux cases on interpole les deux surfaces
    const surf = tileSurfOffset(aTile) + (tileSurfOffset(bTile) - tileSurfOffset(aTile))*localP;
    player.root.position.set(x, aTile.tileTopY + surf + bob + settleDip, z);

    /* ---- virage étagé ----
       Le corps ne pivote pas d'un bloc : la tête a déjà tourné (système de
       regard), le bassin suit avec du retard. Plus l'écart est grand, plus
       la rotation prend de temps — un demi-tour ne se fait pas à la même
       vitesse qu'une correction de trajectoire. */
    if(bTile!==aTile){
      const targetYaw = Math.atan2(bTile.world.x-aTile.world.x, bTile.world.z-aTile.world.z);
      let dyaw = targetYaw - player.root.rotation.y;
      dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      const turnRate = 4.5 + 3.5*(1 - Math.min(1, Math.abs(dyaw)/1.2));
      player.root.rotation.y += dyaw*Math.min(1, dt*turnRate);
      /* PAS d'inclinaison dans le virage. Le pion se penchait vers
         l'intérieur proportionnellement à l'angle restant : dans un
         angle du plateau, l'écart de cap vaut 90°, ce qui donnait
         jusqu'à 20° de bascule latérale. Vu d'une caméra basse, ça ne
         se lit pas comme un virage mais comme un personnage qui tombe.
         Un pion de plateau reste droit et PIVOTE : il ne s'incline
         jamais. */
      walkBank += (0 - walkBank) * Math.min(1, dt*8);
    } else {
      walkBank += (0 - walkBank) * Math.min(1, dt*8);
    }
    player.root.rotation.z = walkBank;

    if(segIdx !== walk.lastSeg){
      if(walk.lastSeg >= 0){
        playHop();
        if(!reduceMotion) spawnSparkles(aTile.world.x, aTile.tileTopY+0.35, aTile.world.z, 7, 1.1, 2.4);
      }
      walk.lastSeg = segIdx;
      currentIndex = walk.indices[segIdx];
      setActive(currentIndex);
    }

    if(!reduceMotion){
      // le buste se penche en avant à l'accélération et se redresse en
      // décélérant : c'est l'inertie qui se lit, pas une inclinaison fixe
      /* Le buste reste droit. Une inclinaison avant de 4° suffisait à
         donner l'impression d'un personnage qui plonge ; on garde juste
         de quoi lire l'élan, pas la chute. */
      const leanTarget = -0.022*gaitAmp + (inSettle ? 0.010 : 0);
      player.root.rotation.x += (leanTarget - player.root.rotation.x)*Math.min(1,dt*8);
    }
    // Pendant un bond on laisse tourner le clip "idle" : les jambes sont
    // pilotées entièrement à la main (appel, envol, réception), le cycle
    // de marche n'aurait aucun sens à cette vitesse.
    /* Le clip du modèle ne pilote plus les jambes (il n'y met qu'un
       tremblement) : on le laisse tourner pour le haut du corps
       uniquement, les jambes sont entièrement calculées. */
    player.setWalking(gaitAmp > 0.02, walk.phase);
    walkGait = gaitAmp;
    walkStepPhase = walk.phase % 1;
    walkSpeedK = Math.max(0, Math.min(1,
      (walk.vCruise - WALK_V_MIN)/(WALK_V_MAX - WALK_V_MIN)));
    walkCrouch = crouch - osc;   // enfoncement réel du bassin
    hopGait = 0;
    hopPhase = 0;

    /* ---- arrivée : une seule séquence continue ----
       Les effets ne se déclenchent plus à l'instant où la translation
       s'arrête, mais une fois le dernier pas posé — le temps que le poids
       soit transféré. */
    if(!walk.announced && tm >= walk.moveTime){
      walk.announced = true;
      currentIndex = walk.indices[walk.indices.length-1];
      setActive(currentIndex);
      const landedTile = walk.path[walk.path.length-1];
      playerBaseY = landedTile.tileTopY;
      // il regarde ce sur quoi il vient de tomber
      lookAtTile(landedTile, 2.4);
      // et la caméra vient le chercher en gros plan, sous le bord du
      // chapeau, pour qu'on voie enfin sa tête et sa réaction
      cineBegin('closeup');
      if(!reduceMotion){
        const lvl = TIER_LEVEL[landedTile.catKey] ?? 1;
        spawnSparkles(landedTile.world.x, landedTile.tileTopY+0.4, landedTile.world.z,
                      12 + lvl*11, 1.3 + lvl*0.38, 2.9 + lvl*0.55, 0.5, 0.9);
        winShock(landedTile, lvl);
        cameraPunch(0.65 + lvl*0.28);
        // la réaction arrive APRÈS la stabilisation : il regarde, il
        // comprend, puis il réagit
        walk.reactAt = t + walk.settleTime*0.55;
        walk.reactLevel = lvl;
      }
    }
    if(walk.reactAt && t >= walk.reactAt){
      triggerReaction(walk.reactLevel);
      walk.reactAt = 0;
    }

    if(te >= walk.totalTime){
      walk.done = true;
      walk = null;
      walkGait = 0; hopGait = 0;
    }
  } else if(!reduceMotion){
    // au repos : le buste revient droit, la marche s'efface
    player.root.rotation.x *= 0.85;
    player.root.rotation.z *= 0.85;
    walkGait += (0 - walkGait)*Math.min(1, dt*6);
    walkCrouch += (0 - walkCrouch)*Math.min(1, dt*6);
    hopGait += (0 - hopGait)*Math.min(1, dt*7);
    player.setWalking(false);
  }

  if(shockT0 >= 0){
    const se = t - shockT0;
    const sdur = 0.40 + shockLevel*0.10;
    if(se >= sdur){
      shockT0 = -1;
      shockRing.visible = false;
      impactGlow.visible = false;
      impactGlow.material.opacity = 0;
    } else {
      const k = se/sdur, fade = (1-k)*(1-k);
      const sc = 0.55 + k*(1.5 + shockLevel*0.6);
      shockRing.scale.set(sc, sc, sc);
      shockRing.material.opacity = fade*(0.30 + shockLevel*0.14);
      // le flash est bref et concentré sur le premier tiers de l'onde :
      // c'est le "coup", l'anneau qui s'ouvre en est la traînée
      const fk = Math.max(0, 1 - se/(sdur*0.35));
      impactGlow.material.opacity = fk*fk*(0.12 + shockLevel*0.07);
      const fs = 0.7 + (1-fk)*0.5;
      impactGlow.scale.set(fs, fs, fs);
    }
  }
  updateReaction(t);
  if(updateBodyReset) updateBodyReset();
  player.mixer.update(dt);
  measurePlayerTop();
  /* La couche procédurale tourne TOUJOURS, marche comprise : c'est elle
     qui tient la pose de repos (bras le long du corps), le regard et le
     report du poids. L'ancienne version ne l'appelait qu'à l'arrêt, d'où
     des bras qui repartaient à l'horizontale dès le premier pas. */
  if(!reduceMotion){
    player.updateBody(t, {
      walking: walkGait > 0.02 || hopGait > 0.02,
      gait: walkGait,
      stepPhase: walkStepPhase,
      speedK: walkSpeedK,
      crouch: walkCrouch,
      hop: hopGait,
      hopPhase: hopPhase,
      bodyYaw: player.root.rotation.y,
    });
    if(!walk){
      // à l'arrêt il RESTE posé sur la carte, qui continue d'onduler et
      // rebondit sous lui à l'arrivée : sa hauteur suit la surface réelle
      player.root.position.y = playerBaseY
        + tileSurfOffset(tileAt(currentIndex))
        + reactHopY;
      if(reactSettle && reactT0 < 0) reactSettle = false;
    }
  }

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

  composer.render();
}

function animate(){
  requestAnimationFrame(animate);
  frameStep(Math.min(clock.getDelta(), 0.05), clock.getElapsedTime());
}
animate();

/* ---------- Redimensionnement ---------- */
function resize(){
  const w = wrap.clientWidth, h = wrap.clientHeight;
  if(w===0||h===0) return;
  renderer.setSize(w,h,false);
  composer.setSize(w,h);
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
const CEILING_RATIO = 0.60;  // plafond de reversement cible : 60 % reversés = 40 % de marge (vérifié par simulation)
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
/* Recette pour un plafond de 60 % (marge 40 %), mise moyenne 9 € :
     jackpot 1/1000 · ETB 1/500 · tripack 1/83 · gradée 1/30 ·
     booster 8 € 1/12 · alternative 1/3,2 · JAMAIS de partie à 0 €.
   Espérance : 5,35 € par partie = 59,4 %, volontairement 0,6 point SOUS
   le plafond — comme l'ancienne recette (49,7 pour 50). Sans cette
   marge de manœuvre, le séquencement sous contrainte de couverture n'a
   plus de jeu : le jackpot ne tient jamais sous le plafond et finit
   forcé en dernière position (prévisible, et au-dessus du plafond).
   Toutes les proportions donnent un compte ENTIER sur 1 000 : un
   arrondi de 2,5 ETB → 3 suffisait à faire déborder le plafond.
   La « prison » (0 €) reste une case du plateau mais ne fait plus
   partie des résultats : un joueur repart toujours avec une carte. */
const OUTCOME_RECIPE = [
  { cat:'jackpot300',  p:0.001 },
  { cat:'etb',         p:0.002 },
  { cat:'booster50',   p:0.012 },
  { cat:'gradee',      p:0.033 },
  { cat:'booster8',    p:0.083 },
  { cat:'alternative', p:0.312 },
  { cat:'prison',      p:0     },
  // le reste (55,7 %) part en commune, calculé plus bas
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

  /* Deux familles :
       - les GROS lots (≥ 100 €) : placés à part, à une position tirée au
         sort parmi toutes celles où les mises déjà encaissées les
         couvrent — sinon le tirage au hasard les enterre parmi des
         centaines d'autres cartes et ils finissent systématiquement en
         toute fin de file (mesuré : jackpot à la partie n° 989 dans 10
         files sur 10, prévisible) ;
       - le reste : séquencé avec la règle de rythme ci-dessous. */
  const BIG = 100;
  const bigs = [], remaining = [];
  Object.keys(counts).forEach(cat=>{
    for(let i=0;i<counts[cat];i++) (OUTCOME_COST[cat] >= BIG ? bigs : remaining).push(cat);
  });
  bigs.sort((a,b)=>OUTCOME_COST[b]-OUTCOME_COST[a]);   // le plus cher d'abord

  /* ---- 1. séquence des lots courants, sous contrainte de couverture
          et de rythme ----
     Rythme : jamais plus de MAX_SMALL_RUN petits lots (commune) d'affilée,
     et ce jusqu'à la DERNIÈRE partie de la file. Un simple tirage
     proportionnel ne suffit pas : le hasard finit par épuiser les vraies
     cartes quelques dizaines de parties avant la fin (mesuré : série
     finale de 62 communes). On vérifie donc à chaque position que ce
     qu'il reste peut ENCORE être disposé sans dépasser la règle :
       petits restants ≤ (MAX − série en cours) + MAX × vraies cartes restantes
     et on ne tire au sort qu'entre les choix qui préservent cette
     garantie. Couverture : un lot n'est éligible que si les mises
     encaissées jusqu'ici le paient sous le plafond. */
  const MAX_SMALL_RUN = 2;
  const isSmall = cat => cat==='commune' || cat==='prison';
  let goodsLeft = remaining.filter(c=>!isSmall(c)).length;
  let smallsLeft = remaining.length - goodsLeft;
  const seq = [];
  let cumMise = 0, cumPaid = 0, smallRun = 0;
  const nSeq = remaining.length;
  for(let pos=0; pos<nSeq; pos++){
    cumMise += AVG_MISE;
    const headroom = cumMise*CEILING_RATIO - cumPaid;
    const affGood = [], affSmall = [];
    for(let i=0;i<remaining.length;i++){
      if(OUTCOME_COST[remaining[i]] > headroom) continue;
      (isSmall(remaining[i]) ? affSmall : affGood).push(i);
    }
    // ce qui reste possible SANS casser la règle de rythme jusqu'au bout
    const okSmall = affSmall.length && smallRun < MAX_SMALL_RUN
                 && (smallsLeft-1) <= (MAX_SMALL_RUN-smallRun-1) + MAX_SMALL_RUN*goodsLeft;
    const okGood  = affGood.length
                 && smallsLeft <= MAX_SMALL_RUN*goodsLeft;   // après ce lot, série remise à 0
    let pool;
    if(okSmall && okGood) pool = Math.random() < goodsLeft/remaining.length ? affGood : affSmall;
    else if(okGood)  pool = affGood;
    else if(okSmall) pool = affSmall;
    else pool = affGood.length ? affGood : affSmall;   // filet : on préserve au moins la couverture
    let pickAt;
    if(pool.length){
      pickAt = pool[Math.floor(Math.random()*pool.length)];
    } else {
      // rien de couvert (ne devrait pas arriver) : le moins cher restant
      pickAt = 0;
      for(let i=1;i<remaining.length;i++){
        if(OUTCOME_COST[remaining[i]] < OUTCOME_COST[remaining[pickAt]]) pickAt = i;
      }
    }
    const cat = remaining.splice(pickAt,1)[0];
    cumPaid += OUTCOME_COST[cat];
    if(isSmall(cat)){ smallRun++; smallsLeft--; } else { smallRun = 0; goodsLeft--; }
    seq.push(cat);
  }

  /* ---- 2. insertion des gros lots ----
     Pour chaque gros lot, on liste TOUTES les positions où, une fois
     inséré, chaque préfixe de la file reste sous le plafond (le lot est
     donc payé par des mises déjà encaissées, jamais avancé), et on en
     tire une au sort. Le jackpot peut ainsi tomber n'importe quand
     entre le moment où il est couvert et la fin — plus jamais toujours
     au même endroit. */
  const prefixOK = (arr)=>{
    let mise=0, paid=0;
    for(let k=0;k<arr.length;k++){
      mise += AVG_MISE; paid += OUTCOME_COST[arr[k]];
      if(paid > mise*CEILING_RATIO + 1e-9) return false;
    }
    return true;
  };
  const arr = seq;
  bigs.forEach(cat=>{
    const cost = OUTCOME_COST[cat];
    // position minimale : premier préfixe dont la réserve couvre le lot
    const candidates = [];
    let mise=0, paid=0;
    for(let p=0; p<=arr.length; p++){
      // insérer à p = payer `cost` à la partie p+1, avant les suivantes
      if((mise+AVG_MISE)*CEILING_RATIO - paid >= cost) candidates.push(p);
      if(p<arr.length){ mise += AVG_MISE; paid += OUTCOME_COST[arr[p]]; }
    }
    // on garde celles qui laissent TOUS les préfixes suivants sous le plafond
    const ok = [];
    for(const p of candidates){
      const trial = arr.slice(0,p).concat([cat], arr.slice(p));
      if(prefixOK(trial)) ok.push(p);
    }
    const p = ok.length ? ok[Math.floor(Math.random()*ok.length)] : arr.length;
    arr.splice(p, 0, cat);
  });
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
let _punchGen = 0, _punchBase = null;
function cameraPunch(strength){
  if(reduceMotion) return;
  const k = Math.min(2.4, strength || 1);
  // Une frappe qui démarre pendant une autre relevait l'ancien FOV
  // déjà enfoncé comme nouveau repos : le champ dérivait à chaque
  // enchaînement. On mémorise le vrai FOV de repos, et un compteur de
  // génération coupe la boucle précédente.
  const gen = ++_punchGen;
  if(_punchBase === null) _punchBase = camera.fov;
  const baseFov = _punchBase;
  const punchFov = baseFov*(1 - 0.055*k);
  const start = performance.now();
  const outDur=120, holdDur=70, inDur=300, total=outDur+holdDur+inDur;
  cameraPunchActive = true;
  function step(now){
    if(gen !== _punchGen) return;
    const el = Math.max(0, now-start);
    if(el>=total){ camera.fov = baseFov; camera.updateProjectionMatrix(); cameraPunchActive = false; _punchBase = null; return; }
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
  if(idx===LAST) return 'Salle du Champion';
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
/* ---------- Tirage imposé au clavier ----------
   L'hôte appuie sur une touche et le tirage part TOUT DE SUITE, avec
   exactement le même déroulé qu'un tirage normal (roulement de tambour,
   deux cartes qui se retournent, le pion qui avance) — sauf que les deux
   cartes font le total demandé.
     touches 2 à 9  → total 2 à 9 (touche physique : avec ou sans Maj
                       sur clavier français, pavé numérique compris)
     F, G, H        → 10, 11, 12 (lettres libres, à côté de D)
   La paire est tirée au hasard parmi celles qui font le total, pour que
   la même valeur ne montre pas toujours les mêmes cartes. Un total PAIR
   sort en double une fois sur six (5+5 pour 10 → lancer bonus, comme la
   règle le prévoit) ; 2 et 12 ne peuvent être que des doubles.
   Le lot est alors celui de la case atteinte : la mise sort de la file
   de résultats pré-calculée et du plafond de reversement — la
   rentabilité est tenue par l'hôte. Rien n'apparaît côté public. */
let forcedTotal = null, manualGame = false;
const LETTER_TOTALS = { f:10, g:11, h:12 };
const DOUBLE_ODDS = 1/3;
function forcedPair(total){
  const pairs = [];
  for(let a=1;a<=6;a++){ const b=total-a; if(b>=1&&b<=6) pairs.push({a,b}); }
  const doubles = pairs.filter(p=>p.a===p.b);
  const singles = pairs.filter(p=>p.a!==p.b);
  if(!singles.length) return doubles[0];                       // 2 et 12
  if(doubles.length && Math.random() < DOUBLE_ODDS) return doubles[0];
  return singles[Math.floor(Math.random()*singles.length)];
}
function forcedDraw(total){
  if(isDisplay) return;
  if(startBtn && !startBtn.hidden) return;          // partie pas démarrée
  if(moving || finished || rollsUsed>=rollsAllowed) return;
  forcedTotal = total;
  drawAndMove();
}
function computeCardDraw(){
  // Un seul tirage de 2 cartes par clic. Sur un double, l'hôte
  // relance lui-même manuellement (nouveau clic sur "TIRER LES
  // CARTES") pour la paire bonus, au lieu d'un enchaînement
  // automatique dans le logiciel.
  let a, b;
  if(forcedTotal!=null){
    ({a,b} = forcedPair(forcedTotal));
    forcedTotal = null;
  } else {
    a = 1+Math.floor(Math.random()*6);
    b = 1+Math.floor(Math.random()*6);
  }
  return { pairs: [{a,b}], total: a+b, isDouble: a===b, slotOrder: shuffledSlots() };
}
async function playCardDrawAnimation(draw){
  if(!cardDrawOverlay || !cardGrid) return;
  cardGrid.innerHTML = '';
  const cardEls = [];
  for(let i=0;i<12;i++){
    const c = document.createElement('div');
    c.className = 'mini-card';
    /* La face révélée est une vraie face de carte, pas un simple
       rectangle doré avec un chiffre posé dessus : rayons derrière le
       nombre, double liseré, coins marqués, index dans deux coins
       opposés et un reflet holo qui balaie au moment du retournement. */
    c.innerHTML =
      '<div class="face back"></div>' +
      '<div class="face front">' +
        '<span class="card-rays"></span>' +
        '<span class="card-pip tl"></span>' +
        '<span class="card-num"></span>' +
        '<span class="card-pip br"></span>' +
        '<span class="card-holo"></span>' +
      '</div>' +
      // hors de la carte : l'onde de choc et les eclats doivent
      // deborder du cadre, or la face avant est en overflow:hidden
      '<span class="card-shock"></span>' +
      '<span class="card-sparks">' +
        '<i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>' +
      '</span>';
    cardGrid.appendChild(c);
    cardEls.push(c);
  }
  cardDrawOverlay.classList.add('show');
  if(cardDrawTotal) cardDrawTotal.textContent = '';
  await wait(400);

  const {a,b} = draw.pairs[0];
  const s1 = draw.slotOrder[0], s2 = draw.slotOrder[1];
  const setFace = (el, n) => {
    if(!el) return;
    el.querySelector('.card-num').textContent = n;
    el.querySelectorAll('.card-pip').forEach(p => p.dataset.n = n);
  };
  setFace(cardEls[s1].querySelector('.front'), a);
  setFace(cardEls[s2].querySelector('.front'), b);

  // Les cartes non tirées s'effacent : sans ça les deux cartes
  // choisies se perdent au milieu de dix autres identiques et le
  // regard ne sait pas où se poser au moment du retournement.
  cardEls.forEach((c,i)=>{ if(i!==s1 && i!==s2) c.classList.add('dim'); });

  // Suspense : les 2 cartes qui vont être retournées se mettent à
  // luire avant la révélation, avec un son qui monte en tension —
  // aucune incidence sur le tirage, déjà déterminé au-dessus.
  cardEls[s1].classList.add('suspense');
  cardEls[s2].classList.add('suspense');
  playRiser(680);
  await wait(680);
  cardEls[s1].classList.remove('suspense');
  cardEls[s2].classList.remove('suspense');

  // Retournement décalé : deux cartes qui tournent exactement en même
  // temps ont l'air d'un mécanisme, pas d'un tirage. La première part,
  // la seconde suit une fraction de seconde après.
  cardEls[s1].classList.add('flipped');
  await wait(220);
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
/* 0,36 passait SOUS le seuil forcedFast (0,42) de startWalk : chaque
   trajet normal était donc traité comme une correction de fin de partie
   et courait à 2,8 cases/s, sans jamais passer par l'allure de marche
   WALK_V_MIN..MAX. À 0,50, seuls les vrais rattrapages restent forcés. */
const HOP_DURATION = 0.50;

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
  if(currentIndex===LAST){
    statusEl.textContent = '🏆 Arrivé à '+placeLabel(LAST)+' — JACKPOT FINAL !';
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
    if(currentIndex===LAST){
      statusEl.textContent = '🏆 Arrivé à '+placeLabel(LAST)+' — JACKPOT FINAL !';
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
  manualGame = false; forcedTotal = null;
  walk = null;
  currentIndex = -1;
  player.root.scale.set(1,1,1);
  player.root.rotation.x = 0;
  player.setWalking(false);
  cineEnd();                 // retour à la vue plateau
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
  const manualRoll = forcedTotal != null;
  if(currentIndex===-1){
    totalMise += AVG_MISE;
    saveTotals();
    manualGame = false;
    // Le lot de cette mise est décidé maintenant, tiré du lot
    // pré-calculé — les dés qui vont suivre restent honnêtes à
    // l'écran, mais ne décident plus du lot réellement remporté.
    // Sauf si l'hôte impose le tirage : la mise sort de la file.
    pendingOutcome = manualRoll ? null : nextPredeterminedOutcome();
  }
  if(manualRoll && !manualGame){
    manualGame = true;
    // un lot pré-tiré pour cette mise ? il retourne dans la file, il
    // servira à la prochaine mise jouée normalement
    if(pendingOutcome){
      outcomeState.batch.splice(outcomeState.pos, 0, pendingOutcome);
      saveOutcomeState();
      pendingOutcome = null;
    }
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
    const dist = ((idx - currentIndex) % N_TILES + N_TILES) % N_TILES;
    const d = dist===0 ? N_TILES : dist;
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
    statusEl.textContent = '🏆 Arrivé à '+placeLabel(LAST)+' — JACKPOT FINAL !';
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
  if(manualGame){
    // tirage imposé par l'hôte : on compte le vrai coût de la case,
    // sans passer par le plafond (c'est l'hôte qui tient les comptes)
    totalPaid += OUTCOME_COST[realCat] || 0;
    saveTotals();
  } else {
    fundedCategory(realCat);
  }
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
  // chiffres : touche PHYSIQUE (e.code), donc « é » = 2 sur clavier
  // français sans avoir à faire Maj, et le pavé numérique marche aussi
  const dm = /^(?:Digit|Numpad)([2-9])$/.exec(e.code || '');
  if(dm){ forcedDraw(parseInt(dm[1],10)); return; }
  if(LETTER_TOTALS[k]){ forcedDraw(LETTER_TOTALS[k]); return; }
  if(k==='a'){ if(startBtn && !startBtn.hidden) startBtn.click(); }
  else if(k==='b'){ if(!validate.disabled) validate.click(); }
  else if(k==='c'){ resetBtn.click(); }
  else if(k==='d'){ if(winBtn && !winBtn.hidden) winBtn.click(); }
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
/* Une gerbe : flash au coeur, onde de choc, puis la couronne
   d'etincelles. Les particules trainent (trail), freinent dans l'air et
   scintillent en fin de vie — c'est ce qui separe un vrai feu d'artifice
   d'une simple explosion de confettis. */
function spawnFirework(x, y, level, colors, opts){
  const o = opts || {};
  const cols = colors || (level>=4 ? ['#ffe27a','#fff2c2','#ffffff','#ffd200'] : ['#ffe27a','#e0323f','#1a56db','#ffffff']);
  const power = o.power || 1;
  const count = Math.round((30 + level*12) * power);

  // coeur : un flash bref, tres lumineux
  celebParticles.push({
    x, y, px:x, py:y, vx:0, vy:0, g:0, size:(30+level*8)*power, color:'#fff8e4',
    life:1, decay:0.12, shape:'flash', rot:0, vr:0, spark:false, drag:1
  });
  // onde de choc : un anneau fin qui s'ouvre et s'efface tres vite
  celebParticles.push({
    x, y, px:x, py:y, vx:0, vy:0, g:0, size:(10+level*3)*power, color:cols[0],
    life:1, decay:0.07, shape:'ring', rot:0, vr:0, spark:false, drag:1
  });

  // couronne principale : deux rayons de vitesse pour donner de
  // l'epaisseur a la sphere au lieu d'un simple cercle de points
  for(let i=0;i<count;i++){
    const ang = (i/count)*Math.PI*2 + (Math.random()-0.5)*0.35;
    const shell = Math.random()<0.62 ? 1 : 0.58;
    const spd = (2.6+Math.random()*3.4)*(1+level*0.13)*power*shell;
    const isSpark = Math.random() < 0.55;
    celebParticles.push({
      x, y, px:x, py:y, vx:Math.cos(ang)*spd, vy:Math.sin(ang)*spd,
      g: 0.055+Math.random()*0.03,
      size: isSpark ? 1.5+Math.random()*1.7 : 2.4+Math.random()*3.0,
      color: cols[(Math.random()*cols.length)|0],
      life:1, decay: 0.0075+Math.random()*0.007,
      shape: isSpark ? 'spark' : (Math.random()<0.45?'rect':'circle'),
      rot:Math.random()*Math.PI, vr:(Math.random()-0.5)*0.3,
      spark:isSpark, drag:0.975, twinkle: Math.random()<0.45
    });
  }

  // crepitement : une seconde salve blanche part du meme point un
  // instant plus tard, comme les fusees "a bouquet"
  if(o.crackle !== false){
    setTimeout(()=>{
      const n = Math.round(16*power);
      for(let i=0;i<n;i++){
        const a = Math.random()*Math.PI*2;
        const s = (1+Math.random()*2)*power;
        celebParticles.push({
          x, y, px:x, py:y, vx:Math.cos(a)*s, vy:Math.sin(a)*s - 0.6,
          g:0.05, size:1.2+Math.random()*1.3, color:'#fffaf0',
          life:1, decay:0.02+Math.random()*0.015, shape:'spark',
          rot:0, vr:0, spark:true, drag:0.965, twinkle:true
        });
      }
      if(!celebRAF) celebFrame();
    }, 420);
  }
}

/* Cadre du lot a l'ecran : les gerbes doivent ENCADRER la photo, pas la
   recouvrir. Sans ca les eclats passent devant le lot au moment precis
   ou le joueur veut le voir. */
function celebAnchorRect(){
  if(celebPhoto && !celebPhoto.hidden){
    const r = celebPhoto.getBoundingClientRect();
    if(r.width > 40 && r.height > 40) return r;
  }
  const el = celeb && celeb.querySelector('.celeb-text');
  if(el){
    const r = el.getBoundingClientRect();
    if(r.width > 40) return r;
  }
  return null;
}

/* Un point d'eclatement pour la fusee n°i : colonnes gauche et droite du
   cadre, puis au-dessus. Jamais au centre — le lot doit rester lisible.
   Le cadre est relu a chaque tir : au moment ou le show est lance la
   photo vient d'etre affichee et n'a pas encore sa taille finale. */
function framedBurstPoint(rect, i, W, H){
  // On ne tire que dans les marges REELLES autour de la photo. En
  // portrait sur telephone le lot occupe presque toute la largeur : des
  // gerbes calees a gauche et a droite partaient derriere l'image (le
  // canvas est sous la photo, pour que le lot reste lisible) et la
  // moitie du bouquet ne se voyait pas.
  const MIN = 80;
  const zones = [];
  if(rect.left > MIN) zones.push('L');
  if(W - rect.right > MIN) zones.push('R');
  if(rect.top > MIN) zones.push('T', 'T');       // le haut compte double
  if(H - rect.bottom > MIN) zones.push('B');
  if(!zones.length) zones.push('T');
  const rnd = (a,b) => a + Math.random()*(b-a);
  const z = zones[i % zones.length];
  let x, y;
  if(z === 'L'){
    x = rnd(W*0.05, Math.max(W*0.06, rect.left - 18));
    y = rnd(rect.top + rect.height*0.1, rect.top + rect.height*0.85);
  } else if(z === 'R'){
    x = rnd(Math.min(W*0.94, rect.right + 18), W*0.95);
    y = rnd(rect.top + rect.height*0.1, rect.top + rect.height*0.85);
  } else if(z === 'B'){
    x = rnd(rect.left + rect.width*0.12, rect.right - rect.width*0.12);
    y = rnd(rect.bottom + 24, H*0.95);
  } else {
    x = rnd(rect.left + rect.width*0.10, rect.right - rect.width*0.10);
    y = rnd(H*0.05, Math.max(H*0.06, rect.top - 20));
  }
  return {
    x: Math.max(W*0.04, Math.min(W*0.96, x)),
    y: Math.max(H*0.04, Math.min(H*0.96, y))
  };
}

/* Palettes par lot : le Duopack et le Tripack ont droit a leur propre
   spectacle, cale sur la couleur de leur case (teal / rose). */
const FIREWORK_PALETTES = {
  gradee:    [['#48e5c2','#b9fff0','#ffffff','#ffe27a'], ['#2fd6b0','#ffffff','#aaf7e6']],
  booster50: [['#ff6fae','#ffc2dd','#ffffff','#ffe27a'], ['#ff4f9a','#ffffff','#ffd7e8']],
};

function launchFireworksShow(level, catKey){
  if(!celebCanvas) return;
  const W = celebCanvas.width, H = celebCanvas.height;
  // Le Duopack (gradee) et le Tripack (booster50) recoivent un vrai
  // bouquet cadre sur la photo du lot, pas la volee generique.
  const showcase = (catKey === 'gradee' || catKey === 'booster50');
  const palettes = FIREWORK_PALETTES[catKey] || (level>=4
    ? [['#ffe27a','#fff2c2','#ffffff','#ffd200'], ['#ffb347','#ffe27a','#ffffff']]
    : [['#ffe27a','#e0323f','#1a56db','#ffffff'], ['#1a56db','#ffffff','#ffe27a']]);

  const rocketCount = showcase ? 14 : 2 + level;

  for(let i=0;i<rocketCount;i++){
    // salves de 3 : un bouquet se lit par vagues, une fusee toutes les
    // 200 ms d'affilee donne un egrenage monotone
    const wave = Math.floor(i/3);
    const delay = wave*520 + (i%3)*(90+Math.random()*70);
    setTimeout(()=>{
      const rect = showcase ? celebAnchorRect() : null;
      const p = rect ? framedBurstPoint(rect, i, W, H) : null;
      const x = p ? p.x : W*(0.18+Math.random()*0.64);
      const y1 = p ? p.y : H*(0.22+Math.random()*0.2);
      const colors = palettes[(Math.random()*palettes.length)|0];
      celebRockets.push({
        x, y:H*1.05, y0:H*1.05, y1, px:x, py:H*1.05,
        start: performance.now(), dur: (showcase?600:480)+Math.random()*240,
        exploded:false, level, colors,
        power: showcase ? 1.25+Math.random()*0.45 : 1
      });
      if(!celebRAF) celebFrame();
    }, delay);
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
      spawnFirework(r.x, r.y1, r.level, r.colors, {power:r.power});
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
    // frein de l'air : sans lui les eclats filent en ligne droite et la
    // gerbe ressemble a une roue de rayons, pas a une sphere qui retombe
    const dr = p.drag == null ? 1 : p.drag;
    p.vx *= dr; p.vy *= dr;
    p.x += p.vx; p.y += p.vy; p.vy += p.g; p.life -= p.decay; p.rot += p.vr;
    celebCtx.save();
    // scintillement de fin de vie, comme une braise
    let a = Math.max(0, p.life);
    if(p.twinkle && p.life < 0.55) a *= 0.35 + 0.65*Math.abs(Math.sin(p.life*42));
    celebCtx.globalAlpha = a;
    if(p.shape==='ring'){
      const rad = p.size * (1 + (1-p.life)*7);
      celebCtx.globalCompositeOperation = 'lighter';
      celebCtx.strokeStyle = p.color;
      celebCtx.lineWidth = Math.max(0.6, 3.5*p.life);
      celebCtx.beginPath(); celebCtx.arc(p.x,p.y,rad,0,Math.PI*2); celebCtx.stroke();
    } else if(p.shape==='flash'){
      const rad = p.size * (1.15 - p.life*0.3);
      const grad = celebCtx.createRadialGradient(p.x,p.y,0, p.x,p.y,rad);
      grad.addColorStop(0, p.color);
      grad.addColorStop(1, 'rgba(255,240,200,0)');
      celebCtx.globalCompositeOperation = 'lighter';
      celebCtx.fillStyle = grad;
      celebCtx.beginPath(); celebCtx.arc(p.x,p.y,rad,0,Math.PI*2); celebCtx.fill();
    } else if(p.spark){
      celebCtx.globalCompositeOperation = 'lighter';
      celebCtx.lineCap = 'round';
      celebCtx.strokeStyle = p.color; celebCtx.lineWidth = p.size;
      celebCtx.beginPath(); celebCtx.moveTo(p.px,p.py); celebCtx.lineTo(p.x,p.y); celebCtx.stroke();
    } else {
      // trainee derriere chaque eclat : c'est elle qui donne la sensation
      // de vitesse et de matiere incandescente
      celebCtx.globalCompositeOperation = 'lighter';
      celebCtx.lineCap = 'round';
      celebCtx.globalAlpha = a*0.5;
      celebCtx.strokeStyle = p.color; celebCtx.lineWidth = p.size*0.7;
      celebCtx.beginPath(); celebCtx.moveTo(p.px,p.py); celebCtx.lineTo(p.x,p.y); celebCtx.stroke();
      celebCtx.globalAlpha = a;
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
    if(!celebLocked) celeb.classList.remove('show','flip','rare-card');
  }
}

function clearCelebration(){
  celebGen++;
  if(celebRAF) cancelAnimationFrame(celebRAF);
  celebRAF = null;
  celebParticles = [];
  celebRockets = [];
  celebLocked = false;
  if(celeb) celeb.classList.remove('show','shake','flip','rare-card');
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
    if(myPreviewGen===previewGen && !celebLocked) celeb.classList.remove('show','flip','rare-card');
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
    celeb.classList.remove('show','shake','flip','rare-card');
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
  // état repris à zéro : sans ça le halo "carte rare" d'une pioche
  // précédente resterait allumé sur un lot ordinaire.
  celeb.classList.remove('flip','rare-card');
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
    if(rareCardDrawn){ celeb.classList.add('shake'); triggerCheer(1.3); }
    // Retournement de carte : une pioche doit se RETOURNER, pas
    // apparaître. Volontairement court (~0,5 s) — on montre le geste
    // du tirage, on ne fabrique pas un faux suspense sur un résultat
    // déjà décidé. La classe est retirée puis reposée après un reflow,
    // sinon l'animation ne rejoue pas d'une pioche à l'autre.
    if(!reduceMotion){
      celeb.classList.remove('flip');
      void celeb.offsetWidth;
      celeb.classList.add('flip');
    }
    celeb.classList.toggle('rare-card', rareCardDrawn);
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
  // Duopack et Tripack : bouquet cadre sur la photo du lot (voir
  // launchFireworksShow), et show plus long pour lui laisser le temps
  // de se dérouler jusqu'au bout.
  const showcase = (catKey==='gradee' || catKey==='booster50');
  if(!skipFx){
    launchFireworksShow(effectiveLevel, catKey);
    if(effectiveLevel>=3 || showcase){
      triggerLightning();
      if(effectiveLevel>=4 || showcase) setTimeout(triggerLightning, 380);
    }
  }
  celebEndAt = performance.now() + (skipFx ? 1200 : (showcase ? 4600 : 1900 + effectiveLevel*500));
  if(!celebRAF) celebFrame();
  setTimeout(()=>{ celeb.classList.remove('shake'); }, rareCardDrawn ? 900 : 700);
}
