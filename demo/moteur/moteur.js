/* =========================================================================
   PIKAPOLY GOLDEN — LE MOTEUR, SANS AUCUN VISUEL
   -------------------------------------------------------------------------
   Toute la logique du plateau Golden tel qu'il est joué en direct
   (board3d_golden.js, version du 05/10), sortie du visuel pour que la
   démo puisse être reconstruite de zéro par-dessus sans risquer de
   changer le jeu :
     • le plateau (36 cases, leurs lots, l'ordre) ;
     • la pochette de 130 coups (construction, consommation, échanges,
       report des lots refusés, nouvelle série) ;
     • les lots armés en silence (X / Y / Z) ;
     • les règles du Golden (le lot prévu tombe à un lancer tiré au sort,
       jamais au dernier ; refus = boosters seulement jusqu'à la fin) ;
     • les cartes pipées vers le lot décidé d'avance, les détours
       Chance / Caisse ;
     • la partie : 3 lancers, +1 par double, garder, Prison, annuler,
       recommencer ;
     • la cagnotte suivie (mise et lots comptés).

   Le code est REPRIS du jeu, fonction par fonction, avec les mêmes noms
   quand c'était possible (gPlanifier, planTotal, buildPouch…) : on peut
   comparer les deux côte à côte. Ce qui a été retiré, et pourquoi :
     • tout le DOM, three.js, le son, l'écran public ;
     • la pochette « en ligne » (base de l'artifact) : propre au direct ;
     • les coups fixes (COUPS_FIXES, vide depuis le 27/09) et le
       recalibrage du 18/09 (il ne construit plus de file) : sans effet ;
     • les cartes Chance « lot offert » (retirées du jeu le 29/09).

   Aucune animation ici : chaque action calcule son résultat tout de
   suite. C'est au visuel de le mettre en scène (tirage des cartes,
   marche du pion, lecture de la carte Chance, célébration), puis de
   n'autoriser l'action suivante qu'une fois la scène jouée.

   Usage :
     import { creerMoteur } from './moteur/moteur.js';
     const m = creerMoteur();          // stockage : localStorage, préfixe « demo: »
     m.tirer();  m.garder();  m.recommencer();  m.etat();
   ========================================================================= */

/* ---------- Le plateau : 36 cases, Départ compris ---------- */
export const N_SIDE  = 10;
export const N_CASES = 4*(N_SIDE-1);
export const DERNIERE = N_CASES-1;

/* Case 1 -> case 36, dans l'ordre (index 0 = Départ). Une ligne = un côté,
   coin compris en tête. 'booster8*' = la case « simple visite » de la
   Prison : un booster en apparence, jamais une case d'arrêt. */
export const PLATEAU = [
  'booster50','gradee','chest','booster8','booster8','booster8','chance','booster8','booster8*',
  'booster50','booster50','gradee','booster50','booster8','booster8','chest','booster8','booster8',
  'booster8','chance','gradee','booster8','booster8','booster50','booster8','etb','prison',
  'parc','booster8','booster8','booster50','booster50','chance','booster8','etb','jackpot300',
].map(tok=>({ catKey: tok.replace('*',''), isVisite: tok.endsWith('*') }));
if(PLATEAU.length !== N_CASES) throw new Error('PLATEAU : '+PLATEAU.length+' cases pour '+N_CASES);

/* Position de chaque case sur l'anneau N_SIDE × N_SIDE (ligne, colonne,
   de 1 à N_SIDE) : la case 0 est le coin en bas à droite, on tourne dans
   le sens des aiguilles d'une montre vu de dessus. */
export function positionCase(i){
  const S = N_SIDE-1;
  if(i===0)      return {r:N_SIDE, c:N_SIDE};
  if(i<=S)       return {r:N_SIDE, c:N_SIDE-i};
  if(i<=2*S)     return {r:N_SIDE-(i-S), c:1};
  if(i<=3*S)     return {r:1, c:1+(i-2*S)};
  return {r:1+(i-3*S), c:N_SIDE};
}

/* Les lots tels qu'on les nomme à l'écran (CATS du jeu). */
export const CATEGORIES = {
  commune:     { label:'Pioche du Prof. Chen',        value:'~0,68€' },
  booster8:    { label:'Booster du Marchand 30 ans',  value:'~17€'   },
  alternative: { label:'Lot Mystère',                 value:'~7,20€' },
  gradee:      { label:'Duopack 30 ans',              value:'~30€'   },
  booster50:   { label:'Tripack 30 ans',              value:'~58€'   },
  etb:         { label:'Coffret 30 ans',              value:'~85€'   },
  jackpot300:  { label:'ETB 30 ans',                  value:'~190€'  },
  chance:      { label:'Chance',                      value:'tirage' },
  chest:       { label:'Caisse Communautaire',        value:'tirage' },
  prison:      { label:'Prison',                      value:'0€'     },
  parc:        { label:'Parc gratuit',                value:'promos' },
};

/* Lieux affichés à la place des noms de rues. */
export const LIEUX = [
  'Bourg Palette','Route 1','Jadielle','Centre Pokémon','Forêt de Jade','Mont Sélénite','Azuria',
  'Cascade d\'Azuria','Carmin-sur-Mer','Route 24','Lavanville','Tour Pokémon','Zone Safari','Céladopole',
  'Casino de Céladopole','Fuchsia','Île Écume','Parmanie','Île Cramoisie','Route 21',
  'Doublonville','Centrale Électrique','Ligue Pokémon','Grotte Taupiqueur','Route 11',
  'Chenaptôme','Verdaphage','Bourg Geon','Écorcia','Rosalia','Blackthorn','Route 46','Grotte Sombre',
  'Antre Draco','Salle du Conseil des 4','Ligue Pokémon — Salle du Champion',
];

