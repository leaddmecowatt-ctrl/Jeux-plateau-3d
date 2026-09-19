/* Toutes les textures dessinées au <canvas> 2D : faces des cases, cartes
   flottantes, médaillons, numéros, plaque centrale, ornements, reflet holo,
   points lumineux, fond studio. Une texture par catégorie, jamais par case
   (cache) : 36 cases se partagent ~10 textures. */
import * as THREE from 'three';
import { CATS, GOLD, GOLD_BRIGHT, SWATCH_COLORS, LOT_IMAGE_URLS, CENTER_LEGEND_ROWS } from '../regles/plateau.js';

/* ---------- photos des lots ---------- */
export const LOT_IMAGES = {};
function loadImage(url){
  return new Promise(resolve=>{
    const img = new Image();
    img.onload = ()=>resolve(img);
    img.onerror = ()=>resolve(null);
    img.src = url;
  });
}
export async function chargerPhotos(){
  await Promise.all(Object.entries(LOT_IMAGE_URLS).map(async ([k,url])=>{ LOT_IMAGES[k] = await loadImage(url); }));
}

let maxAniso = 8;
export function setMaxAniso(n){ maxAniso = n; }

export function shadeHex(hex, percent){
  const n = parseInt(hex.slice(1), 16);
  const r = (n>>16)&255, g = (n>>8)&255, b = n&255;
  const mix = c => Math.max(0, Math.min(255, Math.round(c + (percent>0 ? 255-c : c)*percent)));
  return '#'+[mix(r),mix(g),mix(b)].map(v=>v.toString(16).padStart(2,'0')).join('');
}
function roundRectPath(ctx,x,y,w,h,r){ ctx.beginPath(); ctx.roundRect(x,y,w,h,r); }
function canvasTex(cvs){
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function newCanvas(w, h){ const c = document.createElement('canvas'); c.width = w; c.height = h || w; return c; }

/* Icônes vectorielles (jamais d'emoji : rendu identique partout). */
export function drawVectorIcon(ctx, kind, cx, cy, r, color){
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = color; ctx.strokeStyle = color;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if(kind==='card'){
    const w=r*1.3, h=r*1.7;
    roundRectPath(ctx, -w/2, -h/2, w, h, r*0.18); ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    roundRectPath(ctx, -w*0.32, -h*0.26, w*0.64, h*0.4, r*0.08); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  } else if(kind==='star'){
    const spikes=5, outerR=r*0.95, innerR=r*0.42;
    ctx.beginPath();
    for(let i=0;i<spikes*2;i++){
      const ang = -Math.PI/2 + i*Math.PI/spikes;
      const rad = i%2===0 ? outerR : innerR;
      const x = Math.cos(ang)*rad, y = Math.sin(ang)*rad;
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.closePath(); ctx.fill();
  } else if(kind==='gift'){
    const w=r*1.5, h=r*1.15;
    roundRectPath(ctx, -w/2, -h*0.15, w, h*0.9, r*0.1); ctx.fill();
    roundRectPath(ctx, -w/2, -h*0.45, w, h*0.32, r*0.08); ctx.fill();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillRect(-w*0.09, -h*0.45, w*0.18, h*1.2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    ctx.ellipse(-w*0.13,-h*0.5,w*0.14,h*0.15,0,0,Math.PI*2);
    ctx.ellipse(w*0.13,-h*0.5,w*0.14,h*0.15,0,0,Math.PI*2);
    ctx.fill();
  } else if(kind==='lock'){
    const w=r*1.1, h=r*0.9;
    ctx.beginPath(); ctx.arc(0,-h*0.12,w*0.42,Math.PI,0);
    ctx.lineWidth = r*0.22; ctx.stroke();
    roundRectPath(ctx, -w/2, -h*0.1, w, h*0.75, r*0.12); ctx.fill();
  } else if(kind==='unlock'){
    const w=r*1.1, h=r*0.9;
    ctx.beginPath(); ctx.arc(-w*0.12,-h*0.3,w*0.42,Math.PI*0.95,Math.PI*1.85);
    ctx.lineWidth = r*0.22; ctx.stroke();
    roundRectPath(ctx, -w/2, -h*0.1, w, h*0.75, r*0.12); ctx.fill();
  }
  ctx.restore();
}

/* Nom du lot dans le bandeau : réduit jusqu'à tenir, sinon deux lignes. */
function drawFittedBandLabel(ctx, text, cx, cy, maxWidth, maxFont, minFont){
  const family = 'Arial,Helvetica,sans-serif';
  let fontSize = maxFont;
  ctx.font = '900 '+fontSize+'px '+family;
  while(fontSize > minFont && ctx.measureText(text).width > maxWidth){
    fontSize -= 2;
    ctx.font = '900 '+fontSize+'px '+family;
  }
  if(ctx.measureText(text).width <= maxWidth){ ctx.fillText(text, cx, cy); return; }
  const words = text.split(' ');
  let bestSplit = Math.max(1, Math.ceil(words.length/2)), bestDiff = Infinity;
  for(let i=1;i<words.length;i++){
    const diff = Math.abs(words.slice(0,i).join(' ').length - words.slice(i).join(' ').length);
    if(diff < bestDiff){ bestDiff = diff; bestSplit = i; }
  }
  const line1 = words.slice(0,bestSplit).join(' '), line2 = words.slice(bestSplit).join(' ');
  fontSize = minFont;
  ctx.font = '900 '+fontSize+'px '+family;
  while(fontSize > minFont*0.7 && (ctx.measureText(line1).width>maxWidth || ctx.measureText(line2).width>maxWidth)){
    fontSize -= 1.5;
    ctx.font = '900 '+fontSize+'px '+family;
  }
  const lineGap = fontSize*1.08;
  ctx.fillText(line1, cx, cy - lineGap/2);
  ctx.fillText(line2, cx, cy + lineGap/2);
}

/* Fond dégradé coloré de la face d'une case + cadre commun. */
function fillAccentBackdrop(ctx, size, pad, bw, bh, r, accentColor){
  const bgGrad = ctx.createRadialGradient(pad+bw/2, pad+bh*0.42, bh*0.05, pad+bw/2, pad+bh/2, bh*0.75);
  bgGrad.addColorStop(0, shadeHex(accentColor, 0.4));
  bgGrad.addColorStop(0.55, accentColor);
  bgGrad.addColorStop(1, shadeHex(accentColor, -0.55));
  ctx.save();
  roundRectPath(ctx, pad, pad, bw, bh, r*0.7); ctx.clip();
  ctx.fillStyle = bgGrad;
  ctx.fillRect(pad, pad, bw, bh);
  ctx.restore();
}
function finishFace(ctx, size, r, accentColor, label){
  const gloss = ctx.createLinearGradient(0,0,0,size);
  gloss.addColorStop(0,'rgba(255,255,255,.06)'); gloss.addColorStop(.22,'rgba(255,255,255,0)');
  ctx.fillStyle = gloss; ctx.fillRect(0,0,size,size);
  ctx.restore();
  roundRectPath(ctx,9,9,size-18,size-18,r);
  ctx.shadowColor = accentColor; ctx.shadowBlur = size*0.035;
  ctx.lineWidth = 10; ctx.strokeStyle = accentColor; ctx.stroke();
  ctx.shadowBlur = 0;
  roundRectPath(ctx,15,15,size-30,size-30,r*0.85);
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.stroke();
  const bandH = size*0.22;
  ctx.fillStyle = accentColor;
  roundRectPath(ctx,9,size-9-bandH,size-18,bandH,r*0.7); ctx.fill();
  ctx.fillStyle = '#0c0c0c'; ctx.globalAlpha=.28;
  roundRectPath(ctx,9,size-9-bandH,size-18,bandH,r*0.7); ctx.fill(); ctx.globalAlpha=1;
  ctx.fillStyle = '#fff9e6';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  drawFittedBandLabel(ctx, label, size/2, size-9-bandH/2+2, size-18-size*0.06, size*0.088, size*0.045);
}

/* Face d'une case : la vraie photo du lot encadrée noir & or (ou le
   symbole pour Chance / Caisse / Prison). Cache par catégorie + badge. */
const flatFaceCache = new Map();
export function getFlatPhotoFace(catKey, accentColor, badge){
  const key = catKey+'|'+badge;
  if(flatFaceCache.has(key)) return flatFaceCache.get(key);
  const size = 960;
  const cvs = newCanvas(size);
  const ctx = cvs.getContext('2d');
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  const r = size*0.16;
  ctx.save();
  roundRectPath(ctx,9,9,size-18,size-18,r); ctx.clip();
  ctx.fillStyle = '#0c0c0c'; ctx.fillRect(0,0,size,size);
  const img = LOT_IMAGES[catKey];
  const pad = size*0.028;
  const bw = size-2*pad, bh = size-2*pad-size*0.19;
  if(img){
    fillAccentBackdrop(ctx, size, pad, bw, bh, r, accentColor);
    const scale = Math.min(bw/img.width, bh/img.height);
    const iw = img.width*scale, ih = img.height*scale;
    ctx.filter = 'saturate(1.14) contrast(1.07) brightness(1.06)';
    ctx.drawImage(img, pad+(bw-iw)/2, pad+(bh-ih)/2, iw, ih);
    ctx.filter = 'none';
  } else if(CATS[catKey] && CATS[catKey].tier === 'glyph'){
    fillAccentBackdrop(ctx, size, pad, bw, bh, r, accentColor);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = size*0.03;
    if(catKey==='chance'){
      ctx.fillStyle = '#fff9e6';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.font = '900 '+(bh*0.6)+'px Arial,Helvetica,sans-serif';
      ctx.fillText('?', pad+bw/2, pad+bh*0.46);
    } else {
      drawVectorIcon(ctx, { chest:'gift', prison:'lock' }[catKey], pad+bw/2, pad+bh*0.46, bh*0.28, '#fff9e6');
    }
    ctx.restore();
  }
  finishFace(ctx, size, r, accentColor, CATS[catKey].label);
  if(badge) drawVectorIcon(ctx, 'unlock', 16+size*0.075, 16+size*0.075, size*0.075, '#fff9e6');
  const tex = canvasTex(cvs);
  tex.anisotropy = maxAniso;
  flatFaceCache.set(key,tex);
  return tex;
}

/* Case Départ : ni photo ni prix, une Pokéball et « DÉPART ». */
let departFace = null;
export function getDepartFace(){
  if(departFace) return departFace;
  const size = 960;
  const cvs = newCanvas(size);
  const ctx = cvs.getContext('2d');
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  const r = size*0.16;
  ctx.save();
  roundRectPath(ctx,9,9,size-18,size-18,r); ctx.clip();
  ctx.fillStyle = '#0c0c0c'; ctx.fillRect(0,0,size,size);
  const pad = size*0.028;
  const bw = size-2*pad, bh = size-2*pad-size*0.19;
  fillAccentBackdrop(ctx, size, pad, bw, bh, r, GOLD);
  drawPokeball(ctx, pad+bw/2, pad+bh*0.4, bh*0.15, size*0.015);
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.font='900 '+(bh*0.17)+'px Arial,Helvetica,sans-serif';
  ctx.lineJoin='round'; ctx.lineWidth=size*0.01; ctx.strokeStyle='rgba(0,0,0,.8)';
  const txtY = pad+bh*0.78;
  ctx.strokeText('DÉPART', pad+bw/2, txtY);
  ctx.fillStyle = '#fff9e6';
  ctx.fillText('DÉPART', pad+bw/2, txtY);
  finishFace(ctx, size, r, GOLD, 'Point de départ');
  departFace = canvasTex(cvs);
  departFace.anisotropy = maxAniso;
  return departFace;
}
function drawPokeball(ctx, cx, cy, pbR, blur){
  ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = blur;
  ctx.beginPath(); ctx.arc(cx,cy,pbR,Math.PI,0); ctx.fillStyle='#f5484f'; ctx.fill();
  ctx.beginPath(); ctx.arc(cx,cy,pbR,0,Math.PI); ctx.fillStyle='#f6fbff'; ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle='#12283f'; ctx.fillRect(cx-pbR,cy-pbR*0.09,pbR*2,pbR*0.18);
  ctx.lineWidth=pbR*0.09; ctx.strokeStyle='#12283f';
  ctx.beginPath(); ctx.arc(cx,cy,pbR,0,Math.PI*2); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx,cy,pbR*0.34,0,Math.PI*2); ctx.fillStyle='#fff'; ctx.fill(); ctx.stroke();
}

/* Carte flottante des gros lots : slab doré pour les cartes (duopack, ETB),
   photo nette avec coins dorés pour les produits (coffret, tripack). */
const framedCache = new Map();
function drawCornerMark(ctx, cx, cy, len, hDir, vDir){
  ctx.beginPath();
  ctx.moveTo(cx, cy + len*vDir); ctx.lineTo(cx, cy); ctx.lineTo(cx + len*hDir, cy);
  ctx.stroke();
}
export function getFramedPhotoTexture(catKey){
  if(framedCache.has(catKey)) return framedCache.get(catKey);
  const img = LOT_IMAGES[catKey];
  const iw = img ? img.width : 3, ih = img ? img.height : 4;
  const size = 1100;
  const h = size, w = Math.round(size*(iw/ih));
  const cvs = newCanvas(w, h);
  const ctx = cvs.getContext('2d');
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  const isCardLike = (catKey === 'gradee' || catKey === 'jackpot300');
  const r = w*(isCardLike ? 0.06 : 0.09);
  if(isCardLike){
    const frameGrad = ctx.createLinearGradient(0,0,w,h);
    frameGrad.addColorStop(0,GOLD_BRIGHT); frameGrad.addColorStop(.5,GOLD); frameGrad.addColorStop(1,'#8a6a1e');
    roundRectPath(ctx,0,0,w,h,r); ctx.fillStyle=frameGrad; ctx.fill();
    const inset = w*0.045;
    ctx.save();
    roundRectPath(ctx,inset,inset,w-2*inset,h-2*inset,r*0.7); ctx.clip();
    ctx.fillStyle = '#0c0c0c'; ctx.fillRect(0,0,w,h);
    ctx.filter = 'saturate(1.12) contrast(1.06) brightness(1.05)';
    if(img) ctx.drawImage(img, inset, inset, w-2*inset, h-2*inset);
    ctx.filter = 'none';
    const vign = ctx.createRadialGradient(w/2,h*0.35,h*0.15,w/2,h/2,h*0.75);
    vign.addColorStop(0,'rgba(0,0,0,0)'); vign.addColorStop(1,'rgba(0,0,0,.12)');
    ctx.fillStyle=vign; ctx.fillRect(0,0,w,h);
    ctx.restore();
    roundRectPath(ctx,inset,inset,w-2*inset,h-2*inset,r*0.7);
    ctx.lineWidth=w*0.01; ctx.strokeStyle='rgba(255,224,140,.5)'; ctx.stroke();
  } else {
    ctx.save();
    roundRectPath(ctx,0,0,w,h,r); ctx.clip();
    ctx.fillStyle = '#0c0c0c'; ctx.fillRect(0,0,w,h);
    ctx.filter = 'saturate(1.1) contrast(1.05) brightness(1.06)';
    if(img) ctx.drawImage(img, 0, 0, w, h);
    ctx.filter = 'none';
    const vign = ctx.createRadialGradient(w/2,h*0.4,h*0.12,w/2,h/2,h*0.78);
    vign.addColorStop(0,'rgba(0,0,0,0)'); vign.addColorStop(1,'rgba(0,0,0,.18)');
    ctx.fillStyle=vign; ctx.fillRect(0,0,w,h);
    ctx.restore();
    const cornerLen = Math.min(w,h)*0.13, ci = w*0.04;
    ctx.strokeStyle = GOLD_BRIGHT; ctx.lineWidth = w*0.014; ctx.lineCap='round';
    drawCornerMark(ctx, ci, ci, cornerLen, 1, 1);
    drawCornerMark(ctx, w-ci, ci, cornerLen, -1, 1);
    drawCornerMark(ctx, ci, h-ci, cornerLen, 1, -1);
    drawCornerMark(ctx, w-ci, h-ci, cornerLen, -1, -1);
  }
  const tex = canvasTex(cvs);
  tex.anisotropy = maxAniso;
  const entry = { tex, aspect: w/h };
  framedCache.set(catKey, entry);
  return entry;
}

/* Médaillon rond pour Chance / Caisse / Prison / simple visite. */
const glyphCache = new Map();
export function getGlyphTexture(kind, accentColor){
  const key = kind+'|'+(accentColor||'');
  if(glyphCache.has(key)) return glyphCache.get(key);
  const size = 240;
  const cvs = newCanvas(size);
  const ctx = cvs.getContext('2d');
  const cx=size/2, cy=size/2;
  ctx.textAlign='center'; ctx.textBaseline='middle';
  if(kind==='visite'){
    ctx.shadowColor = 'rgba(255,255,255,.6)'; ctx.shadowBlur = size*0.12;
    drawVectorIcon(ctx, 'unlock', cx, cy+size*0.02, size*0.22, '#fff9e6');
  } else {
    const medal = accentColor || GOLD;
    ctx.beginPath(); ctx.arc(cx,cy,size*0.46,0,Math.PI*2);
    ctx.fillStyle = 'rgba(8,6,4,.85)'; ctx.fill();
    const radius = size*0.40;
    const grad = ctx.createRadialGradient(cx,cy-radius*0.3,radius*0.08, cx,cy,radius);
    grad.addColorStop(0, shadeHex(medal,0.45)); grad.addColorStop(0.6, medal); grad.addColorStop(1, shadeHex(medal,-0.5));
    ctx.beginPath(); ctx.arc(cx,cy,radius,0,Math.PI*2);
    ctx.fillStyle = grad; ctx.fill();
    ctx.lineWidth = size*0.045; ctx.strokeStyle = '#fff9e6'; ctx.stroke();
    ctx.shadowColor = 'rgba(0,0,0,.7)'; ctx.shadowBlur = size*0.05;
    ctx.fillStyle = '#fff9e6';
    if(kind==='chance'){
      ctx.font='900 '+(size*0.44)+'px Arial,Helvetica,sans-serif';
      ctx.fillText('?',cx,cy+size*0.02);
    } else if(kind==='chest'){
      drawVectorIcon(ctx, 'gift', cx, cy+size*0.02, size*0.24, '#fff9e6');
    } else if(kind==='prison'){
      drawVectorIcon(ctx, 'lock', cx, cy+size*0.02, size*0.22, '#fff9e6');
    }
  }
  const tex = canvasTex(cvs);
  glyphCache.set(key,tex);
  return tex;
}

export function numberTexture(n){
  const size=128;
  const cvs=newCanvas(size);
  const ctx=cvs.getContext('2d');
  ctx.font='800 '+(size*0.5)+'px Arial'; ctx.fillStyle=GOLD_BRIGHT;
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(String(n), size/2, size/2+2);
  return canvasTex(cvs);
}

export function makeGlowDotTexture(colorCss){
  const c=newCanvas(64);
  const g=c.getContext('2d');
  const grad=g.createRadialGradient(32,32,0,32,32,32);
  grad.addColorStop(0,colorCss); grad.addColorStop(1,'rgba(0,0,0,0)');
  g.fillStyle=grad; g.fillRect(0,0,64,64);
  return new THREE.CanvasTexture(c);
}
export function makeFloodGlowTexture(){
  const c = newCanvas(128);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64,64,0,64,64,64);
  grad.addColorStop(0,'rgba(255,240,200,.9)');
  grad.addColorStop(0.4,'rgba(255,210,120,.45)');
  grad.addColorStop(1,'rgba(255,210,120,0)');
  g.fillStyle = grad; g.fillRect(0,0,128,128);
  return new THREE.CanvasTexture(c);
}

/* Fond « mur de studio » : sert d'environnement de reflets pour l'or. */
export function makeStudioBackdrop(){
  const w=1024,h=1024;
  const cvs=newCanvas(w,h);
  const ctx=cvs.getContext('2d');
  const grad = ctx.createRadialGradient(w*0.5,h*0.22,10,w*0.5,h*0.55,h*0.95);
  grad.addColorStop(0,'#3a2e0f'); grad.addColorStop(0.35,'#1c1608'); grad.addColorStop(0.72,'#0a0805'); grad.addColorStop(1,'#000000');
  ctx.fillStyle=grad; ctx.fillRect(0,0,w,h);
  ctx.save();
  ctx.translate(w*0.5, h*0.24);
  ctx.strokeStyle = 'rgba(255,226,122,.10)';
  [0.16,0.24,0.32].forEach((r,i)=>{
    ctx.lineWidth = w*(0.012-i*0.002);
    ctx.beginPath(); ctx.arc(0,0,w*r,0,Math.PI*2); ctx.stroke();
  });
  ctx.fillStyle = 'rgba(255,226,122,.14)';
  ctx.beginPath(); ctx.arc(0,0,w*0.045,0,Math.PI*2); ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.rotate(-0.34);
  ctx.font = '900 '+(w*0.052)+'px Georgia, "Times New Roman", serif';
  ctx.fillStyle = 'rgba(255,226,122,.075)';
  ctx.textAlign = 'center'; ctx.textBaseline='middle';
  for(let row=-1; row<=6; row++){
    const y = row*h*0.22 - h*0.3;
    for(let col=-1; col<=2; col++){
      const x = col*w*0.85 + (row%2===0 ? 0 : w*0.42) - w*0.1;
      ctx.fillText('★ PIKAPOLY ★', x, y);
    }
  }
  ctx.restore();
  return canvasTex(cvs);
}

/* Plaque centrale : « PIKAPOLY — Tous les lots à gagner », une ligne par
   lot (photo + nom, jamais de prix ni de pourcentage), Chance, Caisse,
   « Bonne chance ! ». */
const CENTER_LEGEND_BADGES = [
  {swatch:'purple', icon:'question', title:'Chance'},
  {swatch:'green',  icon:'gift',     title:'Caisse'},
];
export function makeCenterPlateTexture(){
  const size = Math.max(window.screen.width||0, window.screen.height||0) >= 1600 ? 1400 : 900;
  const cvs = newCanvas(size);
  const ctx = cvs.getContext('2d');
  drawPokeball(ctx, size/2, size*0.115, size*0.04, 0);
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.font='900 '+(size*0.060)+'px Arial,Helvetica,sans-serif';
  ctx.shadowColor='rgba(255,210,110,.7)'; ctx.shadowBlur=size*0.01;
  ctx.fillStyle = GOLD_BRIGHT;
  ctx.fillText('PIKAPOLY', size/2, size*0.185);
  ctx.shadowBlur = 0;
  ctx.font='700 '+(size*0.028)+'px Arial,Helvetica,sans-serif';
  ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = size*0.012;
  ctx.fillStyle = GOLD_BRIGHT;
  ctx.fillText('★ TOUS LES LOTS À GAGNER ★', size/2, size*0.235);
  ctx.shadowBlur = 0;
  const badgeY = size*0.29, badgeR = size*0.024, badgeGap = size*0.22;
  CENTER_LEGEND_BADGES.forEach((b,i)=>{
    const bx = size/2 + (i===0 ? -1 : 1)*badgeGap/2;
    const color = SWATCH_COLORS[b.swatch];
    ctx.save();
    ctx.shadowColor = color; ctx.shadowBlur = size*0.016;
    ctx.beginPath(); ctx.arc(bx,badgeY,badgeR,0,Math.PI*2);
    ctx.fillStyle = '#0c0f16'; ctx.fill();
    ctx.restore();
    if(b.icon==='question'){
      ctx.font = '900 '+(badgeR*1.3)+'px Arial,Helvetica,sans-serif';
      ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillStyle = '#fff9e6';
      ctx.fillText('?', bx, badgeY+badgeR*0.05);
    } else {
      drawVectorIcon(ctx, b.icon, bx, badgeY, badgeR*0.85, '#fff9e6');
    }
    ctx.lineWidth = size*0.0045; ctx.strokeStyle = color;
    ctx.beginPath(); ctx.arc(bx,badgeY,badgeR,0,Math.PI*2); ctx.stroke();
    ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.shadowColor = 'rgba(0,0,0,.9)'; ctx.shadowBlur = size*0.008;
    ctx.fillStyle = GOLD_BRIGHT;
    ctx.font='800 '+(size*0.024)+'px Arial,Helvetica,sans-serif';
    ctx.fillText(b.title, bx+badgeR*1.5, badgeY+size*0.001);
    ctx.shadowBlur = 0;
  });
  const rowsTop = size*0.335, rowH = (0.93-0.335)*size/CENTER_LEGEND_ROWS.length, rowW = size*0.85, rowX = size*0.075;
  CENTER_LEGEND_ROWS.forEach((r,i)=>{
    const y = rowsTop + i*rowH;
    const rh = rowH*0.82;
    const color = SWATCH_COLORS[r.swatch];
    ctx.save();
    roundRectPath(ctx, rowX, y, rowW, rh, rh*0.22);
    ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = size*0.014;
    ctx.lineWidth = size*0.004; ctx.strokeStyle = color;
    ctx.stroke();
    ctx.restore();
    ctx.save();
    roundRectPath(ctx, rowX, y, rowW, rh, rh*0.22);
    ctx.clip();
    ctx.fillStyle = color;
    ctx.fillRect(rowX, y, rh*0.14, rh);
    ctx.restore();
    const dotR = rh*0.38, dotX = rowX + rh*0.66, dotY = y + rh*0.5;
    ctx.save();
    ctx.shadowColor = color; ctx.shadowBlur = size*0.022;
    ctx.beginPath(); ctx.arc(dotX,dotY,dotR,0,Math.PI*2);
    ctx.fillStyle = '#0c0f16'; ctx.fill();
    ctx.restore();
    const img = r.catKey && LOT_IMAGES[r.catKey];
    if(img){
      ctx.save();
      ctx.beginPath(); ctx.arc(dotX,dotY,dotR*0.88,0,Math.PI*2); ctx.clip();
      const iw=img.width, ih=img.height, side=Math.min(iw,ih);
      ctx.drawImage(img,(iw-side)/2,(ih-side)/2,side,side, dotX-dotR*0.88,dotY-dotR*0.88,dotR*1.76,dotR*1.76);
      ctx.restore();
    } else {
      drawVectorIcon(ctx, 'star', dotX, dotY, dotR*0.85, '#fff9e6');
    }
    ctx.lineWidth = size*0.0055; ctx.strokeStyle = color;
    ctx.beginPath(); ctx.arc(dotX,dotY,dotR,0,Math.PI*2); ctx.stroke();
    const textX = dotX + dotR*1.5;
    ctx.textAlign='left'; ctx.textBaseline='middle';
    ctx.lineJoin = 'round';
    const maxTextW = rowX + rowW - textX - size*0.012;
    let fontSize = rh*0.52;
    ctx.font='900 '+fontSize+'px Arial,Helvetica,sans-serif';
    while(fontSize > rh*0.28 && ctx.measureText(CATS[r.catKey].label).width > maxTextW){
      fontSize -= 1;
      ctx.font='900 '+fontSize+'px Arial,Helvetica,sans-serif';
    }
    ctx.lineWidth = size*0.0052;
    ctx.strokeStyle = GOLD_BRIGHT;
    ctx.strokeText(CATS[r.catKey].label, textX, y+rh*0.52);
    ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = size*0.008;
    ctx.fillStyle = '#0a0a0a';
    ctx.fillText(CATS[r.catKey].label, textX, y+rh*0.52);
    ctx.shadowBlur = 0;
    ctx.textBaseline='alphabetic';
  });
  ctx.textAlign='center';
  ctx.font='italic 700 '+(size*0.03)+'px Georgia, serif';
  ctx.fillStyle = GOLD_BRIGHT;
  ctx.fillText('Bonne chance !', size/2, size*0.945);
  return canvasTex(cvs);
}

/* Ornement doré des 4 angles : médaillon en losange et deux volutes. */
function drawScrollSpiral(ctx, cx, cy, dir, turns, maxR){
  ctx.beginPath();
  const steps = 48;
  for(let i=0;i<=steps;i++){
    const t = i/steps;
    const ang = t*turns*Math.PI*2*dir - Math.PI/2;
    const r = maxR*t;
    const x = cx + Math.cos(ang)*r, y = cy + Math.sin(ang)*r;
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.stroke();
}
export function makeCornerOrnamentTexture(){
  const size = 512;
  const cvs = newCanvas(size);
  const ctx = cvs.getContext('2d');
  const cx = size/2, gemY = size*0.30, scrollY = size*0.52, r = size*0.16;
  ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = size*0.015;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.lineWidth = size*0.02; ctx.strokeStyle = GOLD;
  ctx.beginPath(); ctx.moveTo(cx, gemY+size*0.06); ctx.lineTo(cx, scrollY-size*0.02); ctx.stroke();
  ctx.lineWidth = size*0.028;
  const grad = ctx.createLinearGradient(0,0,0,size);
  grad.addColorStop(0, GOLD_BRIGHT); grad.addColorStop(1, '#b6862a');
  ctx.strokeStyle = grad;
  drawScrollSpiral(ctx, cx-r*0.85, scrollY, 1, 1.65, r);
  drawScrollSpiral(ctx, cx+r*0.85, scrollY, -1, 1.65, r);
  ctx.shadowBlur = size*0.01;
  ctx.fillStyle = GOLD_BRIGHT;
  [[cx-r*0.85-r, scrollY],[cx+r*0.85+r, scrollY]].forEach(([fx,fy])=>{
    ctx.beginPath(); ctx.arc(fx,fy,size*0.02,0,Math.PI*2); ctx.fill();
  });
  const gs = size*0.11;
  ctx.beginPath();
  ctx.moveTo(cx, gemY-gs); ctx.lineTo(cx+gs*0.62, gemY); ctx.lineTo(cx, gemY+gs); ctx.lineTo(cx-gs*0.62, gemY);
  ctx.closePath();
  ctx.fillStyle = GOLD_BRIGHT; ctx.fill();
  ctx.lineWidth = size*0.015; ctx.strokeStyle = '#8a6a1e'; ctx.stroke();
  ctx.shadowBlur = 0;
  return canvasTex(cvs);
}

/* Reflet holographique qui défile sur les cartes flottantes. */
export function makeHoloShineTexture(){
  const size = 256;
  const cvs = newCanvas(size);
  const ctx = cvs.getContext('2d');
  ctx.save();
  ctx.translate(size/2,size/2); ctx.rotate(Math.PI/5); ctx.translate(-size/2,-size/2);
  const grad = ctx.createLinearGradient(0,0,size*0.16,0);
  grad.addColorStop(0,'rgba(255,255,255,0)'); grad.addColorStop(0.5,'rgba(255,255,255,.4)'); grad.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(-size,-size,size*3,size*3);
  ctx.restore();
  const tex = new THREE.CanvasTexture(cvs);
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/* Colonne de lumière de l'orage. */
export function makeBeamTexture(){
  const c = newCanvas(64, 256);
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.00, 'rgba(255,240,190,0)');
  grad.addColorStop(0.45, 'rgba(255,224,130,0.35)');
  grad.addColorStop(0.85, 'rgba(255,236,170,0.85)');
  grad.addColorStop(1.00, 'rgba(255,248,220,0.95)');
  g.fillStyle = grad; g.fillRect(0,0,64,256);
  const side = g.createLinearGradient(0,0,64,0);
  side.addColorStop(0,'rgba(0,0,0,0.35)'); side.addColorStop(0.5,'rgba(255,255,255,0)'); side.addColorStop(1,'rgba(0,0,0,0.35)');
  g.globalCompositeOperation = 'multiply'; g.fillStyle = side; g.fillRect(0,0,64,256);
  return canvasTex(c);
}
