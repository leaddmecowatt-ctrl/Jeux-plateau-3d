import { chromium } from 'playwright';
const [,, bundle, out, w, h] = process.argv;
const b = await chromium.launch({ args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport:{ width:+w, height:+h } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR: '+e.message));
p.on('console', m => { if(m.type()==='error' && !/ERR_CERT/.test(m.text())) errs.push('CONSOLE: '+m.text()); });
await p.goto('file://'+bundle); await p.waitForTimeout(9000);
await p.screenshot({ path: out });
const info = await p.evaluate(() => ({
  bandes: document.querySelectorAll('.bg-band').length,
  canvasFond: !!document.getElementById('bgWave'),
  tailleCanvas: (c => c ? c.width+'x'+c.height : null)(document.getElementById('bgWave')),
}));
console.log(out.split('/').pop(), JSON.stringify(info), 'erreurs:', errs.length ? errs.join(' | ') : 'aucune');
await b.close();
