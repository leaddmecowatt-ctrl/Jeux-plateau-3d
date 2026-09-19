/* Étincelles dorées : pool de 48 sprites réutilisés (impacts, cases
   franchies, orage) et poussière d'ambiance qui monte autour du plateau. */
import * as THREE from 'three';

export function creerEtincelles(sc, brightGoldTex, perimeterPosAt){
  const POOL = 48;
  const pool = Array.from({length:POOL}, ()=>{
    const mat = new THREE.SpriteMaterial({map:brightGoldTex, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, opacity:0});
    const spr = new THREE.Sprite(mat);
    spr.visible = false;
    sc.scene.add(spr);
    return { spr, vx:0, vy:0, vz:0, life:0, maxLife:1 };
  });
  let cursor = 0;
  function spawn(x,y,z,count,spread,upSpeed,lifeMin,lifeMax){
    lifeMin = lifeMin ?? 0.45; lifeMax = lifeMax ?? 0.75;
    for(let i=0;i<count;i++){
      const p = pool[cursor];
      cursor = (cursor+1)%pool.length;
      const ang = Math.random()*Math.PI*2;
      const r = spread*(0.4+Math.random()*0.8);
      p.vx = Math.cos(ang)*r; p.vz = Math.sin(ang)*r;
      p.vy = upSpeed*(0.6+Math.random()*0.7);
      p.life = 0;
      p.maxLife = lifeMin + Math.random()*(lifeMax-lifeMin);
      p.spr.position.set(x, y, z);
      const s = 0.13+Math.random()*0.1;
      p.spr.scale.set(s,s,s);
      p.spr.material.opacity = 1;
      p.spr.visible = true;
    }
  }
  let ambientTimer = 0;
  function update(dt){
    for(const p of pool){
      if(!p.spr.visible) continue;
      p.life += dt;
      if(p.life >= p.maxLife){ p.spr.visible = false; continue; }
      p.vy -= dt*1.8;
      p.spr.position.x += p.vx*dt; p.spr.position.y += p.vy*dt; p.spr.position.z += p.vz*dt;
      p.spr.material.opacity = 1 - p.life/p.maxLife;
    }
    // poussière d'ambiance : décoration, coupée en éco
    if(sc.reduceMotion || sc.eco) return;
    ambientTimer -= dt;
    if(ambientTimer <= 0){
      ambientTimer = 0.28 + Math.random()*0.35;
      const [x,z] = perimeterPosAt(Math.random());
      const inward = 0.3+Math.random()*1.1;
      const ang = Math.atan2(-z,-x);
      spawn(x + Math.cos(ang)*inward, 0.15+Math.random()*0.25, z + Math.sin(ang)*inward, 1, 0.12, 0.32, 1.3, 2.1);
    }
  }
  function dispose(){ pool.forEach(p=>{ sc.scene.remove(p.spr); p.spr.material.dispose(); }); }
  return { spawn, update, dispose };
}
