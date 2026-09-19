/* Le plateau 3D : 36 cases (socle, collerette, corps coloré, liseré,
   rivets, photo, numéro, halo, lot flottant ou médaillon, disque d'ombre),
   plaque centrale, ornements des angles, liseré de loupiotes et loupiotes
   tournantes. Un seul InstancedMesh pour chaque pièce répétée. */
import * as THREE from 'three';
import { N_SIDE, N_TILES, ringPos, toWorld, outwardYaw, BOARD_DATA, CATS, GOLD, accentOf, MOTION, TIER_LEVEL } from '../regles/plateau.js';
import { getFlatPhotoFace, getDepartFace, getFramedPhotoTexture, getGlyphTexture, numberTexture,
         makeGlowDotTexture, makeCenterPlateTexture, makeCornerOrnamentTexture, makeHoloShineTexture } from './textures.js';

const CELL = 1, TILE = 0.95;
const RIVET_OFFSETS = [[-1,-1],[1,-1],[-1,1],[1,1]];
function makeSprite(texture, scale){
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map:texture, transparent:true, depthWrite:false }));
  spr.scale.set(scale,scale,scale);
  return spr;
}

export function construirePlateau(sc){
  const { scene, reduceMotion } = sc;
  const boardGroup = new THREE.Group();
  scene.add(boardGroup);
  const goldDotTex = makeGlowDotTexture('rgba(255,214,120,1)');
  const brightGoldTex = makeGlowDotTexture('rgba(255,245,210,1)');

  /* ---- liseré de loupiotes et loupiotes tournantes ---- */
  const trimLights = [], perimeterPts = [];
  {
    const half = (N_SIDE*CELL+0.7)/2, perEdge = 13;
    for(let i=0;i<perEdge;i++) perimeterPts.push([-half+(i/(perEdge-1))*half*2, -half]);
    for(let i=1;i<perEdge;i++) perimeterPts.push([half, -half+(i/(perEdge-1))*half*2]);
    for(let i=1;i<perEdge;i++) perimeterPts.push([half-(i/(perEdge-1))*half*2, half]);
    for(let i=1;i<perEdge-1;i++) perimeterPts.push([-half, half-(i/(perEdge-1))*half*2]);
    perimeterPts.forEach(([x,z],idx)=>{
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: goldDotTex, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, opacity:.55 }));
      spr.scale.set(0.26,0.26,0.26);
      spr.position.set(x,0.03,z);
      boardGroup.add(spr);
      trimLights.push({ spr, idx });
    });
  }
  const orbiterLights = [];
  for(let k=0;k<4;k++){
    const spr = makeSprite(brightGoldTex, 0.42);
    spr.material.blending = THREE.AdditiveBlending;
    spr.position.y = 0.04;
    boardGroup.add(spr);
    orbiterLights.push({ spr, offset:k/4 });
  }
  function perimeterPosAt(u){
    const n = perimeterPts.length;
    const f = ((u%1)+1)%1 * n;
    const i0 = Math.floor(f), i1=(i0+1)%n, lp=f-i0;
    const [x0,z0]=perimeterPts[i0], [x1,z1]=perimeterPts[i1];
    return [x0+(x1-x0)*lp, z0+(z1-z0)*lp];
  }

  /* ---- plaque centrale ---- */
  const centerPlate = new THREE.Mesh(
    new THREE.BoxGeometry((N_SIDE-2)*CELL,0.14,(N_SIDE-2)*CELL),
    new THREE.MeshStandardMaterial({map:makeCenterPlateTexture(),roughness:.7,metalness:.1,transparent:true})
  );
  centerPlate.position.y = 0.07;
  boardGroup.add(centerPlate);

  /* ---- ornements des 4 angles ---- */
  {
    const ornTex = makeCornerOrnamentTexture();
    const ornSize = 2.1, cornerHalf = (N_SIDE*CELL+0.7)/2;
    [[1,1],[-1,1],[-1,-1],[1,-1]].forEach(([sx,sz])=>{
      const orn = new THREE.Mesh(new THREE.PlaneGeometry(ornSize,ornSize), new THREE.MeshBasicMaterial({map:ornTex, transparent:true, depthWrite:false}));
      orn.rotation.x = -Math.PI/2;
      orn.rotation.z = Math.atan2(sx,sz) + Math.PI;
      orn.position.set(sx*cornerHalf, 0.025, sz*cornerHalf);
      boardGroup.add(orn);
    });
  }
  const holoShineBaseTex = makeHoloShineTexture();

  /* ---- les cases ---- */
  const tileGoldMat = new THREE.MeshStandardMaterial({ color:new THREE.Color(GOLD), roughness:.2, metalness:.9, emissive:new THREE.Color(GOLD), emissiveIntensity:.12 });
  const tileBezelMat = new THREE.MeshStandardMaterial({color:0x0a0a0a, roughness:.5, metalness:.25});
  const collarInst = new THREE.InstancedMesh(new THREE.BoxGeometry(TILE+0.09,0.07,TILE+0.09), tileGoldMat, N_TILES);
  collarInst.frustumCulled = false; boardGroup.add(collarInst);
  const bezelInst = new THREE.InstancedMesh(new THREE.BoxGeometry(TILE*0.97,0.035,TILE*0.97), tileBezelMat, N_TILES);
  bezelInst.frustumCulled = false; boardGroup.add(bezelInst);
  const rivetInst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035,0.035,0.02,8), tileGoldMat, N_TILES*RIVET_OFFSETS.length);
  rivetInst.frustumCulled = false; boardGroup.add(rivetInst);
  const dummy = new THREE.Object3D();
  const yAxis = new THREE.Vector3(0,1,0);
  const baseGeo = new THREE.BoxGeometry(TILE+0.05,0.08,TILE+0.05);
  const baseMat = new THREE.MeshStandardMaterial({color:0x050505, roughness:.6, metalness:.3});
  const faceGeo = new THREE.PlaneGeometry(TILE*0.94,TILE*0.94);
  const haloGeo = new THREE.TorusGeometry(TILE*0.56,0.035,8,32);
  const BODY_H = 0.14, BODY_BOTTOM = 0.135;
  const bodyGeo = new THREE.BoxGeometry(TILE,BODY_H,TILE);

  const tiles = [];
  for(let i=0;i<N_TILES;i++){
    const {r,c} = ringPos(i);
    const world = toWorld(r,c);
    const yaw = outwardYaw(r,c);
    const data = BOARD_DATA[i];
    const catKey = data.cat, catDef = CATS[catKey];
    const group = new THREE.Group();
    group.position.set(world.x, 0, world.z);
    group.rotation.y = yaw;
    boardGroup.add(group);

    const baseTile = new THREE.Mesh(baseGeo, baseMat);
    baseTile.position.y = 0.04; baseTile.receiveShadow = true;
    group.add(baseTile);
    const topGroup = new THREE.Group();
    group.add(topGroup);

    dummy.position.set(world.x, 0.10, world.z);
    dummy.rotation.set(0, yaw, 0);
    dummy.updateMatrix();
    collarInst.setMatrixAt(i, dummy.matrix);

    const accentColor = accentOf(catKey);
    const bodyTile = new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({
      color:new THREE.Color(accentColor),roughness:.7,metalness:.12,
      emissive:new THREE.Color(accentColor),emissiveIntensity:.32
    }));
    bodyTile.position.y = BODY_BOTTOM + BODY_H/2;
    bodyTile.castShadow = true; bodyTile.receiveShadow = true;
    topGroup.add(bodyTile);

    const BEZEL_Y = BODY_BOTTOM + BODY_H + 0.0175;
    dummy.position.set(world.x, BEZEL_Y, world.z); dummy.updateMatrix();
    bezelInst.setMatrixAt(i, dummy.matrix);
    const RIVET_Y = BEZEL_Y + 0.0195;
    const rivetPositions = [];
    RIVET_OFFSETS.forEach(([dx,dz], k)=>{
      const local = new THREE.Vector3(dx*TILE*0.40, RIVET_Y, dz*TILE*0.40).applyAxisAngle(yAxis, yaw);
      rivetPositions.push({x:world.x+local.x, z:world.z+local.z});
      dummy.position.set(world.x+local.x, local.y, world.z+local.z); dummy.updateMatrix();
      rivetInst.setMatrixAt(i*RIVET_OFFSETS.length+k, dummy.matrix);
    });
    const tileTopY = BEZEL_Y + 0.0175;

    const faceTex = i === 0 ? getDepartFace()
      : catDef.tier === 'flat' ? getFlatPhotoFace(catKey, accentColor, data.isVisite)
      : getFlatPhotoFace(catKey, accentColor, null);
    const face = new THREE.Mesh(faceGeo, new THREE.MeshBasicMaterial({map:faceTex}));
    face.rotation.x = -Math.PI/2;
    face.position.y = tileTopY+0.02;
    face.receiveShadow = true;
    topGroup.add(face);

    const numSpr = makeSprite(numberTexture(i+1), 0.2);
    numSpr.position.set(TILE*0.35, tileTopY+0.01, TILE*0.36);
    topGroup.add(numSpr);

    const halo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({color:0xffe873,transparent:true,opacity:0,blending:THREE.AdditiveBlending}));
    halo.rotation.x = Math.PI/2;
    halo.position.y = tileTopY+0.03;
    halo.visible = false;
    topGroup.add(halo);

    let floatObj = null, shadowDisc = null, floatBaseScale = 0.34, holoShine = null, glow = null;
    if(i !== 0 && catDef.tier === 'float'){
      const { tex, aspect } = getFramedPhotoTexture(catKey);
      const h = { gradee:0.5, booster50:0.6, etb:0.7, jackpot300:0.8 }[catKey] || 0.5, w = h*aspect;
      floatObj = new THREE.Mesh(new THREE.PlaneGeometry(w,h), new THREE.MeshBasicMaterial({map:tex, transparent:true, side:THREE.DoubleSide}));
      floatObj.position.y = tileTopY + 0.32 + h*0.5;
      topGroup.add(floatObj);
      floatBaseScale = h;
      const shineTex = holoShineBaseTex.clone(); shineTex.needsUpdate = true;
      const shineMesh = new THREE.Mesh(new THREE.PlaneGeometry(w,h), new THREE.MeshBasicMaterial({
        map:shineTex, transparent:true, depthWrite:false, side:THREE.DoubleSide, blending:THREE.AdditiveBlending, opacity:.32 }));
      shineMesh.position.set(0,0,0.002);
      floatObj.add(shineMesh);
      holoShine = { tex:shineTex, speed:0.16+Math.random()*0.1, phase:Math.random() };
    } else if(i !== 0 && catDef.tier === 'glyph'){
      floatObj = makeSprite(getGlyphTexture(data.isVisite ? 'visite' : catKey, accentColor), data.isVisite ? 0.3 : 0.6);
      floatObj.position.y = tileTopY + 0.3;
      topGroup.add(floatObj);
    }
    if(floatObj){
      shadowDisc = new THREE.Mesh(new THREE.CircleGeometry(catDef.tier==='float' ? 0.28 : 0.22,20), new THREE.MeshBasicMaterial({color:0x000000,transparent:true,opacity:.3}));
      shadowDisc.rotation.x = -Math.PI/2;
      shadowDisc.position.y = tileTopY+0.005;
      group.add(shadowDisc);
      if(catDef.tier==='float' || !data.isVisite){
        const isFloat = catDef.tier==='float';
        const glowScale = isFloat ? ({ gradee:0.58, booster50:0.72, etb:0.86, jackpot300:1.05 }[catKey] || 0.58) : 0.68;
        glow = new THREE.Sprite(new THREE.SpriteMaterial({ map:goldDotTex, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, opacity: isFloat ? .55 : .45 }));
        glow.position.y = tileTopY + (isFloat ? 0.06 : 0.05);
        glow.scale.set(glowScale,glowScale,glowScale);
        group.add(glow);
      }
    }
    tiles.push({
      index:i, group, topGroup, world, tileTopY, catKey, catDef, caseNum:i+1, isVisite:data.isVisite,
      halo, floatObj, shadowDisc, glow, floatBaseScale, holoShine, motion: MOTION[catKey]||{bob:0.08},
      floatHalfH: catDef.tier==='float' ? floatBaseScale*0.5 : 0.3,
      floatBaseOff: catDef.tier==='float' ? 0.32 + floatBaseScale*0.5 : 0.3,
      floatLiftCur: 0,
      bezelBase: { x: world.x, z: world.z, y: BEZEL_Y }, rivetPositions, rivetY:RIVET_Y,
      phase: Math.random()*Math.PI*2,
      breathePhase: ((r+c)%8)*0.4,
      isActive: false, popT0: null,
    });
  }
  collarInst.instanceMatrix.needsUpdate = true;
  bezelInst.instanceMatrix.needsUpdate = true;
  rivetInst.instanceMatrix.needsUpdate = true;

  /* Hauteur courante de la carte d'une case : le pion se tient sur la
     surface telle qu'elle est à cet instant (+ face + semelle). */
  const CARD_FACE_LIFT = 0.02 + 0.008;
  function surfOffset(tile){ return CARD_FACE_LIFT + (tile ? tile.topGroup.position.y : 0); }

  function setActive(index){
    const now = sc.clock.getElapsedTime();
    tiles.forEach((t,i)=>{
      const was = t.isActive;
      t.isActive = (i===index);
      if(!t.isActive){ t.halo.material.opacity = 0; t.halo.visible = false; }
      else if(!was) t.popT0 = now;
    });
  }

  /* décoration coupée en éco : loupiotes, disques d'ombre */
  sc.ecoHooks.push(on=>{
    trimLights.forEach(tl=>{ tl.spr.visible = !on; });
    orbiterLights.forEach(ol=>{ ol.spr.visible = !on; });
    tiles.forEach(t=>{ if(t.shadowDisc) t.shadowDisc.visible = !on; });
  });

  /* Mise à jour par image. `playerPos` : position du pion ; `playerTop` :
     hauteur de sa silhouette ; `extraY(tile, t)` : onde de l'orage. */
  function update(t, dt, playerPos, playerTop, extraY){
    if(!sc.eco) trimLights.forEach(tl=>{
      tl.spr.material.opacity = reduceMotion ? 0.5 : 0.28 + 0.45*Math.max(0, Math.sin(t*2.2 - tl.idx*0.5));
    });
    if(!reduceMotion && !sc.eco){
      orbiterLights.forEach(ol=>{
        const [x,z] = perimeterPosAt((t*0.06 + ol.offset) % 1);
        ol.spr.position.set(x,0.05,z);
        ol.spr.material.opacity = 0.85 + Math.sin(t*6)*0.15;
      });
    }
    for(const tile of tiles){
      if(!reduceMotion){
        tile.topGroup.scale.set(1, 1 + Math.sin(t*1.9 + tile.breathePhase)*0.012, 1);
        let posY = Math.sin(t*1.3 - (tile.caseNum-1)*0.35) * 0.05;
        if(tile.popT0 != null){
          const pe = t - tile.popT0;
          if(pe < 0.6) posY += Math.exp(-pe*7)*Math.sin(pe*20)*0.16;
          else tile.popT0 = null;
        }
        if(extraY) posY += extraY(tile, t);
        tile.topGroup.position.y = posY;
        dummy.rotation.set(0,0,0);
        dummy.position.set(tile.bezelBase.x, tile.bezelBase.y+posY, tile.bezelBase.z);
        dummy.updateMatrix();
        bezelInst.setMatrixAt(tile.index, dummy.matrix);
        tile.rivetPositions.forEach((rp,k)=>{
          dummy.position.set(rp.x, tile.rivetY+posY, rp.z);
          dummy.updateMatrix();
          rivetInst.setMatrixAt(tile.index*RIVET_OFFSETS.length+k, dummy.matrix);
        });
      }
      if(tile.floatObj){
        const m = tile.motion;
        const bob = Math.sin(t*2 + tile.phase)*(reduceMotion ? 0 : m.bob);
        const baseY = tile.tileTopY + 0.32 + (tile.catDef.tier==='float' ? tile.floatBaseScale*0.5 : -0.02);
        // le lot s'élève quand le pion approche, pour lui passer au-dessus
        const pd = Math.hypot(playerPos.x - tile.world.x, playerPos.z - tile.world.z);
        const near = pd <= CELL*0.5 ? 1 : pd >= CELL*1.0 ? 0 : 1 - (pd - CELL*0.5)/(CELL*0.5);
        const needOff = playerTop + 0.30 + tile.floatHalfH;
        const wantLift = Math.max(0, needOff - tile.floatBaseOff) * (near*near*(3-2*near));
        tile.floatLiftCur += (wantLift - tile.floatLiftCur) * Math.min(1, dt*7);
        tile.floatObj.position.y = baseY + bob + tile.floatLiftCur;
        if(!reduceMotion && m.swing) tile.floatObj.rotation.y = Math.sin(t*0.7 + tile.phase)*m.swing;
        if(!reduceMotion && tile.catDef.tier==='glyph' && !m.pulse){
          const s = 1 + Math.sin(t*1.6 + tile.phase)*0.14;
          tile.floatObj.scale.set(0.3*s,0.3*s,0.3*s);
        }
        if(m.pulse) tile.floatObj.material.opacity = 0.7 + Math.sin(t*4.5+tile.phase)*0.3;
        if(tile.shadowDisc){
          const k = 1 - Math.min(Math.abs(bob)/ (m.bob||1), 1)*0.5;
          const liftN = Math.min(1, tile.floatLiftCur/0.9);
          const sk = k*(1 + liftN*0.35);
          tile.shadowDisc.scale.set(sk,sk,sk);
          tile.shadowDisc.material.opacity = 0.3*k*(1 - liftN*0.55);
        }
        if(tile.holoShine && !reduceMotion) tile.holoShine.tex.offset.x = (t*tile.holoShine.speed + tile.holoShine.phase) % 1;
      }
      if(tile.isActive){
        tile.halo.visible = true;
        const hl = (TIER_LEVEL[tile.catKey] ?? 1);
        const hk = 0.85 + hl*0.14;
        tile.halo.material.opacity = reduceMotion ? 0.55*hk : (0.4 + Math.sin(t*5)*0.25)*hk;
        tile.halo.rotation.z += dt*0.6;
        const hs = 1 + (hl-1)*0.05 + (reduceMotion ? 0 : Math.sin(t*5)*0.03);
        tile.halo.scale.set(hs, hs, 1);
      }
    }
    if(!reduceMotion){
      bezelInst.instanceMatrix.needsUpdate = true;
      rivetInst.instanceMatrix.needsUpdate = true;
    }
  }
  return { boardGroup, tiles, goldDotTex, brightGoldTex, perimeterPosAt, surfOffset, setActive, update };
}
