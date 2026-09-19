/* Écran public (?view=display) : seconde fenêtre synchronisée par
   BroadcastChannel. Elle rejoue les mêmes animations que la fenêtre de
   contrôle ; aucun bouton, aucun repère animateur. */
import { estEcranPublic, surMessage } from '../etat/stockage.js';
export { estEcranPublic };
export function brancherEcranPublic(h){
  if(!estEcranPublic) return;
  surMessage(m=>{
    if(m.type==='draw') h.draw(m.draw);
    else if(m.type==='move') h.move(m.count, m.card);
    else if(m.type==='celebrate') h.celebrate(m.catKey, m.mystery);
    else if(m.type==='restart') h.restart();
    else if(m.type==='start') h.start();
  });
}
