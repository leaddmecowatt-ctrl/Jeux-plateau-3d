/* Le pion : modèle GLB (dresseur, sac à dos), rendu toon, clignement,
   couche procédurale (repos, respiration, report du poids, regard,
   réactions), marche en cinématique inverse, moteur de déplacement de
   case en case. Toutes les valeurs numériques sont celles relevées sur le
   modèle dans l'ancien jeu — ne pas les estimer à nouveau. */
import * as THREE from 'three';
import { GLTFLoader } from '../../vendor/three/examples/jsm/loaders/GLTFLoader.js';
import { N_TILES } from '../regles/plateau.js';
import { reconnaitreSquelette, mesurerJambes, viserAvec, orienterMonde } from './squelette.js';
import { relookerPeau, construireChapeau } from './relooking.js';

/* Hauteur du pion sur le plateau : celle réglée pour le modèle d'origine,
   un peu plus pour un autre modèle (présence à l'écran). */
const HAUTEUR = { kenney: 0.82, auto: 0.90 };
const PLAYER_TARGET_HEIGHT = HAUTEUR.kenney;
const RIG_BONES = [
  'Hips','Spine','Chest','UpperChest','Neck','Head',
  'LeftShoulder','RightShoulder','LeftArm','RightArm',
  'LeftForeArm','RightForeArm','LeftHand','RightHand',
  'LeftUpLeg','RightUpLeg','LeftLeg','RightLeg','LeftFoot','RightFoot',
];
const REST_POSE = {
  LeftShoulder:  { z:  0.06, x: -0.02 },
  RightShoulder: { z: -0.05, x: -0.03 },
  LeftArm:       { z: -1.50, x:  0.10, y:  0.05 },
  RightArm:      { z: -0.39, x: -1.14, y:  1.01 },
  LeftForeArm:   { x: -0.30, y:  0.12 },
  RightForeArm:  { x: -0.24, y: -0.09 },
  LeftHand:      { x: -0.12, z:  0.07 },
  RightHand:     { x: -0.09, z: -0.05 },
  Spine:         { x:  0.030 },
  Chest:         { x: -0.018 },
  UpperChest:    { x:  0.012 },
  Neck:          { x:  0.022 },
  Head:          { x:  0.014, y: -0.02 },
  LeftUpLeg:     { x: -0.02 },
  RightUpLeg:    { x:  0.01 },
  LeftLeg:       { x:  0.05 },
  RightLeg:      { x:  0.04 },
};
const RIG = { ankle:-1.0, hipsZ:0.022, clear:-0.002, toeIn:0.12, symL:0.135, symR:0.09, restLX:0.10, restRX:-1.14 };
/* Géométrie de la foulée : source unique pour la trajectoire du pied et
   l'avance de la phase (sinon le pied patine). 3 pas par case. */
const GAIT = {
  thigh: 0.1509, shin: 0.1746, hipY: 0.3668, footY: 0.0492,
  get reach(){ return (this.thigh + this.shin) * 0.995; },
  crouch: sp => (0.033 + 0.003*sp),
  rise: 0.026,
  footL: 0.085, footA: 0.663,
  duty:   sp => 0.42,
  lift:   sp => 0.035 + 0.025*sp,
  tilt: 0.25, curv: 0.7, curvC: -0.05,
  get clearance(){ return RIG.clear; },
  ext(sp){
    const gh = this.hipY - this.footY - this.crouch(sp);
    const r = this.reach * 0.985;
    const geo = Math.sqrt(Math.max(1e-4, r*r - gh*gh));
    return Math.min(geo, this.duty(sp)/3);
  },
  stride(sp){ return 2*this.ext(sp)/this.duty(sp); },
  standPose(){
    const d = Math.min(this.hipY - this.footY, this.reach);
    const c1 = (this.thigh*this.thigh + this.shin*this.shin - d*d)/(2*this.thigh*this.shin);
    const knee = Math.PI - Math.acos(Math.max(-1, Math.min(1, c1)));
    const c2 = (this.thigh*this.thigh + d*d - this.shin*this.shin)/(2*this.thigh*d);
    const hip = Math.acos(Math.max(-1, Math.min(1, c2)));
    return { hip, knee };
  },
};
const REACTIONS = {
  1: { dur:1.10, arm:0.00, nod:0.055, hop:0.000, hops:0 },
  2: { dur:1.25, arm:0.10, nod:0.075, hop:0.000, hops:0 },
  3: { dur:1.45, arm:0.26, nod:0.090, hop:0.022, hops:1 },
  4: { dur:1.70, arm:0.42, nod:0.105, hop:0.038, hops:2 },
  5: { dur:1.95, arm:0.55, nod:0.120, hop:0.050, hops:2 },
};
const WALK_V_MIN = 1.50, WALK_V_MAX = 2.05;

function smoothNoise(t, seed){
  return (Math.sin(t*0.6180 + seed*1.7) * 0.55 + Math.sin(t*0.2411 + seed*4.1) * 0.30 + Math.sin(t*1.1279 + seed*2.3) * 0.15);
}
function bell(u){ if(u <= 0 || u >= 1) return 0; const s = Math.sin(u*Math.PI); return s*s; }
function smoothstep(a, b, v){ const k = Math.max(0, Math.min(1, (v-a)/(b-a))); return k*k*(3-2*k); }
function findBone(root, name){
  let found = null;
  root.traverse(o=>{ if(!found && o.isBone && o.name===name) found = o; });
  return found;
}

/* Clignement : les yeux sont peints dans la texture ; on repeint un
   rectangle couleur peau par-dessus, à intervalles irréguliers. */
