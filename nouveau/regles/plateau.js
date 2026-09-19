/* Le plateau : données pures, sans DOM ni three.js.
   Tout ce qui décrit une case (catégorie, lieu, couleur, libellé) vit ici,
   une seule fois. `scene/` s'en sert pour dessiner, `ui/` pour écrire,
   `regles/planificateur.js` pour viser une case. */

export const N_SIDE  = 10;
export const N_TILES = 4*(N_SIDE-1);      // 36 cases : 9 par côté, coins compris
export const LAST    = N_TILES-1;
const SIDE = N_SIDE-1;
const CELL = 1;
const GRID_C = (N_SIDE+1)/2;

/* Position (rangée, colonne) de la case i sur l'anneau, puis en unités
   monde (x, z), et orientation pour que le bas de la carte regarde
   toujours vers l'extérieur du plateau. */
export function ringPos(i){
  if(i===0)        return {r:N_SIDE, c:N_SIDE};
  if(i<=SIDE)      return {r:N_SIDE, c:N_SIDE-i};
  if(i<=2*SIDE)    return {r:N_SIDE-(i-SIDE), c:1};
  if(i<=3*SIDE)    return {r:1, c:1+(i-2*SIDE)};
  return {r:1+(i-3*SIDE), c:N_SIDE};
}
export function toWorld(r,c){ return { x:(c-GRID_C)*CELL, z:(r-GRID_C)*CELL }; }
export function outwardYaw(r,c){
  if(r===N_SIDE) return 0;
  if(c===1)      return -Math.PI/2;
  if(r===1)      return Math.PI;
  return Math.PI/2;
}

/* Case 1 → case 36, dans l'ordre (index 0 = Départ, coin bas droit).
   'commune*' = la commune « Prison, simple visite » (thématique). */
export const BOARD_DATA = [
  'booster8','alternative','chest','commune','commune','commune','chance','commune','commune*',
  'gradee','booster8','alternative','gradee','commune','commune','chest','commune','commune',
  'commune','chance','commune','commune','commune','gradee','commune','booster50','prison',
  'commune','commune','commune','booster8','booster8','chance','commune','etb','jackpot300',
].map(tok=>({ cat: tok.replace('*',''), isVisite: tok.endsWith('*') }));
if(BOARD_DATA.length !== N_TILES) throw new Error('BOARD_DATA : '+BOARD_DATA.length+' cases pour '+N_TILES);

export function catAt(idx){ return BOARD_DATA[idx].cat; }

/* Index catégorie → cases correspondantes (le Départ garde son étiquette
   booster8 mais ne distribue jamais rien : il est exclu partout ailleurs). */
export const TILES_BY_CAT = {};
BOARD_DATA.forEach((d,i)=>{ (TILES_BY_CAT[d.cat] = TILES_BY_CAT[d.cat] || []).push(i); });

/* Un dépassement de la dernière case continue depuis la case 1 (tour de
   plateau) ; un recul ne dépasse jamais la case 1. */
export function landingIndex(fromIdx, count){
  const start = fromIdx === -1 ? 0 : fromIdx;
  return count>=0 ? (start+count) % N_TILES : Math.max(0, start+count);
}

export const POKEMON_PLACES = [
  'Bourg Palette','Route 1','Jadielle','Centre Pokémon','Forêt de Jade','Mont Sélénite','Azuria',
  'Cascade d\'Azuria','Carmin-sur-Mer','Route 24','Lavanville','Tour Pokémon','Zone Safari','Céladopole',
  'Casino de Céladopole','Fuchsia','Île Écume','Parmanie','Île Cramoisie','Route 21',
  'Doublonville','Centrale Électrique','Ligue Pokémon','Grotte Taupiqueur','Route 11',
  'Chenaptôme','Verdaphage','Bourg Geon','Écorcia','Rosalia','Blackthorn','Route 46','Grotte Sombre',
  'Antre Draco','Salle du Conseil des 4','Ligue Pokémon — Salle du Champion',
];
if(POKEMON_PLACES.length !== N_TILES) throw new Error('POKEMON_PLACES : '+POKEMON_PLACES.length+' noms pour '+N_TILES);

/* Préposition de « Rendez-vous … » : reprise telle quelle de l'ancien jeu
   (indexée sur les 40 anciens lieux, seuls les 36 premiers servent). */
const PLACE_PREP = [
  '', '', '', 'au ', 'à la ', 'au ', '', '', 'à la ', '',
  '', '', 'à la ', 'à la ', '', 'au ', '', "à l'", '', 'au ',
  "à l'", '', '', 'à la ', 'à la ', 'au ', 'à la ', '', '', '',
  '', '', '', '', '', '', 'à la ', "à l'", 'à la ', 'à la ',
];
export function shortPlaceName(idx){
  if(idx<0) return 'Départ';
  if(idx===LAST) return 'Salle du Champion';
  return POKEMON_PLACES[idx];
}
export function placePhrase(idx){
  const name = shortPlaceName(idx);
  const prep = PLACE_PREP[idx] || '';
  return prep ? ' '+prep+name : ', '+name;
}
export function placeLabel(idx){
  if(idx<0) return 'Départ';
  return POKEMON_PLACES[idx] + ' (case ' + (idx+1) + ')';
}