/* ---------- Pochette du Golden : 130 coups à 29 €, lots 30 ans ---------- */
export const AVG_MISE = 29;
export const POUCH = [
  { cat:'jackpot300',  n:2   },   // ETB 30 ans (entre le 99e et le 130e coup)
  { cat:'etb',         n:4   },   // Coffret 30 ans
  { cat:'booster50',   n:3   },   // Tripack 30 ans
  { cat:'gradee',      n:2   },   // Duopack 30 ans
  { cat:'booster8',    n:110 },   // Booster 30 ans
  { cat:'alternative', n:0   },
  { cat:'parc',        n:4   },   // Parc gratuit (promos)
  { cat:'prison',      n:5   },   // Prison (carte commune offerte)
  { cat:'commune',     n:0   },
];
export const POUCH_SIZE = POUCH.reduce((s,r)=>s+r.n, 0);
if(POUCH_SIZE !== 130) throw new Error('POUCH : '+POUCH_SIZE+' coups au lieu de 130');
const MYSTERY_MIX = { carte:0, booster:0 };

/* Coût de chaque lot = valeur marché (PAYOUT_LADDER du jeu). Suivi dans la
   cagnotte, mais AUCUN plafond n'est appliqué : la pochette est exacte
   (outcomeCovered renvoie toujours vrai dans le jeu depuis le 23/09). */
export const COUT_LOTS = { jackpot300:180, etb:55, booster50:45, gradee:30, booster8:14, alternative:0, commune:0, prison:0, parc:0 };

/* Touches d'armement silencieux (05/10) : X = ETB, Y = Coffret, Z = Tripack. */
export const ARMES = { x:'jackpot300', y:'etb', z:'booster50' };
const LOTS_DECLENCHES = new Set(['jackpot300','etb','booster50']);

const GROS_LOTS = new Set(['gradee','booster50','etb','jackpot300','parc','prison']);
const ETB_FIN = POUCH_SIZE, ETB_DEBUT = Math.round(POUCH_SIZE*159/210);
const OUTCOME_BATCH_VERSION = 'vip-v33-regles-130';

/* Cartes Chance / Caisse (repli quand aucun déplacement n'est planifié). */
const CHANCE_DECK = [
  { text: 'Avancez de 3 cases', weight: 4, delta:3 },
  { text: 'Avancez de 5 cases', weight: 3, delta:5 },
  { text: 'Reculez de 2 cases', weight: 3, delta:-2 },
];
const CHEST_DECK = [
  { text: 'Avancez de 2 cases', weight: 4, delta:2 },
  { text: 'Avancez de 4 cases', weight: 3, delta:4 },
  { text: 'Reculez de 1 case',  weight: 3, delta:-1 },
];
function moveCard(delta){
  const n = Math.abs(delta);
  return { text: (delta>0 ? 'Avancez de ' : 'Reculez de ')+n+' case'+(n>1?'s':''), weight: 1, delta };
}

/* Règles Golden (03/10) */
const G_VAL = { prison:0, parc:1, booster8:2, gradee:3, booster50:4, etb:5, jackpot300:6 };
const G_EXC_P = 0.04;
const G_K_POIDS = {1:1, 2:1, 3:1, 4:0.45, 5:0.12};
const G_OPTS = (()=>{ const L = [], W = {2:1,3:2,4:3,5:4,6:5,7:6,8:5,9:4,10:3,11:2,12:1};
  for(let t=2;t<=12;t++){
    if(t===2 || t===12){ L.push({t, dbl:true, w:1}); continue; }
    if(t%2===0){ L.push({t, dbl:false, w:W[t]-1}); L.push({t, dbl:true, w:1}); }
    else L.push({t, dbl:false, w:W[t]});
  }
  return L; })();

/* Cartes pipées (section « Dés pipés » du jeu) */
const CARD_DELTAS = [1,2,3,4,5,6,-1,-2,-3];
const LOTS_30_ANS = new Set(['booster8','gradee','booster50','etb','jackpot300']);
const CARD_ROUTE_P = 0.40;
const EARLY_LANDING_P = 0.30;
const CHANCE_MID_W = 2.2, TEMPTING_W = 2.0, NEAR_MISS_W = 1.8;
const NEAR_MISS_LOTS = new Set(['gradee','booster50','etb','jackpot300']);
const DICE_W = {2:1,3:2,4:3,5:4,6:5,7:6,8:5,9:4,10:3,11:2,12:1};
const RECENT_PATHS = 8;

const tiles = PLATEAU;
const TILES_BY_CAT = {};
tiles.forEach((t,i)=>{ (TILES_BY_CAT[t.catKey] = TILES_BY_CAT[t.catKey] || []).push(i); });

/* Case d'arrivée : en avançant on fait le tour du plateau ; en reculant
   on s'arrête à Départ. */
export function landingIndex(fromIdx, count){
  const start = fromIdx === -1 ? 0 : fromIdx;
  return count>=0 ? (start+count) % N_CASES : Math.max(0, start+count);
}

function stockageNavigateur(){
  try{ if(typeof localStorage !== 'undefined') return localStorage; }catch(e){}
  return null;
}

/* =========================================================================
   creerMoteur({ stockage, prefixe, aleatoire })
     stockage  : objet { getItem, setItem } (localStorage par défaut,
                 null = rien n'est enregistré) ;
     prefixe   : préfixe des clés enregistrées. « demo: » par défaut, pour
                 que la démo ne lise ni n'écrase JAMAIS la pochette du jeu
                 en direct (clés « vip:pika_* ») sur la même machine ;
     aleatoire : fonction qui rend un nombre dans [0, 1) (Math.random par
                 défaut ; les tests en passent une à graine fixe).
   ========================================================================= */
