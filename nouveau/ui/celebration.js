/* Célébration « lot remporté » et aperçu du lot. UN SEUL compteur de
   génération (`gen`) pour tout ce qui est différé : reveal après l'orage,
   après le lot mystère, pluie de confettis. Une annonce ne s'efface JAMAIS
   seule : seulement clear() (B, C) ou un nouvel affichage (D). */
import { TIER_LEVEL, CATEGORY_MESSAGES, HYPE_SUB, LOT_IMAGE_URLS, deckFor } from '../regles/plateau.js';
import { STORM_MS } from '../scene/effets/orage.js';
import { playImpact, playFanfare, reduceMotion } from './son.js';
import { playMysteryReveal } from './mystere.js';

const $ = id => document.getElementById(id);
const celeb = $('celebration'), canvas = $('celebCanvas'), celebMain = $('celebMain'), celebSub = $('celebSub'), celebPhoto = $('celebPhoto');
const impactFlash = $('impactFlash'), lightningBolt = $('lightningBolt');
const FIREWORK_PALETTES = {
  gradee:    [['#48e5c2','#b9fff0','#ffffff','#ffe27a'], ['#2fd6b0','#ffffff','#aaf7e6']],
  booster50: [['#ff6fae','#ffc2dd','#ffffff','#ffe27a'], ['#ff4f9a','#ffffff','#ffd7e8']],
};

export function triggerImpactFlash(){
  if(!impactFlash || reduceMotion) return;
  impactFlash.classList.add('hit');
  setTimeout(()=>impactFlash.classList.remove('hit'), 90);
}
export function triggerImpactBlast(){
  if(!impactFlash || reduceMotion) return;
  impactFlash.classList.add('blast');
  setTimeout(()=>impactFlash.classList.remove('blast'), 260);
}
export function triggerLightning(){
  if(!lightningBolt || reduceMotion) return;
  lightningBolt.classList.remove('strike'); void lightningBolt.offsetWidth;
  lightningBolt.classList.add('strike');
  setTimeout(()=>lightningBolt.classList.remove('strike'), 850);
}

/* deps : { wrap, appEl, estVertical(), cameraPunch, triggerCheer, startHypeShake,
            startGoldRain, startStorm(), fundedCategory(cat), pushResult(cat), tirerCarte(deck) } */
