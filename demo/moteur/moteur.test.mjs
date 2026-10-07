/* Tests du moteur Golden. Lancer : node --test demo/moteur/
   Le hasard est à graine fixe : un test qui échoue rejoue à l'identique. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { creerMoteur, PLATEAU, POUCH, POUCH_SIZE, COUT_LOTS, AVG_MISE, ARMES } from './moteur.js';

function graine(s){ return ()=>{ s = (s*1664525 + 1013904223) >>> 0; return s/4294967296; }; }
function memoire(){ const m = new Map(); return { getItem:k=>m.has(k)?m.get(k):null, setItem:(k,v)=>m.set(k,String(v)), m }; }
const compter = arr => arr.reduce((o,c)=>(o[c]=(o[c]||0)+1, o), {});
const attendu = Object.fromEntries(POUCH.filter(r=>r.n).map(r=>[r.cat, r.n]));

/* Joue une partie entière avec une stratégie : garde(etat, m) dit s'il faut
   garder le lot de la case. Rend le lot gagné. */
function jouerPartie(m, garde){
  let gain = null, lancers = 0;
  while(!gain){
    const r = m.tirer();
    assert.ok(!r.refuse, 'tirage refusé en cours de partie : '+r.refuse);
    lancers++;
    assert.ok(lancers <= 20, 'partie sans fin');
    if(r.gain){ gain = r.gain; break; }
    const e = m.etat();
    if(e.peutGarder && garde(e, m, r)) gain = m.garder();
    else if(!e.peutTirer){ assert.fail('partie bloquée sans lot (case '+e.caseIndex+')'); }
  }
  return gain;
}

test('la pochette contient exactement les lots prévus', ()=>{
  for(let s=1; s<=30; s++){
    const m = creerMoteur({ stockage: null, aleatoire: graine(s) });
    const p = m._interne.pochette();
    assert.equal(p.batch.length, POUCH_SIZE);
    assert.deepEqual(compter(p.batch), attendu);
    // jamais de Prison dans les 10 premiers coups, ETB dans le dernier quart
    assert.ok(p.batch.slice(0,10).every(c=>c!=='prison'));
    p.batch.forEach((c,i)=>{ if(c==='jackpot300') assert.ok(i >= Math.round(130*159/210), 'ETB trop tôt : '+i); });
  }
});

test('le lot gagné est toujours celui de la case du pion', ()=>{
  const m = creerMoteur({ stockage: null, aleatoire: graine(7) });
  const rnd = graine(99);
  for(let g=0; g<600; g++){
    const gain = jouerPartie(m, ()=> rnd() < 0.35);
    assert.equal(gain.lot, PLATEAU[gain.caseIndex].catKey);
    m.recommencer();
  }
});

test('règle Golden : le lot prévu se présente avec au moins un lancer derrière', ()=>{
  const m = creerMoteur({ stockage: null, aleatoire: graine(11) });
  let verifiees = 0;
  for(let g=0; g<400; g++){
    let offertAvecRelance = false;
    const gain = jouerPartie(m, (e)=>{
      const prevu = m._interne.lotPrevu();
      if(prevu && e.lotDeLaCase === prevu){
        if(e.lancersUtilises < e.lancersAutorises) offertAvecRelance = true;
        return true;
      }
      return false;
    });
    if(gain.prison || !['gradee','booster50','etb','jackpot300','parc'].includes(gain.lot)) { m.recommencer(); continue; }
    assert.ok(offertAvecRelance, 'lot '+gain.lot+' arrivé au dernier lancer');
    verifiees++;
    m.recommencer();
  }
  assert.ok(verifiees > 10, 'trop peu de parties vérifiées : '+verifiees);
});

test('une série complète distribue exactement la pochette', ()=>{
  for(let s=1; s<=5; s++){
    const m = creerMoteur({ stockage: null, aleatoire: graine(100+s) });
    const gagnes = [];
    for(let g=0; g<POUCH_SIZE; g++){
      // le joueur garde le lot prévu dès qu'il est dessus (sinon il relance)
      const gain = jouerPartie(m, (e)=> e.lotDeLaCase === m._interne.lotPrevu());
      gagnes.push(gain.lot);
      if(g < POUCH_SIZE-1) m.recommencer();
    }
    assert.deepEqual(compter(gagnes), attendu, 'graine '+(100+s));
    const e = m.etat();
    assert.equal(e.coupsJoues, POUCH_SIZE);
    assert.equal(e.cagnotte.mise, POUCH_SIZE*AVG_MISE);
    const coutTotal = POUCH.reduce((s,r)=>s + r.n*COUT_LOTS[r.cat], 0);
    assert.equal(e.cagnotte.lotsComptes, coutTotal);
    // C après la dernière partie : retour automatique à 0
    assert.ok(m.recommencer().nouvelleSerie);
    assert.equal(m.etat().coupsJoues, 0);
    assert.equal(m.etat().cagnotte.mise, 0);
  }
});

test('ETB, Coffret et Tripack ne tombent pas sans être armés', ()=>{
  const m = creerMoteur({ stockage: null, aleatoire: graine(5) });
  for(let g=0; g<POUCH_SIZE-12; g++){
    const gain = jouerPartie(m, (e)=> e.lotDeLaCase === m._interne.lotPrevu());
    assert.ok(!['jackpot300','etb','booster50'].includes(gain.lot), 'gros lot tombé tout seul au coup '+(g+1));
    m.recommencer();
  }
});

