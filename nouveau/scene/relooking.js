/* Relooking du personnage d'origine (modèle Kenney) façon figurine : grand
   chapeau de paille modélisé, visage redessiné (grands yeux ronds, large
   sourire, cicatrice), gilet, ceinture et short retravaillés par-dessus la
   texture d'origine. Tout est dessiné au canvas au chargement : aucun
   fichier image en plus. Ne s'applique qu'à ce modèle : ses zones de
   texture (visage, gilet…) sont connues. */
import * as THREE from 'three';

/* Le visage occupe ce carré de la texture 2048² (relevé sur l'image). */
const FACE = { x:152, y:74, w:1015, h:853 };
const EYES = [ { cx:0.31, cy:0.37 }, { cx:0.69, cy:0.37 } ];
const EYE_RX = 0.15, EYE_RY = 0.18;

function ellipse(ctx, cx, cy, rx, ry){ ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI*2); }

/* Œil ouvert (grand, rond, blanc, pupille noire) ou fermé (trait courbé). */
function drawEye(ctx, e, closed){
  const cx = FACE.x + e.cx*FACE.w, cy = FACE.y + e.cy*FACE.h;
  const rx = EYE_RX*FACE.w, ry = EYE_RY*FACE.h;
  if(closed){
    ctx.strokeStyle = '#2a1a10'; ctx.lineWidth = 16; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx-rx*0.85, cy+ry*0.15);
    ctx.quadraticCurveTo(cx, cy+ry*0.55, cx+rx*0.85, cy+ry*0.15); ctx.stroke();
    return;
  }
  ellipse(ctx, cx, cy, rx, ry); ctx.fillStyle = '#ffffff'; ctx.fill();
  ctx.lineWidth = 16; ctx.strokeStyle = '#161010'; ctx.stroke();
  const toward = e.cx < 0.5 ? 1 : -1;               // les pupilles regardent un peu vers le centre
  const px = cx + toward*rx*0.12, py = cy + ry*0.12;
  ellipse(ctx, px, py, rx*0.32, ry*0.34); ctx.fillStyle = '#111111'; ctx.fill();
  ellipse(ctx, px - rx*0.12, py - ry*0.14, rx*0.10, ry*0.09); ctx.fillStyle = '#ffffff'; ctx.fill();
}

/* Repeint le visage sur `ctx` (texture 2048²). */
function drawFace(ctx){
  const { x, y, w, h } = FACE;
  const skin = ctx.createRadialGradient(x+w*0.5, y+h*0.38, w*0.05, x+w*0.5, y+h*0.5, w*0.75);
  skin.addColorStop(0, '#f7cfa8'); skin.addColorStop(0.6, '#f0be92'); skin.addColorStop(1, '#d99a6c');
  ctx.fillStyle = skin; ctx.fillRect(x, y, w, h);
  // joues
  for(const u of [0.2, 0.8]){
    const g = ctx.createRadialGradient(x+u*w, y+h*0.62, 0, x+u*w, y+h*0.62, w*0.14);
    g.addColorStop(0, 'rgba(235,120,110,.35)'); g.addColorStop(1, 'rgba(235,120,110,0)');
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  }
  // sourcils : arcs fins et hauts
  ctx.strokeStyle = '#1e1410'; ctx.lineWidth = 13; ctx.lineCap = 'round';
  for(const e of EYES){
    const cx = x + e.cx*w, top = y + (e.cy - EYE_RY)*h - h*0.07, d = e.cx < 0.5 ? 1 : -1;
    ctx.beginPath(); ctx.moveTo(cx - d*w*0.08, top - h*0.02);
    ctx.lineTo(cx + d*w*0.07, top + h*0.03); ctx.stroke();
  }
  EYES.forEach(e => drawEye(ctx, e, false));
  // nez : un petit trait
  ctx.strokeStyle = '#b9764f'; ctx.lineWidth = 8;
  ctx.beginPath(); ctx.moveTo(x+w*0.49, y+h*0.55); ctx.quadraticCurveTo(x+w*0.47, y+h*0.60, x+w*0.51, y+h*0.61); ctx.stroke();
  // large sourire à dents
  const mx0 = x+w*0.20, mx1 = x+w*0.80, ytop = y+h*0.69, ybot = y+h*0.87;
  ctx.beginPath();
  ctx.moveTo(mx0, ytop);
  ctx.quadraticCurveTo(x+w*0.5, ytop + h*0.035, mx1, ytop);
  ctx.quadraticCurveTo(x+w*0.5, ybot + h*0.06, mx0, ytop);
  ctx.closePath();
  ctx.fillStyle = '#ffffff'; ctx.fill();
  ctx.save(); ctx.clip();
  // intérieur de la bouche sous les dents
  ctx.fillStyle = '#e07a8c'; ctx.fillRect(mx0, ytop + (ybot-ytop)*0.55, mx1-mx0, ybot-ytop);
  ellipse(ctx, x+w*0.5, ybot + h*0.02, w*0.16, h*0.06); ctx.fillStyle = '#c94e66'; ctx.fill();
  // séparations des dents
  ctx.strokeStyle = 'rgba(40,20,20,.55)'; ctx.lineWidth = 5;
  for(let k=1;k<9;k++){ const tx = mx0 + (mx1-mx0)*k/9; ctx.beginPath(); ctx.moveTo(tx, ytop-10); ctx.lineTo(tx, ytop + (ybot-ytop)*0.55); ctx.stroke(); }
  ctx.restore();
  ctx.strokeStyle = '#161010'; ctx.lineWidth = 14; ctx.lineJoin = 'round'; ctx.stroke();
  // cicatrice sous l'œil gauche : un trait et deux points de suture
  ctx.strokeStyle = '#8a3a2a'; ctx.lineWidth = 7; ctx.lineCap = 'round';
  const sx = x+w*0.17, sy = y+h*0.60;
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx+w*0.07, sy+h*0.02); ctx.stroke();
  for(const k of [0.3, 0.7]){
    const px = sx + w*0.07*k, py = sy + h*0.02*k;
    ctx.beginPath(); ctx.moveTo(px - 8, py - 16); ctx.lineTo(px + 8, py + 16); ctx.stroke();
  }
}

