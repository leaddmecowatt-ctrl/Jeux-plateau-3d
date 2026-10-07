#!/usr/bin/env python3
"""Construit la démo hors ligne sans écrire dans les sources du jeu de direct.

Les retouches du décor sont appliquées à une copie temporaire. Le constructeur
d'origine reste l'unique assembleur du moteur et de ses deux plateaux.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import tempfile
import zipfile

RACINE = Path(__file__).resolve().parents[1]
SOURCES_DIRECT = ('Nsldkso.html', 'board3d.js', 'board3d_golden.js', 'tools/build.py')


def empreinte(chemin):
    return hashlib.sha256(chemin.read_bytes()).hexdigest()


def remplacer(source, ancien, nouveau, nombre=1):
    trouve = source.count(ancien)
    if trouve != nombre:
        raise SystemExit(f'Construction arrêtée : repère attendu {nombre} fois, trouvé {trouve} : {ancien[:100]}')
    return source.replace(ancien, nouveau)


def isoler(source, golden=False):
    stockage = 'window.__demoVipStorage.' if golden else 'window.__demoStorage.'
    source = source.replace('localStorage.', stockage)
    source = source.replace("'pikajackpot-sync'", "'demo:pikajackpot-sync-vip'" if golden else "'demo:pikajackpot-sync'")
    source = source.replace("'pikapoly/pochette'", "'demo-pikapoly/pochette-vip'" if golden else "'demo-pikapoly/pochette'")
    return source


def retoucher_golden(source):
    source = isoler(source, golden=True)
    source = remplacer(source, "import * as THREE from 'three';", """import * as THREE from 'three';
import { installerArene } from './demo/arene.js';
import { installerForteresse } from './demo/forteresse.js';
import { installerSon } from './demo/son.js';
let __demoArene = null;
""")
    debut = '/* ---------- VIP : FORTERESSE D\'OR 24 carats — tours, remparts, trésor ---------- */'
    fin = '/* ---------- Base du plateau en feuille d\'or ----------'
    if source.count(debut) != 1 or source.count(fin) != 1:
        raise SystemExit('Repères de forteresse modifiés : revue du constructeur nécessaire.')
    a, b = source.index(debut), source.index(fin)
    source = source[:a] + "installerForteresse({THREE, boardGroup, taille:N_SIDE*CELL});\n" + source[b:]
    source = remplacer(source, '  composer.render();', '  if(__demoArene) __demoArene.update(t, dt, ecoMode);\n  composer.render();')
    source = remplacer(source, 'const DPR_MAX = Math.min(window.devicePixelRatio||1, 2);', 'const DPR_MAX = Math.min(window.devicePixelRatio||1, 1.25);')
    source = remplacer(source, 'renderer.toneMappingExposure = 1.42;', 'renderer.toneMappingExposure = 1.18;')
    source = remplacer(source, 'const S = _mobile ? 1024 : 2048;', 'const S = 1024; // Profil MacBook Air M1 : ombres limitées à 1024 pixels.')
    # Réduire les émissions continues du métal ; seules les attaques produisent
    # des éclats très lumineux. Les matériaux de lot et catégories sont conservés.
    source = remplacer(source, 'emissiveIntensity: emi,', 'emissiveIntensity: emi * 0.22,')
    source += """
/* Démo de présentation : extensions strictement visuelles. */
centerPlate.visible = false;
ccMesh.visible = false;
controls.autoRotate = false;
hemiLight.color.setHex(0xffeed4); hemiLight.groundColor.setHex(0x192335);
hemiLight.intensity = 1.0;
fill.color.setHex(0xa7c9ff); fill.intensity = .6;
rim.intensity = 1.1;
__demoArene = installerArene({THREE,scene,renderer,camera,boardGroup});
installerSon();
const __boutonQualite = document.getElementById('demo-qualite');
__boutonQualite?.addEventListener('click', ()=>{
  const economie = !ecoMode;
  QUALITY.locked = economie;
  if(!economie){ QUALITY.level=0; QUALITY.base=0; QUALITY.floor=0; applyQuality(0); }
  setEcoMode(economie);
  __boutonQualite.setAttribute('aria-pressed', String(economie));
  __boutonQualite.textContent = economie ? 'Mode économie' : 'Qualité cinéma';
});
window.__PIKA_DEMO_DIAGNOSTIC = ()=>({
  plateau:window.__PIKA_MODE, cases:N_TILES, index:currentIndex,
  joueurCharge:Boolean(player.model),
  categorie:tiles[currentIndex]?.catKey || null,
  annonceVerrouillee:celebLocked, totalMise, totalPaid,
  plafond:ceilingFor(totalMise), pochette:outcomeState.pos,
  eco:ecoMode, dessin:renderer.info.render.calls,
  triangles:renderer.info.render.triangles,
  pixels:renderer.getPixelRatio(),
  spectacle:__demoArene?.diagnostics()
});
// Relecture graphique : une image sans faire avancer une partie.
window.__PIKA_DEMO_CAPTURE = ()=>{
  frameStep(0, clock.elapsedTime);
};
"""
    return source


def construire(destination):
    avant = {p: empreinte(RACINE / p) for p in SOURCES_DIRECT}
    spec = importlib.util.spec_from_file_location('assembleur_direct', RACINE / 'tools/build.py')
    assembleur = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(assembleur)
    html = isoler((RACINE / 'Nsldkso.html').read_text())
    html = remplacer(html, "if(m !== 'vip') m = 'classic';", "if(m !== 'vip' && m !== 'classic') m = 'vip';")
    html = remplacer(html, 'window.__PIKA_MODE = m;', "window.__PIKA_MODE = m; document.documentElement.dataset.demoPlateau=m;")
    html = re.sub(r'<link[^>]+(?:fonts\.googleapis\.com|fonts\.gstatic\.com)[^>]*>\s*', '', html)
    stockage = """<script>
