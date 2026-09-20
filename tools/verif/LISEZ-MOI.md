# Scripts de vérification (Playwright + Chromium)

Ce que le cloud peut vérifier sans GPU : mise en page, empilement,
comptabilité, absence d'erreur console, nombre d'appels de dessin, fuites
mémoire, profil processeur. **Pas** la fluidité, les timings, ni Safari.

Prérequis : `npm i -D playwright` (ou un Chromium avec `--use-gl=swiftshader`).
Tous prennent le chemin du **bundle** construit (`dist/pikajackpot.html`).

| script | usage | ce qu'il fait |
|---|---|---|
| `capture.mjs` | `node capture.mjs <bundle> <sortie.png> <largeur> <hauteur>` | charge, attend 9 s, capture, signale les erreurs console |
| `capture-figee.mjs` | `node capture-figee.mjs <bundle> <sortie.png> <l> <h> [jouer]` | capture avec `prefers-reduced-motion` (image déterministe pour comparer) ; avec `jouer`, joue une partie avant |
| `diff-pixels.mjs` | `node diff-pixels.mjs <avant.png> <apres.png>` | écart moyen, max, pixels très différents. **Comparer aussi deux captures du même bundle** : c'est le plancher de bruit (médaillon Prison qui pulse, pion au repos) |
| `carte-des-differences.mjs` | `node carte-des-differences.mjs <avant.png> <apres.png> <carte.png>` | image : en rouge, où ça diffère |
| `tele-pivotee-partie.mjs` | `SORTIE=./ node tele-pivotee-partie.mjs <bundle> <tag>` | `?rot=90`, joue, garde le lot ; état de l'overlay à chaque étape |
| `comptabilite.mjs` | `node comptabilite.mjs <bundle> <capture.png>` | partie normale (cagnotte +9, lot compté, file +1) puis lot forcé (hors comptabilité) |
| `lot-force.mjs` | `node lot-force.mjs <bundle> <touche> <nbLancers> <attenteMs> [capture.png]` | force un lot (Z, 3…), suit les cases, lit l'annonce. **Z avant A.** 12 s d'attente par lancer sous SwiftShader |
| `fuite-memoire.mjs` | `SONDE=<bundle instrumenté> node fuite-memoire.mjs 12` | 12 parties, mémoire ramassée de force, compteurs three.js ; tout doit se stabiliser |
| `profil-processeur.mjs` | `node profil-processeur.mjs <bundle>` | top des fonctions JS au repos et en déplacement (`getParameters` en tête = matériau recompilé à chaque image) |
| `sonde-appels-de-dessin.js` | à **ajouter temporairement** à la fin de `board3d.js` avant de construire un bundle de mesure, jamais commité | `window.__dbg()` → appels de dessin par image, sprites, meshes |

Méthode avant/après pour tout changement de rendu : capture figée avant,
changement, capture figée après, `diff-pixels`, `carte-des-differences`,
et le plancher de bruit en référence. Zéro erreur console est obligatoire.
