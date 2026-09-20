import { chromium } from 'playwright';
const NB = Number(process.argv[2] || 12);
const b = await chromium.launch({ args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage();
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR: '+e.message));
p.on('console', m => { if(m.type()==='error' && !/ERR_CERT/.test(m.text())) errs.push('CONSOLE: '+m.text()); });
p.on('crash', () => errs.push('*** LA PAGE A CRASHÉ ***'));
const cdp = await p.context().newCDPSession(p);
await cdp.send('Performance.enable'); await cdp.send('HeapProfiler.enable');
let perteContexte = 0;

await p.goto('file://' + process.env.SONDE);
await p.waitForTimeout(10000);
await p.evaluate(() => { window.__lost = 0;
  document.querySelector('canvas').addEventListener('webglcontextlost', () => window.__lost++); });

const mesure = async (tag) => {
  await cdp.send('HeapProfiler.collectGarbage');
  await p.waitForTimeout(400);
  const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));
  const g = await p.evaluate(() => ({ ...window.__dbg(), lost: window.__lost }));
  const l = { tag, mo:+(m.JSHeapUsedSize/1048576).toFixed(2), noeuds:m.Nodes, ecout:m.JSEventListeners,
              geo:g.geometries, tex:g.textures, prog:g.programmes, objets:g.objetsScene, ctxPerdu:g.lost };
  console.log(JSON.stringify(l)); return l;
};
const L = [await mesure('reference')];
for(let i=1;i<=NB;i++){
  await p.keyboard.press('a'); await p.waitForTimeout(1200);
  for(let r=0;r<3;r++){ await p.keyboard.press('b'); await p.waitForTimeout(8500); }
  await p.keyboard.press('d'); await p.waitForTimeout(2500);
  await p.keyboard.press('c'); await p.waitForTimeout(1800);
  L.push(await mesure('p'+i));
}
console.log('ERREURS: ' + (errs.length ? errs.join(' | ') : 'AUCUNE'));
const a = L[1], z = L[L.length-1], n = L.length-2;
console.log(`PENTE PAR PARTIE : ${((z.mo-a.mo)/n).toFixed(3)} Mo · ${((z.geo-a.geo)/n).toFixed(2)} géométries · ${((z.tex-a.tex)/n).toFixed(2)} textures · ${((z.objets-a.objets)/n).toFixed(2)} objets 3D · ${((z.noeuds-a.noeuds)/n).toFixed(1)} nœuds`);
await b.close();