/* Deux espaces de sauvegarde de démo, distincts de tous les directs. */
(function(){
  function espace(prefixe){return {
    getItem:function(k){return window.localStorage.getItem(prefixe+k);},
    setItem:function(k,v){return window.localStorage.setItem(prefixe+k,v);},
    removeItem:function(k){return window.localStorage.removeItem(prefixe+k);}
  };}
  window.__demoStorage=espace('demo:');
  window.__demoVipStorage=espace('demo:vip:');
})();
</script>
"""
    html = remplacer(html, '<title>Pikapoly</title>', '<title>Pikapoly — Golden</title>\n' + stockage)
    css = (RACINE / 'demo/ambiance.css').read_text()
    fragment = (RACINE / 'demo/interface.html').read_text()
    html = remplacer(html, '</head>', '<style>\n'+css+'\n</style>\n</head>')
    html = remplacer(html, '<canvas id="gl"></canvas>', '<canvas id="gl"></canvas>\n'+fragment)
    # Le constructeur historique n'inclut pas les classes de body : on la
    # pose après assemblage, sans modifier le constructeur d'origine.
    destination.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='pikapoly-demo-') as provisoire:
        copie = Path(provisoire)
        for dossier in ('vendor','assets','demo'):
            (copie / dossier).symlink_to(RACINE / dossier, target_is_directory=True)
        (copie / 'Nsldkso.html').write_text(html)
        (copie / 'board3d.js').write_text(isoler((RACINE / 'board3d.js').read_text()))
        (copie / 'board3d_golden.js').write_text(retoucher_golden((RACINE / 'board3d_golden.js').read_text()))
        assembleur.ROOT = str(copie)
        for module in sorted((RACINE / 'demo').rglob('*.js')):
            relatif = module.relative_to(RACINE).as_posix()
            assembleur.VENDOR_MODULES.append(relatif)
            assembleur.PATH_TO_TOKEN[relatif] = assembleur.token_for(relatif)
        assembleur.build(str(destination / 'index.html'))
    index = destination / 'index.html'
    contenu = index.read_text()
    contenu = remplacer(contenu, '<body>', '<body class="pikapoly-demo">')
    index.write_text(contenu)
    apres = {p: empreinte(RACINE / p) for p in SOURCES_DIRECT}
    if avant != apres:
        raise SystemExit('Une source des directs a changé pendant la construction.')
    base = subprocess.run(['git','rev-parse','HEAD'],cwd=RACINE,capture_output=True,text=True,check=True).stdout.strip()
    manifeste = {'base_git':base,'sources_direct_sha256':avant,'index_sha256':empreinte(index),
                 'plateau_defaut':'vip','cases_moteur':36,'stockage':'demo: / demo:vip:',
                 'reseau_requis':False,'cible':'MacBook Air M1 (2020)',
                 'pokemon':['Pikachu','Dracaufeu','Rayquaza','Mewtwo','Mew','Deoxys','Braségali']}
    (destination / 'verification.json').write_text(json.dumps(manifeste,ensure_ascii=False,indent=2)+'\n')
    guide = RACINE / 'demo/LIRE-MOI.txt'
    if guide.exists(): (destination / 'LIRE-MOI.txt').write_bytes(guide.read_bytes())
    archive = destination.parent / 'pikapoly-golden-demo.zip'
    with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        for fichier in sorted(destination.iterdir()):
            if fichier.is_file(): z.write(fichier,arcname='Pikapoly Golden/'+fichier.name)
    print(f'Démo autonome : {index}')
    print(f'Archive : {archive} ({archive.stat().st_size/1024/1024:.1f} Mio)')
    return index


if __name__ == '__main__':
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--out',type=Path,default=RACINE/'dist/demo-golden',help='Dossier de livraison')
    construire(ap.parse_args().out.resolve())
