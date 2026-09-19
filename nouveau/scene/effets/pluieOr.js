/* Pluie d'or : un rideau de 150 paillettes sur toute la largeur du plateau,
   un seul appel de dessin, particules recyclées en haut au contact du sol. */
import * as THREE from 'three';

export function creerPluieOr(sc, brightGoldTex){
  const COUNT = 150;
  const pos = new Float32Array(COUNT*3);
  const vel = new Float32Array(COUNT);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    map: brightGoldTex, color: 0xffe2a0, size: 0.34, sizeAttenuation: true,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false; points.visible = false;
  sc.scene.add(points);
  let until = 0, t0 = 0;
  function seed(i, yMin, ySpan){
    pos[i*3] = (Math.random()-0.5)*11.5;
    pos[i*3+1] = yMin + Math.random()*ySpan;
    pos[i*3+2] = (Math.random()-0.5)*11.5;
    vel[i] = 1.6 + Math.random()*2.6;
  }
  function start(durSec){
    if(sc.reduceMotion) return;
    const now = sc.clock.getElapsedTime();
    until = now + durSec; t0 = now;
    for(let i=0;i<COUNT;i++) seed(i, 0.8, 6.8);
    geo.attributes.position.needsUpdate = true;
    mat.opacity = 0; points.visible = true;
  }
  function stop(){ points.visible = false; mat.opacity = 0; until = 0; }
  function update(t, dt){
    if(!points.visible) return;
    if(t >= until){ stop(); return; }
    mat.opacity = 0.95 * Math.min(1, (t-t0)/0.25) * Math.min(1, (until-t)/0.7);
    for(let i=0;i<COUNT;i++){
      const y = pos[i*3+1] - vel[i]*dt;
      if(y < 0.05) seed(i, 6.0, 2.0); else pos[i*3+1] = y;
    }
    geo.attributes.position.needsUpdate = true;
  }
  return { start, stop, update };
}
