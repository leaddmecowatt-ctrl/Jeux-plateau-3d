/* Mémoire du navigateur (localStorage) et canal entre fenêtres.
   Les clés sont celles de l'ancien jeu : un direct en cours ne perd rien
   au changement de version. localStorage peut être bloqué (mode privé,
   iframe) : chaque accès est protégé. */
export const CLES = {
  totalMise: 'pika_total_mise',
  totalPaid: 'pika_total_paid',
  file:      'pika_outcome_batch',
  recal:     'pika_recal',
  pity:      'pika_pity_counter',
  qForced:   'pika_q_forced',
  rot:       'pika_rot',
};

export function lire(cle){ try{ return localStorage.getItem(cle); }catch(e){ return null; } }
export function ecrire(cle, valeur){ try{ localStorage.setItem(cle, String(valeur)); }catch(e){} }
export function lireJSON(cle){ try{ return JSON.parse(lire(cle) || 'null'); }catch(e){ return null; } }
export function ecrireJSON(cle, obj){ try{ localStorage.setItem(cle, JSON.stringify(obj)); }catch(e){} }
export function lireNombre(cle, defaut){ const v = parseFloat(lire(cle)); return isNaN(v) ? defaut : v; }
export function lireEntier(cle){ return parseInt(lire(cle), 10); }

/* Écran public : ?view=display ouvre une seconde fenêtre synchronisée par
   BroadcastChannel — aucun serveur. */
export const estEcranPublic = new URLSearchParams(location.search).get('view') === 'display';
const canal = ('BroadcastChannel' in window) ? new BroadcastChannel('pikajackpot-sync') : null;
export function diffuser(msg){ if(canal && !estEcranPublic) canal.postMessage(msg); }
export function surMessage(fn){ if(canal && estEcranPublic) canal.onmessage = e => fn(e.data || {}); }
