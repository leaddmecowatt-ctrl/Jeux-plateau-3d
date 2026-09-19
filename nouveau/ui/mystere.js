/* Lot mystère : deux cartes noires se retournent, une ombre saute de
   l'une à l'autre en ralentissant et finit sur la carte NON gagnante.
   Positions en offsetLeft/Top (repère de mise en page), jamais
   getBoundingClientRect : l'interface peut être pivotée. */
import { LOT_IMAGE_URLS } from '../regles/plateau.js';
import { playRiser, playHop, playFanfare, reduceMotion } from './son.js';

const overlay = document.getElementById('mysteryOverlay');
const cards = [document.getElementById('mysteryCard0'), document.getElementById('mysteryCard1')];
const shade = document.getElementById('mysteryShade');
const result = document.getElementById('mysteryResult');
const wait = ms => new Promise(r=>setTimeout(r,ms));

/* fx : { triggerImpactFlash, cameraPunch } */
export async function playMysteryReveal(sub, fx){
  if(!overlay || !cards[0] || !shade) return;
  const winIdx = sub === 'booster' ? 0 : 1;
  cards.forEach(c=>c.classList.remove('flipped','win','lose'));
  const img0 = cards[0].querySelector('img'), img1 = cards[1].querySelector('img');
  if(img0) img0.src = LOT_IMAGE_URLS.mystBooster;
  if(img1) img1.src = LOT_IMAGE_URLS.mystCarte;
  shade.style.transition = 'none';
  shade.style.opacity = '0';
  if(result) result.textContent = '';
  overlay.classList.add('show');
  playRiser(900);
  await wait(reduceMotion ? 200 : 550);
  cards[0].classList.add('flipped');
  await wait(reduceMotion ? 50 : 200);
  cards[1].classList.add('flipped');
  await wait(reduceMotion ? 300 : 950);
  const c0 = cards[0], c1 = cards[1];
  shade.style.left = c0.offsetLeft + 'px'; shade.style.top = c0.offsetTop + 'px';
  shade.style.width = c0.offsetWidth + 'px'; shade.style.height = c0.offsetHeight + 'px';
  const dx = c1.offsetLeft - c0.offsetLeft, dy = c1.offsetTop - c0.offsetTop;
  const shadeAt = p => 'translate(' + (p*dx) + 'px,' + (p*dy) + 'px)';
  let pos = winIdx;
  shade.style.transform = shadeAt(pos);
  shade.style.opacity = '1';
  await wait(120);
  // nombre de sauts impair : partie de la gagnante, l'ombre finit sur l'autre
  const hops = reduceMotion ? [200] : [95,100,110,125,145,170,200,230,265,305,350];
  for(const d of hops){
    pos = 1 - pos;
    shade.style.transition = 'transform ' + d + 'ms cubic-bezier(.3,.6,.3,1)';
    shade.style.transform = shadeAt(pos);
    playHop();
    await wait(d + 25);
  }
  if(pos !== 1 - winIdx){
    pos = 1 - winIdx;
    shade.style.transition = 'transform 200ms ease';
    shade.style.transform = shadeAt(pos);
    await wait(230);
  }
  cards[winIdx].classList.add('win');
  cards[1-winIdx].classList.add('lose');
  if(result) result.textContent = sub === 'booster' ? '🎁 BOOSTER !' : '🌟 CARTE RARE !';
  playFanfare(3);
  fx.triggerImpactFlash();
  fx.cameraPunch(1.2);
  await wait(1700);
  overlay.classList.remove('show');
  await wait(260);
}
