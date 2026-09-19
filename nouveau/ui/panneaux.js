/* Panneaux et textes : statut, bannière du lieu, légende des lots,
   « Partie en cours », derniers gains, boutons, jeton « Démarrage cagnotte ». */
import { CATS, SWATCH_COLORS, LOT_IMAGE_URLS, CENTER_LEGEND_ROWS, shortPlaceName, placePhrase, placeLabel } from '../regles/plateau.js';

const $ = id => document.getElementById(id);
export const boutons = {
  validate: $('validate'), reset: $('reset'), win: $('winBtn'), undo: $('undoBtn'),
  start: $('startBtn'), resetBank: $('resetBankBtn'), rot: $('rotBtn'), fs: $('fsBtn'),
};
const statusEl = $('status'), tvStatus = $('tvStatus'), tvRolls = $('tvRolls'), tvTotal = $('tvTotal');
const placeBanner = $('placeBanner');
const tvResults = $('tvResults'), resultsTicker = $('resultsTicker');
const bankResetFlash = $('bankResetFlash');
export { placeLabel };

export function statut(text){ if(statusEl) statusEl.textContent = text; if(tvStatus) tvStatus.textContent = text; }
export function statutTexte(){ return statusEl ? statusEl.textContent : ''; }

/* « Partie en cours » : rafraîchi à intervalle court, état simple. */
let dernierTotal = '';
export function noterTotal(total){ dernierTotal = String(total); }
export function demarrerHudTele(lirePartie){
  if(!tvRolls) return;
  setInterval(()=>{
    const p = lirePartie();
    const started = (p.index >= 0 || p.rollsUsed > 0);
    tvRolls.textContent = 'Lancer ' + Math.min(p.rollsUsed, p.rollsAllowed) + ' / ' + p.rollsAllowed;
    tvTotal.textContent = p.finished ? 'Partie terminée' : (started && dernierTotal ? 'Dernier tirage : ' + dernierTotal : 'Prêt à jouer');
    if(tvStatus && statusEl) tvStatus.textContent = statusEl.textContent;
  }, 250);
}

/* Bannière du lieu : reste affichée tant que le pion y est ; fondu
   seulement au changement de case. Texte long : la taille descend. */
let bannerGen = 0;
function fitPlaceBanner(){
  if(!placeBanner) return;
  placeBanner.style.fontSize = '';
  const wrap = placeBanner.parentElement;
  if(!wrap) return;
  const maxW = wrap.clientWidth*0.96;
  let size = parseFloat(getComputedStyle(placeBanner).fontSize), guard = 0;
  while(placeBanner.scrollWidth > maxW && size > 13 && guard < 40){
    size -= 1; placeBanner.style.fontSize = size+'px'; guard++;
  }
}
export function updatePlaceBanner(idx, traveling){
  if(!placeBanner) return;
  const gen = ++bannerGen;
  const nextText = traveling ? '➜ '+shortPlaceName(idx) : (idx<0 ? 'Départ' : '📍 Rendez-vous'+placePhrase(idx));
  const applyText = ()=>{
    if(gen !== bannerGen) return;
    placeBanner.textContent = nextText;
    fitPlaceBanner();
    placeBanner.classList.add('show');
  };
  if(placeBanner.classList.contains('show')){ placeBanner.classList.remove('show'); setTimeout(applyText, 460); }
  else applyText();
}

/* Légende télé : même source que la plaque centrale, aucun pourcentage. */
export function renderTvLegend(){
  const el = $('tvLegend');
  if(!el) return;
  el.innerHTML = '';
  CENTER_LEGEND_ROWS.forEach(r=>{
    const def = CATS[r.catKey]; if(!def) return;
    const row = document.createElement('div');
    row.className = 'tv-lot';
    row.style.setProperty('--c', SWATCH_COLORS[r.swatch] || '#e9c34a');
    const img = document.createElement('img'); img.src = LOT_IMAGE_URLS[r.catKey] || ''; img.alt = '';
    const name = document.createElement('div'); name.className = 'name'; name.textContent = def.label;
    row.appendChild(img); row.appendChild(name);
    el.appendChild(row);
  });
}

/* Derniers gains : vignettes (panneau télé et bandeau de l'écran public). */
export function renderResults(lastResults){
  if(tvResults){
    tvResults.innerHTML = '';
    lastResults.forEach((r,i)=>{
      const item = document.createElement('div');
      item.className = 'r' + (i===0 ? ' new' : '');
      const img = document.createElement('img'); img.src = r.url; img.alt = '';
      item.appendChild(img); tvResults.appendChild(item);
    });
  }
  if(!resultsTicker) return;
  resultsTicker.innerHTML = '';
  lastResults.forEach((r,i)=>{
    const item = document.createElement('div');
    item.className = 'ticker-item' + (i===0 ? ' new' : '');
    const img = document.createElement('img'); img.src = r.url; img.alt = '';
    item.appendChild(img); resultsTicker.appendChild(item);
  });
}

/* Jeton de confirmation du « Démarrage cagnotte ». */
let bankFlashTimer = null;
export function flashBankResetToken(){
  if(!bankResetFlash) return;
  clearTimeout(bankFlashTimer);
  bankResetFlash.classList.remove('show');
  void bankResetFlash.offsetWidth;
  bankResetFlash.classList.add('show');
  bankFlashTimer = setTimeout(()=>{ bankResetFlash.classList.remove('show'); }, 1400);
}

/* Bouton « lot remporté » : visible sur une case de lot, à l'arrêt. */
export function updateWinButton(partie, moving, catKey, onPreview){
  const b = boutons.win;
  if(!b) return;
  const onPrize = partie.index>0 && !moving;
  const cat = onPrize ? catKey : null;
  const autoResolved = cat==='chance' || cat==='chest';
  b.hidden = !onPrize || autoResolved;
  if(onPrize && !autoResolved){
    b.disabled = false;
    b.textContent = cat==='prison' ? '💀 FIN DE PARTIE' : '🎉 LOT REMPORTÉ';
    if(cat!=='prison') onPreview(cat);
  }
}

/* Boutons écran (Pivoter, Plein écran) : visibles au mouvement de la
   souris, effacés seuls après 6 s. */
const screenBtns = $('screenBtns');
let screenBtnsTimer = 0;
export function showScreenBtns(estEcranPublic){
  if(!screenBtns || estEcranPublic) return;
  screenBtns.classList.add('show');
  clearTimeout(screenBtnsTimer);
  screenBtnsTimer = setTimeout(()=>screenBtns.classList.remove('show'), 6000);
}
