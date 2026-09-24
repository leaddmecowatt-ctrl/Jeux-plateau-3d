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
  booster8:    { label:'Booster du Marchand 30 ans',  value:'~17€',    tier:'float', swatch:'blue'   },
  alternative: { label:'Lot Mystère',                 value:'~7,20€',  tier:'flat',  swatch:'red'    },
  gradee:      { label:'Duopack 30 ans',              value:'~30€',    tier:'float', swatch:'teal'   },
  booster50:   { label:'Tripack 30 ans',              value:'~58€',    tier:'float', swatch:'rose'   },
  etb:         { label:'Coffret 30 ans',              value:'~85€',    tier:'float', swatch:'orange' },
  jackpot300:  { label:'ETB 30 ans',                  value:'~190€',   tier:'float', swatch:'jackpot'},
  chance:      { label:'Chance',                     value:'tirage',  tier:'glyph', swatch:'purple' },
  chest:       { label:'Caisse Communautaire',       value:'tirage',  tier:'glyph', swatch:'green'  },
  prison:      { label:'Prison',                     value:'0€',      tier:'glyph', swatch:'danger' },
  // Parc gratuit (23/09) : le lot des cartes promo ouvertes par l'hôte
  parc:        { label:'Parc gratuit',               value:'promos',  tier:'glyph', swatch:'green'  },
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
/* Chance et Caisse : la carte fait TOUJOURS avancer ou reculer le pion
   jusqu'à une case de lot (jamais de fin de partie sur Chance/Caisse, même
   sans lancer restant). Le déplacement est décidé par le planificateur
   (plannedCardDelta) pour amener le pion sur la case du lot prévu ; ces
   listes ne servent que de repli si le pion y arrive sans plan. */
const CHANCE_DECK = [
  { text: 'Avancez de 3 cases', weight: 4, effect:{type:'move', delta:3} },
  { text: 'Avancez de 5 cases', weight: 3, effect:{type:'move', delta:5} },
  { text: 'Reculez de 2 cases', weight: 3, effect:{type:'move', delta:-2} },
];
const CHEST_DECK = [
  { text: 'Avancez de 2 cases', weight: 4, effect:{type:'move', delta:2} },
  { text: 'Avancez de 4 cases', weight: 3, effect:{type:'move', delta:4} },
  { text: 'Reculez de 1 case',  weight: 3, effect:{type:'move', delta:-1} },
];
let plannedCardDelta = null;
function moveCard(delta){
  const n = Math.abs(delta);
  return { text: (delta>0 ? 'Avancez de ' : 'Reculez de ')+n+' case'+(n>1?'s':''), weight: 1, effect:{type:'move', delta} };
}
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
  if(plannedCardDelta != null){
    const c = moveCard(plannedCardDelta);
    plannedCardDelta = null;
    return c;
  }
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
  'commune','chance','alternative','commune','commune','gradee','commune','booster50','prison',
  'parc','commune','commune','booster8','booster8','chance','commune','etb','jackpot300',
].map(tok=>({ cat: tok.replace('*',''), isVisite: tok.endsWith('*') }));
// Case 21 : Lot Mystère (23/09, accord de l'animateur ; c'était une commune).
// Le Lot Mystère (90 coups sur 245) n'existait qu'en cases 2 et 12 : la
// case 2 est hors d'atteinte depuis Départ, le pion allait donc TOUJOURS en
// case 12 en trois petits pas (3 à 5). Aucune case ajoutée.
// Case 28 (angle, à côté de la Prison) : Parc gratuit, où tombent les cartes
// promo (demande de l'animateur, 23/09 ; c'était une commune).
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
  // Lot mystère (case « Zone Safari ») : les deux issues possibles
  mystBooster:'./assets/lots/mystere_booster.jpg',
  mystCarte:  './assets/lots/mystere_carte.jpg',
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
  bronze:'#243a78', blue:'#2f8ff0', red:'#e0323f', purple:'#9a5fe0',
  green:'#33b46a', gold:'#e9c34a', danger:'#5e6b80',
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
/* ==========================================================================
   CASES « CARTE COLLECTOR » (23/09, cahier des charges de l'animateur)
   --------------------------------------------------------------------------
   Toutes les cases partagent la même structure, sobre et premium :
     socle bleu nuit profond · bordure en feuille d'or · filet intérieur ·
     fenêtre ivoire où la photo du lot est LA vedette · filet d'accent avec
     une gemme · nom du lot en lettres dorées.
   Les couleurs ne remplissent plus rien : elles ne sont plus que des
   accents (le filet et la gemme). Les produits photographiés sur fond
   blanc sont posés en « produit » (mode multiplication) : le blanc se fond
   dans l'ivoire, c'est un détourage propre sans aucun fichier en plus.
   Une case = une photo. Les cartes photo qui flottaient au-dessus des gros
   lots, doublons de la photo de la case, sont retirées.
   ========================================================================== */
const CASE_NAVY_HAUT = '#18234f', CASE_NAVY_BAS = '#0a1027';
const CASE_IVOIRE = '#f6efdc', CASE_TEXTE = '#f7e6b2';
/* Langage des accents : lots = or, Chance = violet, Caisse = vert,
   cases spéciales = bleu, événements = rouge. */
const CASE_ACCENT = {
  jackpot300:'#e9c34a', etb:'#e9c34a', booster50:'#e9c34a', gradee:'#e9c34a', booster8:'#e9c34a',
  chance:'#a46cf0', chest:'#36bf70', parc:'#f08a24', commune:'#4a8cf0', alternative:'#4a8cf0', depart:'#4a8cf0', prison:'#e0413f',
};
function caseAccent(catKey){ return CASE_ACCENT[catKey] || GOLD; }
function goldLeafStroke(ctx, x0, y0, x1, y1){
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0.00,'#fff3b8'); g.addColorStop(0.22,'#e9c34a'); g.addColorStop(0.48,'#9b7426');
  g.addColorStop(0.70,'#f6d97c'); g.addColorStop(1.00,'#b88a2c');
  return g;
}
/* Socle commun : bleu nuit en dégradé, lueur haute, bordure feuille d'or,
   filet intérieur, léger vernis en haut et assombrissement en bas (relief). */
function drawCaseBase(ctx, size){
  const r = size*0.13;
  ctx.save();
  roundRectPath(ctx, 10, 10, size-20, size-20, r); ctx.clip();
  const g = ctx.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0, CASE_NAVY_HAUT); g.addColorStop(1, CASE_NAVY_BAS);
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  const lu = ctx.createRadialGradient(size*0.5, size*0.22, 10, size*0.5, size*0.3, size*0.75);
  lu.addColorStop(0, 'rgba(140,165,255,.16)'); lu.addColorStop(1, 'rgba(140,165,255,0)');
  ctx.fillStyle = lu; ctx.fillRect(0, 0, size, size);
  ctx.restore();
  roundRectPath(ctx, 12, 12, size-24, size-24, r);
  ctx.lineWidth = 18; ctx.strokeStyle = goldLeafStroke(ctx, 0, 0, size, size); ctx.stroke();
  roundRectPath(ctx, 34, 34, size-68, size-68, r*0.8);
  ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(233,195,74,.75)'; ctx.stroke();
}
function caseVernis(ctx, size){
  const r = size*0.13;
  ctx.save(); roundRectPath(ctx, 10, 10, size-20, size-20, r); ctx.clip();
  const v = ctx.createLinearGradient(0, 0, 0, size);
  v.addColorStop(0, 'rgba(255,255,255,.07)'); v.addColorStop(0.25, 'rgba(255,255,255,0)');
  v.addColorStop(0.8, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.18)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, size, size);
  ctx.restore();
}
const _fondBlanc = new Map();
function photoSurFondBlanc(img){
  if(_fondBlanc.has(img)) return _fondBlanc.get(img);
  const c = document.createElement('canvas'); c.width = c.height = 8;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0, 8, 8);
  const d = x.getImageData(0, 0, 8, 8).data;
  let clair = 0;
  for(const [px, py] of [[0,0],[7,0],[0,7],[7,7]]){ const i = (py*8+px)*4; if(d[i]+d[i+1]+d[i+2] > 3*222) clair++; }
  const v = clair >= 3; _fondBlanc.set(img, v); return v;
}
/* Fenêtre photo : passe-partout ivoire, photo « contain » à taille
   homogène, filet d'or, ombre intérieure (la photo est EN RETRAIT). */
function drawPhotoWindow(ctx, img, x, y, w, h, rad){
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 6;
  roundRectPath(ctx, x, y, w, h, rad); ctx.fillStyle = CASE_IVOIRE; ctx.fill();
  ctx.restore();
  ctx.save();
  roundRectPath(ctx, x, y, w, h, rad); ctx.clip();
  const pm = ctx.createRadialGradient(x+w/2, y+h*0.45, 10, x+w/2, y+h/2, Math.max(w,h)*0.7);
  pm.addColorStop(0, '#fbf6e8'); pm.addColorStop(1, '#e8dcbc');
  ctx.fillStyle = pm; ctx.fillRect(x, y, w, h);
  if(img){
    const pad = Math.min(w, h)*0.035, bw = w - pad*2, bh = h - pad*2;
    const sc = Math.min(bw/img.width, bh/img.height);
    const iw = img.width*sc, ih = img.height*sc, ix = x + (w-iw)/2, iy = y + (h-ih)/2;
    if(photoSurFondBlanc(img)){
      ctx.globalCompositeOperation = 'multiply';
      ctx.filter = 'saturate(1.12) contrast(1.05)';
      ctx.drawImage(img, ix, iy, iw, ih);
    } else {
      ctx.shadowColor = 'rgba(40,25,0,.35)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 4;
      ctx.filter = 'saturate(1.12) contrast(1.05)';
      ctx.drawImage(img, ix, iy, iw, ih);
      ctx.shadowColor = 'transparent'; ctx.filter = 'none';
      ctx.strokeStyle = 'rgba(155,116,38,.8)'; ctx.lineWidth = 3; ctx.strokeRect(ix, iy, iw, ih);
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  }
  // ombre intérieure en bord de fenêtre
  ctx.shadowColor = 'rgba(60,40,5,.45)'; ctx.shadowBlur = 18;
  roundRectPath(ctx, x-8, y-8, w+16, h+16, rad+8); ctx.lineWidth = 16; ctx.strokeStyle = 'rgba(0,0,0,.001)'; ctx.stroke();
  ctx.restore();
  roundRectPath(ctx, x, y, w, h, rad);
  ctx.lineWidth = 5; ctx.strokeStyle = goldLeafStroke(ctx, x, y, x+w, y+h); ctx.stroke();
}
function drawGem(ctx, cx, cy, r, col){
  ctx.save();
  ctx.beginPath(); ctx.moveTo(cx, cy-r); ctx.lineTo(cx+r*0.8, cy); ctx.lineTo(cx, cy+r); ctx.lineTo(cx-r*0.8, cy); ctx.closePath();
  const g = ctx.createLinearGradient(cx-r, cy-r, cx+r, cy+r);
  g.addColorStop(0, shadeHex(col, 0.45)); g.addColorStop(0.5, col); g.addColorStop(1, shadeHex(col, -0.45));
  ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = '#f6d97c'; ctx.stroke();
  ctx.restore();
}
/* Filet d'accent + gemme, puis nom du lot en or clair. */
function drawNameBlock(ctx, size, label, accent, y0, y1, dark){
  const cx = size/2;
  ctx.save();
  const ly = y0 + 10;
  const lg = ctx.createLinearGradient(size*0.18, 0, size*0.82, 0);
  lg.addColorStop(0, 'rgba(0,0,0,0)'); lg.addColorStop(0.2, accent); lg.addColorStop(0.8, accent); lg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = lg; ctx.fillRect(size*0.18, ly-3, size*0.64, 6);
  drawGem(ctx, cx, ly, 17, accent);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const ty = (ly + 24 + y1)/2;
  ctx.fillStyle = dark ? CASE_NAVY_HAUT : CASE_TEXTE;
  if(!dark){ ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3; }
  drawFittedSerif(ctx, label, cx, ty, size*0.80, size*0.090, size*0.056, y1 - ly - 30);
  ctx.restore();
}
/* Titre en capitales à empattements, sur une ou deux lignes. */
function drawFittedSerif(ctx, text, cx, cy, maxW, maxF, minF, maxH){
  const fam = 'Georgia,"Times New Roman",serif';
  text = text.toUpperCase();
  const fits = (t, f)=>{ ctx.font = '700 '+f+'px '+fam; return ctx.measureText(t).width <= maxW; };
  for(let f = maxF; f >= minF; f -= 2){ if(fits(text, f)){ ctx.font = '700 '+f+'px '+fam; ctx.fillText(text, cx, cy); return; } }
  const w = text.split(' ');
  let best = 1, diff = 1e9;
  for(let i=1;i<w.length;i++){ const d = Math.abs(w.slice(0,i).join(' ').length - w.slice(i).join(' ').length); if(d < diff){ diff = d; best = i; } }
  const l1 = w.slice(0,best).join(' '), l2 = w.slice(best).join(' ');
  let f = Math.min(maxF, maxH ? maxH/2.2 : maxF);
  while(f > minF*0.7 && !(fits(l1, f) && fits(l2, f))) f -= 1.5;
  ctx.font = '700 '+f+'px '+fam;
  ctx.fillText(l1, cx, cy - f*0.56); ctx.fillText(l2, cx, cy + f*0.56);
}
/* Médaillon des cases sans photo (Chance, Caisse, Prison, visite). */
/* ---------- Illustrations des cases spéciales (23/09) ----------
   Demande de l'animateur : la Prison en rouge avec des barreaux, comme au
   Monopoly ; un vrai « ? » pour Chance (l'ancien point dans une bulle ne
   plaisait pas) ; un coffre au trésor pour la Caisse Communautaire.
   Chaque dessin remplit le rectangle donné (fenêtre de case ou billet
   d'angle) ; les pictos seuls servent aussi aux médaillons flottants. */
function fondRayonne(ctx, x, y, w, h, c0, c1, rayons){
  const cx = x+w/2, cy = y+h/2;
  const g = ctx.createRadialGradient(cx, cy, 10, cx, cy, Math.max(w,h)*0.72);
  g.addColorStop(0, c0); g.addColorStop(1, c1);
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  if(rayons){
    ctx.save(); ctx.translate(cx, cy);
    ctx.fillStyle = rayons;
    const R = Math.max(w,h);
    for(let k=0;k<16;k++){
      const a = k*Math.PI/8;
      ctx.beginPath(); ctx.moveTo(0,0);
      ctx.arc(0, 0, R, a, a + Math.PI/20); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
}
function etincelle(ctx, x, y, r, col){
  ctx.save(); ctx.translate(x, y); ctx.fillStyle = col || '#fff6d0';
  ctx.shadowColor = 'rgba(255,240,180,.9)'; ctx.shadowBlur = r*1.2;
  ctx.beginPath();
  for(let k=0;k<8;k++){ const rr = k%2 ? r*0.22 : r; const a = k*Math.PI/4 - Math.PI/2; ctx.lineTo(Math.cos(a)*rr, Math.sin(a)*rr); }
  ctx.closePath(); ctx.fill(); ctx.restore();
}
function orVertical(ctx, y0, y1){
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, '#fff4b8'); g.addColorStop(0.35, '#f5cf4a'); g.addColorStop(0.7, '#c98f17'); g.addColorStop(1, '#8a5a07');
  return g;
}
/* « ? » doré en relief */
function drawGoldQuestion(ctx, cx, cy, H){
  ctx.save();
  ctx.font = '900 '+H+'px Georgia,"Times New Roman",serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  // ombre portée et lueur
  ctx.shadowColor = 'rgba(255,214,90,.75)'; ctx.shadowBlur = H*0.18;
  ctx.lineWidth = H*0.10; ctx.strokeStyle = '#2a0d4a'; ctx.strokeText('?', cx, cy + H*0.04);
  ctx.shadowBlur = 0;
  // tranche (relief) : le même glyphe décalé, plus sombre
  ctx.fillStyle = '#7a4a06'; ctx.fillText('?', cx + H*0.025, cy + H*0.07);
  ctx.fillStyle = orVertical(ctx, cy - H*0.45, cy + H*0.45);
  ctx.fillText('?', cx, cy + H*0.04);
  // reflet
  ctx.lineWidth = H*0.012; ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.strokeText('?', cx - H*0.01, cy + H*0.03);
  ctx.restore();
}
/* coffre au trésor : W = largeur du coffre, (cx, cy) = centre du coffre */
function drawChestIcon(ctx, cx, cy, W, lueur){
  const bw = W, bh = W*0.46, lidH = W*0.30;
  const x0 = cx - bw/2, yTop = cy - bh*0.15, yBot = yTop + bh;
  ctx.save();
  if(lueur){
    const gl = ctx.createRadialGradient(cx, yTop, 4, cx, yTop, W*0.95);
    gl.addColorStop(0, 'rgba(255,236,150,.85)'); gl.addColorStop(0.4, 'rgba(255,210,90,.30)'); gl.addColorStop(1, 'rgba(255,210,90,0)');
    ctx.fillStyle = gl; ctx.fillRect(cx - W, yTop - W, W*2, W*2);
  }
  ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = W*0.08; ctx.shadowOffsetY = W*0.03;
  // corps en bois
  const wood = ctx.createLinearGradient(0, yTop, 0, yBot);
  wood.addColorStop(0, '#9a5a28'); wood.addColorStop(1, '#4e270d');
  roundRectPath(ctx, x0, yTop, bw, bh, W*0.04); ctx.fillStyle = wood; ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(40,18,4,.55)'; ctx.lineWidth = Math.max(1, W*0.012);
  for(let k=1;k<3;k++){ const yy = yTop + bh*k/3; ctx.beginPath(); ctx.moveTo(x0+W*0.02, yy); ctx.lineTo(x0+bw-W*0.02, yy); ctx.stroke(); }
  // couvercle bombé
  const woodL = ctx.createLinearGradient(0, yTop - lidH, 0, yTop);
  woodL.addColorStop(0, '#b8743a'); woodL.addColorStop(1, '#6a3714');
  ctx.beginPath(); ctx.moveTo(x0, yTop);
  ctx.bezierCurveTo(x0, yTop - lidH*1.25, x0 + bw, yTop - lidH*1.25, x0 + bw, yTop);
  ctx.closePath(); ctx.fillStyle = woodL; ctx.fill();
  // cerclages d'or
  const gold = orVertical(ctx, yTop - lidH, yBot);
  ctx.fillStyle = gold;
  const band = W*0.075;
  for(const f of [0.2, 0.8]){
    const bx = x0 + bw*f - band/2;
    ctx.fillRect(bx, yTop, band, bh);
    ctx.save(); ctx.beginPath(); ctx.moveTo(x0, yTop);
    ctx.bezierCurveTo(x0, yTop - lidH*1.25, x0 + bw, yTop - lidH*1.25, x0 + bw, yTop); ctx.closePath(); ctx.clip();
    ctx.fillRect(bx, yTop - lidH*1.3, band, lidH*1.3); ctx.restore();
  }
  ctx.fillRect(x0 - W*0.01, yTop - W*0.025, bw + W*0.02, W*0.05);           // jonction
  ctx.fillRect(x0 - W*0.01, yBot - W*0.045, bw + W*0.02, W*0.045);          // pied
  // serrure
  const lw = W*0.16, lh = W*0.2;
  roundRectPath(ctx, cx - lw/2, yTop - W*0.02, lw, lh, W*0.03); ctx.fillStyle = gold; ctx.fill();
  ctx.lineWidth = Math.max(1, W*0.012); ctx.strokeStyle = '#7a4a06'; ctx.stroke();
  ctx.fillStyle = '#2a1405';
  ctx.beginPath(); ctx.arc(cx, yTop + lh*0.35, lw*0.13, 0, Math.PI*2); ctx.fill();
  ctx.fillRect(cx - lw*0.06, yTop + lh*0.38, lw*0.12, lh*0.3);
  // contour
  ctx.lineWidth = Math.max(1.5, W*0.018); ctx.strokeStyle = 'rgba(30,12,2,.9)';
  roundRectPath(ctx, x0, yTop, bw, bh, W*0.04); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x0, yTop); ctx.bezierCurveTo(x0, yTop - lidH*1.25, x0 + bw, yTop - lidH*1.25, x0 + bw, yTop); ctx.stroke();
  ctx.restore();
}
function drawCoin(ctx, x, y, r){
  ctx.save();
  ctx.beginPath(); ctx.ellipse(x, y, r, r*0.62, 0, 0, Math.PI*2);
  ctx.fillStyle = orVertical(ctx, y - r*0.6, y + r*0.6); ctx.fill();
  ctx.lineWidth = Math.max(1, r*0.12); ctx.strokeStyle = '#8a5a07'; ctx.stroke();
  ctx.beginPath(); ctx.ellipse(x, y, r*0.62, r*0.36, 0, 0, Math.PI*2);
  ctx.strokeStyle = 'rgba(255,248,210,.7)'; ctx.lineWidth = Math.max(1, r*0.07); ctx.stroke();
  ctx.restore();
}
/* cadenas doré */
function drawPadlock(ctx, cx, cy, S){
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = S*0.12; ctx.shadowOffsetY = S*0.04;
  ctx.lineWidth = S*0.13; ctx.lineCap = 'round';
  const sg = ctx.createLinearGradient(cx - S*0.3, 0, cx + S*0.3, 0);
  sg.addColorStop(0, '#6b6b72'); sg.addColorStop(0.5, '#e8e8ee'); sg.addColorStop(1, '#55555c');
  ctx.strokeStyle = sg;
  ctx.beginPath(); ctx.arc(cx, cy - S*0.12, S*0.26, Math.PI, 0); ctx.lineTo(cx + S*0.26, cy + S*0.05);
  ctx.moveTo(cx - S*0.26, cy - S*0.12); ctx.lineTo(cx - S*0.26, cy + S*0.05); ctx.stroke();
  roundRectPath(ctx, cx - S*0.42, cy, S*0.84, S*0.66, S*0.12);
  ctx.fillStyle = orVertical(ctx, cy, cy + S*0.66); ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = S*0.04; ctx.strokeStyle = '#7a4a06'; ctx.stroke();
  ctx.fillStyle = '#2a1405';
  ctx.beginPath(); ctx.arc(cx, cy + S*0.27, S*0.09, 0, Math.PI*2); ctx.fill();
  ctx.fillRect(cx - S*0.04, cy + S*0.3, S*0.08, S*0.2);
  ctx.restore();
}
function drawPrisonArt(ctx, x, y, w, h){
  // mur de briques rouges
  fondRayonne(ctx, x, y, w, h, '#e0453c', '#5e0a0a', null);
  ctx.save();
  ctx.strokeStyle = 'rgba(40,0,0,.35)'; ctx.lineWidth = Math.max(2, w*0.006);
  const bh = h/9, bw = w/5;
  for(let r=0;r<10;r++){
    const yy = y + r*bh; ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x+w, yy); ctx.stroke();
    for(let c=0;c<6;c++){ const xx = x + c*bw + (r%2 ? bw/2 : 0); ctx.beginPath(); ctx.moveTo(xx, yy); ctx.lineTo(xx, yy+bh); ctx.stroke(); }
  }
  ctx.restore();
  // fenêtre de cellule
  const fx = x + w*0.15, fy = y + h*0.12, fw = w*0.70, fh = h*0.66;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = w*0.04;
  const inside = ctx.createLinearGradient(0, fy, 0, fy+fh);
  inside.addColorStop(0, '#1b0404'); inside.addColorStop(1, '#3d0909');
  roundRectPath(ctx, fx, fy, fw, fh, w*0.02); ctx.fillStyle = inside; ctx.fill();
  ctx.restore();
  // barreaux
  const metal = (x0, x1)=>{ const g = ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, '#1d1d22'); g.addColorStop(0.35, '#b9bac2'); g.addColorStop(0.55, '#6d6e76'); g.addColorStop(1, '#141418'); return g; };
  const n = 6, bwid = fw*0.055;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = w*0.015; ctx.shadowOffsetX = w*0.006;
  for(let k=0;k<n;k++){
    const bx = fx + fw*(k+0.5)/n - bwid/2;
    ctx.fillStyle = metal(bx, bx+bwid); ctx.fillRect(bx, fy - h*0.03, bwid, fh + h*0.06);
  }
  const traverse = (yy)=>{ const g = ctx.createLinearGradient(0, yy, 0, yy+bwid);
    g.addColorStop(0, '#1d1d22'); g.addColorStop(0.4, '#b9bac2'); g.addColorStop(1, '#141418');
    ctx.fillStyle = g; ctx.fillRect(fx - w*0.02, yy, fw + w*0.04, bwid); };
  traverse(fy + fh*0.06); traverse(fy + fh*0.94 - bwid);
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#d8d9df';
  for(let k=0;k<n;k++){ const rx = fx + fw*(k+0.5)/n;
    for(const ry of [fy + fh*0.06 + bwid/2, fy + fh*0.94 - bwid/2]){ ctx.beginPath(); ctx.arc(rx, ry, bwid*0.22, 0, Math.PI*2); ctx.fill(); } }
  ctx.restore();
  // cadenas accroché à la traverse du bas
  drawPadlock(ctx, x + w/2, fy + fh*0.80, Math.min(w, h)*0.20);
}
function drawChanceArt(ctx, x, y, w, h){
  fondRayonne(ctx, x, y, w, h, '#9a5cf0', '#240a4d', 'rgba(255,255,255,.07)');
  drawGoldQuestion(ctx, x + w/2, y + h*0.50, h*0.82);
  for(const [fx, fy, fr] of [[0.18,0.22,0.05],[0.83,0.28,0.04],[0.22,0.78,0.035],[0.8,0.74,0.05],[0.66,0.12,0.03]])
    etincelle(ctx, x + w*fx, y + h*fy, Math.min(w,h)*fr);
}
function drawChestArt(ctx, x, y, w, h){
  fondRayonne(ctx, x, y, w, h, '#3fcf7f', '#0a3d23', 'rgba(255,255,255,.07)');
  const W = Math.min(w*0.62, h*0.95);
  drawChestIcon(ctx, x + w/2, y + h*0.56, W, true);
  const r = W*0.07, by = y + h*0.56 + W*0.36;
  for(const [dx, dy] of [[-0.42,0.02],[-0.30,0.06],[0.34,0.04],[0.45,0.0],[0.26,0.08]]) drawCoin(ctx, x + w/2 + W*dx, by + W*dy, r);
  for(const [fx, fy, fr] of [[0.2,0.2,0.045],[0.8,0.24,0.04],[0.5,0.1,0.035],[0.14,0.62,0.03],[0.87,0.6,0.035]])
    etincelle(ctx, x + w*fx, y + h*fy, Math.min(w,h)*fr);
}
/* Parc gratuit : une scène de parc (pelouse, arbres), la petite voiture
   rouge du Monopoly, un panneau « P » et un éventail de cartes promo. */
function drawCarIcon(ctx, cx, cy, W){
  const H = W*0.42, x0 = cx - W/2, y0 = cy - H/2;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = W*0.06; ctx.shadowOffsetY = W*0.03;
  const rouge = ctx.createLinearGradient(0, y0, 0, y0 + H);
  rouge.addColorStop(0, '#ff6b5e'); rouge.addColorStop(0.55, '#d7261e'); rouge.addColorStop(1, '#8e0f0b');
  // habitacle
  ctx.beginPath();
  ctx.moveTo(x0 + W*0.26, y0 + H*0.42);
  ctx.quadraticCurveTo(x0 + W*0.34, y0 - H*0.12, x0 + W*0.52, y0 - H*0.10);
  ctx.quadraticCurveTo(x0 + W*0.68, y0 - H*0.08, x0 + W*0.74, y0 + H*0.42);
  ctx.closePath(); ctx.fillStyle = rouge; ctx.fill();
  // carrosserie
  roundRectPath(ctx, x0, y0 + H*0.38, W, H*0.44, H*0.18); ctx.fillStyle = rouge; ctx.fill();
  ctx.shadowColor = 'transparent';
  // vitres
  ctx.fillStyle = '#bfe6ff';
  ctx.beginPath(); ctx.moveTo(x0 + W*0.33, y0 + H*0.38); ctx.quadraticCurveTo(x0 + W*0.38, y0 + H*0.02, x0 + W*0.48, y0 + H*0.0);
  ctx.lineTo(x0 + W*0.48, y0 + H*0.38); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x0 + W*0.52, y0 + H*0.0); ctx.quadraticCurveTo(x0 + W*0.63, y0 + H*0.02, x0 + W*0.67, y0 + H*0.38);
  ctx.lineTo(x0 + W*0.52, y0 + H*0.38); ctx.closePath(); ctx.fill();
  // phares, pare-chocs
  ctx.fillStyle = '#fff4b0'; ctx.beginPath(); ctx.arc(x0 + W*0.95, y0 + H*0.55, H*0.07, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#d9d9df'; ctx.fillRect(x0 - W*0.01, y0 + H*0.74, W*0.14, H*0.07); ctx.fillRect(x0 + W*0.87, y0 + H*0.74, W*0.14, H*0.07);
  // roues
  for(const fx of [0.24, 0.76]){
    const wx = x0 + W*fx, wy = y0 + H*0.84, r = H*0.2;
    ctx.fillStyle = '#1b1b20'; ctx.beginPath(); ctx.arc(wx, wy, r, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#c9c9d1'; ctx.beginPath(); ctx.arc(wx, wy, r*0.45, 0, Math.PI*2); ctx.fill();
  }
  ctx.lineWidth = Math.max(1.5, W*0.012); ctx.strokeStyle = 'rgba(60,4,2,.85)';
  roundRectPath(ctx, x0, y0 + H*0.38, W, H*0.44, H*0.18); ctx.stroke();
  ctx.restore();
}
function drawParkSign(ctx, x, y, S){
  ctx.save();
  ctx.fillStyle = '#8a8a92'; ctx.fillRect(x - S*0.05, y, S*0.1, S*1.5);
  ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = S*0.15;
  roundRectPath(ctx, x - S/2, y - S*0.5, S, S, S*0.16);
  const bleu = ctx.createLinearGradient(0, y - S*0.5, 0, y + S*0.5);
  bleu.addColorStop(0, '#3d8cff'); bleu.addColorStop(1, '#1447b8'); ctx.fillStyle = bleu; ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = S*0.07; ctx.strokeStyle = '#ffffff'; ctx.stroke();
  ctx.fillStyle = '#ffffff'; ctx.font = '900 '+(S*0.78)+'px Arial,Helvetica,sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('P', x, y + S*0.04);
  ctx.restore();
}
function drawPromoFan(ctx, cx, cy, W){
  const cw = W*0.42, ch = cw*1.4;
  for(const [a, dx, c0, c1] of [[-0.35, -0.24, '#6fd0ff', '#2a62d8'], [0, 0, '#ffe27a', '#e08a12'], [0.35, 0.24, '#ff9ad2', '#c0307a']]){
    ctx.save(); ctx.translate(cx + W*dx, cy); ctx.rotate(a);
    ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = W*0.06;
    roundRectPath(ctx, -cw/2, -ch/2, cw, ch, cw*0.1);
    const g = ctx.createLinearGradient(-cw/2, -ch/2, cw/2, ch/2);
    g.addColorStop(0, c0); g.addColorStop(1, c1); ctx.fillStyle = g; ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = cw*0.07; ctx.strokeStyle = '#ffe9a0'; ctx.stroke();
    // reflet holographique et étoile de promo
    ctx.globalAlpha = 0.45; ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.moveTo(-cw/2, ch*0.1); ctx.lineTo(cw/2, -ch*0.25); ctx.lineTo(cw/2, -ch*0.1); ctx.lineTo(-cw/2, ch*0.25); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    etincelle(ctx, 0, 0, cw*0.28, '#fffbe6');
    ctx.restore();
  }
}
function drawParcArt(ctx, x, y, w, h){
  // ciel et pelouse
  const ciel = ctx.createLinearGradient(0, y, 0, y + h);
  ciel.addColorStop(0, '#7cc8ff'); ciel.addColorStop(0.55, '#c9ecff'); ciel.addColorStop(0.56, '#62c46a'); ciel.addColorStop(1, '#1f7a36');
  ctx.fillStyle = ciel; ctx.fillRect(x, y, w, h);
  // arbres
  for(const [fx, fs] of [[0.10, 0.9], [0.24, 0.7], [0.88, 0.85]]){
    const tx = x + w*fx, ty = y + h*0.56, r = h*0.11*fs;
    ctx.fillStyle = '#6b3d1a'; ctx.fillRect(tx - r*0.18, ty - r*0.6, r*0.36, r*1.2);
    const g = ctx.createRadialGradient(tx - r*0.3, ty - r*1.5, r*0.2, tx, ty - r*1.2, r*1.3);
    g.addColorStop(0, '#7fe07a'); g.addColorStop(1, '#1f7a2e');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(tx, ty - r*1.2, r, 0, Math.PI*2); ctx.fill();
  }
  drawParkSign(ctx, x + w*0.80, y + h*0.30, Math.min(w, h)*0.20);
  drawPromoFan(ctx, x + w*0.42, y + h*0.30, Math.min(w, h)*0.42);
  drawCarIcon(ctx, x + w*0.46, y + h*0.76, w*0.46);
  for(const [fx, fy, fr] of [[0.62,0.12,0.03],[0.2,0.16,0.035],[0.68,0.46,0.028]])
    etincelle(ctx, x + w*fx, y + h*fy, Math.min(w,h)*fr);
}
function drawSpecialArt(ctx, x, y, w, h, rad, kind){
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 6;
  roundRectPath(ctx, x, y, w, h, rad); ctx.fillStyle = '#0b1334'; ctx.fill();
  ctx.restore();
  ctx.save(); roundRectPath(ctx, x, y, w, h, rad); ctx.clip();
  if(kind === 'prison') drawPrisonArt(ctx, x, y, w, h);
  else if(kind === 'chance') drawChanceArt(ctx, x, y, w, h);
  else if(kind === 'parc') drawParcArt(ctx, x, y, w, h);
  else drawChestArt(ctx, x, y, w, h);
  ctx.restore();
  roundRectPath(ctx, x, y, w, h, rad);
  ctx.lineWidth = 5; ctx.strokeStyle = goldLeafStroke(ctx, x, y, x+w, y+h); ctx.stroke();
}
function drawMedallion(ctx, x, y, w, h, rad, kind, accent){
  if(kind === 'chance' || kind === 'chest' || kind === 'prison' || kind === 'parc'){ drawSpecialArt(ctx, x, y, w, h, rad, kind); return; }
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 6;
  roundRectPath(ctx, x, y, w, h, rad); ctx.fillStyle = '#0b1334'; ctx.fill();
  ctx.restore();
  ctx.save(); roundRectPath(ctx, x, y, w, h, rad); ctx.clip();
  const gl = ctx.createRadialGradient(x+w/2, y+h/2, 10, x+w/2, y+h/2, Math.max(w,h)*0.6);
  gl.addColorStop(0, shadeHex(accent, -0.35) + ''); gl.addColorStop(1, '#0b1334');
  ctx.globalAlpha = 0.7; ctx.fillStyle = gl; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1;
  ctx.restore();
  const cx = x+w/2, cy = y+h/2, R = Math.min(w,h)*0.34;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI*2);
  const mg = ctx.createRadialGradient(cx - R*0.3, cy - R*0.35, R*0.1, cx, cy, R);
  mg.addColorStop(0, shadeHex(accent, 0.35)); mg.addColorStop(0.7, accent); mg.addColorStop(1, shadeHex(accent, -0.5));
  ctx.fillStyle = mg; ctx.shadowColor = accent; ctx.shadowBlur = 30; ctx.fill();
  ctx.shadowBlur = 0; ctx.lineWidth = 9; ctx.strokeStyle = goldLeafStroke(ctx, cx-R, cy-R, cx+R, cy+R); ctx.stroke();
  ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 10;
  if(kind === 'chance'){
    ctx.fillStyle = CASE_IVOIRE; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '700 '+(R*1.35)+'px Georgia,serif'; ctx.fillText('?', cx, cy + R*0.06);
  } else {
    drawVectorIcon(ctx, { chest:'gift', prison:'lock', visite:'unlock' }[kind] || 'gift', cx, cy, R*0.52, CASE_IVOIRE);
  }
  ctx.restore();
  roundRectPath(ctx, x, y, w, h, rad);
  ctx.lineWidth = 5; ctx.strokeStyle = goldLeafStroke(ctx, x, y, x+w, y+h); ctx.stroke();
}
/* Socle des gros lots : la carte photo flotte au-dessus, la case montre
   donc un piédestal — halo doré, anneau d'or en perspective, étincelles —
   et jamais une seconde fois la photo. */
function drawPedestal(ctx, x, y, w, h, rad){
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 6;
  roundRectPath(ctx, x, y, w, h, rad); ctx.fillStyle = '#0b1334'; ctx.fill();
  ctx.restore();
  ctx.save(); roundRectPath(ctx, x, y, w, h, rad); ctx.clip();
  const cx = x+w/2, cy = y+h*0.52;
  const gl = ctx.createRadialGradient(cx, cy, 10, cx, cy, w*0.55);
  gl.addColorStop(0, 'rgba(255,226,122,.55)'); gl.addColorStop(0.35, 'rgba(233,195,74,.18)'); gl.addColorStop(1, 'rgba(11,19,52,0)');
  ctx.fillStyle = gl; ctx.fillRect(x, y, w, h);
  for(const [k, a] of [[1, 0.9], [0.72, 0.55], [0.46, 0.35]]){
    ctx.beginPath(); ctx.ellipse(cx, cy, w*0.36*k, h*0.20*k, 0, 0, Math.PI*2);
    ctx.lineWidth = 7*k; ctx.strokeStyle = 'rgba(246,217,124,'+a+')'; ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,243,184,.85)';
  for(let k=0;k<18;k++){ const an = k*2.399, rr = 0.2 + (k*0.137)%0.8; ctx.beginPath();
    ctx.arc(cx + Math.cos(an)*w*0.42*rr, cy + Math.sin(an)*h*0.38*rr, 2.5 + (k%3)*1.5, 0, Math.PI*2); ctx.fill(); }
  ctx.restore();
  roundRectPath(ctx, x, y, w, h, rad);
  ctx.lineWidth = 5; ctx.strokeStyle = goldLeafStroke(ctx, x, y, x+w, y+h); ctx.stroke();
}
const WIN = { x:66, y:58, w:828, h:660, r:34 };
const NAME_Y0 = 736, NAME_Y1 = 908;
const flatFaceCache = new Map();
/* Cartes photo flottantes au-dessus des gros lots : GARDÉES — c'est ce qui
   les fait reconnaître de loin (retour de l'animateur). Pour qu'une case
   n'affiche jamais deux fois la même photo, la case sous une carte
   flottante montre un socle doré au lieu de la photo (sansPhoto). */
const SHOW_FLOAT_PHOTOS = true;
function getFlatPhotoFace(catKey, accentColor, badge, sansPhoto){
  const key = catKey+'|'+badge+'|'+(sansPhoto?1:0);
  if(flatFaceCache.has(key)) return flatFaceCache.get(key);
  const size = 960;
  const cvs = document.createElement('canvas'); cvs.width = cvs.height = size;
  const ctx = cvs.getContext('2d');
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  drawCaseBase(ctx, size);
  const accent = caseAccent(catKey);
  const img = LOT_IMAGES[catKey];
  if(img && sansPhoto) drawPedestal(ctx, WIN.x, WIN.y, WIN.w, WIN.h, WIN.r);
  else if(img) drawPhotoWindow(ctx, img, WIN.x, WIN.y, WIN.w, WIN.h, WIN.r);
  else drawMedallion(ctx, WIN.x, WIN.y, WIN.w, WIN.h, WIN.r, catKey, accent);
  if(badge){
    // « simple visite » : petit cadenas ouvert en coin de fenêtre
    ctx.save(); ctx.beginPath(); ctx.arc(WIN.x+70, WIN.y+70, 50, 0, Math.PI*2);
    ctx.fillStyle = '#0b1334'; ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = '#e9c34a'; ctx.stroke();
    drawVectorIcon(ctx, 'unlock', WIN.x+70, WIN.y+70, 26, CASE_IVOIRE); ctx.restore();
  }
  drawNameBlock(ctx, size, badge ? 'Simple visite' : CATS[catKey].label, accent, NAME_Y0, NAME_Y1);
  caseVernis(ctx, size);
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = getMaxAniso();
  flatFaceCache.set(key, tex);
  return tex;
}

/* Case d'angle en BILLET : un seul billet collector, incliné à 45° vers
   l'angle extérieur, qui porte l'UNIQUE photo du lot et son nom. Sous le
   billet : le socle commun, nu — aucune autre photo, aucune copie. */
function ticketPath(ctx, w, h, rad, ny, nr){
  ctx.beginPath();
  ctx.moveTo(rad, 0); ctx.lineTo(w-rad, 0); ctx.arcTo(w, 0, w, rad, rad);
  ctx.lineTo(w, ny-nr); ctx.arc(w, ny, nr, -Math.PI/2, Math.PI/2, true);
  ctx.lineTo(w, h-rad); ctx.arcTo(w, h, w-rad, h, rad);
  ctx.lineTo(rad, h); ctx.arcTo(0, h, 0, h-rad, rad);
  ctx.lineTo(0, ny+nr); ctx.arc(0, ny, nr, Math.PI/2, -Math.PI/2, true);
  ctx.lineTo(0, rad); ctx.arcTo(0, 0, rad, 0, rad);
  ctx.closePath();
}
/* Coin en DIAGONALE (23/09) : l'image de la case (photo ou dessin, avec son
   nom) est tournée de 45° vers le centre du plateau, comme les coins du
   Monopoly ; le haut regarde le milieu, le nom est dans l'angle extérieur.
   Le socle et sa bordure d'or restent droits ; l'image est réduite juste
   assez pour tenir dans le carré (les coins du contenu, qui ne sont que du
   fond bleu nuit, sont rognés par la bordure). */
const CORNER_DIAG_SCALE = 0.86;
function diagonalCornerFace(srcTex, ang){
  const src = srcTex.image;
  const size = 960;
  const cvs = document.createElement('canvas'); cvs.width = cvs.height = size;
  const ctx = cvs.getContext('2d');
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  drawCaseBase(ctx, size);
  ctx.save();
  roundRectPath(ctx, 44, 44, size-88, size-88, size*0.08); ctx.clip();
  ctx.translate(size/2, size/2); ctx.rotate(ang); ctx.scale(CORNER_DIAG_SCALE, CORNER_DIAG_SCALE);
  const m = 48, w = src.width - 2*m;
  ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 26;
  ctx.drawImage(src, m, m, w, w, -w/2, -w/2, w, w);
  ctx.restore();
  caseVernis(ctx, size);
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = getMaxAniso();
  return tex;
}
function getTicketFace(catKey, ang){
  const size = 960;
  const cvs = document.createElement('canvas'); cvs.width = cvs.height = size;
  const ctx = cvs.getContext('2d');
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  drawCaseBase(ctx, size);
  // étoiles d'or très discrètes sur le socle, visibles autour du billet
  ctx.save(); roundRectPath(ctx, 40, 40, size-80, size-80, size*0.1); ctx.clip();
  ctx.fillStyle = 'rgba(233,195,74,.22)';
  for(let k=0;k<26;k++){ const a = k*2.399, rr = 120 + (k*37)%330; ctx.beginPath(); ctx.arc(size/2 + Math.cos(a)*rr, size/2 + Math.sin(a)*rr, 3 + (k%3), 0, Math.PI*2); ctx.fill(); }
  ctx.restore();
  const accent = caseAccent(catKey);
  const W = 520, H = 760, rad = 34, ny = H*0.70, nr = 30;
  const T = document.createElement('canvas'); T.width = W; T.height = H;
  const t = T.getContext('2d');
  t.imageSmoothingEnabled = true; t.imageSmoothingQuality = 'high';
  ticketPath(t, W, H, rad, ny, nr); t.save(); t.clip();
  const iv = t.createLinearGradient(0, 0, W, H);
  iv.addColorStop(0, '#fbf5e4'); iv.addColorStop(1, '#eadcb6');
  t.fillStyle = iv; t.fillRect(0, 0, W, H);
  t.restore();
  // fenêtre photo, dans le billet
  const img = LOT_IMAGES[catKey];
  const px = 34, py = 34, pw = W - 68, ph = ny - 34 - 44;
  if(img) drawPhotoWindow(t, img, px, py, pw, ph, 22);
  else drawMedallion(t, px, py, pw, ph, 22, catKey, accent);
  // perforation
  t.save(); t.setLineDash([16, 12]); t.lineWidth = 4; t.strokeStyle = 'rgba(155,116,38,.75)';
  t.beginPath(); t.moveTo(nr + 14, ny); t.lineTo(W - nr - 14, ny); t.stroke(); t.restore();
  // talon : gemme, nom, marque
  t.save();
  drawGem(t, W/2, ny + 44, 15, accent);
  t.fillStyle = CASE_NAVY_HAUT; t.textAlign = 'center'; t.textBaseline = 'middle';
  drawFittedSerif(t, CATS[catKey].label, W/2, ny + (H-ny)*0.55, W*0.84, 58, 36, (H-ny)*0.52);
  t.font = '700 22px Georgia,serif'; t.fillStyle = '#9b7426';
  t.fillText('★  P I K A P O L Y  ★', W/2, H - 34);
  t.restore();
  // bord doré du billet
  ticketPath(t, W, H, rad, ny, nr);
  t.lineWidth = 12; t.strokeStyle = goldLeafStroke(t, 0, 0, W, H); t.stroke();
  // pose du billet, incliné, avec son ombre
  ctx.save();
  ctx.translate(size/2, size/2); ctx.rotate(ang);
  ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 34; ctx.shadowOffsetY = 12;
  ctx.drawImage(T, -W/2, -H/2);
  ctx.restore();
  caseVernis(ctx, size);
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = getMaxAniso();
  return tex;
}

/* Texture dédiée à la case "Départ" (case 1) : ni photo ni prix, pour
   qu'elle ne se lise jamais comme un lot — même dans le cas rare où
   une carte Chance ferait reculer un joueur jusque-là (le côté
   mécanique est bloqué séparément dans updateWinButton). */
let _departFace = null;
function getDepartFace(){
  if(_departFace) return _departFace;
  /* Même langage que toutes les cases : socle bleu nuit, bordure d'or,
     médaillon Poké Ball au lieu d'une photo (ce n'est pas un lot), accent
     bleu des cases spéciales. */
  const size = 960;
  const cvs = document.createElement('canvas'); cvs.width = cvs.height = size;
  const ctx = cvs.getContext('2d');
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  drawCaseBase(ctx, size);
  const accent = caseAccent('depart');
  const { x, y, w, h, r } = WIN;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 6;
  roundRectPath(ctx, x, y, w, h, r); ctx.fillStyle = '#0b1334'; ctx.fill();
  ctx.restore();
  ctx.save(); roundRectPath(ctx, x, y, w, h, r); ctx.clip();
  const gl = ctx.createRadialGradient(x+w/2, y+h/2, 10, x+w/2, y+h/2, w*0.6);
  gl.addColorStop(0, 'rgba(74,140,240,.45)'); gl.addColorStop(1, 'rgba(11,19,52,0)');
  ctx.fillStyle = gl; ctx.fillRect(x, y, w, h);
  ctx.restore();
  // Poké Ball cerclée d'or
  const cx = x+w/2, cy = y+h/2, R = h*0.34;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 20;
  ctx.beginPath(); ctx.arc(cx, cy, R, Math.PI, 0); ctx.fillStyle = '#e0413f'; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI); ctx.fillStyle = CASE_IVOIRE; ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#10183a'; ctx.fillRect(cx-R, cy-R*0.08, R*2, R*0.16);
  ctx.beginPath(); ctx.arc(cx, cy, R*0.3, 0, Math.PI*2); ctx.fillStyle = '#10183a'; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, R*0.19, 0, Math.PI*2); ctx.fillStyle = CASE_IVOIRE; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI*2); ctx.lineWidth = 9; ctx.strokeStyle = goldLeafStroke(ctx, cx-R, cy-R, cx+R, cy+R); ctx.stroke();
  ctx.restore();
  roundRectPath(ctx, x, y, w, h, r);
  ctx.lineWidth = 5; ctx.strokeStyle = goldLeafStroke(ctx, x, y, x+w, y+h); ctx.stroke();
  drawNameBlock(ctx, size, 'Départ', accent, NAME_Y0, NAME_Y1);
  caseVernis(ctx, size);
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
  } else if(kind==='chance' || kind==='chest' || kind==='prison' || kind==='parc'){
    /* Fond d'ombre doux + halo clair derrière le picto : sans bulle, il se
       perdait sur la case colorée juste en dessous. */
    const ombre = ctx.createRadialGradient(cx, cy, size*0.05, cx, cy, size*0.5);
    ombre.addColorStop(0, 'rgba(10,6,20,.72)'); ombre.addColorStop(0.6, 'rgba(10,6,20,.45)'); ombre.addColorStop(1, 'rgba(10,6,20,0)');
    ctx.fillStyle = ombre; ctx.fillRect(0, 0, size, size);
    const halo = ctx.createRadialGradient(cx, cy, size*0.05, cx, cy, size*0.34);
    halo.addColorStop(0, 'rgba(255,236,170,.35)'); halo.addColorStop(1, 'rgba(255,236,170,0)');
    ctx.fillStyle = halo; ctx.fillRect(0, 0, size, size);
    if(kind==='chance') drawGoldQuestion(ctx, cx, cy, size*0.74);
    else if(kind==='chest') drawChestIcon(ctx, cx, cy + size*0.06, size*0.66, false);
    else if(kind==='parc') drawCarIcon(ctx, cx, cy + size*0.02, size*0.74);
    else drawPadlock(ctx, cx, cy - size*0.10, size*0.56);
  } else if(kind==='chance'){
    drawGoldQuestion(ctx, cx, cy, size*0.80);          // plus de bulle : le « ? » seul, doré
  } else if(kind==='chest'){
    drawChestIcon(ctx, cx, cy + size*0.06, size*0.72, true);
  } else if(kind==='prison'){
    drawPadlock(ctx, cx, cy - size*0.10, size*0.62);
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
  // pastille bleu nuit cerclée d'or : posée sur le coin doré de la case
  ctx.beginPath(); ctx.arc(size/2, size/2, size*0.42, 0, Math.PI*2);
  ctx.fillStyle = CASE_NAVY_BAS; ctx.fill();
  ctx.lineWidth = size*0.07; ctx.strokeStyle = GOLD; ctx.stroke();
  ctx.font='700 '+(size*(n >= 10 ? 0.40 : 0.48))+'px Georgia,serif'; ctx.fillStyle=GOLD_BRIGHT;
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(String(n), size/2, size/2+3);
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
  /* antialias:false : avec l'EffectComposer, la scène est rendue dans
     une texture intermédiaire SANS multi-échantillonnage, et le canvas
     ne reçoit qu'un quad plein écran ; le MSAA du canvas ne lissait donc
     rien et coûtait un tampon plein écran de plus. Rendu identique. */
  renderer = new THREE.WebGLRenderer({ canvas, antialias:false, alpha:true, powerPreference:'high-performance' });
}catch(e){
  const fb = document.createElement('div');
  fb.className = 'gl-fallback';
  fb.textContent = "Impossible d'afficher le plateau 3D (WebGL indisponible sur cet appareil).";
  wrap.appendChild(fb);
  throw e;
}
/* 1,5x max : au-delà, l'image n'est pas visiblement plus nette sur un
   plateau de cette taille mais le flou lumineux coûte presque 2 fois plus
   (mesuré : bloom = ~17x le reste du rendu, proportionnel aux pixels). */
/* Filtrage anisotrope au maximum pour TOUTE texture créée à partir d'ici.
   Mesure faite dans le moteur : 179 textures sur 372 étaient en filtrage
   par défaut (anisotropie 1). Vue en perspective — et la caméra est
   désormais plus rasante — une case lointaine « bave » alors : sa photo et
   son nom deviennent flous dans la profondeur. Posé une fois ici, avant la
   création des textures, le réglage s'applique partout, y compris aux
   photos de lot chargées plus tard. Coût négligeable sur tout GPU récent. */
THREE.Texture.DEFAULT_ANISOTROPY = renderer.capabilities.getMaxAnisotropy();

/* Plafond de résolution 1.5 -> 2 (polish 22/09). Mesuré : sur un écran
   Retina (2x), le jeu se rendait à 1.5, soit 75 % de la finesse de l'écran,
   puis étiré — le flou « qualité standard » constaté sur la télé et
   l'iPhone. 2 couvre les écrans haute densité sans aller jusqu'à 3 (neuf
   fois les pixels du 1x : le flou lumineux ne suivrait pas sur téléphone).
   Si la machine peine, l'échelle de qualité automatique redescend d'elle-
   même. */
const DPR_MAX = Math.min(window.devicePixelRatio||1, 2);
/* Écran de diffusion (ordinateur, télé) : la RÉSOLUTION n'y baisse jamais
   (23/09, « la qualité baisse quand le jeu tourne »). Si la machine peine,
   l'échelle automatique coupe le flou lumineux, les ombres et la
   décoration (mode éco), jamais la finesse de l'image. Seuls téléphones et
   petits écrans gardent la baisse de résolution. */
const ECRAN_DIFFUSION = !(Math.min(window.innerWidth, window.innerHeight) <= 520
  || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || ''));
renderer.setPixelRatio(DPR_MAX);

/* ---------- Perte du contexte WebGL ----------
   Quand le GPU n'en peut plus (surchauffe, mémoire, onglet en arrière-
   plan), le navigateur retire le contexte WebGL : le plateau se fige ou
   devient noir et NE REVIENT JAMAIS tout seul. En plein direct, c'est le
   jeu qui « crashe ».
   On rend l'incident non fatal : on note que l'appareil a lâché (pour
   revenir en mode éco au rechargement, sinon il relâchera aussitôt), on
   prévient à l'écran, et on relance la page. La cagnotte, les totaux et
   les lots déjà décidés sont en mémoire du navigateur : la partie
   reprend, elle n'est pas perdue. */
const QSTICK_KEY = 'pika_q_forced';
renderer.domElement.addEventListener('webglcontextlost', (e)=>{
  // sans preventDefault, le navigateur ne proposera jamais de restaurer
  e.preventDefault();
  // horodaté : le mode éco imposé expire (voir QSTICK_TTL), il ne reste
  // plus figé à vie après UNE surchauffe
  if(!isDisplay){ try{ localStorage.setItem(QSTICK_KEY, String(Date.now())); }catch(err){} }
  const warn = document.createElement('div');
  warn.className = 'gl-fallback';
  warn.textContent = 'Affichage relancé en mode économie…';
  if(wrap) wrap.appendChild(warn);
  setTimeout(()=>location.reload(), 900);
}, false);
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
/* 1.45 cramait en blanc pur les cases claires (vu en capture : la case
   Depart et sa voisine perdaient tout detail) et voilait l'image entiere.
   Verifie en capture : a 1.12 (premier essai) tout le plateau virait au
   brun ; a 1.28 l'or restait terne et l'animateur a signale en direct que
   "le dore ne s'affiche plus". 1.42 est a un cheveu de la valeur d'origine
   (1.45) : l'or retrouve son eclat, et le peu de marge gagne suffit a ne
   plus cramer les cases claires en blanc pur. */
renderer.toneMappingExposure = 1.42;

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
   plat/mat quel que soit son "metalness". C'est le dégradé studio
   doré/noir dessiné ci-dessus — même ambiance que le plateau, aucun
   fichier HDRI à charger. INVISIBLE : pas de scene.background, la
   photo de fond de la page reste seule derrière le plateau.

   Rétabli le 22/09. Entre-temps l'or reflétait un ciel de nuit
   procédural (zénith indigo). Or un métal n'a pas de couleur propre :
   il prend celle de ce qu'il reflète, teintée de la sienne. Vu par la
   caméra en plongée, le liseré entre les cases renvoyait le haut de ce
   ciel — bleu nuit — et l'or virait au bronze sourd. L'animateur a
   réclamé le retour de ce « reflet de feuille d'or » : il vient
   d'ici, d'un environnement CHAUD, et de rien d'autre. */
{
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  pmremGenerator.compileEquirectangularShader();
  const studio = makeStudioBackdrop();
  const envRT = pmremGenerator.fromEquirectangular(studio);
  scene.environment = envRT.texture;
  pmremGenerator.dispose();
  studio.dispose();
}


/* Décor 3D ajouté autour du plateau (rochers, dragon, anneaux d'or) :
   ENTIÈREMENT RETIRÉ, à la demande de l'animateur. La photo de fond porte
   déjà cet univers, et bien mieux — les anneaux d'or qu'elle contient sont
   les siens. Ne subsiste de cette passe que ce qui touche la MATIÈRE :
   l'environnement de reflets ci-dessus, invisible, qui donne à l'or du
   plateau et au personnage quelque chose de riche à refléter. */

/* Dérive du monde : lente, continue, jamais spectaculaire. Ce qui doit
   attirer l'oeil reste le plateau ; le monde, lui, respire. */
/* ---------- Ombre de contact sous le pion ----------
   La carte d'ombre donne une ombre PORTÉE, douce, qui se dilue justement
   sous les pieds — or c'est là que l'oeil cherche la preuve que le
   personnage TOUCHE la surface. Un disque de contact serré est ajouté au
   point d'appui : c'est ce qui fait basculer la lecture de « collé devant
   le plateau » à « posé dessus ». Il suit le pion à chaque image et,
   quand celui-ci saute, s'élargit en s'effaçant — une ombre de contact
   perd son bord net dès qu'on décolle.
   fog:false et toneMapped:false : c'est un artifice d'ancrage, pas un
   objet de la scène. */
const contactShadow = (() => {
  const S = 128;
  const cvs = document.createElement('canvas'); cvs.width = cvs.height = S;
  const c = cvs.getContext('2d');
  const g = c.createRadialGradient(S/2, S/2, 0, S/2, S/2, S/2);
  g.addColorStop(0.00, 'rgba(0,0,0,0.82)');
  g.addColorStop(0.40, 'rgba(0,0,0,0.44)');
  g.addColorStop(0.76, 'rgba(0,0,0,0.10)');
  g.addColorStop(1.00, 'rgba(0,0,0,0)');
  c.fillStyle = g; c.fillRect(0,0,S,S);
  const tex = new THREE.CanvasTexture(cvs);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1,1),
    new THREE.MeshBasicMaterial({ map:tex, transparent:true, depthWrite:false,
                                  fog:false, toneMapped:false })
  );
  mesh.rotation.x = -Math.PI/2;
  mesh.renderOrder = 2;          // après la case, avant le pion
  mesh.visible = false;
  scene.add(mesh);
  return mesh;
})();

function updateContactShadow(){
  if(typeof player !== 'undefined' && player && player.root && player.root.parent){
    const P = player.root.position;
    // hauteur du pion au-dessus de sa case : plus il monte, plus l'ombre
    // s'élargit et s'efface
    const solY = (typeof tiles !== 'undefined' && tiles[currentIndex] && tiles[currentIndex].tileTopY !== undefined)
      ? tiles[currentIndex].tileTopY : 0.14;
    const h = Math.max(0, P.y - solY);
    const k = Math.min(1, h/1.6);
    const taille = 0.78 * (1 + k*0.85);
    contactShadow.position.set(P.x, solY + 0.012, P.z);
    contactShadow.scale.set(taille, taille, 1);
    contactShadow.material.opacity = (1 - k*0.72) * 0.92;
    contactShadow.visible = player.root.visible !== false;
  } else {
    contactShadow.visible = false;
  }
}

const BASE_FOV = 40;
const camera = new THREE.PerspectiveCamera(BASE_FOV,1,0.1,260);
/* Caméra abaissée : 51° au-dessus du plateau -> 35°. Une plongée à 51°
   écrase la perspective et donne la "photo de boîte de jeu" ; à 35° les
   cases fuient vers un point de fuite, le pion prend de la hauteur dans le
   cadre et le monde derrière se déploie. Pas plus bas : l'animateur doit
   garder les 40 cases lisibles d'un coup d'oeil, ce qu'un plan au ras du
   plateau (comme les jeux de casino, qui n'ont pas cette contrainte)
   interdirait. Distance inchangée (~16,6), donc le cadrage et les butées
   Distance portée de 17,4 à 18,6 : à angle abaissé le bord proche du
   plateau avance dans le cadre et se faisait rogner (vérifié en rendu).
   Reculer rend aussi sa place au ciel, qui n'est plus un liseré.
   far 100 -> 260 : le dragon et la couronne lointaine de rochers sont à
   plus de 100 unités et étaient purement et simplement coupés. */
camera.position.set(0,11.2,15.8);
scene.add(camera);

/* Post-traitement bloom : fait "exploser" en halo lumineux tout ce qui
   dépasse le seuil de luminosité (or émissif, sprites de gain, effets
   additifs de célébration) sans toucher au reste de la scène — c'est
   ce qui donne le rendu "jeu télévisé haut de gamme" au lieu d'un
   rendu plat. Seuil assez haut pour ne pas baver sur les textures
   photo/couleurs normales. */
/* Anticrenelage : cible de rendu MULTI-ECHANTILLONNEE (MSAA materiel),
   et non plus une passe FXAA.

   Le rendu passe par l'EffectComposer, donc antialias:true sur le
   WebGLRenderer ne sert a rien : la scene est dessinee dans une cible hors
   ecran. Un premier correctif avait ajoute une passe FXAA, qui lisse bien
   les aretes — mais FXAA est un anticrenelage PAR FLOU : il adoucit tout ce
   qui presente des contrastes fins, donc en premier lieu le texte et les
   photos de lot posees sur les cases. Compare en capture avant/apres, le
   nom de la case passait de parfaitement lisible a illisible. Inacceptable.

   EffectComposer accepte une cible de rendu fournie par l'appelant : on lui
   en donne une avec samples:4, ce qui active le multi-echantillonnage
   materiel de WebGL2. Les aretes sont lissees par le GPU au moment du
   rendu, sans jamais toucher a l'interieur des surfaces — donc les textures
   restent parfaitement nettes. */
/* Le nombre d'echantillons est fixe a la creation (on ne peut pas le
   changer sans recreer la cible), donc on le decide sur le profil de
   l'appareil et non sur la cadence mesuree : 4x sur un ecran de
   diffusion, 0 sur telephone ou petit ecran ou le MSAA couterait plus
   cher que ce qu'il apporte. */
const _msaaFaible = (Math.min(window.innerWidth, window.innerHeight) <= 520)
                 || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
const msaaTarget = new THREE.WebGLRenderTarget(1, 1, {
  type: THREE.HalfFloatType,
  /* 2 et non 4 : mesure faite, en 1920x1080 une cible RGBA16F multi-
     echantillonnee x4 occupe 116 Mo et demande 5 Go/s de bande passante
     rien que pour resoudre le tampon a chaque image — 261 Mo et 11 Go/s
     quand une tele 1080p est pilotee par un portable haute densite. Sur
     un GPU integre c'est 10 a 45 % de TOUTE la bande passante memoire de
     la machine. A 2 echantillons la facture est divisee par deux et la
     difference sur les aretes ne se voit pratiquement pas. */
  samples: _msaaFaible ? 0 : 2,
});
const composer = new EffectComposer(renderer, msaaTarget);
composer.addPass(new RenderPass(scene, camera));
/* Seuil de bloom : 0.80, et surtout PAS plus haut.

   Mesure faite sur la chaine reelle (ACES + toneMappingExposure, puis
   LuminosityHighPassShader qui analyse des valeurs LINEAIRES dans la cible
   HalfFloat du composer) : le pixel le plus clair physiquement possible,
   du blanc pur, ne sort qu'a 0.8356 a l'exposition 1.42. Le seuil de 0.90
   pose au commit 4cc69a6 etait donc AU-DESSUS DU PLAFOND DU RENDU : plus
   rien d'opaque ne bloomait, sur toute la scene. C'est ca, le "le dore ne
   s'affiche plus" — l'or n'a jamais franchi le seuil lui-meme (luminance
   0.20), c'est le halo des zones claires qui l'enveloppait et le faisait
   lire comme brillant.

   Un premier correctif a 0.83 ne laissait que 0.0056 de marge, soit 56 %
   du bloom d'origine. A 0.80 la marge vaut 3,5 largeurs de transition et
   le halo retrouve exactement son intensite d'avant. */
const bloomPass = new UnrealBloomPass(new THREE.Vector2(1,1), 0.55, 0.4, 0.80);
composer.addPass(bloomPass);

/* Garde-fou anti-rognage des coins : au lieu d'un recul de caméra
   fixe (qui rapetissait tout le plateau en permanence, y compris de
   face où ce n'était pas nécessaire), on élargit le champ de vision
   au fil de la rotation UNIQUEMENT le strict minimum requis pour que
   les 4 coins restent visibles sous l'angle courant, et on revient à
   BASE_FOV dès que l'angle redevient sûr (vue de face par défaut =
   plateau au maximum, comme avant). */
const BOARD_CORNER_R = (N_SIDE*CELL)/2 + 0.15;
/* Hauteur d'échantillonnage 0.5 (le dessus des cases) et marge de 7 %.
   Un essai du 21/09 était monté à 1.45 et 13 %, pour ne pas rogner les
   photos de lot flottantes — réglé à l'aveugle : le garde-fou recevait
   alors dt = 0 et ne bougeait jamais le champ (voir animate()). Une fois
   réparé, ces valeurs rapetissaient le plateau d'un quart en permanence.
   Retour aux valeurs d'origine, éprouvées. Les milieux de bords restent
   échantillonnés : de trois quarts, c'est parfois eux qui sortent en
   premier. */
const _CORNER_Y = 0.5;
const boardCorners = [];
for(const [cx,cz] of [[-1,-1],[1,-1],[1,1],[-1,1],[0,-1],[0,1],[-1,0],[1,0]]){
  boardCorners.push(new THREE.Vector3(cx*BOARD_CORNER_R, _CORNER_Y, cz*BOARD_CORNER_R));
}
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
  const targetFov = THREE.MathUtils.clamp(
    THREE.MathUtils.radToDeg(2*Math.atan(maxTan/0.93)),
    BASE_FOV, 76
  );
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt*6);
  camera.updateProjectionMatrix();
}

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0,0.3,0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 10.5;
controls.maxDistance = 24;
controls.minPolarAngle = 0.35;
controls.maxPolarAngle = 1.15;
controls.enablePan = false;
controls.autoRotate = !reduceMotion;
controls.autoRotateSpeed = 0.55;

/* ---------- Cadrage caméra selon la forme du cadre ----------
   Le cadre 3D change de forme selon l'écran (téléphone en portrait, écran
   large, colonne centrale du mode TV) et PEUT changer en cours de route :
   fenêtre redimensionnée, passage en plein écran, écran externe branché.
   Le cadrage est donc recalculé à chaque redimensionnement (resize()),
   pas seulement au chargement.
   - Portrait (téléphone) : on recule partiellement (racine, plafonnée),
     le plateau reste grand quitte à rogner un peu les coins extrêmes.
   - Écran large (cadre 3:2 etc.) : on rapproche jusqu'à x0,76.
   - Cadre presque carré (mode TV, plateau entre deux colonnes) : on
     rapproche (x0,84) et on passe un peu plus en plongée, pour que le
     plateau remplisse la hauteur au lieu de laisser du ciel au-dessus.
   Le garde-fou anti-rognage des coins (updateCornerSafety) élargit le
   champ si un coin devait sortir : les 4 coins restent toujours visibles. */
/* Plongée abaissée sur les trois cadrages (21/09). C'est ICI que la
   position de la caméra est réellement décidée : fitCameraToAspect()
   recalcule camera.position à partir de ces directions à chaque
   redimensionnement, donc un camera.position.set() au chargement est
   écrasé quelques millisecondes plus tard — mesuré à la sonde, la caméra
   se retrouvait à 59° de plongée alors qu'on l'avait posée à 35°.
   50°->39° (défaut) et 59°->46° (cadre carré, le mode télé) : les cases
   fuient vers un point de fuite au lieu d'être écrasées vues de dessus,
   et il reste enfin du ciel au-dessus du bord lointain — c'est cette
   bande-là qui donne sa place au monde. */
const CAM_DIR_DEFAULT = new THREE.Vector3(0, 10.5, 13.0).normalize();  // 39° de plongée
const CAM_DIR_SQUARE  = new THREE.Vector3(0, 12.0, 11.5).normalize();  // 46°, cadre presque carré
/* Cadre plus haut que large mais pas étroit (télé posée en portrait) :
   vue nettement plus en plongée, le plateau projeté devient presque
   carré et remplit la largeur ET la hauteur du cadre au lieu de laisser
   un grand ciel au-dessus. */
const CAM_DIR_TALL    = new THREE.Vector3(0, 14.0, 9.0).normalize();   // 57°, télé en portrait
const CAM_BASE_MIN = controls.minDistance, CAM_BASE_MAX = controls.maxDistance;
const CAM_BASE_DIST = camera.position.distanceTo(controls.target);   // distance de la vue d'origine (cadre carré)
let camFitFactor = 1, camFitMode = 'default';
// état de la caméra cinématique (défini ici car le cadrage le consulte dès le chargement)
let cineMode = null, cineBlend = 0;
function aspectFitMode(a){
  if(a >= 0.95 && a <= 1.15) return 'square';
  if(a >= 0.74 && a < 0.95) return 'tall';
  return 'default';
}
function aspectFitFactor(a){
  const mode = aspectFitMode(a);
  if(mode === 'square') return 0.84;
  if(mode === 'tall') return 0.90;
  if(a < 1) return Math.min(Math.pow(1/a, 0.38), 1.6);
  if(a > 1.15) return Math.max(0.76, Math.pow(1/a, 0.70));
  return 1;
}
function fitCameraToAspect(){
  const a = wrap.clientWidth / wrap.clientHeight;
  if(!(a > 0)) return;
  const f = aspectFitFactor(a);
  const mode = aspectFitMode(a);
  const k = f / camFitFactor;
  const modeChanged = mode !== camFitMode;
  if(Math.abs(k - 1) < 1e-3 && !modeChanged) return;
  camFitFactor = f; camFitMode = mode;
  controls.minDistance = CAM_BASE_MIN * f;
  controls.maxDistance = CAM_BASE_MAX * f;
  // Pendant une séquence cinéma (marche, gros plan, orage) la caméra est
  // pilotée ailleurs : on ne touche qu'aux bornes, la vue plateau sera
  // recadrée au retour.
  if(cineMode !== null || cineBlend > 0.001) return;
  // Distance ABSOLUE (vue d'origine × facteur), pas un cumul de ratios :
  // une suite de redimensionnements (télé tournée, plein écran, fenêtre
  // déplacée) redonne toujours exactement le même cadrage.
  const dist = CAM_BASE_DIST * f;
  // clone : les directions de référence sont partagées, multiplyScalar
  // les modifierait en place (cadrage faux au 2e changement de mode)
  const dir = (modeChanged ? (mode === 'square' ? CAM_DIR_SQUARE : mode === 'tall' ? CAM_DIR_TALL : CAM_DIR_DEFAULT)
                           : camera.position.clone().sub(controls.target).normalize()).clone();
  camera.position.copy(controls.target).add(dir.multiplyScalar(dist));
  controls.update();
}
fitCameraToAspect();
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
const hemiLight = new THREE.HemisphereLight(0xffdca0, 0x141c33, 0.68);
scene.add(hemiLight);

/* Petit projecteur chaud au-dessus du centre du plateau : la légende
   des lots (photos + texte) doit rester bien lisible, pas juste
   éclairée par la lumière ambiante générale. */
const centerSpot = new THREE.PointLight(0xffe9c2, 0.7, 9, 2);
centerSpot.position.set(0, 3.2, 0);
scene.add(centerSpot);

const key = new THREE.DirectionalLight(0xfff2df, 1.15);
key.position.set(4.2,7,3.4);
key.castShadow = true;
/* Ombre portée (polish 22/09). Mesuré : 1024 px sur une zone de 14 unités,
   soit 73 px par unité — l'ombre du personnage tenait en une vingtaine de
   pixels, une tache floue sans forme. Deux leviers :
     - zone resserrée au plateau (12,8 au lieu de 14 : le plateau fait 10,
       la marge couvre les lots flottants et le pion en bord de case) ;
     - carte 2048 sur écran de diffusion, 1024 sur téléphone.
   Résultat : 160 px par unité, 2,2 fois plus net — l'ombre prend enfin la
   silhouette du personnage. */
{
  const _mobile = (Math.min(window.innerWidth, window.innerHeight) <= 520)
               || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  const S = _mobile ? 1024 : 2048;
  key.shadow.mapSize.set(S, S);
}
key.shadow.camera.left = -6.4; key.shadow.camera.right = 6.4;
key.shadow.camera.top = 6.4; key.shadow.camera.bottom = -6.4;
key.shadow.camera.near = 1; key.shadow.camera.far = 20;
/* bias -0.0025 -> -0.0004 + normalBias 0.018. Un bias négatif fort DÉCOLLE
   l'ombre de l'objet qui la projette (« peter-panning ») : l'ombre commençait
   à distance des pieds, et c'est précisément ce vide que l'oeil lit comme
   un personnage qui flotte — la mesure confirme que les semelles, elles,
   touchent la case. Le normalBias traite l'acné d'ombre en décalant le long
   de la normale, sans détacher l'ombre de son point de contact. */
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.018;
scene.add(key);

/* Contre-jour aligné sur le SOLEIL DE LA PHOTO DE FOND (polish 22/09).
   L'illustration derrière le plateau a une source de lumière évidente : un
   soleil doré posé sur l'horizon, au centre, derrière la scène. Le contre-
   jour du jeu, lui, venait de l'arrière-GAUCHE et restait faible (0,55) :
   le plateau et le personnage étaient éclairés par un autre ciel que celui
   qu'on voit derrière eux — c'est l'une des raisons pour lesquelles ils
   semblaient posés sur l'image plutôt que dedans.
   Recentré derrière et légèrement relevé, porté à 0,78 : l'arête haute des
   cases et la silhouette du personnage attrapent un liseré doré qui vient
   du même endroit que la lumière du décor. Pas de nouvelle source : on
   corrige la direction d'une lumière existante. */
const rim = new THREE.DirectionalLight(0xffcf6b, 0.78);
rim.position.set(0.8,3.2,-7);
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
  /* Halo du projecteur retiré à la demande de l'animateur : vu de biais,
     ce grand disque additif tombait devant le plateau et faisait un
     contre-jour. La lumière (PointLight) reste. */
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

/* Points lumineux (loupiotes du pourtour, loupiotes qui tournent,
   poussière dorée d'ambiance, halos sous les lots flottants) : retirés à
   la demande de l'animateur — ils passaient devant le plateau et les
   lots et faisaient un effet de contre-jour. Remettre à true pour les
   retrouver. */
const SHOW_GLOW_POINTS = false;

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
    spr.visible = SHOW_GLOW_POINTS;
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
  spr.visible = SHOW_GLOW_POINTS;
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
// Chances (en %) de chaque lot par partie, affichées à droite de sa
// ligne. Remplies plus bas à partir de la recette réelle du cycle
// (POUCH), puis la plaque est redessinée : une seule source
// de vérité, jamais un chiffre retapé à la main.
let LOT_ODDS_PCT = null;
/* Affichage public des chances : désactivé à la demande de l'animateur
   (les joueurs ne doivent pas voir le pourcentage de chaque lot). Les
   chances restent calculées (simulation, réglages), juste pas dessinées :
   ni sur la plaque centrale, ni dans la légende télé. */
const SHOW_ODDS = false;
function fmtOddsPct(p){
  if(!SHOW_ODDS || p==null) return '';
  const s = p >= 10 ? String(Math.round(p)) : p.toFixed(1).replace('.', ',');
  return s + ' %';
}
/* Pochette PERSONNALISÉE (version 99 coups, 24/09) : posée par build.py
   (--pochette99) dans window.PIKA_POCHETTE = { taille, lots:{cat:n}, myst:{carte,booster} }.
   Sans elle, la pochette standard de 245 coups. */
const POCHETTE_PERSO = window.PIKA_POCHETTE || null;
const TAILLE_POCHETTE = POCHETTE_PERSO ? POCHETTE_PERSO.taille : 245;
const CENTER_LEGEND_ROWS = [
  {swatch:'jackpot', catKey:'jackpot300'},
  {swatch:'orange',  catKey:'etb'},
  {swatch:'rose',    catKey:'booster50'},
  {swatch:'teal',    catKey:'gradee'},
  {swatch:'blue',    catKey:'booster8'},
  {swatch:'red',     catKey:'alternative'},
  {swatch:'bronze',  catKey:'commune'},
];
/* Finition des sept barres de la plaque centrale (et d'elles seules : les
   cases gardent SWATCH_COLORS). Les trois premiers lots sont en MÉTAL —
   or, argent, bronze : bandes claires/sombres qui imitent un reflet — les
   quatre suivants en néon vif. `bord` = dégradé vertical du contour épais,
   `halo` = lueur autour du bord, `vif` = teinte de la barre d'accent. */
const LEGEND_FINISH = {
  jackpot300:  { metal:true, bord:['#fff7cf','#ffd54a','#a8740a','#ffe27a','#7a4d00'], halo:'#ffc83a', vif:'#ffd54a' },
  etb:         { metal:true, bord:['#ffffff','#e3e9f1','#8792a3','#f5f8ff','#566273'], halo:'#e4eeff', vif:'#dfe6ee' },
  booster50:   { metal:true, bord:['#ffd9ae','#e58f4a','#7e421a','#f3ad6c','#57290c'], halo:'#ff8f3c', vif:'#e58f4a' },
  gradee:      { bord:['#c9fffa','#22f0de','#0aa99c'], halo:'#14e6d4', vif:'#22f0de' },
  booster8:    { bord:['#c2ddff','#2a8bff','#0d4fc4'], halo:'#2a86ff', vif:'#2a8bff' },
  alternative: { bord:['#ffc2c8','#ff2a40','#b0101f'], halo:'#ff1f36', vif:'#ff2a40' },
  commune:     { bord:['#f6d2ff','#c04cff','#7a1fc4'], halo:'#b847ff', vif:'#c04cff' },
};
// Chance / Caisse Communautaire : pas des lots, juste deux petits
// badges compacts (icône + nom) sous l'en-tête, bien visibles sans
// prendre la place d'une ligne de lot.
/* Mode TV : la même liste que la plaque, en HTML dans la colonne de
   gauche (grande, lisible à plusieurs mètres). Une seule source de
   vérité : libellés CATS, photos LOT_IMAGE_URLS, chances LOT_ODDS_PCT. */
function renderTvLegend(){
  const el = document.getElementById('tvLegend');
  if(!el) return;
  el.innerHTML = '';
  CENTER_LEGEND_ROWS.forEach(r=>{
    const def = CATS[r.catKey]; if(!def) return;
    const row = document.createElement('div');
    row.className = 'tv-lot';
    row.style.setProperty('--c', SWATCH_COLORS[r.swatch] || '#e9c34a');
    const img = document.createElement('img'); img.src = LOT_IMAGE_URLS[r.catKey] || ''; img.alt = '';
    const name = document.createElement('div'); name.className = 'name'; name.textContent = def.label;
    const pct = document.createElement('div'); pct.className = 'pct'; pct.textContent = fmtOddsPct(LOT_ODDS_PCT ? LOT_ODDS_PCT[r.catKey] : null);
    row.appendChild(img); row.appendChild(name); row.appendChild(pct);
    el.appendChild(row);
  });
}
const CENTER_LEGEND_BADGES = [
  {swatch:'purple', icon:'question', title:'Chance'},
  {swatch:'green',  icon:'gift',     title:'Caisse'},
];
function makeCenterPlateTexture(){
  // grand écran (télé) : texture plus fine, la plaque y est affichée bien plus grande
  const size = Math.max(window.screen.width||0, window.screen.height||0) >= 1600 ? 1400 : 900;
  const cvs = document.createElement('canvas'); cvs.width=cvs.height=size;
  const ctx = cvs.getContext('2d');
  /* PAS de panneau plein : le sol du plateau reste transparent jusqu'au
     centre et la photo de fond doit se voir au travers — c'est l'effet
     « verre 3D » qui fait tout le cachet de la plaque. Un essai de panneau
     opaque (commit 4cc69a6) a bien réglé la lisibilité mais en tuant
     l'effet : on le retire.

     La lisibilité est donc reconstruite autrement, comme dans un HUD de
     jeu haut de gamme : jamais un rectangle plein, mais un écran sombre
     LOCAL sous chaque élément, plus un halo épais autour des glyphes.
     Entre deux lignes, et tout autour, la photo reste pleinement visible. */

  /* Halo sombre multi-passes : une seule ombre portée ne suffit pas sur un
     fond de nuages clairs. On repasse le même tracé plusieurs fois pour
     accumuler l'opacité du halo sans épaissir le glyphe lui-même. */
  function haloText(txt, x, y, passes, blur){
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.92)';
    ctx.shadowBlur = blur;
    // Remplissage NOIR OPAQUE, et pas un noir quasi transparent : l'ombre
    // portée du canvas hérite de l'alpha de la source, donc un fill à .001
    // produit un halo à .001 — c'est-à-dire rien du tout (premier essai).
    // Le glyphe noir pose le halo ; il est ensuite intégralement recouvert
    // par le vrai texte, dessiné au même endroit juste après.
    ctx.fillStyle = '#000';
    for(let i=0;i<passes;i++) ctx.fillText(txt, x, y);
    ctx.restore();
  }
  /* Écran local doux, sans bord net : une ellipse en dégradé radial qui
     s'éteint complètement avant ses limites. Sert de support aux éléments
     qui n'ont pas de pastille à eux (titre, sous-titre, badges, pied). */
  function softScrim(cx, cy, rx, ry, alpha){
    ctx.save();
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 1);
    g.addColorStop(0,    'rgba(4,6,12,'+alpha+')');
    g.addColorStop(0.55, 'rgba(4,6,12,'+(alpha*0.78)+')');
    g.addColorStop(1,    'rgba(4,6,12,0)');
    ctx.translate(cx, cy); ctx.scale(rx, ry); ctx.translate(-cx, -cy);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, 1, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }
  // support du bandeau de tête (Pokeball + titre + sous-titre + badges)
  softScrim(size/2, size*0.195, size*0.40, size*0.155, 0.62);
  // support du pied de page
  softScrim(size/2, size*0.945, size*0.20, size*0.040, 0.60);

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
  // halo SOMBRE d'abord (détachement du fond), halo doré ensuite (chaleur) :
  // l'ancien ne posait que le doré, qui ne détache de rien sur un ciel clair
  ctx.fillStyle = GOLD_BRIGHT;
  haloText('PIKAPOLY', size/2, size*0.185, 6, size*0.020);
  ctx.shadowColor='rgba(255,210,110,.7)'; ctx.shadowBlur=size*0.01;
  ctx.fillStyle = GOLD_BRIGHT;
  ctx.fillText('PIKAPOLY', size/2, size*0.185);
  ctx.shadowBlur = 0;

  // en-tête de la légende — ombre sombre pour rester lisible sur
  // n'importe quel fond de photo, sans panneau derrière
  ctx.font='800 '+(size*0.031)+'px Arial,Helvetica,sans-serif';
  ctx.fillStyle = GOLD_BRIGHT;
  haloText('★ TOUS LES LOTS À GAGNER ★', size/2, size*0.235, 6, size*0.017);
  ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = size*0.012;
  ctx.fillStyle = GOLD_BRIGHT;
  ctx.fillText('★ TOUS LES LOTS À GAGNER ★', size/2, size*0.235);
  ctx.shadowBlur = 0;

  // Chance / Caisse : deux petits badges compacts côte à côte (pas
  // des lots, pas de ligne dédiée) — icône dans un rond + nom court.
  const badgeY = size*0.29, badgeR = size*0.024, badgeGap = size*0.22;
  // Les deux badges tombent en bordure de l'écran de tête, là où il s'est
  // déjà éteint : ils ont besoin de leur propre support, sinon leur libellé
  // doré se perd dans les nuages clairs (vérifié en capture).
  softScrim(size/2 - badgeGap/2 + badgeR, badgeY, size*0.115, size*0.042, 0.66);
  softScrim(size/2 + badgeGap/2 + badgeR, badgeY, size*0.115, size*0.042, 0.66);
  CENTER_LEGEND_BADGES.forEach((b,i)=>{
    const bx = size/2 + (i===0 ? -1 : 1)*badgeGap/2;
    const color = SWATCH_COLORS[b.swatch];
    ctx.save();
    ctx.shadowColor = color; ctx.shadowBlur = size*0.016;
    ctx.beginPath(); ctx.arc(bx,badgeY,badgeR,0,Math.PI*2);
    ctx.fillStyle = '#0c0f16'; ctx.fill();
    ctx.restore();
    // mêmes pictos que les cases (« ? » doré, coffre au trésor)
    if(b.icon==='question') drawGoldQuestion(ctx, bx, badgeY, badgeR*1.55);
    else drawChestIcon(ctx, bx, badgeY + badgeR*0.12, badgeR*1.35, false);
    ctx.lineWidth = size*0.0045; ctx.strokeStyle = color;
    ctx.beginPath(); ctx.arc(bx,badgeY,badgeR,0,Math.PI*2); ctx.stroke();
    ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.font='900 '+(size*0.027)+'px Arial,Helvetica,sans-serif';
    ctx.fillStyle = GOLD_BRIGHT;
    haloText(b.title, bx+badgeR*1.5, badgeY+size*0.001, 5, size*0.014);
    ctx.fillStyle = GOLD_BRIGHT;
    ctx.fillText(b.title, bx+badgeR*1.5, badgeY+size*0.001);
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
    // Écran sombre LOCAL, limité à la ligne : dégradé vertical qui
    // s'éclaircit aux bords haut/bas, de sorte que la pastille se fonde
    // dans la photo au lieu d'y poser un rectangle. Entre deux lignes, le
    // fond reste totalement transparent — l'effet verre est préservé.
    ctx.save();
    roundRectPath(ctx, rowX, y, rowW, rh, rh*0.22);
    const rg = ctx.createLinearGradient(0, y, 0, y+rh);
    rg.addColorStop(0,    'rgba(4,6,12,.42)');
    rg.addColorStop(0.18, 'rgba(4,6,12,.76)');
    rg.addColorStop(0.82, 'rgba(4,6,12,.76)');
    rg.addColorStop(1,    'rgba(4,6,12,.42)');
    ctx.fillStyle = rg; ctx.fill();
    ctx.restore();
    // intérieur : léger reflet en haut, comme une plaque vernie
    ctx.save();
    roundRectPath(ctx, rowX, y, rowW, rh, rh*0.22); ctx.clip();
    const gloss = ctx.createLinearGradient(0, y, 0, y+rh*0.5);
    gloss.addColorStop(0, 'rgba(255,255,255,.10)'); gloss.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gloss; ctx.fillRect(rowX, y, rowW, rh*0.5);
    ctx.restore();
    /* Contour épais et net + lueur contrôlée : deux passes d'ombre colorée
       (une serrée, très vive au ras du bord, une large et douce) sous un
       trait plein en dégradé. Le bord reste net, la lueur s'estompe. */
    const fin = LEGEND_FINISH[r.catKey] || { bord:[color, color], halo:color, vif:color };
    const bordGrad = ctx.createLinearGradient(0, y, 0, y+rh);
    fin.bord.forEach((c, k)=> bordGrad.addColorStop(k/(fin.bord.length-1), c));
    const bw = size*0.0085;
    for(const [blur, alpha] of [[size*0.030, 0.55], [size*0.012, 0.95]]){
      ctx.save();
      roundRectPath(ctx, rowX, y, rowW, rh, rh*0.22);
      ctx.shadowColor = fin.halo; ctx.shadowBlur = blur;
      ctx.globalAlpha = alpha; ctx.lineWidth = bw; ctx.strokeStyle = fin.halo;
      ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    roundRectPath(ctx, rowX, y, rowW, rh, rh*0.22);
    ctx.lineWidth = bw; ctx.strokeStyle = bordGrad; ctx.stroke();
    // relief : filet clair sur l'arête haute, filet sombre à l'intérieur
    ctx.lineWidth = size*0.0018;
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    roundRectPath(ctx, rowX+bw*0.62, y+bw*0.62, rowW-bw*1.24, rh-bw*1.24, rh*0.22-bw*0.62); ctx.stroke();
    ctx.beginPath(); ctx.rect(rowX, y-bw, rowW, rh*0.42); ctx.clip();
    ctx.strokeStyle = fin.metal ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.6)';
    roundRectPath(ctx, rowX+bw*0.18, y+bw*0.18, rowW-bw*0.36, rh-bw*0.36, rh*0.22); ctx.stroke();
    ctx.restore();
    ctx.save();
    roundRectPath(ctx, rowX, y, rowW, rh, rh*0.22);
    ctx.clip();
    ctx.fillStyle = bordGrad;
    ctx.fillRect(rowX, y, rh*0.14, rh);
    ctx.restore();

    // médaillon : vraie photo du lot si dispo, sinon icône dans un
    // rond de la couleur de la catégorie — avec halo lumineux
    const dotR = rh*0.38, dotX = rowX + rh*0.66, dotY = y + rh*0.5;
    ctx.save();
    ctx.shadowColor = fin.halo; ctx.shadowBlur = size*0.022;
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
    const ringGrad = ctx.createLinearGradient(0, dotY-dotR, 0, dotY+dotR);
    fin.bord.forEach((c, k)=> ringGrad.addColorStop(k/(fin.bord.length-1), c));
    ctx.save();
    ctx.shadowColor = fin.halo; ctx.shadowBlur = size*0.012;
    ctx.lineWidth = size*0.0065; ctx.strokeStyle = ringGrad;
    ctx.beginPath(); ctx.arc(dotX,dotY,dotR,0,Math.PI*2); ctx.stroke();
    ctx.restore();

    // titre du lot à droite du médaillon (pas de prix affiché : le
    // plateau doit rester une carte "quoi gagner", pas un tarif) —
    // noir gras avec un fin liseré doré (façon plaque de luxe/casino
    // haut de gamme) : lisible aussi bien sur les zones claires que
    // sombres de la photo derrière, plus "classe" qu'un simple aplat.
    // Taille de police maximisée : part encore plus grand (rh*0.52) et
    // ne réduit que si un nom précis (ex. "Booster du Marchand 30 ans",
    // le plus long) déborderait sinon de la ligne.
    const textX = dotX + dotR*1.5;
    ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.lineJoin = 'round';
    // chances du lot, alignées à droite de la ligne, même style que
    // le nom (noir gras liseré d'or)
    let oddsW = 0;
    const odds = LOT_ODDS_PCT && r.catKey ? fmtOddsPct(LOT_ODDS_PCT[r.catKey]) : '';
    if(odds){
      const oFont = rh*0.44;
      ctx.font='900 '+oFont+'px Arial,Helvetica,sans-serif';
      ctx.textAlign='right';
      const ox = rowX + rowW - size*0.014;
      ctx.lineWidth = size*0.0052; ctx.strokeStyle = GOLD_BRIGHT;
      ctx.strokeText(odds, ox, y+rh*0.52);
      ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = size*0.008;
      ctx.fillStyle = '#0a0a0a';
      ctx.fillText(odds, ox, y+rh*0.52);
      ctx.shadowBlur = 0;
      oddsW = ctx.measureText(odds).width + size*0.02;
      ctx.textAlign='left';
    }
    const maxTextW = rowX + rowW - textX - size*0.012 - oddsW;
    let fontSize = rh*0.52;
    ctx.font='900 '+fontSize+'px Arial,Helvetica,sans-serif';
    while(fontSize > rh*0.28 && ctx.measureText(CATS[r.catKey].label).width > maxTextW){
      fontSize -= 1;
      ctx.font='900 '+fontSize+'px Arial,Helvetica,sans-serif';
    }
    // Sur le panneau sombre, le noir gras liseré d'or d'avant disparaissait :
    // on inverse (crème plein, liseré noir) pour garder le même relief de
    // plaque gravée mais du bon côté du contraste.
    ctx.fillStyle = '#fff3d4';
    haloText(CATS[r.catKey].label, textX, y+rh*0.52, 3, size*0.011);
    ctx.lineWidth = size*0.0052;
    ctx.strokeStyle = 'rgba(0,0,0,.9)';
    ctx.strokeText(CATS[r.catKey].label, textX, y+rh*0.52);
    ctx.fillStyle = '#fff3d4';
    ctx.fillText(CATS[r.catKey].label, textX, y+rh*0.52);
    ctx.textBaseline='alphabetic';
  });

  ctx.textAlign='center';
  ctx.font='italic 700 '+(size*0.03)+'px Georgia, serif';
  // c'était l'élément le plus fragile : aucune ombre, aucun liseré, il
  // disparaissait entièrement dès que le ciel derrière passait au clair
  ctx.fillStyle = GOLD_BRIGHT;
  haloText('Bonne chance !', size/2, size*0.945, 3, size*0.012);
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

/* ---------- Compteur de coups SUR le plateau (23/09) ----------
   L'animateur : « le 0/245, je l'aurais mis sur le plateau, au milieu, à
   côté de PIKAPOLY, encadré un peu épais ». Plaque posée à plat sur la
   dalle centrale, à droite du titre : cadre doré épais, rampe d'ampoules,
   « COUPS JOUÉS », gros chiffres N / 245, barre de la pochette, coups
   restants. Rouge sous 30 coups restants. Redessinée à chaque coup (sa
   propre petite texture : la grande plaque centrale n'est pas retouchée). */
const CC_W = 0.25, CC_H = 0.175;                    // en fraction de la dalle
const ccCvs = document.createElement('canvas'); ccCvs.width = 640; ccCvs.height = Math.round(640*CC_H/CC_W);
const ccTex = new THREE.CanvasTexture(ccCvs); ccTex.colorSpace = THREE.SRGBColorSpace;
ccTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
const ccMesh = (()=>{
  const W = (N_SIDE-2)*CELL;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(W*CC_W, W*CC_H),
    new THREE.MeshBasicMaterial({map:ccTex, transparent:true, depthWrite:false, toneMapped:false}));
  m.rotation.x = -Math.PI/2;
  // à droite de « PIKAPOLY » (titre centré à 18,5 % du haut de la dalle)
  m.position.set((0.86-0.5)*W, 0.145, (0.118-0.5)*W);   // au-dessus du sous-titre
  m.renderOrder = 3;
  boardGroup.add(m);
  return m;
})();
let ccPulseAt = 0, ccReste = TAILLE_POCHETTE;
function drawCoupPlate(n, total){
  const c = ccCvs.getContext('2d'), w = ccCvs.width, h = ccCvs.height;
  const reste = Math.max(0, total - n), urgent = reste > 0 && reste <= 30;
  ccReste = reste;
  const or = urgent ? '#ff5a5a' : '#ffe27a', orFonce = urgent ? '#8a1010' : '#7a5a12';
  c.clearRect(0,0,w,h);
  const m = 14, r = 38;
  // plaque sombre + cadre épais
  roundRectPath(c, m, m, w-2*m, h-2*m, r);
  const fond = c.createLinearGradient(0,0,0,h);
  fond.addColorStop(0, urgent ? '#2a0606' : '#1d1405'); fond.addColorStop(1, urgent ? '#0c0202' : '#070503');
  c.fillStyle = fond; c.fill();
  c.lineWidth = 16; c.strokeStyle = orFonce; c.stroke();
  roundRectPath(c, m, m, w-2*m, h-2*m, r);
  const cadre = c.createLinearGradient(0,0,w,h);
  cadre.addColorStop(0, urgent ? '#ffb0b0' : '#fff2b8'); cadre.addColorStop(.5, or); cadre.addColorStop(1, urgent ? '#b01818' : '#c8961e');
  c.lineWidth = 9; c.strokeStyle = cadre; c.stroke();
  // rampe d'ampoules sur le cadre
  c.save(); c.shadowColor = or; c.shadowBlur = 10; c.fillStyle = urgent ? '#ffe0e0' : '#fff6d0';
  const pas = 34;
  for(let x = m+r; x <= w-m-r; x += pas){ c.beginPath(); c.arc(x, m, 4.2, 0, 7); c.fill(); c.beginPath(); c.arc(x, h-m, 4.2, 0, 7); c.fill(); }
  for(let y = m+r; y <= h-m-r; y += pas){ c.beginPath(); c.arc(m, y, 4.2, 0, 7); c.fill(); c.beginPath(); c.arc(w-m, y, 4.2, 0, 7); c.fill(); }
  c.restore();
  c.textAlign = 'center'; c.textBaseline = 'middle';
  // libellé
  c.font = '900 44px Arial,Helvetica,sans-serif'; c.fillStyle = urgent ? '#ffd6d6' : '#f6dc86';
  c.fillText(urgent ? 'DERNIERS COUPS !' : 'COUPS JOUÉS', w/2, h*0.18);
  // gros chiffre + total
  const big = 150;
  c.font = '900 '+big+'px "Arial Black",Impact,Arial,sans-serif';
  const tn = String(n); const wn = c.measureText(tn).width;
  c.font = '900 72px "Arial Black",Impact,Arial,sans-serif';
  const tt = ' / '+total; const wt = c.measureText(tt).width;
  const x0 = w/2 - (wn+wt)/2, yb = h*0.54;
  c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  c.save();
  c.font = '900 '+big+'px "Arial Black",Impact,Arial,sans-serif';
  const g = c.createLinearGradient(0, yb-big*0.8, 0, yb);
  g.addColorStop(0, urgent ? '#fff0f0' : '#fffbe6'); g.addColorStop(.45, urgent ? '#ff8a8a' : '#ffe07a');
  g.addColorStop(.55, urgent ? '#c01818' : '#d69a17'); g.addColorStop(1, urgent ? '#ffc0c0' : '#ffe8a0');
  c.shadowColor = or; c.shadowBlur = 22; c.fillStyle = g;
  c.fillText(tn, x0, yb + big*0.34);
  c.restore();
  c.font = '900 72px "Arial Black",Impact,Arial,sans-serif'; c.fillStyle = or;
  c.fillText(tt, x0 + wn, yb + big*0.34);
  // barre de la pochette
  const bx = w*0.14, bw = w*0.72, by = h*0.80, bh = 16;
  roundRectPath(c, bx, by, bw, bh, 8); c.fillStyle = urgent ? '#3a0a0a' : '#2a1d05'; c.fill();
  if(total > 0 && n > 0){
    roundRectPath(c, bx, by, Math.max(bh, bw*n/total), bh, 8);
    c.save(); c.shadowColor = or; c.shadowBlur = 12; c.fillStyle = or; c.fill(); c.restore();
  }
  // coups restants
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = '900 40px Arial,Helvetica,sans-serif'; c.fillStyle = urgent ? '#ffd6d6' : '#ffe9a8';
  c.fillText(reste === 0 ? 'POCHETTE TERMINÉE' : reste === 1 ? 'DERNIER COUP !' : reste + ' COUPS RESTANTS', w/2, h*0.905);
  ccTex.needsUpdate = true;
}
drawCoupPlate(0, TAILLE_POCHETTE);

/* ---------- Intégration du plateau dans le décor (polish final) ----------
   Deux voiles posés SOUS la dalle, dans la scène 3D : la photo de fond de la
   page n'est pas touchée, elle est seulement vue au travers.
     - Ombre portée : diffuse, un peu en arrière (la lumière principale vient
       de l'avant), avec une seconde couche large et pâle qui
       assombrit localement le décor juste autour du plateau, pour que
       l'or s'en détache. Pas de vignette : au-delà de ~1 unité du bord,
       le fond est intact. Resserrée à dessein : la zone 3D ne couvre pas
       tout l'écran, et une ombre qui en atteindrait le bord y serait coupée
       net — une ligne droite, l'effet « collé » garanti.
     - Liseré de lumière dorée le long du bord extérieur, en additif, très
       faible (sous le seuil du flou lumineux : il ne « bave » pas).
   Le plateau les masque là où il est posé : seules leurs franges se voient. */
{
  const BORD = (N_SIDE*CELL)/2 + 0.10;          // bord extérieur de la dalle d'or
  /* Voile LARGE (20 unités) et flou mesuré en unités : l'ombre doit être
     retombée à zéro bien avant le bord du voile. À 14,4 unités, le flou
     débordait jusqu'au bord et y laissait une marche — un rectangle à peine
     plus sombre, exactement l'effet « collé » qu'on veut éviter. */
  const HALF = 10, N = 1024, k = N/(2*HALF);       // demi-taille du voile, en unités
  const rrect = (ctx, half, rad)=>{ const a = N/2 - half*k, b = half*2*k; roundRectPath(ctx, a, a, b, b, rad*k); };
  // ombre
  const sc = document.createElement('canvas'); sc.width = sc.height = N;
  const sx = sc.getContext('2d');
  sx.filter = 'blur(' + (0.22*k) + 'px)'; rrect(sx, BORD + 0.04, 0.5); sx.fillStyle = 'rgba(0,0,0,0.26)'; sx.fill();
  sx.filter = 'blur(' + (0.12*k) + 'px)'; rrect(sx, BORD + 0.02, 0.3); sx.fillStyle = 'rgba(0,0,0,0.34)'; sx.fill();
  const st = new THREE.CanvasTexture(sc);
  const ombre = new THREE.Mesh(new THREE.PlaneGeometry(HALF*2, HALF*2),
    new THREE.MeshBasicMaterial({ map:st, transparent:true, depthWrite:false, toneMapped:false }));
  ombre.rotation.x = -Math.PI/2;
  ombre.position.set(0, -0.30, -0.10);            // un peu en arrière, à l'opposé de la lumière (pas vers les bords de la vue)
  ombre.renderOrder = -2;
  boardGroup.add(ombre);
  // liseré de lumière
  const hc = document.createElement('canvas'); hc.width = hc.height = N;
  const hx = hc.getContext('2d');
  hx.filter = 'blur(' + (0.22*k) + 'px)'; rrect(hx, BORD + 0.04, 0.22);
  hx.lineWidth = 0.16*k; hx.strokeStyle = 'rgba(255,214,130,1)'; hx.stroke();
  const ht = new THREE.CanvasTexture(hc); ht.colorSpace = THREE.SRGBColorSpace;
  const lisere = new THREE.Mesh(new THREE.PlaneGeometry(HALF*2, HALF*2),
    new THREE.MeshBasicMaterial({ map:ht, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, opacity:0.22, toneMapped:false }));
  lisere.rotation.x = -Math.PI/2;
  lisere.position.y = -0.10;                      // à mi-épaisseur de la dalle
  lisere.renderOrder = -1;
  boardGroup.add(lisere);
}

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
/* ---------- Matiere : cartes de surface procedurales ----------
   Le projet n'avait AUCUNE carte PBR (ni normal, ni roughness, ni ao) :
   chaque surface portait une rugosite uniforme sur toute son etendue,
   donc mathematiquement parfaite — donc fausse. C'est la premiere raison
   pour laquelle le plateau se lisait comme des aplats de couleur plutot
   que comme des objets. Meme un rendu stylise a besoin de variation de
   matiere ; on la fabrique ici en code, sans aucun fichier a charger.

   Le bruit est obtenu en empilant plusieurs canvas aleatoires de basse
   resolution reetires en grand (le lissage bilineaire du canvas fait
   l'interpolation gratuitement), ce qui donne un bruit fractal correct
   pour bien moins cher qu'un Perlin ecrit a la main. */
function makeSurfaceMaps(size, bump, rough){
  // --- hauteur : bruit fractal ---
  const hc = document.createElement('canvas'); hc.width = hc.height = size;
  const hx = hc.getContext('2d');
  hx.fillStyle = '#808080'; hx.fillRect(0,0,size,size);
  [[6,0.50],[14,0.28],[34,0.16],[80,0.09]].forEach(([n,a])=>{
    const c = document.createElement('canvas'); c.width = c.height = n;
    const x = c.getContext('2d');
    const img = x.createImageData(n,n);
    for(let i=0;i<n*n;i++){
      const v = (Math.random()*255)|0;
      img.data[i*4] = img.data[i*4+1] = img.data[i*4+2] = v;
      img.data[i*4+3] = 255;
    }
    x.putImageData(img,0,0);
    hx.globalAlpha = a;
    hx.drawImage(c, 0, 0, size, size);       // lissage bilineaire = interpolation
  });
  hx.globalAlpha = 1;
  const H = hx.getImageData(0,0,size,size).data;
  const at = (x,y)=> H[(((y+size)%size)*size + ((x+size)%size))*4] / 255;

  // --- normal map : Sobel sur la hauteur ---
  const nc = document.createElement('canvas'); nc.width = nc.height = size;
  const nx = nc.getContext('2d');
  const nimg = nx.createImageData(size,size);
  for(let y=0;y<size;y++) for(let x=0;x<size;x++){
    const dx = (at(x+1,y) - at(x-1,y)) * bump;
    const dy = (at(x,y+1) - at(x,y-1)) * bump;
    // normale = normalize(-dx, -dy, 1) ramenee dans [0,1]
    const len = Math.hypot(dx, dy, 1);
    const i = (y*size+x)*4;
    nimg.data[i]   = ((-dx/len)*0.5 + 0.5)*255;
    nimg.data[i+1] = ((-dy/len)*0.5 + 0.5)*255;
    nimg.data[i+2] = (( 1 /len)*0.5 + 0.5)*255;
    nimg.data[i+3] = 255;
  }
  nx.putImageData(nimg,0,0);

  // --- roughness map : le canal vert MULTIPLIE material.roughness ---
  const rc = document.createElement('canvas'); rc.width = rc.height = size;
  const rx = rc.getContext('2d');
  const rimg = rx.createImageData(size,size);
  for(let i=0;i<size*size;i++){
    const v = 255 * (1 - rough + rough * (H[i*4]/255));
    rimg.data[i*4] = rimg.data[i*4+1] = rimg.data[i*4+2] = v;
    rimg.data[i*4+3] = 255;
  }
  rx.putImageData(rimg,0,0);

  const mk = (cvs, repeat)=>{
    const t = new THREE.CanvasTexture(cvs);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = getMaxAniso();
    return t;
  };
  return { normalMap: mk(nc,1), roughnessMap: mk(rc,1) };
}
/* Or : micro-rayures marquees (bump fort, variation de rugosite forte) —
   c'est ce qui fait qu'un metal accroche la lumiere differemment selon
   l'endroit au lieu de rester un aplat jaune. */
const GOLD_MAPS  = makeSurfaceMaps(256, 3.2, 0.55);
/* Corps des cases : grain fin et discret, juste de quoi casser la
   perfection de l'aplat colore. */
const TILE_MAPS  = makeSurfaceMaps(256, 1.4, 0.35);

/* Boite biseautee. Tout le plateau etait bati sur des BoxGeometry aux
   aretes a 90 degres parfaits : c'est le marqueur le plus reconnaissable
   du 3D amateur, parce qu'un objet reel — meme dessine — accroche un
   filet de lumiere sur chaque arete. Sans ce filet, l'oeil lit une forme
   geometrique et non un objet. On extrude donc un carre a coins arrondis
   avec un vrai biseau.

   Pas de computeVertexNormals apres coup : les normales par facette que
   produit ExtrudeGeometry sont exactement ce qu'on veut ici (un biseau
   net qui accroche), les lisser rendrait l'arete molle. */
function bevelledBox(w, h, d, bevel){
  const hw = Math.max(0.001, w/2 - bevel), hd = Math.max(0.001, d/2 - bevel);
  const r = Math.min(hw, hd) * 0.14;
  const sh = new THREE.Shape();
  sh.moveTo(-hw + r, -hd);
  sh.lineTo( hw - r, -hd); sh.quadraticCurveTo( hw, -hd,  hw, -hd + r);
  sh.lineTo( hw,  hd - r); sh.quadraticCurveTo( hw,  hd,  hw - r,  hd);
  sh.lineTo(-hw + r,  hd); sh.quadraticCurveTo(-hw,  hd, -hw,  hd - r);
  sh.lineTo(-hw, -hd + r); sh.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
  const geo = new THREE.ExtrudeGeometry(sh, {
    depth: Math.max(0.001, h - bevel*2), bevelEnabled: true,
    bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2,
    curveSegments: 3, steps: 1,
  });
  geo.rotateX(-Math.PI/2);
  geo.center();                 // le code positionne les meshes par leur centre
  return geo;
}

/* ---------- Feuille d'or ----------
   D'après la photo de référence de l'animateur : une feuille d'or froissée,
   faite de facettes, de plis nets et d'arêtes qui accrochent la lumière.
   Hauteur = bruit « ridgé » (1 - |2n-1|) sur un domaine déformé : les
   crêtes forment des plis fins et cassés, pas des bosses rondes. La couleur
   suit la hauteur (creux ocre, crêtes paille presque blanches) et la carte
   de normales, tirée de la même hauteur, fait scintiller chaque facette. */
function makeGoldLeafMaps(size){
  let seed = 1337;
  const rnd = ()=>{ seed = (seed*16807) % 2147483647; return seed/2147483647; };
  const grid = (n)=>{ const g = new Float32Array(n*n); for(let i=0;i<n*n;i++) g[i] = rnd(); return g; };
  const sample = (g, n, x, y)=>{
    x = ((x % n) + n) % n; y = ((y % n) + n) % n;
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x-x0, fy = y-y0;
    const x1 = (x0+1)%n, y1 = (y0+1)%n;
    const sx = fx*fx*(3-2*fx), sy = fy*fy*(3-2*fy);
    const a = g[y0*n+x0], b = g[y0*n+x1], c = g[y1*n+x0], d = g[y1*n+x1];
    return (a + (b-a)*sx) + ((c + (d-c)*sx) - (a + (b-a)*sx))*sy;
  };
  const oct = [4, 8, 16, 32, 64].map(n=>({ n, g:grid(n) }));
  const warp = [grid(6), grid(6)];
  const H = new Float32Array(size*size);
  for(let y=0;y<size;y++) for(let x=0;x<size;x++){
    const u = x/size, v = y/size;
    const wx = u + 0.08*(sample(warp[0], 6, u*6, v*6) - 0.5);
    const wy = v + 0.08*(sample(warp[1], 6, u*6, v*6) - 0.5);
    let h = 0, amp = 1, tot = 0;
    for(const o of oct){
      const r = 1 - Math.abs(2*sample(o.g, o.n, wx*o.n, wy*o.n) - 1);
      h += Math.pow(r, 3.2) * amp; tot += amp; amp *= 0.55;
    }
    H[y*size+x] = h/tot;
  }
  let mn = 1, mx = 0; for(const h of H){ if(h<mn) mn=h; if(h>mx) mx=h; }
  for(let i=0;i<H.length;i++) H[i] = (H[i]-mn)/(mx-mn);
  const at = (x,y)=> H[(((y+size)%size)*size + ((x+size)%size))];
  const cc = document.createElement('canvas'); cc.width = cc.height = size;
  const nc = document.createElement('canvas'); nc.width = nc.height = size;
  const ci = cc.getContext('2d').createImageData(size, size), ni = nc.getContext('2d').createImageData(size, size);
  const bas = [150, 108, 38], mid = [214, 170, 82], haut = [252, 236, 178];
  for(let y=0;y<size;y++) for(let x=0;x<size;x++){
    const h = at(x,y), i = (y*size+x)*4;
    const k = h < 0.5 ? h/0.5 : (h-0.5)/0.5, A = h < 0.5 ? bas : mid, B = h < 0.5 ? mid : haut;
    const sp = Math.pow(Math.max(0, h-0.82)/0.18, 2)*40;         // paillettes sur les crêtes
    for(let c=0;c<3;c++) ci.data[i+c] = Math.min(255, A[c] + (B[c]-A[c])*k + sp);
    ci.data[i+3] = 255;
    const dx = (at(x+1,y) - at(x-1,y))*9, dy = (at(x,y+1) - at(x,y-1))*9;
    const len = Math.hypot(dx, dy, 1);
    ni.data[i] = (-dx/len*0.5+0.5)*255; ni.data[i+1] = (-dy/len*0.5+0.5)*255; ni.data[i+2] = (1/len*0.5+0.5)*255; ni.data[i+3] = 255;
  }
  cc.getContext('2d').putImageData(ci, 0, 0); nc.getContext('2d').putImageData(ni, 0, 0);
  const mk = (cvs, srgb)=>{ const t = new THREE.CanvasTexture(cvs); t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1.6, 1.6); t.anisotropy = getMaxAniso(); if(srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  return { map: mk(cc, true), normalMap: mk(nc, false) };
}
const GOLD_LEAF = makeGoldLeafMaps(512);
/* Flancs des cases et socle : feuille d'or. Métal franc, normales fortes
   (c'est ici qu'on VEUT l'accroche facette par facette, contrairement à la
   collerette polie), et un léger émissif pris dans la couleur elle-même
   pour que l'or reste doré face au fond sombre, même sans bloom. */
const goldLeafMat = new THREE.MeshStandardMaterial({
  map: GOLD_LEAF.map, normalMap: GOLD_LEAF.normalMap, normalScale: new THREE.Vector2(1.1, 1.1),
  color: 0xffffff, metalness: 0.92, roughness: 0.34, envMapIntensity: 1.35,
  emissive: 0xffffff, emissiveMap: GOLD_LEAF.map, emissiveIntensity: 0.26,
});
const goldLeafDarkMat = goldLeafMat.clone();
goldLeafDarkMat.color = new THREE.Color(0x9a7a44);
goldLeafDarkMat.emissiveIntensity = 0.14;
/* ---------- Base du plateau en feuille d'or ----------
   Une dalle continue sous la couronne des 40 cases, épaisse et biseautée :
   c'est le socle du plateau, fixe (les cases, elles, ondulent au-dessus).
   Elle suit exactement l'anneau des cases, du bord extérieur jusque sous le
   bord du panneau central : le centre reste tel quel, et la photo de fond
   se voit toujours au-delà du plateau. */
{
  const ext = (N_SIDE*CELL)/2 + 0.10, int = (N_SIDE-2)*CELL/2 - 0.06;
  const rr = 0.18;
  const sh = new THREE.Shape();
  sh.moveTo(-ext + rr, -ext); sh.lineTo(ext - rr, -ext); sh.quadraticCurveTo(ext, -ext, ext, -ext + rr);
  sh.lineTo(ext, ext - rr); sh.quadraticCurveTo(ext, ext, ext - rr, ext); sh.lineTo(-ext + rr, ext);
  sh.quadraticCurveTo(-ext, ext, -ext, ext - rr); sh.lineTo(-ext, -ext + rr); sh.quadraticCurveTo(-ext, -ext, -ext + rr, -ext);
  const hole = new THREE.Path();
  hole.moveTo(-int, -int); hole.lineTo(-int, int); hole.lineTo(int, int); hole.lineTo(int, -int); hole.lineTo(-int, -int);
  sh.holes.push(hole);
  const H = 0.16, bev = 0.035;
  const geo = new THREE.ExtrudeGeometry(sh, { depth: H - bev*2, bevelEnabled:true, bevelSize:bev, bevelThickness:bev, bevelSegments:3, curveSegments:6 });
  geo.rotateX(-Math.PI/2);
  const baseSlab = new THREE.Mesh(geo, goldLeafMat);
  baseSlab.position.y = -H + bev + 0.004;     // dessus au ras du dessous des cases
  baseSlab.receiveShadow = true;
  boardGroup.add(baseSlab);
}

const tileGoldMat = new THREE.MeshStandardMaterial({
  /* roughness .28 et non .2 : la roughnessMap MULTIPLIE cette valeur, et
     la carte procedurale a une moyenne de 0.72 — la rugosite effective
     tombait donc a 0.145 au lieu de 0.2. Sur un metal place dans un
     environnement sombre, moins de rugosite veut dire plus SOMBRE (le
     terme de multidiffusion chute de 27 %). 0.28 x 0.72 = 0.20 : on
     retrouve la rugosite moyenne d'origine, avec la variation en plus.
     emissiveIntensity .22 et non .12 : l'or porte ainsi son eclat
     lui-meme (+58 % de luminance) au lieu de l'emprunter entierement au
     halo de bloom des zones claires voisines. Ne pas monter au-dela de
     .30, il se desature vers le jaune pale. */
  color:new THREE.Color(GOLD), roughness:.28, metalness:.9,
  /* .30 est le plafond utile mesuré : au-delà l'or se désature vers un
     jaune pâle et perd sa couleur de métal. À .30 la collerette gagne
     +94 % de luminance par rapport au .12 d'origine, sans rien devoir au
     bloom — donc l'or reste doré même quand le mode éco coupe le bloom. */
  emissive:new THREE.Color(GOLD), emissiveIntensity:.30,
  /* Pas de normalMap sur l'or. Sur un materiau tres metallique, perturber
     les normales renvoie une grande partie des rayons hors de la camera :
     le metal s'assombrit globalement au lieu de gagner du relief. Seule la
     carte de rugosite est gardee — elle fait varier la brillance d'un point
     a l'autre, ce qui suffit a casser l'aplat sans rien assombrir. */
  roughnessMap: GOLD_MAPS.roughnessMap,
});
const tileBezelMat = new THREE.MeshStandardMaterial({
  color:0x0a0a0a, roughness:.5, metalness:.25,
  normalMap: TILE_MAPS.normalMap, roughnessMap: TILE_MAPS.roughnessMap,
});
/* TILE+0.115 et non TILE+0.09 : le biseau rentre les faces superieure et
   inferieure de bevelSize, alors que le corps colore de la case garde sa
   taille. L'anneau dore PLAT visible passait donc de 0.045 a 0.033 unite,
   soit -27 % de surface doree — a peine plus de 2 pixels a l'ecran en
   1080p. On elargit la collerette pour retrouver l'anneau d'origine tout
   en gardant le filet de lumiere du biseau. */
const tileCollarGeo = bevelledBox(TILE+0.115,0.07,TILE+0.115, 0.012);
const tileBezelGeo  = bevelledBox(TILE*0.97,0.035,TILE*0.97, 0.008);
/* Geometries partagees par les 40 cases : elles etaient recreees a
   l'identique dans la boucle (40 BoxGeometry pour rien). */
const tileBaseGeo = bevelledBox(TILE+0.05, 0.08, TILE+0.05, 0.014);
const tileBodyGeo = bevelledBox(TILE, 0.14, TILE, 0.018);
const baseTileMat = new THREE.MeshStandardMaterial({
  color:0x050505, roughness:.6, metalness:.3,
  normalMap: TILE_MAPS.normalMap, roughnessMap: TILE_MAPS.roughnessMap,
});
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
/* Collerette en FEUILLE D'OR, comme les flancs et le socle (23/09) : en or
   lisse, elle formait entre les cases des bandes jaune uni que l'animateur
   a entourées sur sa capture — seules pièces dorées qui n'avaient pas la
   matière du reste du plateau. */
const tileCollarInst = new THREE.InstancedMesh(tileCollarGeo, goldLeafMat, N_TILES);
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

  // socle : feuille d'or patinée, un ton sous les flancs, qui asseoit la case
  const baseTile = new THREE.Mesh(tileBaseGeo, goldLeafDarkMat);
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
  // Corps de la case légèrement épaissi (0.14 au lieu de 0.08 à
  // l'origine) : un vrai relief avec des flancs colorés visibles,
  // façon jeton de casino, sans pour autant faire une case si haute
  // qu'elle cache la photo de la case juste derrière elle dans la
  // même rangée (vu la caméra en plongée, une case trop épaisse
  // masque celle qui la suit — testé à 0.30, beaucoup trop).
  // Posé directement sur la collerette (qui culmine à 0.135).
  const BODY_H = 0.14, BODY_BOTTOM = 0.135;
  /* Flancs en FEUILLE D'OR (demande de l'animateur, photo à l'appui) : les
     couleurs de catégorie empilées sur la tranche faisaient bariolé et
     bon marché. La couleur de chaque lot reste sur le dessus de la case
     (liseré et bandeau), où on la lit ; la tranche, elle, devient la
     matière noble du plateau. */
  const bodyTile = new THREE.Mesh(tileBodyGeo, goldLeafMat);
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
    // gros lot hors coin : sa photo est sur la carte flottante, la case
    // montre le socle ; Chance / Caisse / Prison gardent leur médaillon
    const flotte = SHOW_FLOAT_PHOTOS && catDef.tier === 'float' && i % SIDE !== 0;
    faceTex = getFlatPhotoFace(catKey, accentColor, null, flotte);
  }
  /* Dessus de case ÉCLAIRÉ (polish 22/09). C'était un MeshBasicMaterial :
     un matériau qui ignore la lumière ET les ombres — la ligne
     « face.receiveShadow = true » plus bas ne faisait donc strictement
     rien. Le dessus des 40 cases était un autocollant plat, toujours à la
     même luminosité, sur lequel l'ombre du personnage ne se posait jamais :
     l'effet exact « texture 2D collée sur un cube 3D ».
     Désormais la photo est une surface physique : elle prend le modelé de
     la lumière, un léger satin (carte plastifiée), et l'ombre du pion vient
     s'y poser — c'est ce contact qui dit que le personnage est DESSUS.
     emissiveMap = la photo elle-même, à faible intensité : garantit que le
     lot reste lisible même dans la partie la plus sombre du plateau.
     0.34 au premier réglage : trop fort. L'émissif S'AJOUTE à l'éclairage
     reçu, et sur les photos claires (ETB, coffret : boîtes blanches) la
     somme dépassait le seuil du flou lumineux — les cases brûlaient en
     halo blanc, constaté en gros plan et sur la capture iPhone de
     l'animateur. 0.10 suffit à la lisibilité à l'ombre sans jamais
     franchir le seuil. */
  /* Cases d'angle (sauf Départ) en BILLET incliné à 45°, talon vers
     l'angle extérieur, comme au Monopoly : voir getTicketFace. */
  /* Les quatre coins (Départ compris) : image entière tournée vers le
     centre du plateau (voir diagonalCornerFace). Même angle que l'ancien
     billet incliné. */
  if(i % SIDE === 0){
    const yaw = outwardYaw(r, c);
    const lx = Math.sign(world.x)*Math.cos(yaw) - Math.sign(world.z)*Math.sin(yaw);
    const lz = Math.sign(world.x)*Math.sin(yaw) + Math.sign(world.z)*Math.cos(yaw);
    faceTex = diagonalCornerFace(faceTex, Math.atan2(-lx, lz));
  }
  const faceMat = new THREE.MeshStandardMaterial({
    map: faceTex,
    roughness: 0.46, metalness: 0.0, envMapIntensity: 0.55,
    emissive: new THREE.Color(0xffffff), emissiveMap: faceTex, emissiveIntensity: 0.10,
  });
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
  // numéro de case dans le coin haut, sur la bordure d'or : il recouvrait
  // la fin du nom du lot en bas de case
  numSpr.position.set(TILE*0.385, tileTopY+0.03, -TILE*0.385);
  numSpr.scale.multiplyScalar(0.8);
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
  // (pas de carte flottante sur un coin : le billet porte déjà la photo)
  if(SHOW_FLOAT_PHOTOS && i % SIDE !== 0 && catDef.tier === 'float'){
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
    // plus grandes et plus hautes : l'animateur ne les voyait pas bien
    floatObj = makeSprite(getGlyphTexture(glyphKind, accentColor), data.isVisite ? 0.3 : 0.82);
    floatObj.position.y = tileTopY + 0.38;
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
    if(!SHOW_GLOW_POINTS){
      // pas de halo derrière les lots flottants (contre-jour)
    } else if(catDef.tier==='float'){
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

/* ---------- Finale du jackpot (ETB) : l'enlèvement ----------
   Le ciel s'éteint, Luffy devient une silhouette noire cernée de lumière,
   la foudre frappe sa case en rafale (vrais éclairs ramifiés : cœur blanc,
   halo bleuté, scintillement, flash qui illumine la scène), puis un
   faisceau descend du ciel comme celui d'un vaisseau : le personnage y est
   soulevé en tournant lentement, tout là-haut un flash blanc éclate, il
   redescend sur sa case et le lot apparaît. Chronologie en secondes : */
const STORM_MS = 6800;
const STORM_STRIKES = [0.30, 0.72, 1.05, 1.34, 1.58, 1.80, 1.98, 2.12];
const ABD = { beam:2.20, levee:2.55, haut:4.75, flash:5.25, descente:5.30, pose:5.95, fin:6.8, hauteur:2.35 };
const LIGHT_BASE = { key: key.intensity, hemi: hemiLight.intensity, fill: fill.intensity, rim: rim.intensity, spot: centerSpot.intensity, expo: renderer.toneMappingExposure };
let storm = null;
const stormWaves = [];
let beamMesh = null, beamCore = null, beamHalo = null, beamDisc = null, beamSource = null, beamLight = null;
/* Lumière du faisceau présente DÈS le chargement (intensité 0) : l'ajouter
   au premier jackpot recompilait tous les matériaux en pleine finale. */
beamLight = new THREE.PointLight(0xd7ebff, 0, 12, 2); scene.add(beamLight);
/* Faisceau : cône ouvert, du ciel vers la case, en matière additive. Le
   shader fait défiler des stries verticales (rayons) et des anneaux qui
   descendent, plus clair au centre du cône qu'à ses bords. */
function makeBeamMat(color, strength){
  return new THREE.ShaderMaterial({
    uniforms: { uT:{value:0}, uOp:{value:0}, uCol:{value:new THREE.Color(color)}, uK:{value:strength} },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv = uv; vec4 mv = modelViewMatrix*vec4(position,1.0);
        vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform float uT; uniform float uOp; uniform vec3 uCol; uniform float uK;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        float face = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
        float stries = 0.55 + 0.45*sin(vUv.x*62.83 + uT*1.7)*sin(vUv.x*25.13 - uT*1.1);
        float anneaux = 0.70 + 0.30*sin(vUv.y*46.0 + uT*7.0);
        float haut = smoothstep(1.0, 0.72, vUv.y) * smoothstep(0.0, 0.08, vUv.y);
        float a = uOp * uK * face * stries * anneaux * (0.35 + 0.65*haut);
        gl_FragColor = vec4(uCol * a, a);
      }`,
    transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide,
  });
}
/* Onde de choc qui parcourt les cases depuis le point d'impact : une
   bosse qui s'éloigne à 7,5 unités/s, suivie d'un léger creux, et qui
   s'amortit avec la distance et le temps. */
function stormWaveOffset(tile, t){
  if(!stormWaves.length) return 0;
  let y = 0;
  for(const w of stormWaves){
    const age = t - w.t0;
    if(age < 0 || age > 2.4) continue;
    const d = Math.hypot(tile.world.x - w.x, tile.world.z - w.z);
    const u = d - age*7.5;
    if(u > 1.2 || u < -2.2) continue;
    const env = Math.exp(-age*1.2) * Math.exp(-Math.max(0, d-1.2)*0.1);
    y += (Math.exp(-u*u*1.8) - 0.45*Math.exp(-(u+1.0)*(u+1.0)*1.8)) * 0.19 * env;
  }
  return y;
}
/* Éclair : déplacement de points médians (fractal), 64 segments, un vrai
   zigzag à toutes les échelles au lieu de 10 segments réguliers. */
function boltPoints(from, to, rough, depth){
  let pts = [from.clone(), to.clone()];
  let amp = from.distanceTo(to) * rough;
  for(let d=0; d<depth; d++){
    const nx = [];
    for(let i=0;i<pts.length-1;i++){
      const a = pts[i], b = pts[i+1];
      const m = a.clone().lerp(b, 0.42 + Math.random()*0.16);
      const dir = b.clone().sub(a).normalize();
      const side = new THREE.Vector3(Math.random()-0.5, Math.random()-0.5, Math.random()-0.5).cross(dir).normalize();
      m.addScaledVector(side, (Math.random()-0.5)*2*amp);
      nx.push(a, m);
    }
    nx.push(pts[pts.length-1]);
    pts = nx; amp *= 0.52;
  }
  return pts;
}
function boltMesh(pts, r, color, op){
  const path = new THREE.CatmullRomCurve3(pts, false, 'chordal', 0);
  const m = new THREE.Mesh(new THREE.TubeGeometry(path, pts.length*2, r, 5, false),
    new THREE.MeshBasicMaterial({ color, transparent:true, opacity:op, blending:THREE.AdditiveBlending, depthWrite:false, toneMapped:false }));
  m.userData.op = op;
  return m;
}
function spawnBolt(tx, ty, tz, puissance){
  if(!storm) return;
  const g = new THREE.Group();
  const from = new THREE.Vector3(tx + (Math.random()-0.5)*6, 10, tz + (Math.random()-0.5)*6);
  const to = new THREE.Vector3(tx + (Math.random()-0.5)*0.3, ty, tz + (Math.random()-0.5)*0.3);
  const main = boltPoints(from, to, 0.22, 6);
  const k = puissance || 1;
  g.add(boltMesh(main, 0.022*k, 0xffffff, 1));          // cœur blanc
  g.add(boltMesh(main, 0.07*k, 0xb9c6ff, 0.55));        // halo proche
  g.add(boltMesh(main, 0.20*k, 0x6f72ff, 0.16));        // halo large
  // ramifications, elles-mêmes ramifiées
  const nb = 3 + Math.floor(Math.random()*3);
  for(let b=0;b<nb;b++){
    const i = 8 + Math.floor(Math.random()*(main.length*0.6));
    const st = main[Math.min(main.length-2, i)];
    const end = st.clone().add(new THREE.Vector3((Math.random()-0.5)*3.4, -(0.9 + Math.random()*2.6), (Math.random()-0.5)*3.4));
    const br = boltPoints(st, end, 0.28, 4);
    g.add(boltMesh(br, 0.012*k, 0xffffff, 0.9));
    g.add(boltMesh(br, 0.045*k, 0xa9b6ff, 0.35));
    if(Math.random() < 0.6){
      const j = Math.floor(br.length*0.5), e2 = br[j].clone().add(new THREE.Vector3((Math.random()-0.5)*1.4, -(0.4+Math.random()*1.0), (Math.random()-0.5)*1.4));
      g.add(boltMesh(boltPoints(br[j], e2, 0.3, 3), 0.008*k, 0xe8ecff, 0.8));
    }
  }
  scene.add(g);
  // scintillement : allumé, éteint, rallumé (le « re-strike » d'un vrai éclair), puis fondu
  storm.bolts.push({ g, born: clock.getElapsedTime(), life: 0.34 + Math.random()*0.12 });
}
function disposeBolt(b){
  scene.remove(b.g);
  b.g.traverse(o=>{ if(o.geometry) o.geometry.dispose(); if(o.material) o.material.dispose(); });
}
function playThunder(strength){
  const ctx = getAudioCtx(); if(!ctx) return;
  try{
    const now = ctx.currentTime;
    const dur = 1.1;
    const bufSize = Math.floor(ctx.sampleRate*dur);
    const buffer = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for(let i=0;i<bufSize;i++){ const u=i/bufSize; data[i] = (Math.random()*2-1) * Math.pow(1-u, 1.6) * (0.6+0.4*Math.sin(u*40)); }
    const noise = ctx.createBufferSource(); noise.buffer = buffer;
    const lp = ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.setValueAtTime(900, now); lp.frequency.exponentialRampToValueAtTime(120, now+0.5);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.55*strength, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now+dur);
    noise.connect(lp); lp.connect(gain); gain.connect(ctx.destination);
    noise.start(now);
  }catch(e){}
  playImpact();
}
function triggerImpactBlast(){
  if(!impactFlash || reduceMotion) return;
  impactFlash.classList.add('blast');
  setTimeout(()=>impactFlash.classList.remove('blast'), 260);
}
/* Silhouette : toutes les matières du pion virent au noir, les contours
   s'élargissent et s'allument — un personnage à contre-jour devant le ciel. */
let _silMats = null;
function setSilhouette(k){
  if(!_silMats){
    _silMats = [];
    player.root.traverse(o=>{
      if(!o.isMesh || !o.material) return;
      const m = o.material;
      if(_silMats.some(e=>e.m===m)) return;
      _silMats.push({ m, col: m.color ? m.color.clone() : null, emi: m.emissive ? m.emissive.clone() : null });
    });
  }
  const noir = new THREE.Color(0x040406), lueur = new THREE.Color(0xfff1c8);
  for(const e of _silMats){
    if(e.m.userData.contour){
      e.m.color.copy(e.col).lerp(lueur, k);
      e.m.userData.largeur.value = e.m.userData.base * (1 + 1.9*k);
    } else {
      if(e.col) e.m.color.copy(e.col).lerp(noir, k);
      if(e.emi) e.m.emissive.copy(e.emi).lerp(noir, k);
    }
  }
}
function startJackpotStorm(){
  if(reduceMotion) return false;
  stopStorm();
  const P = player.root.position;
  const tile = currentIndex >= 0 ? tiles[currentIndex] : null;
  const x = tile ? tile.world.x : P.x, z = tile ? tile.world.z : P.z, y = P.y;
  storm = { t0: clock.getElapsedTime(), x, y, z, strike:0, flashT:-9, bolts:[], dim:0, beamOn:false, blast:false,
            released:false, endT:0, lift:0, sil:0, finalBolt:false };
  document.documentElement.classList.add('storm');
  cineSpin = 0.45;
  cineBegin('orbit');
  const H = 11;
  beamMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.95, H, 48, 1, true), makeBeamMat(0xcfe6ff, 3.2));
  beamMesh.position.set(x, y + H/2, z);
  beamCore = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.46, H, 32, 1, true), makeBeamMat(0xffffff, 3.6));
  beamHalo = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 1.75, H, 48, 1, true), makeBeamMat(0x8fb8ff, 1.3));
  beamHalo.position.set(x, y + H/2, z);
  beamCore.position.copy(beamMesh.position);
  beamDisc = new THREE.Mesh(new THREE.CircleGeometry(1.05, 48), new THREE.MeshBasicMaterial({ map:goldDotTex, color:0xd8ecff, transparent:true, opacity:0, blending:THREE.AdditiveBlending, depthWrite:false, toneMapped:false }));
  beamDisc.rotation.x = -Math.PI/2; beamDisc.position.set(x, y + 0.035, z);
  beamSource = new THREE.Sprite(new THREE.SpriteMaterial({ map:brightGoldTex, color:0xe6f2ff, transparent:true, opacity:0, blending:THREE.AdditiveBlending, depthWrite:false }));
  beamSource.position.set(x, y + H - 0.4, z); beamSource.scale.set(3.2, 3.2, 1);
  for(const m of [beamMesh, beamCore, beamHalo, beamDisc, beamSource]){ m.scale.y = m === beamDisc || m === beamSource ? m.scale.y : 0.001; m.renderOrder = 5; scene.add(m); }
  /* Créée UNE fois et gardée (intensité 0 hors orage) : ajouter puis
     retirer une lumière change le nombre de lumières de la scène, et
     three recompilait tous les matériaux éclairés deux fois par jackpot. */
  if(!beamLight){ beamLight = new THREE.PointLight(0xd7ebff, 0, 12, 2); scene.add(beamLight); }
  beamLight.intensity = 0;
  beamLight.position.set(x, y + 2.2, z);
  return true;
}
function stopStorm(){
  if(!storm) return;
  storm.bolts.forEach(disposeBolt);
  for(const m of [beamMesh, beamCore, beamHalo, beamDisc, beamSource]){ if(m){ scene.remove(m); if(m.geometry) m.geometry.dispose(); m.material.dispose(); } }
  beamMesh = beamCore = beamHalo = beamDisc = beamSource = null;
  if(beamLight) beamLight.intensity = 0;   // gardée dans la scène (voir startJackpotStorm)
  key.intensity = LIGHT_BASE.key; hemiLight.intensity = LIGHT_BASE.hemi; fill.intensity = LIGHT_BASE.fill;
  rim.intensity = LIGHT_BASE.rim; centerSpot.intensity = LIGHT_BASE.spot;
  renderer.toneMappingExposure = LIGHT_BASE.expo;
  shatterFlash.material.opacity = 0;
  setSilhouette(0);
  document.documentElement.classList.remove('storm');
  if(cineMode === 'orbit') cineEnd();
  stormWaves.length = 0;
  storm = null;
}
const _ease = u=> u<=0 ? 0 : u>=1 ? 1 : u*u*(3-2*u);
function updateStorm(t, dt){
  if(!storm) return;
  const age = t - storm.t0;
  // nuit : monte en 0,6 s, revient en 1,1 s une fois Luffy reposé
  if(age < ABD.pose) storm.dim = Math.min(1, storm.dim + dt/0.6);
  else storm.dim = Math.max(0, storm.dim - dt/1.1);
  const flash = Math.max(0, 1 - (t - storm.flashT)/0.16);
  key.intensity   = LIGHT_BASE.key *(1 - 0.90*storm.dim) + flash*2.0;
  hemiLight.intensity = LIGHT_BASE.hemi*(1 - 0.85*storm.dim) + flash*1.0;
  renderer.toneMappingExposure = LIGHT_BASE.expo*(1 - 0.60*storm.dim) + flash*0.8;
  fill.intensity  = LIGHT_BASE.fill*(1 - 0.90*storm.dim);
  rim.intensity   = LIGHT_BASE.rim *(1 - 0.50*storm.dim) + flash*1.0;
  centerSpot.intensity = LIGHT_BASE.spot*(1 - 0.80*storm.dim);
  // silhouette : noir complet pendant la foudre et l'enlèvement
  const silT = age < ABD.pose ? _ease(age/0.7) : 1 - _ease((age - ABD.pose)/0.6);
  if(Math.abs(silT - storm.sil) > 0.004){ storm.sil = silT; setSilhouette(silT); }

  // rafale de foudre sur la case
  while(storm.strike < STORM_STRIKES.length && age >= STORM_STRIKES[storm.strike]){
    const i = storm.strike++;
    storm.flashT = t;
    spawnBolt(storm.x, storm.y, storm.z, 1 + i*0.06);
    if(i >= 3) spawnBolt(storm.x + (Math.random()-0.5)*2.5, storm.y, storm.z + (Math.random()-0.5)*2.5, 0.8);
    stormWaves.push({ t0: t, x: storm.x, z: storm.z });
    spawnSparkles(storm.x, storm.y + 0.1, storm.z, 18, 2.4, 3.6, 0.5, 0.9);
    shatterFlash.position.set(storm.x, storm.y + 0.35, storm.z);
    shatterFlash.scale.set(1.8, 1.8, 1.8);
    shatterFlash.material.opacity = 1;
    cameraPunch(i%2 ? 1.2 : 2.0);
    playThunder(0.7 + i*0.05);
    if(i === 0 || i === STORM_STRIKES.length-1) triggerImpactFlash();
    cineSpin += 0.2;
  }
  // le faisceau descend du ciel
  if(!storm.beamOn && age >= ABD.beam){
    storm.beamOn = true;
    playRiser(2600);
    triggerCheer(1.2);
  }
  if(beamMesh){
    let op = 0, desc = 0;
    if(storm.beamOn){
      const u = Math.min(1, (age - ABD.beam)/0.35);
      desc = _ease(u);                       // le cône « tombe » du ciel jusqu'à la case
      op = age < ABD.flash ? 1 : Math.max(0, 1 - (age - ABD.flash)/0.9);
      op *= 0.85 + 0.15*Math.sin(t*23)*Math.sin(t*7);   // léger bourdonnement lumineux
    }
    const H = 11;
    for(const m of [beamMesh, beamCore, beamHalo]){
      m.scale.y = Math.max(0.001, desc);
      m.position.y = storm.y + H - H*desc/2;
      m.material.uniforms.uT.value = t;
      m.material.uniforms.uOp.value = op * (m === beamCore ? 0.55 : m === beamHalo ? 0.35 : 0.42);
      m.rotation.y += dt*(m === beamCore ? -0.9 : 0.6);
    }
    beamDisc.material.opacity = Math.min(1, op * desc * 1.4);
    beamDisc.scale.setScalar(1 + 0.05*Math.sin(t*9));
    beamSource.material.opacity = op * 0.9;
    beamLight.intensity = 4.2 * op * desc;
    if(op > 0.3 && age < ABD.flash && Math.random() < 0.8){
      // poussière de lumière qui MONTE dans le faisceau, aspirée avec lui
      spawnSparkles(storm.x + (Math.random()-0.5)*0.7, storm.y + 0.1 + Math.random()*storm.lift, storm.z + (Math.random()-0.5)*0.7, 2, 0.35, 3.6, 0.8, 1.4);
    }
  }
  // enlèvement : levée lente, rotation, flottement ; puis redescente
  let lift = 0;
  if(age >= ABD.levee && age < ABD.descente){
    const u = Math.min(1, (age - ABD.levee)/(ABD.haut - ABD.levee));
    lift = ABD.hauteur * (u*u*(3 - 2*u)) + (u >= 1 ? 0.06*Math.sin((age - ABD.haut)*6) : 0.03*Math.sin(age*5)*u);
    player.root.rotation.y += dt * (0.8 + 2.6*u);
  } else if(age >= ABD.descente && age < ABD.pose){
    const u = (age - ABD.descente)/(ABD.pose - ABD.descente);
    lift = ABD.hauteur * (1 - u*u);        // chute accélérée, réception au sol
  }
  storm.lift = lift;
  if(!storm.finalBolt && age >= ABD.pose){ storm.finalBolt = true; winShock(tiles[currentIndex] || {world:{x:storm.x,z:storm.z}, tileTopY:storm.y}, 5); cameraPunch(2.2); playImpact(); }
  // flash au sol de chaque impact
  if(shatterFlash.material.opacity > 0){
    shatterFlash.scale.multiplyScalar(1 + dt*7);
    shatterFlash.material.opacity = Math.max(0, shatterFlash.material.opacity - dt*4);
  }
  // éclairs : allumé / éteint / rallumé, puis fondu
  for(const b of storm.bolts){
    const a = (t - b.born)/b.life;
    const o = a >= 1 ? 0 : (a < 0.18 ? 1 : a < 0.28 ? 0.12 : a < 0.45 ? 1 : (1 - (a-0.45)/0.55)) * (Math.random() < 0.15 ? 0.6 : 1);
    b.g.children.forEach(m=>{ m.material.opacity = m.userData.op*o; });
  }
  for(let i=storm.bolts.length-1;i>=0;i--){
    if(t - storm.bolts[i].born >= storm.bolts[i].life){ disposeBolt(storm.bolts[i]); storm.bolts.splice(i,1); }
  }
  // flash blanc au sommet de l'enlèvement
  if(!storm.blast && age >= ABD.flash){
    storm.blast = true; storm.flashT = t;
    triggerImpactBlast(); playThunder(1.15); cameraPunch(2.6);
    spawnBolt(storm.x, storm.y + storm.lift + 0.6, storm.z, 1.5);
    startGoldRain(2.6);
  }
  if(!storm.released && age >= ABD.fin){
    storm.released = true; storm.endT = t;
    document.documentElement.classList.remove('storm');
    cineEnd();
  }
  if(storm.released && storm.dim <= 0 && storm.sil <= 0.01 && t - storm.endT > 0.8) stopStorm();
}

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
/* Secousse courte du plateau pour les gros lots hors jackpot (le
   jackpot a son propre séisme + éclatement). Remise à zéro propre à la
   fin, sans passer par la reconstitution des éclats. */
let hypeShakeUntil = 0, hypeShakeMag = 0;
function startHypeShake(durSec, mag){
  if(reduceMotion || shatterUntil>0) return;
  hypeShakeUntil = clock.getElapsedTime() + durSec;
  hypeShakeMag = mag;
}
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
const PLAYER_TARGET_HEIGHT = 1.12; // hauteur visee sur le plateau (memes proportions que l'ancien pion). Ne pas monter : en vue plateau (plongee 51 deg) c'est le bord du chapeau de paille qui grandit, pas la silhouette, et il masque encore plus le corps. Le personnage se regarde en gros plan (CINE.closeup, cale a 7 deg exprES).

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
      /* Mesurées sur le plateau, elles sont ramenées dans le repère du
         modèle (÷ GAIT_K) où vivent cuisse, tibia et allonge. Sans cette
         conversion, depuis le pion à 1,12 : hanche à 0,41 pour une jambe
         de 0,32 — la jambe ne pouvait plus atteindre le sol, la foulée
         tombait à 0,01 et Luffy glissait pieds joints en frétillant. */
      player.bones.LeftUpLeg.getWorldPosition(_v);
      GAIT.hipY = (_v.y - player.root.position.y) / GAIT_K;
      player.bones.LeftFoot.getWorldPosition(_v);
      GAIT.footY = (_v.y - player.root.position.y) / GAIT_K;
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
              symL:0.135, symR:0.09, restLX:0.10, restRX:-1.14,
              abd:0.26 };
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
    /* Bras écartés du buste (abduction). L'épaule du squelette est à 9,6 cm
       de l'axe, DANS le buste de Luffy (10,7 cm de demi-largeur à cette
       hauteur) : bras pendants, ils y étaient enfoncés — de face on ne
       voyait que les manches, et à la marche les bras « se baladaient dans
       le buste » (constaté par l'animateur). Mesuré : sur ce rig, +z écarte
       les DEUX bras vers l'extérieur (coude +5 cm pour 0,3 rad) sans les
       pousser en avant ni en arrière. 0,26 : bras le long du corps, mains
       bien visibles. */
    add('LeftArm','z',  RIG.abd);
    add('RightArm','z', RIG.abd);

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
let _glbBytes = null;
async function loadPlayerModel(player){
  const gltf = await new Promise((resolve, reject)=>{
    const url = './assets/character/player.glb';
    /* Dans le fichier unique publié, le build ne fournit PAS le modèle en
       data: URI (type de fichier refusé par la vérification du partage
       public des artefacts) mais en chaîne base64 dans window.__GLB_B64.
       On la reconstruit en ArrayBuffer et on la parse directement. */
    const b64 = (typeof window !== 'undefined' && window.__GLB_B64) ? window.__GLB_B64[url] : null;
    if(b64){
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
      _glbBytes = bytes;
      new GLTFLoader().parse(bytes.buffer, '', resolve, reject);
    } else {
      new GLTFLoader().load(url, resolve, undefined, reject);
    }
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
  let skinMat = null;
  model.traverse(o=>{
    if(!o.isMesh) return;
    o.castShadow = true;
    const oldMat = o.material;
    o.userData.nomOrigine = oldMat.name || '';
    if(oldMat.name === 'skin') skinMat = null;   // (posé plus bas sur le nouveau matériau)
    /* FINITION DU PERSONNAGE — le point qui change tout.
       Les 7 matériaux du GLB étaient remplacés par du MeshToonMaterial :
       un ombrage en 4 paliers tranchés, c'est-à-dire du cel-shading. C'est
       LUI, et lui seul, qui donnait au personnage son aspect « dessin animé
       plat » — pas le modèle, qui est bon. Un personnage de jeu en direct
       haut de gamme est en ombrage LISSE : la lumière y roule sur les
       volumes au lieu de sauter d'un palier à l'autre, et c'est ce qui fait
       lire le relief — une moustache, un pli de tissu, une joue.
       MeshStandardMaterial rend ce dégradé continu et rend le personnage
       sensible à l'environnement de reflets de la scène, comme le plateau.
       Couleurs, textures et double face sont repris tels quels : le
       personnage ne change pas, seule sa façon de recevoir la lumière
       change.
       Rugosité par matériau : peau, cheveux et tissu ne renvoient pas la
       lumière de la même façon, et c'est cette différence qui fait qu'un
       rendu « a l'air fini ». Uniforme, tout paraît en plastique. */
    const _nom = (oldMat.name || '').toLowerCase();
    const _peau = _nom.includes('skin') || _nom.includes('peau') || _nom.includes('face');
    const _cheveux = _nom.includes('hair') || _nom.includes('cheveu');
    const newMat = new THREE.MeshStandardMaterial({
      map: oldMat.map || null,
      color: oldMat.color ? oldMat.color.clone() : new THREE.Color(0xffffff),
      roughness: _peau ? 0.62 : _cheveux ? 0.78 : 0.88,
      metalness: 0.0,
      /* Le personnage capte le même environnement que le plateau : sans
         cela il resterait « détouré », éclairé par d'autres règles que la
         scène où il se tient — le défaut exact qu'on corrige ici. */
      envMapIntensity: 0.85,
      // Les 7 materiaux du GLB sont doubleSided : sans le reprendre ici,
      // toutes les surfaces fines (bord du chapeau de paille, echarpe,
      // lanieres des sandales) deviendraient traversables du regard — le
      // chapeau apparaissait comme un disque translucide a cote du
      // personnage.
      side: oldMat.side !== undefined ? oldMat.side : THREE.FrontSide,
    });
    o.material = newMat;
    if(oldMat.name === 'skin') skinMat = newMat;
    // Le matériau "peau" (texture visage/corps) est le seul avec une
    // map — casquette/bande/cheveux sont en couleur plate.
    if(oldMat.map && oldMat.map.image && (oldMat.map.image.width || oldMat.map.image.naturalWidth) && !blinkAssigned){
      blink = setupBlink(newMat, oldMat.map);
      blinkAssigned = true;
    }
  });
  /* Filet de sécurité : si la texture de la peau n'a pas été chargée par
     GLTFLoader (sur iPhone, dans l'hébergement des artefacts, ses URL
     blob: temporaires peuvent être bloquées : personnage tout blanc,
     sans tee-shirt ni cicatrices), on la recharge nous-mêmes depuis le
     data: URI inscrit dans le modèle par le build, comme n'importe
     quelle image de la page. */
  if(!blinkAssigned && skinMat && _glbBytes){
    try{
      const dv = new DataView(_glbBytes.buffer, _glbBytes.byteOffset, _glbBytes.byteLength);
      const jsonLen = dv.getUint32(12, true);
      const json = JSON.parse(new TextDecoder().decode(_glbBytes.subarray(20, 20+jsonLen)));
      const uri = json.images && json.images[0] && json.images[0].uri;
      if(uri && uri.startsWith('data:')){
        const tex = await new THREE.TextureLoader().loadAsync(uri);
        tex.flipY = false;                       // convention glTF
        tex.colorSpace = THREE.SRGBColorSpace;
        skinMat.map = tex;
        skinMat.needsUpdate = true;
        blink = setupBlink(skinMat, tex);
        blinkAssigned = true;
      }
    }catch(e){ console.warn('Texture du personnage : repli impossible', e); }
  }

  /* Pivot de salto. model.position.y place les pieds sur y=0, donc une
     rotation du root ferait tourner le personnage AUTOUR DE SES PIEDS —
     une roue, pas un salto. On intercale un groupe place a mi-hauteur, et
     on redescend le modele d'autant a l'interieur : la rotation se fait
     alors autour du bassin, comme un vrai salto. */
  const flipPivot = new THREE.Group();
  flipPivot.position.y = PLAYER_TARGET_HEIGHT * 0.5;
  model.position.y -= PLAYER_TARGET_HEIGHT * 0.5;
  flipPivot.add(model);
  player.root.add(flipPivot);
  player.flip = flipPivot;
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

  const jumpClip = clip('jump');
  const actions = {
    idle: idleClip && mixer.clipAction(idleClip),
    walk: clip('walk') && mixer.clipAction(clip('walk')),
  };
  /* Le modele embarque un clip « jump » qui n'etait jamais charge. Il est
     joue une seule fois, en surcouche additive legere des deux autres :
     on ne le fait pas prendre la main sur idle/walk, parce que la couche
     procedurale (updateBody) pilote deja bras et jambes — on veut sa
     detente, pas qu'il ecrase tout le reste. */
  const jumpAction = jumpClip ? mixer.clipAction(jumpClip) : null;
  if(jumpAction){
    jumpAction.setLoop(THREE.LoopOnce, 1);
    jumpAction.clampWhenFinished = true;
    jumpAction.setEffectiveWeight(0);
    jumpAction.play();
  }
  player.playJump = ()=>{
    if(!jumpAction) return;
    jumpAction.reset();
    jumpAction.setEffectiveWeight(0.85);
    jumpAction.timeScale = 1;
    jumpAction.play();
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
  /* Le pion refait en volumes (voir « LUFFY SCULPTÉ ») ; son clignement
     remplace celui de la texture peinte. En cas d'échec, le pion d'origine
     reste tel quel. */
  try{
    const luffy = buildLuffy(model, flipPivot);
    if(luffy){ blink = luffy.blink; player.luffy = luffy; }
  }catch(e){ console.warn('Luffy sculpté indisponible, pion d\'origine conservé :', e); }
  player.updateBody = buildBodyLayer(bones, blink, model);
  player.bones = bones;
}

/* ============================================================================
   LUFFY SCULPTÉ — le pion de l'animateur, refait en volumes
   ----------------------------------------------------------------------------
   Le modèle d'origine (Kenney « characterMedium ») est un personnage de
   blocs : visage peint sur une plaque, cheveux en caisson, corps en boîte,
   vêtements peints dans la texture. Son squelette, lui, est bon, et c'est lui
   que toute la couche d'animation pilote (marche, saut, salto, regard,
   réactions). On garde donc le squelette et le CHAPEAU d'origine, et on
   fabrique par-dessus un vrai personnage chibi d'après la référence :
     - tête ronde, visage dessiné (grands yeux, grand sourire, cicatrice
       cousue sous l'œil gauche), cheveux noirs en mèches ;
     - corps en volumes lisses ; vêtements taillés en 3D, pas repeints :
       gilet rouge ouvert à boutons dorés et mancherons effrangés, cicatrice
       en croix en relief sur le torse, short bleu ample qui tombe en plis,
       revers blancs duveteux, écharpe jaune nouée avec son long pan,
       sandales à lanières ;
     - chaque maillage est SKINNÉ sur le squelette d'origine (poids calculés
       par distance aux os) : les vêtements plient avec le corps ;
     - contour noir façon dessin animé (coque inversée), ombrage en aplats.
   Unités « design » : repère du pivot du pion mesuré au chargement avec
   l'échelle d'origine (sol à y = -0,204, tête vers 0,72). Tout est converti
   dans le repère du maillage d'origine : la taille finale du pion se règle
   indépendamment (PLAYER_TARGET_HEIGHT).
   ========================================================================== */
const LUFFY_DESIGN = { scale: 0.28682, offY: -0.20285 };   // repère de mesure
const LUFFY_COL = {
  peau:0xf1c29b, gilet:0xc9252b, short:0x5d84d9, revers:0xfbf8f0, echarpe:0xf3c230,
  cheveux:0x17171c, bouton:0xf8d23e, semelle:0xb58a52, laniere:0x5b3a1f, cicatrice:0xe39c96,
};
function luffyGradient(){
  const d = new Uint8Array([90, 175, 255]);
  const t = new THREE.DataTexture(d, 3, 1, THREE.RedFormat);
  t.magFilter = t.minFilter = THREE.NearestFilter; t.needsUpdate = true; return t;
}

/* ---- géométrie : petits outils de construction (repère design) ---- */
function luffyPart(){ return { p:[], n:[], c:[], uv:[], i:[], bones:null, rigid:null }; }
function luffyPush(part, pos, col, uv){
  part.p.push(pos.x, pos.y, pos.z); part.c.push(col[0], col[1], col[2]);
  part.uv.push(uv ? uv[0] : 0, uv ? uv[1] : 0);
  return part.p.length/3 - 1;
}
// grille (rangées x colonnes) déjà remplie -> triangles
function luffyGrid(part, base, rows, cols, wrap){
  const C = wrap ? cols : cols;
  for(let r=0;r<rows-1;r++) for(let k=0;k<cols-(wrap?0:1);k++){
    const k2 = (k+1) % cols;
    const a = base + r*cols + k, b = base + r*cols + k2, c = base + (r+1)*cols + k, d = base + (r+1)*cols + k2;
    part.i.push(a, b, c, b, d, c);      // faces tournées vers l'extérieur
  }
}
// ellipsoïde déformable ; f(dir) peut retoucher le rayon
function luffyEllipsoid(part, c, rx, ry, rz, seg, ring, col, deform){
  const base = part.p.length/3;
  for(let r=0;r<=ring;r++){
    const th = r/ring*Math.PI;
    for(let s=0;s<=seg;s++){
      const ph = s/seg*Math.PI*2;
      const d = new THREE.Vector3(-Math.cos(ph)*Math.sin(th), Math.cos(th), Math.sin(ph)*Math.sin(th));
      const k = deform ? deform(d) : 1;
      luffyPush(part, new THREE.Vector3(c.x + d.x*rx*k, c.y + d.y*ry*k, c.z + d.z*rz*k), col, [s/seg, 1 - r/ring]);
    }
  }
  for(let r=0;r<ring;r++) for(let s=0;s<seg;s++){
    const a = base + r*(seg+1) + s, b = a+1, cc = a+seg+1, d = cc+1;
    if(r>0) part.i.push(a, cc, b);
    if(r<ring-1) part.i.push(b, cc, d);
  }
}
// tube le long d'une polyligne : pts [{p,r,rz?}], sections elliptiques,
// repères par transport parallèle ; bosses(k, angle, t) retouche le rayon
function luffyTube(part, pts, seg, col, opts={}){
  const base = part.p.length/3;
  const N = pts.length;
  const T = [], U = [], V = [];
  for(let i=0;i<N;i++){
    const a = pts[Math.max(0,i-1)].p, b = pts[Math.min(N-1,i+1)].p;
    T.push(b.clone().sub(a).normalize());
  }
  let u = new THREE.Vector3(0,0,1);
  if(Math.abs(u.dot(T[0])) > 0.9) u.set(1,0,0);
  u.addScaledVector(T[0], -u.dot(T[0])).normalize();
  for(let i=0;i<N;i++){
    if(i>0){ u.addScaledVector(T[i], -u.dot(T[i])).normalize(); }
    U.push(u.clone()); V.push(new THREE.Vector3().crossVectors(T[i], u).normalize());
  }
  for(let i=0;i<N;i++){
    const P = pts[i];
    for(let s=0;s<seg;s++){
      const ang = s/seg*Math.PI*2;
      let rr = P.r * (opts.bosses ? opts.bosses(i, ang, i/(N-1)) : 1);
      const rz = (P.rz || P.r)/P.r;
      const q = P.p.clone().addScaledVector(U[i], Math.cos(ang)*rr*rz).addScaledVector(V[i], Math.sin(ang)*rr);
      luffyPush(part, q, opts.colAt ? opts.colAt(i, ang) : col, [s/seg, i/(N-1)]);
    }
  }
  luffyGrid(part, base, N, seg, true);
  const cap = (i, flip)=>{
    const ci = luffyPush(part, pts[i].p.clone().addScaledVector(T[i], flip ? -pts[i].r*0.35 : pts[i].r*0.35), col);
    for(let s=0;s<seg;s++){
      const a = base + i*seg + s, b = base + i*seg + (s+1)%seg;
      if(flip) part.i.push(ci, b, a); else part.i.push(ci, a, b);
    }
  };
  if(opts.capStart) cap(0, true);
  if(opts.capEnd) cap(N-1, false);
}
// coque verticale autour du tronc : sections superellipse, secteur d'angle
// [a0, a1] (0 = devant), profil(y) -> {rx, rz, zc}
function luffyShell(part, ys, prof, seg, col, opts={}){
  const base = part.p.length/3;
  const cols = seg + 1;
  for(let r=0;r<ys.length;r++){
    const y = ys[r], P = prof(y, r/(ys.length-1));
    const a0 = opts.a0 ? opts.a0(y) : 0, a1 = opts.a1 ? opts.a1(y) : Math.PI*2;
    for(let s=0;s<=seg;s++){
      const a = a0 + (a1-a0)*s/seg;
      const sa = Math.sin(a), ca = Math.cos(a), n = opts.n || 2.4;
      const ex = Math.sign(sa)*Math.pow(Math.abs(sa), 2/n), ez = Math.sign(ca)*Math.pow(Math.abs(ca), 2/n);
      let k = opts.bosses ? opts.bosses(a, y, r/(ys.length-1)) : 1;
      luffyPush(part, new THREE.Vector3(P.rx*ex*k, y + (opts.dy ? opts.dy(a, y) : 0), P.zc + P.rz*ez*k),
        opts.colAt ? opts.colAt(a, y) : col, [s/seg, r/(ys.length-1)]);
    }
  }
  for(let r=0;r<ys.length-1;r++) for(let s=0;s<seg;s++){
    const a = base + r*cols + s, b = a+1, c = a+cols, d = c+1;
    part.i.push(a, b, c, b, d, c);
  }
}

/* ---- visage : dessiné sur la sphère de la tête (u = 0,25 = face) ---- */
function drawLuffyFace(mode){
  const W = 2048, H = 1024;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  x.fillStyle = '#f1c29b'; x.fillRect(0, 0, W, H);
  const U = (du)=> (0.25 + du)*W;          // du > 0 : vers la gauche du personnage
  const Y = (t)=> t*H;
  x.lineCap = 'round'; x.lineJoin = 'round';
  const ink = '#1b1414';
  // joues légèrement rosées
  for(const s of [-1, 1]){
    const g = x.createRadialGradient(U(s*0.075), Y(0.575), 5, U(s*0.075), Y(0.575), 60);
    g.addColorStop(0, 'rgba(240,140,120,.28)'); g.addColorStop(1, 'rgba(240,140,120,0)');
    x.fillStyle = g; x.fillRect(U(s*0.075)-70, Y(0.575)-70, 140, 140);
  }
  /* Regard de Luffy d'après la référence : yeux RAPPROCHÉS, ronds, grosse
     pupille noire et deux reflets. Première version : yeux écartés, blanc
     immense, pupille minuscule — un regard fixe qui faisait peur. */
  const eye = (s)=>{
    const cx = U(s*0.041), cy = Y(0.482);
    if(mode === 'ouvert'){
      x.fillStyle = '#ffffff'; x.strokeStyle = ink; x.lineWidth = 9;
      x.beginPath(); x.ellipse(cx, cy, 44, 52, 0, 0, Math.PI*2); x.fill(); x.stroke();
      x.fillStyle = ink; x.beginPath(); x.ellipse(cx - s*3, cy + 6, 27, 33, 0, 0, Math.PI*2); x.fill();
      x.fillStyle = '#ffffff';
      x.beginPath(); x.ellipse(cx - s*3 - 10, cy - 6, 10, 11, 0, 0, Math.PI*2); x.fill();
      x.beginPath(); x.ellipse(cx - s*3 + 9, cy + 17, 4.5, 5, 0, 0, Math.PI*2); x.fill();
      // paupière du haut, trait épais qui déborde vers l'extérieur
      x.lineWidth = 14;
      x.beginPath(); x.ellipse(cx, cy, 44, 52, 0, Math.PI*1.08, Math.PI*1.92); x.stroke();
    } else if(mode === 'ferme'){
      x.strokeStyle = ink; x.lineWidth = 12;
      x.beginPath(); x.moveTo(cx-44, cy+6); x.quadraticCurveTo(cx, cy+24, cx+44, cy+6); x.stroke();
    } else { // rire : yeux fermés en arc, heureux
      x.strokeStyle = ink; x.lineWidth = 13;
      x.beginPath(); x.moveTo(cx-44, cy+14); x.quadraticCurveTo(cx, cy-30, cx+44, cy+14); x.stroke();
    }
    // sourcil : court, épais, légèrement relevé — décidé, pas menaçant
    x.fillStyle = ink;
    x.beginPath();
    x.moveTo(cx - s*44, cy - 72); x.quadraticCurveTo(cx - s*4, cy - 96, cx + s*42, cy - 84);
    x.lineTo(cx + s*40, cy - 72); x.quadraticCurveTo(cx - s*4, cy - 80, cx - s*42, cy - 60); x.closePath(); x.fill();
  };
  eye(-1); eye(1);
  // nez : petit trait
  x.strokeStyle = '#c08a6c'; x.lineWidth = 6;
  x.beginPath(); x.moveTo(U(0.003), Y(0.54)); x.lineTo(U(-0.002), Y(0.562)); x.stroke();
  // grand sourire ouvert (D couché), rangée de dents, langue rose
  const mx = U(0), my = Y(0.598), mw = mode === 'rire' ? 94 : 82, mh = mode === 'rire' ? 80 : 66;
  const bouche = ()=>{ x.beginPath(); x.moveTo(mx - mw, my); x.quadraticCurveTo(mx, my - 10, mx + mw, my);
    x.quadraticCurveTo(mx + mw*0.86, my + mh, mx, my + mh); x.quadraticCurveTo(mx - mw*0.86, my + mh, mx - mw, my); x.closePath(); };
  x.save(); bouche(); x.fillStyle = '#8c2a33'; x.fill(); x.clip();
  x.fillStyle = '#ffffff'; x.fillRect(mx - mw, my - 14, mw*2, 30);
  x.fillStyle = '#f59aa3'; x.beginPath(); x.ellipse(mx, my + mh*0.98, mw*0.66, mh*0.52, 0, 0, Math.PI*2); x.fill();
  x.restore();
  x.strokeStyle = ink; x.lineWidth = 9; bouche(); x.stroke();
  // fossettes au coin de la bouche
  x.lineWidth = 6;
  for(const sgn of [-1,1]){ x.beginPath(); x.moveTo(mx + sgn*(mw+4), my - 12); x.quadraticCurveTo(mx + sgn*(mw+14), my, mx + sgn*(mw+6), my + 12); x.stroke(); }
  // cicatrice sous l'œil gauche : trait arqué et deux points de couture
  const sx = U(0.049), sy = Y(0.548);
  x.strokeStyle = '#8c3b35'; x.lineWidth = 7;
  x.beginPath(); x.moveTo(sx - 34, sy - 6); x.quadraticCurveTo(sx, sy + 10, sx + 34, sy - 8); x.stroke();
  x.lineWidth = 6;
  for(const t of [-14, 14]){ x.beginPath(); x.moveTo(sx + t - 5, sy - 12); x.lineTo(sx + t + 5, sy + 12); x.stroke(); }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = getMaxAniso();
  return tex;
}

/* ---- matériau de contour : coque inversée poussée le long des normales ---- */
function luffyOutlineMat(width){
  const m = new THREE.MeshBasicMaterial({ color:0x140d0d, side:THREE.BackSide });
  // largeur en uniforme : la finale l'élargit pour faire un liseré de lumière
  m.userData.contour = true;
  m.userData.largeur = { value: width };
  m.onBeforeCompile = sh=>{
    sh.uniforms.uContour = m.userData.largeur;
    sh.vertexShader = 'uniform float uContour;\n' + sh.vertexShader.replace('#include <skinning_vertex>',
      '#include <skinning_vertex>\n  transformed += normalize(objectNormal) * uContour;');
  };
  m.userData.base = width;
  return m;
}

function buildLuffy(model, pivot){
  const skins = [];
  model.traverse(o=>{ if(o.isSkinnedMesh) skins.push(o); });
  const kSkin = skins.find(o=>o.material && o.material.map) || skins[0];
  if(!kSkin) return null;
  model.updateMatrixWorld(true);
  const skel = kSkin.skeleton;
  const boneIdx = name => skel.bones.findIndex(b=>b.name===name);
  // design -> repère local du maillage d'origine
  const toNative = new THREE.Matrix4().makeTranslation(0, -LUFFY_DESIGN.offY, 0)
    .premultiply(new THREE.Matrix4().makeScale(1/LUFFY_DESIGN.scale, 1/LUFFY_DESIGN.scale, 1/LUFFY_DESIGN.scale));
  const M = new THREE.Matrix4().copy(kSkin.matrixWorld).invert().multiply(model.matrixWorld).multiply(toNative);
  const Mn = new THREE.Matrix3().getNormalMatrix(M);
  const localScale = new THREE.Vector3().setFromMatrixScale(M).x;
  // positions de repos des os, repère design
  const invModel = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const bpos = name => {
    const b = skel.bones[boneIdx(name)]; if(!b) return null;
    const v = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld).applyMatrix4(invModel);
    return v.multiplyScalar(LUFFY_DESIGN.scale).add(new THREE.Vector3(0, LUFFY_DESIGN.offY, 0));
  };
  const CHILD = { Hips:'Spine', Spine:'Chest', Chest:'UpperChest', UpperChest:'Neck', Neck:'Head', Head:'Head_end' };
  for(const s of ['Left','Right']){
    Object.assign(CHILD, { [s+'Shoulder']:s+'Arm', [s+'Arm']:s+'ForeArm', [s+'ForeArm']:s+'Hand', [s+'Hand']:s+'HandIndex1',
      [s+'UpLeg']:s+'Leg', [s+'Leg']:s+'Foot', [s+'Foot']:s+'Toes', [s+'Toes']:s+'Toes_end' });
  }
  const SEG = {};
  for(const [b, c] of Object.entries(CHILD)){
    const a = bpos(b), e = bpos(c);
    if(a && e) SEG[b] = [a, e];
  }
  const _t = new THREE.Vector3();
  const segDist = (p, b)=>{
    const [a, e] = SEG[b]; const ab = _t.copy(e).sub(a); const L = ab.lengthSq();
    const t = L > 0 ? Math.max(0, Math.min(1, p.clone().sub(a).dot(ab)/L)) : 0;
    return p.distanceTo(a.clone().addScaledVector(ab, t));
  };
  const B = bpos;   // raccourci pour placer les pièces sur les os

  const parts = {};
  const P = (mat, bones)=>{ const pt = luffyPart(); pt.bones = bones; (parts[mat] = parts[mat] || []).push(pt); return pt; };
  const white = [1,1,1];
  const v3 = (x,y,z)=> new THREE.Vector3(x,y,z);

  // ---------------- tête ----------------
  const HC = v3(0, 0.715, -0.02);
  const head = P('visage', ['Head']);
  luffyEllipsoid(head, HC, 0.248, 0.232, 0.218, 64, 40, white, d=>{
    // joues pleines, menton rond, crâne un peu plus large
    let k = 1;
    if(d.y < -0.2) k *= 1 - 0.10*Math.pow(-d.y - 0.2, 1.3);
    if(d.z > 0.3 && d.y < 0.1 && d.y > -0.6) k *= 1 + 0.035*Math.sin((d.y+0.6)/0.7*Math.PI);
    return k;
  });
  const ears = P('peau', ['Head']);
  for(const s of [-1,1]) luffyEllipsoid(ears, v3(s*0.245, 0.70, -0.02), 0.028, 0.048, 0.036, 16, 10, white);
  // ---------------- cheveux : mèches coniques ----------------
  const hair = P('cheveux', ['Head']);
  const rnd = (()=>{ let s = 7; return ()=>{ s = (s*16807) % 2147483647; return s/2147483647; }; })();
  const spike = (baseDir, len, rad, bend, droop)=>{
    const b0 = HC.clone().add(v3(baseDir.x*0.238, baseDir.y*0.222, baseDir.z*0.21));
    const out = baseDir.clone().normalize();
    const tip = b0.clone().addScaledVector(out, len).add(v3(0, -droop, 0)).addScaledVector(bend, len*0.3);
    const mid = b0.clone().lerp(tip, 0.5).addScaledVector(out, len*0.12);
    luffyTube(hair, [ {p:b0.clone().addScaledVector(out, -0.03), r:rad}, {p:b0, r:rad*0.95}, {p:mid, r:rad*0.55}, {p:tip, r:0.002} ], 7, white, { capStart:true });
  };
  // calotte (couvre le crâne sous le chapeau)
  luffyEllipsoid(hair, HC.clone().add(v3(0, 0.022, -0.012)), 0.256, 0.236, 0.228, 40, 24, white, d=> (d.z < -0.05 && d.y > -0.78) ? 1.025 : (d.y > -0.05 ? 1 : 0.9));   // tout l'arrière du crâne, jusqu'à la nuque
  // mèches de côté et de nuque, sous l'aile du chapeau
  for(let i=0;i<34;i++){
    const a = Math.PI*0.28 + (i/34)*Math.PI*1.44 + (rnd()-0.5)*0.12;       // du côté gauche au côté droit, par l'arrière
    const dir = v3(Math.sin(a), -0.08 + rnd()*0.2, Math.cos(a));   // sous l'aile du chapeau
    spike(dir, 0.055 + rnd()*0.05, 0.03 + rnd()*0.012, v3(0,-1,0), 0.02 + rnd()*0.02);
  }
  // nuque : mèches en désordre qui pointent vers le bas et l'extérieur
  for(let i=0;i<22;i++){
    const a = Math.PI*0.62 + (i/22)*Math.PI*0.76 + (rnd()-0.5)*0.1;
    const dir = v3(Math.sin(a), 0.05 - rnd()*0.2, Math.cos(a));
    spike(dir, 0.035 + rnd()*0.03, 0.026 + rnd()*0.008, v3(Math.sin(a)*0.6, -1, Math.cos(a)*0.6).normalize(), 0.012);
  }
  // frange : mèches épaisses qui tombent sur le front
  const bangs = [[-0.13,0.090],[-0.075,0.105],[-0.02,0.11],[0.035,0.108],[0.09,0.10],[0.14,0.085],[-0.17,0.07],[0.18,0.07]];
  for(const [bx, bl] of bangs){
    const dir = v3(bx/0.24, 0.40, 0.85);   // la frange sort de sous l'aile
    spike(dir, bl, 0.034, v3(bx*0.8, -1.2, 0.25).normalize(), 0.075);
  }
  // mèches qui dépassent au-dessus des oreilles
  for(const s of [-1,1]) for(let k=0;k<3;k++)
    spike(v3(s*0.95, -0.12 + k*0.07, -0.1 + k*0.12), 0.06, 0.028, v3(s*0.4,-1,0), 0.03);

  // ---------------- cou et tronc ----------------
  const neck = P('peau', ['Neck','Head','UpperChest']);
  luffyTube(neck, [{p:v3(0,0.50,-0.005), r:0.046}, {p:v3(0,0.545,-0.005), r:0.046}, {p:v3(0,0.60,-0.01), r:0.05}], 16, white);
  const TORSE = (y)=>{
    // profil du tronc chibi : léger ventre, poitrine, épaules arrondies
    const k = [[0.08,0.096,0.072,0.012],[0.16,0.104,0.078,0.016],[0.24,0.104,0.077,0.018],[0.32,0.110,0.080,0.022],
               [0.40,0.117,0.080,0.018],[0.46,0.114,0.074,0.010],[0.505,0.096,0.064,0.004],[0.54,0.058,0.048,0]];
    if(y <= k[0][0]) return {rx:k[0][1], rz:k[0][2], zc:k[0][3]};
    for(let i=0;i<k.length-1;i++) if(y <= k[i+1][0]){
      const t = (y-k[i][0])/(k[i+1][0]-k[i][0]), s = t*t*(3-2*t);
      return { rx:k[i][1]+(k[i+1][1]-k[i][1])*s, rz:k[i][2]+(k[i+1][2]-k[i][2])*s, zc:k[i][3]+(k[i+1][3]-k[i][3])*s };
    }
    const e = k[k.length-1]; return {rx:e[1], rz:e[2], zc:e[3]};
  };
  const torso = P('peau', ['Hips','Spine','Chest','UpperChest','Neck']);
  const tys = []; for(let y=0.125; y<=0.545; y+=0.0125) tys.push(y);   // le bas reste caché dans le short
  luffyShell(torso, tys, y=>TORSE(y), 48, white);
  // clavicules et plis de ventre : légers creux d'ombre peints en couleur de sommet
  // cicatrice en croix : deux bandes en relief posées sur la surface du torse
  const scar = P('cicatrice', ['Chest','UpperChest','Spine']);
  const surf = (x, y, lift)=>{ const T = TORSE(y); const sx = Math.max(-0.999, Math.min(0.999, x/T.rx));
    // superellipse n=2.4 : z = rz * (1-|sx|^n)^(1/n)
    const z = T.zc + T.rz*Math.pow(1 - Math.pow(Math.abs(sx), 2.4), 1/2.4); return v3(x, y, z + lift); };
  for(const s of [-1, 1]){
    const base = scar.p.length/3, n = 22;
    for(let k=0;k<=n;k++){
      const t = k/n, x = (t-0.5)*0.118*s, y = 0.392 + (0.5-t)*0.118;
      const w = 0.0105*Math.sin(Math.PI*Math.min(1, t*1.05+0.02)) + 0.003;
      const c = surf(x, y, 0.0035);
      const perp = v3(0.707*s, 0.707, 0).multiplyScalar(w);
      luffyPush(scar, surf(x + perp.x, y + perp.y, 0.0022), [1,1,1]);
      luffyPush(scar, c, [1.06,1.02,1.02]);
      luffyPush(scar, surf(x - perp.x, y - perp.y, 0.0022), [1,1,1]);
      if(k>0){ const a = base+(k-1)*3, b = base+k*3;
        scar.i.push(a, b, a+1, a+1, b, b+1, a+1, b+1, a+2, a+2, b+1, b+2); }
    }
  }

  // ---------------- bras et poings ----------------
  for(const s of ['Left','Right']){
    const sg = s==='Left' ? 1 : -1;
    const sh = B(s+'Arm'), el = B(s+'ForeArm'), wr = B(s+'Hand');
    const arm = P('peau', [s+'Shoulder', s+'Arm', s+'ForeArm', s+'Hand', 'UpperChest']);
    luffyTube(arm, [
      {p:v3(sg*0.07, sh.y+0.005, sh.z), r:0.043}, {p:sh.clone(), r:0.042},
      {p:sh.clone().lerp(el, 0.5), r:0.039}, {p:el.clone(), r:0.035},
      {p:el.clone().lerp(wr, 0.55), r:0.032}, {p:wr.clone(), r:0.029}], 18, white, {capStart:true});
    const fist = P('peau', [s+'Hand']);
    const fc = wr.clone().add(v3(sg*0.042, -0.004, 0.006));
    luffyEllipsoid(fist, fc, 0.044, 0.042, 0.045, 24, 16, white, d=> 1 + 0.06*Math.max(0, d.z)*Math.max(0,-d.y+0.3));
    luffyEllipsoid(fist, fc.clone().add(v3(-sg*0.004, -0.004, 0.04)), 0.02, 0.017, 0.024, 12, 8, white);
    // jointures : quatre bosses discrètes sur l'avant du poing
    for(let k=0;k<4;k++) luffyEllipsoid(fist, fc.clone().add(v3(sg*(0.012 + 0.0), 0.028 - k*0.018, 0.028)), 0.017, 0.011, 0.018, 10, 6, white);
  }
  // ---------------- jambes et pieds ----------------
  for(const s of ['Left','Right']){
    const sg = s==='Left' ? 1 : -1;
    const hp = B(s+'UpLeg'), kn = B(s+'Leg'), an = B(s+'Foot');
    const leg = P('peau', [s+'UpLeg', s+'Leg', s+'Foot', 'Hips']);
    luffyTube(leg, [{p:hp.clone().add(v3(0,0.02,0)), r:0.05}, {p:hp.clone().lerp(kn,0.5), r:0.046}, {p:kn.clone(), r:0.041},
      {p:kn.clone().lerp(an,0.5).add(v3(0,0,0.006)), r:0.038}, {p:an.clone().add(v3(0,-0.012,0.01)), r:0.031}], 18, white);
    const foot = P('peau', [s+'Foot', s+'Toes']);
    luffyEllipsoid(foot, v3(sg*0.095, -0.171, 0.012), 0.043, 0.023, 0.078, 24, 12, white, d=> d.y < 0 ? 0.85 : 1);
    for(let k=0;k<4;k++) luffyEllipsoid(foot, v3(sg*(0.078 + k*0.012), -0.176, 0.083), 0.0085, 0.009, 0.01, 8, 6, white);
    // sandale : semelle de paille, lanière en V entre les orteils, bride de talon
    const sole = P('semelle', [s+'Foot', s+'Toes']);
    luffyEllipsoid(sole, v3(sg*0.095, -0.198, 0.012), 0.054, 0.0065, 0.094, 28, 8, white);
    const strap = P('laniere', [s+'Foot', s+'Toes']);
    const toe = v3(sg*0.088, -0.18, 0.082);
    for(const side of [-1,1]){
      luffyTube(strap, [{p:toe, r:0.006}, {p:v3(sg*0.095 + side*0.042, -0.168, 0.028), r:0.007}, {p:v3(sg*0.095 + side*0.05, -0.192, 0.0), r:0.006}], 8, white);
    }
  }

  // ---------------- short : bassin + jambes amples, plis qui tombent ----------------
  const shortCol = (a, y)=>{ const f = 0.5 + 0.5*Math.sin(a*9 + y*30); return [0.86 + 0.14*f, 0.86 + 0.14*f, 0.9 + 0.1*f]; };
  const pelvis = P('short', ['Hips','Spine','LeftUpLeg','RightUpLeg']);
  const pys = []; for(let y=0.085; y<=0.30; y+=0.0125) pys.push(y);
  luffyShell(pelvis, pys, y=>{ const T = TORSE(y); return {rx:T.rx+0.017, rz:T.rz+0.016, zc:T.zc}; }, 48, white,
    { bosses:(a,y)=> 1 + 0.018*Math.sin(a*9 + y*30), colAt:shortCol });
  const cuffs = P('revers', []);
  for(const s of ['Left','Right']){
    const sg = s==='Left' ? 1 : -1;
    const hp = B(s+'UpLeg'), kn = B(s+'Leg');
    const top = v3(sg*0.058, 0.15, 0.012), hem = hp.clone().lerp(kn, 0.86).add(v3(sg*0.012, 0, 0.004));
    const pts = []; for(let k=0;k<=8;k++){ const t = k/8; pts.push({ p: top.clone().lerp(hem, t), r: 0.066 + 0.018*t*t }); }
    const leg = P('short', ['Hips', s+'UpLeg', s+'Leg']);
    luffyTube(leg, pts, 26, white, { bosses:(i, a, t)=> 1 + (0.03 + 0.05*t)*Math.sin(a*6 + t*2), colAt:(i,a)=>shortCol(a, i*0.01) });
    // revers blanc duveteux : anneau épais à petites bosses
    const cp = P('revers', ['Hips', s+'UpLeg', s+'Leg']);
    const ring = [];
    const axis = hem.clone().sub(top).normalize();
    // profil arrondi (bourrelet) : le revers se retrousse, épais et moelleux
    const prof = [0.074, 0.090, 0.099, 0.101, 0.096, 0.082, 0.066];
    prof.forEach((r, k)=> ring.push({ p: hem.clone().addScaledVector(axis, -0.026 + k*0.009), r }));
    luffyTube(cp, ring, 48, white, { bosses:(i, a)=> 1 + 0.055*Math.pow(Math.abs(Math.sin(a*13 + i*0.7)), 0.7)*Math.sin(i/6*Math.PI) });
  }

  // ---------------- gilet rouge : ouvert, sans manches, mancherons effrangés ----------------
  const gilet = P('gilet', ['Hips','Spine','Chest','UpperChest','Neck']);
  const gys = []; for(let y=0.225; y<=0.548; y+=0.0115) gys.push(y);
  const ouverture = (y)=> 1.02 - 0.55*(y - 0.225);        // demi-angle de l'ouverture : gilet grand ouvert, plus large en bas
  luffyShell(gilet, gys, (y, t)=>{ const T = TORSE(y); const fl = 1 + 0.08*Math.pow(1-t, 2);
      return {rx:(T.rx+0.012)*fl, rz:(T.rz+0.012)*fl, zc:T.zc}; }, 56, white,
    { a0:y=>ouverture(y), a1:y=>Math.PI*2 - ouverture(y),
      dy:(a, y)=> y < 0.23 ? -0.012*Math.abs(Math.sin(a*7)) : 0,
      colAt:(a, y)=>{ const e = Math.min(Math.abs(a - ouverture(y)), Math.abs(Math.PI*2 - ouverture(y) - a)); return e < 0.09 ? [0.82,0.82,0.82] : [1,1,1]; } });
  // col rabattu autour du cou
  const col = P('gilet', ['UpperChest','Neck']);
  luffyShell(col, [0.528, 0.548, 0.566], (y, t)=>({ rx:0.076 + 0.012*(1-t), rz:0.064 + 0.01*(1-t), zc:0.0 }), 40, white,
    { a0:()=>0.62, a1:()=>Math.PI*2 - 0.62 });
  // mancherons : manches courtes, bord effrangé
  for(const s of ['Left','Right']){
    const sg = s==='Left' ? 1 : -1;
    const sh = B(s+'Arm'), el = B(s+'ForeArm');
    const sl = P('gilet', [s+'Shoulder', s+'Arm', 'UpperChest']);
    const a0 = v3(sg*0.06, sh.y+0.008, sh.z), a1 = sh.clone().lerp(el, 0.38);
    luffyTube(sl, [{p:a0, r:0.056}, {p:a0.clone().lerp(a1,0.5), r:0.058}, {p:a1, r:0.061}], 26, white,
      { bosses:(i, a)=> i===2 ? 1 + 0.12*Math.abs(Math.sin(a*5 + sg)) : 1 });
  }
  // quatre boutons dorés sur le pan droit (côté -x du personnage)
  const btn = P('bouton', ['Spine','Chest','UpperChest']);
  for(const y of [0.475, 0.425, 0.375, 0.325]){
    const a = Math.PI*2 - ouverture(y) - 0.2, T = TORSE(y);
    const sa = Math.sin(a), ca = Math.cos(a);
    const ex = Math.sign(sa)*Math.pow(Math.abs(sa), 2/2.4), ez = Math.sign(ca)*Math.pow(Math.abs(ca), 2/2.4);
    luffyEllipsoid(btn, v3((T.rx+0.016)*ex, y, T.zc + (T.rz+0.016)*ez), 0.0115, 0.0115, 0.0075, 12, 8, white);
  }

  // ---------------- écharpe jaune : nouée à gauche, long pan en drapeau ----------------
  const sash = P('echarpe', ['Hips','Spine']);
  const sys = []; for(let y=0.21; y<=0.295; y+=0.0085) sys.push(y);
  luffyShell(sash, sys, (y, t)=>{ const T = TORSE(y); return {rx:T.rx+0.036, rz:T.rz+0.032, zc:T.zc}; }, 60, white,
    { bosses:(a, y, t)=> 1 + 0.03*Math.sin(a*8 + t*5) + 0.02*Math.sin(t*Math.PI),
      colAt:(a, y)=>{ const f = 0.5 + 0.5*Math.sin(y*260 + a*2); return [0.86 + 0.14*f, 0.86 + 0.14*f, 0.86 + 0.14*f]; } });
  const knot = v3(0.132, 0.25, 0.06);
  luffyEllipsoid(sash, knot, 0.036, 0.03, 0.03, 16, 10, white);
  luffyEllipsoid(sash, knot.clone().add(v3(0.018, 0.02, -0.01)), 0.03, 0.022, 0.024, 14, 8, white);
  const tail = P('echarpe', ['Hips','LeftUpLeg']);
  { const base = tail.p.length/3, rows = 16, cols = 7;
    for(let r=0;r<rows;r++){
      const t = r/(rows-1), y = 0.245 - t*0.29;
      const w = 0.078 - 0.02*t;
      for(let c=0;c<cols;c++){
        const u = c/(cols-1) - 0.5;
        const wave = 0.012*Math.sin(t*5 + u*3) + 0.018*t*t;
        const torn = r === rows-1 ? (c%2 ? 0.02 : -0.012) : 0;
        luffyPush(tail, v3(0.148 + u*w*0.35 + 0.015*t, y + torn, 0.07 + u*w*0.9 + wave), [0.9 + 0.1*Math.cos(u*6), 0.9 + 0.1*Math.cos(u*6), 0.9]);
      }
    }
    for(let r=0;r<rows-1;r++) for(let c=0;c<cols-1;c++){
      const a = base + r*cols + c, b = a+1, cc = a+cols, d = cc+1;
      tail.i.push(a, b, cc, b, d, cc);    // une seule face : la matière est double face
    }
  }

  /* ---------------- assemblage ----------------
     DEUX maillages skinnés seulement (le visage, qui porte sa texture, et
     tout le reste), plus leurs deux contours. La première version faisait
     un maillage par matière : 12 maillages + 11 contours, chacun recalculé
     os par os à chaque image. Sur iPhone la cadence s'effondrait dès que la
     caméra tournait, et l'échelle de qualité baissait la résolution —
     l'image « cassée » constatée par l'animateur. La couleur de chaque
     pièce passe désormais par les couleurs de sommet, son émissif par un
     attribut (aEmi), la largeur de son contour par un autre (aOut) : rendu
     identique, 23 dessins skinnés ramenés à 4. */
  const grad = luffyGradient();
  const faceTex = { ouvert: drawLuffyFace('ouvert'), ferme: drawLuffyFace('ferme'), rire: drawLuffyFace('rire') };
  const COL = { peau:LUFFY_COL.peau, cheveux:LUFFY_COL.cheveux, gilet:LUFFY_COL.gilet, short:LUFFY_COL.short,
                revers:LUFFY_COL.revers, echarpe:LUFFY_COL.echarpe, bouton:LUFFY_COL.bouton, semelle:LUFFY_COL.semelle,
                laniere:LUFFY_COL.laniere, cicatrice:LUFFY_COL.cicatrice, visage:0xffffff };
  const EMI = { revers:0x3a3632, bouton:0x4a3400, cicatrice:0x3a1512 };
  const OUT_W = { visage:0.0055, peau:0.0045, cheveux:0.005, gilet:0.004, short:0.0045, revers:0.004, echarpe:0.004,
                  bouton:0.0022, semelle:0.003, laniere:0.0015, cicatrice:0 };
  const OUT_BASE = 0.0045;
  const withEmi = m=>{
    m.onBeforeCompile = sh=>{
      sh.vertexShader = 'attribute vec3 aEmi;\nvarying vec3 vEmi;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vEmi = aEmi;');
      sh.fragmentShader = 'varying vec3 vEmi;\n' + sh.fragmentShader.replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = emissive + vEmi;');
    };
    return m;
  };
  const MATS = {
    visage: new THREE.MeshToonMaterial({ map:faceTex.ouvert, gradientMap:grad }),
    corps: withEmi(new THREE.MeshToonMaterial({ color:0xffffff, gradientMap:grad, vertexColors:true, side:THREE.DoubleSide })),
  };
  const outlineMat = ()=>{
    const m = luffyOutlineMat(OUT_BASE/localScale);
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = sh=>{ prev(sh);
      sh.vertexShader = 'attribute float aOut;\n' + sh.vertexShader.replace('* uContour;', '* uContour * aOut;'); };
    return m;
  };
  const meshes = [];
  const pv = new THREE.Vector3(), cc = new THREE.Color(), ce = new THREE.Color();
  const groupes = { visage:['visage'], corps:Object.keys(parts).filter(k=>k!=='visage') };
  for(const [nom, mats] of Object.entries(groupes)){
    const pos = [], col = [], emi = [], out = [], uv = [], idx = [], idxOut = [], si = [], sw = [];
    for(const mat of mats) for(const pt of (parts[mat] || [])){
      const off = pos.length/3;
      const cand = pt.bones.filter(b=>SEG[b]);
      cc.set(COL[mat]); ce.set(EMI[mat] || 0x000000);
      const ow = OUT_W[mat]/OUT_BASE;
      for(let v=0; v<pt.p.length/3; v++){
        pv.set(pt.p[v*3], pt.p[v*3+1], pt.p[v*3+2]);
        // poids : inverse de la distance aux os candidats, puissance 4
        let ws = cand.map(b=>{ const d = segDist(pv, b); return [b, 1/Math.pow(d*d + 1e-5, 2)]; });
        ws.sort((a,b)=>b[1]-a[1]); ws = ws.slice(0, 4);
        let tot = ws.reduce((a,w)=>a+w[1], 0);
        const ids = [0,0,0,0], wts = [0,0,0,0];
        ws.forEach((w,k)=>{ ids[k] = Math.max(0, boneIdx(w[0])); wts[k] = w[1]/tot; });
        if(!ws.length){ ids[0] = Math.max(0, boneIdx('Hips')); wts[0] = 1; }
        pv.applyMatrix4(M);
        pos.push(pv.x, pv.y, pv.z);
        col.push(pt.c[v*3]*cc.r, pt.c[v*3+1]*cc.g, pt.c[v*3+2]*cc.b);
        emi.push(ce.r, ce.g, ce.b); out.push(ow);
        uv.push(pt.uv[v*2], pt.uv[v*2+1]);
        si.push(...ids); sw.push(...wts);
      }
      for(const k of pt.i) idx.push(k + off);
      if(ow > 0) for(const k of pt.i) idxOut.push(k + off);
    }
    if(!pos.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aEmi', new THREE.Float32BufferAttribute(emi, 3));
    g.setAttribute('aOut', new THREE.Float32BufferAttribute(out, 1));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.SkinnedMesh(g, MATS[nom]);
    m.name = 'luffy_' + nom;
    m.castShadow = true; m.frustumCulled = false;
    kSkin.parent.add(m);
    m.position.copy(kSkin.position); m.quaternion.copy(kSkin.quaternion); m.scale.copy(kSkin.scale);
    m.bind(skel, kSkin.bindMatrix);
    meshes.push(m);
    // contour : mêmes sommets, sans les pièces qui n'en ont pas (cicatrice)
    const go = new THREE.BufferGeometry();
    for(const k of Object.keys(g.attributes)) go.setAttribute(k, g.attributes[k]);
    go.setIndex(idxOut);
    const o = new THREE.SkinnedMesh(go, outlineMat());
    o.name = 'luffy_contour_' + nom; o.frustumCulled = false; o.userData.contour = true;
    kSkin.parent.add(o);
    o.position.copy(kSkin.position); o.quaternion.copy(kSkin.quaternion); o.scale.copy(kSkin.scale);
    o.bind(skel, kSkin.bindMatrix);
    meshes.push(o);
  }
  // ---------------- chapeau d'origine : paille tressée + contour ----------------
  for(const o of skins){
    const nm = (o.userData.nomOrigine || '').toLowerCase();
    if(nm === 'cap_red' || nm === 'hatband_red'){
      const band = nm === 'hatband_red';
      const hm = new THREE.MeshToonMaterial({ color: band ? 0xd01c24 : 0xe8c078, gradientMap:grad, side:THREE.DoubleSide });
      if(!band) hm.onBeforeCompile = sh=>{
        sh.vertexShader = 'varying vec3 vPaille;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vPaille = position;');
        sh.fragmentShader = 'varying vec3 vPaille;\n' + sh.fragmentShader.replace('#include <color_fragment>',
          `#include <color_fragment>
          float rr = length(vPaille.xz);
          float rang = sin(rr*70.0 + vPaille.y*70.0);
          float brin = sin(atan(vPaille.z, vPaille.x)*140.0 + rr*30.0);
          diffuseColor.rgb *= 0.90 + 0.07*smoothstep(-0.3, 0.9, rang) + 0.04*brin;`);
      };
      o.material = hm; o.visible = true;
      /* Chapeau d'origine, retaillé à la tête (voir ci-dessous) : sur un plateau vu en
         plongée, l'aile à plat recouvrait tout le personnage — on ne voyait
         qu'un disque de paille. Incliné comme Luffy le porte souvent, il
         dégage le visage. Rotation appliquée à la géométrie (100 % liée à
         l'os de la tête), autour du bord de la calotte. */
      if(!o.geometry.userData.penche){
        const g = o.geometry.clone();
        // pivot = centre de la tête : le chapeau glisse vers l'arrière sur
        // le crâne, comme un vrai chapeau repoussé, au lieu de flotter
        /* AJUSTÉ À LA TÊTE. Le chapeau d'origine était taillé pour la tête
           cube du pion Kenney : calotte de 31,7 cm de rayon pour un crâne de
           25,6, sommet 5 cm au-dessus des cheveux. Il flottait. On le
           retaille, sommet par sommet, dans le repère de mesure :
             - calotte resserrée (x 0,855) au tour de tête, cheveux compris ;
             - aile raccordée à la calotte, bord extérieur conservé (42 cm) ;
             - calotte moins haute (x 0,82), posée SUR le crâne ;
             - penché de 10° en arrière autour du centre du crâne, ce qui le
               garde au contact en dégageant le front. */
        const Sd = LUFFY_DESIGN.scale, Oy = LUFFY_DESIGN.offY;
        const Cc = new THREE.Vector3(0, 0.737, -0.032);        // centre de la calotte de cheveux
        const rot = new THREE.Matrix4().makeRotationX(-0.18);
        const pa = g.attributes.position, v = new THREE.Vector3();
        for(let k=0;k<pa.count;k++){
          v.set(pa.getX(k)*Sd, pa.getY(k)*Sd + Oy, pa.getZ(k)*Sd);
          const r = Math.hypot(v.x, v.z);
          const r2 = r <= 0.33 ? r*0.855 : 0.282 + (r - 0.33)*1.44;
          const q = r > 1e-6 ? r2/r : 0.855;
          v.x *= q; v.z *= q;
          if(v.y >= 0.93) v.y = 0.93 + (v.y - 0.93)*0.82;
          v.y -= 0.150; v.z += Cc.z + 0.012;
          v.sub(Cc).applyMatrix4(rot).add(Cc);
          pa.setXYZ(k, v.x/Sd, (v.y - Oy)/Sd, v.z/Sd);
        }
        pa.needsUpdate = true;
        g.computeVertexNormals();
        g.computeBoundingBox(); g.computeBoundingSphere();
        g.userData.penche = true;
        o.geometry = g;
      }
      const ol = new THREE.SkinnedMesh(o.geometry, luffyOutlineMat((band ? 0.003 : 0.0045)/localScale));
      ol.name = 'luffy_contour_chapeau'; ol.frustumCulled = false;
      o.parent.add(ol); ol.position.copy(o.position); ol.quaternion.copy(o.quaternion); ol.scale.copy(o.scale);
      ol.bind(o.skeleton, o.bindMatrix);
      meshes.push(ol);
    } else if(o.visible !== false){
      o.visible = false;      // corps en blocs, cheveux-caisson, écharpe et sandales d'origine
    }
  }
  // ---------------- clignement et rire (textures du visage) ----------------
  let closeFor = 0, nextIn = 1.8 + Math.random()*2.5, burst = 0, rire = 0;
  const setFace = t=>{ if(MATS.visage.map !== t){ MATS.visage.map = t; } };
  const blink = {
    update(dt){
      if(rire > 0){ rire -= dt; setFace(faceTex.rire); return; }
      if(closeFor > 0){
        closeFor -= dt;
        if(closeFor <= 0){ setFace(faceTex.ouvert); if(burst > 0){ burst--; nextIn = 0.12; } else nextIn = 1.1 - Math.log(Math.random()+1e-6)*2.6; }
        return;
      }
      setFace(faceTex.ouvert);
      nextIn -= dt;
      if(nextIn <= 0){ setFace(faceTex.ferme); closeFor = 0.09 + Math.random()*0.05; if(burst===0 && Math.random()<0.18) burst = 1; }
    },
    rire(sec){ rire = Math.max(rire, sec || 2.5); },
  };
  return { blink, meshes };
}

const player = createPlayer();
scene.add(player.root);
loadPlayerModel(player).catch(err=>{
  console.error('Chargement du personnage 3D échoué, le plateau continue sans lui :', err);
});




/* ---------- État de jeu ---------- */
let currentIndex = -1; // -1 = au départ, pas encore sur le plateau
let moving = false;
/* Déclarées ICI (et non près de leur usage) : animate() les lit dès sa
   première image, qui tourne pendant le chargement du module — une
   déclaration plus bas lèverait une erreur de zone morte temporelle. */
let drawInProgress = false;   // du clic « tirer » jusqu'au début du déplacement
let celebRAF = null;          // boucle de la célébration en cours
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
/* Touches programmées (Z, 1 à 6 = lot forcé) SUPPRIMÉES du code à la
   demande de l'animateur (23/09) : aucune touche ne peut plus décider d'un
   lot, tout sort de la pochette. forcedGame ne sert plus qu'à la page de
   démonstration du jackpot (partie hors pochette et hors comptabilité). */
let forcedGame = false;

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

/* pop = rebond « ressort » de la case (0,16 d'amplitude, 3 Hz). Seulement
   à l'ARRIVÉE : pendant la marche, le pion suit la hauteur de la case sous
   ses pieds, et ce rebond sur chaque case traversée le faisait sautiller
   — la marche « pas fluide » constatée par l'animateur. */
function setActive(index, pop = true){
  tiles.forEach((t,i)=>{
    const wasActive = t.isActive;
    t.isActive = (i===index);
    // visible=false, pas seulement opacity=0 : un objet transparent
    // d'opacité nulle est quand même trié et dessiné à chaque image.
    // 39 halos sur 40 étaient ainsi rendus pour rien.
    if(!t.isActive){ t.halo.material.opacity = 0; t.halo.visible = false; }
    else if(!wasActive && pop){ t.popT0 = clock.getElapsedTime(); }
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
/* GAIT est relevé sur le pion à sa taille d'ALORS (0,82) : ses cotes sont
   donc dans le repère du modèle, pas du plateau. Depuis que le pion mesure
   1,12 (Luffy sculpté, 23/09), ses jambes balaient 1,37 fois plus de
   plateau par pas que ce que le moteur de déplacement faisait avancer le
   corps : les pieds patinaient vers l'arrière et les pas paraissaient
   minuscules et précipités (« il fourmille », constaté par l'animateur).
   Tout ce qui passe du repère du modèle au plateau (distance parcourue par
   cycle, descente du bassin) est multiplié par GAIT_K ; la cinématique
   inverse, elle, reste dans le repère du modèle. */
const GAIT_K = PLAYER_TARGET_HEIGHT / 0.82;
const strideForSpeed = sp => GAIT.stride(sp) * GAIT_K;
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
/* 1,50–2,05 cases/s faisait 4,5 à 6 pas par seconde : un trottinement.
   Avec la foulée recalée (GAIT_K) et cette plage, 2,7 à 3,7 pas/s. */
const WALK_V_MIN = 1.25, WALK_V_MAX = 1.75;
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
    /* Allure variable d'un trajet à l'autre (±15 %), en plus de la
       longueur : deux trajets de même longueur n'ont pas la même durée. */
    const v = Math.min(WALK_V_MAX, WALK_V_MIN + (steps-1)*0.20) * (0.87 + Math.random()*0.28);
    stepDuration = 1/v;
  }
  const vCruise = steps>0 ? 1/stepDuration : 0;
  // rampes courtes : 0,3 case au départ et à l'arrivée, sinon les premiers
  // et derniers pas s'étirent et la cadence paraît irrégulière
  // rampes (démarrage et ralentissement final) variables : 0,30 à 0,45 case
  const rampUnits = Math.min(forcedFast ? 0.3 : 0.30 + Math.random()*0.15, steps/2);
  const accelTime = rampUnits>0 ? (2*rampUnits)/vCruise : 0;
  const cruiseUnits = steps - 2*rampUnits;
  const cruiseTime = vCruise>0 ? cruiseUnits/vCruise : 0;
  const prepTime = steps>0 ? (forcedFast ? 0.22 : 0.14 + Math.random()*0.22) : 0;
  const settleTime = steps>0 ? (forcedFast ? 0.34 : 0.28 + Math.random()*0.16) : 0;
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

/* ---------- Flammes et gerbes d'étoiles à l'arrivée sur une case ----------
   Pourquoi ce système existe séparément de tout le reste :

   1. L'arrivée du pion était le moment le plus pauvre du jeu. celebrate()
      n'y est PAS appelé — seul showLotPreview() pose une photo figée, et
      tout le spectacle (fusées, éclairs, confettis, rayons) est différé à
      la validation par l'animateur. Entre les deux, il ne se passait qu'un
      anneau d'une seconde et quelques étincelles.
   2. On ne peut PAS alimenter celebParticles / celebEndAt depuis l'arrivée :
      quand la boucle celebFrame() s'épuise, elle retire les classes de
      l'annonce si celebLocked est faux — or showLotPreview() le remet à
      faux. L'aperçu du lot s'effacerait donc tout seul quelques secondes
      après l'arrivée, ce qui casse l'invariant n°1.
   3. On ne peut pas non plus passer par spawnSparkles : son pool ne tient
      que 48 sprites et il est partagé avec la marche et l'orage. Des
      flammes continues le videraient en une demi-seconde.

   D'où un système autonome, sur le modèle de goldRain : deux THREE.Points
   à particules recyclées, un seul appel de dessin chacun, aucune
   allocation par image, et aucun contact avec le DOM de célébration. */

function makeEmberTexture(){
  const n = 64, c = document.createElement('canvas'); c.width = c.height = n;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(n/2, n/2, 0, n/2, n/2, n/2);
  g.addColorStop(0,    'rgba(255,255,245,1)');
  g.addColorStop(0.22, 'rgba(255,224,150,0.95)');
  g.addColorStop(0.48, 'rgba(255,140,40,0.55)');
  g.addColorStop(0.78, 'rgba(190,50,10,0.18)');
  g.addColorStop(1,    'rgba(120,20,0,0)');
  x.fillStyle = g; x.fillRect(0,0,n,n);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function makeStarTexture(){
  const n = 64, c = document.createElement('canvas'); c.width = c.height = n;
  const x = c.getContext('2d');
  // halo doux
  const g = x.createRadialGradient(n/2, n/2, 0, n/2, n/2, n/2);
  g.addColorStop(0, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.3, 'rgba(255,235,170,0.22)');
  g.addColorStop(1, 'rgba(255,200,90,0)');
  x.fillStyle = g; x.fillRect(0,0,n,n);
  // quatre branches
  x.translate(n/2, n/2);
  x.fillStyle = '#fffdf2';
  for(let k=0;k<2;k++){
    x.beginPath();
    x.moveTo(0, -n*0.48); x.quadraticCurveTo(n*0.06, -n*0.06, n*0.44, 0);
    x.quadraticCurveTo(n*0.06, n*0.06, 0, n*0.48);
    x.quadraticCurveTo(-n*0.06, n*0.06, -n*0.44, 0);
    x.quadraticCurveTo(-n*0.06, -n*0.06, 0, -n*0.48);
    x.fill();
    x.rotate(Math.PI/4); x.scale(0.55, 0.55);   // seconde croix, plus petite
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function makeSmokeTexture(){
  const n = 96, c = document.createElement('canvas'); c.width = c.height = n;
  const x = c.getContext('2d');
  /* Bouffée de fumée : un noyau doux, puis trois lobes décalés pour casser
     le cercle parfait — une fumée parfaitement ronde se lit comme une
     tache, pas comme de la fumée. */
  const lobe = (cx, cy, r, a)=>{
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0,   'rgba(255,255,255,'+a+')');
    g.addColorStop(0.45,'rgba(255,255,255,'+(a*0.55)+')');
    g.addColorStop(1,   'rgba(255,255,255,0)');
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI*2); x.fill();
  };
  lobe(n*0.50, n*0.52, n*0.42, 0.85);
  lobe(n*0.36, n*0.42, n*0.26, 0.55);
  lobe(n*0.63, n*0.44, n*0.24, 0.50);
  lobe(n*0.52, n*0.66, n*0.22, 0.45);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/* Matériau commun : taille, couleur et opacité PAR PARTICULE, ce que
   THREE.PointsMaterial ne sait pas faire (une seule taille pour tout le
   nuage). Une dizaine de lignes de shader évitent d'avoir à créer un
   sprite par particule — donc un seul appel de dessin au lieu de cent. */
function makeFxPointsMaterial(map){
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, uProj: { value: 1000 } },

    vertexShader: `
      attribute float aSize;
      attribute float aAlpha;
      attribute vec3  aColor;
      uniform float uProj;
      varying float vAlpha;
      varying vec3  vColor;
      void main(){
        vAlpha = aAlpha; vColor = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        // aSize est une taille en UNITES DU MONDE (1.0 = une case entiere).
        // uProj = hauteur du rendu / (2*tan(fov/2)) : c'est le seul facteur
        // correct pour convertir une taille monde en pixels. Un premier jet
        // utilisait une constante arbitraire de 320, ce qui donnait des
        // particules de ~570 px : l'ecran virait au blanc pur en fusion
        // additive des la premiere gerbe.
        gl_PointSize = clamp(aSize * uProj / max(0.001, -mv.z), 1.0, 160.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D map;
      varying float vAlpha;
      varying vec3  vColor;
      void main(){
        vec4 t = texture2D(map, gl_PointCoord);
        if(t.a < 0.01) discard;
        gl_FragColor = vec4(vColor, 1.0) * t * vAlpha;
      }`,
    transparent: true, depthWrite: false,
    /* Fusion additive sur la COULEUR, mais surtout PAS sur l'alpha.

       Le rendu 3D se fait sur un canvas transparent (renderer alpha:true)
       et la photo de fond est une image CSS posée DERRIERE ce canvas. Une
       AdditiveBlending standard ajoute aussi dans la couche alpha : la ou
       les particules passent, le canvas devient opaque, la photo se
       retrouve masquee, et on voit le vide sombre de la scene — une
       ellipse NOIRE suivait donc chaque bouffee. Mesure faite : le pixel
       sortait a (1,1,1).

       On garde donc SrcAlpha/One sur la couleur, et Zero/One sur l'alpha :
       la destination alpha n'est jamais modifiee, le canvas reste aussi
       transparent qu'avant et la photo continue de se voir au travers. */
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
}

const FX_FLAME_MAX = 170, FX_STAR_MAX = 130, FX_SMOKE_MAX = 110;
function makeFxSystem(count, map){
  const geo = new THREE.BufferGeometry();
  const pos   = new Float32Array(count*3);
  const col   = new Float32Array(count*3);
  const size  = new Float32Array(count);
  const alpha = new Float32Array(count);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor',   new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize',    new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aAlpha',   new THREE.BufferAttribute(alpha, 1));
  // évite que three ne culle le nuage quand toutes les particules sont
  // repliées à l'origine entre deux gerbes
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0,1,0), 40);
  const pts = new THREE.Points(geo, makeFxPointsMaterial(map));
  pts.frustumCulled = false;
  pts.visible = false;
  scene.add(pts);
  const state = Array.from({length:count}, ()=>({ vx:0, vy:0, vz:0, life:0, max:1, spin:0, base:1 }));
  return { pts, geo, pos, col, size, alpha, state, count, live:0 };
}
const fxFlames = makeFxSystem(FX_FLAME_MAX, makeEmberTexture());
const fxStars  = makeFxSystem(FX_STAR_MAX,  makeStarTexture());
/* Fumée en fusion ADDITIVE, comme les deux autres, et non en mélange
   normal comme on pourrait le croire.

   Raison : le rendu 3D se fait sur un canvas TRANSPARENT (le renderer est
   créé avec alpha:true) et la photo de fond est une image CSS posée
   DERRIÈRE ce canvas — elle n'est pas dans la scène. Une fumée en mélange
   normal se mélangerait donc au vide de la cible de rendu, pas à la photo :
   mesuré, elle sortait en noir pur (1,1,1) au lieu de gris.

   Une fumée additive et sombre se lit de toute façon très bien : près d'un
   feu, un panache EST éclairé par les flammes. On reste donc en additif,
   avec une couleur volontairement basse pour rester un voile et non une
   source lumineuse. Dessinée avant les braises (renderOrder), pour que les
   étincelles passent devant le panache au lieu de s'y noyer. */
const fxSmoke  = makeFxSystem(FX_SMOKE_MAX, makeSmokeTexture());
fxSmoke.pts.renderOrder = -1;

/* Budget dégressif : le mode éco coupe tout, et la qualité dégradée
   réduit le nombre de particules au lieu de faire ramer l'appareil. */
function fxBudget(n){
  if(reduceMotion || ecoMode) return 0;
  const lv = (typeof QUALITY === 'object' && QUALITY) ? (QUALITY.level|0) : 0;
  if(lv >= 5) return 0;
  if(lv >= 3) return Math.round(n*0.45);
  if(lv >= 1) return Math.round(n*0.75);
  return n;
}

function fxEmit(sys, i, x, y, z, p){
  sys.pos[i*3] = x; sys.pos[i*3+1] = y; sys.pos[i*3+2] = z;
  sys.col[i*3] = p.r; sys.col[i*3+1] = p.g; sys.col[i*3+2] = p.b;
  sys.size[i] = p.size; sys.alpha[i] = 1;
  const st = sys.state[i];
  st.vx = p.vx; st.vy = p.vy; st.vz = p.vz;
  st.life = 0; st.max = p.max; st.base = p.size; st.spin = p.spin || 0;
}

/* Gerbe d'arrivée, graduée par le palier du lot (TIER_LEVEL 1 à 5).
   Même le palier 1 reçoit quelque chose : c'est la majorité des parties,
   et c'était jusqu'ici le moment le plus terne du jeu. */
function spawnArrivalFx(x, y, z, level){
  const lvl = Math.max(1, Math.min(5, level|0));
  const nF = fxBudget(Math.round(26 + lvl*26));
  const nS = fxBudget(Math.round(16 + lvl*20));
  if(!nF && !nS) return;

  for(let k=0;k<nF;k++){
    const i = (fxFlames.live + k) % fxFlames.count;
    const a = Math.random()*Math.PI*2;
    // gerbe plus large : le feu doit deborder de la case, pas tenir dessus
    const r = Math.random()*0.52;
    const up = 2.1 + Math.random()*2.0 + lvl*0.34;
    // du blanc-jaune au coeur vers l'orange profond en périphérie
    const heat = 1 - Math.random()*0.55;
    fxEmit(fxFlames, i, x + Math.cos(a)*r, y + 0.06, z + Math.sin(a)*r, {
      vx: Math.cos(a)*(0.45 + Math.random()*0.85),
      vy: up,
      vz: Math.sin(a)*(0.45 + Math.random()*0.85),
      r: 1.0, g: 0.42 + heat*0.42, b: 0.10 + heat*0.26,
      size: 0.135 + Math.random()*0.165 + lvl*0.030,
      max: 0.75 + Math.random()*0.70,
    });
  }
  fxFlames.live = (fxFlames.live + nF) % fxFlames.count;
  if(nF) fxFlames.pts.visible = true;

  for(let k=0;k<nS;k++){
    const i = (fxStars.live + k) % fxStars.count;
    const a = Math.random()*Math.PI*2;
    // dôme : plutôt vers le haut, jamais sous le plateau
    const el = 0.35 + Math.random()*1.0;
    const spd = 2.6 + Math.random()*3.2 + lvl*0.48;
    fxEmit(fxStars, i, x, y + 0.18, z, {
      vx: Math.cos(a)*Math.cos(el)*spd,
      vy: Math.sin(el)*spd*1.15,
      vz: Math.sin(a)*Math.cos(el)*spd,
      r: 1.0, g: 0.92 + Math.random()*0.08, b: 0.62 + Math.random()*0.32,
      size: 0.115 + Math.random()*0.130 + lvl*0.030,
      max: 0.9 + Math.random()*0.8 + lvl*0.12,
      spin: 4 + Math.random()*7,
    });
  }
  fxStars.live = (fxStars.live + nS) % fxStars.count;
  if(nS) fxStars.pts.visible = true;

  /* Panache de fumée sous la gerbe : sans lui, les braises partent d'un
     point vide. Avec, l'explosion a un pied. */
  const nK = fxBudget(Math.round(9 + lvl*9));
  for(let k=0;k<nK;k++){
    const i = (fxSmoke.live + k) % fxSmoke.count;
    const a = Math.random()*Math.PI*2;
    const gris = 0.15 + Math.random()*0.12;
    fxEmit(fxSmoke, i, x + Math.cos(a)*Math.random()*0.42, y + 0.05, z + Math.sin(a)*Math.random()*0.42, {
      vx: Math.cos(a)*(0.50 + Math.random()*0.70),
      vy: 0.70 + Math.random()*0.80,
      vz: Math.sin(a)*(0.50 + Math.random()*0.70),
      r: gris*1.30, g: gris*1.02, b: gris*0.80,
      size: 0.15 + Math.random()*0.13 + lvl*0.016,
      max: 1.15 + Math.random()*0.85,
    });
  }
  fxSmoke.live = (fxSmoke.live + nK) % fxSmoke.count;
  if(nK) fxSmoke.pts.visible = true;
}

/* ---------- Traînée de braises et d'étoiles derrière le pion ----------
   Émission continue sous les pieds pendant la marche, sur les mêmes deux
   systèmes que la gerbe d'arrivée : rien de neuf à allouer, et le pool se
   recycle tout seul (les particules de traînée vivent moins d'une demi-
   seconde, elles ont disparu bien avant la gerbe d'arrivée).

   Le débit est proportionnel à l'amplitude de la foulée : le pion laisse
   une vraie traînée quand il court, presque rien quand il s'arrête. Un
   accumulateur convertit le débit (particules par seconde) en nombre
   entier par image, pour que la traînée soit identique à 30 et à 120 i/s. */
let _trailAcc = 0;
function spawnTrailFx(x, y, z, dt, intensity){
  if(reduceMotion || ecoMode){ _trailAcc = 0; return; }
  const lv = (typeof QUALITY === 'object' && QUALITY) ? (QUALITY.level|0) : 0;
  if(lv >= 4){ _trailAcc = 0; return; }        // appareil déjà à la peine
  const k = Math.max(0, Math.min(1, intensity));
  if(k < 0.05){ _trailAcc = 0; return; }
  const rate = (lv >= 2 ? 58 : 105) * k;
  _trailAcc += dt * rate;
  let n = Math.floor(_trailAcc);
  if(n <= 0) return;
  _trailAcc -= n;
  if(n > 10) n = 10;                            // garde-fou anti-rafale

  let nf = 0, ns = 0, nk = 0;
  for(let c=0;c<n;c++){
    const a = Math.random()*Math.PI*2;
    const r = Math.random()*0.20;

    /* Une bouffée de fumée sur deux émissions. C'est elle qui donne le
       volume : des braises seules font des points qui montent, la fumée
       leur donne un panache auquel s'accrocher. Elle part un peu plus bas
       et un peu en retrait, comme si elle etait laissée sur place. */
    if(c % 2 === 0){
      const i = (fxSmoke.live + nk) % fxSmoke.count; nk++;
      const gris = 0.13 + Math.random()*0.10;
      fxEmit(fxSmoke, i, x + Math.cos(a)*r*1.4, y + 0.06, z + Math.sin(a)*r*1.4, {
        vx: Math.cos(a)*0.24, vy: 0.42 + Math.random()*0.42, vz: Math.sin(a)*0.24,
        // voile légèrement chaud : il sort d'un feu, pas d'un pot d'échappement
        r: gris*1.30, g: gris*1.02, b: gris*0.80,
        size: 0.11 + Math.random()*0.09,
        max: 0.95 + Math.random()*0.75,
      });
      fxSmoke.pts.visible = true;
    }

    // une étoile de temps en temps au milieu des braises, pour scintiller
    if(Math.random() < 0.26){
      const i = (fxStars.live + ns) % fxStars.count; ns++;
      fxEmit(fxStars, i, x + Math.cos(a)*r, y + 0.12 + Math.random()*0.26, z + Math.sin(a)*r, {
        vx: Math.cos(a)*0.40, vy: 0.70 + Math.random()*0.70, vz: Math.sin(a)*0.40,
        r: 1.0, g: 0.94, b: 0.72 + Math.random()*0.24,
        size: 0.115 + Math.random()*0.090,
        max: 0.60 + Math.random()*0.45,
        spin: 6 + Math.random()*6,
      });
      fxStars.pts.visible = true;
    } else {
      const i = (fxFlames.live + nf) % fxFlames.count; nf++;
      const heat = 1 - Math.random()*0.5;
      fxEmit(fxFlames, i, x + Math.cos(a)*r, y + 0.05, z + Math.sin(a)*r, {
        vx: Math.cos(a)*0.26, vy: 0.85 + Math.random()*0.85, vz: Math.sin(a)*0.26,
        r: 1.0, g: 0.40 + heat*0.40, b: 0.08 + heat*0.20,
        size: 0.115 + Math.random()*0.110,
        max: 0.50 + Math.random()*0.40,
      });
      fxFlames.pts.visible = true;
    }
  }
  fxFlames.live = (fxFlames.live + nf) % fxFlames.count;
  fxStars.live  = (fxStars.live  + ns) % fxStars.count;
  fxSmoke.live  = (fxSmoke.live  + nk) % fxSmoke.count;
}

function updateFxSystem(sys, dt, gravity, drag, shrink){
  let any = false;
  for(let i=0;i<sys.count;i++){
    const st = sys.state[i];
    if(st.life >= st.max){ if(sys.alpha[i] !== 0) sys.alpha[i] = 0; continue; }
    st.life += dt;
    const u = Math.min(1, st.life/st.max);
    st.vy += gravity*dt;
    const d = Math.max(0, 1 - drag*dt);
    st.vx *= d; st.vz *= d;
    sys.pos[i*3]   += st.vx*dt;
    sys.pos[i*3+1] += st.vy*dt;
    sys.pos[i*3+2] += st.vz*dt;
    // fondu : montée très courte, extinction longue
    sys.alpha[i] = Math.min(1, u/0.12) * (1-u) * (1-u);
    sys.size[i]  = st.base * (1 - shrink*u) * (st.spin ? (1 + 0.28*Math.sin(st.life*st.spin)) : 1);
    any = true;
  }
  sys.geo.attributes.position.needsUpdate = true;
  sys.geo.attributes.aAlpha.needsUpdate = true;
  sys.geo.attributes.aSize.needsUpdate = true;
  sys.geo.attributes.aColor.needsUpdate = true;
  if(!any) sys.pts.visible = false;
}
/* ---------- Saut de victoire : detente, salto, colonne de feu ----------
   Declenche a l'arrivee sur un lot a partir du palier 3. La hauteur, la
   duree et le nombre de saltos montent avec l'enjeu : une pirouette sur un
   Tripack, deux saltos et un envol dans une colonne de feu sur le jackpot. */
let victoire = null, _colAcc = 0;
let idleFor = 0;   // temps passé immobile (voir « se tourne vers le public »)
function startVictoryJump(level){
  if(reduceMotion || !player || !player.root) return;
  const lvl = Math.max(1, Math.min(5, level|0));
  victoire = {
    t0: clock.getElapsedTime(),
    dur: 1.05 + lvl*0.30,
    haut: 0.75 + lvl*0.62,
    tours: lvl >= 5 ? 2 : 1,
    lvl,
    x: player.root.position.x, y: player.root.position.y, z: player.root.position.z,
  };
  _colAcc = 0;
  if(player.playJump) player.playJump();
  cameraPunch(0.9 + lvl*0.22);
}
function spawnFireColumn(x, y0, z, hauteur, lvl, dt){
  if(reduceMotion || ecoMode) return;
  const lv = (typeof QUALITY === 'object' && QUALITY) ? (QUALITY.level|0) : 0;
  if(lv >= 4) return;
  _colAcc += dt * (lv >= 2 ? 70 : 130);
  let n = Math.floor(_colAcc);
  if(n <= 0) return;
  _colAcc -= n;
  if(n > 14) n = 14;
  const H = Math.max(0.30, hauteur + 0.45);
  let nf = 0, nk = 0, ns = 0;
  for(let k=0;k<n;k++){
    const a = Math.random()*Math.PI*2;
    // rayon plus large a la base qu'au sommet : une colonne, pas un tube
    const hy = Math.random()*H;
    const serre = 1 - 0.55*(hy/H);
    const r = (0.14 + Math.random()*0.26) * serre;
    const px = x + Math.cos(a)*r, pz = z + Math.sin(a)*r;

    if(k % 3 === 0){
      const i = (fxSmoke.live + nk) % fxSmoke.count; nk++;
      const gris = 0.14 + Math.random()*0.11;
      fxEmit(fxSmoke, i, px, y0 + hy, pz, {
        vx: Math.cos(a)*0.30, vy: 0.90 + Math.random()*0.80, vz: Math.sin(a)*0.30,
        r: gris*1.30, g: gris*1.02, b: gris*0.80,
        size: 0.17 + Math.random()*0.15, max: 1.0 + Math.random()*0.8,
      });
      fxSmoke.pts.visible = true;
    } else if(Math.random() < 0.22){
      const i = (fxStars.live + ns) % fxStars.count; ns++;
      fxEmit(fxStars, i, px, y0 + hy, pz, {
        vx: Math.cos(a)*0.55, vy: 1.4 + Math.random()*1.4, vz: Math.sin(a)*0.55,
        r: 1.0, g: 0.95, b: 0.75 + Math.random()*0.22,
        size: 0.12 + Math.random()*0.10, max: 0.7 + Math.random()*0.5,
        spin: 7 + Math.random()*7,
      });
      fxStars.pts.visible = true;
    } else {
      const i = (fxFlames.live + nf) % fxFlames.count; nf++;
      const heat = 1 - Math.random()*0.45;
      fxEmit(fxFlames, i, px, y0 + hy, pz, {
        vx: Math.cos(a)*0.30, vy: 1.7 + Math.random()*1.7 + lvl*0.18, vz: Math.sin(a)*0.30,
        r: 1.0, g: 0.42 + heat*0.42, b: 0.09 + heat*0.22,
        size: 0.13 + Math.random()*0.13 + lvl*0.014, max: 0.55 + Math.random()*0.45,
      });
      fxFlames.pts.visible = true;
    }
  }
  fxFlames.live = (fxFlames.live + nf) % fxFlames.count;
  fxStars.live  = (fxStars.live  + ns) % fxStars.count;
  fxSmoke.live  = (fxSmoke.live  + nk) % fxSmoke.count;
}
/* Appele en TOUTE FIN de frameStep : la boucle de marche ecrit la position
   du pion a chaque image, donc toute elevation posee avant serait ecrasee. */
function updateVictory(t, dt){
  if(!victoire) return;
  const u = (t - victoire.t0) / victoire.dur;
  if(u >= 1){
    player.root.position.y = victoire.y;
    if(player.flip) player.flip.rotation.x = 0;
    victoire = null;
    return;
  }
  // montee franche, suspension au sommet, retombee amortie
  const arc = Math.sin(Math.PI * Math.pow(Math.max(0, u), 0.76));
  player.root.position.y = victoire.y + arc * victoire.haut;
  if(player.flip){
    const e = u*u*(3 - 2*u);               // lissage en S : depart et arrivee nets
    player.flip.rotation.x = -victoire.tours * Math.PI * 2 * e;
  }
  spawnFireColumn(victoire.x, victoire.y, victoire.z,
                  player.root.position.y - victoire.y, victoire.lvl, dt);
}

function updateArrivalFx(dt){
  // les flammes montent (gravité positive) et s'éteignent en rétrécissant ;
  // les étoiles retombent et scintillent ; la fumée monte lentement et
  // GROSSIT en se diluant — d'où un « rétrécissement » négatif
  if(fxSmoke.pts.visible)  updateFxSystem(fxSmoke,  dt,  0.42, 2.6, -1.35);
  if(fxFlames.pts.visible) updateFxSystem(fxFlames, dt,  1.15, 1.9, 0.62);
  if(fxStars.pts.visible)  updateFxSystem(fxStars,  dt, -3.10, 0.5, 0.35);
}
/* Coupure nette : appelée au redémarrage d'une partie pour qu'aucune
   braise ne survive à un C. */
function clearArrivalFx(){
  [fxFlames, fxStars, fxSmoke].forEach(sys=>{
    for(let i=0;i<sys.count;i++){ sys.state[i].life = sys.state[i].max; sys.alpha[i] = 0; }
    sys.geo.attributes.aAlpha.needsUpdate = true;
    sys.pts.visible = false;
  });
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
  // mode éco : pas d'étincelles d'ambiance en continu (décoration pure,
  // et chaque étincelle est un sprite transparent de plus à dessiner)
  if(reduceMotion || ecoMode || !SHOW_GLOW_POINTS) return;
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
  /* Orage du jackpot : la caméra tourne autour du pion (vitesse
     cineSpin, qui s'emballe à chaque coup de foudre), un peu plus haut
     et plus loin que le gros plan pour voir la foudre tomber du ciel. */
  orbit:   { dist:  5.2, elev: 0.34, aim: 1.00, lead: 0.00, side: 0.00, ease: 2.4, aimY: 0.75 },
};
cineMode = null;              // null | 'travel' | 'closeup' | 'orbit' (déclaré plus haut, près du cadrage caméra)
let cineSpin = 0;             // rad/s, mode orbit uniquement
cineBlend = 0;                // 0 = vue plateau, 1 = vue cinéma
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
  else if(cineMode === 'orbit') cineAz += dt*cineSpin;
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
    controls.update(dt);   // en secondes : la rotation auto garde sa vitesse à 30 i/s
    updateCornerSafety(dt);
  }
  updateSparkles(dt);
  updateArrivalFx(dt);
  updateGoldRain(t, dt);
  updateStorm(t, dt);
  updateAmbientSparkles(dt);

  // en mode éco les loupiotes sont masquées : inutile de les animer
  if(!ecoMode && SHOW_GLOW_POINTS) trimLights.forEach(tl=>{
    tl.spr.material.opacity = reduceMotion ? 0.5 : 0.28 + 0.45*Math.max(0, Math.sin(t*2.2 - tl.idx*0.5));
  });
  if(!reduceMotion && !ecoMode && SHOW_GLOW_POINTS){
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
      posY += stormWaveOffset(tile, t);
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
      tile.halo.visible = true;
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
    const bob = (-crouch + osc) * GAIT_K;   // repère modèle -> plateau (voir GAIT_K)

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
    // traînée de braises et d'étoiles sous les pieds, d'autant plus fournie
    // que la foulée est ample — rien quand il est presque à l'arrêt
    spawnTrailFx(x, aTile.tileTopY + surf, z, dt, gaitAmp * 1.15);

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
      setActive(currentIndex, false);   // case traversée : pas de rebond
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
        // flammes + gerbe d'étoiles, graduées par le palier du lot
        spawnArrivalFx(landedTile.world.x, landedTile.tileTopY, landedTile.world.z, lvl);
        /* À partir du palier 3 (Tripack et au-dessus), il ne se contente
           plus d'arriver : il saute, fait un salto et s'envole dans une
           colonne de feu. Deux saltos sur le jackpot. */
        // (sur le jackpot, c'est l'enlèvement dans le faisceau qui fait le spectacle)
        if(lvl >= 3 && landedTile.catKey !== 'jackpot300') startVictoryJump(lvl);
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
  /* Au repos, Luffy se tourne vers le public. Il gardait le cap de sa
     dernière marche, souvent dos à la caméra : vu en plongée, on ne voyait
     alors qu'un chapeau. Il pivote en douceur, une seconde après l'arrêt,
     sans jamais contrarier la marche, le saut de victoire ni un gros plan. */
  if(!walk && !victoire && cineMode === null){
    idleFor += dt;
    if(idleFor > 0.9){
      const face = Math.atan2(camera.position.x - player.root.position.x, camera.position.z - player.root.position.z);
      let d = face - player.root.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      player.root.rotation.y += d * Math.min(1, dt*1.6);
    }
  } else idleFor = 0;

  // Secousse "gros lot" (tripack / coffret) : décroît puis se remet à plat
  if(hypeShakeUntil>0 && shatterUntil===0){
    if(t < hypeShakeUntil){
      const mag = Math.min(1, (hypeShakeUntil-t)/0.5) * hypeShakeMag;
      boardGroup.position.set((Math.random()-0.5)*mag, 0, (Math.random()-0.5)*mag);
      boardGroup.rotation.z = (Math.random()-0.5)*mag*0.15;
    } else {
      boardGroup.position.set(0,0,0); boardGroup.rotation.z = 0; hypeShakeUntil = 0;
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

  /* Saut de victoire : EN DERNIER, juste avant le rendu. La boucle de
     marche écrit player.root.position à chaque image ; toute élévation
     posée plus haut dans frameStep serait donc écrasée avant l'affichage. */
  updateVictory(t, dt);
  // enlèvement dans le faisceau (finale) : appliqué en dernier, comme le saut
  if(storm && storm.lift) player.root.position.y += storm.lift;

  composer.render();
}

/* ---------- Qualité adaptative ----------
   Mesuré : le flou lumineux (bloom) coûte à lui seul ~17 fois le reste
   du rendu, et son coût grimpe avec la résolution. Il est donc calculé
   d'office en demi-résolution (comparé image par image : indiscernable,
   un flou reste un flou). Si la cadence réelle reste sous ~45 images/s
   pendant ~1,5 s, on descend d'un cran, cran par cran, jamais plus d'un
   toutes les 2 s, sans jamais remonter (pas d'oscillation) :
     1. rendu à 1,25x max au lieu de 1,5x
     2. rendu à 1x
     3. bloom en quart de résolution
   Le jeu, les règles, les animations et les lots ne changent pas. */
/* `base` = cran de depart choisi pour cet appareil : la remontee
   automatique ne va JAMAIS au-dessus (un telephone qui demarre au cran 3
   n'a aucune raison de tenter le cran 0). `floor` monte d'un cran chaque
   fois qu'on redescend depuis un cran deja repris : sans ca, un appareil
   juste a la limite oscillerait indefiniment entre deux crans. */
const QUALITY = { level:0, base:0, floor:0, triedUp:null, samples:0, slow:0, fast:0, last:0, armedAt:0 };
const QUALITY_LEVELS = 5;
/* Cran 5, « mode éco » — pour les téléphones et les petites configs, où
   la cadence restait mauvaise même tout en bas de l'échelle précédente.
   Mesuré sur la scène : 380 appels de dessin par image, dont 117 sprites
   décoratifs en fondu additif (liseré de loupiotes, loupiotes qui
   tournent, étincelles) et 43 objets qui projettent une ombre. Ce cran
   coupe les trois postes les plus chers :
     - le flou lumineux, à lui seul ~17x le coût du reste du rendu ;
     - la passe d'ombres (43 objets redessinés une seconde fois) ;
     - les sprites décoratifs, tous transparents donc triés et redessinés
       sans test de profondeur.
   Le plateau, le pion, les lots et toutes les règles du jeu restent
   identiques : on retire de la décoration, jamais du jeu. */
let ecoMode = false;
function setEcoMode(on){
  if(ecoMode === on) return;
  ecoMode = on;
  if(bloomPass) bloomPass.enabled = !on;
  renderer.shadowMap.enabled = !on;
  // La classe « eco » coupe aussi la décoration COTÉ PAGE (voir la CSS) :
  // le coût d'une page n'est pas seulement celui de la scène 3D.
  document.documentElement.classList.toggle('eco', on);
  trimLights.forEach(tl=>{ tl.spr.visible = !on && SHOW_GLOW_POINTS; });
  orbiterLights.forEach(ol=>{ ol.spr.visible = !on && SHOW_GLOW_POINTS; });
  // 40 disques d'ombre sous les lots flottants : transparents, donc
  // triés et dessinés à chaque image. Sans ombres portées (coupées
  // juste au-dessus), ils n'ont de toute façon plus de sens.
  tiles.forEach(t=>{ if(t.shadowDisc) t.shadowDisc.visible = !on; });
  scene.traverse(o=>{ if(o.material){ (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{ m.needsUpdate = true; }); } });
}
/* Crans supplémentaires (portable + grand écran) :
     2. ombres PCF simples (au lieu de PCF « douces », ~2x moins de
        lectures de texture par pixel du plateau) — même lumière, même
        direction d'ombre, bord à peine plus net
     4. rendu à 0,85x */
function setShadowSoft(soft){
  const type = soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  if(renderer.shadowMap.type === type) return;
  renderer.shadowMap.type = type;
  scene.traverse(o=>{ if(o.material){ (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{ m.needsUpdate = true; }); } });
}
function applyQuality(level){
  QUALITY.level = level;
  /* BOUCLE DE RETROACTION — la cause probable du « ça ressaute ».
     Changer de cran declenche setShadowSoft et/ou setEcoMode, qui font un
     scene.traverse posant needsUpdate sur TOUS les materiaux : le moteur
     recompile alors ses shaders, ce qui coute plusieurs images d'un coup.
     Sans garde-fou, qualityTick mesure ces images comme lentes et
     declenche aussitot le cran suivant, qui recompile a son tour... en
     cascade jusqu'en bas. On suspend donc toute mesure pendant 1,8 s
     apres chaque changement, le temps que la recompilation passe et que
     la cadence se stabilise. */
  /* MEME BASE DE TEMPS que qualityTick, qui recoit performance.now()/1000
     depuis animate() — et non clock.getElapsedTime(), qui part de zero a
     la creation de l'horloge : melanger les deux rendrait la grace
     inoperante. */
  QUALITY.armedAt = performance.now()/1000 + 1.8;
  QUALITY.samples = 0; QUALITY.slow = 0; QUALITY.fast = 0; QUALITY.tenu = 0;
  /* La resolution de rendu est de LOIN le changement le plus visible :
     elle ne bouge donc plus qu'a partir du cran 3. Les crans 1 et 2 ne
     touchent que des choses imperceptibles (resolution du bloom, type
     d'ombre), de sorte qu'une degradation legere ne se voie pas du tout.
     Au cran le plus bas, 0.78 et non 0.6 : rendre a 60 % de resolution
     est pire, sur un ecran de diffusion, que quelques images perdues. */
  /* Résolution JAMAIS sous 1x (23/09). À 0,78 sur un iPhone, l'image
     devenait crénelée dès que la caméra tournait — « la résolution s'est
     cassé la gueule », capture à l'appui. Ce qui se voit le plus se retire
     désormais en dernier : on coupe d'abord le flou lumineux, les ombres
     et la décoration (mode éco, cran 4), la finesse ne descend qu'ensuite,
     et jamais sous la résolution normale de l'écran.
       cran 0-2 : pleine finesse (DPR_MAX, 2x max)
       cran 3   : 1,5x
       cran 4   : 1,5x + mode éco
       cran 5   : 1x + mode éco */
  const mid = Math.min(DPR_MAX, 1.5);
  const dpr = ECRAN_DIFFUSION ? DPR_MAX : level>=5 ? Math.min(DPR_MAX, 1) : level>=3 ? mid : DPR_MAX;
  const eco = level >= 4;
  const bs  = bloomScaleForLevel(level);
  /* Rien de reellement different : on ne touche a rien. Les crans 1 et 2
     partagent la meme resolution et le meme etat de mode eco ; sans cette
     sortie, franchir l'un d'eux relancait toute la chaine de destruction
     et reallocation des cibles de rendu pour un resultat identique. */
  if(dpr === _qDpr && eco === _qEco && bs === _qBloom) return;
  _qDpr = dpr; _qEco = eco; _qBloom = bs;

  if(renderer.getPixelRatio() !== dpr) renderer.setPixelRatio(dpr);
  /* Audit 23/09 : le composer garde SA densité (fixée à sa création, 2x).
     Sans cette ligne, baisser la résolution ne soulageait RIEN — la scène
     restait calculée en 2x puis réduite : image floue, aucun gain, et
     l'échelle continuait de descendre. C'était « la résolution qui se
     casse la figure ». */
  if(composer.setPixelRatio) composer.setPixelRatio(dpr);
  setEcoMode(eco);
  /* setShadowSoft N'EST PLUS APPELE ICI. C'etait le poste le plus cher de
     tout le changement de cran : shadowMapType fait partie de la cle de
     cache des programmes de three, donc en basculer le type force une
     VRAIE recompilation GLSL de 8 a 15 programmes, soit 0,2 a 1,5 s de
     gel — pour un bord d'ombre a peine plus net. Le type d'ombre est
     desormais fige une fois pour toutes au chargement, selon le profil de
     l'appareil, comme l'est deja le nombre d'echantillons du MSAA. */
  resize();
}
/* Dernier etat applique, pour ne rien refaire quand rien ne change. */
let _qDpr = null, _qEco = null, _qBloom = null;
/* Declares ICI et non juste avant resize() : sur petit ecran et sur
   telephone, le bloc de reglage initial appelle applyQuality(3) — donc
   resize() — AVANT la ligne ou ces variables etaient declarees, et un let
   dans sa zone morte temporelle leve une exception qui interrompt toute
   l'initialisation du module. Le defaut ne se voyait pas sur un grand
   ecran, ou aucune des deux branches du bloc initial ne se declenche. */
let _rzW = 0, _rzH = 0, _rzPr = 0;
/* Resolution du bloom : divisee des le cran 1. C'est le premier levier
   parce que c'est le seul qui ne se voie pratiquement pas — un halo est
   flou par nature. */
function bloomScaleForLevel(level){ return level>=1 ? 0.25 : 0.5; }
/* ---------- Échelle de qualité automatique, DANS LES DEUX SENS ----------

   Ce qui n'allait pas, et que l'animateur a décrit par « au bout de
   quelques secondes ça part en vrille » :

   1. L'échelle ne descendait JAMAIS. Une fois un cran perdu, il était
      perdu pour la session entière — un simple à-coup passager (montée
      d'une texture, première célébration, ramasse-miettes du navigateur)
      dégradait l'image définitivement.
   2. Elle était beaucoup trop nerveuse. Tout ce qui passait sous 45 i/s
      comptait comme lent, et il suffisait de 50 % de 24 images, avec
      0,8 s entre deux crans : en cinq secondes on pouvait tomber du cran
      0 au cran 5, qui rend à 60 % de résolution.

   Désormais : on ne compte comme lent que ce qui passe sous 30 i/s (un
   vrai problème, pas une image ratée), il faut 70 % de 48 mesures pour
   descendre d'un cran, et surtout la qualité REMONTE quand l'appareil
   tient la cadence. Un plancher évite l'oscillation. */
const Q_LENT      = 1/30;   // en dessous de 30 i/s : vraiment lent
const Q_FLUIDE    = 1/50;   // au-dessus de 50 i/s : vraiment confortable
const Q_N_BAS     = 48;     // mesures avant d'envisager de descendre
const Q_N_HAUT    = 150;    // mesures avant d'envisager de remonter (~2,5 s)
const Q_RATIO_BAS = 0.70;   // part d'images lentes qui justifie de descendre
const Q_RATIO_HAUT= 0.90;   // part d'images fluides qui justifie de remonter
function qualityTick(realDt, now){
  if(QUALITY.locked) return;
  if(!QUALITY.armedAt){ QUALITY.armedAt = now + 2.5; return; } // grâce au chargement
  if(now < QUALITY.armedAt) return;
  /* Audit 23/09 : les moments lourds et passagers (célébration, orage,
     saut de victoire) ne comptent pas — ils faisaient descendre l'échelle
     pour un à-coup de quelques secondes. */
  if(celebRAF || storm || victoire) return;
  // un cran repris et tenu ~600 images MESURÉES est confirmé (et non 10 s
  // d'horloge, qui passaient au repos sans aucune mesure — audit 2)
  QUALITY.tenu = (QUALITY.tenu||0) + 1;
  if(QUALITY.triedUp !== null && QUALITY.tenu > 600) QUALITY.triedUp = null;
  /* En mode éco la boucle est plafonnée à 30 i/s : les seuils normaux
     (lent > 1/30, fluide < 1/50) y rendaient la remontée IMPOSSIBLE et
     comptaient une image sur deux comme lente. */
  // plafond éco ≈ 30 i/s (33 ms à 60 Hz, 40 ms à 50/75/100 Hz) : fluide
  // sous 45 ms, lent au-delà de 58 ms (une image sautée)
  const seuilLent = ecoMode ? 1/17 : Q_LENT, seuilFluide = ecoMode ? 1/22 : Q_FLUIDE;

  QUALITY.samples++;
  if(realDt > seuilLent) QUALITY.slow++;
  else if(realDt < seuilFluide) QUALITY.fast = (QUALITY.fast||0) + 1;

  // --- descendre d'un cran : il faut une lenteur franche et soutenue ---
  if(QUALITY.samples >= Q_N_BAS && QUALITY.level < QUALITY_LEVELS){
    if(QUALITY.slow >= QUALITY.samples*Q_RATIO_BAS && now - QUALITY.last > 1.6){
      QUALITY.last = now;
      /* Anti-oscillation : si la lenteur survient a un cran que l'on
         venait justement de reprendre, c'est que ce cran n'est pas
         tenable sur cet appareil — il devient le plancher et on ne
         retentera plus de monter au-dessus. Une lenteur a un cran qu'on
         n'a PAS repris ne bloque rien : c'est peut-etre juste un passage
         charge (celebration, orage), et la remontee reste permise. */
      if(QUALITY.triedUp !== null && QUALITY.level <= QUALITY.triedUp){
        QUALITY.floor = QUALITY.level + 1;
        QUALITY.triedUp = null;
      }
      applyQuality(QUALITY.level + 1);
      QUALITY.samples = 0; QUALITY.slow = 0; QUALITY.fast = 0;
      return;
    }
  }

  // --- remonter d'un cran : long, prudent, et jamais au-dessus du départ ---
  if(QUALITY.samples >= Q_N_HAUT){
    const cible = Math.max(QUALITY.base, QUALITY.floor);
    if(QUALITY.level > cible
       && (QUALITY.fast||0) >= QUALITY.samples*Q_RATIO_HAUT
       && QUALITY.slow <= QUALITY.samples*0.02   // un ramasse-miettes ne bloque plus tout
       && now - QUALITY.last > 4){
      QUALITY.last = now;
      QUALITY.triedUp = QUALITY.level - 1;   // cran tente, a confirmer
      applyQuality(QUALITY.level - 1);
    }
    QUALITY.samples = 0; QUALITY.slow = 0; QUALITY.fast = 0;
  }
}

/* Cran de départ, sans attendre de voir la cadence s'effondrer :
     - ?q=0..5 dans l'adresse impose un cran (0 = tout allumé,
       5 = mode éco) — pratique pour comparer, et pour figer un réglage
       connu avant un live ;
     - sinon un écran de téléphone démarre déjà bas. L'échelle
       automatique fait le reste dans les deux sens... vers le bas. */
{
  const q = parseInt(new URLSearchParams(location.search).get('q'), 10);
  const petitEcran = Math.min(window.innerWidth, window.innerHeight) <= 520;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  // Cet appareil a déjà fait lâcher le contexte WebGL : on repart
  // directement en mode éco, sinon il relâchera dans la minute.
  const QSTICK_TTL = 6*3600*1000;   // 6 h
  let apresPlantage = parseInt(safeGetItem(QSTICK_KEY), 10);
  // ancienne valeur « 5 » (sans date) ou trop vieille : on l'oublie
  if(!isNaN(apresPlantage) && (apresPlantage < 1e12 || Date.now() - apresPlantage > QSTICK_TTL)){
    apresPlantage = NaN;
    try{ localStorage.removeItem(QSTICK_KEY); }catch(e){}
  }
  if(!isNaN(apresPlantage) && isNaN(q)){
    applyQuality(QUALITY_LEVELS);
    QUALITY.locked = true;
  }
  else if(!isNaN(q)){
    // réglage imposé : il ne bouge plus, même si la cadence baisse
    applyQuality(Math.max(0, Math.min(QUALITY_LEVELS, q)));
    QUALITY.locked = true;
  }
  /* Téléphone : cran 3 -> 2 (polish 22/09). Le cran de départ est aussi le
     PLAFOND de remontée (QUALITY.base plus bas). Au cran 3, le rendu est à
     la résolution 1x : sur un iPhone (écran 3x), le jeu était donc rendu
     à un tiers de la finesse de l'écran, pour toujours — le flou constaté
     sur la capture d'écran. Au cran 2 il se rend à DPR_MAX (2) ; si
     l'appareil peine, l'échelle automatique redescend. */
  else if(petitEcran || mobile) applyQuality(2);
  /* Type d'ombre fige ici, une fois pour toutes : ombres douces sur un
     ecran de diffusion, ombres simples sur telephone ou petit ecran. Il ne
     bougera plus, pour qu'aucun changement de cran ne puisse declencher de
     recompilation de shaders en plein direct. */
  setShadowSoft(!(petitEcran || mobile));
  // Cran de depart : la remontee automatique ne depassera jamais ce niveau.
  QUALITY.base = QUALITY.level;
  QUALITY.floor = QUALITY.level;
}
let _lastFrameAt = 0, _lastRenderAt = 0;
function animate(){
  requestAnimationFrame(animate);
  const nowMs = performance.now();
  /* Mode éco : plafond à 30 images/s. Un appareil qui suffoque tient une
     cadence régulière à 30 bien mieux qu'une cadence erratique entre 15
     et 25, et il chauffe deux fois moins — or c'est la chauffe qui finit
     par faire lâcher le contexte WebGL, c'est-à-dire par tout planter. */
  /* Au repos (aucune partie en mouvement, aucune annonce animée) : 30 i/s
     aussi. Les cases ondulent doucement, 30 images suffisent, et l'appareil
     chauffe deux fois moins entre les parties — c'est la chauffe qui, au
     bout de quelques coups, faisait ralentir puis baisser la qualité. */
  const auRepos = !walk && !moving && !drawInProgress && !storm && !victoire && !celebRAF && cineMode === null && cineBlend <= 0.001;   // pas pendant le retour de la caméra
  if((ecoMode || auRepos) && nowMs - _lastRenderAt < 31) return;
  _lastRenderAt = nowMs;
  const realDt = _lastFrameAt ? (nowMs - _lastFrameAt)/1000 : 0;
  _lastFrameAt = nowMs;
  // compteur sur le plateau : il « saute » à chaque coup joué, et respire
  // doucement quand il ne reste que les derniers coups
  if(ccMesh){
    const u = (nowMs - ccPulseAt)/700;
    let k = u >= 0 && u < 1 ? 1 + 0.22*Math.sin(Math.PI*u)*(1-u) : 1;
    const o = ccReste;   // tenu par drawCoupPlate (outcomeState n'existe pas encore à la 1re image)
    if(o > 0 && o <= 30 && !reduceMotion) k *= 1 + 0.03*Math.sin(nowMs/(o <= 10 ? 90 : 160));
    ccMesh.scale.setScalar(k);
  }
  // au repos plafonné, la cadence ne dit rien de la santé de l'appareil
  if(!document.hidden && realDt > 0 && realDt < 1 && !(auRepos && !ecoMode)) qualityTick(realDt, nowMs/1000);
  /* getDelta() AVANT getElapsedTime() — l'ordre est vital. Dans three.js,
     getElapsedTime() appelle lui-même getDelta() et remet le chrono à
     l'instant présent : appelé en premier, il laissait au getDelta()
     suivant un écart nul. Chaque image recevait alors dt = 0, et tout ce
     qui avance avec le temps restait figé (animations du personnage,
     particules, garde-fou de cadrage). Régression du 22/09, mesurée à la
     sonde : dt valait 0 à toutes les images. */
  const _dt = Math.min(clock.getDelta(), 0.05);
  const _t = clock.getElapsedTime();
  updateContactShadow();
  frameStep(_dt, _t);
}
animate();

/* ---------- Redimensionnement ---------- */
function resize(){
  const w = wrap.clientWidth, h = wrap.clientHeight;
  if(w===0||h===0) return;
  /* composer.setSize detruit et realloue la cible multi-echantillonnee
     ET les onze cibles du bloom. Inutile de payer ca quand ni la taille
     ni la densite de pixels n'ont bouge. */
  const pr = renderer.getPixelRatio();
  if(w === _rzW && h === _rzH && pr === _rzPr) return;
  _rzW = w; _rzH = h; _rzPr = pr;
  renderer.setSize(w,h,false);
  composer.setSize(w,h);
  // facteur de projection des particules d'arrivee : depend de la hauteur
  // reelle du rendu et du champ de vision, donc a recalculer ici
  {
    const pr2 = renderer.getPixelRatio();
    const proj = (h * pr2) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    fxFlames.pts.material.uniforms.uProj.value = proj;
    fxStars.pts.material.uniforms.uProj.value  = proj;
    fxSmoke.pts.material.uniforms.uProj.value  = proj;
  }
  const bs = bloomScaleForLevel(QUALITY.level);
  if(bs < 1) bloomPass.setSize(Math.round(w*bs), Math.round(h*bs));
  camera.aspect = w/h;
  camera.updateProjectionMatrix();
  fitCameraToAspect();
}
window.addEventListener('resize',resize,{passive:true});
document.addEventListener('fullscreenchange', ()=>setTimeout(resize, 60));
window.addEventListener('orientationchange',()=>setTimeout(resize,150),{passive:true});
if(window.ResizeObserver){ new ResizeObserver(resize).observe(wrap); }
resize();
/* Grand canvas dès le départ (télé, écran Retina en miroir) : on part
   directement un cran plus bas plutôt que d'attendre ~4 s de saccades
   pour que l'adaptation le décide. Seuil : ~2,4 millions de pixels
   rendus (ex. 1470x956 CSS à 1,5x = 3,2 M). */
{
  const px = wrap.clientWidth * wrap.clientHeight * DPR_MAX * DPR_MAX;
  if(px > 2.4e6 && !QUALITY.locked) applyQuality(1);
}

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
/* Pas d'éclair dessiné par-dessus la photo de l'ETB (jackpot) : demande de
   l'animateur, il gênait la révélation. La finale a déjà sa vraie foudre en
   3D ; les secousses et l'impact du show restent. */
let lightningOff = false;
function triggerLightning(){
  if(!lightningBolt || reduceMotion || lightningOff) return;
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
/* ---------- Règle métier de rentabilité ----------
   Pour chaque cycle de CA_CYCLE euros de chiffre d'affaires (mise moyenne
   AVG_MISE), la marge doit être d'au moins MARGIN_TARGET. Cette marge est
   tenue À CHAQUE INSTANT, pas seulement en fin de cycle : à tout moment,
   le total reversé ne dépasse jamais (1 − marge) de ce qui a été
   encaissé — un gros lot ne tombe donc que lorsque la cagnotte déjà
   encaissée le paie. Les statistiques de chute de chaque lot
   (OUTCOME_RECIPE) sont une affaire séparée, réglable sans toucher à
   cette garantie. */
const AVG_MISE = 9;              // mise moyenne (euros)
const CA_CYCLE = 4500;           // chiffre d'affaires d'un cycle (euros) : tout le stock 30 ans
const MARGIN_TARGET = 0.26;      // marge garantie sur le cycle et à chaque instant, lots comptés à leur VALEUR MARCHÉ (revente)
const CEILING_RATIO = 1 - MARGIN_TARGET;  // part maximale reversée (dérivée, ne pas régler ici)

/* ---------- Recalibrage sur le stock réel (18/09/2026, soir) ----------
   L'hôte a sorti des lots à la touche forcée (hors comptabilité) et le
   plan initial ne correspond plus à rien. On repart de ce qu'il RESTE
   en stock, à zéro de compteur, avec une marge relevée de 26 % à 41 %
   (part reversée 59 % au lieu de 74 %) pour rattraper l'avance prise :
     4 ETB 30 ans · 3 coffrets ex (+1 entamé, dont les packs vont aux
     lots mystère) · 2 tripacks · 20 boosters · communes/promos à volonté.
   Ce stock est étalé sur 3 300 € encaissés (367 parties à 9 €) : c'est
   ce qu'il faut pour le reverser à 59 %. Au-delà, le jeu reprend le plan
   standard et la règle des 26 % — il faudra un nouveau stock.
   Bilan attendu sur tout le direct (1 500 € déjà faits + 3 300) : environ
   28 % de marge, soit l'objectif initial retrouvé.
   Appliqué UNE seule fois (clé pika_recal) ; « Démarrage cagnotte »
   l'efface définitivement, et il ne se réapplique jamais ensuite. */
const RECAL_KEY = 'pika_recal';
const RECAL = {
  id: '2026-09-18b',
  miseBase: 0,                          // nouveau départ de compteur
  paidBase: 0,
  miseEnd: 3300,                        // horizon du stock restant
  ratio: 0.59,                          // part reversée : marge 41 %
  games: Math.round(3300 / AVG_MISE),   // 367 parties
  mystB: 7,                             // boosters restants pour les lots mystère (stock au 21/09)
  recipe: [
    { cat:'jackpot300',  n:4  },   // ETB 30 ans
    { cat:'etb',         n:3  },   // coffrets ex entiers
    { cat:'booster50',   n:2  },   // tripacks
    { cat:'gradee',      n:0  },   // duopacks : plus en stock
    { cat:'booster8',    n:20 },   // boosters
    { cat:'alternative', n:25 },   // Zone Safari / promos (cartes, gratuites pour l'hôte)
    { cat:'prison',      n:15 },
  ],
};
let recalRec = null;
try{ recalRec = JSON.parse(safeGetItem(RECAL_KEY) || 'null'); }catch(e){}
if(recalRec && recalRec.id !== RECAL.id) recalRec = null;
let recal = (recalRec && !recalRec.cleared) ? recalRec : null;
function clearRecal(){
  recal = null;
  try{ localStorage.setItem(RECAL_KEY, JSON.stringify({ id: RECAL.id, cleared: true })); }catch(e){}
}
/* Plafond de reversement cumulé pour un encaissé donné : la règle
   normale (74 %), ou la pente réduite du recalibrage tant qu'il court. */
function ceilingFor(mise){
  if(recal && mise < RECAL.miseEnd) return RECAL.paidBase + RECAL.ratio*(mise - RECAL.miseBase);
  return CEILING_RATIO*mise;
}
let totalMise = parseFloat(safeGetItem(TOTAL_MISE_KEY)) || 0;
let totalPaid = parseFloat(safeGetItem(TOTAL_PAID_KEY)) || 0;
function saveTotals(){
  if(isDisplay || window.PIKA_DEMO_JACKPOT) return;   // écran public et démo : n'écrivent jamais l'état partagé
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
  // audit 23/09 : un clic en pleine partie ajoutait le lot en cours à la
  // nouvelle pochette (246 coups), et un clic accidentel jetait la pochette
  if(pendingOutcome || moving || drawInProgress){ showKeyHint('Terminez la partie (C) avant de repartir sur une nouvelle pochette'); return; }
  if(!window.confirm('Repartir sur une NOUVELLE pochette de '+TAILLE_POCHETTE+' coups ? La pochette en cours sera abandonnée.')) return;
  totalMise = 0;
  totalPaid = 0;
  saveTotals();
  clearRecal();
  resetOutcomeBatch();
  resetBankBtn.hidden = true;
  flashBankResetToken();
  clearWinUndo();
});

/* Paliers du plus cher au moins cher : un lot qui ferait dépasser le
   plafond de reversement cumulé redescend au premier palier qui
   passe encore sous ce plafond. */
/* Coût de chaque lot = sa VALEUR MARCHÉ (revente constatée à la sortie,
   16/09/2026), volontairement plus sévère que le prix d'achat réel
   (stock complet payé ~1 200 €) : la marge garantie ici est donc une
   marge « même si on comptait les lots à ce qu'ils valent sur Vinted ». */
const PAYOUT_LADDER = [
  { cat:'jackpot300', cost:190 },   // ETB 30 ans
  { cat:'etb',         cost:85  },   // Coffret Amphinobi-ex / Nymphali-ex
  { cat:'booster50',   cost:58  },   // Tripack 30 ans
  { cat:'gradee',      cost:30  },   // Duopack 30 ans
  { cat:'booster8',    cost:17  },   // Booster 30 ans
  { cat:'alternative', cost:7.2 },   // Zone Safari (ou carte promo/jumbo 30 ans issue des coffrets ouverts)
  { cat:'commune',     cost:0.68 },
];
const LADDER_IDX = {};
PAYOUT_LADDER.forEach((t,i)=>{ LADDER_IDX[t.cat] = i; });

function fundedCategory(catKey){
  const startIdx = LADDER_IDX[catKey];
  if(startIdx===undefined) return catKey;
  for(let i=startIdx;i<PAYOUT_LADDER.length;i++){
    const tier = PAYOUT_LADDER[i];
    const covered = totalMise>0 ? (totalPaid+tier.cost <= ceilingFor(totalMise) + 1e-9) : true;
    if(covered || i===PAYOUT_LADDER.length-1){
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
/* ---------- Pochette de 245 coups (configuration de l'hôte, 23/09) ----------
   Un coup = une partie (une mise = un lot, même en plusieurs lancers).
   Les quantités sont EXACTES : aucun plafond de rentabilité ne retire,
   ne remplace ni ne décale un lot (décision de l'hôte, qui calcule sa
   rentabilité sur ses coûts réels). Nouvelle pochette mélangée à
   l'épuisement de la précédente et à chaque « Démarrage cagnotte ».
     • Lot Mystère : 60 « EX » + 30 « booster japonais », ordre tiré au
       sort à chaque pochette (voir MYSTERY_MIX) ;
     • Parc gratuit : 7 coups pris sur les communes (le total reste 245) ;
       le joueur y récupère les cartes promo des coffrets et tripacks
       ouverts, remises physiquement par l'hôte (le jeu n'en affiche pas le
       contenu). Jusqu'au 23/09 au soir, c'était la Caisse Communautaire.
   Chance et Caisse Communautaire ne sont pas des lots : ce sont des
   détours (une carte pipée) qui amènent sur la case du lot. */
const POUCH = POCHETTE_PERSO
  ? ['jackpot300','etb','booster50','gradee','booster8','alternative','parc','prison','commune']
      .map(cat => ({ cat, n: POCHETTE_PERSO.lots[cat] || 0 }))
  : [
  { cat:'jackpot300',  n:1   },   // ETB 30 ans (gagnée fermée)
  { cat:'etb',         n:2   },   // Coffret 30 ans (gagné fermé)
  { cat:'booster50',   n:2   },   // Tripack 30 ans (gagné fermé)
  { cat:'gradee',      n:1   },   // Duopack 30 ans (gagné fermé)
  { cat:'booster8',    n:42  },   // Booster 30 ans
  { cat:'alternative', n:90  },   // Lot Mystère
  { cat:'parc',        n:7   },   // Carte gratuite (gagnée sur la case Parc gratuit) : promos des produits ouverts
  { cat:'commune',     n:100 },   // Carte commune
];
const POUCH_SIZE = POUCH.reduce((s,r)=>s+r.n, 0);
if(POUCH_SIZE !== TAILLE_POCHETTE) throw new Error('POUCH : '+POUCH_SIZE+' coups au lieu de '+TAILLE_POCHETTE);
const MYSTERY_MIX = POCHETTE_PERSO ? POCHETTE_PERSO.myst : { carte:60, booster:30 };   // carte = Mystère EX, booster = booster japonais
if(MYSTERY_MIX.carte + MYSTERY_MIX.booster !== POUCH.find(r=>r.cat==='alternative').n)
  throw new Error('MYSTERY_MIX ne correspond pas au nombre de Lots Mystère');
const OUTCOME_BATCH_SIZE = POUCH_SIZE;

// Coût réel de chaque catégorie (PAYOUT_LADDER + prison, qui n'y
// figure pas puisqu'il ne coûte jamais rien).
// Prison paie tout de même une carte commune de consolation
// Chances par partie de chaque lot (recette / taille du cycle), pour
// la plaque centrale du plateau — le reste (commune) est déduit.
{
  const odds = {}; let used = 0;
  POUCH.forEach(r=>{ odds[r.cat] = 100*r.n/POUCH_SIZE; used += r.n; });
  LOT_ODDS_PCT = odds;
  renderTvLegend();
  const old = centerPlate.material.map;
  centerPlate.material.map = makeCenterPlateTexture();
  centerPlate.material.needsUpdate = true;
  if(old) old.dispose();
}
const OUTCOME_COST = { prison: 0.68, parc: 0 };   // Parc gratuit : promos issues des produits ouverts, déjà payées
PAYOUT_LADDER.forEach(t=>{ OUTCOME_COST[t.cat] = t.cost; });


function shuffleInPlace(a){
  for(let i=a.length-1;i>0;i--){ const j = Math.floor(Math.random()*(i+1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}
/* Mélange complet, à chaque pochette : aucun lot n'a de position fixe.
   Deux retouches seulement, qui ne changent ni les quantités ni le
   caractère aléatoire :
     • Boosters : un mélange est refait tant qu'un quart de la pochette en
       a moins de 6 ou plus de 15 (10,5 attendus) — ils ne s'agglutinent
       jamais au début ni ailleurs ;
     • ETB : placée à une position tirée au sort sur TOUTE la pochette,
       avec un poids qui croît doucement du premier au dernier coup
       (×1 à ×1,6) : environ 56 % de chances dans la deuxième moitié,
       jamais de tour fixe ni de fenêtre. */
/* FENÊTRES DE PASSAGE (version 99 coups, 24/09) : l'animateur veut le
   coffret « entre le 40e et le 70e coup ». window.PIKA_POCHETTE.fenetres =
   { cat:[premierCoup, dernierCoup] } (coups numérotés à partir de 1).
   recalerFenetres() remet dans sa fenêtre toute occurrence encore à venir
   qui en serait sortie (échange quand le joueur garde en chemin, annulation) ;
   si la fenêtre est déjà passée, le lot tombe au coup suivant. `force` :
   placement au hasard dans la fenêtre, à la construction de la pochette. */
function recalerFenetres(b, pos, force){
  const f = POCHETTE_PERSO && POCHETTE_PERSO.fenetres;
  if(!f) return;
  for(const cat in f){
    const lo = f[cat][0]-1, hi = Math.min(f[cat][1]-1, b.length-1);
    // occurrences à venir hors fenêtre (toutes, si `force`), retirées de la fin vers le début
    const aDeplacer = [];
    for(let i=pos;i<b.length;i++) if(b[i]===cat && (force || i < lo || i > hi)) aDeplacer.push(i);
    for(let k=aDeplacer.length-1;k>=0;k--) b.splice(aDeplacer[k], 1);
    // puis remises une à une : au hasard dans la fenêtre, ou au coup suivant si elle est passée
    aDeplacer.forEach(()=>{
      let t;
      if(pos > hi) t = pos;
      else {
        // à la construction, 4 coups de marge avant la fin de la fenêtre :
        // un joueur qui garde un autre lot pendant la partie du coffret le
        // repousse d'un coup (voir claimCurrentLot)
        const h = force ? Math.max(lo, hi - 4) : hi;
        const a = Math.max(pos, lo); t = a + Math.floor(Math.random()*(Math.min(h, b.length) - a + 1));
      }
      b.splice(t, 0, cat);
    });
  }
}
function buildPouch(){
  const base = [];
  POUCH.forEach(r=>{ if(r.cat!=='jackpot300') for(let i=0;i<r.n;i++) base.push(r.cat); });
  const etb = POUCH.find(r=>r.cat==='jackpot300').n;
  let arr = null;
  for(let essai=0; essai<500; essai++){
    arr = shuffleInPlace(base.slice());
    for(let k=0;k<etb;k++){
      const L = arr.length + 1;              // positions d'insertion possibles
      let tot = 0; const w = [];
      for(let p=0;p<L;p++){ const x = 1 + 0.6*p/(L-1); w.push(x); tot += x; }
      let r = Math.random()*tot, p = 0;
      while(p < L-1 && (r -= w[p]) > 0) p++;
      arr.splice(p, 0, 'jackpot300');
    }
    const q = [0,0,0,0];
    arr.forEach((c,i)=>{ if(c==='booster8') q[Math.min(3, Math.floor(4*i/arr.length))]++; });
    // 6 à 15 par quart pour 42 boosters ; proportionnel pour une autre pochette
    const attendu = POUCH.find(r=>r.cat==='booster8').n / 4;
    if(q.every(n=>n>=Math.round(attendu*0.57) && n<=Math.round(attendu*1.43))) break;
  }
  recalerFenetres(arr, 0, true);
  return arr;
}
function buildMysteryQueue(){
  const q = [];
  for(let i=0;i<MYSTERY_MIX.carte;i++) q.push('carte');
  for(let i=0;i<MYSTERY_MIX.booster;i++) q.push('booster');
  return shuffleInPlace(q);
}

/* Version de la file. Une file laissée en mémoire du navigateur par une
   version précédente du jeu (autre recette, autre ordonnancement) n'a
   pas les mêmes garanties : elle est reconstruite. */
const OUTCOME_BATCH_VERSION = POCHETTE_PERSO ? 'v12-'+(POCHETTE_PERSO.id || 'pochette-'+TAILLE_POCHETTE) : 'v11-parc-gratuit';
function loadOutcomeState(){
  try{
    const raw = safeGetItem(OUTCOME_BATCH_KEY);
    if(raw){
      const parsed = JSON.parse(raw);
      /* Pochette commencée avant le 23/09 au soir : ses 7 coups « Caisse »
         deviennent des « Parc gratuit » (même lot : les promos). La position,
         donc le compteur de coups, est conservée. */
      if(parsed && parsed.version === 'v10-pochette-245' && Array.isArray(parsed.batch)){
        parsed.batch = parsed.batch.map(c => c === 'chest' ? 'parc' : c);
        parsed.version = OUTCOME_BATCH_VERSION;
      }
      /* Page rechargée en pleine partie (plantage, F5) : le lot de la partie
         interrompue n'a pas été gagné — il retourne en tête de pochette,
         comme avec « Recommencer ». Audit 23/09 : il était perdu, et le
         coup compté. */
      if(parsed && parsed.enCours && parsed.pos > 0){ parsed.pos--; parsed.enCours = false; parsed._miseARetirer = true; }
      if(parsed && parsed.version===OUTCOME_BATCH_VERSION && Array.isArray(parsed.batch)
         && typeof parsed.pos==='number' && parsed.pos <= parsed.batch.length   // pochette finie : « 245 coups sur 245 » jusqu'au B suivant
         && Array.isArray(parsed.myst) && typeof parsed.mystPos==='number'){
        return parsed;
      }
    }
  }catch(e){}
  return newOutcomeState();
}
function newOutcomeState(){
  return { version: OUTCOME_BATCH_VERSION, batch: buildPouch(), pos: 0, myst: buildMysteryQueue(), mystPos: 0 };
}
/* Lot Mystère : le contenu (EX ou booster japonais) est pris dans la
   sous-file mélangée de la pochette — exactement 60 EX et 30 boosters. */
function drawMysterySub(){
  const st = outcomeState;
  const sub = st.mystPos < st.myst.length ? st.myst[st.mystPos] : (Math.random() < 1/3 ? 'booster' : 'carte');
  st.mystPos++;
  saveOutcomeState();
  return sub;
}
let outcomeState = loadOutcomeState();
/* STOCK RÉEL (23/09, en direct, au coup 27 sur 245). L'animateur : « il me
   reste exactement 22 boosters, 3 tripacks, 2 coffrets, 1 ETB, 1 duopack ;
   le reste en Lots Mystère (EX et boosters japonais) comme d'habitude ».
   Une seule fois, sur la pochette en cours : les coups RESTANTS sont
   reconstruits avec ces quantités exactes ; les places restantes sont
   partagées entre Lot Mystère, Carte gratuite et Pioche dans les
   proportions de la pochette (90 / 7 / 100), les Lots Mystère gardant
   2 EX pour 1 booster japonais. Coups déjà joués et compteur inchangés.
   2e relevé, un coup plus tard : 21 boosters, 3 tripacks, 2 coffrets,
   1 ETB, 1 duopack ; boosters japonais : 26 au plus ; Mystère EX et
   Cartes gratuites sans limite. Nouveau drapeau : s'applique même si le
   1er relevé l'a déjà été. */
{
  const AJUST_KEY = 'pika_ajust_stock_2309b';   // 2e relevé du stock (voir plus bas)
  const st = outcomeState;
  if(!isDisplay && !window.PIKA_DEMO_JACKPOT && !POCHETTE_PERSO && !safeGetItem(AJUST_KEY)){
    const reste = st.batch.length - st.pos;
    const fixes = { booster8:21, booster50:3, etb:2, jackpot300:1, gradee:1 };
    const nFix = Object.values(fixes).reduce((a,b)=>a+b, 0);
    if(st.pos >= 20 && st.pos <= 80 && reste > nFix + 20){
      const libres = reste - nFix;
      const alt = Math.round(libres*90/197), parc = Math.round(libres*7/197), com = libres - alt - parc;
      const q = [];
      Object.entries(fixes).forEach(([c,n])=>{ for(let i=0;i<n;i++) q.push(c); });
      for(let i=0;i<alt;i++) q.push('alternative');
      for(let i=0;i<parc;i++) q.push('parc');
      for(let i=0;i<com;i++) q.push('commune');
      shuffleInPlace(q);
      st.batch = st.batch.slice(0, st.pos).concat(q);
      const mq = [];
      const jp = Math.min(26, Math.round(alt/3));   // 26 boosters japonais en stock, EX sans limite
      for(let i=0;i<alt-jp;i++) mq.push('carte');
      for(let i=0;i<jp;i++) mq.push('booster');
      st.myst = st.myst.slice(0, st.mystPos).concat(shuffleInPlace(mq));
      st.ajustStock = { pos: st.pos, fixes, alt, parc, com, jp };
    }
    try{ localStorage.setItem(AJUST_KEY, String(Date.now())); }catch(e){}
  }
}
// partie interrompue par un rechargement : sa mise ne compte plus (comme avec C)
if(outcomeState._miseARetirer){ delete outcomeState._miseARetirer; totalMise = Math.max(0, totalMise - AVG_MISE); saveTotals(); }
function saveOutcomeState(){
  if(isDisplay || window.PIKA_DEMO_JACKPOT) return;   // voir saveTotals
  try{ localStorage.setItem(OUTCOME_BATCH_KEY, JSON.stringify(outcomeState)); }catch(e){}
}
saveOutcomeState();
/* Recalibrage du 18/09 : ses compteurs restent en mémoire à titre
   d'information, mais il ne construit plus de file — la pochette de 245
   coups la remplace. */
if(!recalRec){
  recal = { id: RECAL.id, at: Date.now() };
  try{ localStorage.setItem(RECAL_KEY, JSON.stringify(recal)); }catch(e){}
}
// Un nouveau lot de résultats est régénéré automatiquement à
// l'épuisement du précédent (jamais de rupture de stock) et à chaque
// remise à zéro de la cagnotte (nouveau direct = nouveau lot).
/* Un lot est « couvert » si, une fois payé, le total reversé reste sous
   le plafond de la cagnotte RÉELLEMENT encaissée (la mise en cours
   comprise). La file est construite pour respecter ce plafond à 9 € par
   partie, mais la réalité peut diverger (parties recommencées sans
   valider, validation anticipée, ancienne file…) : ce contrôle en direct
   est la garantie finale. */
function outcomeCovered(cat){
  return true;   // pochette exacte : aucun plafond ne décale un lot
}
function pouchHas(cat){
  const b = outcomeState.batch;
  for(let j=outcomeState.pos;j<b.length;j++) if(b[j]===cat) return true;
  return false;
}
function peekNextOutcome(){
  if(outcomeState.pos >= outcomeState.batch.length) return null;
  return outcomeState.batch[outcomeState.pos];
}
/* Compteur « N coups sur 245 » en haut de l'écran : coups (parties) déjà
   joués dans la pochette. Le coup en cours ne compte qu'une fois son lot
   gagné ; il repart de 0 avec une nouvelle pochette. */
const coupCountEl = document.getElementById('coupCount');
function updateCoupCount(n, total){
  if(!coupCountEl) return;
  if(n == null){
    n = Math.max(0, outcomeState.pos - ((pendingOutcome && !forcedGame) ? 1 : 0));
    total = outcomeState.batch.length;
    broadcastSync({type:'coups', n, total});
  }
  drawCoupPlate(n, total);
  const reste = Math.max(0, total - n);
  const nEl = document.getElementById('ccN'), tEl = document.getElementById('ccT');
  const restEl = document.getElementById('ccRest'), fillEl = document.getElementById('ccFill');
  const labelEl = document.getElementById('ccLabel');
  if(!nEl){ coupCountEl.textContent = n + ' / ' + total; return; }
  const avant = parseInt(nEl.textContent, 10);
  nEl.textContent = n; tEl.textContent = total;
  if(fillEl) fillEl.style.width = (total ? (100*n/total) : 0).toFixed(1) + '%';
  const urgent = reste > 0 && reste <= 30;
  coupCountEl.classList.toggle('urgent', urgent);
  coupCountEl.classList.toggle('last10', urgent && reste <= 10);
  if(labelEl) labelEl.textContent = urgent ? 'DERNIERS COUPS !' : 'COUPS JOUÉS';
  if(restEl) restEl.textContent = reste === 0 ? 'Pochette terminée' : reste === 1 ? 'Dernier coup !' : reste + ' coups restants';
  // un coup de plus : le chiffre saute (pas au chargement ni en reculant)
  if(coupCountEl.dataset.pret && !isNaN(avant) && n > avant){
    coupCountEl.classList.remove('tick'); void coupCountEl.offsetWidth; coupCountEl.classList.add('tick');
    ccPulseAt = performance.now();
  }
  coupCountEl.dataset.pret = '1';
}
function updateCue(){
  if(isDisplay) return;
  updateCoupCount();
  /* Plus AUCUN indice du lot à venir à l'écran (23/09, l'animateur : « on
     peut prédire les lots ») : l'étoile du titre qui s'éclaircissait avant
     un ETB ou un coffret et le point coloré en bas à gauche sont retirés. */
}
function nextPredeterminedOutcome(){
  if(outcomeState.pos >= outcomeState.batch.length){
    outcomeState = newOutcomeState();
  }
  const cat = outcomeState.batch[outcomeState.pos];
  outcomeState.pos++;
  // partie en cours : si la page est rechargée avant le gain, le lot
  // retournera dans la pochette au chargement (voir loadOutcomeState)
  outcomeState.enCours = true;
  saveOutcomeState();
  return cat;
}
function resetOutcomeBatch(){
  outcomeState = newOutcomeState();
  saveOutcomeState();
  updateCue();
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
function computeCardDraw(total, wantDouble){
  // Un seul tirage de 2 cartes par clic. Sur un double, l'hôte
  // relance lui-même manuellement (nouveau clic sur "TIRER LES
  // CARTES") pour la paire bonus, au lieu d'un enchaînement
  // automatique dans le logiciel.
  let a, b;
  if(total==null){
    a = 1+Math.floor(Math.random()*6);
    b = 1+Math.floor(Math.random()*6);
  } else {
    // paire tirée au sort parmi celles qui font le total planifié ; le
    // double (lancer bonus) est décidé par le planificateur, qui en tient
    // compte dans ses lancers restants
    const pairs = [];
    for(let x=1;x<=6;x++){ const y=total-x; if(y>=1&&y<=6) pairs.push({a:x,b:y}); }
    const doubles = pairs.filter(q=>q.a===q.b), singles = pairs.filter(q=>q.a!==q.b);
    let pick;
    if(!singles.length || (wantDouble && doubles.length)) pick = doubles[0];
    else pick = singles[Math.floor(Math.random()*singles.length)];
    a = pick.a; b = pick.b;
  }
  /* Un vrai paquet (audit 23/09, « on a l'impression que les cartes sont
     pipées ») : 12 cartes = deux séries de 1 à 6. Après le retournement,
     les 10 autres se retournent aussi et montrent le reste du paquet. Et
     le choix des deux cartes se VOIT : un curseur passe de carte en carte
     et s'arrête (chemin tiré ici pour que l'écran public joue le même). */
  const slotOrder = shuffledSlots();
  const reste = [1,2,3,4,5,6,1,2,3,4,5,6];
  reste.splice(reste.indexOf(a), 1); reste.splice(reste.indexOf(b), 1);
  for(let i=reste.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [reste[i],reste[j]]=[reste[j],reste[i]]; }
  const parcours = (fin, interdit)=>{
    const n = 5 + Math.floor(Math.random()*4), ch = [];
    let prev = -1;
    for(let i=0;i<n;i++){
      let k; do{ k = Math.floor(Math.random()*12); }while(k===prev || k===fin || k===interdit);
      ch.push(k); prev = k;
    }
    ch.push(fin);
    return ch;
  };
  return { pairs: [{a,b}], total: a+b, isDouble: a===b, slotOrder, reste,
           hop1: parcours(slotOrder[0], -1), hop2: parcours(slotOrder[1], slotOrder[0]),
           susp: 480 + Math.floor(Math.random()*420) };
}
let drawAnimGen = 0;
async function playCardDrawAnimation(draw){
  if(!cardDrawOverlay || !cardGrid) return;
  /* Un tirage qui démarre pendant le précédent (écran public mis en
     arrière-plan : minuteries ralenties) : l'ancien ne doit pas fermer
     l'overlay au milieu du nouveau. */
  const monTirage = ++drawAnimGen;

  /* Même mise en scène quel que soit le lot (audit 23/09) : avant, le titre
     (« TOUT SE JOUE MAINTENANT », « Les cartes tombent… »), la grille qui
     tremble et la durée du suspense dépendaient du lot DÉJÀ décidé — le
     public voyait venir les gros lots et avait l'impression d'un tirage
     truqué. La durée du suspense est tirée au hasard, pour tous les lots. */
  const titreEl = document.getElementById('cardDrawTitle');
  const flashEl = document.getElementById('drawFlash');
  const setTitre = t => { if(titreEl) titreEl.textContent = t; };
  const flash = () => {
    if(!flashEl || reduceMotion) return;
    flashEl.classList.remove('on');
    void flashEl.offsetWidth;          // force le redemarrage de l'animation
    flashEl.classList.add('on');
  };

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
    /* distribution en cascade : chaque carte tombe avec son propre
       retard, au lieu des 12 qui apparaissaient d'un bloc suivies de
       400 ms de vide — c'etait le premier temps mort de la sequence */
    c.style.setProperty('--d', (i*26) + 'ms');
    c.style.setProperty('--rz', ((i%2?1:-1) * (4 + (i%3)*3)) + 'deg');
    if(!reduceMotion) c.classList.add('dealing');
    cardGrid.appendChild(c);
    cardEls.push(c);
  }
  cardDrawOverlay.classList.add('show');
  if(cardDrawTotal){ cardDrawTotal.textContent = ''; cardDrawTotal.classList.remove('stamp'); }
  setTitre('Tirage en cours…');
  // on attend que la cascade se pose, pas un delai arbitraire
  await wait(reduceMotion ? 120 : 12*26 + 180);

  const {a,b} = draw.pairs[0];
  const s1 = draw.slotOrder[0], s2 = draw.slotOrder[1];
  const setFace = (el, n) => {
    if(!el) return;
    el.querySelector('.card-num').textContent = n;
    el.querySelectorAll('.card-pip').forEach(p => p.dataset.n = n);
  };
  setFace(cardEls[s1].querySelector('.front'), a);
  setFace(cardEls[s2].querySelector('.front'), b);
  // le reste du paquet, montré à la fin (anciens messages : pas de reste)
  const reste = Array.isArray(draw.reste) ? draw.reste : null;
  if(reste){
    let k = 0;
    cardEls.forEach((c,i)=>{ if(i!==s1 && i!==s2) setFace(c.querySelector('.front'), reste[k++]); });
  }

  /* Le choix se voit : un curseur saute de carte en carte en ralentissant
     et s'arrête sur la première, puis recommence pour la seconde. Avant,
     10 cartes s'éteignaient d'un coup et les 2 « bonnes » s'allumaient
     toutes seules : personne ne choisissait, la machine montrait. */
  const pointer = async (chemin, fin)=>{
    if(!chemin || reduceMotion){ cardEls[fin].classList.add('suspense'); return; }
    for(let i=0;i<chemin.length;i++){
      const el = cardEls[chemin[i]];
      el.classList.add('pointe');
      const u = i/(chemin.length-1);
      await wait(70 + Math.round(170*u*u));
      if(i < chemin.length-1) el.classList.remove('pointe');
    }
    cardEls[fin].classList.remove('pointe');
    cardEls[fin].classList.add('suspense');
  };
  setTitre('Première carte…');
  await pointer(draw.hop1, s1);
  await wait(reduceMotion ? 60 : 160);
  setTitre('Deuxième carte…');
  await pointer(draw.hop2, s2);

  // Les cartes non tirées reculent pour laisser la scène aux deux choisies
  cardEls.forEach((c,i)=>{ if(i!==s1 && i!==s2) c.classList.add('dim'); });
  const susp = reduceMotion ? 220 : (draw.susp || 650);
  setTitre('Suspense…');
  playRiser(susp);
  await wait(susp);
  cardEls[s1].classList.remove('suspense');
  cardEls[s2].classList.remove('suspense');

  // Retournement décalé : deux cartes qui tournent exactement en même
  // temps ont l'air d'un mécanisme, pas d'un tirage. La première part,
  // la seconde suit une fraction de seconde après.
  cardEls[s1].classList.add('flipped');
  await wait(reduceMotion ? 60 : 240);
  cardEls[s2].classList.add('flipped');
  /* revealImpact tombait 700 ms APRES le second retournement, donc
     completement desynchronise de ce qu'on regardait. Il est cale sur la
     fin du retournement, avec le flash, pour ne faire qu'un seul coup. */
  await wait(reduceMotion ? 60 : 300);
  revealImpact();
  flash();

  /* Le total montait d'un coup, sans animation. Il se compte maintenant,
     puis se tamponne. */
  if(cardDrawTotal){
    const suffixe = draw.isDouble ? '  —  DOUBLE ! ⚡ Relancez pour la paire bonus' : '';
    if(reduceMotion){
      cardDrawTotal.textContent = 'Total : ' + draw.total + suffixe;
    } else {
      const t0 = performance.now(), duree = 420, depart = Math.max(2, draw.total - 5);
      await new Promise(res=>{
        const pas = ()=>{
          const u = Math.min(1, (performance.now()-t0)/duree);
          const v = Math.round(depart + (draw.total-depart)*(1-Math.pow(1-u,3)));
          cardDrawTotal.textContent = 'Total : ' + v;
          if(u < 1) requestAnimationFrame(pas);
          else {
            cardDrawTotal.textContent = 'Total : ' + draw.total + suffixe;
            cardDrawTotal.classList.remove('stamp');
            void cardDrawTotal.offsetWidth;
            cardDrawTotal.classList.add('stamp');
            res();
          }
        };
        requestAnimationFrame(pas);
      });
    }
  }
  setTitre(draw.isDouble ? 'DOUBLE !' : 'Le pion avance');
  // le reste du paquet se retourne : deux séries de 1 à 6, rien de caché
  if(reste) cardEls.forEach((c,i)=>{ if(i!==s1 && i!==s2) c.classList.add('montre'); });

  /* Fin : 330 a 1030 ms d'image figee avant, ramenees au strict
     necessaire pour lire le total. Le double garde sa pause longue,
     l'animateur doit avoir le temps d'annoncer la relance. */
  await wait(reduceMotion ? 200 : (draw.isDouble ? 1500 : 900));
  if(monTirage !== drawAnimGen) return;
  cardDrawOverlay.classList.remove('show');
  // laisse le fondu de sortie se jouer avant que le pion ne parte
  if(!reduceMotion) await wait(320);
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
  // Chance et Caisse se révèlent toutes seules (pas de bouton à cliquer, la
  // partie continue automatiquement après) : ce sont des détours.
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
    // écran public : si l'annonce de l'animateur est déjà arrivée (son pion
    // marchait encore), l'aperçu ne doit pas l'effacer
    if(cat!=='prison' && !(isDisplay && celebLocked)) showLotPreview(cat);
  }
}

const wait = ms => new Promise(r=>setTimeout(r,ms));
/* 0,36 passait SOUS le seuil forcedFast (0,42) de startWalk : chaque
   trajet normal était donc traité comme une correction de fin de partie
   et courait à 2,8 cases/s, sans jamais passer par l'allure de marche
   WALK_V_MIN..MAX. À 0,50, seuls les vrais rattrapages restent forcés. */
const HOP_DURATION = 0.50;
/* Appui sur D (garder le lot) pendant la marche : le personnage semble
   déjà arrêté pendant la décélération finale (~0,7 s) alors que le
   trajet n'est pas terminé côté jeu, et l'animateur appuie souvent pile
   à ce moment. La destination est connue dès le départ de la marche
   (les cartes sont déjà retournées), donc l'appui est retenu et le lot
   validé dès l'arrivée réelle. Un appui pendant le tirage des cartes
   n'est pas retenu, et un détour Chance/Caisse (nouvelle destination)
   l'oublie : il faut alors appuyer à nouveau. */
let claimKeyAt = 0;
const CLAIM_KEY_GRACE_MS = 20000;
const keyHintEl = document.getElementById('keyHint');
let keyHintTimer = 0;
function showKeyHint(text){
  if(!keyHintEl) return;
  keyHintEl.textContent = text;
  keyHintEl.classList.add('show');
  clearTimeout(keyHintTimer);
  keyHintTimer = setTimeout(()=>keyHintEl.classList.remove('show'), 2600);
}

/* Écran public : un lot annoncé par la régie PENDANT que le pion public
   marche encore (allure tirée au sort, fenêtre en arrière-plan) est gardé
   de côté et joué à l'arrivée. Sinon la lecture d'une carte Chance/Caisse
   l'effaçait (clearCelebration) : il ne restait que l'aperçu (audit 4). */
let celebDiffere = null;
function jouerCelebDifferee(){
  if(!celebDiffere) return;
  const m = celebDiffere; celebDiffere = null;
  celebrate(m.catKey, null, {locked:true, mystery: m.mystery});
}
async function move(forcedCount, forcedCard){
  if(moving || finished) return;
  moving = true;
  const myGen = ++generation;
  validate.disabled = true;
  if(winBtn) winBtn.hidden = true;
  claimKeyAt = 0;
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
  broadcastSync({type:'move', count, card, from: currentIndex});

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
  if(isDisplay) jouerCelebDifferee();
  /* Partie programmée à la touche : on accorde les lancers nécessaires
     pour atteindre la case demandée, AVANT de conclure que les lancers
     sont épuisés (sinon le lot de la case d'arrivée serait validé
     automatiquement juste ici, et la programmation tomberait à l'eau).

     Sans cette rallonge, les deux plus gros lots ne pouvaient JAMAIS
     sortir : le plateau fait 36 cases, le Coffret est en case 34 et
     l'ETB en 35, alors que 3 lancers (+1 par double) parcourent une
     vingtaine de cases. Les dés visaient bien la bonne case, ils
     n'avaient pas assez de lancers pour l'atteindre, et la partie
     finissait sur une commune. Mesuré avant correction : Tripack,
     Duopack et Lot Mystère sortaient, Coffret et ETB jamais.

     Cela ne concerne QUE les parties programmées, déjà hors
     comptabilité : une partie normale garde ses 3 lancers, sa mise et
     son plafond de reversement. Le plafond de sécurité évite une partie
     qui tournerait sans fin si la case visée restait hors d'atteinte. */
  const FORCED_ROLLS_MAX = 15;
  if(forcedGame && pendingOutcome && !finished
     && currentIndex >= 0 && tiles[currentIndex].catKey !== pendingOutcome
     && rollsUsed >= rollsAllowed && rollsAllowed < FORCED_ROLLS_MAX){
    rollsAllowed++;
  }
  const rollsExhausted = rollsUsed>=rollsAllowed;
  const finalCat = currentIndex>=0 ? tiles[currentIndex].catKey : null;
  const canClaim = currentIndex>0 && finalCat!=='chance' && finalCat!=='chest';
  if(finalCat==='jackpot300' && finished && canClaim && !(winBtn && winBtn.disabled)){
    // jackpot final : validé automatiquement, comme la fin des lancers
    rollsUsed = rollsAllowed;
    await claimCurrentLot();
  } else if(finalCat==='prison' && !finished && canClaim){
    // Prison : fin de partie immédiate, plus aucun lancer, carte de
    // consolation distribuée sans action de l'animateur
    rollsUsed = rollsAllowed;
    statusEl.textContent = '🔒 Prison — fin de partie.';
    await claimCurrentLot();
  } else if(rollsExhausted && !finished && canClaim){
    // Plus aucun lancer possible et le joueur n'a pas choisi de
    // s'arrêter avant : la règle du jeu dit qu'il garde alors le lot
    // sur lequel il est resté — validé automatiquement, sans action
    // de l'animateur.
    statusEl.textContent = 'Plus de lancer disponible (3 lancers, +1 par double) — le lot est automatiquement remporté.';
    await claimCurrentLot();
  } else {
    validate.disabled = finished || rollsExhausted;
    if(canClaim && !finished && claimKeyAt && performance.now() - claimKeyAt < CLAIM_KEY_GRACE_MS){
      claimKeyAt = 0;
      await claimCurrentLot();
    }
  }
}

/* Temps de lecture d'une carte Chance / Caisse : l'animateur doit
   pouvoir la lire à voix haute avant qu'elle ne laisse la place au
   déplacement. Deux seuls nombres à changer si c'est trop court ou trop
   long à l'antenne. */
const CHANCE_READ_MS = 2800;
const CHANCE_READ_RARE_MS = 3600;
/* Chance / Caisse Communautaire se révèlent automatiquement (pas de
   bouton à cliquer) : la carte s'affiche le temps d'être lue, puis
   l'annonce est effacée, son effet éventuel (avancer/reculer) est joué
   sur le plateau dégagé, et la partie continue. */
async function resolveChanceChest(myGen, forcedCard){
  claimKeyAt = 0;   // un D pressé avant le détour ne garde pas la case d'arrivée
  const idx = currentIndex;
  const catKey = tiles[idx].catKey;
  const deck = catKey==='chance' ? CHANCE_DECK : CHEST_DECK;
  const card = forcedCard || drawCard(deck);
  /* locked:true — SANS ce verrou, la durée d'affichage de la carte
     n'était pas décidée ici mais par l'animation de confettis : celle-ci
     retire l'annonce dès que ses particules sont retombées, soit 2,4 s,
     et même 1,2 s sur un lot de consolation. La carte disparaissait donc
     avant d'avoir été lue, parfois avant même la fin de l'attente
     ci-dessous. C'était le dernier endroit du jeu où un lot pouvait
     s'effacer tout seul. Le verrou pose la règle partout pareil : une
     annonce ne s'efface que quand le code le décide — ici juste après le
     temps de lecture, pour dégager le plateau avant le déplacement. */
  celebrate(catKey, card, {locked:true});

  await wait(card.rare ? CHANCE_READ_RARE_MS : CHANCE_READ_MS);
  if(myGen!==generation) return;
  clearCelebration();

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
  drawInProgress = false;
  // aucune braise ni étoile de l'arrivée précédente ne doit survivre au C
  clearArrivalFx();
  moving = false;
  finished = false;
  rollsUsed = 0;
  rollsAllowed = 3;
  if(pendingOutcome && !forcedGame){
    // partie interrompue avant validation : le lot décidé d'avance n'est
    // pas perdu, il retourne en tête de pochette (la mise reste comptée).
    // On recule la position plutôt que d'insérer une copie : la pochette
    // garde ses 245 coups et le compteur reste juste.
    const st = outcomeState;
    if(st.pos > 0 && st.batch[st.pos-1] === pendingOutcome) st.pos--;
    else st.batch.splice(st.pos, 0, pendingOutcome);
    st.enCours = false;
    saveOutcomeState();
    // la partie est annulée : sa mise ne compte plus (sinon comptée deux fois)
    totalMise = Math.max(0, totalMise - AVG_MISE); saveTotals();
  }
  pendingOutcome = null;
  forcedGame = false;
  plannedCardDelta = null;
  walk = null;
  currentIndex = -1;
  player.root.scale.set(1,1,1);
  player.root.rotation.x = 0;
  player.setWalking(false);
  stopStorm();
  cineEnd();                 // retour à la vue plateau
  updateCue();
  placeTokenInstant(-1);
  setActive(-1);
  statusEl.textContent = 'Le joueur est prêt sur Départ.';
  updatePlaceBanner(-1, false);
updateCue();
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
  if(moving || finished || rollsUsed>=rollsAllowed || drawInProgress) return;
  drawInProgress = true;
  if(winBtn) winBtn.hidden = true;   // plus de « garder » sur la case qu'on quitte
  // Premier lancer d'une partie (le pion est encore sur Départ) : une
  // partie complète = une mise, créditée automatiquement à la
  // cagnotte interne, sans aucune saisie manuelle.
  if(currentIndex===-1){
    totalMise += AVG_MISE;
    saveTotals();
    // Le lot de cette mise est décidé maintenant, tiré de la pochette
    pendingOutcome = nextPredeterminedOutcome();
    updateCue();
  }
  // On continue plutôt que de garder le lot affiché : l'aperçu (ou le
  // lot validé) de la case précédente s'efface avant le nouveau tirage.
  clearCelebration();
  clearWinUndo();
  validate.disabled = true;
  // rollsLeft compte le lancer en cours (rollsUsed n'est pas encore incrémenté)
  if(rollsUsed === 0){
    prevGameTotals = curGameTotals; curGameTotals = [];
    if(curPath.length){ pathMemory.push(curPath); if(pathMemory.length > RECENT_PATHS) pathMemory.shift(); }
    curPath = [];
  }
  const plan = planTotal(currentIndex, rollsAllowed - rollsUsed, pendingOutcome);
  plannedCardDelta = (plan && plan.cardDelta != null) ? plan.cardDelta : null;
  const draw = computeCardDraw(plan ? plan.total : null, plan ? plan.wantDouble : false);
  // Règle des 3 lancers (+1 par double, cumulable) : consommé dès le
  // lancer effectué, pas seulement à la validation du lot, sinon un
  // joueur pourrait enchaîner les lancers sans jamais les épuiser tant
  // qu'il ne valide rien.
  rollsUsed++;
  curGameTotals.push(draw.total);
  curPath.push(landingIndex(currentIndex, draw.total));
  if(draw.isDouble) rollsAllowed++;
  broadcastSync({type:'draw', draw, rollsUsed, rollsAllowed});
  topNum.textContent = draw.total;
  const genTirage = generation;
  try{ await playCardDrawAnimation(draw); } finally { drawInProgress = false; }
  if(genTirage !== generation) return;   // partie recommencée pendant le tirage
  await move(draw.total);
}

validate.addEventListener('click', drawAndMove);
// souris comme clavier : jamais pendant le tirage des cartes (audit 3)
resetBtn.addEventListener('click', ()=>{
  if(drawInProgress){ showKeyHint('⏳ Attendez la fin du tirage avant de recommencer (C)'); return; }
  restart();
});
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
/* ---------- Dés pipés vers le lot décidé d'avance ----------
   Avant, les dés étaient honnêtes et c'est au moment de « LOT REMPORTÉ »
   que le pion était déplacé jusqu'à la case la plus proche du lot
   prédéterminé : 2 cases pour une commune, jusqu'à un tour complet pour
   une « alternative » (2 cases sur le plateau) — et la carte affichée ne
   correspondait pas à la case où les dés l'avaient posé. C'était visible
   et incompréhensible en direct.
   Désormais ce sont les DÉS qui amènent le pion sur une case du lot décidé
   d'avance, et le lot remporté est TOUJOURS celui de la case où il est.
     • si une case du lot visé est atteignable (total 2 à 12) : on y va ;
     • sinon on pose le pion sur une case de passage (un petit lot encore
       en stock : commune, Caisse, Lot Mystère, booster — jamais Chance,
       Prison, Départ ni produit scellé) d'où le lot visé reste atteignable
       avec les lancers qu'il reste ; parfois exprès sur une case tentante ;
     • les totaux sont tirés au sort parmi les candidats avec les poids
       réels de deux dés (7 plus fréquent que 2 ou 12), rien ne trahit.
   Si l'hôte valide le lot AVANT que les dés aient amené le pion sur la
   case prévue, le joueur gagne le lot de sa case (moins cher, par
   construction) et le lot décidé d'avance retourne en tête de file : la
   rentabilité est préservée, le pion ne bouge jamais après un lancer. */
// Détours par Chance/Caisse : déplacements possibles de la carte, et part
// des arrivées qui passent par un détour quand c'est possible
const CARD_DELTAS = [1,2,3,4,5,6,-1,-2,-3];
const INTERMEDIATE_MAX_COST = 17;  // booster (17 €) au maximum en cours de route
let CARD_ROUTE_P = 0.40;   // dernier lancer : détour par Chance quand il est possible
const EARLY_LANDING_P = 0.30;
// lancers intermédiaires : bonus de poids (voir planTotal) pour un arrêt sur
// Chance/Caisse, sur une case tentante, ou juste à côté d'un gros lot
let CHANCE_MID_W = 2.2;
let TEMPTING_W = 2.0;
let NEAR_MISS_W = 1.8;
// « raté de peu » : seulement près du Tripack, du Coffret et de l'ETB — avec
// les 3 Duopacks, 89 % des parties en avaient un et l'effet se diluait
const NEAR_MISS_LOTS = new Set(['booster50','etb','jackpot300']);
const DICE_W = {2:1,3:2,4:3,5:4,6:5,7:6,8:5,9:4,10:3,11:2,12:1};
/* RYTHME DES LOTS DE PASSAGE (23/09, l'animateur : « il n'y a que des
   boosters qui tombent, on est au 17e coup »). Le pion s'arrête souvent sur
   une case Booster en chemin (dès le 1er lancer : case 11) ; le joueur la
   garde, et l'échange dans la pochette (claimCurrentLot) va chercher un
   booster PLUS LOIN : les 42 boosters partaient tous au début. Désormais
   une case de passage n'offre un booster, un Lot Mystère ou une Carte
   gratuite que si ce lot n'est pas déjà EN AVANCE sur la pochette : il doit
   en rester au moins autant que la part prévue pour les coups restants
   (marge d'un lot). Les communes restent toujours possibles. */
function passageAuRythme(cat){
  /* Booster : JAMAIS en passage (23/09, en direct). Un joueur qui s'arrête
     sur un booster le garde toujours, et le stock réel de boosters est
     compté : un booster ne tombe que quand la pochette l'a prévu. */
  if(cat === 'booster8') return false;
  /* Règle de l'animateur (23/09) : en chemin, SEULEMENT Lot Mystère ou
     Pioche du Prof. Chen. Tout autre lot serait gardé à coup sûr — la
     Carte gratuite (Parc, stock limité) non plus. */
  if(cat !== 'alternative' && cat !== 'commune') return false;
  const b = outcomeState.batch, pos = outcomeState.pos;
  let reste = 0;
  for(let j=pos;j<b.length;j++) if(b[j]===cat) reste++;
  if(reste <= 0) return false;
  const ligne = POUCH.find(r=>r.cat===cat);
  if(!ligne || !b.length) return true;
  const attendu = ligne.n * (b.length - pos) / b.length;   // part « normale » des coups restants
  return reste - 1 >= attendu - 1;                          // en garder un ne met pas ce lot en avance
}
function landable(idx, targetCat){
  if(idx===0) return false;                 // Départ : jamais de lot
  const cat = tiles[idx].catKey;
  // Prison (fin de partie), Chance et Caisse (détours) : jamais comme arrêt
  // de passage (elles passent par leur carte, voir viaChance)
  if(cat==='prison' || cat==='chance' || cat==='chest') return false;
  if(cat===targetCat) return true;
  /* pochette exacte : s'arrêter ici doit correspondre à un lot encore en
     stock — SAUF la commune, qui reste toujours une case de passage. Audit
     23/09 : sans communes en stock (fin de pochette), plus aucun chemin
     n'existait vers le lot prévu, le pion tombait sur une mauvaise case et
     la pochette dépassait 245 coups. Garder une commune qui n'est plus en
     stock est refusé à la touche D (claimCurrentLot). */
  if(cat !== 'commune' && !passageAuRythme(cat)) return false;
  const c = OUTCOME_COST[cat];
  if(c===undefined) return false;
  /* En cours de route : tous les PETITS lots (commune, Caisse, Lot
     Mystère, booster), qu'ils valent plus ou moins que le lot prévu. Le
     pion peut ainsi passer par un Lot Mystère que le joueur refuse pour
     tenter mieux, puis finir sur une Caisse. S'il le garde, l'échange dans
     la pochette (claimCurrentLot) tient les quantités. Jamais un produit
     scellé (duopack et au-dessus) en passage : ceux-là ne tombent que
     quand la pochette les a prévus. */
  return c <= INTERMEDIATE_MAX_COST;
}
/* Peut-on poser le pion sur une case du lot visé EXACTEMENT au dernier
   des k lancers restants, en ne posant que des cases neutres avant ?
   (Atteindre la bonne case trop tôt ne sert à rien : si l'hôte continue
   de lancer, le pion la quitte.) Les totaux 2 et 12 sont évités en
   route : ce sont forcément des doubles, donc un lancer de plus. */
function canReachTarget(pos, rollsLeft, targetCat, memo){
  if(rollsLeft<=0) return false;
  const key = pos+':'+rollsLeft;
  if(memo.has(key)) return memo.get(key);
  let ok = false;
  for(let t=2;t<=12 && !ok;t++){
    const idx = landingIndex(pos, t);
    if(rollsLeft===1){ if(t!==2 && t!==12 && idx!==0 && tiles[idx].catKey===targetCat) ok = true; }
    else if(t!==2 && t!==12 && landable(idx, targetCat) && canReachTarget(idx, rollsLeft-1, targetCat, memo)) ok = true;
  }
  memo.set(key, ok);
  return ok;
}
/* Pas deux parties identiques d'affilée : au même lancer, on évite le total
   tiré à la partie précédente dès qu'un autre total fait l'affaire. Le
   résultat (la case du lot) n'en dépend pas, seul le chemin change. */
let prevGameTotals = [], curGameTotals = [];
/* Mémoire des derniers chemins (23/09) : pour chaque partie récente, les
   cases où le pion s'est arrêté à chaque lancer. Constaté par l'animateur :
   « c'est toujours la même combinaison pour arriver au même endroit ».
   Toutes les parties partent de Départ, et les poids de vrais dés (7 six fois
   plus fréquent que 2) faisaient ressortir sans cesse les mêmes totaux.
   Désormais : poids proches des vrais dés (puissance 0,8), et chaque case déjà
   utilisée AU MÊME LANCER dans les RECENT_PATHS dernières parties voit son
   poids divisé (×0,35 par répétition). Le lot, lui, ne change pas. */
const RECENT_PATHS = 8;
let pathMemory = [], curPath = [];
function pickWeightedTotal(list, pos, bonus){
  const k = curGameTotals.length;
  const avoid = prevGameTotals[k];
  if(list.length > 1 && list.includes(avoid)) list = list.filter(t=>t!==avoid);
  const poids = t=>{
    let x = Math.pow(DICE_W[t], 0.8);   // presque les vrais poids : le 7 reste le plus fréquent
    if(bonus) x *= bonus(t);
    if(pos != null){
      const j = landingIndex(pos, t);
      let n = 0;
      for(const pth of pathMemory) if(pth[k] === j) n++;
      x *= Math.pow(0.35, n);
    }
    return x;
  };
  let sum = 0; list.forEach(t=>{ sum += poids(t); });
  let r = Math.random()*sum;
  for(const t of list){ r -= poids(t); if(r<=0) return t; }
  return list[list.length-1];
}
/* Total à faire sortir pour ce lancer (null = dés honnêtes). rollsLeft
   compte le lancer en cours. */
function planTotal(pos, rollsLeft, targetCat){
  if(!targetCat || OUTCOME_COST[targetCat]===undefined || !TILES_BY_CAT[targetCat]) return null;
  const memo = new Map();
  if(rollsLeft<=1){
    // DERNIER lancer : on pose le pion sur une case du lot visé, soit
    // directement, soit via un DÉTOUR par Chance/Caisse dont la carte
    // (déplacement pipé) l'amène sur la case du lot visé
    const now = [], via = [];
    // Départ (case 0) porte une étiquette de lot mais n'en distribue jamais
    for(let t=2;t<=12;t++){
      const idx = landingIndex(pos,t);
      if(idx!==0 && tiles[idx].catKey===targetCat){ now.push(t); continue; }
      const c = tiles[idx].catKey;
      if(c==='chance' || c==='chest'){   // détours par carte
        for(const d of CARD_DELTAS){
          const j = landingIndex(idx, d);
          if(j>0 && tiles[j].catKey===targetCat) via.push({ t, d });
        }
      }
    }
    // un détour ne se fait jamais sur 2 ou 12 (double forcé = lancer de
    // plus, le pion quitterait la case du lot après la carte)
    const viaOK = via.filter(v=>v.t!==2 && v.t!==12);
    if(viaOK.length && (!now.length || Math.random() < CARD_ROUTE_P)){
      const pick = viaOK[Math.floor(Math.random()*viaOK.length)];
      return { total: pick.t, onTarget: true, wantDouble: false, cardDelta: pick.d };
    }
    if(now.length){
      // 2 et 12 sont forcément des doubles (lancer bonus) : on les évite
      // pour que le tour puisse finir là
      const nd = now.filter(t=>t!==2 && t!==12);
      return { total: pickWeightedTotal(nd.length ? nd : now, pos), onTarget: true, wantDouble: false };
    }
  } else {
    // lancer intermédiaire : case neutre d'où le lot visé tombe pile au
    // dernier lancer ; on ne pose pas le pion sur la bonne case trop tôt.
    // Un double (lancer bonus) est décidé ICI, une fois sur trois sur un
    // total pair comme avec deux vrais dés, et le plan compte alors un
    // lancer de plus — sinon le lancer bonus faisait rater la case.
    const single = [], double = [], early = [], viaChance = [];
    for(let t=3;t<=11;t++){
      const idx = landingIndex(pos, t);
      /* Arrivée anticipée : le pion peut se poser TÔT sur une case du lot
         prévu, à condition qu'un relancer puisse l'y ramener. L'hôte peut
         garder (le résultat est le même) ou relancer : le nombre de
         lancers et de cases parcourues varie d'une partie à l'autre. */
      if(idx!==0 && tiles[idx].catKey===targetCat && canReachTarget(idx, rollsLeft-1, targetCat, memo)) early.push(t);   // pairs aussi : computeCardDraw tire alors une paire non double
      /* Chance EN COURS DE ROUTE : la carte (déplacement pipé) pose le pion
         sur une case de passage d'où le lot prévu reste atteignable. Avant,
         Chance n'était possible qu'au tout dernier lancer : on ne la voyait
         presque jamais. */
      if(tiles[idx].catKey==='chance' || tiles[idx].catKey==='chest'){
        for(const d of CARD_DELTAS){
          const j = landingIndex(idx, d);
          if(j>0 && tiles[j].catKey!==targetCat && tiles[j].catKey!=='chance' && tiles[j].catKey!=='chest' && landable(j, targetCat) && canReachTarget(j, rollsLeft-1, targetCat, memo)) viaChance.push({ t, d });
        }
      }
      if(tiles[idx].catKey===targetCat || !landable(idx, targetCat)) continue;
      if(canReachTarget(idx, rollsLeft-1, targetCat, memo)) single.push(t);
      if(t%2===0 && canReachTarget(idx, rollsLeft, targetCat, memo)) double.push(t);
    }
    /* 2 et 12 (double 1 ou double 6) : jamais sortis jusqu'ici, alors que de
       vrais dés les donnent 1 fois sur 36 chacun (audit 3). Possibles en
       cours de route, comme double : le lancer bonus est compté. */
    for(const t of [2, 12]){
      const idx = landingIndex(pos, t);
      if(landable(idx, targetCat) && tiles[idx].catKey!==targetCat && canReachTarget(idx, rollsLeft, targetCat, memo)) double.push(t);
    }
    /* Cases de passage : d'abord celles dont le lot est encore EN STOCK. Une
       commune épuisée n'est prise que s'il n'y a pas d'autre chemin (fin de
       pochette) — sinon « garder » y était souvent refusé (audit 2). */
    const enStock = t => { const c = tiles[landingIndex(pos,t)].catKey; return c === targetCat || passageAuRythme(c); };
    { const a = single.filter(enStock); if(a.length) single.splice(0, single.length, ...a); }
    { const a = double.filter(enStock); if(a.length) double.splice(0, double.length, ...a); }
    if(early.length && Math.random() < EARLY_LANDING_P) return { total: pickWeightedTotal(early, pos), onTarget: true, wantDouble: false };
    // un double à la fréquence de vrais dés (1 sur 6), sauf s'il est le seul chemin
    if(double.length && (!single.length || Math.random() < 1/6)) return { total: pickWeightedTotal(double, pos), onTarget: false, wantDouble: true };
    if(single.length || viaChance.length){
      /* UN SEUL tirage pondéré (audit 3) parmi tous les totaux possibles :
         poids de vrais dés × mémoire des chemins × un bonus pour les arrêts
         qui font vivre la partie. Avant, Chance était tirée en premier
         (55 %) : depuis Départ, le 6 (case Chance) sortait dans plus de la
         moitié des parties.
         - Chance/Caisse en cours de route (×CHANCE_MID_W) : la carte
           (déplacement pipé) pose le pion sur une case de passage d'où le
           lot prévu reste atteignable ;
         - case « tentante » (×TEMPTING_W) : un lot de passage qui n'est ni
           une commune ni le lot prévu — le joueur hésite, relance… ;
         - « raté de peu » (×NEAR_MISS_W) : arrêt juste à côté d'une case de
           gros lot (Tripack, Coffret, ETB), sinon le pion ne s'en
           approchait jamais — « le jeu fait robot », constaté par l'animateur. */
      const chanceT = new Set(viaChance.map(v=>v.t));
      /* Avant-dernier lancer : on préfère les cases d'où le lot tombe sur un
         total COURANT (6, 7, 8) au dernier lancer. Sans ça, la géométrie du
         plateau faisait sortir 3, 10 et 11 deux fois plus que de vrais dés. */
      const suite = j=>{
        if(rollsLeft!==2) return 1;
        let w = 0;
        for(let t2=3;t2<=11;t2++){ const k = landingIndex(j,t2); if(k!==0 && tiles[k].catKey===targetCat) w += DICE_W[t2]; }
        return Math.max(1, w);
      };
      const bonus = t=>{
        if(chanceT.has(t)) return CHANCE_MID_W * 3;   // la carte choisit sa case d'arrivée : poids moyen
        const j = landingIndex(pos,t), c = tiles[j].catKey;
        const b = suite(j);
        if(c!=='commune' && c!==targetCat) return TEMPTING_W * b;
        if(NEAR_MISS_LOTS.has(tiles[(j+1)%N_TILES].catKey) || NEAR_MISS_LOTS.has(tiles[(j+N_TILES-1)%N_TILES].catKey)) return NEAR_MISS_W * b;
        return b;
      };
      const t = pickWeightedTotal([...new Set([...single, ...chanceT])], pos, bonus);
      if(chanceT.has(t)){
        const cartes = viaChance.filter(v=>v.t===t);
        return { total: t, onTarget: false, wantDouble: false, cardDelta: cartes[Math.floor(Math.random()*cartes.length)].d };
      }
      return { total: t, onTarget: false, wantDouble: false };
    }
    // ni passage, ni Chance, ni double possible : l'arrivée anticipée, obligatoirement
    if(early.length) return { total: pickWeightedTotal(early, pos), onTarget: true, wantDouble: false };
  }
  // repli : une commune (jamais Chance, Prison ni Départ)
  const neutral = [];
  for(let t=2;t<=12;t++){ const idx = landingIndex(pos,t); if(idx!==0 && tiles[idx].catKey==='commune') neutral.push(t); }
  // 2 et 12 sont forcément des doubles (lancer de plus) : évités s'il y a mieux
  { const a = neutral.filter(t=>t!==2 && t!==12); if(a.length) neutral.splice(0, neutral.length, ...a); }
  if(!pouchHas('commune')){
    // plus de commune en stock : un lot de passage encore disponible, si possible
    const alt = [];
    for(let t=2;t<=12;t++){ const idx = landingIndex(pos,t); if(landable(idx, targetCat) && tiles[idx].catKey!==targetCat) alt.push(t); }
    if(alt.length) return { total: pickWeightedTotal(alt, pos), onTarget: false, wantDouble: false };
  }
  if(!pouchHas('commune')){
    /* Fin de pochette (audit 23/09) : plus aucun lot de passage en stock.
       Se poser DÉJÀ sur la case du lot prévu, plutôt que sur une commune
       qui n'existe plus : si le joueur la garde, c'est le bon lot. */
    const surCible = [];
    for(let t=3;t<=11;t++){ const idx = landingIndex(pos,t); if(idx!==0 && tiles[idx].catKey===targetCat) surCible.push(t); }
    if(surCible.length) return { total: pickWeightedTotal(surCible, pos), onTarget: true, wantDouble: false };
  }
  if(neutral.length) return { total: pickWeightedTotal(neutral, pos), onTarget: false, wantDouble: false };
  return null;
}

async function claimCurrentLot(){
  if(isDisplay) return;   // l'écran public reçoit la célébration de l'animateur
  if(currentIndex<0 || (winBtn && winBtn.disabled)) return;
  /* Garder en cours de route un lot qui n'est PLUS dans la pochette
     (communes épuisées en fin de pochette) : refusé, sinon la pochette
     dépasserait 245 coups. Seulement s'il reste des lancers : à la fin des
     lancers le pion est toujours sur le lot prévu. */
  {
    const cat = tiles[currentIndex].catKey;
    /* Lot à fenêtre (coffret, version 99 coups) : garder un autre lot le
       repousse au coup suivant ; au DERNIER coup de sa fenêtre, c'est
       refusé — le coffret ne sort jamais de sa fenêtre. */
    const fen = POCHETTE_PERSO && POCHETTE_PERSO.fenetres && POCHETTE_PERSO.fenetres[pendingOutcome];
    const finFenetre = fen && outcomeState.pos >= fen[1];      // coup en cours = pos : le 70e ou au-delà
    if(!forcedGame && pendingOutcome && cat !== pendingOutcome && (!pouchHas(cat) || finFenetre) && rollsUsed < rollsAllowed && !finished){
      showKeyHint('Lot indisponible : relancez (B)');
      return;
    }
  }
  /* Jamais pendant un lancer. Trouvé en simulation : D pressé pendant
     l'animation du tirage (le pion n'a pas encore bougé, `moving` est
     encore faux) validait le lot de la case QUITTÉE, puis le lancer
     continuait et un second lot tombait à l'arrivée : deux lots pour une
     seule partie. */
  if(moving || (cardDrawOverlay && cardDrawOverlay.classList.contains('show')) || drawInProgress) return;
  if(winBtn) winBtn.disabled = true;
  if(validate) validate.disabled = true;
  // Filet de sécurité EN DIRECT, en plus de la construction du lot déjà
  // sûre par elle-même : si la cagnotte réelle n'a pas encore
  // effectivement encaissé assez pour couvrir ce lot précis (petits
  // lots Chance/Caisse déjà distribués entre-temps, partie
  // recommencée sans avoir validé, etc.), ce lot est reporté à plus
  // tard dans la file et remplacé par un lot sûr pour cette mise —
  // jamais un lot qui ferait dépasser le plafond de reversement en vrai.
  // Le lot remporté est TOUJOURS celui de la case où le pion se trouve :
  // ce sont les dés (planTotal) qui l'y ont amené. Le pion ne bouge
  // jamais après un lancer.
  const realCat = tiles[currentIndex].catKey;
  const pendingBefore = pendingOutcome;
  const forced = forcedGame;
  forcedGame = false;
  let swap = null;
  if(pendingOutcome && realCat !== pendingOutcome && !forced){
    /* Le joueur s'arrête avant que les dés aient amené le pion sur la
       case prévue (règle « je garde ou je relance »). Il gagne le lot de
       SA case. Pochette exacte : ce lot est retiré de la suite de la
       pochette (une de ses occurrences, tirée au hasard) et le lot prévu
       y est réinséré à une position au hasard. Les quantités des 245
       coups ne bougent donc pas. Les cases de passage ne proposent que
       des lots encore en stock (voir landable). */
    const b = outcomeState.batch, pos = outcomeState.pos;
    const occ = [];
    for(let j=pos;j<b.length;j++) if(b[j]===realCat) occ.push(j);
    if(occ.length){
      const j = occ[Math.floor(Math.random()*occ.length)];
      b.splice(j, 1);
      // lot à fenêtre (coffret de la version 99 coups) : il tombe au coup
      // SUIVANT, sans être repoussé au hasard hors de sa fenêtre
      const aFenetre = POCHETTE_PERSO && POCHETTE_PERSO.fenetres && POCHETTE_PERSO.fenetres[pendingOutcome];
      const at = aFenetre ? pos : pos + Math.floor(Math.random()*(b.length - pos + 1));
      b.splice(at, 0, pendingOutcome);
      swap = { removedAt: j, insertedAt: at, kept: realCat, pending: pendingOutcome };
    } else {
      // (ne devrait pas arriver) plus de ce lot dans la pochette : le lot
      // prévu est tout de même rendu à la pochette pour ne pas être perdu
      const at = pos + Math.floor(Math.random()*(b.length - pos + 1));
      b.splice(at, 0, pendingOutcome);
      swap = { removedAt: -1, insertedAt: at, kept: realCat, pending: pendingOutcome };
    }
    recalerFenetres(b, pos, false);
    saveOutcomeState();
  }
  pendingOutcome = null;
  outcomeState.enCours = false; saveOutcomeState();
  updateCue();
  // Le plafond de reversement continue de calculer et suivre le
  // pourcentage payé exactement comme avant (mêmes 50%, même formule),
  // mais on affiche et on remet toujours le vrai lot de la case tirée,
  // jamais une version dégradée vers un palier moins cher.
  const paidBefore = totalPaid;
  const rollsUsedBefore = rollsUsed;
  // Comptabilité EXACTE : on ajoute le coût du lot réellement donné (la
  // couverture par la cagnotte est garantie en amont, au tirage du lot).
  // Prison : la commune de consolation est comptée par celebrate().
  // Partie-bonus ETB (touche Z) : rien n'est compté.
  if(realCat !== 'prison' && !forced){ totalPaid += OUTCOME_COST[realCat] || 0; saveTotals(); }
  const mystery = realCat === 'alternative' ? (forced ? (Math.random() < 0.5 ? 'booster' : 'carte') : drawMysterySub()) : null;
  celebrate(realCat, null, {locked:true, mystery});
  broadcastSync({type:'celebrate', catKey:realCat, mystery});
  lastWinUndo = { amountAdded: totalPaid - paidBefore, rollsUsedBefore, swap, pending: pendingBefore, mystery, forced, pushAt: pushCount };
  if(undoBtn) undoBtn.hidden = false;
  // Un lot gardé épuise le tour : plus aucun lancer sur cette mise.
  rollsUsed = rollsAllowed;
  if(winBtn) winBtn.disabled = true;
  validate.disabled = true;
}

if(winBtn) winBtn.addEventListener('click', claimCurrentLot);

if(undoBtn) undoBtn.addEventListener('click', ()=>{
  if(!lastWinUndo) return;
  stopStorm();                          // annuler pendant la finale : plus de foudre sur l'aperçu
  broadcastSync({type:'undo', retirer: pushCount > lastWinUndo.pushAt});
  totalPaid = Math.max(0, totalPaid - lastWinUndo.amountAdded);
  saveTotals();
  // seulement si le résultat de CE lot a déjà été affiché (pas pendant le
  // tirage du Lot Mystère ni l'orage : on retirait le gain précédent)
  if(pushCount > lastWinUndo.pushAt && lastResults.length){ lastResults.shift(); renderResultsTicker(); }
  clearCelebration();
  celebLocked = false;
  // Annuler un lot validé par erreur redonne aussi le tour : sinon le
  // joueur resterait bloqué sans lancer alors qu'aucun lot n'a
  // réellement été gardé.
  rollsUsed = lastWinUndo.rollsUsedBefore;
  if(lastWinUndo.mystery){
    // le lot mystère annulé rend son contenu à la sous-file (hors partie-bonus)
    if(!lastWinUndo.forced && outcomeState.mystPos > 0){ outcomeState.mystPos--; saveOutcomeState(); }
  }
  const sw = lastWinUndo.swap;
  if(sw && outcomeState.batch[sw.insertedAt]===sw.pending){
    // l'échange dans la pochette est défait : le lot prévu revient à
    // cette mise, le lot gardé retrouve sa place
    outcomeState.batch.splice(sw.insertedAt, 1);
    if(sw.removedAt >= 0) outcomeState.batch.splice(sw.removedAt, 0, sw.kept);
    recalerFenetres(outcomeState.batch, outcomeState.pos, false);
    saveOutcomeState();
  }
  // dans tous les cas la mise reprend son lot décidé d'avance : les
  // lancers suivants restent pipés vers sa case
  pendingOutcome = lastWinUndo.pending || null;
  forcedGame = !!lastWinUndo.forced;
  // la partie reprend : si la page est rechargée maintenant, son lot doit
  // retourner dans la pochette (audit 2 du 23/09)
  if(pendingOutcome && !forcedGame){ outcomeState.enCours = true; saveOutcomeState(); }
  updateCue();
  if(!finished) validate.disabled = (rollsUsed>=rollsAllowed);
  clearWinUndo();
  updateWinButton();
  statusEl.textContent = 'Dernière validation annulée — le lot de '+placeLabel(currentIndex)+' reste à distribuer.';
});

/* Raccourcis clavier pour piloter le jeu sans viser précisément les
   boutons à l'écran (pratique en filmant en direct) : A = démarrer,
   B = tirer les cartes, C = recommencer la partie, D = valider le lot
   remporté, Z (avant le premier lancer) = forcer l'ETB pour la partie ;
   M = forcer le Tripack ;
   chiffres 1-6 = forcer le lot n° 1 à 6 (ETB, Coffret, Tripack, Duopack,
   Booster, Lot Mystère). Ignorés si on est en train de taper
   dans un champ de texte. */
/* Mode TV : compteur de lancers, dernier total tiré et message d'état
   dans la colonne de droite. Rafraîchi à intervalle court (état simple,
   coût nul), le texte d'état est celui de la barre de statut masquée. */
const tvRolls = document.getElementById('tvRolls');
const tvTotal = document.getElementById('tvTotal');
const tvStatus = document.getElementById('tvStatus');
function updateTvHud(){
  if(!tvRolls) return;
  const started = (currentIndex >= 0 || rollsUsed > 0);
  tvRolls.textContent = 'Lancer ' + Math.min(rollsUsed, rollsAllowed) + ' / ' + rollsAllowed;
  const total = topNum ? topNum.textContent : '';
  tvTotal.textContent = finished ? 'Partie terminée' : (started && total ? 'Dernier tirage : ' + total : 'Prêt à jouer');
  if(tvStatus && statusEl) tvStatus.textContent = statusEl.textContent;
}
setInterval(updateTvHud, 250);
/* Pivot de l'image (touche R, ou ?rot=90 / ?rot=270 dans l'adresse) :
   0° → 90° → 270° → 0°. Mémorisé dans le navigateur. */
const ROT_KEY = 'pika_rot';
let uiRotation = 0;
function applyRotation(deg){
  uiRotation = (deg===90 || deg===270) ? deg : 0;
  const root = document.documentElement;
  root.classList.toggle('rotated', uiRotation !== 0);
  root.classList.toggle('rot90', uiRotation === 90);
  root.classList.toggle('rot270', uiRotation === 270);
  if(!isDisplay){ try{ localStorage.setItem(ROT_KEY, String(uiRotation)); }catch(e){} }
  setTimeout(()=>{ resize(); resizeCelebCanvas(); }, 30);
}
{
  // Priorité : ?rot= dans l'adresse > choix mémorisé (R / Pivoter) >
  // data-rot posé sur <html> (version « télé verticale » livrée déjà
  // pivotée) > image droite.
  const q = new URLSearchParams(location.search).get('rot');
  const saved = parseInt(safeGetItem(ROT_KEY), 10);
  const preset = parseInt(document.documentElement.dataset.rot || '', 10);
  applyRotation(q != null ? parseInt(q, 10) : !isNaN(saved) ? saved : !isNaN(preset) ? preset : 0);
}
/* Boutons écran : visibles au mouvement de la souris, effacés après 4 s. */
const screenBtns = document.getElementById('screenBtns');
let screenBtnsTimer = 0;
function showScreenBtns(){
  if(!screenBtns || isDisplay) return;
  screenBtns.classList.add('show');
  clearTimeout(screenBtnsTimer);
  screenBtnsTimer = setTimeout(()=>screenBtns.classList.remove('show'), 6000);
}
window.addEventListener('mousemove', showScreenBtns, {passive:true});
window.addEventListener('touchstart', showScreenBtns, {passive:true});
showScreenBtns();
const rotBtn = document.getElementById('rotBtn');
const fsBtn = document.getElementById('fsBtn');
if(rotBtn) rotBtn.addEventListener('click', ()=>{ cycleRotation(); showScreenBtns(); });
if(fsBtn) fsBtn.addEventListener('click', ()=>{ toggleFullscreen(); showScreenBtns(); });
function cycleRotation(){
  applyRotation(uiRotation === 0 ? 90 : uiRotation === 90 ? 270 : 0);
  showKeyHint(uiRotation === 0 ? 'Image droite (R pour pivoter)' : 'Image pivotée de ' + uiRotation + '° (R pour changer)');
}
function toggleFullscreen(){
  try{
    if(!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
  }catch(e){}
}
/* ---------- Bulle de regles plein ecran (touche M) ----------
   Le panneau "Regles" de la colonne laterale est en display:none dans les
   modes compacts, et se reduit a une bande minuscule sur la tele pivotee :
   illisible a plusieurs metres. D'ou cette bulle centree, qui se superpose
   a tout (z-index 70, au-dessus des trois overlays existants). */
const rulesOverlay = document.getElementById('rulesOverlay');
function sizeRulesBubble(){
  if(!rulesOverlay) return;
  /* Base de police calculee sur la hauteur du cadre du plateau, et non en
     vh : wrap est A L'INTERIEUR de #app, donc sa hauteur est mesuree dans
     le repere transforme et reste juste quand l'image est pivotee. */
  const h = (wrap && wrap.clientHeight) || 600;
  rulesOverlay.style.fontSize = Math.max(12, Math.min(32, h*0.029)) + 'px';
}
function toggleRules(force){
  if(!rulesOverlay) return;
  const on = force !== undefined ? force : !rulesOverlay.classList.contains('show');
  if(on) sizeRulesBubble();
  rulesOverlay.classList.toggle('show', on);
  rulesOverlay.setAttribute('aria-hidden', on ? 'false' : 'true');
}
window.addEventListener('resize', sizeRulesBubble);

window.addEventListener('keydown', (e)=>{
  const tag = (document.activeElement && document.activeElement.tagName) || '';
  if(tag==='INPUT' || tag==='TEXTAREA') return;
  // Ctrl/Cmd+C, Ctrl+D… ne doivent rien déclencher en direct, ni la
  // répétition automatique d'une touche maintenue
  if(e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  const k = e.key.toLowerCase();
  // écran public : il ne pilote rien (il jouait sinon sa propre partie)
  if(isDisplay && k!=='f' && k!=='r' && k!=='m' && e.key!=='Escape') return;
  if(k==='m'){ toggleRules(); e.preventDefault(); return; }
  if(e.key === 'Escape' && rulesOverlay && rulesOverlay.classList.contains('show')){
    toggleRules(false); return;
  }
  if(k==='a'){ if(startBtn && !startBtn.hidden) startBtn.click(); }
  else if(k==='b'){
    const busy = moving || (cardDrawOverlay && cardDrawOverlay.classList.contains('show'));
    if(!validate.disabled) validate.click();
    else if(busy) showKeyHint('⏳ Attendez la fin du déplacement avant de relancer (B)');
    else if(finished || rollsUsed>=rollsAllowed) showKeyHint('Partie terminée — C pour recommencer');
  }
  else if(k==='c'){
    // jamais pendant le tirage des cartes : le pion partirait quand même
    // pour une partie hors pochette (audit 23/09)
    if(drawInProgress) showKeyHint('⏳ Attendez la fin du tirage avant de recommencer (C)');
    else resetBtn.click();
  }
  else if(k==='d'){
    const drawing = cardDrawOverlay && cardDrawOverlay.classList.contains('show');
    if(winBtn && !winBtn.hidden && !winBtn.disabled) winBtn.click();
    else if(drawing) showKeyHint('⏳ Attendez l’arrivée du personnage, puis appuyez sur D');
    else if(moving){ claimKeyAt = performance.now(); showKeyHint('⏳ Le lot sera gardé dès l’arrivée du personnage'); }
    else if(winBtn && winBtn.disabled && currentIndex>0) showKeyHint('Lot déjà validé — C pour recommencer');
    else if(currentIndex<=0) showKeyHint('Aucun lot à garder : tirez d’abord les cartes (B)');
  }
  /* U : annuler le dernier lot gardé (D appuyé par erreur). Le bouton
     « Annuler » est dans le panneau latéral, masqué dans toutes les mises
     en page : sans cette touche, l'annulation était impossible (audit 4). */
  else if(k==='u'){
    if(lastWinUndo && undoBtn && !moving && !drawInProgress) undoBtn.click();
    else if(moving || drawInProgress) showKeyHint('⏳ Attendez la fin du déplacement pour annuler (U)');
    else showKeyHint('Aucun lot à annuler');
  }
  else if(k==='f'){ toggleFullscreen(); }
  else if(k==='r'){ cycleRotation(); }
});

/* Démonstration de la finale du jackpot — UNIQUEMENT sur la page de démo
   à part (elle pose window.PIKA_DEMO_JACKPOT avant ce script ; le jeu en
   direct ne la pose jamais). Sans clavier, sur téléphone, c'est la seule
   façon de voir la finale : un toucher sur l'écran remet le plateau à
   zéro, pose le pion quatre cases avant l'ETB et le fait avancer. La suite
   est la vraie séquence du jeu : arrivée, orage, enlèvement dans le
   faisceau, lot révélé. Les touchers sont ignorés tant qu'elle se joue. */
if(window.PIKA_DEMO_JACKPOT){
  let demoBusy = false;
  const demoHint = document.createElement('div');
  demoHint.className = 'key-hint show';
  demoHint.style.bottom = '64px';
  demoHint.textContent = '👆 Touchez l’écran pour voir la finale du jackpot';
  document.body.appendChild(demoHint);
  window.addEventListener('pointerdown', (e)=>{
    e.stopPropagation(); e.preventDefault();
    if(demoBusy) return;
    demoBusy = true;
    demoHint.classList.remove('show');
    restart();
    startGame();
    forcedGame = true;   // démonstration : hors pochette et hors comptabilité
    const from = LAST - 4;
    currentIndex = from;
    placeTokenInstant(from);
    setActive(from);
    setTimeout(async ()=>{
      try{ await move(4); } finally {
        setTimeout(()=>{
          demoBusy = false;
          demoHint.textContent = '👆 Touchez encore pour la revoir';
          demoHint.classList.add('show');
        }, STORM_MS + 2500);
      }
    }, 500);
  }, true);
}

if(syncChannel && isDisplay){
  syncChannel.onmessage = (e)=>{
    const m = e.data || {};
    if(m.type==='draw'){
      celebDiffere = null;
      topNum.textContent = m.draw.total; clearCelebration();
      if(typeof m.rollsUsed === 'number'){ rollsUsed = m.rollsUsed; rollsAllowed = m.rollsAllowed; }   // « Lancer N / 3 » à jour
      playCardDrawAnimation(m.draw);
    }
    else if(m.type==='undo'){
      celebDiffere = null;
      clearCelebration(); stopStorm();
      if(m.retirer && lastResults.length){ lastResults.shift(); renderResultsTicker(); }
      updateWinButton();   // l'aperçu de la case revient, comme sur la régie
    }
    else if(m.type==='move'){
      /* Les allures de marche sont tirées au hasard dans chaque fenêtre :
         si le pion public n'a pas fini ou n'est pas sur la même case, on le
         recale sur la case de départ de la régie avant de le faire marcher
         (audit 23/09 : sinon il restait décalé pour toute la suite). */
      if(m.from !== undefined && (moving || currentIndex !== m.from)){
        generation++; moving = false; walk = null; celebDiffere = null;
        currentIndex = m.from; placeTokenInstant(m.from); setActive(m.from, false);
      }
      move(m.count, m.card);
    }
    // locked:true — le lot remporté reste affiché sur l'écran public
    // exactement comme sur l'écran de l'animateur, jusqu'à RECOMMENCER
    // (qui arrive ici par le message 'restart'). Sans ce verrou, l'écran
    // public effaçait le lot dès la fin des confettis, soit à peine plus
    // de deux secondes sur un petit lot.
    else if(m.type==='celebrate'){
      if(moving) celebDiffere = m;   // joué à l'arrivée du pion public
      else celebrate(m.catKey, null, {locked:true, mystery: m.mystery});
    }
    else if(m.type==='restart'){ celebDiffere = null; restart(); }
    else if(m.type==='start') startGame();
    else if(m.type==='coups') updateCoupCount(m.n, m.total);
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
updateCoupCount();   // compteur juste dès le chargement (pochette déjà entamée)

/* ==========================================================================
   Célébration "Lot remporté" — intensité croissante selon le lot :
   commune/booster8/alt/chance/chest (1) < gradée (2) < gros booster (3)
   < ETB 150€ (4) < jackpot final 300€ (5). Esprit Pokémon : étincelles
   électriques façon Pikachu, éclat façon Pokéball qui s'ouvre, pluie
   dorée pour le jackpot.
   ========================================================================= */
const TIER_LEVEL = {
  commune:1, booster8:1, alternative:1, chance:1, chest:1, parc:2,
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
const tvResults = document.getElementById('tvResults');
function renderResultsTicker(){
  if(tvResults){
    tvResults.innerHTML = '';
    lastResults.forEach((r,i)=>{
      const item = document.createElement('div');
      item.className = 'r' + (i===0 ? ' new' : '');
      const img = document.createElement('img'); img.src = r.url; img.alt = '';
      item.appendChild(img); tvResults.appendChild(item);
    });
  }
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
let pushCount = 0;   // nombre de résultats ajoutés (Annuler ne retire que le sien)
function pushResult(catKey){
  const url = LOT_IMAGE_URLS[catKey];
  if(!url || !resultsTicker) return;
  pushCount++;
  lastResults = [{catKey,url}, ...lastResults].slice(0,5);
  renderResultsTicker();
}
let celebCtx = celebCanvas ? celebCanvas.getContext('2d') : null;
let celebParticles = [], celebRockets = [], celebEndAt = 0, celebLocked = false;
// Compteur de génération : la carte Darkrai (jackpot300) affiche son
// verdict après un délai (tremblement + éclats du plateau). Si entre
// temps l'animateur relance une partie ou valide un autre lot, ce
// jeton empêche l'affichage différé, désormais périmé, d'écraser plus
// tard la photo du lot réellement à l'écran avec celle du jackpot.
let celebGen = 0;

/* Disposition « télé verticale » (pivot R, ou vrai écran vertical) : le
   plateau est en haut, les panneaux (lots, partie en cours, derniers
   gains, règles) en dessous. La célébration du lot était centrée sur
   TOUT l'écran et recouvrait « Partie en cours » (dernier tirage) et
   les derniers gains. Elle est ramenée sur la zone du plateau, comme
   en horizontal où elle reste au-dessus de la colonne du plateau. */
const appEl = document.getElementById('app');
function verticalTvLayout(){
  return document.documentElement.classList.contains('rotated') ||
    (window.matchMedia && window.matchMedia('(max-aspect-ratio: 3/4) and (min-height: 1100px)').matches);
}
function fitCelebToBoard(){
  if(!celeb || !wrap || !appEl) return;
  if(!verticalTvLayout()){
    celeb.style.top = ''; celeb.style.height = ''; celeb.style.bottom = '';
    celeb.style.removeProperty('--celeb-box-h');
    return;
  }
  // position du plateau dans le repère de #app (offsets de mise en page,
  // insensibles à la rotation CSS), pas getBoundingClientRect (pivoté)
  let top = 0, el = wrap;
  while(el && el !== appEl){ top += el.offsetTop; el = el.offsetParent; }
  celeb.style.top = top + 'px';
  celeb.style.height = wrap.offsetHeight + 'px';
  celeb.style.bottom = 'auto';
  /* Hauteur RÉELLE de l'overlay, publiée pour la CSS : les tailles de la
     photo et du panneau sont écrites en vh/vw, or en télé pivotée #app
     est tourné de 90° et ces unités ne correspondent plus à ses axes.
     La photo se retrouvait dimensionnée sur le viewport (jusqu'à 349 px)
     dans une boîte qui n'en fait que 260, et débordait de la zone du
     plateau. Mesurée sur cette variable, elle tient dans sa boîte quelle
     que soit l'orientation. */
  celeb.style.setProperty('--celeb-box-h', wrap.offsetHeight + 'px');
}
function resizeCelebCanvas(){
  if(!celebCanvas) return;
  fitCelebToBoard();
  // taille de la boîte de l'overlay (et non de la fenêtre) : quand
  // l'interface est pivotée (télé tournée), largeur et hauteur sont inversées
  const box = celeb || document.body;
  celebCanvas.width = box.clientWidth || window.innerWidth;
  celebCanvas.height = box.clientHeight || window.innerHeight;
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

  const rocketCount = showcase ? 14 : (level>=4 ? 6 + level*2 : 2 + level);

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
        power: showcase ? 1.25+Math.random()*0.45 : (level>=4 ? 1.2+Math.random()*0.5 : 1)
      });
      if(!celebRAF) celebFrame();
    }, delay);
  }
}

/* ---------- Mode GROS LOT : ce qui s'ajoute au reveal pour tripack
   (3), coffret (4) et ETB (5) — éclairs en rafale synchronisés avec des
   coups de caméra et des impacts sonores, secousse du plateau, pluie
   d'or 3D pour le coffret, et une pluie de confettis qui tombe du haut
   de l'écran derrière la photo pendant plusieurs secondes. ---------- */
const HYPE_SUB = {
  3: '🔥 GROS LOT ! 🔥',
  4: '🔥🔥 ÉNORME ! 🔥🔥',
  5: '👑 LE GROS LOT DU LIVE ! 👑',
};
let hypeGen = 0;
function spawnConfettiRain(level, durMs){
  if(!celebCanvas || reduceMotion) return;
  const gen = ++hypeGen;
  const t0 = performance.now();
  const cols = level>=5 ? ['#ffe27a','#fff2c2','#ffffff','#ffd200','#ffb347']
                        : ['#ffe27a','#e0323f','#1a56db','#ffffff','#48e5c2','#ff6fae'];
  const per = 4 + level*2;
  const tick = ()=>{
    if(gen !== hypeGen) return;
    const W = celebCanvas.width;
    for(let i=0;i<per;i++){
      const x = Math.random()*W, sz = 4+Math.random()*5;
      celebParticles.push({
        x, y:-12, px:x, py:-12, vx:(Math.random()-0.5)*1.4, vy:1.2+Math.random()*2.2,
        g:0.02+Math.random()*0.02, size:sz, color:cols[(Math.random()*cols.length)|0],
        life:1, decay:0.0028+Math.random()*0.002, shape:'rect',
        rot:Math.random()*Math.PI, vr:(Math.random()-0.5)*0.35, spark:false, drag:0.992, twinkle:Math.random()<0.3
      });
    }
    if(!celebRAF) celebFrame();
    if(performance.now()-t0 < durMs) setTimeout(tick, 110);
  };
  tick();
}
function hypeShow(level){
  const strikes = level>=5 ? 6 : level>=4 ? 4 : 3;
  const gap = level>=5 ? 360 : 440;
  for(let i=0;i<strikes;i++){
    setTimeout(()=>{
      if(!celeb || !celeb.classList.contains('big')) return;
      triggerLightning();
      playImpact();
      cameraPunch(i%2 ? 0.7 : 1.3);
      if(i===0 || i===2){ celeb.classList.remove('shake'); void celeb.offsetWidth; celeb.classList.add('shake'); }
    }, 220 + i*gap);
  }
  if(level===3) startHypeShake(1.1, 0.06);
  if(level===4){ startHypeShake(1.6, 0.09); startGoldRain(3.4); }
  spawnConfettiRain(level, level>=5 ? 5200 : level>=4 ? 3800 : 2800);
  triggerCheer(level>=5 ? 1.6 : 1.2);
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
    if(!celebLocked) celeb.classList.remove('show','flip','rare-card','big');
  }
}

/* Arrête net la boucle de confettis et efface ce qu'elle a laissé peint.
   Deux raisons de passer par ici plutôt que d'annuler la boucle à la
   main : celebFrame() nettoie son canvas au DÉBUT de chaque image, donc
   une boucle annulée sans ce coup de gomme laisse sa dernière image
   figée à l'écran ; et surtout la boucle, en se terminant, retire
   elle-même la classe 'show' quand rien ne la verrouille — un reliquat
   de célébration encore en vol peut donc effacer ce qui vient d'être
   affiché à sa place. */
function stopCelebLoop(){
  if(celebRAF) cancelAnimationFrame(celebRAF);
  celebRAF = null;
  celebParticles = [];
  celebRockets = [];
  celebEndAt = 0;
  if(celebCtx && celebCanvas) celebCtx.clearRect(0,0,celebCanvas.width,celebCanvas.height);
}

function clearCelebration(){
  celebGen++;
  // C, B ou Annuler pendant le tirage du Lot Mystère : il s'arrête net
  if(typeof mysteryToken !== 'undefined'){ mysteryToken++; if(mysteryOverlay) mysteryOverlay.classList.remove('show'); }
  stopCelebLoop();
  celebLocked = false;
  hypeGen++;
  if(celeb) celeb.classList.remove('show','shake','flip','rare-card','big');
}

/* Aperçu du lot dès l'arrivée sur la case, avant toute décision de le
   garder ou de continuer : juste la photo, en grand, sans confettis.
   Il RESTE à l'écran : le public doit pouvoir regarder le lot aussi
   longtemps que l'animateur le commente. Trois choses seulement le
   font disparaître, toutes déclenchées par l'animateur :
     - relancer un tirage (bouton TIRER LES CARTES, ou touche B), qui
       passe par clearCelebration() avant de tirer ;
     - garder le lot (LOT REMPORTÉ), qui le verrouille à l'écran ;
     - RECOMMENCER.
   Il s'effaçait auparavant tout seul après 2,6 s, pour dégager les
   boutons — mais l'overlay est en pointer-events:none, il n'a jamais
   gêné un clic. */
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
  /* La célébration du lot précédent peut avoir laissé ses confettis en
     vol. Comme l'aperçu vient juste de remettre celebLocked à false,
     la fin de cette boucle-là retirerait la classe 'show' et effacerait
     l'aperçu tout juste affiché — quelques secondes après l'arrivée sur
     la case, sans que rien ne l'ait demandé. On reprend donc la surface
     proprement avant de l'utiliser. */
  stopCelebLoop();
  celeb.dataset.level = '';
  celeb.classList.remove('shake','big');
  hypeGen++;
  if(celebMain) celebMain.hidden = true;
  if(celebSub) celebSub.hidden = true;
  if(celebPhoto){ celebPhoto.src = url; celebPhoto.hidden = false; }
  celeb.classList.add('show');
  previewGen++;
}

/* Annonce propre à chaque catégorie de lot (plutôt qu'un message
   générique par palier) : le nom du lot réellement gagné s'affiche,
   sans jamais mentionner de prix. */
const CATEGORY_MESSAGES = {
  commune:     '🃏 PIOCHE DU PROF. CHEN GAGNÉE ! 🃏',
  booster8:    '🎁 BOOSTER DU MARCHAND GAGNÉ ! 🎁',
  alternative: '🎁 LOT MYSTÈRE GAGNÉ ! 🎁',
  gradee:      '⭐ DUOPACK 30 ANS GAGNÉ ! ⭐',
  booster50:   '🎁 TRIPACK 30 ANS GAGNÉ ! 🎁',
  etb:         '🎁 COFFRET 30 ANS GAGNÉ ! 🎁',
  jackpot300:  '👑 ETB 30 ANS GAGNÉ ! 👑',
  // contenu inconnu du jeu : les promos sont remises par l'animateur
  parc:        '🎁 CARTE GRATUITE GAGNÉE ! 🎁',
};

/* ---------- Animation du lot mystère ----------
   Deux cartes noires face cachée, qui se retournent pour montrer les
   deux lots possibles. Une ombre couvre une carte et saute de l'une à
   l'autre, vite d'abord puis de plus en plus lentement, et finit sur la
   carte NON gagnante : la carte restée en lumière est le lot remporté.
   Le résultat est décidé avant (drawMysterySub), l'animation ne fait
   que le mettre en scène. */
const mysteryOverlay = document.getElementById('mysteryOverlay');
const mysteryCards = [document.getElementById('mysteryCard0'), document.getElementById('mysteryCard1')];
const mysteryShade = document.getElementById('mysteryShade');
const mysteryResult = document.getElementById('mysteryResult');
let mysteryToken = 0;   // change à chaque clearCelebration : le tirage en cours s'arrête
async function playMysteryReveal(sub){
  if(!mysteryOverlay || !mysteryCards[0] || !mysteryShade) return;
  const tok = ++mysteryToken;
  const wait = async ms => { await new Promise(r=>setTimeout(r, ms)); if(tok !== mysteryToken) throw 'mystere-interrompu'; };
  try{ await playMysteryRevealInner(sub, wait); }
  catch(e){ if(e !== 'mystere-interrompu') throw e; }   // clearCelebration a déjà masqué ; ne pas masquer un NOUVEAU tirage
}
async function playMysteryRevealInner(sub, wait){
  const winIdx = sub === 'booster' ? 0 : 1;
  mysteryCards.forEach(c=>c.classList.remove('flipped','win','lose'));
  const img0 = mysteryCards[0].querySelector('img'), img1 = mysteryCards[1].querySelector('img');
  if(img0) img0.src = LOT_IMAGE_URLS.mystBooster;
  if(img1) img1.src = LOT_IMAGE_URLS.mystCarte;
  mysteryShade.style.transition = 'none';
  mysteryShade.style.opacity = '0';
  if(mysteryResult) mysteryResult.textContent = '';
  mysteryOverlay.classList.add('show');
  playRiser(900);
  await wait(reduceMotion ? 200 : 550);
  mysteryCards[0].classList.add('flipped');
  await wait(reduceMotion ? 50 : 200);
  mysteryCards[1].classList.add('flipped');
  await wait(reduceMotion ? 300 : 950);
  // l'ombre : calée sur la carte gagnante au départ, 11 sauts (impair)
  // donc elle finit sur l'autre carte
  // Positions dans le repère de mise en page de la scène (offsetLeft /
  // offsetTop), jamais getBoundingClientRect : quand l'interface est
  // pivotée (télé verticale, touche R, ?rot=90), les rectangles écran
  // sont tournés — largeur et hauteur s'inversent et l'écart entre les
  // deux cartes tombe à zéro. L'ombre se posait alors de travers et ne
  // sautait plus d'une carte à l'autre. Même correctif que fitCelebToBoard().
  const c0 = mysteryCards[0], c1 = mysteryCards[1];
  mysteryShade.style.left = c0.offsetLeft + 'px';
  mysteryShade.style.top = c0.offsetTop + 'px';
  mysteryShade.style.width = c0.offsetWidth + 'px';
  mysteryShade.style.height = c0.offsetHeight + 'px';
  // dx ET dy : la scène est en ligne en paysage, mais les deux cartes
  // peuvent se retrouver l'une sous l'autre sur un écran étroit.
  const dx = c1.offsetLeft - c0.offsetLeft;
  const dy = c1.offsetTop - c0.offsetTop;
  const shadeAt = p => 'translate(' + (p*dx) + 'px,' + (p*dy) + 'px)';
  let pos = winIdx;
  mysteryShade.style.transform = shadeAt(pos);
  mysteryShade.style.opacity = '1';
  await wait(120);
  // Nombre de sauts IMPAIR : partie de la carte gagnante, l'ombre finit
  // donc sur l'autre. La fin de course était trop étirée — les trois
  // derniers sauts duraient 1,24 s à eux seuls et le dernier 520 ms, ce
  // qui donnait l'impression que l'ombre restait bloquée sur une carte
  // avant l'annonce. Le ralenti est conservé, mais resserré : dernier
  // saut à 350 ms, et ~2,4 s de suspense au lieu de ~2,8 s.
  const hops = reduceMotion ? [200] : [95,100,110,125,145,170,200,230,265,305,350];
  for(const d of hops){
    pos = 1 - pos;
    mysteryShade.style.transition = 'transform ' + d + 'ms cubic-bezier(.3,.6,.3,1)';
    mysteryShade.style.transform = shadeAt(pos);
    playHop();
    await wait(d + 25);
  }
  if(pos !== 1 - winIdx){
    pos = 1 - winIdx;
    mysteryShade.style.transition = 'transform 200ms ease';
    mysteryShade.style.transform = shadeAt(pos);
    await wait(230);
  }
  mysteryCards[winIdx].classList.add('win');
  mysteryCards[1-winIdx].classList.add('lose');
  if(mysteryResult) mysteryResult.textContent = sub === 'booster' ? '🎁 BOOSTER JAPONAIS !' : '🌟 MYSTÈRE EX !';
  playFanfare(3);
  triggerImpactFlash();
  cameraPunch(1.2);
  await wait(1700);
  mysteryOverlay.classList.remove('show');
  await wait(260);
}

function celebrate(catKey, forcedCard, opts){
  celebLocked = !!(opts && opts.locked);
  const myCelebGen = ++celebGen;
  const level = TIER_LEVEL[catKey] ?? 1;
  // Luffy éclate de rire au lot gagné, plus longtemps sur les gros lots
  if(level > 0 && player.luffy) player.luffy.blink.rire(1.6 + level*0.7);
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

  // Lot mystère : les deux cartes noires se retournent, l'ombre passe de
  // l'une à l'autre en ralentissant et s'arrête ; puis le lot choisi est
  // affiché en grand comme n'importe quel autre lot.
  if(catKey==='alternative' && opts && opts.mystery){
    celeb.classList.remove('show','shake','flip','rare-card','big');
    const sub = opts.mystery;
    playMysteryReveal(sub).then(()=>{
      if(myCelebGen !== celebGen) return;
      revealCelebration(catKey, forcedCard, level, {mystery: sub});
    });
    return;
  }

  // Jackpot final (ETB) : orage sur la case du pion (foudre, onde sur
  // les cases, colonne de lumière, pluie d'or) avant que le lot
  // n'apparaisse — la suite de la célébration (photo, feux d'artifice,
  // mode gros lot) démarre au flash final, pile au bon moment.
  if(catKey==='jackpot300'){
    // On efface tout de suite l'aperçu affiché en arrivant sur la case
    // (sinon sa photo resterait visible, figée, pendant tout le
    // tremblement du plateau) : rien ne s'affiche tant que le vrai
    // reveal n'est pas prêt, jamais une photo périmée d'un autre lot.
    celeb.classList.remove('show','shake','flip','rare-card','big');
    const stormOn = startJackpotStorm();
    setTimeout(()=>{
      // Le jeton de génération protège contre un reveal différé qui
      // arriverait après coup (nouvelle partie, nouveau lot validé
      // entre-temps) : il ne doit jamais écraser un autre affichage.
      if(myCelebGen !== celebGen) return;
      revealCelebration(catKey, forcedCard, level);
    }, stormOn ? STORM_MS+60 : 0);
    return;
  }
  revealCelebration(catKey, forcedCard, level);
}

function revealCelebration(catKey, forcedCard, level, extra){
  resizeCelebCanvas();
  lightningOff = (catKey === 'jackpot300');
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
    const myst = extra && extra.mystery;
    if(celebMain) celebMain.textContent = myst
      ? (myst==='booster' ? '🎁 LOT MYSTÈRE : BOOSTER JAPONAIS ! 🎁' : '🌟 LOT MYSTÈRE : MYSTÈRE EX ! 🌟')
      : (CATEGORY_MESSAGES[catKey] || '🎉 Lot remporté !');
    if(celebSub) celebSub.hidden = true;
    // le cœur de la demande : on ne se contente plus d'un texte,
    // on montre la vraie photo du lot gagné en grand.
    if(celebPhoto){
      const url = LOT_IMAGE_URLS[myst ? (myst==='booster' ? 'mystBooster' : 'mystCarte') : catKey];
      if(url){ celebPhoto.src = url; celebPhoto.hidden = false; }
      else celebPhoto.hidden = true;
    }
    pushResult(catKey);
  }

  const effectiveLevel = rareCardDrawn ? 5 : level;
  // Mode GROS LOT : tripack, coffret, ETB (jamais pour une pioche
  // Chance/Caisse, qui a son propre retournement de carte).
  const big = effectiveLevel>=3 && !rareCardDrawn && catKey!=='chance' && catKey!=='chest';
  celeb.classList.toggle('big', big);
  if(big){
    if(celebSub){ celebSub.textContent = HYPE_SUB[effectiveLevel] || HYPE_SUB[3]; celebSub.hidden = false; }
    hypeShow(effectiveLevel);
  }
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
  celebEndAt = performance.now() + (skipFx ? 1200 : Math.max(showcase ? 4600 : 1900 + effectiveLevel*500, big ? 3600 + effectiveLevel*900 : 0));
  if(!celebRAF) celebFrame();
  setTimeout(()=>{ celeb.classList.remove('shake'); }, rareCardDrawn ? 900 : 700);
}
