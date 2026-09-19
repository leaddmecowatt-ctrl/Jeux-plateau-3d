import test from 'node:test';
import assert from 'node:assert/strict';
import { nouvellePartie, peutTirer, consommerLancer, basculerLotForce, peutGarder, decisionArrivee, garderLot, FORCED_ROLLS_MAX } from '../regles/deroule.js';
import { LAST, TILES_BY_CAT } from '../regles/plateau.js';

test('3 lancers, +1 par double', ()=>{
  const p = nouvellePartie();
  assert.ok(peutTirer(p));
  consommerLancer(p, false); consommerLancer(p, true);
  assert.equal(p.rollsAllowed, 4);
  consommerLancer(p, false); consommerLancer(p, false);
  assert.ok(!peutTirer(p));
});

test('lot forcé : avant le premier lancer seulement, re-presser annule', ()=>{
  const p = nouvellePartie();
  assert.ok(basculerLotForce(p, 'jackpot300'));
  assert.equal(p.forcedCat, 'jackpot300');
  assert.ok(basculerLotForce(p, 'jackpot300'));
  assert.equal(p.forcedCat, null);
  p.index = 4;
  assert.ok(!basculerLotForce(p, 'etb'));
});

test('on ne garde jamais le Départ ni Chance/Caisse', ()=>{
  const p = nouvellePartie();
  p.index = 0; assert.ok(!peutGarder(p));
  p.index = TILES_BY_CAT.chance[0]; assert.ok(!peutGarder(p));
  p.index = TILES_BY_CAT.commune[0]; assert.ok(peutGarder(p));
});

test('décisions à l’arrivée : jackpot, prison, lancers épuisés, attente', ()=>{
  let p = nouvellePartie(); p.index = LAST;
  assert.equal(decisionArrivee(p), 'jackpot'); assert.ok(p.finished);
  p = nouvellePartie(); p.index = TILES_BY_CAT.prison[0];
  assert.equal(decisionArrivee(p), 'prison'); assert.ok(!peutTirer(p));
  p = nouvellePartie(); p.index = TILES_BY_CAT.commune[0]; p.rollsUsed = 3;
  assert.equal(decisionArrivee(p), 'auto');
  p = nouvellePartie(); p.index = TILES_BY_CAT.commune[0]; p.rollsUsed = 1;
  assert.equal(decisionArrivee(p), 'attente');
});

test('partie programmée : un lancer de plus tant que la case visée n’est pas atteinte, plafonné', ()=>{
  const p = nouvellePartie();
  p.forcedGame = true; p.pendingOutcome = 'jackpot300';
  p.index = TILES_BY_CAT.commune[0]; p.rollsUsed = 3;
  assert.equal(decisionArrivee(p), 'attente');
  assert.equal(p.rollsAllowed, 4);
  p.rollsAllowed = FORCED_ROLLS_MAX; p.rollsUsed = FORCED_ROLLS_MAX;
  assert.equal(decisionArrivee(p), 'auto');
});

test('garder le lot épuise le tour', ()=>{
  const p = nouvellePartie(); p.index = 3; p.rollsUsed = 1;
  garderLot(p);
  assert.ok(p.claimed); assert.ok(!peutTirer(p));
});
