#!/usr/bin/env node
/**
 * Contrôles du vrai bundle de démo, sans modifier le moteur ni simuler ses règles.
 * Usage : node tools/verifier_demo.mjs [--partie] [--sans-captures]
 *         [--fichier dist/demo-golden/index.html] [--reference origin/main]
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, relative, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.error('Playwright absent. Installer Playwright et son Chromium avant ce contrôle.');
  process.exit(2);
}

const racine = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argumentsCommande = process.argv.slice(2);
function argument(nom, valeurDefaut) {
  const index = argumentsCommande.indexOf(nom);
  return index < 0 ? valeurDefaut : argumentsCommande[index + 1];
}
const fichier = resolve(racine, argument('--fichier', 'dist/demo-golden/index.html'));
const reference = argument('--reference', 'origin/main');
const avecPartie = argumentsCommande.includes('--partie');
const avecCaptures = !argumentsCommande.includes('--sans-captures');
const delaiPartie = Number(argument('--delai-partie', '90000'));
const dossierCaptures = resolve(racine, 'docs/captures');
// Certains environnements exposent un chemin Playwright absent ou un Chromium
// système interdisant file://. Préférer le navigateur Playwright installé.
const executableNavigateur = [process.env.PIKAPOLY_CHROME, chromium.executablePath(),
  '/tmp/pikapoly-browser/chromium-1234/chrome-linux64/chrome', '/usr/bin/chromium']
  .find(chemin => chemin && existsSync(chemin));
const rapport = {
  date: new Date().toISOString(), fichier: relative(racine, fichier), reference,
  environnement: 'Chromium cloud ; aucune mesure de fluidité MacBook Air M1',
  controles: [], diagnostics: [], requetesExternes: [], erreursNavigateur: [],
};
let navigateur;
let serveur;

async function controle(nom, action) {
  const debut = Date.now();
  try {
    const detail = await action();
    rapport.controles.push({ nom, resultat: 'OK', dureeMs: Date.now() - debut, detail });
    console.log(`OK — ${nom}`);
    return true;
  } catch (erreur) {
    rapport.controles.push({ nom, resultat: 'ÉCHEC', dureeMs: Date.now() - debut, detail: erreur.message });
    console.error(`ÉCHEC — ${nom} : ${erreur.message}`);
    return false;
  }
}

function git(...argumentsGit) {
  const execution = spawnSync('git', argumentsGit, { cwd: racine, encoding: 'utf8' });
  assert.equal(execution.status, 0, execution.stderr || execution.stdout || 'Échec de Git');
  return execution.stdout;
}

const cheminsProteges = ['Nsldkso.html', 'board3d.js', 'board3d_golden.js', 'tools/build.py'];
const sources = await Promise.all(cheminsProteges.map(chemin => readFile(resolve(racine, chemin), 'utf8')));
const clesProduction = new Set(['pika_mode', 'pikapoly/pochette', 'pikapoly/pochette_vip']);
for (const source of sources) {
  for (const correspondance of source.matchAll(/['"](pika_[a-zA-Z0-9_]+|pikapoly\/pochette(?:_vip)?)['"]/g)) {
    clesProduction.add(correspondance[1]);
  }
}
const sentinelles = {};
for (const cle of clesProduction) {
  sentinelles[cle] = cle === 'pika_mode' ? 'classic' : 'sentinelle-direct-intacte';
  sentinelles[`vip:${cle}`] = 'sentinelle-golden-direct-intacte';
}

async function contexte(options = {}) {
  const contexteNavigateur = await navigateur.newContext({
    viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1,
    reducedMotion: 'reduce', ...options,
  });
  await contexteNavigateur.addInitScript(({ valeurs }) => {
    const ecrire = Storage.prototype.setItem;
    const supprimer = Storage.prototype.removeItem;
    window.__PIKA_TEST_STOCKAGE = [];
    window.__PIKA_TEST_CANAUX = [];
    try {
      for (const [cle, valeur] of Object.entries(valeurs)) {
        if (localStorage.getItem(cle) === null) ecrire.call(localStorage, cle, valeur);
      }
    } catch { /* Le contrôle final signale le stockage indisponible. */ }
    Storage.prototype.setItem = function(cle, valeur) {
      if (this === localStorage) window.__PIKA_TEST_STOCKAGE.push({ action: 'écrire', cle: String(cle) });
      return ecrire.call(this, cle, valeur);
    };
    Storage.prototype.removeItem = function(cle) {
      if (this === localStorage) window.__PIKA_TEST_STOCKAGE.push({ action: 'supprimer', cle: String(cle) });
      return supprimer.call(this, cle);
    };
    const vider = Storage.prototype.clear;
    Storage.prototype.clear = function() {
      if (this === localStorage) window.__PIKA_TEST_STOCKAGE.push({ action: 'vider', cle: '*' });
      return vider.call(this);
    };
    if (window.BroadcastChannel) {
      const Canal = window.BroadcastChannel;
      window.BroadcastChannel = class extends Canal {
        constructor(nom) {
          super(nom);
          window.__PIKA_TEST_CANAUX.push(String(nom));
        }
      };
    }
  }, { valeurs: sentinelles });
  await contexteNavigateur.route('**/*', async route => {
    const url = route.request().url();
    if (/^https?:/.test(url) && !/^http:\/\/127\.0\.0\.1:\d+\//.test(url)) {
      rapport.requetesExternes.push(url);
      await route.abort('blockedbyclient');
    } else await route.continue();
  });
  contexteNavigateur.on('page', page => {
    page.on('pageerror', erreur => rapport.erreursNavigateur.push({ url: page.url(), message: erreur.message }));
    page.on('console', message => {
      if (message.type() === 'error') rapport.erreursNavigateur.push({ url: page.url(), message: message.text() });
    });
  });
  return contexteNavigateur;
}

