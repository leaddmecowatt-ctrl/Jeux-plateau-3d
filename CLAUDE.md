# Pikapoly — Plateau Live 3D

Jeu de plateau 3D (façon Monopoly, 40 cases) joué **en direct** : les
spectateurs misent, un pion avance, et remporte des lots Pokémon (boosters,
tripacks, coffrets, ETB). L'animateur pilote au clavier, l'image est
diffusée sur une télé, souvent **pivotée à la verticale**.

Ce fichier s'adresse à Claude Code. Le guide humain est dans `docs/TRANSMISSION.md`.
Tout est en français, y compris le code et les messages de commit — garder cette langue.

## Fichiers

| fichier | rôle |
|---|---|
| `Nsldkso.html` | page unique : HTML + toute la CSS (~1 500 lignes) |
| `board3d.js` | tout le jeu : scène three.js, règles, comptabilité, animations (~6 500 lignes, un seul module ES) |
| `tools/build.py` | bundle HTML + JS + three.js + assets en **un seul fichier** autonome |
| `vendor/three/` | three.js et ses modules (`VENDOR_MODULES` dans build.py les liste) |
| `assets/lots/*.jpg` | photo de chaque lot, clé = catégorie (`etb150.jpg`, `booster50.jpg`…) |
| `assets/character/player.glb` | le pion : son squelette (qui porte toutes les animations) et son chapeau sont gardés ; le reste est refait en volumes par `buildLuffy()` |
| `assets/bg/`, `assets/ui/` | fond, dos de carte, jeton |

`dist/` est ignoré par git : c'est là qu'on construit.

## Construire, tester, livrer

```bash
python3 tools/build.py --out dist/pikajackpot.html     # ~7 Mo, s'ouvre en double-clic, hors ligne
cp board3d.js /tmp/c.mjs && node --check /tmp/c.mjs         # vérification de syntaxe (module ES)
```

Les `import` ES ne marchent pas en `file://` : **toujours livrer le bundle**, jamais
les sources. Pour donner un lien : publier `dist/pikajackpot.html` en Artifact.

Il n'y a pas de suite de tests. Après toute modification de recette, de prix ou de
plafond, charger le bundle dans un navigateur et vérifier qu'il n'y a **aucune erreur
console** : `buildOutcomeBatch` lève une exception si les lots dépassent le plafond,
et la page ne se charge pas. Un script Playwright suffit (lire `localStorage` après chargement).

