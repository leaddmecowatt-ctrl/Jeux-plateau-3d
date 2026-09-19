/* Pivot de l'image (R, ?rot=90 / 270, mémorisé), plein écran, et les deux
   dispositions télé posées en classes sur <html> (voir style/tele.css). */
import { CLES, ecrire, lireEntier } from '../etat/stockage.js';

let rotation = 0;
const hooks = [];
export function surChangement(fn){ hooks.push(fn); }
export function rotationCourante(){ return rotation; }

const mqLarge = window.matchMedia('(min-aspect-ratio: 3/2) and (min-width: 1100px)');
const mqPortrait = window.matchMedia('(max-aspect-ratio: 3/4) and (min-height: 1100px)');
export function estVertical(){ return rotation !== 0 || mqPortrait.matches; }
function poserDispositions(){
  const html = document.documentElement;
  html.classList.toggle('tv-large', rotation === 0 && mqLarge.matches);
  html.classList.toggle('vertical', estVertical());
}
export function applyRotation(deg){
  rotation = (deg===90 || deg===270) ? deg : 0;
  const root = document.documentElement;
  root.classList.toggle('rotated', rotation !== 0);
  root.classList.toggle('rot90', rotation === 90);
  root.classList.toggle('rot270', rotation === 270);
  ecrire(CLES.rot, rotation);
  poserDispositions();
  setTimeout(()=>hooks.forEach(fn=>fn()), 30);
}
export function cycleRotation(){
  applyRotation(rotation === 0 ? 90 : rotation === 90 ? 270 : 0);
  return rotation;
}
export function toggleFullscreen(){
  try{
    if(!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
  }catch(e){}
}
/* Priorité : ?rot= > choix mémorisé > data-rot sur <html> > image droite. */
export function initOrientation(){
  const q = new URLSearchParams(location.search).get('rot');
  const saved = lireEntier(CLES.rot);
  const preset = parseInt(document.documentElement.dataset.rot || '', 10);
  applyRotation(q != null ? parseInt(q, 10) : !isNaN(saved) ? saved : !isNaN(preset) ? preset : 0);
  const relire = ()=>{ poserDispositions(); hooks.forEach(fn=>fn()); };
  if(mqLarge.addEventListener){ mqLarge.addEventListener('change', relire); mqPortrait.addEventListener('change', relire); }
  window.addEventListener('resize', poserDispositions, {passive:true});
}