async function charger(page, url, mode = 'vip') {
  // Le choix du plateau est lu au démarrage ; changer seulement #vip ne
  // relance pas le moteur. Forcer un nouveau document dans ce cas également.
  if (page.url() !== 'about:blank') await page.goto('about:blank');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(modeAttendu => {
    const canvas = document.querySelector('#gl');
    return window.__PIKA_MODE === modeAttendu && typeof window.__pikaPeutBasculer === 'function'
      && canvas?.width > 0 && canvas?.height > 0
      && (modeAttendu !== 'vip' || (typeof window.__PIKA_ARENE?.diagnostics === 'function'
        && typeof window.__PIKA_DEMO_DIAGNOSTIC === 'function'
        && window.__PIKA_ARENE.diagnostics().temps > 0));
  }, mode, { timeout: 45000, polling: 200 });
  await page.waitForTimeout(550);
}

async function verifierIsolation(page) {
  const etat = await page.evaluate(valeurs => ({
    sentinellesModifiees: Object.keys(valeurs).filter(cle => localStorage.getItem(cle) !== valeurs[cle]),
    ecritures: window.__PIKA_TEST_STOCKAGE || [],
    canaux: window.__PIKA_TEST_CANAUX || [],
    clesDemo: Object.keys(localStorage).filter(cle => cle.startsWith('demo:')),
  }), sentinelles);
  assert.deepEqual(etat.sentinellesModifiees, [], 'Un état de la version des directs a été modifié');
  assert.deepEqual(etat.ecritures.filter(ecriture => !ecriture.cle.startsWith('demo:')), [],
    'Une écriture sort du préfixe demo:');
  assert.ok(etat.clesDemo.length > 0, 'La démo ne sauvegarde aucun état isolé');
  assert.ok(etat.canaux.length > 0, 'Le canal de synchronisation est absent');
  assert.ok(etat.canaux.every(canal => canal.startsWith('demo:')), 'Un canal pourrait piloter le jeu des directs');
  return { clesDemo: etat.clesDemo, canaux: etat.canaux };
}

async function capturer(page, nom) {
  if (!avecCaptures) return;
  await mkdir(dossierCaptures, { recursive: true });
  await page.screenshot({ path: resolve(dossierCaptures, `${nom}.png`), timeout: 45000 });
}

async function diagnostics(page) {
  return page.evaluate(() => ({
    moteur: window.__PIKA_DEMO_DIAGNOSTIC(),
    arene: window.__PIKA_ARENE.diagnostics(),
  }));
}

