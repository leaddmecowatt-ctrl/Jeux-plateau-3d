import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const [,, A, C] = process.argv;
const b = await chromium.launch({ args:['--no-sandbox'] }); const p = await b.newPage();
const a = 'data:image/png;base64,' + readFileSync(A).toString('base64');
const c = 'data:image/png;base64,' + readFileSync(C).toString('base64');
const r = await p.evaluate(async ([a, c]) => {
  const load = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = src; });
  const [ia, ic] = await Promise.all([load(a), load(c)]);
  const w = ia.width, h = ia.height, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(ia, 0, 0); const A = ctx.getImageData(0, 0, w, h).data;
  ctx.drawImage(ic, 0, 0); const C = ctx.getImageData(0, 0, w, h).data;
  let sum = 0, gros = 0, max = 0; const n = w * h;
  for (let i = 0; i < n; i++) { const d = Math.max(Math.abs(A[i*4]-C[i*4]), Math.abs(A[i*4+1]-C[i*4+1]), Math.abs(A[i*4+2]-C[i*4+2])); sum += d; if (d > 24) gros++; if (d > max) max = d; }
  return { w, h, moy: (sum / n).toFixed(2), max, gros, pct: (100 * gros / n).toFixed(3) };
}, [a, c]);
console.log(`${A.split('/').pop()} vs ${C.split('/').pop()} · ${r.w}x${r.h} · écart moyen ${r.moy}/255 · max ${r.max} · pixels >24 : ${r.gros} (${r.pct} %)`);
await b.close();
