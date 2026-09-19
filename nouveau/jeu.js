/* Pikapoly — point d'entrée. Crée l'état, la scène et l'interface, puis
   fait tourner le déroulé : ici vivent les enchaînements (tirer, avancer,
   garder, recommencer). Les décisions sont dans regles/, l'état dans
   etat/, l'image dans scene/, l'écran dans ui/. */
import { LAST, catAt, landingIndex, TIER_LEVEL, deckFor, LOT_IMAGE_URLS } from './regles/plateau.js';
import { planTotal, computeCardDraw } from './regles/planificateur.js';
import { peutTirer, lancersEpuises, consommerLancer, basculerLotForce, peutGarder, decisionArrivee, garderLot } from './regles/deroule.js';
import { etat, charger, encaisserMise, compterLot, fundedCategory, demarrerCagnotte, prochainLot, lotSuivantAttendu,
         remettreLotEnTete, reprendreLotEnTete, doitRemettreEnFile, tirerMystere, rendreLotMystere, tirerCarte,
         sauverTotaux, remettrePartie, nouvelleGeneration } from './etat/partie.js';
import { diffuser, estEcranPublic } from './etat/stockage.js';
import { demarrerFond } from './fond/onde.js';
import { chargerPhotos } from './scene/textures.js';
import { creerRendu } from './scene/rendu.js';
import { ajouterLumieres } from './scene/lumieres.js';
import { creerCamera } from './scene/camera.js';
import { construirePlateau } from './scene/plateau3d.js';
import { creerPion } from './scene/pion.js';
import { creerEtincelles } from './scene/effets/etincelles.js';
import { creerImpacts } from './scene/effets/impacts.js';
import { creerPluieOr } from './scene/effets/pluieOr.js';
import { creerOrage } from './scene/effets/orage.js';
import { reduceMotion, playImpact, playHop } from './ui/son.js';
import { brancherClavier } from './ui/clavier.js';
import { updateCue, showKeyHint } from './ui/reperes.js';
import { boutons, statut, noterTotal, demarrerHudTele, updatePlaceBanner, renderTvLegend, renderResults,
         flashBankResetToken, updateWinButton, showScreenBtns, placeLabel } from './ui/panneaux.js';
import { playCardDrawAnimation, tirageEnCours } from './ui/tirage.js';
import { creerCelebration, triggerImpactFlash, triggerImpactBlast } from './ui/celebration.js';
import { initOrientation, surChangement, cycleRotation, toggleFullscreen, estVertical } from './ui/orientation.js';
import { brancherEcranPublic } from './ui/ecranPublic.js';

const wait = ms => new Promise(r=>setTimeout(r,ms));
const HOP_DURATION = 0.50;
const CLAIM_KEY_GRACE_MS = 20000;
const CHANCE_READ_MS = 2800, CHANCE_READ_RARE_MS = 3600;

/* ---------- mise en place ---------- */
demarrerFond();
charger();
await chargerPhotos();
const wrap = document.getElementById('boardWrap');
const sc = creerRendu({ canvas: document.getElementById('gl'), wrap, reduceMotion });
const lumieres = ajouterLumieres(sc);
const cam = creerCamera(sc);
const plateau = construirePlateau(sc);
const { tiles } = plateau;
const pion = creerPion(sc);
const etincelles = creerEtincelles(sc, plateau.brightGoldTex, plateau.perimeterPosAt);
const impacts = creerImpacts(sc, plateau.boardGroup);
const pluieOr = creerPluieOr(sc, plateau.brightGoldTex);
const orage = creerOrage(sc, { lumieres, cam, etincelles, pluieOr, pion, goldDotTex: plateau.goldDotTex,
  flashImpact: triggerImpactFlash, flashBlast: triggerImpactBlast });
function tileAt(idx){ return idx===-1 ? tiles[0] : tiles[idx]; }
function pushResult(catKey){
  const url = LOT_IMAGE_URLS[catKey];
  if(!url) return;
  etat.lastResults = [{catKey,url}, ...etat.lastResults].slice(0,5);
  renderResults(etat.lastResults);
}
const celebration = creerCelebration({
  wrap, appEl: document.getElementById('app'), estVertical,
  cameraPunch: cam.cameraPunch, triggerCheer: pion.triggerCheer,
  startHypeShake: impacts.startShake, startGoldRain: pluieOr.start,
  startStorm: ()=>orage.start(etat.partie.index >= 0 ? tiles[etat.partie.index] : null),
  fundedCategory, pushResult, tirerCarte,
});
pion.load().catch(err=>{ console.error('Chargement du personnage 3D échoué, le plateau continue sans lui :', err); });
pion.placeInstant(tiles[0]);
plateau.setActive(-1);