async function verifierDistribution(page, urlFichier) {
  const pokemonVus = new Set();
  const attaquesVues = new Set();
  const echantillons = [];
  for (let duel = 0; duel < 9; duel++) {
    const temps = duel * 22 + 18.6;
    await charger(page, `${urlFichier}?spectacle_t=${temps}#vip`);
    const diagnostic = await diagnostics(page);
    assert.equal(diagnostic.arene.temps, temps, 'Le temps de capture du spectacle n’est pas appliqué');
    assert.equal(diagnostic.arene.personnagesVisibles, 2, 'Le duel ne montre pas deux personnages 3D');
    assert.ok(diagnostic.arene.maillagesModelesVisibles > 5, 'Les personnages n’ont pas de maillages visibles');
    assert.ok(diagnostic.arene.trianglesModeles > 100, 'Les personnages 3D sont absents');
    assert.equal(diagnostic.arene.type, 'duo', 'La finale ne combine pas les deux attaques');
    assert.equal(diagnostic.moteur.cases, 36, 'Le spectacle change le nombre de cases du moteur');
    assert.equal(diagnostic.moteur.index, -1, 'Le spectacle seul déplace le pion');
    diagnostic.arene.pokemon.forEach(nom => pokemonVus.add(nom));
    diagnostic.arene.attaque.split(' × ').forEach(nom => attaquesVues.add(nom));
    echantillons.push(diagnostic);
    await capturer(page, `demo-duel-${duel + 1}`);
    await verifierIsolation(page);
    console.log(`  Duel ${duel + 1}/9 — ${diagnostic.arene.pokemon.join(' / ')} · ${diagnostic.arene.attaque}`);
  }
  assert.deepEqual([...pokemonVus].sort(), ['Pikachu', 'Dracaufeu', 'Rayquaza', 'Mewtwo', 'Mew', 'Deoxys', 'Braségali'].sort(),
    'La distribution ne couvre pas les sept Pokémon demandés');
  for (const attaque of ['Tonnerre', 'Fatal-Foudre', 'Lance-Flammes', 'Déflagration', 'Draco-Ascension', 'Ultralaser', 'Frappe Psy', 'Psyko', 'Pied Brûleur']) {
    assert.ok(attaquesVues.has(attaque), `L’attaque ${attaque} n’a pas été présentée`);
  }
  rapport.diagnostics.push(...echantillons);
  return { pokemon: [...pokemonVus], attaques: [...attaquesVues], nombreDuels: echantillons.length };
}

async function interfaceSilencieuse(page) {
  return page.evaluate(() => {
    const ids = ['status', 'tvRolls', 'tvTotal', 'placeBanner', 'celebMain', 'celebSub', 'cardDrawTitle'];
    const textes = Object.fromEntries(ids.map(id => [id, document.getElementById(id)?.textContent]));
    const alertes = [...document.querySelectorAll('.key-hint.show')].map(noeud => noeud.textContent);
    const annonces = ['celebration', 'cardDrawOverlay', 'mysteryOverlay'].map(id => ({
      id, visible: document.getElementById(id)?.classList.contains('show'),
    }));
    return { textes, alertes, annonces };
  });
}

async function verifierGeometrieEcran(page) {
  const geometrie = await page.evaluate(() => {
    const mesurer = id => {
      const rectangle = document.getElementById(id)?.getBoundingClientRect();
      return rectangle ? { x: rectangle.x, y: rectangle.y, largeur: rectangle.width, hauteur: rectangle.height } : null;
    };
    return { app: mesurer('app'), plateau: mesurer('boardWrap'), canvas: mesurer('gl'),
      ecran: { largeur: innerWidth, hauteur: innerHeight }, rotation: document.documentElement.className };
  });
  for (const nom of ['app', 'plateau', 'canvas']) {
    assert.ok(geometrie[nom]?.largeur > 0 && geometrie[nom]?.hauteur > 0, `${nom} n'occupe aucune surface`);
  }
  const p = geometrie.plateau;
  assert.ok(p.x < geometrie.ecran.largeur && p.y < geometrie.ecran.hauteur
    && p.x + p.largeur > 0 && p.y + p.hauteur > 0, 'Le plateau est hors écran');
  return geometrie;
}

