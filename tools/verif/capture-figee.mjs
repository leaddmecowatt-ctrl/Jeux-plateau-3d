import { chromium } from 'playwright';
const [,, bundle, out, w, h, jouer] = process.argv;
const b = await chromium.launch({ args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport:{ width:+w, height:+h } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR: '+e.message));
p.on('console', m => { if(m.type()==='error' && !/ERR_CERT/.test(m.text())) errs.push('CONSOLE: '+m.text()); });
if(!jouer) await p.emulateMedia({ reducedMotion:'reduce' });
await p.goto('file://'+bundle); await p.waitForTimeout(9000);
if(jouer){ await p.keyboard.press('a'); await p.waitForTimeout(1200); for(const k of ['b','b','b']){ await p.keyboard.press(k); await p.waitForTimeout(7000); } await p.keyboard.press('d'); await p.waitForTimeout(3000); await p.keyboard.press('c'); await p.waitForTimeout(1500); }
await p.screenshot({ path: out });
console.log(out.split('/').pop(), '· erreurs :', errs.length ? errs.join(' | ') : 'aucune');
await b.close();
