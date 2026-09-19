/* Le rendu : renderer, scène, caméra, bloom, qualité adaptative, mode
   éco, contexte WebGL perdu, redimensionnement, boucle d'images.
   Retourne le contexte `sc` que tous les modules de scene/ reçoivent. */
import * as THREE from 'three';
import { EffectComposer } from '../../vendor/three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../../vendor/three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../../vendor/three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from '../../vendor/three/examples/jsm/postprocessing/SMAAPass.js';
import { makeStudioBackdrop, setMaxAniso } from './textures.js';
import { CLES, ecrire, lireEntier } from '../etat/stockage.js';

export const BASE_FOV = 40;
export const QUALITY_LEVELS = 5;

export function creerRendu({ canvas, wrap, reduceMotion }){
  let renderer;
  try{
    renderer = new THREE.WebGLRenderer({ canvas, antialias:false, alpha:true, powerPreference:'high-performance' });
  }catch(e){
    const fb = document.createElement('div');
    fb.className = 'gl-fallback';
    fb.textContent = "Impossible d'afficher le plateau 3D (WebGL indisponible sur cet appareil).";
    wrap.appendChild(fb);
    throw e;
  }
  /* 1,5x max : au-delà, pas plus net, mais le bloom (~17x le reste) coûte
     presque deux fois plus. */
  const DPR_MAX = Math.min(window.devicePixelRatio||1, 1.5);
  renderer.setPixelRatio(DPR_MAX);
  setMaxAniso(renderer.capabilities.getMaxAnisotropy());

  /* Contexte WebGL perdu : on note que l'appareil a lâché (mode éco imposé
     au rechargement), on prévient, on relance. La cagnotte est en mémoire
     du navigateur : rien n'est perdu. */
  renderer.domElement.addEventListener('webglcontextlost', (e)=>{
    e.preventDefault();
    ecrire(CLES.qForced, '5');
    const warn = document.createElement('div');
    warn.className = 'gl-fallback';
    warn.textContent = 'Affichage relancé en mode économie…';
    wrap.appendChild(warn);
    setTimeout(()=>location.reload(), 900);
  }, false);
  renderer.setClearAlpha(0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.45;

  const scene = new THREE.Scene();
  {
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    scene.environment = pmrem.fromEquirectangular(makeStudioBackdrop()).texture;
    pmrem.dispose();
  }
  const camera = new THREE.PerspectiveCamera(BASE_FOV,1,0.1,100);
  camera.position.set(0,13.5,11);
  scene.add(camera);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  /* Anti-crénelage SMAA : la scène est rendue dans une texture (composer),
     le MSAA du canvas ne lisse donc rien. SMAA lisse les bords en une passe
     plein écran, AVANT le bloom : le bloom reste la dernière passe, celle qui
     écrit à l'écran avec le tone mapping et la conversion sRGB — le même
     rendu qu'avant, à la virgule près, lissage en plus. Coupé dès le cran 3
     de qualité et en éco. */
  const smaaPass = new SMAAPass(1, 1);
  composer.addPass(smaaPass);
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(1,1), 0.55, 0.4, 0.82);
  composer.addPass(bloomPass);

  const sc = {
    renderer, scene, camera, composer, bloomPass, smaaPass, canvas, wrap, reduceMotion,
    clock: new THREE.Clock(),
    eco: false,
    DPR_MAX,
    /* fonctions branchées par les autres modules */
    ecoHooks: [],        // (on) => …  : ce qui se coupe en éco
    resizeHooks: [],     // () => …    : recadrage caméra…
    quality: { level:0, samples:0, slow:0, last:0, armedAt:0, locked:false },
  };

  function refreshMaterials(){
    scene.traverse(o=>{ if(o.material){ (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>{ m.needsUpdate = true; }); } });
  }
  /* Mode éco : bloom, ombres, décoration coupés — jamais du jeu. */
  sc.setEcoMode = function(on){
    if(sc.eco === on) return;
    sc.eco = on;
    bloomPass.enabled = !on;
    smaaPass.enabled = !on && sc.quality.level < 3;
    renderer.shadowMap.enabled = !on;
    document.documentElement.classList.toggle('eco', on);
    sc.ecoHooks.forEach(fn=>fn(on));
    refreshMaterials();
  };
  function setShadowSoft(soft){
    const type = soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    if(renderer.shadowMap.type === type) return;
    renderer.shadowMap.type = type;
    refreshMaterials();
  }
  /* Crans : 1,25x → 1x → ombres PCF simples → bloom quart → 0,85x → éco. */
  sc.applyQuality = function(level){
    sc.quality.level = level;
    const dpr = level>=5 ? 0.6 : level>=4 ? 0.85 : level>=2 ? 1 : level>=1 ? Math.min(DPR_MAX, 1.25) : DPR_MAX;
    if(renderer.getPixelRatio() !== dpr) renderer.setPixelRatio(dpr);
    sc.setEcoMode(level >= 5);
    if(!sc.eco) setShadowSoft(level < 2);
    smaaPass.enabled = level < 3;
    sc.resize();
  };
  function bloomScaleForLevel(level){ return level>=3 ? 0.25 : 0.5; }
  function qualityTick(realDt, now){
    const Q = sc.quality;
    if(Q.locked || Q.level >= QUALITY_LEVELS) return;
    if(!Q.armedAt){ Q.armedAt = now + 1.2; return; }
    if(now < Q.armedAt) return;
    Q.samples++;
    if(realDt > 1/45) Q.slow++;
    if(Q.samples >= 24){
      if(Q.slow > Q.samples*0.5 && now - Q.last > 0.8){
        Q.last = now;
        sc.applyQuality(Q.level + 1);
      }
      Q.samples = 0; Q.slow = 0;
    }
  }

  sc.resize = function(){
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if(w===0||h===0) return;
    renderer.setSize(w,h,false);
    composer.setSize(w,h);
    const bs = bloomScaleForLevel(sc.quality.level);
    if(bs < 1) bloomPass.setSize(Math.round(w*bs), Math.round(h*bs));
    camera.aspect = w/h;
    camera.updateProjectionMatrix();
    sc.resizeHooks.forEach(fn=>fn());
  };
  window.addEventListener('resize', sc.resize, {passive:true});
  document.addEventListener('fullscreenchange', ()=>setTimeout(sc.resize, 60));
  window.addEventListener('orientationchange', ()=>setTimeout(sc.resize,150), {passive:true});
  if(window.ResizeObserver){ new ResizeObserver(sc.resize).observe(wrap); }

  /* Cran de départ : ?q=0..5 imposé ; après une perte de contexte : éco ;
     petit écran / mobile : cran 3 ; > 2,4 Mpx rendus : cran 1. */
  sc.choisirQualiteInitiale = function(){
    const q = parseInt(new URLSearchParams(location.search).get('q'), 10);
    const petitEcran = Math.min(window.innerWidth, window.innerHeight) <= 520;
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
    const apresPlantage = lireEntier(CLES.qForced);
    if(!isNaN(apresPlantage) && isNaN(q)){ sc.applyQuality(QUALITY_LEVELS); sc.quality.locked = true; }
    else if(!isNaN(q)){ sc.applyQuality(Math.max(0, Math.min(QUALITY_LEVELS, q))); sc.quality.locked = true; }
    else if(petitEcran || mobile) sc.applyQuality(3);
    else {
      sc.resize();
      const px = wrap.clientWidth * wrap.clientHeight * DPR_MAX * DPR_MAX;
      if(px > 2.4e6) sc.applyQuality(1);
    }
  };

  /* La boucle : en éco, plafond à 30 images/s (cadence régulière, chauffe
     moitié moindre — c'est la chauffe qui fait lâcher le contexte). */
  sc.demarrerBoucle = function(frameStep){
    let lastFrameAt = 0, lastRenderAt = 0;
    function animate(){
      requestAnimationFrame(animate);
      const nowMs = performance.now();
      if(sc.eco && nowMs - lastRenderAt < 31) return;
      lastRenderAt = nowMs;
      const realDt = lastFrameAt ? (nowMs - lastFrameAt)/1000 : 0;
      lastFrameAt = nowMs;
      if(!document.hidden && realDt > 0 && realDt < 1) qualityTick(realDt, nowMs/1000);
      frameStep(Math.min(sc.clock.getDelta(), 0.05), sc.clock.getElapsedTime());
      composer.render();
    }
    animate();
  };
  return sc;
}