Clés `localStorage` (tout l'état vit dans le navigateur de la machine de diffusion) :
`pika_total_mise` / `pika_total_paid` (cagnotte et lots comptés), `pika_outcome_batch`
(file des lots décidés + position), `pika_recal` (recalibrage appliqué ou effacé),
`pika_pity_counter` (compteur anti-malchance), `pika_q_forced` (mode éco imposé après
une perte de contexte WebGL), `pika_rot` (pivot de l'image mémorisé).

Piège des tests en environnement cloud : **pas de GPU** (SwiftShader, ~1 image/s).
L'empilement, la mise en page et la comptabilité se vérifient très bien en captures ;
les animations, confettis et timings **ne se vérifient pas** — seul un vrai appareil le peut.

## Concepts — où chercher (`grep` sur ces noms)

**Commandes clavier** (`addEventListener('keydown'`) : A démarrer · B tirer les cartes ·
D garder le lot · C recommencer · F plein écran · R pivoter l'image ·
Z / 1–6 = **lot forcé** avant le premier lancer · M affiche la **bulle de règles**
(M ou Échap pour fermer). M était un doublon exact de la touche 3 — même
`booster50` — elle a donc été retirée de `FORCE_KEYS` sans rien perdre.

**Lots** : `PAYOUT_LADDER` (catégories et valeur marché de chaque lot), `OUTCOME_COST`,
`TIER_LEVEL` (intensité de la célébration), `LOT_IMAGE_URLS`, `CATEGORY_MESSAGES`.
Catégories : `jackpot300` (ETB 30 ans), `etb` (coffret ex), `booster50` (tripack),
`gradee` (duopack), `booster8` (booster), `alternative` (lot mystère : booster ou carte),
`commune`, `prison`, plus `chance` / `chest` qui sont des détours, pas des lots.

**Rentabilité** (section « Règle métier de rentabilité ») : `AVG_MISE` (9 €), `CA_CYCLE`
(4 500 €), `MARGIN_TARGET` (0,26) → `CEILING_RATIO`. À tout instant
`totalPaid ≤ ceilingFor(totalMise)`. `fundedCategory()` fait redescendre un lot non
couvert au palier inférieur. `OUTCOME_RECIPE` = nombre de chaque lot par cycle de
500 parties ; `buildOutcomeBatch()` construit la file mélangée qui respecte le plafond
à chaque préfixe. `nextPredeterminedOutcome()` la consomme ; les dés amènent ensuite le
pion sur une case du lot déjà décidé (section « Dés pipés »).

**Recalibrage** (`RECAL`, `ceilingFor`, `recalRec`) : bloc appliqué **une seule fois**
au chargement (clé `pika_recal`, comparée à `RECAL.id`). Il pose les compteurs, une
recette et une pente de reversement propres jusqu'à `RECAL.miseEnd`, puis le plan
standard reprend. Pour recalibrer à nouveau : changer `RECAL.id`, les compteurs et la
recette, vérifier que la recette tient sous `games × AVG_MISE × ratio`.

**Lots forcés** (`forcedCat`, `takeForcedLot`) sont **hors comptabilité** : ni la mise ni
le lot ne comptent. C'est voulu (partie-bonus), et c'est la première cause de dérive
de la marge en direct.

**Écran public** : `?view=display` ouvre une seconde fenêtre synchronisée par
`BroadcastChannel('pikajackpot-sync')` — aucun serveur.

**Télé verticale** : `html.rotated` + `html.rot90/rot270` posent un `transform` sur
`#app`. Conséquence : tout `position:fixed` **à l'intérieur de `#app`** (les overlays
`#celebration`, `#cardDrawOverlay`, `#mysteryOverlay`) se retrouve piégé dans ce repère,
et les unités `vh`/`vw` n'y correspondent plus aux axes. `fitCelebToBoard()` cale
l'overlay sur la zone du plateau et publie `--celeb-box-h` pour que la CSS s'y mesure.

**Célébration** : `celebrate()`, `showLotPreview()`, `clearCelebration()`,
`stopCelebLoop()`. `celebLocked` empêche la boucle de confettis d'effacer une annonce.

**Pion Luffy** (`buildLuffy`, section « LUFFY SCULPTÉ ») : tête, visage dessiné, cheveux,
corps et tenue (gilet à boutons, cicatrice en croix, short à revers, écharpe à pan,
sandales) fabriqués en code, skinnés sur le squelette d'origine, contour noir (coque
inversée). Les meshes Kenney du corps sont masqués ; le chapeau d'origine est gardé.

**Finale du jackpot** (`startJackpotStorm`, `updateStorm`, `ABD`) : silhouette noire,
foudre fractale, faisceau du ciel, enlèvement puis retour sur la case (`STORM_MS` = 6,8 s).

**Qualité** : `applyQuality()`, `setEcoMode()` (mode éco : plus de flou, d'ombres ni de
décoration). Le contexte WebGL perdu est rattrapé (`webglcontextlost`).

## Invariants — ne pas casser

- Un lot annoncé ne s'efface **jamais tout seul** : seulement B, C ou D.
- Le lot affiché est **toujours** celui de la case où le pion est posé.
- Les pourcentages de chance ne s'affichent pas à l'écran.
- Aucun texte à l'écran quand une touche forcée est pressée (le public ne doit rien voir).
- Le plafond de reversement est tenu **à chaque partie**, pas seulement en fin de cycle.
- Toute recette doit tenir sous le plafond, sinon la page ne se charge pas.

## Historique utile

- `main` est la référence, à jour du 18/09/2026 (tout le jeu, ce dossier compris).
  Les branches `claude/*` sont l'historique des sessions précédentes.
- `git log` est la documentation la plus précise : chaque commit dit ce qui a changé
  et pourquoi, en français.
