/* Dés pipés vers le lot décidé d'avance. Module pur : ne connaît que le
   plateau (regles/plateau.js) et les coûts (regles/argent.js). Tout tirage
   au sort passe par `rng` (Math.random par défaut) pour être rejouable
   dans les tests.

   Règle : le lot visé est la tête de file (ou le lot forcé). À chaque
   lancer :
     • si une case du lot visé est atteignable au DERNIER lancer : on y va,
       directement ou par un détour Chance/Caisse dont la carte l'y amène ;
     • sinon on pose le pion sur une case neutre (commune, ou un lot moins
       cher que le lot visé et ≤ 17 €, jamais Chance/Caisse/Prison/Départ)
       d'où le lot visé reste atteignable avec les lancers restants ;
     • 2 et 12 sont évités en route (doubles forcés = lancer de plus) ;
     • le total est tiré parmi les candidats avec les poids de deux dés. */
import { OUTCOME_COST } from '../../regles/argent.js';
import { catAt, landingIndex, TILES_BY_CAT } from './plateau.js';

export const DICE_W = {2:1,3:2,4:3,5:4,6:5,7:6,8:5,9:4,10:3,11:2,12:1};
export const CARD_DELTAS = [1,2,3,4,5,6,-1,-2,-3];
export const CARD_ROUTE_P = 0.08;
const INTERMEDIATE_MAX_COST = 17;
const NEUTRAL_FORBIDDEN = new Set(['chance','chest','prison']);

export function landable(idx, targetCat){
  if(idx===0) return false;
  const cat = catAt(idx);
  if(NEUTRAL_FORBIDDEN.has(cat)) return false;
  if(cat===targetCat) return true;
  const c = OUTCOME_COST[cat], t = OUTCOME_COST[targetCat];
  if(c===undefined || t===undefined) return false;
  return c <= t && c <= INTERMEDIATE_MAX_COST;
}

/* Peut-on poser le pion sur une case du lot visé EXACTEMENT au dernier
   des k lancers, en ne posant que des cases neutres avant ? */
export function canReachTarget(pos, rollsLeft, targetCat, memo = new Map()){
  if(rollsLeft<=0) return false;
  const key = pos+':'+rollsLeft;
  if(memo.has(key)) return memo.get(key);
  let ok = false;
  for(let t=2;t<=12 && !ok;t++){
    const idx = landingIndex(pos, t);
    if(rollsLeft===1){ if(t!==2 && t!==12 && idx!==0 && catAt(idx)===targetCat) ok = true; }
    else if(t!==2 && t!==12 && landable(idx, targetCat) && canReachTarget(idx, rollsLeft-1, targetCat, memo)) ok = true;
  }
  memo.set(key, ok);
  return ok;
}

export function pickWeightedTotal(list, rng = Math.random){
  let sum = 0; list.forEach(t=>{ sum += DICE_W[t]; });
  let r = rng()*sum;
  for(const t of list){ r -= DICE_W[t]; if(r<=0) return t; }
  return list[list.length-1];
}

/* Total à faire sortir pour ce lancer (null = dés honnêtes).
   rollsLeft compte le lancer en cours.
   Retour : { total, onTarget, wantDouble, cardDelta? } */
export function planTotal(pos, rollsLeft, targetCat, rng = Math.random){
  if(!targetCat || OUTCOME_COST[targetCat]===undefined || !TILES_BY_CAT[targetCat]) return null;
  const memo = new Map();
  if(rollsLeft<=1){
    const now = [], via = [];
    for(let t=2;t<=12;t++){
      const idx = landingIndex(pos,t);
      if(idx!==0 && catAt(idx)===targetCat){ now.push(t); continue; }
      const c = catAt(idx);
      if(c==='chance' || c==='chest'){
        for(const d of CARD_DELTAS){
          const j = landingIndex(idx, d);
          if(j>0 && catAt(j)===targetCat) via.push({ t, d });
        }
      }
    }
    const viaOK = via.filter(v=>v.t!==2 && v.t!==12);
    if(viaOK.length && (!now.length || rng() < CARD_ROUTE_P)){
      const pick = viaOK[Math.floor(rng()*viaOK.length)];
      return { total: pick.t, onTarget: true, wantDouble: false, cardDelta: pick.d };
    }
    if(now.length){
      const nd = now.filter(t=>t!==2 && t!==12);
      return { total: pickWeightedTotal(nd.length ? nd : now, rng), onTarget: true, wantDouble: false };
    }
  } else {
    const single = [], double = [];
    for(let t=3;t<=11;t++){
      const idx = landingIndex(pos, t);
      if(catAt(idx)===targetCat || !landable(idx, targetCat)) continue;
      if(canReachTarget(idx, rollsLeft-1, targetCat, memo)) single.push(t);
      if(t%2===0 && canReachTarget(idx, rollsLeft, targetCat, memo)) double.push(t);
    }
    if(double.length && (!single.length || rng() < 1/3)) return { total: pickWeightedTotal(double, rng), onTarget: false, wantDouble: true };
    if(single.length) return { total: pickWeightedTotal(single, rng), onTarget: false, wantDouble: false };
  }
  const neutral = [];
  for(let t=2;t<=12;t++){ const idx = landingIndex(pos,t); if(idx!==0 && catAt(idx)==='commune') neutral.push(t); }
  if(neutral.length) return { total: pickWeightedTotal(neutral, rng), onTarget: false, wantDouble: false };
  return null;
}

/* Le tirage de 2 cartes (à la place de 2 dés) : même distribution.
   total null = hasard honnête ; sinon une paire qui fait ce total, double
   seulement si le planificateur l'a demandé. */
export function shuffledSlots(rng = Math.random){
  const a = [...Array(12).keys()];
  for(let i=a.length-1;i>0;i--){ const j=Math.floor(rng()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}
export function computeCardDraw(total, wantDouble, rng = Math.random){
  let a, b;
  if(total==null){
    a = 1+Math.floor(rng()*6);
    b = 1+Math.floor(rng()*6);
  } else {
    const pairs = [];
    for(let x=1;x<=6;x++){ const y=total-x; if(y>=1&&y<=6) pairs.push({a:x,b:y}); }
    const doubles = pairs.filter(q=>q.a===q.b), singles = pairs.filter(q=>q.a!==q.b);
    let pick;
    if(!singles.length || (wantDouble && doubles.length)) pick = doubles[0];
    else pick = singles[Math.floor(rng()*singles.length)];
    a = pick.a; b = pick.b;
  }
  return { pairs: [{a,b}], total: a+b, isDouble: a===b, slotOrder: shuffledSlots(rng) };
}
