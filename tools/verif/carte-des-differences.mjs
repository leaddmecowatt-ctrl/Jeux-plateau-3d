import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
const [,, A, C, OUT] = process.argv;
const b = await chromium.launch({ args:['--no-sandbox'] }); const p = await b.newPage();
const a = 'data:image/png;base64,' + readFileSync(A).toString('base64');
const c = 'data:image/png;base64,' + readFileSync(C).toString('base64');
const url = await p.evaluate(async ([a, c]) => {
  const load = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = src; });
  const [ia, ic] = await Promise.all([load(a), load(c)]);
  const w = ia.width, h = ia.height, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(ia, 0, 0); const A = ctx.getImageData(0, 0, w, h);
  ctx.drawImage(ic, 0, 0); const C = ctx.getImageData(0, 0, w, h).data;
  const o = ctx.createImageData(w, h);
  for (let i = 0; i < w*h; i++) {
    const d = Math.max(Math.abs(A.data[i*4]-C[i*4]), Math.abs(A.data[i*4+1]-C[i*4+1]), Math.abs(A.data[i*4+2]-C[i*4+2]));
    const g = A.data[i*4]*0.3+A.data[i*4+1]*0.59+A.data[i*4+2]*0.11;   // fond : l'image en gris très sombre
    o.data[i*4] = d > 24 ? 255 : g*0.25; o.data[i*4+1] = d > 24 ? 0 : g*0.25; o.data[i*4+2] = d > 24 ? 0 : g*0.25; o.data[i*4+3] = 255;
  }
  ctx.putImageData(o, 0, 0); return cv.toDataURL('image/png');
}, [a, c]);
writeFileSync(OUT, Buffer.from(url.split(',')[1], 'base64')); console.log('écrit', OUT.split('/').pop());
await b.close();