export const GOLD = '#e9c34a';
export const GOLD_BRIGHT = '#ffe27a';
export const SWATCH_COLORS = {
  bronze:'#a9793a', blue:'#2f6fdc', red:'#e0323f', purple:'#9a5fe0',
  green:'#33b46a', gold:'#e9c34a', danger:'#d62b2b',
  jackpot:'#ffd700', orange:'#e8863c', rose:'#d6549c', teal:'#2fb8b0',
};
export const CATS = {
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
};
export function accentOf(catKey){ return SWATCH_COLORS[CATS[catKey].swatch]; }

/* Intensité de la célébration : prison 0 · petits lots 1 · duopack 2 ·
   tripack 3 · coffret 4 · ETB 5. */
export const TIER_LEVEL = {
  commune:1, booster8:1, alternative:1, chance:1, chest:1,
  gradee:2, booster50:3, etb:4, jackpot300:5, prison:0,
};
export const CATEGORY_MESSAGES = {
  commune:     '🃏 PIOCHE DU PROF. CHEN GAGNÉE ! 🃏',
  booster8:    '🎁 BOOSTER DU MARCHAND GAGNÉ ! 🎁',
  alternative: '🎁 LOT MYSTÈRE GAGNÉ ! 🎁',
  gradee:      '⭐ DUOPACK 30 ANS GAGNÉ ! ⭐',
  booster50:   '🎁 TRIPACK 30 ANS GAGNÉ ! 🎁',
  etb:         '🎁 COFFRET 30 ANS GAGNÉ ! 🎁',
  jackpot300:  '👑 ETB 30 ANS GAGNÉ ! 👑',
};
export const HYPE_SUB = {
  3: '🔥 GROS LOT ! 🔥',
  4: '🔥🔥 ÉNORME ! 🔥🔥',
  5: '👑 LE GROS LOT DU LIVE ! 👑',
};

/* Photos : chemins relatifs à la page nouveau/pikapoly.html ; le bundle
   les remplace par leur contenu. */
export const LOT_IMAGE_URLS = {
  commune:    '../assets/lots/commune.jpg',
  booster8:   '../assets/lots/booster8.jpg',
  alternative:'../assets/lots/alternative.jpg',
  gradee:     '../assets/lots/gradee.jpg',
  booster50:  '../assets/lots/booster50.jpg',
  etb:        '../assets/lots/etb150.jpg',
  jackpot300: '../assets/lots/jackpot300.jpg',
  mystBooster:'../assets/lots/mystere_booster.jpg',
  mystCarte:  '../assets/lots/mystere_carte.jpg',
};

/* Légende de la plaque centrale et du panneau télé : les 7 vrais lots,
   du plus gros au plus petit. */
export const CENTER_LEGEND_ROWS = [
  {swatch:'jackpot', catKey:'jackpot300'},
  {swatch:'orange',  catKey:'etb'},
  {swatch:'rose',    catKey:'booster50'},
  {swatch:'teal',    catKey:'gradee'},
  {swatch:'blue',    catKey:'booster8'},
  {swatch:'red',     catKey:'alternative'},
  {swatch:'bronze',  catKey:'commune'},
];

/* Amplitudes d'animation des lots flottants, par catégorie. */
export const MOTION = {
  booster8:  {bob:0.10, swing:0.3},
  gradee:    {bob:0.11, swing:0.35},
  booster50: {bob:0.13, swing:0.3},
  etb:       {bob:0.15, swing:0.28},
  jackpot300:{bob:0.17, swing:0.25},
  chance:    {bob:0.12, spin:0},
  chest:     {bob:0.09, spin:0},
  prison:    {bob:0.07, pulse:true},
};

/* Cartes Chance / Caisse : jeux de repli quand le planificateur n'a rien
   décidé. La carte rare pèse 1 sur 25. */
export const RARE_GRADEE_CARD = { text: '★ CARTE GRADÉE OFFERTE (20-80€) — TRÈS RARE ★', weight: 1, rare: true, effect:{type:'prize', cat:'gradee'} };
export const CHANCE_DECK = [
  { text: 'Avancez de 3 cases', weight: 4, effect:{type:'move', delta:3} },
  { text: 'Avancez de 5 cases', weight: 3, effect:{type:'move', delta:5} },
  { text: 'Reculez de 2 cases', weight: 3, effect:{type:'move', delta:-2} },
];
export const CHEST_DECK = [
  { text: 'Avancez de 2 cases', weight: 4, effect:{type:'move', delta:2} },
  { text: 'Avancez de 4 cases', weight: 3, effect:{type:'move', delta:4} },
  { text: 'Reculez de 1 case',  weight: 3, effect:{type:'move', delta:-1} },
];
export function moveCard(delta){
  const n = Math.abs(delta);
  return { text: (delta>0 ? 'Avancez de ' : 'Reculez de ')+n+' case'+(n>1?'s':''), weight: 1, effect:{type:'move', delta} };
}
export function deckFor(catKey){ return catKey==='chance' ? CHANCE_DECK : CHEST_DECK; }
