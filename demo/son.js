/* Ambiance sonore synthétisée localement : aucun enregistrement tiers,
   aucun téléchargement. Activation exclusivement par un geste de l'utilisateur. */
export function installerSon() {
  let contexte=null,sortie=null,active=false,bruit=null,ambiants=[];
  const bouton=document.getElementById('demo-son');
  function ouvrir(){
    if(contexte)return true;
    const Audio=window.AudioContext||window.webkitAudioContext;
    if(!Audio)return false;
    contexte=new Audio();sortie=contexte.createGain();sortie.gain.value=.15;sortie.connect(contexte.destination);
    bruit=contexte.createBuffer(1,contexte.sampleRate,contexte.sampleRate);
    const data=bruit.getChannelData(0);let seed=53497;
    for(let i=0;i<data.length;i++){seed=(seed*1664525+1013904223)>>>0;data[i]=seed/2147483648-1;}
    for(const freq of [55,82.4069,110]){
      const o=contexte.createOscillator(),g=contexte.createGain();o.type='sine';o.frequency.value=freq;g.gain.value=.025;o.connect(g);g.connect(sortie);o.start();ambiants.push(o);
    }
    return true;
  }
  function impact(type,intensite=1){
    if(!active||!contexte||contexte.state!=='running'||document.hidden)return;
    const t=contexte.currentTime,duree=type==='feu'?1.1:.65;
    const src=contexte.createBufferSource(),f=contexte.createBiquadFilter(),g=contexte.createGain();
    src.buffer=bruit;f.type=type==='foudre'?'highpass':'lowpass';f.frequency.value=type==='feu'?650:1800;
    g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.25*intensite,t+.025);g.gain.exponentialRampToValueAtTime(.0001,t+duree);
    src.connect(f);f.connect(g);g.connect(sortie);src.start(t);src.stop(t+duree);src.onended=()=>{src.disconnect();f.disconnect();g.disconnect();};
    const o=contexte.createOscillator(),p=contexte.createGain();o.type=type==='psy'?'sine':'triangle';o.frequency.setValueAtTime(type==='psy'?460:130,t);o.frequency.exponentialRampToValueAtTime(type==='psy'?130:35,t+duree);
    p.gain.setValueAtTime(.0001,t);p.gain.exponentialRampToValueAtTime(.18,t+.02);p.gain.exponentialRampToValueAtTime(.0001,t+duree);o.connect(p);p.connect(sortie);o.start(t);o.stop(t+duree);o.onended=()=>{o.disconnect();p.disconnect();};
  }
  async function basculer(){
    try{
      if(!ouvrir())throw new Error('Audio indisponible');
      active=!active;
      if(active)await contexte.resume();else await contexte.suspend();
      if(bouton){bouton.setAttribute('aria-pressed',String(active));bouton.textContent=active?'Son activé':'Activer le son';}
    }catch(e){active=false;if(bouton){bouton.textContent='Son indisponible';bouton.disabled=true;}}
  }
  const evenement=e=>impact(e.detail?.type,e.detail?.intensite||1);
  bouton?.addEventListener('click',basculer);
  window.addEventListener('pikapoly:attaque',evenement);
  document.addEventListener('visibilitychange',()=>{if(contexte&&active){if(document.hidden)contexte.suspend();else contexte.resume().catch(()=>{});}});
  return {dispose(){bouton?.removeEventListener('click',basculer);window.removeEventListener('pikapoly:attaque',evenement);contexte?.close();}};
}