const fxPion = {
  spawnSparkles: etincelles.spawn, winShock: impacts.winShock, cameraPunch: cam.cameraPunch, playHop,
  cineBegin: cam.cineBegin,
};
const levelOf = tile => TIER_LEVEL[tile.catKey] ?? 1;
function frameStep(dt, t){
  cam.update(dt, pion.root);
  etincelles.update(dt);
  pluieOr.update(t, dt);
  orage.update(t, dt);
  plateau.update(t, dt, pion.root.position, pion.topOffset, orage.waveOffset);
  pion.update(t, dt, plateau.surfOffset, fxPion, levelOf);
  lumieres.suivrePion(pion.root.position, sc.camera.position);
  impacts.update(t, dt);
}
sc.choisirQualiteInitiale();
sc.demarrerBoucle(frameStep);

/* ---------- repères animateur ---------- */
function majCue(){
  const p = etat.partie;
  updateCue(p.pendingOutcome || p.forcedCat || lotSuivantAttendu(), !!p.forcedCat || p.forcedGame);
}
function revealImpact(){ playImpact(); cam.cameraPunch(); triggerImpactFlash(); }
function apercuCase(){
  const p = etat.partie;
  updateWinButton(p, etat.moving, p.index > 0 ? catAt(p.index) : null, celebration.showLotPreview);
}
function clearUndo(){ etat.undo = null; if(boutons.undo) boutons.undo.hidden = true; }

/* ---------- le déroulé ---------- */
const hooksMarche = {
  onSegment(index){ etat.partie.index = index; plateau.setActive(index); },
  onArrive(index){ etat.partie.index = index; plateau.setActive(index); },
};
function poserPion(idx){
  etat.partie.index = idx;
  pion.stopWalk();
  pion.placeInstant(tileAt(idx));
  plateau.setActive(idx);
}
function statutArrivee(){
  const p = etat.partie;
  if(p.index===LAST) statut('🏆 Arrivé à '+placeLabel(LAST)+' — JACKPOT FINAL !');
  else statut('Le joueur est arrivé à '+placeLabel(p.index)+' !');
}

async function move(count, forcedCard){
  const p = etat.partie;
  if(etat.moving || p.finished) return;
  etat.moving = true;
  const myGen = nouvelleGeneration();
  boutons.validate.disabled = true;
  if(boutons.win) boutons.win.hidden = true;
  etat.claimKeyAt = 0;
  const destIdx = landingIndex(p.index, count);
  const destCat = catAt(destIdx);
  // la carte Chance/Caisse est tirée AVANT l'animation : les deux écrans montrent la même
  let card = forcedCard || null;
  if(!card && (destCat==='chance' || destCat==='chest')) card = tirerCarte(deckFor(destCat));
  diffuser({type:'move', count, card});
  statut('Le joueur avance vers '+placeLabel(destIdx)+'…');
  updatePlaceBanner(destIdx, true);
  const w = pion.startWalk(p.index, count, HOP_DURATION, tiles, hooksMarche, cam);
  await wait(w.totalTime*1000 + 30);
  if(myGen!==etat.generation) return;
  // fenêtre en arrière-plan : l'état se corrige quand même à la bonne case
  if(p.index !== destIdx) poserPion(destIdx);
  if(p.index===LAST) p.finished = true;
  statutArrivee();
  updatePlaceBanner(p.index, false);
  const arrivedCat = catAt(p.index);
  if(!p.finished && (arrivedCat==='chance' || arrivedCat==='chest')){
    await resolveChanceChest(myGen, card);
    if(myGen!==etat.generation) return;
  }
  etat.moving = false;
  const decision = decisionArrivee(p);
  apercuCase();
  if(decision==='jackpot'){ await claimCurrentLot(); }
  else if(decision==='prison'){ statut('🔒 Prison — fin de partie.'); await claimCurrentLot(); }
  else if(decision==='auto'){
    statut('Plus de lancer disponible (3 lancers, +1 par double) — le lot est automatiquement remporté.');
    await claimCurrentLot();
  } else {
    boutons.validate.disabled = p.finished || lancersEpuises(p);
    // D pressé pendant la marche : appliqué maintenant
    if(peutGarder(p) && !p.finished && etat.claimKeyAt && performance.now() - etat.claimKeyAt < CLAIM_KEY_GRACE_MS){
      etat.claimKeyAt = 0;
      await claimCurrentLot();
    }
  }
}

