/* Impact à l'arrivée sur une case (anneau qui s'ouvre + flash au sol,
   intensité selon le niveau du lot) et secousse du plateau des gros lots. */
import * as THREE from 'three';

export function creerImpacts(sc, boardGroup){
  const shockRing = new THREE.Mesh(
    new THREE.RingGeometry(0.40, 0.50, 48),
    new THREE.MeshBasicMaterial({color:0xffe9ae, transparent:true, opacity:0, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide})
  );
  shockRing.rotation.x = -Math.PI/2; shockRing.visible = false;
  sc.scene.add(shockRing);
  const impactGlow = new THREE.Mesh(
    new THREE.CircleGeometry(0.62, 32),
    new THREE.MeshBasicMaterial({color:0xffd98a, transparent:true, opacity:0, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide})
  );
  impactGlow.rotation.x = -Math.PI/2; impactGlow.visible = false;
  sc.scene.add(impactGlow);
  let shockT0 = -1, shockLevel = 1;
  function winShock(tile, level){
    if(sc.reduceMotion) return;
    shockLevel = Math.max(1, level);
    shockRing.position.set(tile.world.x, tile.tileTopY + 0.04, tile.world.z);
    impactGlow.position.set(tile.world.x, tile.tileTopY + 0.03, tile.world.z);
    shockT0 = sc.clock.getElapsedTime();
    shockRing.visible = true; impactGlow.visible = true;
  }
  let shakeUntil = 0, shakeMag = 0;
  function startShake(durSec, mag){
    if(sc.reduceMotion) return;
    shakeUntil = sc.clock.getElapsedTime() + durSec;
    shakeMag = mag;
  }
  function update(t, dt){
    if(shockT0 >= 0){
      const se = t - shockT0;
      const sdur = 0.40 + shockLevel*0.10;
      if(se >= sdur){
        shockT0 = -1; shockRing.visible = false; impactGlow.visible = false; impactGlow.material.opacity = 0;
      } else {
        const k = se/sdur, fade = (1-k)*(1-k);
        const sc2 = 0.55 + k*(1.5 + shockLevel*0.6);
        shockRing.scale.set(sc2, sc2, sc2);
        shockRing.material.opacity = fade*(0.30 + shockLevel*0.14);
        const fk = Math.max(0, 1 - se/(sdur*0.35));
        impactGlow.material.opacity = fk*fk*(0.12 + shockLevel*0.07);
        const fs = 0.7 + (1-fk)*0.5;
        impactGlow.scale.set(fs, fs, fs);
      }
    }
    if(shakeUntil>0){
      if(t < shakeUntil){
        const mag = Math.min(1, (shakeUntil-t)/0.5) * shakeMag;
        boardGroup.position.set((Math.random()-0.5)*mag, 0, (Math.random()-0.5)*mag);
        boardGroup.rotation.z = (Math.random()-0.5)*mag*0.15;
      } else {
        boardGroup.position.set(0,0,0); boardGroup.rotation.z = 0; shakeUntil = 0;
      }
    }
  }
  function stop(){ shockT0 = -1; shockRing.visible = false; impactGlow.visible = false; shakeUntil = 0; boardGroup.position.set(0,0,0); boardGroup.rotation.z = 0; }
  return { winShock, startShake, update, stop };
}