/* Gilet, ceinture, short : relief et grain par-dessus les aplats, par
   couleur (le gilet est le rouge, la ceinture le jaune, le short le bleu).
   Boutons dorés le long de l'ouverture du gilet. */
function dressBody(ctx, w, h){
  const im = ctx.getImageData(0, 0, w, h), d = im.data;
  for(let y=0;y<h;y++){
    for(let x=0;x<w;x++){
      const i = (y*w+x)*4, r = d[i], g = d[i+1], b = d[i+2];
      if(y < FACE.y+FACE.h && x < FACE.x+FACE.w) continue;           // le visage est déjà fait
      const noise = (Math.sin(x*12.9898 + y*78.233)*43758.5453) % 1;  // bruit stable, sans allocation
      if(r > 140 && g < 70 && b < 70){                                 // gilet : plis verticaux + grain
        const fold = 0.86 + 0.14*Math.max(0, Math.sin(x/19 + Math.sin(y/90)));
        const k = fold * (0.96 + 0.06*noise);
        d[i] = Math.min(255, r*k + 10); d[i+1] = g*k; d[i+2] = b*k;
      } else if(r > 200 && g > 150 && b < 80){                         // ceinture : tissage en diagonale
        const weave = 0.88 + 0.12*Math.abs(Math.sin((x+y)/7));
        d[i] = r*weave; d[i+1] = g*weave*0.98; d[i+2] = b*weave;
      } else if(b > 110 && r < 70 && g < 120){                         // short : grain jean
        const k = 0.92 + 0.10*noise;
        d[i] = r*k + 6; d[i+1] = g*k + 6; d[i+2] = b*k;
      }
    }
  }
  ctx.putImageData(im, 0, 0);
  // boutons dorés à droite de l'ouverture du gilet (torse devant)
  for(let k=0;k<4;k++){
    const cx = 738, cy = 1090 + k*125;
    const g = ctx.createRadialGradient(cx-6, cy-6, 2, cx, cy, 24);
    g.addColorStop(0, '#fff0b0'); g.addColorStop(0.5, '#e0b13c'); g.addColorStop(1, '#8a6414');
    ctx.beginPath(); ctx.arc(cx, cy, 24, 0, Math.PI*2); ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = '#3a2a08'; ctx.stroke();
  }
}

