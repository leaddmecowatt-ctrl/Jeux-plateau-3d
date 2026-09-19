/* La file des lots décidés d'avance, le lot mystère et le garde-fou
   anti-malchance des cartes Chance/Caisse. Module pur : l'état est un
   objet ordinaire, passé et rendu ; `etat/stockage.js` le mémorise.

   Structure mémorisée (clé pika_outcome_batch, inchangée) :
     { version, batch, pos, mystN, mystB } */
import {
  AVG_MISE, RECAL, OUTCOME_COST, OUTCOME_BATCH_SIZE, MYSTERY_BOOSTERS,
  ceilingFor, estCouvert, buildOutcomeBatch,
} from '../../regles/argent.js';
import { RARE_GRADEE_CARD, moveCard } from './plateau.js';

export const OUTCOME_BATCH_VERSION = 'v9-lot-mystere';

export function nouvelleFile(){
  const batch = buildOutcomeBatch(OUTCOME_BATCH_SIZE);
  const mystN = batch.filter(c=>c==='alternative').length;
  return { version: OUTCOME_BATCH_VERSION, batch, pos: 0, mystN, mystB: Math.min(MYSTERY_BOOSTERS, mystN) };
}
/* File du recalibrage : sa recette et sa pente, jusqu'à RECAL.miseEnd. */
export function fileRecalibrage(){
  const batch = buildOutcomeBatch(RECAL.games, RECAL.recipe, RECAL.ratio, RECAL.games);
  const mystN = batch.filter(c=>c==='alternative').length;
  return { version: OUTCOME_BATCH_VERSION, batch, pos: 0, mystN, mystB: Math.min(RECAL.mystB, mystN) };
}
export function fileValide(parsed){
  return !!(parsed && parsed.version===OUTCOME_BATCH_VERSION && Array.isArray(parsed.batch)
    && typeof parsed.pos==='number' && parsed.pos < parsed.batch.length);
}

/* Lot couvert par la cagnotte, la mise de la partie à venir comprise. */
function couvertAvecMise(cat, compta){
  const c = OUTCOME_COST[cat];
  return c===undefined || compta.totalPaid + c <= ceilingFor(compta.totalMise + AVG_MISE, compta.recal) + 1e-9;
}

/* Prochain lot, sans le consommer (repères de l'animateur). */
export function peekNextOutcome(file, compta){
  if(file.pos >= file.batch.length) return null;
  const b = file.batch, pos = file.pos;
  if(couvertAvecMise(b[pos], compta)) return b[pos];
  for(let j=pos+1;j<b.length;j++) if(couvertAvecMise(b[j], compta)) return b[j];
  return 'commune';
}

/* Prend la tête de file si elle est couverte ; sinon l'échange avec le
   premier lot couvert plus loin (la composition ne change pas) ; sinon
   commune. Reconstruit la file à l'épuisement. Retourne { cat, file }. */
export function nextPredeterminedOutcome(file, compta){
  if(file.pos >= file.batch.length) file = nouvelleFile();
  const b = file.batch, pos = file.pos;
  const couvert = cat => estCouvert(cat, compta.totalMise, compta.totalPaid, compta.recal);
  if(!couvert(b[pos])){
    let j = pos+1;
    while(j < b.length && !couvert(b[j])) j++;
    if(j < b.length){ const t = b[pos]; b[pos] = b[j]; b[j] = t; }
    else b[pos] = 'commune';
  }
  const cat = b[pos];
  file.pos++;
  return { cat, file };
}

/* Remet un lot en tête de file (partie interrompue, validation anticipée). */
export function remettreEnTete(file, cat){
  file.batch.splice(file.pos, 0, cat);
  return file;
}
export function reprendreTete(file, cat){
  if(file.batch[file.pos]===cat) file.batch.splice(file.pos, 1);
  return file;
}

/* Validation anticipée : le joueur garde le lot de sa case avant que les
   dés l'aient amené sur le lot décidé. Ce lot retourne en file s'il est
   un produit scellé (≥ 30 €) ou si le joueur n'a pris qu'une commune ;
   sinon il est consommé (un booster sûr contre une chance de duopack). */
export function doitRemettreEnFile(pending, realCat){
  const big = (OUTCOME_COST[pending]||0) >= 30;
  const cheap = (OUTCOME_COST[realCat]||0) < 5;
  return big || cheap;
}

/* Lot mystère : booster ou carte, probabilité = boosters restants / lots
   mystère restants du cycle. Compteurs tenus dans la file. */
export function drawMysterySub(file, rng = Math.random){
  if(typeof file.mystN !== 'number' || typeof file.mystB !== 'number'){
    file.mystN = file.batch.slice(file.pos).filter(c=>c==='alternative').length + 1;
    file.mystB = Math.min(MYSTERY_BOOSTERS, file.mystN);
  }
  const p = file.mystN > 0 ? file.mystB/file.mystN : 0;
  const sub = rng() < p ? 'booster' : 'carte';
  file.mystN = Math.max(0, file.mystN - 1);
  if(sub === 'booster') file.mystB = Math.max(0, file.mystB - 1);
  return sub;
}
export function rendreMystere(file, sub){
  file.mystN = (file.mystN||0) + 1;
  if(sub === 'booster') file.mystB = (file.mystB||0) + 1;
  return file;
}

/* Cartes Chance / Caisse. `plannedDelta` (planificateur) l'emporte ;
   sinon carte rare garantie au-delà de PITY_THRESHOLD tirages sans elle ;
   sinon tirage pondéré. Retourne { card, pity }. */
export const PITY_THRESHOLD = 32;
export function drawCard(deck, pity, plannedDelta, rng = Math.random){
  if(plannedDelta != null) return { card: moveCard(plannedDelta), pity };
  if(pity >= PITY_THRESHOLD && deck.includes(RARE_GRADEE_CARD)) return { card: RARE_GRADEE_CARD, pity: 0 };
  const total = deck.reduce((s,c)=>s+c.weight,0);
  let r = rng()*total;
  for(const c of deck){
    r -= c.weight;
    if(r<=0) return { card: c, pity: c.rare ? 0 : pity+1 };
  }
  const last = deck[deck.length-1];
  return { card: last, pity: last.rare ? 0 : pity+1 };
}
