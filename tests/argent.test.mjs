/* Vérification de la règle d'argent, hors navigateur.
   Lancer :  node --test tests/*.test.mjs
   Ces tests ne démarrent aucune scène 3D : c'est tout l'intérêt du
   module regles/argent.js. Ils tournent en moins d'une seconde et
   répondent à la seule question qui coûte de l'argent en direct :
   « le jeu peut-il reverser plus que ce qu'il a encaissé ? » */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AVG_MISE, CEILING_RATIO, MARGIN_TARGET, RECAL,
  PAYOUT_LADDER, OUTCOME_COST, OUTCOME_RECIPE, OUTCOME_BATCH_SIZE,
  ceilingFor, tierFor, estCouvert, chancesParLot, buildOutcomeBatch,
} from '../regles/argent.js';

/* L'invariant du jeu : à CHAQUE partie de la file, pas seulement à la
   fin, le cumul reversé reste sous la part autorisée de l'encaissé. */
function verifieChaquePrefixe(file, ratio){
  let mise = 0, paid = 0;
  file.forEach((cat, i) => {
    mise += AVG_MISE;
    paid += OUTCOME_COST[cat] || 0;
    assert.ok(paid <= mise*ratio + 1e-9,
      `dépassement à la partie ${i+1} : ${paid.toFixed(2)} € reversés `
      + `pour ${mise.toFixed(2)} € encaissés (plafond ${(mise*ratio).toFixed(2)} €)`);
  });
  return { mise, paid };
}

test('le plafond suit bien la marge visée', () => {
  assert.equal(CEILING_RATIO, 1 - MARGIN_TARGET);
  assert.equal(ceilingFor(1000, null), 1000*CEILING_RATIO);
  assert.equal(ceilingFor(0, null), 0);
});

test('le recalibrage impose sa pente réduite, puis rend la main', () => {
  const dedans = ceilingFor(1000, { id: RECAL.id });
  assert.equal(dedans, RECAL.paidBase + RECAL.ratio*(1000 - RECAL.miseBase));
  assert.ok(dedans < ceilingFor(1000, null), 'la pente du recalibrage doit être plus basse');
  // au-delà de l'horizon, le plan standard reprend
  assert.equal(ceilingFor(RECAL.miseEnd + 1, { id: RECAL.id }),
               CEILING_RATIO*(RECAL.miseEnd + 1));
});

test('la recette standard tient sous le plafond du cycle', () => {
  let total = 0, places = 0;
  OUTCOME_RECIPE.forEach(r => { total += r.n*(OUTCOME_COST[r.cat] || 0); places += r.n; });
  total += (OUTCOME_BATCH_SIZE - places)*OUTCOME_COST.commune;
  const plafond = OUTCOME_BATCH_SIZE*AVG_MISE*CEILING_RATIO;
  assert.ok(total <= plafond,
    `recette à ${total.toFixed(0)} € pour un plafond de ${plafond.toFixed(0)} €`);
});

test('la recette du recalibrage tient sous SA pente', () => {
  let total = 0, places = 0;
  RECAL.recipe.forEach(r => { total += r.n*(OUTCOME_COST[r.cat] || 0); places += r.n; });
  total += Math.max(0, RECAL.games - places)*OUTCOME_COST.commune;
  const plafond = RECAL.games*AVG_MISE*RECAL.ratio;
  assert.ok(total <= plafond,
    `recalibrage à ${total.toFixed(0)} € pour un plafond de ${plafond.toFixed(0)} €`);
});

/* Le test qui compte vraiment. La file est mélangée au hasard : on en
   construit 30 et on vérifie l'invariant sur chacune, à chaque partie. */
test('30 files complètes tiennent le plafond à chaque partie', () => {
  for(let essai = 0; essai < 30; essai++){
    const file = buildOutcomeBatch(OUTCOME_BATCH_SIZE);
    assert.equal(file.length, OUTCOME_BATCH_SIZE, 'la file doit couvrir tout le cycle');
    const { mise, paid } = verifieChaquePrefixe(file, CEILING_RATIO);
    const marge = 1 - paid/mise;
    assert.ok(marge >= MARGIN_TARGET - 1e-9,
      `marge finale ${(marge*100).toFixed(1)} % sous l'objectif`);
  }
});

test('30 files de recalibrage tiennent leur plafond à chaque partie', () => {
  for(let essai = 0; essai < 30; essai++){
    const file = buildOutcomeBatch(RECAL.games, RECAL.recipe, RECAL.ratio, RECAL.games);
    verifieChaquePrefixe(file, RECAL.ratio);
  }
});

test('une recette intenable fait échouer la construction, elle ne passe pas', () => {
  assert.throws(
    () => buildOutcomeBatch(100, [{ cat:'jackpot300', n:100 }], CEILING_RATIO, 100),
    /OUTCOME_RECIPE/,
    'une recette au-dessus du plafond DOIT lever une exception');
});

test('un lot non couvert redescend au palier inférieur', () => {
  // cagnotte vide : tout est permis (début de direct)
  assert.equal(tierFor('jackpot300', 0, 0, null).cat, 'jackpot300');
  // 100 € encaissés, rien reversé : le plafond (74 €) ne paie pas l'ETB à 190 €
  const t = tierFor('jackpot300', 100, 0, null);
  assert.ok(t.cost <= ceilingFor(100, null) + 1e-9, 'le palier retenu doit être payable');
  assert.notEqual(t.cat, 'jackpot300');
  // au pire on tombe sur la commune, jamais sur rien
  assert.equal(tierFor('jackpot300', 0.01, 0, null).cat, 'commune');
  // une non-catégorie (détour) n'est pas un lot
  assert.equal(tierFor('chance', 1000, 0, null), null);
});

test('estCouvert refuse ce que la cagnotte ne paie pas', () => {
  assert.equal(estCouvert('jackpot300', 100, 0, null), false);
  assert.equal(estCouvert('jackpot300', 10000, 0, null), true);
  assert.equal(estCouvert('chance', 0, 0, null), true, 'un détour est toujours « couvert »');
});

test('les chances affichées couvrent bien 100 % des parties', () => {
  const odds = chancesParLot();
  const somme = Object.values(odds).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(somme - 100) < 1e-9, `somme des chances = ${somme}`);
  assert.ok(odds.commune > 0, 'il doit rester de la place pour les communes');
});

test('chaque palier a un coût connu, du plus cher au moins cher', () => {
  for(let i = 1; i < PAYOUT_LADDER.length; i++){
    assert.ok(PAYOUT_LADDER[i].cost < PAYOUT_LADDER[i-1].cost,
      `palier ${PAYOUT_LADDER[i].cat} mal ordonné`);
  }
  PAYOUT_LADDER.forEach(t => assert.equal(OUTCOME_COST[t.cat], t.cost));
});
