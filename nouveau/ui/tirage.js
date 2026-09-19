/* Le tirage de 2 cartes parmi 12 face cachée (à la place des dés). Le
   résultat est déjà décidé (regles/planificateur.js) : ici, la mise en
   scène seulement. */
import { playRiser } from './son.js';

const overlay = document.getElementById('cardDrawOverlay');
const grid = document.getElementById('cardGrid');
const totalEl = document.getElementById('cardDrawTotal');
const wait = ms => new Promise(r=>setTimeout(r,ms));

export function tirageEnCours(){ return !!(overlay && overlay.classList.contains('show')); }

/* `revealImpact()` : son + coup de caméra + flash au retournement. */
export async function playCardDrawAnimation(draw, revealImpact){
  if(!overlay || !grid) return;
  grid.innerHTML = '';
  const cards = [];
  for(let i=0;i<12;i++){
    const c = document.createElement('div');
    c.className = 'mini-card';
    c.innerHTML =
      '<div class="face back"></div>' +
      '<div class="face front">' +
        '<span class="card-rays"></span><span class="card-pip tl"></span><span class="card-num"></span>' +
        '<span class="card-pip br"></span><span class="card-holo"></span>' +
      '</div>' +
      '<span class="card-shock"></span>' +
      '<span class="card-sparks"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>';
    grid.appendChild(c);
    cards.push(c);
  }
  overlay.classList.add('show');
  if(totalEl) totalEl.textContent = '';
  await wait(400);
  const {a,b} = draw.pairs[0];
  const s1 = draw.slotOrder[0], s2 = draw.slotOrder[1];
  const setFace = (el, n) => {
    el.querySelector('.card-num').textContent = n;
    el.querySelectorAll('.card-pip').forEach(p => p.dataset.n = n);
  };
  setFace(cards[s1].querySelector('.front'), a);
  setFace(cards[s2].querySelector('.front'), b);
  cards.forEach((c,i)=>{ if(i!==s1 && i!==s2) c.classList.add('dim'); });
  cards[s1].classList.add('suspense'); cards[s2].classList.add('suspense');
  playRiser(680);
  await wait(680);
  cards[s1].classList.remove('suspense'); cards[s2].classList.remove('suspense');
  cards[s1].classList.add('flipped');
  await wait(220);
  cards[s2].classList.add('flipped');
  await wait(700);
  revealImpact();
  if(totalEl) totalEl.textContent = 'Total : '+draw.total + (draw.isDouble ? '  —  DOUBLE ! ⚡ Relancez pour la paire bonus' : '');
  await wait(draw.isDouble ? 1600 : 900);
  overlay.classList.remove('show');
}
