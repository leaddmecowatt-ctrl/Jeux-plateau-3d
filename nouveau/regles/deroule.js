/* Le déroulé d'une partie : lancers, double, fin de partie, ce qu'il faut
   faire à l'arrivée sur une case. Module pur : il ne connaît ni la scène,
   ni l'écran, ni le temps. `jeu.js` lui pose les questions et exécute.

   L'état d'une partie :
     index         -1 = au départ, sinon la case du pion
     rollsUsed / rollsAllowed   3 lancers, +1 par double
     finished      partie terminée (lot validé, prison, jackpot)
     pendingOutcome  lot décidé d'avance pour cette mise (ou lot forcé)
     forcedCat     lot programmé à la touche pour la partie à venir
     forcedGame    la partie en cours est une partie-bonus (hors comptabilité)
     claimed       le lot de la case a été validé */
import { LAST, catAt } from './plateau.js';

export const ROLLS_PER_GAME = 3;
export const FORCED_ROLLS_MAX = 15;

export function nouvellePartie(){
  return {
    index: -1, rollsUsed: 0, rollsAllowed: ROLLS_PER_GAME, finished: false,
    pendingOutcome: null, forcedCat: null, forcedGame: false, claimed: false,
  };
}

export function peutTirer(p){ return !p.finished && p.rollsUsed < p.rollsAllowed; }
export function lancersEpuises(p){ return p.rollsUsed >= p.rollsAllowed; }

/* Un lancer est consommé dès qu'il est effectué ; un double en rend un. */
export function consommerLancer(p, isDouble){
  p.rollsUsed++;
  if(isDouble) p.rollsAllowed++;
  return p;
}

/* Lot forcé : re-presser la même touche annule. Uniquement avant le
   premier lancer. Retourne true si l'état a changé. */
export function basculerLotForce(p, cat){
  if(p.index !== -1 || p.finished) return false;
  p.forcedCat = (p.forcedCat === cat) ? null : cat;
  return true;
}

/* Le pion est-il sur une case dont on peut garder le lot ? Jamais le
   Départ, jamais Chance/Caisse (qui se résolvent seules). */
export function peutGarder(p){
  if(p.index <= 0) return false;
  const cat = catAt(p.index);
  return cat !== 'chance' && cat !== 'chest';
}

/* Après une arrivée (lancer ou carte), que faire ? Une seule réponse :
     'jackpot'  : jackpot final, validé automatiquement
     'prison'   : fin de partie, consolation automatique
     'auto'     : plus de lancer, le lot de la case est gardé d'office
     'attente'  : l'animateur décide (B ou D)
   Une partie programmée reçoit les lancers nécessaires pour atteindre sa
   case, plafonnés à FORCED_ROLLS_MAX. */
export function decisionArrivee(p){
  if(p.index === LAST) p.finished = true;
  const cat = p.index >= 0 ? catAt(p.index) : null;
  const canClaim = peutGarder(p);
  if(p.forcedGame && p.pendingOutcome && !p.finished && p.index >= 0
     && cat !== p.pendingOutcome && lancersEpuises(p) && p.rollsAllowed < FORCED_ROLLS_MAX){
    p.rollsAllowed++;
  }
  if(cat==='jackpot300' && p.finished && canClaim && !p.claimed){ p.rollsUsed = p.rollsAllowed; return 'jackpot'; }
  if(cat==='prison' && !p.finished && canClaim){ p.rollsUsed = p.rollsAllowed; return 'prison'; }
  if(lancersEpuises(p) && !p.finished && canClaim) return 'auto';
  return 'attente';
}

/* Garder le lot met fin au tour. */
export function garderLot(p){
  p.claimed = true;
  p.rollsUsed = p.rollsAllowed;
  return p;
}
