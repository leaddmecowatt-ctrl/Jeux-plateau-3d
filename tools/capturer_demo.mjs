#!/usr/bin/env node
/* Captures du vrai rendu, après chargement de Luffy. SwiftShader ne sert
   qu'à la relecture visuelle : aucune cadence GPU n'est déduite de ces images. */
import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url);
const {chromium}=require('playwright');
const cheminChrome=[process.env.PIKAPOLY_CHROME,chromium.executablePath(),'/tmp/pikapoly-browser/chromium-1234/chrome-linux64/chrome','/usr/bin/chromium'].find(p=>p&&existsSync(p));
if(!cheminChrome)throw new Error('Chromium absent : installer le navigateur de Playwright.');
const fichier=resolve(process.argv[2]||'dist/demo-golden/index.html');
const navigateur=await chromium.launch({executablePath:cheminChrome,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const prises=[
  ['demo-golden-paysage',1920,1080,6],
  ['demo-golden-vertical',1080,1920,6],
  ['demo-rayquaza-mewtwo',1920,1080,28],
  ['demo-mew-deoxys',1920,1080,50],
  ['demo-brasegali-dracaufeu',1920,1080,72],
  ['demo-flammes',1920,1080,13],
  ['demo-golden-pivotee',1920,1080,6,true]
];
await mkdir('docs/captures',{recursive:true});
try{
 for(const [nom,largeur,hauteur,temps,pivoter] of prises){
  const page=await navigateur.newPage({viewport:{width:largeur,height:hauteur},deviceScaleFactor:1,reducedMotion:'reduce'});
  const erreurs=[];page.on('pageerror',e=>erreurs.push(e.message));
  // Le gel de requestAnimationFrame est limité à cet outil de capture.
  // Il évite que la boucle WebGL logicielle monopolise le compositeur.
  await page.addInitScript(()=>{let n=0;const r=window.requestAnimationFrame;window.requestAnimationFrame=f=>n++<2?r(f):0;});
  await page.goto(pathToFileURL(fichier).href+`?spectacle_t=${temps}#vip`,{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>window.__PIKA_DEMO_DIAGNOSTIC?.().joueurCharge,null,{timeout:60000,polling:200});
  if(pivoter){await page.keyboard.press('r');await page.waitForTimeout(350);}
  await page.evaluate(()=>window.__PIKA_DEMO_CAPTURE());
  await page.screenshot({path:`docs/captures/${nom}.png`,timeout:60000,animations:'disabled'});
  if(erreurs.length)throw new Error(`${nom} : ${erreurs.join('; ')}`);
  console.log(`${nom} : ${JSON.stringify(await page.evaluate(()=>window.__PIKA_DEMO_DIAGNOSTIC().spectacle))}`);
  await page.close();
 }
}finally{await navigateur.close();}