/* Chance / Caisse : la carte s'affiche le temps d'être lue, puis le pion
   est déplacé sur le plateau dégagé ; jamais de fin de partie ici. */
async function resolveChanceChest(myGen, forcedCard){
  const p = etat.partie;
  const idx = p.index;
  const catKey = catAt(idx);
  const card = forcedCard || tirerCarte(deckFor(catKey));
  celebration.celebrate(catKey, card);
  await wait(card.rare ? CHANCE_READ_RARE_MS : CHANCE_READ_MS);
  if(myGen!==etat.generation) return;
  celebration.clear();
  if(card.effect && card.effect.type==='move' && card.effect.delta){
    const d = card.effect.delta;
    statut('La carte le fait '+(d>0?'avancer':'reculer')+' automatiquement de '+Math.abs(d)+' case'+(Math.abs(d)>1?'s':'')+'…');
    const w = pion.startWalk(idx, d, HOP_DURATION, tiles, hooksMarche, cam);
    await wait(w.totalTime*1000 + 30);
    if(myGen!==etat.generation) return;
    const expectedIdx = landingIndex(idx, d);
    if(p.index !== expectedIdx) poserPion(expectedIdx);
    if(p.index===LAST) p.finished = true;
    statutArrivee();
    updatePlaceBanner(p.index, false);
  }
  celebration.clear();
}

function restart(){
  remettrePartie();
  pion.reset();
  orage.stop();
  impacts.stop();
  pluieOr.stop();
  cam.cineEnd();
  cam.setGameStarted(false);
  majCue();
  poserPion(-1);
  statut('Le joueur est prêt sur Départ.');
  updatePlaceBanner(-1, false);
  noterTotal('');
  boutons.validate.disabled = false;
  if(boutons.win) boutons.win.hidden = true;
  celebration.clear();
  clearUndo();
  if(boutons.start){ boutons.start.hidden = false; }
  diffuser({type:'restart'});
}
function startGame(){
  cam.setGameStarted(true);
  if(boutons.start) boutons.start.hidden = true;
  diffuser({type:'start'});
}

async function drawAndMove(){
  const p = etat.partie;
  if(etat.moving || !peutTirer(p)) return;
  if(p.index===-1){
    if(p.forcedCat){
      // partie-bonus (touche Z / M / 1–6) : ni mise ni lot comptés
      p.pendingOutcome = p.forcedCat; p.forcedCat = null; p.forcedGame = true;
    } else {
      encaisserMise();
      p.pendingOutcome = prochainLot();
    }
    majCue();
  }
  celebration.clear();
  clearUndo();
  boutons.validate.disabled = true;
  const plan = planTotal(p.index, p.rollsAllowed - p.rollsUsed, p.pendingOutcome);
  etat.plannedCardDelta = (plan && plan.cardDelta != null) ? plan.cardDelta : null;
  const draw = computeCardDraw(plan ? plan.total : null, plan ? plan.wantDouble : false);
  consommerLancer(p, draw.isDouble);
  diffuser({type:'draw', draw});
  noterTotal(draw.total);
  await playCardDrawAnimation(draw, revealImpact);
  await move(draw.total);
}

/* Garder le lot met fin au tour. Le lot remporté est TOUJOURS celui de la
   case ; le lot décidé d'avance retourne en file selon regles/file.js. */
async function claimCurrentLot(){
  const p = etat.partie;
  if(p.index<0 || p.claimed) return;
  if(boutons.win) boutons.win.disabled = true;
  boutons.validate.disabled = true;
  const realCat = catAt(p.index);
  const pendingBefore = p.pendingOutcome;
  const forced = p.forcedGame;
  p.forcedGame = false;
  let requeued = null;
  if(p.pendingOutcome && realCat !== p.pendingOutcome && !forced && doitRemettreEnFile(p.pendingOutcome, realCat)){
    remettreLotEnTete(p.pendingOutcome);
    requeued = p.pendingOutcome;
  }
  p.pendingOutcome = null;
  majCue();
  const paidBefore = etat.compta.totalPaid;
  const rollsUsedBefore = p.rollsUsed;
  if(realCat !== 'prison' && !forced) compterLot(realCat);
  const mystery = realCat === 'alternative' ? (forced ? (Math.random() < 0.5 ? 'booster' : 'carte') : tirerMystere()) : null;
  celebration.celebrate(realCat, null, {mystery});
  diffuser({type:'celebrate', catKey:realCat, mystery});
  etat.undo = { amountAdded: etat.compta.totalPaid - paidBefore, rollsUsedBefore, requeued, pending: pendingBefore, mystery, forced };
  if(boutons.undo) boutons.undo.hidden = false;
  garderLot(p);
}
function undoLastWin(){
  const u = etat.undo;
  if(!u) return;
  const p = etat.partie;
  etat.compta.totalPaid = Math.max(0, etat.compta.totalPaid - u.amountAdded);
  sauverTotaux();
  if(etat.lastResults.length){ etat.lastResults.shift(); renderResults(etat.lastResults); }
  celebration.clear();
  p.rollsUsed = u.rollsUsedBefore;
  p.claimed = false;
  if(u.mystery) rendreLotMystere(u.mystery);
  if(u.requeued) reprendreLotEnTete(u.requeued);
  p.pendingOutcome = u.pending || null;
  p.forcedGame = !!u.forced;
  majCue();
  if(!p.finished) boutons.validate.disabled = lancersEpuises(p);
  clearUndo();
  apercuCase();
  statut('Dernière validation annulée — le lot de '+placeLabel(p.index)+' reste à distribuer.');
}

