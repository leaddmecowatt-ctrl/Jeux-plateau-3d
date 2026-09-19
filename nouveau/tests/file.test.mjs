import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nouvelleFile, fileRecalibrage, fileValide, nextPredeterminedOutcome, peekNextOutcome,
  remettreEnTete, reprendreTete, doitRemettreEnFile, drawMysterySub, rendreMystere,
  drawCard, PITY_THRESHOLD,
} from '../regles/file.js';
import { CHANCE_DECK, RARE_GRADEE_CARD } from '../regles/plateau.js';
import { AVG_MISE, OUTCOME_COST, ceilingFor, OUTCOME_BATCH_SIZE } from '../../regles/argent.js';

function rngDe(seed){ let s = seed>>>0; return ()=>{ s = (s*1664525 + 1013904223)>>>0; return s/4294967296; }; }

test('une file neuve a la bonne taille, la bonne version, et ses compteurs mystère', ()=>{
  const f = nouvelleFile();
  assert.equal(f.batch.length, OUTCOME_BATCH_SIZE);
  assert.equal(f.pos, 0);
  assert.equal(f.mystN, f.batch.filter(c=>c==='alternative').length);
  assert.ok(f.mystB <= f.mystN);
  assert.ok(fileValide(f));
  assert.ok(!fileValide({version:'autre', batch:[], pos:0}));
  assert.ok(fileValide(fileRecalibrage()));
});

test('consommer toute la file en encaissant 9 € par partie ne dépasse jamais le plafond', ()=>{
  let file = nouvelleFile();
  const compta = { totalMise: 0, totalPaid: 0, recal: null };
  for(let i=0;i<OUTCOME_BATCH_SIZE;i++){
    compta.totalMise += AVG_MISE;
    const r = nextPredeterminedOutcome(file, compta);
    file = r.file;
    compta.totalPaid += OUTCOME_COST[r.cat] || 0;
    assert.ok(compta.totalPaid <= ceilingFor(compta.totalMise) + 1e-9, 'partie '+i);
  }
  // épuisée : la suivante reconstruit
  const r = nextPredeterminedOutcome(file, compta);
  assert.equal(r.file.pos, 1);
});

test('un lot non couvert est échangé avec le premier couvert plus loin', ()=>{
  const file = { version:'x', batch:['jackpot300','commune','booster8'], pos:0, mystN:0, mystB:0 };
  const compta = { totalMise: 9, totalPaid: 0, recal: null };
  const r = nextPredeterminedOutcome(file, compta);
  assert.equal(r.cat, 'commune');
  assert.deepEqual(r.file.batch, ['commune','jackpot300','booster8']);
  // 9 € de mise : ni l'ETB ni le booster (17 €) ne sont couverts → commune
  assert.equal(peekNextOutcome(r.file, compta), 'commune');
  compta.totalMise = 900;
  assert.equal(peekNextOutcome(r.file, compta), 'jackpot300');
});

test('remettre en tête / reprendre', ()=>{
  const file = { batch:['a','b'], pos:1 };
  remettreEnTete(file, 'z');
  assert.deepEqual(file.batch, ['a','z','b']);
  reprendreTete(file, 'z');
  assert.deepEqual(file.batch, ['a','b']);
});

test('validation anticipée : produit scellé ou commune → retour en file, sinon consommé', ()=>{
  assert.equal(doitRemettreEnFile('jackpot300', 'booster8'), true);
  assert.equal(doitRemettreEnFile('gradee', 'commune'), true);
  assert.equal(doitRemettreEnFile('alternative', 'booster8'), false);
});

test('lot mystère : jamais plus de boosters que prévu, compteurs rendus à l’annulation', ()=>{
  const file = nouvelleFile();
  const rng = rngDe(11);
  const n = file.mystN, b = file.mystB;
  let boosters = 0;
  for(let i=0;i<n;i++) if(drawMysterySub(file, rng)==='booster') boosters++;
  assert.equal(file.mystN, 0);
  assert.ok(boosters <= b);
  assert.equal(drawMysterySub(file, rng), 'carte');
  rendreMystere(file, 'booster');
  assert.equal(file.mystN, 1);
});

test('cartes Chance : le plan l’emporte, la carte rare est garantie au-delà du seuil', ()=>{
  const r1 = drawCard(CHANCE_DECK, 5, 3);
  assert.equal(r1.card.effect.delta, 3);
  assert.equal(r1.pity, 5);
  const deck = [...CHANCE_DECK, RARE_GRADEE_CARD];
  const r2 = drawCard(deck, PITY_THRESHOLD, null);
  assert.equal(r2.card, RARE_GRADEE_CARD);
  assert.equal(r2.pity, 0);
  const r3 = drawCard(CHANCE_DECK, 0, null, ()=>0.01);
  assert.equal(r3.pity, 1);
});