function setupBlink(material, srcTexture){
  const img = srcTexture.image;
  if(!img || !img.width) return { update(){} };
  const w = img.width, h = img.height;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = srcTexture.colorSpace; tex.flipY = srcTexture.flipY;
  tex.wrapS = srcTexture.wrapS; tex.wrapT = srcTexture.wrapT;
  material.map = tex; material.needsUpdate = true;
  const EYES = [ {x0:0.1695, y0:0.1293, x1:0.3066, y1:0.2343}, {x0:0.3574, y0:0.1293, x1:0.4945, y1:0.2343} ];
  const SKIN = '#eeac84';
  let closed = false;
  function setClosed(v){
    if(v===closed) return;
    closed = v;
    ctx.drawImage(img, 0, 0, w, h);
    if(v){ ctx.fillStyle = SKIN; EYES.forEach(e=>ctx.fillRect(e.x0*w, e.y0*h, (e.x1-e.x0)*w, (e.y1-e.y0)*h)); }
    tex.needsUpdate = true;
  }
  let closeFor = 0, nextIn = 1.5 + Math.random()*3, burst = 0;
  return {
    update(dt){
      if(closeFor > 0){
        closeFor -= dt;
        if(closeFor <= 0){
          setClosed(false);
          if(burst > 0){ burst--; nextIn = 0.10 + Math.random()*0.06; }
          else nextIn = 1.1 - Math.log(Math.random() + 1e-6) * 2.6;
        }
        return;
      }
      nextIn -= dt;
      if(nextIn <= 0){
        setClosed(true);
        closeFor = 0.075 + Math.random()*0.055;
        if(burst === 0 && Math.random() < 0.18) burst = 1;
      }
    },
  };
}

