import { chromium } from 'playwright';
const b = await chromium.launch({ args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport:{ width:1080, height:1920 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR: '+e.message));
p.on('console', m => { if(m.type()==='error' && !/ERR_CERT/.test(m.text())) errs.push('CONSOLE: '+m.text()); });
await p.goto('file://'+process.argv[2]); await p.waitForTimeout(8000);
const lire = () => p.evaluate(() => ({ mise: localStorage.getItem('pika_total_mise'), paye: localStorage.getItem('pika_total_paid'), pos: JSON.parse(localStorage.getItem('pika_outcome_batch')||'{}').pos }));
console.log('avant          :', JSON.stringify(await lire()));
// partie normale
await p.keyboard.press('a'); await p.waitForTimeout(800);
for(let i=0;i<3;i++){ await p.keyboard.press('b'); await p.waitForTimeout(7000); }
await p.keyboard.press('d'); await p.waitForTimeout(2500);
console.log('partie normale :', JSON.stringify(await lire()));
await p.keyboard.press('c'); await p.waitForTimeout(1500);
// jackpot forcé : Z AVANT le premier lancer (au départ, index -1)
await p.keyboard.press('z'); await p.waitForTimeout(300);
await p.keyboard.press('a'); await p.waitForTimeout(800);
for(let i=0;i<4;i++){ await p.keyboard.press('b'); await p.waitForTimeout(7000); }
await p.keyboard.press('d'); await p.waitForTimeout(2500);
await p.screenshot({ path: process.argv[3] });
await p.waitForTimeout(8000);
const banner = await p.evaluate(() => (document.getElementById('celebMain')||{}).textContent);
console.log('jackpot forcé  :', JSON.stringify(await lire()), '· annonce :', banner, '· erreurs :', errs.length ? errs.join(' | ') : 'aucune');
await b.close();
