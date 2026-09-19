/* Sons synthétisés en direct (Web Audio), aucun fichier. Coupés quand le
   système demande moins d'animations. */
export const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let audioCtx = null;
function ctx(){
  if(reduceMotion) return null;
  try{
    if(!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
    if(audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }catch(e){ return null; }
}
/* Montée de tension : sinus 170 → 760 Hz. */
export function playRiser(durationMs){
  const c = ctx(); if(!c) return;
  try{
    const now = c.currentTime, dur = durationMs/1000;
    const osc = c.createOscillator(), gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(170, now);
    osc.frequency.exponentialRampToValueAtTime(760, now+dur);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.22, now+dur*0.88);
    gain.gain.exponentialRampToValueAtTime(0.0001, now+dur+0.12);
    osc.connect(gain); gain.connect(c.destination);
    osc.start(now); osc.stop(now+dur+0.15);
  }catch(e){}
}
export function playImpact(){
  const c = ctx(); if(!c) return;
  try{
    const now = c.currentTime;
    const bufSize = Math.floor(c.sampleRate*0.18);
    const buffer = c.createBuffer(1, bufSize, c.sampleRate);
    const data = buffer.getChannelData(0);
    for(let i=0;i<bufSize;i++){ data[i] = (Math.random()*2-1) * (1-i/bufSize); }
    const noise = c.createBufferSource(); noise.buffer = buffer;
    const lowpass = c.createBiquadFilter(); lowpass.type='lowpass'; lowpass.frequency.value=1100;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.32, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now+0.18);
    noise.connect(lowpass); lowpass.connect(gain); gain.connect(c.destination);
    noise.start(now);
  }catch(e){}
}
/* Petit « tap » à chaque case franchie. */
export function playHop(){
  const c = ctx(); if(!c) return;
  try{
    const now = c.currentTime;
    const osc = c.createOscillator(), gain = c.createGain();
    osc.type = 'triangle';
    const freq = 300 + Math.random()*70;
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq*0.6, now+0.08);
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now+0.09);
    osc.connect(gain); gain.connect(c.destination);
    osc.start(now); osc.stop(now+0.1);
  }catch(e){}
}
export function playCoin(){
  const c = ctx(); if(!c) return;
  try{
    const now = c.currentTime;
    [[1180,0],[1760,0.07]].forEach(([freq,delay])=>{
      const osc = c.createOscillator(), gain = c.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now+delay);
      gain.gain.setValueAtTime(0.0001, now+delay);
      gain.gain.exponentialRampToValueAtTime(0.26, now+delay+0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now+delay+0.3);
      osc.connect(gain); gain.connect(c.destination);
      osc.start(now+delay); osc.stop(now+delay+0.32);
    });
  }catch(e){}
}
/* Fanfare qui s'étoffe avec le niveau (1 = cha-ching seul, 5 = arpège). */
export function playFanfare(level){
  playCoin();
  const c = ctx(); if(!c || level<3) return;
  try{
    const now = c.currentTime;
    const notes = level>=5 ? [523.25,659.25,783.99,1046.5] : [523.25,659.25,783.99];
    notes.forEach((freq,i)=>{
      const delay = 0.16 + i*0.1;
      const osc = c.createOscillator(), gain = c.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now+delay);
      gain.gain.setValueAtTime(0.0001, now+delay);
      gain.gain.exponentialRampToValueAtTime(0.2, now+delay+0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now+delay+0.5);
      osc.connect(gain); gain.connect(c.destination);
      osc.start(now+delay); osc.stop(now+delay+0.52);
    });
  }catch(e){}
}
export function playThunder(strength){
  const c = ctx(); if(!c) return;
  try{
    const now = c.currentTime;
    const dur = 1.1;
    const bufSize = Math.floor(c.sampleRate*dur);
    const buffer = c.createBuffer(1, bufSize, c.sampleRate);
    const data = buffer.getChannelData(0);
    for(let i=0;i<bufSize;i++){ const u=i/bufSize; data[i] = (Math.random()*2-1) * Math.pow(1-u, 1.6) * (0.6+0.4*Math.sin(u*40)); }
    const noise = c.createBufferSource(); noise.buffer = buffer;
    const lp = c.createBiquadFilter(); lp.type='lowpass'; lp.frequency.setValueAtTime(900, now); lp.frequency.exponentialRampToValueAtTime(120, now+0.5);
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.55*strength, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now+dur);
    noise.connect(lp); lp.connect(gain); gain.connect(c.destination);
    noise.start(now);
  }catch(e){}
  playImpact();
}