async function verifierPartie(page) {
  // La pleine définition est contrôlée séparément. Une surface réduite
  // permet au GPU logiciel du cloud de suivre les vrais temps du moteur.
  await page.setViewportSize({ width: 960, height: 540 });
  await page.keyboard.press('a');
  const compteurs = () => page.evaluate(() => {
    const cles = Object.keys(localStorage).filter(cle => cle.startsWith('demo:vip:'));
    const trouver = suffixe => Number(localStorage.getItem(cles.find(cle => cle.endsWith(suffixe))) || 0);
    return { mise: trouver('pika_total_mise_live1'), paye: trouver('pika_total_paid_live1') };
  });
  const avant = await compteurs();
  await page.keyboard.press('b');
  await page.waitForFunction(mise => window.__PIKA_DEMO_DIAGNOSTIC?.().totalMise === mise + 29,
    avant.mise, { timeout: 30000, polling: 100 });
  console.log('  Partie — B a crédité la mise, attente de la case');
  await page.waitForFunction(() => {
    const bouton = document.getElementById('winBtn');
    return bouton && !bouton.hidden && !bouton.disabled
      && !document.getElementById('cardDrawOverlay')?.classList.contains('show');
  }, null, { timeout: delaiPartie, polling: 250 });
  const arrivee = await compteurs();
  console.log('  Partie — lot proposé à l’arrivée');
  assert.equal(arrivee.mise, avant.mise + 29, 'Le premier lancer Golden ne crédite pas la mise habituelle');
  const photoCase = await page.locator('#celebPhoto').getAttribute('src');
  const diagnosticArrivee = await diagnostics(page);
  assert.ok(diagnosticArrivee.moteur.index > 0, 'Le pion n’a pas atteint de case de lot');
  await page.keyboard.press('d');
  await page.waitForFunction(() => {
    const bouton = document.getElementById('undoBtn');
    return bouton && !bouton.hidden && document.getElementById('celebration')?.classList.contains('show');
  }, null, { timeout: delaiPartie, polling: 250 });
  const garde = await compteurs();
  console.log('  Partie — D a verrouillé l’annonce');
  const diagnosticGarde = await diagnostics(page);
  assert.equal(diagnosticGarde.moteur.categorie, diagnosticArrivee.moteur.categorie,
    'Garder le lot change la catégorie de la case d’arrivée');
  assert.equal(diagnosticGarde.moteur.annonceVerrouillee, true, 'L’annonce de lot gardé n’est pas verrouillée');
  assert.ok(diagnosticGarde.moteur.totalPaid <= diagnosticGarde.moteur.plafond + 1e-6,
    'Le paiement observé dépasse le plafond du moteur');
  assert.ok(garde.paye >= arrivee.paye, 'Le lot gardé diminue le compteur');
  assert.equal(await page.locator('#celebPhoto').getAttribute('src'), photoCase,
    'La photo du lot annoncé ne correspond plus à celle de la case d’arrivée');
  const disparitions = await page.evaluate(async () => {
    const celebration = document.getElementById('celebration');
    let disparitions = 0;
    const observateur = new MutationObserver(() => {
      if (!celebration.classList.contains('show')) disparitions++;
    });
    observateur.observe(celebration, { attributes: true, attributeFilter: ['class'] });
    await new Promise(resoudre => setTimeout(resoudre, 7200));
    observateur.disconnect();
    return { disparitions, visible: celebration.classList.contains('show') };
  });
  assert.deepEqual(disparitions, { disparitions: 0, visible: true }, 'L’annonce s’est effacée sans commande');
  console.log('  Partie — annonce maintenue 7,2 secondes');
  await page.keyboard.press('u');
  await page.waitForFunction(() => document.querySelector('#status')?.textContent.includes('annulée'),
    null, { timeout: 30000, polling: 100 });
  assert.equal((await compteurs()).paye, arrivee.paye, 'U ne restitue pas le compteur avant validation');
  await page.keyboard.press('c');
  await page.waitForFunction(() => !document.getElementById('startBtn').hidden
    && !document.getElementById('celebration').classList.contains('show'),
    null, { timeout: 30000, polling: 100 });
  return { avant, arrivee, garde, annonceObserveeMs: 7200 };
}

