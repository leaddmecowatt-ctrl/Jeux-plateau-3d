/* Orage du champion (ETB), 4,3 s : le décor s'assombrit, la caméra tourne
   autour du pion, la foudre frappe sa case en rafale (éclairs 3D ramifiés,
   flash des lumières, onde sur les cases, étincelles, tonnerre, coups de
   caméra), puis une colonne de lumière dorée monte avec une pluie d'or,
   jusqu'au flash blanc qui révèle le lot. */
import * as THREE from 'three';
import { makeBeamTexture } from '../textures.js';
import { playThunder, playRiser } from '../../ui/son.js';

export const STORM_MS = 4300;
const STRIKES = [0.45, 0.95, 1.35, 1.68, 1.95, 2.18];

/* deps : { lumieres, cam, etincelles, pluieOr, pion, goldDotTex,
            flashImpact(), flashBlast() } */
export function creerOrage(sc, deps){
  const { scene, renderer, clock, reduceMotion } = sc;
  const { lumieres, cam, etincelles, pluieOr, pion, goldDotTex } = deps;
  let storm = null, beamMesh = null, beamLight = null;
  const waves = [];
  const beamTex = makeBeamTexture();
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map:goldDotTex, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, opacity:0 }));
  flash.position.set(0, 0.4, 0);
  scene.add(flash);

  function waveOffset(tile, t){
    if(!waves.length) return 0;
    let y = 0;
    for(const w of waves){
      const age = t - w.t0;
      if(age < 0 || age > 2.4) continue;
      const d = Math.hypot(tile.world.x - w.x, tile.world.z - w.z);
      const u = d - age*7.5;
      if(u > 1.2 || u < -2.2) continue;
      const env = Math.exp(-age*1.2) * Math.exp(-Math.max(0, d-1.2)*0.1);
      y += (Math.exp(-u*u*1.8) - 0.45*Math.exp(-(u+1.0)*(u+1.0)*1.8)) * 0.19 * env;
    }
    return y;
  }
  function boltPath(from, to, jitter){
    const pts = [from.clone()]; const n = 9;
    for(let i=1;i<n;i++){
      const p = from.clone().lerp(to, i/n);
      const k = jitter*(1 - (i/n)*0.6);
      p.x += (Math.random()-0.5)*k; p.z += (Math.random()-0.5)*k;
      pts.push(p);
    }
    pts.push(to.clone());
    const path = new THREE.CurvePath();
    for(let i=0;i<pts.length-1;i++) path.add(new THREE.LineCurve3(pts[i], pts[i+1]));
    return { path, pts };
  }
  function boltMat(color, opacity){ return new THREE.MeshBasicMaterial({ color, transparent:true, opacity, blending:THREE.AdditiveBlending, depthWrite:false }); }
  function spawnBolt(tx, ty, tz){
    if(!storm) return;
    const g = new THREE.Group();
    const from = new THREE.Vector3(tx + (Math.random()-0.5)*5, 8.5, tz + (Math.random()-0.5)*5);
    const to = new THREE.Vector3(tx, ty, tz);
    const main = boltPath(from, to, 1.7);
    const add = (path, segs, r, color, op)=>{
      const m = new THREE.Mesh(new THREE.TubeGeometry(path, segs, r, 5, false), boltMat(color, op));
      m.userData.op = op; g.add(m);
    };
    add(main.path, 72, 0.06, 0xfff9ec, 1);
    add(main.path, 72, 0.27, 0xffd36a, 0.4);
    for(let b=0;b<3;b++){
      const i = 2 + Math.floor(Math.random()*5);
      const start = main.pts[i];
      const end = start.clone().add(new THREE.Vector3((Math.random()-0.5)*3.2, -(1+Math.random()*2.4), (Math.random()-0.5)*3.2));
      add(boltPath(start, end, 0.8).path, 24, 0.03, 0xfff9ec, 0.95);
    }
    scene.add(g);
    storm.bolts.push({ g, born: clock.getElapsedTime(), life: 0.24 + Math.random()*0.1 });
  }
  function disposeBolt(b){
    scene.remove(b.g);
    b.g.traverse(o=>{ if(o.geometry) o.geometry.dispose(); if(o.material) o.material.dispose(); });
  }

  function start(tile){
    if(reduceMotion) return false;
    stop();
    const P = pion.root.position;
    const x = tile ? tile.world.x : P.x, z = tile ? tile.world.z : P.z, y = P.y;
    storm = { t0: clock.getElapsedTime(), x, y, z, strike:0, flashT:-9, bolts:[], dim:0, beamOn:false, blast:false, released:false, endT:0 };
    document.documentElement.classList.add('storm');
    cam.cineSpin = 0.5;
    cam.cineBegin('orbit');
    beamMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.44, 0.26, 7.5, 28, 1, true),
      new THREE.MeshBasicMaterial({ map: beamTex, color:0xffd27a, transparent:true, opacity:0, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide })
    );
    beamMesh.position.set(x, y + 3.75, z);
    beamMesh.scale.set(1, 0.01, 1);
    scene.add(beamMesh);
    beamLight = new THREE.PointLight(0xffd88a, 0, 11, 2);
    beamLight.position.set(x, y + 1.3, z);
    scene.add(beamLight);
    return true;
  }
  function stop(){
    if(!storm) return;
    storm.bolts.forEach(disposeBolt);
    if(beamMesh){ scene.remove(beamMesh); beamMesh.geometry.dispose(); beamMesh.material.dispose(); beamMesh = null; }
    if(beamLight){ scene.remove(beamLight); beamLight = null; }
    lumieres.reset();
    flash.material.opacity = 0;
    document.documentElement.classList.remove('storm');
    if(cam.cineMode === 'orbit') cam.cineEnd();
    waves.length = 0;
    storm = null;
  }
  function update(t, dt){
    if(!storm) return;
    const L = lumieres, B = L.base;
    const age = t - storm.t0;
    if(!storm.released) storm.dim = Math.min(1, storm.dim + dt/0.5);
    else storm.dim = Math.max(0, storm.dim - dt/1.2);
    const fl = Math.max(0, 1 - (t - storm.flashT)/0.13);
    L.key.intensity  = B.key *(1 - 0.82*storm.dim) + fl*1.6;
    L.hemi.intensity = B.hemi*(1 - 0.75*storm.dim) + fl*0.8;
    renderer.toneMappingExposure = B.expo*(1 - 0.55*storm.dim) + fl*0.7;
    L.fill.intensity = B.fill*(1 - 0.80*storm.dim);
    L.rim.intensity  = B.rim *(1 - 0.60*storm.dim) + fl*0.8;
    L.spot.intensity = B.spot*(1 - 0.70*storm.dim);
    while(!storm.released && storm.strike < STRIKES.length && age >= STRIKES[storm.strike]){
      const i = storm.strike++;
      storm.flashT = t;
      spawnBolt(storm.x, storm.y, storm.z);
      if(i >= 2) spawnBolt(storm.x, storm.y, storm.z);
      waves.push({ t0: t, x: storm.x, z: storm.z });
      etincelles.spawn(storm.x, storm.y + 0.1, storm.z, 16, 2.4, 3.4, 0.5, 0.9);
      flash.position.set(storm.x, storm.y + 0.35, storm.z);
      flash.scale.set(1.6, 1.6, 1.6);
      flash.material.opacity = 1;
      cam.cameraPunch(i%2 ? 1.2 : 2.0);
      playThunder(0.7 + i*0.06);
      if(i === 0 || i === STRIKES.length-1) deps.flashImpact();
      cam.cineSpin += 0.24;
    }
    if(!storm.beamOn && age >= 2.45){
      storm.beamOn = true;
      pluieOr.start(2.4);
      playRiser(1500);
      pion.triggerCheer(1.8);
    }
    if(beamMesh){
      let sc2 = 0, op = 0;
      if(storm.beamOn){
        const u = Math.min(1, (age - 2.45)/0.45);
        sc2 = u < 1 ? 1.25*Math.sin(u*Math.PI/2) - 0.25*u : 1;
        op = 0.55;
      }
      if(storm.released) op *= Math.max(0, 1 - (t - storm.endT)/0.9);
      beamMesh.scale.set(1 + 0.06*Math.sin(t*9), Math.max(0.01, sc2), 1 + 0.06*Math.cos(t*7));
      beamMesh.rotation.y += dt*1.6;
      beamMesh.material.opacity = op;
      if(beamLight) beamLight.intensity = 3.4*op;
      if(op > 0.3 && !storm.released) etincelles.spawn(storm.x, storm.y + 0.05, storm.z, 2, 0.9, 2.8, 0.7, 1.2);
    }
    if(flash.material.opacity > 0){
      flash.scale.multiplyScalar(1 + dt*7);
      flash.material.opacity = Math.max(0, flash.material.opacity - dt*4);
    }
    for(const b of storm.bolts){
      const a = (t - b.born)/b.life;
      const o = a >= 1 ? 0 : (Math.random() < 0.3 ? 0.35 : 1)*(1 - a*0.6);
      b.g.children.forEach(m=>{ m.material.opacity = m.userData.op*o; });
    }
    for(let i=storm.bolts.length-1;i>=0;i--){
      if(t - storm.bolts[i].born >= storm.bolts[i].life){ disposeBolt(storm.bolts[i]); storm.bolts.splice(i,1); }
    }
    if(!storm.blast && age >= STORM_MS/1000 - 0.18){ storm.blast = true; deps.flashBlast(); playThunder(1.1); cam.cameraPunch(2.4); }
    if(!storm.released && age >= STORM_MS/1000){
      storm.released = true; storm.endT = t;
      document.documentElement.classList.remove('storm');
      cam.cineEnd();
    }
    if(storm.released && storm.dim <= 0 && t - storm.endT > 1.3) stop();
  }
  return { start, stop, update, waveOffset, get actif(){ return !!storm; } };
}
