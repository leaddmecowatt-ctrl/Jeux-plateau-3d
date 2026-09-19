/* Commandes clavier : A démarrer · B tirer · C recommencer · D garder ·
   F plein écran · R pivoter · Z / M / 1–6 lot forcé (par position physique
   de touche, e.code : sans Maj en AZERTY). Ignorées dans un champ texte. */
const FORCE_KEYS = { z:{cat:'jackpot300', name:'ETB'}, m:{cat:'booster50', name:'Tripack'} };
const FORCE_DIGITS = [
  {cat:'jackpot300',  name:'ETB'},
  {cat:'etb',         name:'Coffret'},
  {cat:'booster50',   name:'Tripack'},
  {cat:'gradee',      name:'Duopack'},
  {cat:'booster8',    name:'Booster'},
  {cat:'alternative', name:'Lot Mystère'},
];
export function forceKeyFor(e){
  const m = /^(?:Digit|Numpad)([1-6])$/.exec(e.code || '');
  if(m) return Object.assign({key:m[1]}, FORCE_DIGITS[+m[1]-1]);
  const k = (e.key || '').toLowerCase();
  return FORCE_KEYS[k] ? Object.assign({key:k.toUpperCase()}, FORCE_KEYS[k]) : null;
}
/* actions : { demarrer, tirer, recommencer, garder, forcer(fk), pleinEcran, pivoter } */
export function brancherClavier(actions){
  window.addEventListener('keydown', (e)=>{
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if(tag==='INPUT' || tag==='TEXTAREA') return;
    const k = (e.key || '').toLowerCase();
    if(k==='a') actions.demarrer();
    else if(k==='b') actions.tirer();
    else if(k==='c') actions.recommencer();
    else if(k==='d') actions.garder();
    else if(forceKeyFor(e)) actions.forcer(forceKeyFor(e));
    else if(k==='f') actions.pleinEcran();
    else if(k==='r') actions.pivoter();
  });
}
