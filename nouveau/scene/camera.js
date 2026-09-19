/* La caméra : OrbitControls, cadrage automatique selon la forme du cadre,
   garde-fou anti-rognage des coins, caméra cinématique (voyage, gros plan,
   orbite d'orage), coups de caméra (punch). */
import * as THREE from 'three';
import { OrbitControls } from '../../vendor/three/OrbitControls.js';
import { BASE_FOV } from './rendu.js';
import { N_SIDE } from '../regles/plateau.js';

const CINE = {
  travel:  { dist: 12.0, elev: 0.77, aim: 0.55, lead: 0.30, side: 0.00, ease: 1.7, aimY: 0.34 },
  closeup: { dist:  3.55, elev: 0.20, aim: 1.00, lead: 1.00, side: 0.55, ease: 3.6, aimY: 0.50 },
  orbit:   { dist:  5.2, elev: 0.34, aim: 1.00, lead: 0.00, side: 0.00, ease: 2.4, aimY: 0.75 },
};
const CAM_DIR_DEFAULT = new THREE.Vector3(0, 13.2, 11).normalize();
const CAM_DIR_SQUARE  = new THREE.Vector3(0, 14.9, 9).normalize();
const CAM_DIR_TALL    = new THREE.Vector3(0, 16.4, 6.6).normalize();

function angLerp(a, b, k){
  let d = b - a;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return a + d*k;
}