export function creerPion(sc){
  const { scene, clock, reduceMotion } = sc;
  const root = new THREE.Group();
  scene.add(root);
  /* Ombre de contact : un disque doux sous les pieds, qui suit le pion. Les
     ombres portées seules laissent le personnage « posé » sur la case sans
     l'y ancrer. */
  {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64,64,4,64,64,64);
    grad.addColorStop(0,'rgba(0,0,0,.55)'); grad.addColorStop(0.55,'rgba(0,0,0,.25)'); grad.addColorStop(1,'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(0,0,128,128);
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(0.62,0.62), new THREE.MeshBasicMaterial({ map:new THREE.CanvasTexture(c), transparent:true, depthWrite:false }));
    disc.rotation.x = -Math.PI/2; disc.position.y = 0.012; disc.renderOrder = 1;
    root.add(disc);
  }
  const pion = {
    root, model: null, bones: null,
    mixer: { update(){} }, setWalking(){}, updateBody(){}, resetBind: null,
    topOffset: PLAYER_TARGET_HEIGHT,
    walk: null, restTile: null, baseY: 0,
  };

  /* ---------- regard ---------- */
  const _lookTarget = new THREE.Vector3(), _lookTmp = new THREE.Vector3();
  let lookActive = false, lookUntil = 0, lookWeight = 0;
  let glanceYaw = 0, glancePitch = 0, glanceNext = 3, glanceUp = 0, glanceEncore = 0;
  let gazeYaw = 0, gazePitch = 0, gazeYawV = 0, gazePitchV = 0;
  function lookAtPoint(x, y, z, holdSec){
    _lookTarget.set(x, y, z); lookActive = true;
    lookUntil = clock.getElapsedTime() + (holdSec || 1.6);
  }
  function lookAtTile(tile, holdSec){ if(tile) lookAtPoint(tile.world.x, tile.tileTopY + 0.55, tile.world.z, holdSec); }

  /* ---------- réactions ---------- */
  let reactT0 = -1, reactSpec = null;
  let reactArm = 0, reactNod = 0, reactWave = 0, reactHopY = 0;
  function triggerReaction(level){
    if(reduceMotion) return;
    reactSpec = REACTIONS[Math.max(1, Math.min(5, Math.round(level)))] || REACTIONS[1];
    reactT0 = clock.getElapsedTime();
  }
  function triggerCheer(strength){ triggerReaction(Math.round(2 + (strength || 1) * 1.9)); }
  function updateReaction(t){
    if(reactT0 < 0) return;
    const s = reactSpec;
    const u = (t - reactT0) / s.dur;
    if(u >= 1){ reactT0 = -1; reactArm = 0; reactNod = 0; reactWave = 0; reactHopY = 0; return; }
    const antic = u < 0.13 ? -Math.sin(u/0.13 * Math.PI) * 0.30 : 0;
    const rise  = smoothstep(0.08, 0.34, u) * (1 - smoothstep(0.62, 1.0, u));
    reactArm = s.arm * (rise + antic*0.5);
    reactNod = s.nod * (rise + antic);
    reactWave = Math.sin(u*Math.PI*3.7) * 0.16 + 0.09;
    if(s.hops > 0){
      const hopPhase = u * s.hops * 1.9;
      const k = hopPhase < s.hops ? Math.abs(Math.sin(hopPhase*Math.PI)) : 0;
      reactHopY = k * s.hop * (1 - u*0.35);
    } else reactHopY = 0;
  }

  /* ---------- calibrage : sommet et pieds ---------- */
  let topSamples = 0, topSkip = 0, footCalSamples = 0, footCalDone = false;
  function measure(){
    if(topSamples >= 60 || !root.children.length) return;
    if(topSkip-- > 0) return;
    topSkip = 7; topSamples++;
    let maxY = -Infinity, minY = Infinity;
    root.updateWorldMatrix(true, true);
    root.traverse(o=>{
      if(!o.isSkinnedMesh) return;
      if(typeof o.computeBoundingBox === 'function') o.computeBoundingBox();
      const src = o.boundingBox || o.geometry.boundingBox;
      if(!src) return;
      const bb = src.clone().applyMatrix4(o.matrixWorld);
      if(bb.max.y > maxY) maxY = bb.max.y;
      if(bb.min.y < minY) minY = bb.min.y;
    });
    if(maxY > -Infinity) pion.topOffset = Math.max(pion.topOffset, maxY - root.position.y);
    if(!footCalDone && !pion.walk && minY < Infinity && pion.model){
      const sole = minY - root.position.y;
      pion.model.position.y -= sole * 0.6;
      if(pion.bones && pion.bones.LeftFoot && pion.bones.LeftUpLeg){
        const v = new THREE.Vector3();
        root.updateWorldMatrix(true, true);
        pion.bones.LeftUpLeg.getWorldPosition(v); GAIT.hipY = v.y - root.position.y;
        pion.bones.LeftFoot.getWorldPosition(v);  GAIT.footY = v.y - root.position.y;
      }
      if(++footCalSamples >= 14) footCalDone = true;
    }
  }

  /* ---------- la couche procédurale du corps ---------- */
  function buildBodyLayer(bones, blink, profil){
    const auto = profil.mode !== 'kenney';
    const bind = {};
    for(const n of RIG_BONES){ const b = bones[n]; if(b) bind[n] = { q: b.quaternion.clone(), py: b.position.y }; }
    const restQ = {};
    REST_POSE.LeftArm.x = RIG.restLX; REST_POSE.RightArm.x = RIG.restRX;
    /* Mode auto : la pose de repos des bras et les corrections propres au rig
       Kenney ne s'appliquent pas ; les membres sont orientés dans le monde
       (voir viserMembres), donc sans hypothèse sur leurs axes. */
    const MEMBRES = new Set(['LeftArm','RightArm','LeftForeArm','RightForeArm','LeftHand','RightHand','LeftUpLeg','RightUpLeg','LeftLeg','RightLeg','LeftFoot','RightFoot']);
    for(const n of RIG_BONES){
      const r = (auto && MEMBRES.has(n)) ? null : REST_POSE[n];
      restQ[n] = r ? new THREE.Quaternion().setFromEuler(new THREE.Euler(r.x||0, r.y||0, r.z||0, 'XYZ')) : null;
    }
    /* orientation de liaison des pieds dans le repère du pion (mode auto) */
    const footBindQ = {};
    if(auto){
      root.updateWorldMatrix(true, true);
      const rq = root.getWorldQuaternion(new THREE.Quaternion()).invert();
      for(const n of ['LeftFoot','RightFoot']) if(bones[n]) footBindQ[n] = rq.clone().multiply(bones[n].getWorldQuaternion(new THREE.Quaternion()));
    }
    const _rootQ = new THREE.Quaternion(), _tq = new THREE.Quaternion(), _pitchQ = new THREE.Quaternion(), _X = new THREE.Vector3(1,0,0);
    const _joint = new THREE.Vector3(), _target = new THREE.Vector3(), _dir = new THREE.Vector3();
    const jointLocal = b => root.worldToLocal(b.getWorldPosition(_joint));
    /* Bras visé dans le monde : `a` = balancement vers l'avant (rad), `b` =
       flexion du coude, `out` = écartement latéral. */
    function viserBras(side, a, b, out){
      const arm = bones[side+'Arm'], fore = bones[side+'ForeArm'], hand = bones[side+'Hand'];
      if(!arm || !fore) return;
      root.updateWorldMatrix(true, false);
      const sx = Math.sign(jointLocal(arm).x) || (side==='Left' ? 1 : -1);
      _dir.set(sx*out, -Math.cos(a), Math.sin(a) + 0.03).normalize();
      _target.copy(jointLocal(arm)).add(_dir);
      viserAvec(arm, fore, root.localToWorld(_target));
      if(!hand) return;
      _dir.set(sx*out*0.6, -Math.cos(a+b), Math.sin(a+b)).normalize();
      _target.copy(jointLocal(fore)).add(_dir);
      viserAvec(fore, hand, root.localToWorld(_target));
    }
    /* Jambe visée dans le monde à partir de la pose calculée (dz, dy : pied
       par rapport à la hanche ; hipA : angle de la cuisse depuis la verticale). */
    function viserJambe(side, pose){
      const up = bones[side+'UpLeg'], leg = bones[side+'Leg'], foot = bones[side+'Foot'];
      if(!up || !leg || !foot) return;
      root.updateWorldMatrix(true, false);
      const h = jointLocal(up).clone();
      _target.set(h.x, h.y - Math.cos(pose.hip)*GAIT.thigh, h.z + Math.sin(pose.hip)*GAIT.thigh);
      viserAvec(up, leg, root.localToWorld(_target.clone()));
      _target.set(h.x, h.y - pose.dy, h.z + pose.dz);
      viserAvec(leg, foot, root.localToWorld(_target.clone()));
      // semelle à plat (orientation de liaison), inclinée du tangage du pas
      root.getWorldQuaternion(_rootQ);
      _pitchQ.setFromAxisAngle(_X, pose.pitch);
      _tq.copy(_rootQ).multiply(_pitchQ).multiply(footBindQ[side+'Foot']);
      orienterMonde(foot, _tq);
    }
    const _qA = new THREE.Quaternion(), _qB = new THREE.Quaternion(), _eA = new THREE.Euler(0,0,0,'XYZ');
    const d = {};
    const resetDeltas = ()=>{ for(const n of RIG_BONES) d[n] = { x:0, y:0, z:0, py:0 }; };
    const add = (n, ax, v)=>{ if(d[n]) d[n][ax] += v; };
    const armFwd = (side, s)=>{ if(side==='L') add('LeftArm','x', s); else { add('RightArm','x', -0.86*s); add('RightArm','z', 0.55*s); } };
    const elbowFwd = (side, b)=>{
      if(side==='L') add('LeftForeArm','x', b);
      else { add('RightForeArm','x', -0.80*b); add('RightForeArm','z', 0.63*b); add('RightForeArm','y', -0.85*b); }
    };
    const LEG_DIR = -1, KNEE_DIR = 1, LEG_THIGH = GAIT.thigh, LEG_SHIN = GAIT.shin;
    const CLIP_WEIGHT_IDLE = { LeftArm:0.10, RightArm:0.10, LeftForeArm:0.16, RightForeArm:0.16, LeftHand:0.22, RightHand:0.22, LeftShoulder:0.30, RightShoulder:0.30, Neck:0.55, Head:0.45 };
    const CLIP_WEIGHT_WALK = { LeftArm:0.22, RightArm:0.22, LeftForeArm:0.28, RightForeArm:0.28, LeftHand:0.35, RightHand:0.35, LeftShoulder:0.45, RightShoulder:0.45,
      Spine:0.7, Chest:0.7, UpperChest:0.7, Neck:0.5, Head:0.4, LeftUpLeg:0, RightUpLeg:0, LeftLeg:0, RightLeg:0, LeftFoot:0, RightFoot:0, Hips:0 };
    let breathPhase = Math.random()*10, weightSide = 0, weightTarget = 0, weightNext = 2 + Math.random()*3, postureT = 0, lastT = 0;
    pion.resetBind = function(){
      for(const n of RIG_BONES){ const b = bones[n], bd = bind[n]; if(b && bd){ b.quaternion.copy(bd.q); b.position.y = bd.py; } }
    };
    return function updateBody(t, ctx){
      const dt = Math.max(0, Math.min(0.05, t - lastT));
      lastT = t;
      resetDeltas();
      if(!auto){ add('LeftFoot','z', RIG.toeIn); add('RightFoot','z', -RIG.toeIn); }
      const walking = ctx.walking, gait = ctx.gait || 0, stepPh = ctx.stepPhase || 0;
      let autoLegs = null;
      const autoArms = { L:{ a:0.02, b:0.22, out:0.12 }, R:{ a:0.02, b:0.22, out:0.12 } };
      // 1. respiration
      breathPhase += dt * (0.26 + gait*0.22);
      const breath = Math.sin(breathPhase*Math.PI*2) * 0.55 + Math.sin(breathPhase*Math.PI*2*2.03 + 1.1) * 0.18;
      add('Chest','x', breath*0.019); add('UpperChest','x', -breath*0.009); add('Spine','x', breath*0.006);
      add('LeftShoulder','z', breath*0.012); add('RightShoulder','z', -breath*0.010);
      if(!auto){ add('LeftArm','x', RIG.symL); add('RightArm','x', RIG.symR); }
      // 2. report du poids
      if(!walking){
        weightNext -= dt;
        if(weightNext <= 0){ weightTarget = (Math.random()<0.5 ? -1 : 1) * (0.35 + Math.random()*0.65); weightNext = 2.6 + Math.random()*4.5; }
      } else weightTarget = 0;
      weightSide += (weightTarget - weightSide) * Math.min(1, dt*1.1);
      const w = weightSide * (1 - gait);
      add('Hips','z', w*0.045); add('Hips','y', w*0.02);
      d.Hips.py += -Math.abs(w)*0.004 + Math.abs(breath)*0.002;
      add('Spine','z', -w*0.022); add('Chest','z', -w*0.012); add('Neck','z', w*0.010);
      add(w > 0 ? 'LeftLeg' : 'RightLeg', 'x', Math.abs(w)*0.10);
      add(w > 0 ? 'LeftUpLeg' : 'RightUpLeg', 'x', -Math.abs(w)*0.03);
      add('LeftArm','z', -w*0.030); add('RightArm','z', -w*0.028);
      // 3. corrections posturales
      postureT += dt;
      const pn = postureT * 0.55;
      add('Spine','x', smoothNoise(pn, 1)*0.010); add('Spine','y', smoothNoise(pn, 2)*0.014); add('Chest','y', smoothNoise(pn, 3)*0.010);
      add('Neck','x', smoothNoise(pn, 4)*0.012); add('Neck','y', smoothNoise(pn, 5)*0.016);
      add('LeftForeArm','x', smoothNoise(pn, 6)*0.020); add('RightForeArm','x', smoothNoise(pn, 7)*0.018);
      add('LeftHand','z', smoothNoise(pn, 8)*0.030); add('RightHand','z', smoothNoise(pn, 9)*0.026);
      // 4. regard
      let wantYaw = 0, wantPitch = 0;
      if(lookActive && t < lookUntil && bones.Head){
        bones.Head.updateWorldMatrix(true, false);
        _lookTmp.setFromMatrixPosition(bones.Head.matrixWorld);
        const dx = _lookTarget.x - _lookTmp.x, dy = _lookTarget.y - _lookTmp.y, dz = _lookTarget.z - _lookTmp.z;
        const horiz = Math.max(0.001, Math.hypot(dx, dz));
        const worldYaw = Math.atan2(dx, dz);
        wantYaw = Math.atan2(Math.sin(worldYaw - ctx.bodyYaw), Math.cos(worldYaw - ctx.bodyYaw));
        wantPitch = -Math.atan2(dy, horiz);
        lookWeight += (1 - lookWeight) * Math.min(1, dt*4.5);
      } else {
        if(lookActive && t >= lookUntil) lookActive = false;
        lookWeight += (0 - lookWeight) * Math.min(1, dt*2.2);
        glanceNext -= dt;
        if(glanceNext <= 0){
          const r = Math.random();
          if(glanceEncore > 0){ glanceEncore--; glanceYaw *= 1.25 + Math.random()*0.3; glancePitch *= 1.15 + Math.random()*0.25; glanceNext = 1.1 + Math.random()*1.4; }
          else if(r < 0.42){ glancePitch = -(0.26 + Math.random()*0.24); glanceYaw = (Math.random()*2-1) * 0.70; glanceNext = 1.9 + Math.random()*1.6; if(Math.random() < 0.45) glanceEncore = 1; }
          else if(r < 0.68){ glancePitch = 0.18 + Math.random()*0.16; glanceYaw = (Math.random()*2-1) * 0.35; glanceNext = 1.2 + Math.random()*1.0; }
          else if(r < 0.94){ glancePitch = -0.05 + Math.random()*0.14; glanceYaw = (Math.random()*2-1) * 0.88; glanceNext = 1.0 + Math.random()*1.5; if(Math.random() < 0.3) glanceEncore = 1; }
          else { glanceYaw *= 0.12; glancePitch *= 0.15; glanceNext = 1.4 + Math.random()*1.8; }
          glanceYaw = Math.max(-0.95, Math.min(0.95, glanceYaw));
          glancePitch = Math.max(-0.52, Math.min(0.40, glancePitch));
        }
        wantYaw = glanceYaw; wantPitch = glancePitch;
      }
      if(walking){ wantYaw *= 0.35; wantPitch = wantPitch*0.3 - 0.02; }
      const kSpring = 26, kDamp = 9.5;
      gazeYawV   += ((wantYaw   - gazeYaw)   * kSpring - gazeYawV   * kDamp) * dt;
      gazePitchV += ((wantPitch - gazePitch) * kSpring - gazePitchV * kDamp) * dt;
      gazeYaw = Math.max(-0.95, Math.min(0.95, gazeYaw + gazeYawV * dt));
      gazePitch = Math.max(-0.52, Math.min(0.40, gazePitch + gazePitchV * dt));
      add('Head','y', gazeYaw*0.62); add('Head','x', gazePitch*0.66);
      add('Neck','y', gazeYaw*0.28); add('Neck','x', gazePitch*0.26);
      add('Chest','y', gazeYaw*0.09); add('UpperChest','y', gazeYaw*0.07);
      add('Head','z', -gazeYaw*0.10);
      const versLeHaut = Math.max(0, -gazePitch);
      glanceUp += (versLeHaut - glanceUp) * Math.min(1, dt*3.5);
      if(!walking){
        add('Chest','x', glanceUp*0.17); add('UpperChest','x', glanceUp*0.13); add('Spine','x', glanceUp*0.07); add('Hips','x', -glanceUp*0.04);
        add('LeftArm','z', -glanceUp*0.07); add('RightArm','z', glanceUp*0.07);
      }
      // 5. marche : jambes en cinématique inverse
      if(gait > 0.001){
        const ph = stepPh * Math.PI * 2;
        const sw = Math.sin(ph), st = Math.sin(ph*2);
        const sp = ctx.speedK || 0;
        const gh = GAIT.hipY - GAIT.footY - (ctx.crouch != null ? ctx.crouch : GAIT.crouch(sp));
        const stand = GAIT.standPose();
        const LEG_HIP0 = stand.hip, LEG_KNEE0 = stand.knee, LEG_SHIN0 = LEG_HIP0 - LEG_KNEE0;
        const reach = GAIT.reach, ext = GAIT.ext(sp), lift = GAIT.lift(sp), duty = GAIT.duty(sp);
        const solve = (dz, dy)=>{
          let dd = Math.hypot(dz, dy);
          dd = Math.min(dd, reach);
          const c1 = (LEG_THIGH*LEG_THIGH + LEG_SHIN*LEG_SHIN - dd*dd)/(2*LEG_THIGH*LEG_SHIN);
          const knee = Math.PI - Math.acos(Math.max(-1, Math.min(1, c1)));
          const c2 = (LEG_THIGH*LEG_THIGH + dd*dd - LEG_SHIN*LEG_SHIN)/(2*LEG_THIGH*dd);
          const hip = Math.atan2(dz, dy) + Math.acos(Math.max(-1, Math.min(1, c2)));
          return { hip, knee };
        };
        const amp = Math.max(0.30, gait);
        const extN = ext * amp, liftN = lift * amp;
        const legPose = (off)=>{
          const tt = ((stepPh + off) % 1 + 1) % 1;
          let dz, up;
          if(tt < duty){ dz = extN - 2*extN*(tt/duty); up = 0; }
          else {
            const u = (tt - duty)/(1 - duty);
            const e = u*u*(3 - 2*u);
            dz = -extN + 2*extN*e;
            up = liftN*Math.sin(Math.PI*Math.pow(u, 0.72));
          }
          let pitch = 0;
          const HEEL = 0.10, TOEOFF = 0.14;
          if(tt < duty){
            if(tt < HEEL) pitch = -0.30*(1 - tt/HEEL);
            else if(tt > duty - TOEOFF){ const q=(tt-(duty-TOEOFF))/TOEOFF; pitch = 0.45*q*q; }
          } else {
            const u = (tt - duty)/(1 - duty);
            const a = Math.max(0, 1 - u/0.5), b = Math.max(0, (u-0.55)/0.45);
            pitch = 0.45*a*a - 0.30*b*b;
          }
          let ankY = 0, ankZ = 0;
          if(pitch > 0){
            ankY = GAIT.footL*(Math.sin(GAIT.footA + pitch) - Math.sin(GAIT.footA));
            ankZ = GAIT.footL*(Math.cos(GAIT.footA) - Math.cos(GAIT.footA + pitch));
          }
          dz += ankZ; up += ankY;
          const dy = auto ? gh - up : gh - (up + GAIT.clearance + GAIT.tilt*dz) + GAIT.curv*(dz-GAIT.curvC)*(dz-GAIT.curvC);
          const r = solve(dz, dy);
          return { hip: r.hip, knee: r.knee, shin: r.hip - r.knee, pitch, dz, dy };
        };
        const L = legPose(0), R = legPose(0.5);
        autoLegs = { L, R };
        add('LeftUpLeg','x',  LEG_DIR*(L.hip - LEG_HIP0)); add('RightUpLeg','x', LEG_DIR*(R.hip - LEG_HIP0));
        add('LeftLeg','x',    KNEE_DIR*(L.knee - LEG_KNEE0)); add('RightLeg','x',   KNEE_DIR*(R.knee - LEG_KNEE0));
        const ank = a => -KNEE_DIR*(a - LEG_SHIN0)*RIG.ankle;
        add('LeftFoot','x', ank(L.shin) + L.pitch); add('RightFoot','x', ank(R.shin) + R.pitch);
        add('Hips','z', sw*RIG.hipsZ*gait); add('Hips','y', sw*0.055*gait);
        add('Spine','y', -sw*0.045*gait); add('Chest','y', -sw*0.055*gait); add('UpperChest','y', -sw*0.030*gait);
        add('Chest','x', Math.abs(st)*0.020*gait);
        const legFwdL = Math.cos(stepPh*Math.PI*2);
        const armFwdL = -legFwdL, armFwdR = legFwdL;
        const armA = 0.34 + 0.12*sp, BACK = 0.75;
        const swingL = armFwdL > 0 ? armFwdL*armA : armFwdL*armA*BACK;
        const swingR = armFwdR > 0 ? armFwdR*armA : armFwdR*armA*BACK;
        armFwd('L', swingL*gait); armFwd('R', swingR*gait);
        autoArms.L.a += swingL*gait; autoArms.R.a += swingR*gait;
        autoArms.L.b += (Math.max(0, armFwdL)*0.2 + 0.75)*gait; autoArms.R.b += (Math.max(0, armFwdR)*0.2 + 0.75)*gait;
        const elbow = 0.20 + 0.15*sp;
        elbowFwd('L', (Math.max(0, armFwdL)*elbow + 1.05 + 0.15*sp)*gait);
        elbowFwd('R', (Math.max(0, armFwdR)*elbow + 1.05 + 0.15*sp)*gait);
        add('LeftShoulder','z', sw*0.020*gait); add('RightShoulder','z', sw*0.018*gait);
      }
      // 6. réaction
      if(reactArm > 0.0005 || reactNod > 0.0005){
        const a = reactArm, wv = reactWave;
        armFwd('R', a*(1 + wv)); armFwd('L', a*(1 - wv));
        autoArms.R.a += a*(1 + wv)*1.3; autoArms.L.a += a*(1 - wv)*1.3; autoArms.R.out += a*0.5; autoArms.L.out += a*0.5;
        autoArms.R.b += a*0.5; autoArms.L.b += a*0.5;
        add('RightArm','z', a*0.30); add('LeftArm','z', a*0.34);
        elbowFwd('R', a*0.55); elbowFwd('L', a*0.50);
        add('Head','x', -reactNod*1.5); add('Neck','x', -reactNod*0.8); add('Chest','x', -reactNod*0.9); add('Spine','x', -reactNod*0.4);
      }
      // application : final = slerp(bind, clip, poids) × repos × procédural
      const wTab = ctx.gait > 0.02 ? CLIP_WEIGHT_WALK : CLIP_WEIGHT_IDLE;
      for(const n of RIG_BONES){
        const b = bones[n];
        if(!b) continue;
        const bd = bind[n];
        const cw = wTab[n] != null ? wTab[n] : 1;
        _qA.copy(bd.q);
        if(cw >= 0.999) _qA.copy(b.quaternion);
        else if(cw > 0.001) _qA.slerp(b.quaternion, cw);
        if(restQ[n]) _qA.multiply(restQ[n]);
        const dn = d[n];
        if(dn.x || dn.y || dn.z){ _eA.set(dn.x, dn.y, dn.z); _qB.setFromEuler(_eA); _qA.multiply(_qB); }
        b.quaternion.copy(_qA);
        b.position.y = bd.py + dn.py;
      }
      if(auto){
        // report du poids : le bras suit un peu le bassin ; regard en l'air : bras qui s'écartent
        autoArms.L.out += -w*0.03 + glanceUp*0.07; autoArms.R.out += w*0.03 + glanceUp*0.07;
        viserBras('Left', autoArms.L.a, autoArms.L.b, autoArms.L.out);
        viserBras('Right', autoArms.R.a, autoArms.R.b, autoArms.R.out);
        if(autoLegs){ viserJambe('Left', autoLegs.L); viserJambe('Right', autoLegs.R); }
      }
      blink.update(dt);
    };
  }

  /* ---------- chargement du modèle (jamais bloquant) ---------- */
  let glbBytes = null;
  async function load(){
    /* ?modele=<url> charge un autre fichier (essai d'un nouveau personnage,
       en local par http) ; sinon le modèle livré dans le bundle. */
    const url = new URLSearchParams(location.search).get('modele') || '../assets/character/player.glb';
    const gltf = await new Promise((resolve, reject)=>{
      const b64 = window.__GLB_B64 ? window.__GLB_B64[url] : null;
      if(b64){
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for(let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
        glbBytes = bytes;
        new GLTFLoader().parse(bytes.buffer, '', resolve, reject);
      } else new GLTFLoader().load(url, resolve, undefined, reject);
    });
    const model = gltf.scene;
    const sq = reconnaitreSquelette(model);
    if(sq.manquants.length) console.error('Personnage : os introuvables, il restera immobile :', sq.manquants.join(', '));
    pion.profil = { mode: sq.mode };
    const box = new THREE.Box3().setFromObject(model);
    const rawHeight = box.max.y - box.min.y;
    const scale = rawHeight>0 ? (HAUTEUR[sq.mode] || PLAYER_TARGET_HEIGHT)/rawHeight : 1;
    model.scale.setScalar(scale);
    model.position.y = -box.min.y*scale;
    /* Rendu « figurine » : matériau standard avec l'environnement de reflets
       de la scène (déjà posé sur scene.environment) et une rugosité par
       matière — la peau mate, les cheveux satinés, la paille rugueuse. */
    const ROUGHNESS = { skin:0.72, Hair_Dark:0.5, Cap_Red:0.92, HatBand_Red:0.6, Sash_Yellow:0.7, Sandal_Sole:0.85, Sandal_Strap:0.75 };
    let blink = { update(){} }, blinkAssigned = false, skinMat = null;
    model.traverse(o=>{
      if(!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      const oldMat = o.material;
      o.userData.matName = oldMat.name;
      /* Un modèle fourni avec ses propres matériaux PBR (normales, rugosité)
         les garde : on ne fait qu'y brancher l'environnement de reflets. */
      if(sq.mode !== 'kenney' && oldMat && (oldMat.isMeshStandardMaterial || oldMat.isMeshPhysicalMaterial)){
        oldMat.envMapIntensity = 0.55;
        return;
      }
      const newMat = new THREE.MeshStandardMaterial({
        map: oldMat.map || null,
        color: oldMat.color ? oldMat.color.clone() : new THREE.Color(0xffffff),
        roughness: ROUGHNESS[oldMat.name] ?? 0.7, metalness: 0, envMapIntensity: 0.55,
      });
      o.material = newMat;
      if(oldMat.name === 'skin') skinMat = newMat;
      // clignement : zones des yeux connues pour la texture du modèle d'origine seulement
      if(sq.mode === 'kenney' && oldMat.map && oldMat.map.image && (oldMat.map.image.width || oldMat.map.image.naturalWidth) && !blinkAssigned){
        blink = relookerPeau(newMat, oldMat.map); blinkAssigned = true;
      }
    });
    /* Filet de sécurité : texture de peau rechargée depuis le data: URI du
       modèle si GLTFLoader ne l'a pas fournie (personnage tout blanc). */
    if(sq.mode === 'kenney' && !blinkAssigned && skinMat && glbBytes){
      try{
        const dv = new DataView(glbBytes.buffer, glbBytes.byteOffset, glbBytes.byteLength);
        const jsonLen = dv.getUint32(12, true);
        const json = JSON.parse(new TextDecoder().decode(glbBytes.subarray(20, 20+jsonLen)));
        const uri = json.images && json.images[0] && json.images[0].uri;
        if(uri && uri.startsWith('data:')){
          const tex = await new THREE.TextureLoader().loadAsync(uri);
          tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace;
          skinMat.map = tex; skinMat.needsUpdate = true;
          blink = relookerPeau(skinMat, tex); blinkAssigned = true;
        }
      }catch(e){ console.warn('Texture du personnage : repli impossible', e); }
    }
    root.add(model);
    pion.model = model;
    const mixer = new THREE.AnimationMixer(model);
    /* clips : par nom exact (modèle d'origine), sinon par ressemblance
       (« Idle », « Walking », « marche »…), sinon le premier clip pour le repos */
    const clip = name => THREE.AnimationClip.findByName(gltf.animations, name);
    const clipLike = re => gltf.animations.find(a => re.test(a.name));
    const idleClip = clip('idle') || clipLike(/idle|repos|stand|breath/i) || gltf.animations[0] || null;
    const walkClip = clip('walk') || clipLike(/walk|marche|run|cour/i) || null;
    const actions = { idle: idleClip && mixer.clipAction(idleClip), walk: walkClip && walkClip !== idleClip && mixer.clipAction(walkClip) };
    Object.values(actions).forEach(a=>{ if(a) a.play(); });
    if(actions.idle) actions.idle.setEffectiveWeight(1);
    if(actions.walk) actions.walk.setEffectiveWeight(0);
    let activeAction = actions.idle || actions.walk;
    if(actions.walk) actions.walk.paused = true;
    const walkDur = actions.walk ? actions.walk.getClip().duration : 1;
    pion.setWalking = function(isWalking, phase01){
      const target = isWalking ? actions.walk : actions.idle;
      if(target && target!==activeAction){
        activeAction.fadeOut(0.22);
        target.reset().fadeIn(0.22);
        if(isWalking) target.paused = true;
        activeAction = target;
      }
      if(isWalking && actions.walk){ actions.walk.paused = true; actions.walk.time = ((phase01 % 1) + 1) % 1 * walkDur; }
    };
    pion.mixer = mixer;
    const bones = sq.bones;
    pion.bones = bones;
    if(sq.mode === 'kenney' && bones.Head){
      let cap = null, band = null;
      model.traverse(o=>{ if(o.isMesh && o.material){ if(o.material.name==='Cap_Red' || (o.userData.matName==='Cap_Red')) cap = o; if(o.material.name==='HatBand_Red' || o.userData.matName==='HatBand_Red') band = o; } });
      if(cap) construireChapeau(cap, band, bones.Head, root);
      // proportions chibi : la tête (et son chapeau) plus grosse que nature
      bones.Head.scale.setScalar(1.06);
    }
    if(sq.manquants.length) return;
    if(sq.mode !== 'kenney'){
      /* mesures des jambes sur le modèle posé : remplacent les constantes
         relevées sur le modèle d'origine */
      const m = mesurerJambes(root, bones);
      Object.assign(GAIT, { thigh: m.thigh, shin: m.shin, hipY: m.hipY, footY: m.footY, footL: m.footL, footA: m.footA });
      console.info('Personnage : squelette reconnu (profil automatique), jambe ' + (m.thigh+m.shin).toFixed(3) + ', hanche ' + m.hipY.toFixed(3));
    }
    pion.updateBody = buildBodyLayer(bones, blink, pion.profil);
  }

  /* ---------- moteur de déplacement ---------- */
  let walkBank = 0, walkGait = 0, walkStepPhase = 0, walkSpeedK = 0, walkCrouch = 0;
  function placeInstant(tile){
    root.position.set(tile.world.x, tile.tileTopY, tile.world.z);
    pion.baseY = tile.tileTopY;
    pion.restTile = tile;
  }
  /* Une seule allure, de la marche à la course selon la longueur du
     trajet ; rampes de 0,3 case au départ et à l'arrivée. `hooks` :
     onSegment(index, tile), onArrive(index, tile). */
  function startWalk(fromIdx, count, stepDuration, tiles, hooks, cam){
    const startPos = fromIdx === -1 ? 0 : fromIdx;
    const dir = count >= 0 ? 1 : -1;
    const n = dir>0 ? Math.abs(count) : Math.min(Math.abs(count), startPos);
    const path = [ tiles[startPos] ], indices = [ fromIdx ];
    let idx = startPos, steps = 0;
    for(let i=0;i<n;i++){ idx = dir>0 ? (idx+1)%N_TILES : idx-1; path.push(tiles[idx]); indices.push(idx); steps++; }
    const forcedFast = stepDuration < 0.42;
    if(!forcedFast && steps > 0){ const v = Math.min(WALK_V_MAX, WALK_V_MIN + (steps-1)*0.20); stepDuration = 1/v; }
    const vCruise = steps>0 ? 1/stepDuration : 0;
    const rampUnits = Math.min(0.3, steps/2);
    const accelTime = rampUnits>0 ? (2*rampUnits)/vCruise : 0;
    const cruiseTime = vCruise>0 ? (steps - 2*rampUnits)/vCruise : 0;
    const prepTime = steps>0 ? 0.22 : 0, settleTime = steps>0 ? 0.34 : 0;
    const moveTime = Math.max(0.001, accelTime*2+cruiseTime);
    pion.walk = {
      path, indices, steps, vCruise, rampUnits, accelTime, cruiseTime, prepTime, settleTime, moveTime,
      totalTime: prepTime + moveTime + settleTime,
      t0: clock.getElapsedTime(), lastSeg:-1, phase: 0.25, prevDist: 0, announced: false, hooks, reactAt: 0, reactLevel: 1,
    };
    if(steps>0){ lookAtTile(path[path.length-1], prepTime + moveTime*0.5); cam.cineBegin('travel'); }
    return pion.walk;
  }
  function stopWalk(){ pion.walk = null; walkGait = 0; }

  /* Mise à jour par image. `surfOffset(tile)` : hauteur courante de la
     carte ; `fx` : { spawnSparkles, winShock, cameraPunch, playHop, setActive, cineBegin } */
  function update(t, dt, surfOffset, fx, levelOf){
    const walk = pion.walk;
    if(walk){
      const te = t - walk.t0;
      const inPrep = te < walk.prepTime;
      const tm = te - walk.prepTime;
      const inSettle = tm > walk.moveTime;
      let dist, vel;
      if(walk.steps===0 || inPrep){ dist = 0; vel = 0; }
      else if(tm >= walk.moveTime){ dist = walk.steps; vel = 0; }
      else if(walk.accelTime>0 && tm < walk.accelTime){ vel = walk.vCruise*(tm/walk.accelTime); dist = 0.5*walk.vCruise*tm*tm/walk.accelTime; }
      else if(tm < walk.accelTime+walk.cruiseTime){ vel = walk.vCruise; dist = walk.rampUnits + walk.vCruise*(tm-walk.accelTime); }
      else { const te2 = Math.max(0, walk.moveTime - tm); vel = walk.accelTime>0 ? walk.vCruise*(te2/walk.accelTime) : 0; dist = walk.steps - 0.5*walk.vCruise*te2*te2/walk.accelTime; }
      dist = Math.max(0, Math.min(walk.steps, dist));
      const spNow = Math.max(0, Math.min(1, (walk.vCruise - WALK_V_MIN)/(WALK_V_MAX - WALK_V_MIN)));
      walk.phase += Math.max(0, dist - walk.prevDist) / GAIT.stride(spNow);
      walk.prevDist = dist;
      const segIdx = Math.min(Math.floor(dist), Math.max(0,walk.steps-1));
      const localP = walk.steps>0 ? dist - segIdx : 0;
      const aTile = walk.path[segIdx], bTile = walk.path[Math.min(segIdx+1, walk.path.length-1)];
      const x = aTile.world.x + (bTile.world.x-aTile.world.x)*localP;
      const z = aTile.world.z + (bTile.world.z-aTile.world.z)*localP;
      const gaitAmp = walk.vCruise>0 ? Math.min(1, vel/walk.vCruise) : 0;
      const crouch = GAIT.crouch(spNow) * gaitAmp;
      const osc = reduceMotion ? 0 : (-Math.abs(Math.cos(walk.phase*Math.PI*2)) * GAIT.rise + GAIT.rise) * gaitAmp;
      const bob = -crouch + osc;
      let settleDip = 0;
      if(inPrep) settleDip = -Math.sin(te/walk.prepTime*Math.PI) * 0.016;
      else if(inSettle){ const u = Math.min(1, (tm - walk.moveTime)/walk.settleTime); settleDip = -Math.sin(u*Math.PI) * 0.020 * (1-u*0.3); }
      const surf = surfOffset(aTile) + (surfOffset(bTile) - surfOffset(aTile))*localP;
      root.position.set(x, aTile.tileTopY + surf + bob + settleDip, z);
      if(bTile!==aTile){
        const targetYaw = Math.atan2(bTile.world.x-aTile.world.x, bTile.world.z-aTile.world.z);
        let dyaw = targetYaw - root.rotation.y;
        dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
        const turnRate = 4.5 + 3.5*(1 - Math.min(1, Math.abs(dyaw)/1.2));
        root.rotation.y += dyaw*Math.min(1, dt*turnRate);
      }
      walkBank += (0 - walkBank) * Math.min(1, dt*8);
      root.rotation.z = walkBank;
      if(segIdx !== walk.lastSeg){
        if(walk.lastSeg >= 0){
          fx.playHop();
          if(!reduceMotion) fx.spawnSparkles(aTile.world.x, aTile.tileTopY+0.35, aTile.world.z, 7, 1.1, 2.4);
        }
        walk.lastSeg = segIdx;
        walk.hooks.onSegment(walk.indices[segIdx], aTile);
      }
      if(!reduceMotion){
        const leanTarget = -0.022*gaitAmp + (inSettle ? 0.010 : 0);
        root.rotation.x += (leanTarget - root.rotation.x)*Math.min(1,dt*8);
      }
      pion.setWalking(gaitAmp > 0.02, walk.phase);
      walkGait = gaitAmp;
      walkStepPhase = walk.phase % 1;
      walkSpeedK = spNow;
      walkCrouch = crouch - osc;
      if(!walk.announced && tm >= walk.moveTime){
        walk.announced = true;
        const landedTile = walk.path[walk.path.length-1];
        pion.baseY = landedTile.tileTopY;
        pion.restTile = landedTile;
        lookAtTile(landedTile, 2.4);
        fx.cineBegin('closeup');
        walk.hooks.onArrive(walk.indices[walk.indices.length-1], landedTile);
        if(!reduceMotion){
          const lvl = levelOf(landedTile);
          fx.spawnSparkles(landedTile.world.x, landedTile.tileTopY+0.4, landedTile.world.z, 12 + lvl*11, 1.3 + lvl*0.38, 2.9 + lvl*0.55, 0.5, 0.9);
          fx.winShock(landedTile, lvl);
          fx.cameraPunch(0.65 + lvl*0.28);
          walk.reactAt = t + walk.settleTime*0.55;
          walk.reactLevel = lvl;
        }
      }
      if(walk.reactAt && t >= walk.reactAt){ triggerReaction(walk.reactLevel); walk.reactAt = 0; }
      if(te >= walk.totalTime){ pion.walk = null; walkGait = 0; }
    } else if(!reduceMotion){
      root.rotation.x *= 0.85; root.rotation.z *= 0.85;
      walkGait += (0 - walkGait)*Math.min(1, dt*6);
      walkCrouch += (0 - walkCrouch)*Math.min(1, dt*6);
      pion.setWalking(false);
    }
    updateReaction(t);
    if(pion.resetBind) pion.resetBind();
    pion.mixer.update(dt);
    measure();
    if(!reduceMotion){
      pion.updateBody(t, { walking: walkGait > 0.02, gait: walkGait, stepPhase: walkStepPhase, speedK: walkSpeedK, crouch: walkCrouch, hop: 0, hopPhase: 0, bodyYaw: root.rotation.y });
      if(!pion.walk) root.position.y = pion.baseY + surfOffset(pion.restTile) + reactHopY;
    }
  }
  function reset(){
    root.scale.set(1,1,1); root.rotation.x = 0;
    pion.setWalking(false);
    stopWalk();
  }
  return Object.assign(pion, { load, lookAtTile, triggerReaction, triggerCheer, placeInstant, startWalk, stopWalk, update, reset });
}