export function creerCelebration(deps){
  const ctx = canvas ? canvas.getContext('2d') : null;
  let particles = [], rockets = [], raf = null, endAt = 0;
  let gen = 0;

  /* ---- télé verticale : l'overlay se cale sur la zone du plateau ---- */
  function fitToBoard(){
    if(!celeb || !deps.wrap || !deps.appEl) return;
    if(!deps.estVertical()){
      if(celeb.parentElement !== deps.appEl) deps.appEl.appendChild(celeb);
      celeb.style.top = ''; celeb.style.height = ''; celeb.style.bottom = '';
      celeb.style.removeProperty('--celeb-box-h');
      return;
    }
    // enfant de la zone du plateau : frère du canvas WebGL, même contexte
    // d'empilement, Safari ne peut plus le peindre derrière (image pivotée)
    if(celeb.parentElement !== deps.wrap) deps.wrap.appendChild(celeb);
    celeb.style.top = '0'; celeb.style.height = '100%'; celeb.style.bottom = 'auto';
    celeb.style.setProperty('--celeb-box-h', deps.wrap.offsetHeight + 'px');
  }
  function resizeCanvas(){
    if(!canvas) return;
    fitToBoard();
    const box = celeb || document.body;
    canvas.width = box.clientWidth || window.innerWidth;
    canvas.height = box.clientHeight || window.innerHeight;
  }
  window.addEventListener('resize', resizeCanvas, {passive:true});

  /* ---- feux d'artifice sur canvas 2D ---- */
  function spawnFirework(x, y, level, colors, opts){
    const o = opts || {};
    const cols = colors || (level>=4 ? ['#ffe27a','#fff2c2','#ffffff','#ffd200'] : ['#ffe27a','#e0323f','#1a56db','#ffffff']);
    const power = o.power || 1;
    const count = Math.round((30 + level*12) * power);
    particles.push({ x, y, px:x, py:y, vx:0, vy:0, g:0, size:(30+level*8)*power, color:'#fff8e4', life:1, decay:0.12, shape:'flash', rot:0, vr:0, spark:false, drag:1 });
    particles.push({ x, y, px:x, py:y, vx:0, vy:0, g:0, size:(10+level*3)*power, color:cols[0], life:1, decay:0.07, shape:'ring', rot:0, vr:0, spark:false, drag:1 });
    for(let i=0;i<count;i++){
      const ang = (i/count)*Math.PI*2 + (Math.random()-0.5)*0.35;
      const shell = Math.random()<0.62 ? 1 : 0.58;
      const spd = (2.6+Math.random()*3.4)*(1+level*0.13)*power*shell;
      const isSpark = Math.random() < 0.55;
      particles.push({
        x, y, px:x, py:y, vx:Math.cos(ang)*spd, vy:Math.sin(ang)*spd, g: 0.055+Math.random()*0.03,
        size: isSpark ? 1.5+Math.random()*1.7 : 2.4+Math.random()*3.0, color: cols[(Math.random()*cols.length)|0],
        life:1, decay: 0.0075+Math.random()*0.007, shape: isSpark ? 'spark' : (Math.random()<0.45?'rect':'circle'),
        rot:Math.random()*Math.PI, vr:(Math.random()-0.5)*0.3, spark:isSpark, drag:0.975, twinkle: Math.random()<0.45
      });
    }
    if(o.crackle !== false){
      const myGen = gen;
      setTimeout(()=>{
        if(myGen !== gen) return;
        const n = Math.round(16*power);
        for(let i=0;i<n;i++){
          const a = Math.random()*Math.PI*2, s = (1+Math.random()*2)*power;
          particles.push({ x, y, px:x, py:y, vx:Math.cos(a)*s, vy:Math.sin(a)*s - 0.6, g:0.05, size:1.2+Math.random()*1.3, color:'#fffaf0',
            life:1, decay:0.02+Math.random()*0.015, shape:'spark', rot:0, vr:0, spark:true, drag:0.965, twinkle:true });
        }
        if(!raf) frame();
      }, 420);
    }
  }
  function anchorRect(){
    if(celebPhoto && !celebPhoto.hidden){
      const r = celebPhoto.getBoundingClientRect();
      if(r.width > 40 && r.height > 40) return r;
    }
    const el = celeb && celeb.querySelector('.celeb-text');
    if(el){ const r = el.getBoundingClientRect(); if(r.width > 40) return r; }
    return null;
  }
  /* les gerbes encadrent la photo, jamais au centre */
  function framedBurstPoint(rect, i, W, H){
    const MIN = 80, zones = [];
    if(rect.left > MIN) zones.push('L');
    if(W - rect.right > MIN) zones.push('R');
    if(rect.top > MIN) zones.push('T', 'T');
    if(H - rect.bottom > MIN) zones.push('B');
    if(!zones.length) zones.push('T');
    const rnd = (a,b) => a + Math.random()*(b-a);
    const z = zones[i % zones.length];
    let x, y;
    if(z === 'L'){ x = rnd(W*0.05, Math.max(W*0.06, rect.left - 18)); y = rnd(rect.top + rect.height*0.1, rect.top + rect.height*0.85); }
    else if(z === 'R'){ x = rnd(Math.min(W*0.94, rect.right + 18), W*0.95); y = rnd(rect.top + rect.height*0.1, rect.top + rect.height*0.85); }
    else if(z === 'B'){ x = rnd(rect.left + rect.width*0.12, rect.right - rect.width*0.12); y = rnd(rect.bottom + 24, H*0.95); }
    else { x = rnd(rect.left + rect.width*0.10, rect.right - rect.width*0.10); y = rnd(H*0.05, Math.max(H*0.06, rect.top - 20)); }
    return { x: Math.max(W*0.04, Math.min(W*0.96, x)), y: Math.max(H*0.04, Math.min(H*0.96, y)) };
  }
  function launchFireworksShow(level, catKey){
    if(!canvas) return;
    const W = canvas.width, H = canvas.height;
    const showcase = (catKey === 'gradee' || catKey === 'booster50');
    const palettes = FIREWORK_PALETTES[catKey] || (level>=4
      ? [['#ffe27a','#fff2c2','#ffffff','#ffd200'], ['#ffb347','#ffe27a','#ffffff']]
      : [['#ffe27a','#e0323f','#1a56db','#ffffff'], ['#1a56db','#ffffff','#ffe27a']]);
    const rocketCount = showcase ? 14 : (level>=4 ? 6 + level*2 : 2 + level);
    const myGen = gen;
    for(let i=0;i<rocketCount;i++){
      const wave = Math.floor(i/3);
      const delay = wave*520 + (i%3)*(90+Math.random()*70);
      setTimeout(()=>{
        if(myGen !== gen) return;
        const rect = showcase ? anchorRect() : null;
        const p = rect ? framedBurstPoint(rect, i, W, H) : null;
        const x = p ? p.x : W*(0.18+Math.random()*0.64);
        const y1 = p ? p.y : H*(0.22+Math.random()*0.2);
        const colors = palettes[(Math.random()*palettes.length)|0];
        rockets.push({ x, y:H*1.05, y0:H*1.05, y1, px:x, py:H*1.05, start: performance.now(), dur: (showcase?600:480)+Math.random()*240,
          exploded:false, level, colors, power: showcase ? 1.25+Math.random()*0.45 : (level>=4 ? 1.2+Math.random()*0.5 : 1) });
        if(!raf) frame();
      }, delay);
    }
  }
  function spawnConfettiRain(level, durMs){
    if(!canvas || reduceMotion) return;
    const myGen = gen, t0 = performance.now();
    const cols = level>=5 ? ['#ffe27a','#fff2c2','#ffffff','#ffd200','#ffb347'] : ['#ffe27a','#e0323f','#1a56db','#ffffff','#48e5c2','#ff6fae'];
    const per = 4 + level*2;
    const tick = ()=>{
      if(myGen !== gen) return;
      const W = canvas.width;
      for(let i=0;i<per;i++){
        const x = Math.random()*W, sz = 4+Math.random()*5;
        particles.push({ x, y:-12, px:x, py:-12, vx:(Math.random()-0.5)*1.4, vy:1.2+Math.random()*2.2, g:0.02+Math.random()*0.02, size:sz,
          color:cols[(Math.random()*cols.length)|0], life:1, decay:0.0028+Math.random()*0.002, shape:'rect', rot:Math.random()*Math.PI,
          vr:(Math.random()-0.5)*0.35, spark:false, drag:0.992, twinkle:Math.random()<0.3 });
      }
      if(!raf) frame();
      if(performance.now()-t0 < durMs) setTimeout(tick, 110);
    };
    tick();
  }
  /* gros lot : éclairs en rafale, coups de caméra, impacts, secousse, pluie d'or */
  function hypeShow(level){
    const strikes = level>=5 ? 6 : level>=4 ? 4 : 3;
    const gap = level>=5 ? 360 : 440;
    for(let i=0;i<strikes;i++){
      setTimeout(()=>{
        if(!celeb || !celeb.classList.contains('big')) return;
        triggerLightning();
        playImpact();
        deps.cameraPunch(i%2 ? 0.7 : 1.3);
        if(i===0 || i===2){ celeb.classList.remove('shake'); void celeb.offsetWidth; celeb.classList.add('shake'); }
      }, 220 + i*gap);
    }
    if(level===3) deps.startHypeShake(1.1, 0.06);
    if(level===4){ deps.startHypeShake(1.6, 0.09); deps.startGoldRain(3.4); }
    spawnConfettiRain(level, level>=5 ? 5200 : level>=4 ? 3800 : 2800);
    deps.triggerCheer(level>=5 ? 1.6 : 1.2);
  }
  function frame(){
    if(!ctx) return;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0,0,W,H);
    const now = performance.now();
    rockets.forEach(r=>{
      const frac = Math.min(1, (now - r.start) / r.dur);
      const eased = 1 - Math.pow(1-frac, 2);
      r.py = r.y;
      r.y = r.y0 + (r.y1 - r.y0) * eased;
      if(frac >= 1 && !r.exploded){ r.exploded = true; spawnFirework(r.x, r.y1, r.level, r.colors, {power:r.power}); }
    });
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    rockets.forEach(r=>{
      if(r.exploded) return;
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = r.colors[0]; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(r.x,r.py); ctx.lineTo(r.x,r.y); ctx.stroke();
      ctx.fillStyle = '#fff6d8';
      ctx.beginPath(); ctx.arc(r.x,r.y,2.2,0,Math.PI*2); ctx.fill();
    });
    ctx.restore();
    rockets = rockets.filter(r=>!r.exploded);
    particles.forEach(p=>{
      p.px = p.x; p.py = p.y;
      const dr = p.drag == null ? 1 : p.drag;
      p.vx *= dr; p.vy *= dr;
      p.x += p.vx; p.y += p.vy; p.vy += p.g; p.life -= p.decay; p.rot += p.vr;
      ctx.save();
      let a = Math.max(0, p.life);
      if(p.twinkle && p.life < 0.55) a *= 0.35 + 0.65*Math.abs(Math.sin(p.life*42));
      ctx.globalAlpha = a;
      if(p.shape==='ring'){
        const rad = p.size * (1 + (1-p.life)*7);
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = p.color; ctx.lineWidth = Math.max(0.6, 3.5*p.life);
        ctx.beginPath(); ctx.arc(p.x,p.y,rad,0,Math.PI*2); ctx.stroke();
      } else if(p.shape==='flash'){
        const rad = p.size * (1.15 - p.life*0.3);
        const grad = ctx.createRadialGradient(p.x,p.y,0, p.x,p.y,rad);
        grad.addColorStop(0, p.color); grad.addColorStop(1, 'rgba(255,240,200,0)');
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(p.x,p.y,rad,0,Math.PI*2); ctx.fill();
      } else if(p.spark){
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round'; ctx.strokeStyle = p.color; ctx.lineWidth = p.size;
        ctx.beginPath(); ctx.moveTo(p.px,p.py); ctx.lineTo(p.x,p.y); ctx.stroke();
      } else {
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        ctx.globalAlpha = a*0.5;
        ctx.strokeStyle = p.color; ctx.lineWidth = p.size*0.7;
        ctx.beginPath(); ctx.moveTo(p.px,p.py); ctx.lineTo(p.x,p.y); ctx.stroke();
        ctx.globalAlpha = a;
        ctx.translate(p.x,p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if(p.shape==='rect') ctx.fillRect(-p.size/2,-p.size/2,p.size,p.size*0.6);
        else { ctx.beginPath(); ctx.arc(0,0,p.size/2,0,Math.PI*2); ctx.fill(); }
      }
      ctx.restore();
    });
    particles = particles.filter(p=>p.life>0 && p.y<H+50);
    // la boucle s'arrête quand tout est retombé ; l'annonce, elle, reste
    if(performance.now() < endAt || particles.length || rockets.length) raf = requestAnimationFrame(frame);
    else raf = null;
  }
  function stopLoop(){
    if(raf) cancelAnimationFrame(raf);
    raf = null; particles = []; rockets = []; endAt = 0;
    if(ctx && canvas) ctx.clearRect(0,0,canvas.width,canvas.height);
  }

  /* ---- ce que l'animateur voit ---- */
  function clear(){
    gen++;
    stopLoop();
    if(celeb) celeb.classList.remove('show','shake','flip','rare-card','big');
  }
  /* Aperçu du lot dès l'arrivée : la photo en grand, sans confettis, qui
     reste tant que l'animateur commente. */
  function showLotPreview(catKey){
    if(!celeb || !canvas) return;
    const url = LOT_IMAGE_URLS[catKey];
    if(!url) return;
    gen++;
    stopLoop();
    celeb.dataset.level = '';
    celeb.classList.remove('shake','big');
    if(celebMain) celebMain.hidden = true;
    if(celebSub) celebSub.hidden = true;
    if(celebPhoto){ celebPhoto.src = url; celebPhoto.hidden = false; }
    celeb.classList.add('show');
  }
  function setPhoto(url){
    if(!celebPhoto) return;
    if(url){ celebPhoto.src = url; celebPhoto.hidden = false; } else celebPhoto.hidden = true;
  }
  /* opts : { mystery } ; forcedCard : la carte Chance/Caisse déjà tirée */
  function celebrate(catKey, forcedCard, opts){
    const myGen = ++gen;
    const level = TIER_LEVEL[catKey] ?? 1;
    if(level===0){
      // Prison : fin de partie, une commune de consolation quand même
      const payoutCat = deps.fundedCategory('commune');
      setPhoto(LOT_IMAGE_URLS[payoutCat]);
      if(celebMain){ celebMain.hidden = false; celebMain.textContent = '🔒 FIN DE PARTIE'; }
      if(celebSub){ celebSub.textContent = 'Le joueur est envoyé en prison — une carte de consolation est offerte quand même !'; celebSub.hidden = false; }
      if(celeb){ celeb.classList.add('show','shake'); celeb.dataset.level='0'; }
      playImpact();
      deps.pushResult(payoutCat);
      setTimeout(()=>{ if(celeb) celeb.classList.remove('shake'); }, 700);
      return;
    }
    if(!celeb || !canvas) return;
    if(catKey==='alternative' && opts && opts.mystery){
      celeb.classList.remove('show','shake','flip','rare-card','big');
      playMysteryReveal(opts.mystery, { triggerImpactFlash, cameraPunch: deps.cameraPunch }).then(()=>{
        if(myGen !== gen) return;
        reveal(catKey, forcedCard, level, {mystery: opts.mystery});
      });
      return;
    }
    if(catKey==='jackpot300'){
      // rien à l'écran pendant l'orage : le lot apparaît au flash final
      celeb.classList.remove('show','shake','flip','rare-card','big');
      const stormOn = deps.startStorm();
      setTimeout(()=>{ if(myGen === gen) reveal(catKey, forcedCard, level); }, stormOn ? STORM_MS+60 : 0);
      return;
    }
    reveal(catKey, forcedCard, level);
  }
  function reveal(catKey, forcedCard, level, extra){
    resizeCanvas();
    if(celebMain) celebMain.hidden = false;
    celeb.dataset.level = String(level);
    celeb.classList.remove('flip','rare-card');
    celeb.classList.add('show');
    if(level>=4) celeb.classList.add('shake');
    let rareCardDrawn = false;
    if(catKey==='chance' || catKey==='chest'){
      const card = forcedCard || deps.tirerCarte(deckFor(catKey));
      rareCardDrawn = !!card.rare;
      if(celebMain) celebMain.textContent = rareCardDrawn ? '🌟 JACKPOT DE PIOCHE ! 🌟' : (catKey==='chance' ? '🎴 CARTE CHANCE' : '🗃️ CAISSE COMMUNAUTAIRE');
      if(celebSub){ celebSub.textContent = card.text; celebSub.hidden = false; }
      if(rareCardDrawn){ celeb.classList.add('shake'); deps.triggerCheer(1.3); }
      if(!reduceMotion){ celeb.classList.remove('flip'); void celeb.offsetWidth; celeb.classList.add('flip'); }
      celeb.classList.toggle('rare-card', rareCardDrawn);
      if(card.effect && card.effect.type==='prize' && card.effect.cat){
        const realCat = card.effect.cat;
        deps.fundedCategory(realCat);
        setPhoto(LOT_IMAGE_URLS[realCat]);
        deps.pushResult(realCat);
      } else setPhoto(null);
    } else {
      const myst = extra && extra.mystery;
      if(celebMain) celebMain.textContent = myst
        ? (myst==='booster' ? '🎁 LOT MYSTÈRE : BOOSTER GAGNÉ ! 🎁' : '🌟 LOT MYSTÈRE : CARTE RARE GAGNÉE ! 🌟')
        : (CATEGORY_MESSAGES[catKey] || '🎉 Lot remporté !');
      if(celebSub) celebSub.hidden = true;
      setPhoto(LOT_IMAGE_URLS[myst ? (myst==='booster' ? 'mystBooster' : 'mystCarte') : catKey]);
      deps.pushResult(catKey);
    }
    const effectiveLevel = rareCardDrawn ? 5 : level;
    const big = effectiveLevel>=3 && !rareCardDrawn && catKey!=='chance' && catKey!=='chest';
    celeb.classList.toggle('big', big);
    if(big){
      if(celebSub){ celebSub.textContent = HYPE_SUB[effectiveLevel] || HYPE_SUB[3]; celebSub.hidden = false; }
      hypeShow(effectiveLevel);
    }
    playFanfare(effectiveLevel);
    const skipFx = !rareCardDrawn && catKey==='commune';
    const showcase = (catKey==='gradee' || catKey==='booster50');
    if(!skipFx){
      launchFireworksShow(effectiveLevel, catKey);
      if(effectiveLevel>=3 || showcase){
        triggerLightning();
        if(effectiveLevel>=4 || showcase) setTimeout(triggerLightning, 380);
      }
    }
    endAt = performance.now() + (skipFx ? 1200 : Math.max(showcase ? 4600 : 1900 + effectiveLevel*500, big ? 3600 + effectiveLevel*900 : 0));
    if(!raf) frame();
    setTimeout(()=>{ celeb.classList.remove('shake'); }, rareCardDrawn ? 900 : 700);
  }
  return { celebrate, showLotPreview, clear, fitToBoard, resizeCanvas };
}
