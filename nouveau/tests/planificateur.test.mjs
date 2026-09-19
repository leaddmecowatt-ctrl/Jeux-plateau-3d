import test from 'node:test';
import assert from 'node:assert/strict';
import { planTotal, canReachTarget, computeCardDraw, landable, DICE_W } from '../regles/planificateur.js';
import { catAt, landingIndex, N_TILES, TILES_BY_CAT } from '../regles/plateau.js';
import { OUTCOME_COST } from '../../regles/argent.js';

/* Générateur déterministe (LCG) : les tests rejouent toujours la même suite. */
function rngDe(seed){ let s = seed>>>0; return ()=>{ s = (s*1664525 + 1013904223)>>>0; return s/4294967296; }; }

const LOTS = Object.keys(OUTCOME_COST).filter(c=>TILES_BY_CAT[c] && c!=='prison');

/* Avec 3 lancers on parcourt ~20 cases : le Coffret (case 35) et l'ETB
   (case 36) ne sont pas atteignables depuis le Départ — c'est pour ça que
   les parties programmées reçoivent des lancers en plus (deroule.js). */
test('depuis le Départ : les petits lots en 3 lancers, tous les lots en 8', ()=>{
  for(const cat of LOTS){
    const troisSuffisent = canReachTarget(-1, 3, cat, new Map());
    if(cat==='etb' || cat==='jackpot300') assert.ok(!troisSuffisent, cat+' hors de portée en 3 lancers');
    else assert.ok(troisSuffisent, 'lot '+cat);
    assert.ok(canReachTarget(-1, 8, cat, new Map()), 'lot '+cat+' en 8 lancers');
  }
});

test('planTotal : un total 2–12, jamais Chance/Caisse/Prison/Départ en route, et la cible au dernier lancer', ()=>{
  const rng = rngDe(7);
  for(let partie=0; partie<400; partie++){
    const cat = LOTS[partie % LOTS.length];
    /* Lots hors de portée en 3 lancers (Coffret, ETB) : on rejoue une partie
       programmée à 8 lancers ; le planificateur peut alors passer par son
       repli « commune » (totaux 2/12 permis), on vérifie seulement que le
       pion ne se pose jamais sur une case interdite. */
    const strict = canReachTarget(-1, 3, cat, new Map());
    let pos = -1, rollsLeft = strict ? 3 : 8;
    while(rollsLeft > 0){
      const plan = planTotal(pos, rollsLeft, cat, rng);
      assert.ok(plan, 'un plan existe ('+cat+' pos '+pos+' reste '+rollsLeft+')');
      assert.ok(plan.total>=2 && plan.total<=12);
      const idx = landingIndex(pos, plan.total);
      if(rollsLeft > 1 && !plan.cardDelta){
        assert.ok(landable(idx, cat), 'case neutre en route : '+catAt(idx));
        assert.notEqual(idx, 0);
        // lot visé = commune : chaque commune serait « la cible trop tôt », le
        // planificateur passe donc par son repli (2/12 permis) — sans effet, le
        // repli pose le pion sur une commune, qui est le lot visé
        if(strict && cat!=='commune') assert.ok(plan.total!==2 && plan.total!==12, 'pas de double forcé en route');
      }
      if(plan.cardDelta != null){
        const c = catAt(idx);
        assert.ok(c==='chance' || c==='chest');
        assert.equal(catAt(landingIndex(idx, plan.cardDelta)), cat, 'le détour amène sur le lot visé');
        break;
      }
      if(plan.wantDouble) rollsLeft++;
      pos = idx; rollsLeft--;
      if(rollsLeft===0 && strict) assert.equal(catAt(pos), cat, 'au dernier lancer le pion est sur le lot visé');
    }
  }
});

test('planTotal : sans lot visé, dés honnêtes', ()=>{
  assert.equal(planTotal(-1, 3, null), null);
  assert.equal(planTotal(-1, 3, 'chance'), null);
});

test('computeCardDraw : la paire fait le total demandé, double seulement si demandé', ()=>{
  const rng = rngDe(3);
  for(let t=2;t<=12;t++){
    for(let k=0;k<20;k++){
      const d = computeCardDraw(t, false, rng);
      assert.equal(d.total, t);
      if(t!==2 && t!==12) assert.equal(d.isDouble, false);
      assert.equal(new Set(d.slotOrder).size, 12);
    }
    if(t%2===0){ const d = computeCardDraw(t, true, rng); assert.equal(d.isDouble, true); assert.equal(d.total, t); }
  }
  const h = computeCardDraw(null, false, rng);
  assert.ok(h.total>=2 && h.total<=12);
});

test('poids des dés : 7 six fois plus probable que 2', ()=>{
  assert.equal(DICE_W[7]/DICE_W[2], 6);
  assert.equal(Object.values(DICE_W).reduce((a,b)=>a+b,0), 36);
});

test('landingIndex : tour de plateau vers l’avant, butée sur la case 1 en arrière', ()=>{
  assert.equal(landingIndex(-1, 5), 5);
  assert.equal(landingIndex(N_TILES-2, 3), 1);
  assert.equal(landingIndex(2, -5), 0);
});