async function verifierSynchronisation() {
  const dossierBundle = dirname(fichier);
  serveur = createServer(async (requete, reponse) => {
    try {
      const cheminUrl = decodeURIComponent(new URL(requete.url, 'http://localhost').pathname);
      if (cheminUrl === '/favicon.ico') { reponse.writeHead(204); reponse.end(); return; }
      const chemin = resolve(dossierBundle, `.${cheminUrl}`);
      if (!chemin.startsWith(`${dossierBundle}/`)) { reponse.writeHead(403); reponse.end(); return; }
      const contenu = await readFile(chemin);
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
        '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json' };
      reponse.writeHead(200, { 'Content-Type': types[extname(chemin)] || 'application/octet-stream' });
      reponse.end(contenu);
    } catch { reponse.writeHead(404); reponse.end(); }
  });
  await new Promise(resoudre => serveur.listen(0, '127.0.0.1', resoudre));
  const base = `http://127.0.0.1:${serveur.address().port}/${encodeURIComponent(fichier.split('/').pop())}`;
  const contexteNavigateur = await contexte();
  try {
    const regie = await contexteNavigateur.newPage();
    const publicPage = await contexteNavigateur.newPage();
    await charger(regie, `${base}?spectacle_t=6#vip`);
    await charger(publicPage, `${base}?view=display&spectacle_t=6#vip`);
    assert.ok(await publicPage.evaluate(() => document.documentElement.classList.contains('display-mode')),
      'L’écran public n’est pas en lecture seule');
    await regie.keyboard.press('a');
    await publicPage.waitForFunction(() => document.getElementById('startBtn').hidden,
      null, { timeout: 6000, polling: 100 });
    await publicPage.keyboard.press('c');
    assert.ok(await regie.evaluate(() => document.getElementById('startBtn').hidden),
      'Une touche de l’écran public a piloté la régie');
    await regie.keyboard.press('c');
    await publicPage.waitForFunction(() => !document.getElementById('startBtn').hidden,
      null, { timeout: 6000, polling: 100 });
    await capturer(publicPage, 'demo-public-paysage');
    await verifierIsolation(regie);
    await verifierIsolation(publicPage);
    return 'A et C synchronisés ; commandes de jeu de l’écran public ignorées ; canaux isolés.';
  } finally { await contexteNavigateur.close(); }
}

