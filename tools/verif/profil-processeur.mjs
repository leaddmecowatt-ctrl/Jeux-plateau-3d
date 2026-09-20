import { chromium } from 'playwright';
const b = await chromium.launch({ args:['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport:{ width:1080, height:1920 } });
await p.goto('file://'+process.argv[2]); await p.waitForTimeout(8000);
const cdp = await p.context().newCDPSession(p);
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
for (const [tag, act] of [['repos', async()=>{ await p.waitForTimeout(6000); }], ['deplacement', async()=>{ await p.keyboard.press('a'); await p.waitForTimeout(800); await p.keyboard.press('b'); await p.waitForTimeout(6000); }]]) {
  await cdp.send('Profiler.start'); await act(); const { profile } = await cdp.send('Profiler.stop');
  const self = new Map(); const byId = new Map(profile.nodes.map(n => [n.id, n]));
  const dt = profile.timeDeltas; let total = 0;
  for (let i = 0; i < profile.samples.length; i++) { const n = byId.get(profile.samples[i]); const k = (n.callFrame.functionName || '(anonyme)') + ' ' + (n.callFrame.url.split('/').pop()||'') + ':' + n.callFrame.lineNumber; self.set(k, (self.get(k)||0) + dt[i]); total += dt[i]; }
  const idle = [...self.entries()].filter(([k]) => /^\(idle\)|^\(program\)|^\(garbage/.test(k)).reduce((a,[,v])=>a+v,0);
  console.log(`\n=== ${tag} : ${(total/1000).toFixed(0)} ms échantillonnés, dont ${((total-idle)/1000).toFixed(0)} ms de JS actif ===`);
  [...self.entries()].filter(([k]) => !/^\(idle\)|^\(program\)|^\(garbage/.test(k)).sort((a,b)=>b[1]-a[1]).slice(0,22).forEach(([k,v]) => console.log(`${(100*v/(total-idle)).toFixed(1).padStart(5)} %  ${k}`));
}
await b.close();