/* Texture de peau relookée + clignement (les yeux se referment en trait). */
export function relookerPeau(material, srcTexture){
  const img = srcTexture.image;
  if(!img || !img.width) return { update(){} };
  const w = img.width, h = img.height;
  const base = document.createElement('canvas'); base.width = w; base.height = h;
  const bctx = base.getContext('2d');
  bctx.drawImage(img, 0, 0, w, h);
  const sx = w/2048;                     // le dessin est pensé en 2048, la texture peut être plus petite
  bctx.save(); bctx.scale(sx, sx); drawFace(bctx); bctx.restore();
  dressBody(bctx, w, h);
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(base, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = srcTexture.colorSpace; tex.flipY = srcTexture.flipY;
  tex.wrapS = srcTexture.wrapS; tex.wrapT = srcTexture.wrapT;
  material.map = tex; material.needsUpdate = true;
  let closed = false;
  function setClosed(v){
    if(v===closed) return;
    closed = v;
    ctx.drawImage(base, 0, 0);
    if(v){
      ctx.save(); ctx.scale(sx, sx);
      for(const e of EYES){
        const cx = FACE.x + e.cx*FACE.w, cy = FACE.y + e.cy*FACE.h;
        ellipse(ctx, cx, cy, EYE_RX*FACE.w + 12, EYE_RY*FACE.h + 12); ctx.fillStyle = '#f0be92'; ctx.fill();
        drawEye(ctx, e, true);
      }
      ctx.restore();
    }
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

/* ---------- le chapeau de paille ---------- */
function texturePaille(){
  const s = 512, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d');
  g.fillStyle = '#dcb86e'; g.fillRect(0,0,s,s);
  // deux familles de brins croisés, un peu irréguliers
  for(const [ang, col, lw] of [[Math.PI/4,'rgba(150,110,40,.45)',3],[-Math.PI/4,'rgba(255,235,170,.35)',2],[Math.PI/4,'rgba(120,85,30,.25)',1]]){
    g.save(); g.translate(s/2, s/2); g.rotate(ang); g.strokeStyle = col; g.lineWidth = lw;
    for(let k=-s;k<s;k+=9){ g.beginPath(); g.moveTo(k + Math.sin(k)*2, -s); g.lineTo(k + Math.cos(k)*2, s); g.stroke(); }
    g.restore();
  }
  // grain
  const im = g.getImageData(0,0,s,s), d = im.data;
  for(let i=0;i<d.length;i+=4){ const n = ((Math.sin(i*0.37)*43758.5453)%1)*14 - 7; d[i]+=n; d[i+1]+=n; d[i+2]+=n*0.6; }
  g.putImageData(im,0,0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/* Construit le chapeau à l'échelle de la casquette d'origine (`capMesh`), le
   pose sur l'os de la tête et masque la casquette. */
export function construireChapeau(capMesh, bandMesh, headBone, root){
  root.updateWorldMatrix(true, true);
  capMesh.geometry.computeBoundingBox();
  const bb = capMesh.geometry.boundingBox.clone().applyMatrix4(capMesh.matrixWorld);
  const W = bb.max.x - bb.min.x, H = bb.max.y - bb.min.y;
  /* La casquette d'origine avait déjà un bord : sa largeur W est celle du
     bord, pas de la tête. Le nouveau bord est un peu plus large, la calotte
     un peu plus ronde ; posé au ras de l'ancien. */
  const centre = new THREE.Vector3((bb.min.x+bb.max.x)/2, bb.min.y + H*0.10, (bb.min.z+bb.max.z)/2);
  const Rb = W*0.43;         // rayon du bord : un peu plus étroit que l'ancienne casquette
  const Rd = W*0.26;         // rayon de la calotte
  const paille = texturePaille();
  const mat = new THREE.MeshStandardMaterial({ map: paille, color: 0xffffff, roughness: 0.92, metalness: 0, envMapIntensity: 0.3, side: THREE.DoubleSide });
  paille.repeat.set(6, 2);
  const chapeau = new THREE.Group();
  // calotte : demi-sphère aplatie
  const dome = new THREE.Mesh(new THREE.SphereGeometry(Rd, 40, 18, 0, Math.PI*2, 0, Math.PI/2), mat);
  dome.scale.y = 0.72; dome.position.y = 0.01;
  chapeau.add(dome);
  // bord : anneau légèrement retombant, ondulé
  const pts = [];
  for(let k=0;k<=10;k++){ const u = k/10; pts.push(new THREE.Vector2(Rd*0.92 + (Rb - Rd*0.92)*u, -Rb*0.10*u*u)); }
  const brimGeo = new THREE.LatheGeometry(pts, 64);
  const pos = brimGeo.attributes.position;
  for(let i=0;i<pos.count;i++){
    const x = pos.getX(i), z = pos.getZ(i), r = Math.hypot(x, z), th = Math.atan2(z, x);
    const u = Math.max(0, (r - Rd*0.92)/(Rb - Rd*0.92));
    pos.setY(i, pos.getY(i) + Math.sin(th*5)*Rb*0.035*u*u);
  }
  brimGeo.computeVertexNormals();
  const brim = new THREE.Mesh(brimGeo, mat);
  chapeau.add(brim);
  // dessous du bord un peu plus sombre : une seconde peau, très fine
  // bandeau rouge
  const band = new THREE.Mesh(new THREE.TorusGeometry(Rd*0.985, Rd*0.10, 10, 48), new THREE.MeshStandardMaterial({ color: 0xc0322a, roughness: 0.6, envMapIntensity: 0.3 }));
  band.rotation.x = Math.PI/2; band.position.y = Rd*0.10;
  chapeau.add(band);
  chapeau.traverse(o=>{ if(o.isMesh){ o.castShadow = true; o.receiveShadow = true; } });
  // repère de l'os : position et échelle monde de la tête
  const s = headBone.getWorldScale(new THREE.Vector3()).x || 1;
  chapeau.scale.setScalar(1/s);
  chapeau.position.copy(headBone.worldToLocal(centre.clone()));
  const q = headBone.getWorldQuaternion(new THREE.Quaternion()).invert();
  chapeau.quaternion.copy(q);   // le chapeau reste droit dans le monde à la pose de liaison
  // porté en arrière, comme sur la référence : bord relevé devant, calotte derrière
  const arriere = new THREE.Group();
  arriere.quaternion.copy(q);
  arriere.position.copy(chapeau.position);
  chapeau.position.set(0, W*0.03, -W*0.07);
  chapeau.quaternion.setFromAxisAngle(new THREE.Vector3(1,0,0), -0.24);
  chapeau.scale.setScalar(1);
  arriere.scale.setScalar(1/s);
  arriere.add(chapeau);
  headBone.add(arriere);
  capMesh.visible = false;
  if(bandMesh) bandMesh.visible = false;
  return chapeau;
}