export function creerMoteur(options = {}){
  const stockage = options.stockage === undefined ? stockageNavigateur() : options.stockage;
  const prefixe = options.prefixe === undefined ? 'demo:' : options.prefixe;
  const rnd = options.aleatoire || Math.random;
  const CLE_POCHETTE = prefixe + 'pika_outcome_batch_live1';
  const CLE_MISE = prefixe + 'pika_total_mise_live1';
  const CLE_PAYE = prefixe + 'pika_total_paid_live1';
  const lire = k => { try{ return stockage ? stockage.getItem(k) : null; }catch(e){ return null; } };
  const ecrire = (k, v) => { try{ if(stockage) stockage.setItem(k, v); }catch(e){} };

  function shuffleInPlace(a){
    for(let i=a.length-1;i>0;i--){ const j = Math.floor(rnd()*(i+1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  /* ---------- Cagnotte ---------- */
  let totalMise = parseFloat(lire(CLE_MISE)) || 0;
  let totalPaid = parseFloat(lire(CLE_PAYE)) || 0;
  function saveTotals(){ ecrire(CLE_MISE, String(totalMise)); ecrire(CLE_PAYE, String(totalPaid)); }

  /* ---------- Pochette ---------- */
  let dernierePochette = null, reportAPlacer = null, lotArmeParTouche = null;
  let outcomeState = null;

  function pouchAjustee(rep){
    const P = POUCH.map(r=>({cat:r.cat, n:r.n}));
    if(!Array.isArray(rep) || !rep.length) return P;
    const fill = 'booster8';
    const F = P.find(r=>r.cat===fill);
    for(const c of rep){ const r = P.find(x=>x.cat===c); if(!r || c===fill || !F || F.n<=0) continue; r.n++; F.n--; }
    return P;
  }
  function buildPouch(rep){
    const P = pouchAjustee(rep);
    const N = POUCH_SIZE;
    const nb = c => { const r = P.find(x=>x.cat===c); return r ? r.n : 0; };
    const FILL = nb('commune') > 0 ? 'commune' : 'booster8';
    for(let essai=0; essai<6000; essai++){
      const arr = new Array(N).fill(null);
      let ok = true;
      const peut = (c,i) => {
        if(arr[i] !== null) return false;
        if(c==='prison' && i<10) return false;
        if(essai < 4000 && dernierePochette && dernierePochette[i] === c) return false;
        if(GROS_LOTS.has(c)){
          if(i>0 && GROS_LOTS.has(arr[i-1])) return false;
          if(i+1<N && GROS_LOTS.has(arr[i+1])) return false;
        }
        return true;
      };
      const poser = (c,a,z) => {
        const L = []; for(let i=Math.max(a,1); i<Math.min(z,N); i++) if(peut(c,i)) L.push(i);
        if(!L.length) return false;
        arr[L[Math.floor(rnd()*L.length)]] = c; return true;
      };
      // 1) ETB dans le dernier quart de la pochette
      const nE = nb('jackpot300'), W = ETB_FIN - ETB_DEBUT;
      for(let s=0; s<nE && ok; s++) ok = poser('jackpot300', ETB_DEBUT + Math.floor(s*W/nE), ETB_DEBUT + Math.floor((s+1)*W/nE));
      if(!ok) continue;
      // 2) les autres lots, du plus rare au plus fréquent, un par segment
      const ordre = P.filter(r=>r.n>0 && r.cat!=='jackpot300' && r.cat!==FILL)
        .sort((x,y)=> (GROS_LOTS.has(y.cat)-GROS_LOTS.has(x.cat)) || (x.n-y.n));
      for(const r of ordre){
        const bornes = [0]; { const w = []; let S = 0; for(let s=0;s<r.n;s++){ const x = 0.35 + rnd()*1.3; w.push(x); S += x; } let acc = 0; for(let s=0;s<r.n;s++){ acc += w[s]; bornes.push(Math.round(acc/S*N)); } }
        for(let s=0; s<r.n && ok; s++){
          if(!poser(r.cat, bornes[s], bornes[s+1]) && !poser(r.cat, Math.floor(s*N/r.n), Math.floor((s+1)*N/r.n))) ok = false;
        }
        if(!ok) break;
      }
      if(!ok) continue;
      for(let i=0;i<N;i++) if(arr[i]===null) arr[i] = FILL;
      for(const r of P){ if(arr.filter(c=>c===r.cat).length !== r.n){ ok = false; break; } }
      // au moins un lot autre qu'un booster par tranche de 10, jamais plus de 14 boosters d'affilée
      if(ok){ for(let t0=0;t0<N && ok;t0+=10){ let n=0; for(let i=t0;i<Math.min(N,t0+10);i++) if(arr[i]!==FILL) n++; if(!n) ok = false; } }
      if(ok){ let run=0; for(let i=0;i<N;i++){ run = arr[i]===FILL ? run+1 : 0; if(run>14){ ok = false; break; } } }
      if(ok) return arr;
    }
    throw new Error('buildPouch : plan impossible à placer');
  }
  function buildMysteryQueue(){
    const q = [];
    for(let i=0;i<MYSTERY_MIX.carte;i++) q.push('carte');
    for(let i=0;i<MYSTERY_MIX.booster;i++) q.push('booster');
    return shuffleInPlace(q);
  }
  function newOutcomeState(){
    let rep = reportAPlacer; reportAPlacer = null;
    if(!rep) rep = (outcomeState && outcomeState.report) || [];
    return { version: OUTCOME_BATCH_VERSION, batch: buildPouch(rep), pos: 0, myst: buildMysteryQueue(), mystPos: 0, updatedAt: 0, report: [] };
  }
  function saveOutcomeState(){
    outcomeState.updatedAt = Date.now();
    ecrire(CLE_POCHETTE, JSON.stringify(outcomeState));
  }
  function loadOutcomeState(){
    try{
      const raw = lire(CLE_POCHETTE);
      if(raw){
        const parsed = JSON.parse(raw);
        // page rechargée en pleine partie : le lot de la partie interrompue
        // retourne en tête de pochette, et sa mise ne compte plus
        if(parsed && parsed.enCours && parsed.pos > 0){
          parsed.pos--; parsed.enCours = false;
          totalMise = Math.max(0, totalMise - AVG_MISE); saveTotals();
        }
        if(parsed && parsed.version===OUTCOME_BATCH_VERSION && Array.isArray(parsed.batch)
           && typeof parsed.pos==='number' && parsed.pos <= parsed.batch.length
           && Array.isArray(parsed.myst) && typeof parsed.mystPos==='number'){
          return parsed;
        }
      }
    }catch(e){}
    return newOutcomeState();
  }
  outcomeState = loadOutcomeState();

  function drawMysterySub(){
    const st = outcomeState;
    const sub = st.mystPos < st.myst.length ? st.myst[st.mystPos] : (rnd() < 1/3 ? 'booster' : 'carte');
    st.mystPos++;
    saveOutcomeState();
    return sub;
  }
  function pouchHas(cat){
    const b = outcomeState.batch;
    for(let j=outcomeState.pos;j<b.length;j++) if(b[j]===cat) return true;
    return false;
  }
  /* Le lot de la partie, tiré dans la pochette au premier lancer.
     05/10 : ETB, Coffret et Tripack ne tombent QUE s'ils ont été armés
     (X / Y / Z) ; sinon, s'ils arrivent en tête, ils sont échangés avec le
     prochain lot ordinaire (quantités inchangées). */
  function nextPredeterminedOutcome(){
    if(outcomeState.pos >= outcomeState.batch.length){
      dernierePochette = outcomeState.batch; outcomeState = newOutcomeState();
    }
    let armeCeCoup = false;
    if(lotArmeParTouche){
      const cibleArmee = lotArmeParTouche; lotArmeParTouche = null;
      const b = outcomeState.batch, p = outcomeState.pos, j = b.indexOf(cibleArmee, p);
      if(j > p){ b.splice(j,1); b.splice(p,0,cibleArmee); }
      if(j >= p) armeCeCoup = true;
    }
    if(!armeCeCoup){
      const b = outcomeState.batch, p = outcomeState.pos;
      if(LOTS_DECLENCHES.has(b[p])){
        let m = -1;
        for(let i=p+1; i<b.length; i++){ if(!LOTS_DECLENCHES.has(b[i])){ m = i; break; } }
        if(m > p){ const t = b[p]; b[p] = b[m]; b[m] = t; }
      }
    }
    const cat = outcomeState.batch[outcomeState.pos];
    outcomeState.pos++;
    outcomeState.enCours = true;
    saveOutcomeState();
    return cat;
  }

  /* ---------- État de la partie ---------- */
  let currentIndex = -1;       // -1 = sur Départ, partie pas commencée
  let rollsUsed = 0, rollsAllowed = 3;
  let pendingOutcome = null;   // lot décidé d'avance pour cette partie
  let lotValide = false;       // un lot a été gardé : plus rien à jouer
  let plannedCardDelta = null;
  let gPlan = null, gRefus = false;
  let prevGameTotals = [], curGameTotals = [];
  let pathMemory = [], curPath = [];
  let lastWinUndo = null;
  let derniersGains = [];

  /* « Passage au rythme du stock » : en chemin, le Parc gratuit n'est
     proposé que s'il n'est pas déjà en avance sur la pochette. */
  function passageAuRythme(cat){
    if(cat === 'booster8') return false;
    if(cat !== 'alternative' && cat !== 'commune' && cat !== 'parc') return false;
    const b = outcomeState.batch, pos = outcomeState.pos;
    let reste = 0;
    for(let j=pos;j<b.length;j++) if(b[j]===cat) reste++;
    if(reste <= 0) return false;
    const ligne = POUCH.find(r=>r.cat===cat);
    if(!ligne || !b.length) return true;
    const attendu = ligne.n * (b.length - pos) / b.length;
    return reste - 1 >= attendu - 1;
  }
  function landable(idx){
    if(idx===0) return false;
    const c = tiles[idx].catKey;
    return (c==='booster8' && !tiles[idx].isVisite) || (c==='parc' && passageAuRythme('parc'));
  }
  function canReachTarget(pos, rollsLeft, targetCat, memo){
    if(rollsLeft<=0) return false;
    const key = pos+':'+rollsLeft;
    if(memo.has(key)) return memo.get(key);
    let ok = false;
    for(let t=2;t<=12 && !ok;t++){
      const idx = landingIndex(pos, t);
      if(rollsLeft===1){ if(t!==2 && t!==12 && idx!==0 && tiles[idx].catKey===targetCat) ok = true; }
      else if(t!==2 && t!==12 && landable(idx) && canReachTarget(idx, rollsLeft-1, targetCat, memo)) ok = true;
    }
    memo.set(key, ok);
    return ok;
  }
  function pickWeightedTotal(list, pos, bonus){
    const k = curGameTotals.length;
    const avoid = prevGameTotals[k];
    if(list.length > 1 && list.includes(avoid)) list = list.filter(t=>t!==avoid);
    const poids = t=>{
      let x = Math.pow(DICE_W[t], 0.8);
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
    let r = rnd()*sum;
    for(const t of list){ r -= poids(t); if(r<=0) return t; }
    return list[list.length-1];
  }

  /* ---------- Règles du plateau Golden ---------- */
  function gOrdre(pos, k){
    return G_OPTS.map(o=>{
      let w = Math.pow(o.w, 0.8);
      const j = landingIndex(pos, o.t);
      let n = 0; for(const p of pathMemory) if(p[k] === j) n++;
      w *= Math.pow(0.35, n);
      return { o, key: Math.pow(rnd(), 1/w) };
    }).sort((a,b)=>b.key-a.key).map(x=>x.o);
  }
  function gArret(idx, target, exc, excDone){
    if(idx <= 0) return null;
    const T = tiles[idx]; if(T.isVisite) return null;
    const c = T.catKey;
    if(c === 'booster8') return target !== 'booster8' ? 'stop' : null;
    if(c === 'parc') return (target !== 'parc' && passageAuRythme('parc')) ? 'stop' : null;
    if(exc && !excDone && c === exc) return 'exc';
    return null;
  }
  function gChercher(pos, i, allowed, K, target, exc, excDone, budget, memo){
    if(budget.n-- <= 0) return null;
    const key = pos+':'+i+':'+allowed+':'+excDone;
    if(memo.has(key)) return null;
    const last = (i+1 === K);
    for(const o of gOrdre(pos, i)){
      const allowed2 = allowed + (o.dbl ? 1 : 0);
      const idx = landingIndex(pos, o.t), c = tiles[idx].catKey;
      let cands;
      if(c === 'chance' || c === 'chest'){
        cands = [];
        for(const d of shuffleInPlace(CARD_DELTAS.slice())){
          const j = landingIndex(idx, d);
          if(j > 0 && tiles[j].catKey !== 'chance' && tiles[j].catKey !== 'chest') cands.push({ j, d });
        }
      } else cands = [{ j: idx, d: null }];
      for(const cd of cands){
        const j = cd.j, cj = tiles[j].catKey;
        if(last){
          if((!exc || excDone) && j > 0 && cj === target && !tiles[j].isVisite && (i+1) < allowed2)
            return [{ t:o.t, dbl:o.dbl, d:cd.d, j, offre: target }];
          continue;
        }
        const a = gArret(j, target, exc, excDone);
        if(!a) continue;
        const sub = gChercher(j, i+1, allowed2, K, target, exc, excDone || a === 'exc', budget, memo);
        if(sub) return [{ t:o.t, dbl:o.dbl, d:cd.d, j, offre: a === 'exc' ? exc : null }, ...sub];
      }
    }
    memo.add(key);
    return null;
  }
  function gPlanifier(target){
    if(G_VAL[target] === undefined) return null;
    const b = outcomeState.batch, pos = outcomeState.pos;
    let exc = null;
    if(G_VAL[target] >= 4 && rnd() < G_EXC_P){
      const poss = ['gradee','booster50','etb'].filter(x=>G_VAL[x] < G_VAL[target] && b.indexOf(x, pos) >= 0);
      if(poss.length) exc = poss[Math.floor(rnd()*poss.length)];
    }
    const Ks = Object.keys(G_K_POIDS).map(Number)
      .map(K=>({ K, key: Math.pow(rnd(), 1/G_K_POIDS[K]) })).sort((x,y)=>y.key-x.key).map(x=>x.K);
    for(const e of (exc ? [exc, null] : [null])){
      for(const K of Ks){
        if(e && K < 2) continue;
        const steps = gChercher(-1, 0, 3, K, target, e, false, { n: 4000 }, new Set());
        if(steps) return { steps, K, exc: e };
      }
    }
    return null;
  }
  function gPlaceRetour(b, pos){
    if(b.length < pos + 1) return b.length;
    const hi = Math.min(b.length, pos + 14);
    return pos + 1 + Math.floor(rnd() * (hi - pos));
  }
  function gRefuser(){
    gRefus = true;
    const T = pendingOutcome;
    if(!T || T === 'booster8') return;
    const st = outcomeState, b = st.batch, pos = st.pos;
    let j = -1; for(let q=pos;q<b.length;q++) if(b[q] === 'booster8'){ j = q; break; }
    if(j >= 0 && b.length - pos >= 2){
      b.splice(j, 1);
      b.splice(gPlaceRetour(b, pos), 0, T);
    } else {
      (st.report = st.report || []).push(T);
    }
    if(pos > 0) b[pos-1] = 'booster8';
    pendingOutcome = 'booster8';
    saveOutcomeState();
  }
  function gBoosterSeul(pos){
    const L = G_OPTS.filter(o=>{ const j = landingIndex(pos, o.t); return j > 0 && tiles[j].catKey === 'booster8' && !tiles[j].isVisite; });
    if(!L.length) return null;
    const o = gOrdre(pos, curGameTotals.length).find(x=>L.includes(x));
    return { total: o.t, onTarget: true, wantDouble: o.dbl, cardDelta: null };
  }

  /* ---------- Planificateur de repli (section « Dés pipés » du jeu) ---------- */
  function planTotal(pos, rollsLeft, targetCat){
    if(!targetCat || COUT_LOTS[targetCat]===undefined || !TILES_BY_CAT[targetCat]) return null;
    const memo = new Map();
    if(rollsLeft<=1){
      const now = [], via = [];
      for(let t=2;t<=12;t++){
        const idx = landingIndex(pos,t);
        if(idx!==0 && tiles[idx].catKey===targetCat){ now.push(t); continue; }
        const c = tiles[idx].catKey;
        if(c==='chance' || c==='chest'){
          for(const d of CARD_DELTAS){
            const j = landingIndex(idx, d);
            if(j>0 && tiles[j].catKey===targetCat) via.push({ t, d });
          }
        }
      }
      const viaOK = via.filter(v=>v.t!==2 && v.t!==12);
      if(viaOK.length && (!now.length || rnd() < CARD_ROUTE_P)){
        const pick = viaOK[Math.floor(rnd()*viaOK.length)];
        return { total: pick.t, onTarget: true, wantDouble: false, cardDelta: pick.d };
      }
      if(now.length){
        const nd = now.filter(t=>t!==2 && t!==12);
        return { total: pickWeightedTotal(nd.length ? nd : now, pos), onTarget: true, wantDouble: false };
      }
    } else {
      const single = [], double = [], early = [], viaChance = [];
      for(let t=3;t<=11;t++){
        const idx = landingIndex(pos, t);
        if(idx!==0 && tiles[idx].catKey===targetCat && !LOTS_30_ANS.has(targetCat) && canReachTarget(idx, rollsLeft-1, targetCat, memo)) early.push(t);
        if(tiles[idx].catKey==='chance' || tiles[idx].catKey==='chest'){
          for(const d of CARD_DELTAS){
            const j = landingIndex(idx, d);
            if(j>0 && tiles[j].catKey!==targetCat && tiles[j].catKey!=='chance' && tiles[j].catKey!=='chest' && landable(j) && canReachTarget(j, rollsLeft-1, targetCat, memo)) viaChance.push({ t, d });
          }
        }
        if(tiles[idx].catKey===targetCat || !landable(idx)) continue;
        if(canReachTarget(idx, rollsLeft-1, targetCat, memo)) single.push(t);
        if(t%2===0 && canReachTarget(idx, rollsLeft, targetCat, memo)) double.push(t);
      }
      for(const t of [2, 12]){
        const idx = landingIndex(pos, t);
        if(landable(idx) && tiles[idx].catKey!==targetCat && canReachTarget(idx, rollsLeft, targetCat, memo)) double.push(t);
      }
      const enStock = t => { const c = tiles[landingIndex(pos,t)].catKey; return c === targetCat || c === 'booster8' || passageAuRythme(c); };
      { const a = single.filter(enStock); if(a.length) single.splice(0, single.length, ...a); }
      { const a = double.filter(enStock); if(a.length) double.splice(0, double.length, ...a); }
      if(targetCat === 'prison'){
        const pr = [];
        for(let t=3;t<=11;t++){ const idx = landingIndex(pos, t); if(idx!==0 && tiles[idx].catKey==='prison') pr.push(t); }
        if(pr.length && rnd() < 1/Math.max(1, rollsLeft-1)) return { total: pickWeightedTotal(pr, pos), onTarget: true, wantDouble: false };
      }
      const earlyOk = (targetCat === 'commune' || targetCat === 'alternative' || targetCat === 'booster8');
      if(!earlyOk) early.length = 0;
      if(early.length && rnd() < EARLY_LANDING_P) return { total: pickWeightedTotal(early, pos), onTarget: true, wantDouble: false };
      if(double.length && (!single.length || rnd() < 1/6)) return { total: pickWeightedTotal(double, pos), onTarget: false, wantDouble: true };
      if(single.length || viaChance.length){
        const chanceT = new Set(viaChance.map(v=>v.t));
        const suite = j=>{
          if(rollsLeft!==2) return 1;
          let w = 0;
          for(let t2=3;t2<=11;t2++){ const k = landingIndex(j,t2); if(k!==0 && tiles[k].catKey===targetCat) w += DICE_W[t2]; }
          return Math.max(1, w);
        };
        const bonus = t=>{
          if(chanceT.has(t)) return CHANCE_MID_W * 3;
          const j = landingIndex(pos,t), c = tiles[j].catKey;
          const b = suite(j);
          if(c!=='commune' && c!==targetCat) return TEMPTING_W * b;
          if(NEAR_MISS_LOTS.has(tiles[(j+1)%N_CASES].catKey) || NEAR_MISS_LOTS.has(tiles[(j+N_CASES-1)%N_CASES].catKey)) return NEAR_MISS_W * b;
          return b;
        };
        const t = pickWeightedTotal([...new Set([...single, ...chanceT])], pos, bonus);
        if(chanceT.has(t)){
          const cartes = viaChance.filter(v=>v.t===t);
          return { total: t, onTarget: false, wantDouble: false, cardDelta: cartes[Math.floor(rnd()*cartes.length)].d };
        }
        return { total: t, onTarget: false, wantDouble: false };
      }
      if(early.length) return { total: pickWeightedTotal(early, pos), onTarget: true, wantDouble: false };
    }
    const neutral = [];
    for(let t=2;t<=12;t++){ const idx = landingIndex(pos,t); if(idx!==0 && tiles[idx].catKey==='booster8' && !tiles[idx].isVisite) neutral.push(t); }
    { const a = neutral.filter(t=>t!==2 && t!==12); if(a.length) neutral.splice(0, neutral.length, ...a); }
    if(!pouchHas('commune')){
      const alt = [];
      for(let t=2;t<=12;t++){ const idx = landingIndex(pos,t); if(landable(idx) && tiles[idx].catKey!==targetCat) alt.push(t); }
      if(alt.length) return { total: pickWeightedTotal(alt, pos), onTarget: false, wantDouble: false };
    }
    if(!pouchHas('commune')){
      const surCible = [];
      if(targetCat === 'commune' || targetCat === 'alternative' || targetCat === 'booster8') for(let t=3;t<=11;t++){ const idx = landingIndex(pos,t); if(idx!==0 && tiles[idx].catKey===targetCat) surCible.push(t); }
      if(surCible.length) return { total: pickWeightedTotal(surCible, pos), onTarget: true, wantDouble: false };
    }
    if(neutral.length) return { total: pickWeightedTotal(neutral, pos), onTarget: false, wantDouble: false };
    return null;
  }

  /* ---------- Tirage de 2 cartes (remplace les 2 dés) ---------- */
  function shuffledSlots(){
    const a = [...Array(12).keys()];
    for(let i=a.length-1;i>0;i--){ const j=Math.floor(rnd()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
    return a;
  }
  function computeCardDraw(total, wantDouble){
    let a, b;
    if(total==null){
      a = 1+Math.floor(rnd()*6);
      b = 1+Math.floor(rnd()*6);
    } else {
      const pairs = [];
      for(let x=1;x<=6;x++){ const y=total-x; if(y>=1&&y<=6) pairs.push({a:x,b:y}); }
      const doubles = pairs.filter(q=>q.a===q.b), singles = pairs.filter(q=>q.a!==q.b);
      let pick;
      if(!singles.length || (wantDouble && doubles.length)) pick = doubles[0];
      else pick = singles[Math.floor(rnd()*singles.length)];
      a = pick.a; b = pick.b;
    }
    // le paquet de 12 cartes (deux séries de 1 à 6) : places des deux cartes
    // tirées, reste du paquet, et chemin du curseur qui « choisit » à l'écran
    const slotOrder = shuffledSlots();
    const reste = [1,2,3,4,5,6,1,2,3,4,5,6];
    reste.splice(reste.indexOf(a), 1); reste.splice(reste.indexOf(b), 1);
    for(let i=reste.length-1;i>0;i--){ const j=Math.floor(rnd()*(i+1)); [reste[i],reste[j]]=[reste[j],reste[i]]; }
    const parcours = (fin, interdit)=>{
      const n = 5 + Math.floor(rnd()*4), ch = [];
      let prev = -1;
      for(let i=0;i<n;i++){
        let k; do{ k = Math.floor(rnd()*12); }while(k===prev || k===fin || k===interdit);
        ch.push(k); prev = k;
      }
      ch.push(fin);
      return ch;
    };
    return { a, b, total: a+b, isDouble: a===b, slotOrder, reste,
             hop1: parcours(slotOrder[0], -1), hop2: parcours(slotOrder[1], slotOrder[0]),
             susp: 480 + Math.floor(rnd()*420) };
  }
  function drawCard(deck){
    if(plannedCardDelta != null){
      const c = moveCard(plannedCardDelta);
      plannedCardDelta = null;
      return c;
    }
    const total = deck.reduce((s,c)=>s+c.weight,0);
    let r = rnd()*total;
    for(const c of deck){ r -= c.weight; if(r<=0) return c; }
    return deck[deck.length-1];
  }

  /* ---------- Actions ---------- */
  const casePrimee = () => currentIndex>0 && !['chance','chest'].includes(tiles[currentIndex].catKey);

  /* Garder le lot de la case où se trouve le pion (touche D). Le lot gagné
     est TOUJOURS celui de la case. S'il diffère du lot prévu, la pochette
     échange les deux (quantités inchangées). */
  function garder(){
    if(!casePrimee()) return { refuse: currentIndex<=0 ? 'aucun-lot' : 'case-detour' };
    if(lotValide) return { refuse: 'deja-valide' };
    const realCat = tiles[currentIndex].catKey;
    const pendingBefore = pendingOutcome;
    let swap = null;
    if(pendingOutcome && realCat !== pendingOutcome){
      const b = outcomeState.batch, pos = outcomeState.pos;
      let j = -1;
      for(let q=pos;q<b.length;q++) if(b[q]===realCat){ j = q; break; }
      if(j >= 0){
        b.splice(j, 1);
        const at = gPlaceRetour(b, pos);
        b.splice(at, 0, pendingOutcome);
        swap = { removedAt: j, insertedAt: at, kept: realCat, pending: pendingOutcome };
      } else {
        (outcomeState.report = outcomeState.report || []).push(pendingOutcome);
        swap = { removedAt: -1, insertedAt: -1, kept: realCat, pending: pendingOutcome, report: true };
      }
    }
    pendingOutcome = null;
    outcomeState.enCours = false; saveOutcomeState();
    const paidBefore = totalPaid;
    const rollsUsedBefore = rollsUsed;
    if(realCat !== 'prison'){ totalPaid += COUT_LOTS[realCat] || 0; saveTotals(); }
    const mystery = realCat === 'alternative' ? drawMysterySub() : null;
    // Prison : une carte commune de consolation, affichée dans les derniers gains
    const affiche = realCat === 'prison' ? 'commune' : realCat;
    derniersGains.unshift(affiche); if(derniersGains.length > 12) derniersGains.length = 12;
    lastWinUndo = { amountAdded: totalPaid - paidBefore, rollsUsedBefore, swap, pending: pendingBefore, mystery };
    rollsUsed = rollsAllowed;
    lotValide = true;
    return { lot: realCat, caseIndex: currentIndex, mystere: mystery, prison: realCat === 'prison',
             serieTerminee: outcomeState.pos >= outcomeState.batch.length };
  }

  /* Tirer les cartes (touche B) : tout le lancer est calculé d'un coup,
     arrivée et éventuel détour Chance/Caisse compris. Si la partie se
     termine d'elle-même (Prison, lancers épuisés), le lot est gardé ici et
     rendu dans « gain ». Le visuel joue la scène, puis montre le gain. */
  function tirer(){
    if(lotValide || rollsUsed>=rollsAllowed) return { refuse: 'partie-terminee' };
    const nouvellePartie = currentIndex===-1;
    if(nouvellePartie){
      totalMise += AVG_MISE; saveTotals();
      pendingOutcome = nextPredeterminedOutcome();
      gRefus = false;
      gPlan = pendingOutcome ? gPlanifier(pendingOutcome) : null;
    }
    lastWinUndo = null;
    if(rollsUsed === 0){
      prevGameTotals = curGameTotals; curGameTotals = [];
      if(curPath.length){ pathMemory.push(curPath); if(pathMemory.length > RECENT_PATHS) pathMemory.shift(); }
      curPath = [];
    }
    let plan = null, refus = false;
    if(pendingOutcome){
      // relancer alors que le pion est sur le lot proposé = REFUS
      if(gPlan && !gRefus && rollsUsed > 0){
        const st = gPlan.steps[rollsUsed-1];
        if(st && st.offre && currentIndex === st.j && tiles[currentIndex].catKey === st.offre){ gRefuser(); refus = true; }
      }
      if(gRefus) plan = gBoosterSeul(currentIndex);
      else if(gPlan && gPlan.steps[rollsUsed]){ const sp = gPlan.steps[rollsUsed]; plan = { total: sp.t, onTarget: !!sp.offre, wantDouble: sp.dbl, cardDelta: sp.d }; }
    }
    if(!plan) plan = planTotal(currentIndex, rollsAllowed - rollsUsed, pendingOutcome);
    if(!plan && pendingOutcome){
      const sur = [];
      for(let t=3;t<=11;t++){
        const c = tiles[landingIndex(currentIndex, t)].catKey;
        if(c==='booster8' || (c===pendingOutcome && rollsAllowed - rollsUsed <= 1)) sur.push(t);
      }
      if(sur.length){
        const t = sur[Math.floor(rnd()*sur.length)];
        plan = { total: t, onTarget: tiles[landingIndex(currentIndex, t)].catKey===pendingOutcome, wantDouble: false };
      }
    }
    plannedCardDelta = (plan && plan.cardDelta != null) ? plan.cardDelta : null;
    const cartes = computeCardDraw(plan ? plan.total : null, plan ? plan.wantDouble : false);
    rollsUsed++;
    curGameTotals.push(cartes.total);
    const depart = currentIndex;
    const caseDes = landingIndex(currentIndex, cartes.total);
    curPath.push(caseDes);
    if(cartes.isDouble) rollsAllowed++;

    // déplacement, puis détour Chance / Caisse éventuel
    let carte = null;
    const catDes = tiles[caseDes].catKey;
    currentIndex = caseDes;
    if(catDes==='chance' || catDes==='chest'){
      const c = drawCard(catDes==='chance' ? CHANCE_DECK : CHEST_DECK);
      const apres = landingIndex(caseDes, c.delta);
      carte = { type: catDes, texte: c.text, delta: c.delta, de: caseDes, vers: apres };
      currentIndex = apres;
    }
    plannedCardDelta = null;

    const res = { nouvellePartie, refusDuLotPrecedent: refus, cartes, depart, caseDes, carte,
                  caseFinale: currentIndex, lotDeLaCase: tiles[currentIndex].catKey,
                  lancersUtilises: rollsUsed, lancersAutorises: rollsAllowed, finAuto: null, gain: null };
    const finalCat = tiles[currentIndex].catKey;
    if(casePrimee()){
      if(finalCat==='prison'){ rollsUsed = rollsAllowed; res.finAuto = 'prison'; res.gain = garder(); }
      else if(rollsUsed>=rollsAllowed){ res.finAuto = 'lancers-epuises'; res.gain = garder(); }
    }
    res.lancersUtilises = rollsUsed;
    return res;
  }

  /* Annuler le dernier lot gardé (touche U) : la partie reprend avec son
     lot décidé d'avance, la pochette et la cagnotte sont remises comme
     avant. */
  function annuler(){
    if(!lastWinUndo) return { refuse: 'rien-a-annuler' };
    const u = lastWinUndo;
    totalPaid = Math.max(0, totalPaid - u.amountAdded); saveTotals();
    if(derniersGains.length) derniersGains.shift();
    rollsUsed = u.rollsUsedBefore;
    if(u.mystery && outcomeState.mystPos > 0){ outcomeState.mystPos--; }
    const sw = u.swap;
    if(sw && sw.report){
      const r = outcomeState.report || []; const ix = r.lastIndexOf(sw.pending); if(ix >= 0) r.splice(ix, 1);
    } else if(sw){
      const b = outcomeState.batch, p0 = outcomeState.pos;
      let k = -1, best = Infinity;
      for(let q=p0;q<b.length;q++) if(b[q]===sw.pending){ const d = Math.abs(q-sw.insertedAt); if(d<best){ best=d; k=q; } }
      if(k >= 0){
        b.splice(k, 1);
        if(sw.removedAt >= 0) b.splice(Math.min(sw.removedAt, b.length), 0, sw.kept);
      }
    }
    pendingOutcome = u.pending || null;
    if(pendingOutcome) outcomeState.enCours = true;
    saveOutcomeState();
    lotValide = false;
    lastWinUndo = null;
    return { ok: true, caseIndex: currentIndex };
  }

  /* Recommencer (touche C) : partie interrompue avant d'avoir gardé un
     lot = son lot retourne en tête de pochette et sa mise ne compte plus. */
  function recommencer(){
    if(pendingOutcome){
      const st = outcomeState;
      if(st.pos > 0 && st.batch[st.pos-1] === pendingOutcome) st.pos--;
      else st.batch.splice(st.pos, 0, pendingOutcome);
      st.enCours = false;
      saveOutcomeState();
      totalMise = Math.max(0, totalMise - AVG_MISE); saveTotals();
    }
    pendingOutcome = null;
    plannedCardDelta = null;
    gPlan = null; gRefus = false;
    currentIndex = -1;
    rollsUsed = 0; rollsAllowed = 3;
    lotValide = false;
    lastWinUndo = null;
    // série finie (130/130) : retour automatique à 0, cagnotte comprise (finDePochette)
    if(outcomeState.pos >= outcomeState.batch.length && !outcomeState.enCours){
      totalMise = 0; totalPaid = 0; saveTotals();
      dernierePochette = outcomeState.batch;
      outcomeState = newOutcomeState();
      saveOutcomeState();
      derniersGains = [];
      return { ok: true, nouvelleSerie: true };
    }
    return { ok: true };
  }

  /* Armer un gros lot pour le prochain coup (touches X / Y / Z), pion sur
     Départ seulement. Même touche une deuxième fois = annulation. Rien ne
     doit s'afficher à l'écran. */
  function armer(touche){
    const A = ARMES[String(touche).toLowerCase()];
    if(!A) return { refuse: 'touche-inconnue' };
    if(currentIndex !== -1) return { refuse: 'pas-sur-depart' };
    if(lotArmeParTouche === A){ lotArmeParTouche = null; return { arme: null }; }
    const reste = outcomeState.batch.slice(outcomeState.pos).filter(c=>c===A).length;
    if(reste) lotArmeParTouche = A;
    return { arme: reste ? A : lotArmeParTouche };
  }

  /* Nouvelle série : cagnotte à zéro et nouvelle pochette (fin de
     pochette, ou remise à zéro). */
  function nouvelleSerie(){
    if(recommencer().nouvelleSerie) return { ok: true };
    totalMise = 0; totalPaid = 0; saveTotals();
    dernierePochette = outcomeState.batch;
    outcomeState = newOutcomeState();
    saveOutcomeState();
    derniersGains = [];
    return { ok: true };
  }

  /* Instantané de l'état, pour l'affichage. Ne révèle jamais le lot prévu
     ni la suite de la pochette (« on peut prédire les lots »). */
  function etat(){
    const b = outcomeState.batch;
    const joues = Math.max(0, outcomeState.pos - (pendingOutcome ? 1 : 0));
    const etbTotal = b.filter(c=>c==='jackpot300').length;
    let etbAVenir = pendingOutcome === 'jackpot300' ? 1 : 0;
    for(let j=outcomeState.pos;j<b.length;j++) if(b[j]==='jackpot300') etbAVenir++;
    const cat = currentIndex>=0 ? tiles[currentIndex].catKey : null;
    return {
      caseIndex: currentIndex,
      lieu: currentIndex>=0 ? LIEUX[currentIndex] : 'Départ',
      lotDeLaCase: cat,
      peutGarder: casePrimee() && !lotValide,
      peutTirer: !lotValide && rollsUsed < rollsAllowed,
      partieEnCours: currentIndex !== -1,
      lotValide,
      lancersUtilises: rollsUsed, lancersAutorises: rollsAllowed,
      coupsJoues: joues, coupsTotal: b.length,
      etbSorties: Math.max(0, etbTotal - etbAVenir), etbTotal,
      derniersGains: derniersGains.slice(),
      peutAnnuler: !!lastWinUndo,
      cagnotte: { mise: totalMise, lotsComptes: totalPaid },
    };
  }

  /* Accès réservé aux tests : la pochette et le lot prévu. Le visuel ne
     doit jamais s'en servir. */
  const _interne = {
    pochette: () => outcomeState,
    lotPrevu: () => pendingOutcome,
    lotArme: () => lotArmeParTouche,
  };

  // série déjà finie au chargement : on repart sur une nouvelle (finDePochette)
  if(outcomeState.pos >= outcomeState.batch.length && !outcomeState.enCours) nouvelleSerie();
  else saveOutcomeState();

  return { tirer, garder, annuler, recommencer, armer, nouvelleSerie, etat, _interne };
}