/* ---------- boutons, clavier, écrans ---------- */
boutons.validate.addEventListener('click', drawAndMove);
boutons.reset.addEventListener('click', restart);
if(boutons.start) boutons.start.addEventListener('click', startGame);
if(boutons.win) boutons.win.addEventListener('click', claimCurrentLot);
if(boutons.undo) boutons.undo.addEventListener('click', undoLastWin);
if(boutons.resetBank) boutons.resetBank.addEventListener('click', ()=>{
  demarrerCagnotte();
  boutons.resetBank.hidden = true;
  flashBankResetToken();
  clearUndo();
  majCue();
});
[boutons.validate, boutons.reset, boutons.win, boutons.start, boutons.undo].forEach(btn=>{
  if(btn) btn.addEventListener('touchend', e=>{ e.preventDefault(); btn.click(); }, {passive:false});
});
brancherClavier({
  demarrer(){ if(boutons.start && !boutons.start.hidden) startGame(); },
  tirer(){
    const p = etat.partie;
    const busy = etat.moving || tirageEnCours();
    if(!boutons.validate.disabled) drawAndMove();
    else if(busy) showKeyHint('⏳ Attendez la fin du déplacement avant de relancer (B)');
    else if(p.finished || lancersEpuises(p)) showKeyHint('Partie terminée — C pour recommencer');
  },
  recommencer(){ restart(); },
  garder(){
    const p = etat.partie;
    const w = boutons.win;
    if(w && !w.hidden && !w.disabled) claimCurrentLot();
    else if(tirageEnCours()) showKeyHint('⏳ Attendez l’arrivée du personnage, puis appuyez sur D');
    else if(etat.moving){ etat.claimKeyAt = performance.now(); showKeyHint('⏳ Le lot sera gardé dès l’arrivée du personnage'); }
    else if(w && w.disabled && p.index>0) showKeyHint('Lot déjà validé — C pour recommencer');
    else if(p.index<=0) showKeyHint('Aucun lot à garder : tirez d’abord les cartes (B)');
  },
  // lot forcé : rien, absolument rien à l'écran
  forcer(fk){ if(!etat.moving && basculerLotForce(etat.partie, fk.cat)) majCue(); },
  pleinEcran(){ toggleFullscreen(); },
  pivoter(){
    const r = cycleRotation();
    showKeyHint(r === 0 ? 'Image droite (R pour pivoter)' : 'Image pivotée de ' + r + '° (R pour changer)');
  },
});
if(boutons.rot) boutons.rot.addEventListener('click', ()=>{ cycleRotation(); showScreenBtns(estEcranPublic); });
if(boutons.fs) boutons.fs.addEventListener('click', ()=>{ toggleFullscreen(); showScreenBtns(estEcranPublic); });
window.addEventListener('mousemove', ()=>showScreenBtns(estEcranPublic), {passive:true});
window.addEventListener('touchstart', ()=>showScreenBtns(estEcranPublic), {passive:true});
showScreenBtns(estEcranPublic);

surChangement(()=>{ sc.resize(); celebration.resizeCanvas(); });
initOrientation();
brancherEcranPublic({
  draw(d){ noterTotal(d.total); playCardDrawAnimation(d, revealImpact); },
  move(count, card){ move(count, card); },
  celebrate(catKey, mystery){ celebration.celebrate(catKey, null, {mystery}); },
  restart, start: startGame,
});
renderTvLegend();
demarrerHudTele(()=>etat.partie);
updatePlaceBanner(-1, false);
majCue();