export function creerCamera(sc){
  const { camera, renderer, wrap, reduceMotion } = sc;
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0,0.3,0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 10.5;
  controls.maxDistance = 21;
  controls.minPolarAngle = 0.35;
  controls.maxPolarAngle = 1.15;
  controls.enablePan = false;
  controls.autoRotate = !reduceMotion;
  controls.autoRotateSpeed = 0.55;

  const cam = { controls, punchActive: false, cineMode: null, cineBlend: 0, cineSpin: 0, gameStarted: false };

  /* ---- garde-fou anti-rognage des coins ---- */
  const R = (N_SIDE)/2 + 0.15;
  const corners = [
    new THREE.Vector3(-R, 0.5, -R), new THREE.Vector3(R, 0.5, -R),
    new THREE.Vector3(R, 0.5, R), new THREE.Vector3(-R, 0.5, R),
  ];
  const _v = new THREE.Vector3();
  function updateCornerSafety(dt){
    if(cam.punchActive) return;
    camera.updateMatrixWorld();
    let maxTan = Math.tan(THREE.MathUtils.degToRad(BASE_FOV/2));
    for(const c of corners){
      _v.copy(c).applyMatrix4(camera.matrixWorldInverse);
      const depth = -_v.z;
      if(depth <= 0.01) continue;
      maxTan = Math.max(maxTan, Math.abs(_v.y)/depth, (Math.abs(_v.x)/depth)/camera.aspect);
    }
    const targetFov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2*Math.atan(maxTan/0.93)), BASE_FOV, 72);
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt*6);
    camera.updateProjectionMatrix();
  }

  /* ---- cadrage selon la forme du cadre ---- */
  const CAM_BASE_MIN = controls.minDistance, CAM_BASE_MAX = controls.maxDistance;
  const CAM_BASE_DIST = camera.position.distanceTo(controls.target);
  let camFitFactor = 1, camFitMode = 'default';
  function aspectFitMode(a){
    if(a >= 0.95 && a <= 1.15) return 'square';
    if(a >= 0.74 && a < 0.95) return 'tall';
    return 'default';
  }
  function aspectFitFactor(a){
    const mode = aspectFitMode(a);
    if(mode === 'square') return 0.84;
    if(mode === 'tall') return 0.90;
    if(a < 1) return Math.min(Math.pow(1/a, 0.38), 1.6);
    if(a > 1.15) return Math.max(0.76, Math.pow(1/a, 0.70));
    return 1;
  }
  function fitCameraToAspect(){
    const a = wrap.clientWidth / wrap.clientHeight;
    if(!(a > 0)) return;
    const f = aspectFitFactor(a);
    const mode = aspectFitMode(a);
    const k = f / camFitFactor;
    const modeChanged = mode !== camFitMode;
    if(Math.abs(k - 1) < 1e-3 && !modeChanged) return;
    camFitFactor = f; camFitMode = mode;
    controls.minDistance = CAM_BASE_MIN * f;
    controls.maxDistance = CAM_BASE_MAX * f;
    if(cam.cineMode !== null || cam.cineBlend > 0.001) return;
    // distance ABSOLUE (vue d'origine × facteur), jamais un cumul de ratios
    const dist = CAM_BASE_DIST * f;
    const dir = (modeChanged ? (mode === 'square' ? CAM_DIR_SQUARE : mode === 'tall' ? CAM_DIR_TALL : CAM_DIR_DEFAULT)
                             : camera.position.clone().sub(controls.target).normalize()).clone();
    camera.position.copy(controls.target).add(dir.multiplyScalar(dist));
    controls.update();
  }
  sc.resizeHooks.push(fitCameraToAspect);
  fitCameraToAspect();
  controls.update();

  let idleTimer = null;
  controls.addEventListener('start', ()=>{ controls.autoRotate = false; clearTimeout(idleTimer); });
  controls.addEventListener('end', ()=>{
    clearTimeout(idleTimer);
    idleTimer = setTimeout(()=>{ if(!reduceMotion && !cam.gameStarted) controls.autoRotate = true; }, 3500);
  });
  renderer.domElement.addEventListener('pointerdown', ()=>{ cineEnd(); }, {passive:true});

  /* ---- caméra cinématique ---- */
  let cineAz = 0, cineAzInit = false;
  const _cineTarget = new THREE.Vector3(), _cinePos = new THREE.Vector3();
  const _boardTarget = new THREE.Vector3(), _boardPos = new THREE.Vector3();
  function cineBegin(mode){
    if(reduceMotion) return;
    if(cam.cineMode === null && cam.cineBlend <= 0.001){
      _boardTarget.copy(controls.target);
      _boardPos.copy(camera.position);
    }
    if(cam.cineMode === null){ controls.autoRotate = false; controls.enabled = false; }
    cam.cineMode = mode;
  }
  function cineEnd(){ if(cam.cineMode !== null) cam.cineMode = null; }
  function updateCineCam(dt, playerRoot){
    if(cam.cineMode === null && cam.cineBlend <= 0.0001){
      if(!controls.enabled){ controls.enabled = true; cineAzInit = false; }
      return false;
    }
    const want = cam.cineMode ? 1 : 0;
    const cfg = CINE[cam.cineMode || 'travel'];
    cam.cineBlend += (want - cam.cineBlend) * Math.min(1, dt*cfg.ease);
    if(want === 0 && cam.cineBlend < 0.004) cam.cineBlend = 0;
    const P = playerRoot.position;
    const radialAz = Math.atan2(P.x, P.z);
    const wantAz = angLerp(radialAz, playerRoot.rotation.y + cfg.side, cfg.lead);
    if(!cineAzInit){ cineAz = wantAz; cineAzInit = true; }
    else if(cam.cineMode === 'orbit') cineAz += dt*cam.cineSpin;
    else cineAz = angLerp(cineAz, wantAz, Math.min(1, dt*2.2));
    _cineTarget.set(P.x*cfg.aim, P.y + cfg.aimY, P.z*cfg.aim);
    const ce = Math.cos(cfg.elev), se = Math.sin(cfg.elev);
    _cinePos.set(_cineTarget.x + Math.sin(cineAz)*ce*cfg.dist, _cineTarget.y + se*cfg.dist, _cineTarget.z + Math.cos(cineAz)*ce*cfg.dist);
    const k = cam.cineBlend*cam.cineBlend*(3-2*cam.cineBlend);
    _cineTarget.lerp(_boardTarget, 1-k);
    _cinePos.lerp(_boardPos, 1-k);
    const f = Math.min(1, dt*cfg.ease*1.5);
    controls.target.lerp(_cineTarget, f);
    camera.position.lerp(_cinePos, f);
    camera.lookAt(controls.target);
    if(!cam.punchActive){
      camera.fov += (BASE_FOV - camera.fov) * Math.min(1, dt*3);
      camera.updateProjectionMatrix();
    }
    return true;
  }

  /* ---- coup de caméra (champ de vision, jamais la position) ---- */
  let punchGen = 0, punchBase = null;
  function cameraPunch(strength){
    if(reduceMotion) return;
    const k = Math.min(2.4, strength || 1);
    const gen = ++punchGen;
    if(punchBase === null) punchBase = camera.fov;
    const baseFov = punchBase;
    const punchFov = baseFov*(1 - 0.055*k);
    const start = performance.now();
    const outDur=120, holdDur=70, inDur=300, total=outDur+holdDur+inDur;
    cam.punchActive = true;
    function step(now){
      if(gen !== punchGen) return;
      const el = Math.max(0, now-start);
      if(el>=total){ camera.fov = baseFov; camera.updateProjectionMatrix(); cam.punchActive = false; punchBase = null; return; }
      let fov;
      if(el<outDur) fov = baseFov + (punchFov-baseFov)*(el/outDur);
      else if(el<outDur+holdDur) fov = punchFov;
      else fov = punchFov + (baseFov-punchFov)*((el-outDur-holdDur)/inDur);
      camera.fov = fov; camera.updateProjectionMatrix();
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* à appeler chaque image : caméra cinéma, sinon contrôles + garde-fou */
  function update(dt, playerRoot){
    if(!updateCineCam(dt, playerRoot)){
      controls.update();
      updateCornerSafety(dt);
    }
  }
  function setGameStarted(on){
    cam.gameStarted = on;
    controls.autoRotate = on ? false : !reduceMotion;
    if(on) clearTimeout(idleTimer);
  }
  return Object.assign(cam, { fitCameraToAspect, cineBegin, cineEnd, cameraPunch, update, setGameStarted });
}