try {
  await controle('Sources du jeu des directs conservées', async () => {
    for (let i = 0; i < cheminsProteges.length; i++) {
      assert.equal(sources[i], git('show', `${reference}:${cheminsProteges[i]}`), `${cheminsProteges[i]} a été modifié`);
    }
    return 'HTML, deux moteurs et constructeur historique identiques à la référence Git.';
  });
  if (!existsSync(fichier)) throw new Error(`Bundle absent : ${fichier}. Construire la démo avant de lancer ce script.`);
  navigateur = await chromium.launch({ headless: true,
    ...(executableNavigateur ? { executablePath: executableNavigateur } : {}), args: [
    '--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ] });

  const contexteHorsLigne = await contexte();
  await contexteHorsLigne.setOffline(true);
  const page = await contexteHorsLigne.newPage();
  const urlFichier = pathToFileURL(fichier).href;
  const charge = await controle('Golden hors ligne en double-clic, paysage 1920 × 1080', async () => {
    await charger(page, `${urlFichier}?spectacle_t=6#vip`);
    const diagnostic = await diagnostics(page);
    rapport.diagnostics.push(diagnostic);
    assert.equal(diagnostic.moteur.cases, 36);
    assert.equal(diagnostic.arene.personnagesVisibles, 2);
    const geometrie = await verifierGeometrieEcran(page);
    await capturer(page, 'demo-golden-paysage');
    return { geometrie, isolation: await verifierIsolation(page) };
  });

  if (charge) {
    await controle('X / Y / Z arment et annulent sans annonce à l’écran', async () => {
      const avant = await interfaceSilencieuse(page);
      for (const touche of ['x', 'y', 'z']) {
        await page.keyboard.press(touche);
        assert.deepEqual(await interfaceSilencieuse(page), avant, `${touche.toUpperCase()} révèle l’armement`);
        await page.keyboard.press(touche);
        assert.deepEqual(await interfaceSilencieuse(page), avant, `${touche.toUpperCase()} révèle l’annulation`);
      }
      return 'Textes de statut, compteur, case, annonces et notifications identiques.';
    });
    await controle('A démarre, M ouvre les règles, Échap les ferme et C recommence', async () => {
      await page.keyboard.press('a');
      assert.ok(await page.evaluate(() => document.getElementById('startBtn').hidden));
      await page.keyboard.press('m');
      assert.equal(await page.locator('#rulesOverlay').getAttribute('aria-hidden'), 'false');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#rulesOverlay').getAttribute('aria-hidden'), 'true');
      await page.keyboard.press('c');
      assert.ok(await page.evaluate(() => !document.getElementById('startBtn').hidden));
      return await verifierIsolation(page);
    });
    await controle('F ouvre puis ferme le plein écran', async () => {
      await page.keyboard.press('f');
      await page.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 6000, polling: 100 });
      await page.keyboard.press('f');
      await page.waitForFunction(() => !document.fullscreenElement, null, { timeout: 6000, polling: 100 });
    });
    await controle('R conserve le cycle 90° → 270° → 0°', async () => {
      await page.keyboard.press('r');
      assert.ok(await page.evaluate(() => document.documentElement.classList.contains('rot90')));
      await page.waitForTimeout(400);
      await verifierGeometrieEcran(page);
      await capturer(page, 'demo-golden-pivotee');
      await page.keyboard.press('r');
      assert.ok(await page.evaluate(() => document.documentElement.classList.contains('rot270')));
      await page.keyboard.press('r');
      assert.ok(await page.evaluate(() => !document.documentElement.classList.contains('rotated')));
      return await verifierIsolation(page);
    });
    await controle('Golden portrait 1080 × 1920 hors ligne', async () => {
      await page.setViewportSize({ width: 1080, height: 1920 });
      await page.waitForTimeout(500);
      const geometrie = await verifierGeometrieEcran(page);
      await capturer(page, 'demo-golden-vertical');
      return geometrie;
    });
    await controle('G bascule vers le Classique, toujours hors ligne', async () => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.keyboard.press('g');
      await page.waitForFunction(() => window.__PIKA_MODE === 'classic'
        && typeof window.__pikaPeutBasculer === 'function', null, { timeout: 45000, polling: 200 });
      await page.waitForTimeout(500);
      await capturer(page, 'demo-classique-paysage');
      return { geometrie: await verifierGeometrieEcran(page), isolation: await verifierIsolation(page) };
    });
    if (avecPartie) {
      await controle('B tire, D garde le lot, annonce persistante, U annule et C efface', async () => {
        await charger(page, `${urlFichier}?spectacle_t=6#vip`);
        return await verifierPartie(page);
      });
    } else {
      rapport.controles.push({ nom: 'Partie complète B / D / U et annonce persistante', resultat: 'À EXÉCUTER',
        detail: 'Ajouter --partie ; les animations WebGL sur SwiftShader peuvent dépasser le délai.' });
    }
    await controle('Neuf duels, sept Pokémon en 3D et attaques de la distribution',
      () => verifierDistribution(page, urlFichier));
  }
  await contexteHorsLigne.close();
  await controle('Écran public synchronisé et protégé, via serveur local sans dépendance extérieure', verifierSynchronisation);
  await controle('Aucune requête extérieure, aucune erreur JavaScript ou console', async () => {
    assert.deepEqual(rapport.requetesExternes, [], 'Des médias ou dépendances sortent du dossier de présentation');
    assert.deepEqual(rapport.erreursNavigateur, [], 'Le navigateur a signalé des erreurs');
  });
} catch (erreur) {
  rapport.controles.push({ nom: 'Exécution de la vérification', resultat: 'ÉCHEC', detail: erreur.message });
  console.error(erreur.message);
} finally {
  if (navigateur) await navigateur.close();
  if (serveur) await new Promise(resoudre => serveur.close(resoudre));
  const cheminRapport = resolve(dirname(fichier), 'rapport-verification.json');
  await mkdir(dirname(cheminRapport), { recursive: true });
  await writeFile(cheminRapport, `${JSON.stringify(rapport, null, 2)}\n`);
  console.log(`Rapport : ${relative(racine, cheminRapport)}`);
}

process.exitCode = rapport.controles.some(controle => controle.resultat === 'ÉCHEC') ? 1 : 0;
