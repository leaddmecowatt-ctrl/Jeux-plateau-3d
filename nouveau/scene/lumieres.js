/* Lumières « roue de la fortune » : hémisphérique, projecteur central,
   key (avec ombres), rim, fill froide, quatre projecteurs dorés aux coins. */
import * as THREE from 'three';
import { makeFloodGlowTexture } from './textures.js';

export function ajouterLumieres(sc){
  const { scene, renderer } = sc;
  const hemi = new THREE.HemisphereLight(0xffdca0, 0x141c33, 0.68);
  scene.add(hemi);
  const spot = new THREE.PointLight(0xffe9c2, 0.7, 9, 2);
  spot.position.set(0, 3.2, 0);
  scene.add(spot);
  const key = new THREE.DirectionalLight(0xfff2df, 1.15);
  key.position.set(4.2,7,3.4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024,1024);
  key.shadow.camera.left = -7; key.shadow.camera.right = 7;
  key.shadow.camera.top = 7; key.shadow.camera.bottom = -7;
  key.shadow.camera.near = 1; key.shadow.camera.far = 20;
  key.shadow.bias = -0.0025;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffcf6b, 0.55);
  rim.position.set(-5,4,-4);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0x9db8ff, 0.6);
  fill.position.set(-4,2.5,3.2);
  scene.add(fill);

  const glowTex = makeFloodGlowTexture();
  [[7.5,7.5],[-7.5,7.5],[7.5,-7.5],[-7.5,-7.5]].forEach(([x,z])=>{
    const mat = new THREE.SpriteMaterial({map:glowTex,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,opacity:.6});
    const glow = new THREE.Sprite(mat);
    glow.position.set(x,4.6,z);
    glow.scale.set(1.9,1.9,1.9);
    scene.add(glow);
    const pl = new THREE.PointLight(0xffe3ae, 0.32, 12, 2);
    pl.position.set(x,4.2,z);
    scene.add(pl);
  });

  /* Lumière de contour du pion : un point chaud placé derrière lui par rapport
     à la caméra, mis à jour chaque image (suivrePion). Courte portée : elle ne
     touche que le personnage. */
  const rimPion = new THREE.PointLight(0xffe2b0, 1.6, 2.6, 2);
  scene.add(rimPion);
  const _dir = new THREE.Vector3();
  function suivrePion(pionPos, cameraPos){
    _dir.subVectors(pionPos, cameraPos); _dir.y = 0; _dir.normalize();
    rimPion.position.set(pionPos.x + _dir.x*0.9, pionPos.y + 1.15, pionPos.z + _dir.z*0.9);
  }

  const base = { key: key.intensity, hemi: hemi.intensity, fill: fill.intensity, rim: rim.intensity, spot: spot.intensity, expo: renderer.toneMappingExposure };
  return { key, hemi, fill, rim, spot, rimPion, suivrePion, base,
    /* remet toutes les intensités à leur valeur d'origine (fin d'orage) */
    reset(){
      key.intensity = base.key; hemi.intensity = base.hemi; fill.intensity = base.fill;
      rim.intensity = base.rim; spot.intensity = base.spot; renderer.toneMappingExposure = base.expo;
    },
  };
}
