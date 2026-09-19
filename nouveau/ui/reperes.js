/* Repères de l'animateur, jamais sur l'écran public : le point de 5 px
   (doré = prochain lot ETB, bleuté = coffret, blanc = lot forcé programmé),
   les deux ★ du titre qui s'éclaircissent pour ETB / coffret, et les
   indications clavier (jamais pour une touche de lot forcé). */
import { estEcranPublic } from '../etat/stockage.js';

const cueDot = document.getElementById('cueDot');
const starL = document.getElementById('brandStarL');
const starR = document.getElementById('brandStarR');
const keyHintEl = document.getElementById('keyHint');
let keyHintTimer = 0;

/* `cat` : le lot en jeu, ou le prochain déjà connu ; `forcedNow` : un lot
   est programmé pour la partie à venir ou en cours. */
export function updateCue(cat, forcedNow){
  if(estEcranPublic) return;
  const big = (cat==='jackpot300' || cat==='etb');
  if(starL) starL.classList.toggle('cue', big);
  if(starR) starR.classList.toggle('cue', big);
  if(!cueDot) return;
  cueDot.className = 'cue-dot' + (cat==='jackpot300' ? ' etb' : cat==='etb' ? ' coffret' : '') + (forcedNow ? ' forced' : '');
}
export function showKeyHint(text){
  if(!keyHintEl) return;
  keyHintEl.textContent = text;
  keyHintEl.classList.add('show');
  clearTimeout(keyHintTimer);
  keyHintTimer = setTimeout(()=>keyHintEl.classList.remove('show'), 2600);
}
