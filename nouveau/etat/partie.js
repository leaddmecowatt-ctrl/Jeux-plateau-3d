/* L'ÉTAT UNIQUE du jeu. Tout ce qui décrit « où on en est » est ici, et
   nulle part ailleurs : la partie (regles/deroule.js), la comptabilité,
   la file des lots, le garde-fou anti-malchance, l'annulation. Ce module
   fait le lien avec la mémoire du navigateur (etat/stockage.js) ; les
   décisions restent dans regles/. */
import { RECAL, AVG_MISE, OUTCOME_COST, tierFor } from '../../regles/argent.js';
import { nouvellePartie } from '../regles/deroule.js';
import { nouvelleFile, fileRecalibrage, fileValide, nextPredeterminedOutcome, peekNextOutcome,
         remettreEnTete, reprendreTete, doitRemettreEnFile, drawMysterySub, rendreMystere, drawCard } from '../regles/file.js';
import { CLES, lire, ecrire, lireJSON, ecrireJSON, lireNombre, lireEntier } from './stockage.js';

export const etat = {
  partie: nouvellePartie(),
  compta: { totalMise: 0, totalPaid: 0, recal: null },
  file: null,
  pity: 0,
  /* la partie « visuelle » : le pion se déplace, un tirage est en cours ;
     `generation` invalide les suites asynchrones d'une partie abandonnée */
  moving: false,
  generation: 0,
  /* D pressé pendant le déplacement : mémorisé, appliqué à l'arrivée */
  claimKeyAt: 0,
  /* annulation du dernier lot validé */
  undo: null,
  /* derniers gains (écran public, panneau télé) */
  lastResults: [],
  /* déplacement décidé par le planificateur pour la carte Chance/Caisse */
  plannedCardDelta: null,
};

/* ---------- chargement ---------- */
export function charger(){
  etat.compta.totalMise = lireNombre(CLES.totalMise, 0);
  etat.compta.totalPaid = lireNombre(CLES.totalPaid, 0);
  etat.pity = lireEntier(CLES.pity) || 0;

  let recalRec = lireJSON(CLES.recal);
  if(recalRec && recalRec.id !== RECAL.id) recalRec = null;
  etat.compta.recal = (recalRec && !recalRec.cleared) ? recalRec : null;

  const parsed = lireJSON(CLES.file);
  etat.file = fileValide(parsed) ? parsed : nouvelleFile();

  /* Recalibrage appliqué UNE fois : aucune trace = premier chargement
     depuis le recalibrage → compteurs posés, file reconstruite. */
  if(!recalRec){
    etat.compta.totalMise = RECAL.miseBase;
    etat.compta.totalPaid = RECAL.paidBase;
    etat.compta.recal = { id: RECAL.id, at: Date.now() };
    ecrireJSON(CLES.recal, etat.compta.recal);
    etat.file = fileRecalibrage();
    sauverTotaux();
  }
  sauverFile();
}
export function sauverTotaux(){
  ecrire(CLES.totalMise, etat.compta.totalMise);
  ecrire(CLES.totalPaid, etat.compta.totalPaid);
}
export function sauverFile(){ ecrireJSON(CLES.file, etat.file); }
function sauverPity(){ ecrire(CLES.pity, etat.pity); }

/* ---------- comptabilité ---------- */
export function encaisserMise(){ etat.compta.totalMise += AVG_MISE; sauverTotaux(); }
export function compterLot(cat){ etat.compta.totalPaid += OUTCOME_COST[cat] || 0; sauverTotaux(); }
/* Lot réellement finançable pour la catégorie demandée (consolation de
   prison, carte rare) : la décision est dans regles/argent.js. */
export function fundedCategory(catKey){
  const tier = tierFor(catKey, etat.compta.totalMise, etat.compta.totalPaid, etat.compta.recal);
  if(!tier) return catKey;
  etat.compta.totalPaid += tier.cost;
  sauverTotaux();
  return tier.cat;
}
/* « Démarrage cagnotte » : compteurs à zéro, recalibrage effacé pour de
   bon, nouvelle file. */
export function demarrerCagnotte(){
  etat.compta.totalMise = 0;
  etat.compta.totalPaid = 0;
  etat.compta.recal = null;
  sauverTotaux();
  ecrireJSON(CLES.recal, { id: RECAL.id, cleared: true });
  etat.file = nouvelleFile();
  sauverFile();
}

/* ---------- file des lots ---------- */
export function prochainLot(){
  const r = nextPredeterminedOutcome(etat.file, etat.compta);
  etat.file = r.file;
  sauverFile();
  return r.cat;
}
export function lotSuivantAttendu(){ return peekNextOutcome(etat.file, etat.compta); }
export function remettreLotEnTete(cat){ remettreEnTete(etat.file, cat); sauverFile(); }
export function reprendreLotEnTete(cat){ reprendreTete(etat.file, cat); sauverFile(); }
export { doitRemettreEnFile };
export function tirerMystere(){ const s = drawMysterySub(etat.file); sauverFile(); return s; }
export function rendreLotMystere(sub){ rendreMystere(etat.file, sub); sauverFile(); }
export function tirerCarte(deck){
  const r = drawCard(deck, etat.pity, etat.plannedCardDelta);
  etat.plannedCardDelta = null;
  etat.pity = r.pity;
  sauverPity();
  return r.card;
}

/* ---------- partie ---------- */
export function nouvelleGeneration(){ return ++etat.generation; }
export function remettrePartie(){
  const p = etat.partie;
  if(p.pendingOutcome && !p.forcedGame){
    // partie interrompue avant validation : le lot décidé retourne en tête
    // de file (la mise, elle, reste comptée)
    remettreLotEnTete(p.pendingOutcome);
  }
  etat.partie = nouvellePartie();
  etat.plannedCardDelta = null;
  etat.moving = false;
  etat.claimKeyAt = 0;
  etat.undo = null;
  etat.generation++;
}