test('X / Y / Z arment le gros lot du prochain coup, en silence', ()=>{
  for(const [touche, cat] of Object.entries(ARMES)){
    const m = creerMoteur({ stockage: null, aleatoire: graine(touche.charCodeAt(0)) });
    assert.equal(m.armer(touche).arme, cat);
    const gain = jouerPartie(m, (e)=> e.lotDeLaCase === m._interne.lotPrevu());
    assert.equal(gain.lot, cat);
    assert.equal(PLATEAU[gain.caseIndex].catKey, cat);
    // la pochette en contient un de moins
    const reste = m._interne.pochette().batch.slice(m._interne.pochette().pos).filter(c=>c===cat).length;
    assert.equal(reste, attendu[cat]-1);
    // même touche deux fois = annulé ; pas d'armement hors Départ
    m.recommencer();
    m.armer(touche); assert.equal(m.armer(touche).arme, null);
    m.tirer(); assert.equal(m.armer(touche).refuse, 'pas-sur-depart');
  }
});

test('refuser le lot proposé : boosters seulement, le lot repart 2 à 15 coups plus loin', ()=>{
  const m = creerMoteur({ stockage: null, aleatoire: graine(21) });
  let refusTestes = 0;
  for(let g=0; g<300 && refusTestes < 15; g++){
    let refuse = null;
    jouerPartie(m, (e, mm)=>{
      const prevu = mm._interne.lotPrevu();
      if(!refuse && prevu && prevu !== 'booster8' && e.lotDeLaCase === prevu && e.lancersUtilises < e.lancersAutorises){
        refuse = { lot: prevu, pos: mm._interne.pochette().pos };
        return false;                       // le joueur relance
      }
      if(refuse) return false;              // il ne garde plus rien : les lancers finissent
      return e.lotDeLaCase === prevu;
    });
    if(refuse){
      const e = m.etat();
      // après le refus, la partie a fini sur un booster
      assert.equal(e.lotDeLaCase, 'booster8');
      const b = m._interne.pochette().batch;
      const ou = b.indexOf(refuse.lot, refuse.pos);
      if(ou >= 0){ assert.ok(ou >= refuse.pos+1 && ou <= refuse.pos+14, 'lot refusé replacé au coup '+ou); }
      refusTestes++;
    }
    m.recommencer();
  }
  assert.ok(refusTestes >= 5, 'trop peu de refus testés : '+refusTestes);
});

test('recommencer avant de garder rend le lot et la mise', ()=>{
  const m = creerMoteur({ stockage: null, aleatoire: graine(3) });
  const avant = JSON.stringify(m._interne.pochette().batch);
  m.tirer();
  const e = m.etat();
  if(!e.lotValide){
    m.recommencer();
    assert.equal(m.etat().cagnotte.mise, 0);
    assert.equal(m.etat().coupsJoues, 0);
    assert.deepEqual(compter(m._interne.pochette().batch.slice(m._interne.pochette().pos)), attendu);
  }
  assert.ok(avant.length > 0);
});

test('annuler un lot gardé remet la pochette et la cagnotte', ()=>{
  const m = creerMoteur({ stockage: null, aleatoire: graine(8) });
  let testes = 0;
  for(let g=0; g<60 && testes < 10; g++){
    const r = m.tirer();
    if(r.gain){ m.recommencer(); continue; }
    const e = m.etat();
    if(!e.peutGarder){ m.recommencer(); continue; }
    const avantPoche = JSON.stringify(m._interne.pochette().batch);
    const avantCaisse = e.cagnotte.lotsComptes;
    const prevu = m._interne.lotPrevu();
    m.garder();
    assert.ok(m.etat().peutAnnuler);
    m.annuler();
    assert.equal(JSON.stringify(m._interne.pochette().batch), avantPoche);
    assert.equal(m.etat().cagnotte.lotsComptes, avantCaisse);
    assert.equal(m._interne.lotPrevu(), prevu);
    assert.ok(m.etat().peutGarder);
    testes++;
    m.recommencer();
  }
  assert.ok(testes >= 5);
});

test('rechargement en pleine partie : le lot retourne dans la pochette', ()=>{
  const st = memoire();
  const m = creerMoteur({ stockage: st, aleatoire: graine(4) });
  let r = m.tirer();
  while(r.gain){ m.recommencer(); r = m.tirer(); }
  const pos = m._interne.pochette().pos;
  const m2 = creerMoteur({ stockage: st, aleatoire: graine(5) });
  assert.equal(m2._interne.pochette().pos, pos-1);
  assert.equal(m2.etat().cagnotte.mise, m.etat().cagnotte.mise - AVG_MISE);
});

test('la démo n\'écrit jamais dans les clés du jeu en direct', ()=>{
  const st = memoire();
  const m = creerMoteur({ stockage: st, aleatoire: graine(6) });
  jouerPartie(m, ()=>true);
  for(const k of st.m.keys()) assert.ok(k.startsWith('demo:'), 'clé hors préfixe : '+k);
});
