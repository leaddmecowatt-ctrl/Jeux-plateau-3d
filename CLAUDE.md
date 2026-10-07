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
| `Nsldkso.html` | page unique : HTML + toute la CSS (~1 700 lignes), choix du plateau (`__PIKA_MODE`, bouton ⇄ / touche G) |
| `board3d.js` | plateau **Classique** : scène three.js, règles, comptabilité, animations (~10 700 lignes, un seul module ES) |
| `board3d_golden.js` | plateau **Golden** (« VIP » dans le code) : même jeu, sa propre pochette, ses réglages et son décor (forteresse d'or) |
| `tools/build.py` | bundle HTML + JS + three.js + assets en **un seul fichier** autonome |
| `vendor/three/` | three.js et ses modules (`VENDOR_MODULES` dans build.py les liste) |
| `assets/lots/*.jpg` | photo de chaque lot, clé = catégorie (`etb150.jpg`, `booster50.jpg`…) |
| `assets/cases/*` | illustrations « bijou » des cases (`CASE_ART_SRC`) |
| `assets/character/player.glb` | le pion 3D |
| `assets/bg/`, `assets/ui/` | fond, dos de carte, jeton |

`dist/` est ignoré par git : c'est là qu'on construit.

## Construire, tester, livrer

```bash
python3 tools/build.py --out dist/pikajackpot.html     # ~16,6 Mo, s'ouvre en double-clic, hors ligne
cp board3d.js /tmp/c.mjs && node --check /tmp/c.mjs         # vérification de syntaxe (module ES)
cp board3d_golden.js /tmp/c.mjs && node --check /tmp/c.mjs
```

**Deux plateaux dans un fichier.** Le bundle porte le Classique en entier et le Golden
sous forme de blocs de lignes différents (`__VIP_OPS__`, calculés par build.py), sinon
il dépasserait la limite d'un artifact (16 Mio, soit 16,7 Mo). En mode Golden, le bootstrap réapplique
ces blocs, puis sépare la pochette (`pikapoly/pochette_vip`), l'écran public
(`pikajackpot-sync-vip`) et le stockage (`localStorage.` → `__plsVip.`, préfixe `vip:`).
Un changement commun aux deux plateaux se fait **dans les deux fichiers**.
Le bundle fait 16,6 Mo, tout près de cette limite : une nouvelle image grossit le bundle d'environ 1,33 fois sa taille.

Les `import` ES ne marchent pas en `file://` : **toujours livrer le bundle**, jamais
les sources. Pour donner un lien : publier `dist/pikajackpot.html` en Artifact.

Il n'y a pas de suite de tests. Après toute modification de recette, de prix ou de
plafond, charger le bundle dans un navigateur et vérifier qu'il n'y a **aucune erreur
console** : `buildOutcomeBatch` lève une exception si les lots dépassent le plafond,
et la page ne se charge pas. Un script Playwright suffit (lire `localStorage` après chargement).

Clés `localStorage` (tout l'état vit dans le navigateur de la machine de diffusion ; le
Golden a les mêmes, préfixées `vip:` ; `pika_mode` retient le plateau choisi) :
`pika_total_mise` / `pika_total_paid` (cagnotte et lots comptés), `pika_outcome_batch`
(file des lots décidés + position), `pika_recal` (recalibrage appliqué ou effacé),
`pika_pity_counter` (compteur anti-malchance), `pika_q_forced` (mode éco imposé après
une perte de contexte WebGL), `pika_rot` (pivot de l'image mémorisé).

Piège des tests en environnement cloud : **pas de GPU** (SwiftShader, ~1 image/s).
L'empilement, la mise en page et la comptabilité se vérifient très bien en captures ;
les animations, confettis et timings **ne se vérifient pas** — seul un vrai appareil le peut.

## Concepts — où chercher (`grep` sur ces noms)

**Commandes clavier** (`addEventListener('keydown'`, identiques sur les deux plateaux) :
A démarrer · B tirer les cartes · D garder le lot · U annuler le dernier lot gardé ·
C recommencer · M règles · F plein écran · R pivoter l'image · G changer de plateau ·
X / Y / Z = arme l'ETB / le coffret / le tripack pour le prochain coup (pion sur Départ),
**en silence**, et le lot est pris **dans la pochette** (`lotArmeParTouche`).

**Lots** : `PAYOUT_LADDER` (catégories et valeur marché de chaque lot), `OUTCOME_COST`,
`TIER_LEVEL` (intensité de la célébration), `LOT_IMAGE_URLS`, `CATEGORY_MESSAGES`.
Catégories : `jackpot300` (ETB 30 ans), `etb` (coffret ex), `booster50` (tripack),
`gradee` (duopack), `booster8` (booster), `alternative` (lot mystère : booster ou carte),
`commune`, `prison`, plus `chance` / `chest` qui sont des détours, pas des lots.

**Rentabilité** (section « Règle métier de rentabilité ») : `AVG_MISE`, `CA_CYCLE`,
`MARGIN_TARGET` → `CEILING_RATIO`. Classique : 10 €, 2 100 €, 0,26, pochette de 210 coups.
Golden : 29 €, 3 770 €, 0,27, pochette de 130 coups (lots 30 ans uniquement). À tout instant
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

**Règles du plateau Golden** : section « RÈGLES DU PLATEAU GOLDEN » de
`board3d_golden.js` (`gPlanifier`, `gRefuser`) : le lot prévu tombe à un lancer tiré au
sort, jamais au dernier ; un lot refusé repart dans la pochette 2 à 15 coups plus loin.

**Écran public** : `?view=display` ouvre une seconde fenêtre synchronisée par
`BroadcastChannel('pikajackpot-sync')` — aucun serveur.

**Télé verticale** : `html.rotated` + `html.rot90/rot270` posent un `transform` sur
`#app`. Conséquence : tout `position:fixed` **à l'intérieur de `#app`** (les overlays
`#celebration`, `#cardDrawOverlay`, `#mysteryOverlay`) se retrouve piégé dans ce repère,
et les unités `vh`/`vw` n'y correspondent plus aux axes. `fitCelebToBoard()` cale
l'overlay sur la zone du plateau et publie `--celeb-box-h` pour que la CSS s'y mesure.

**Célébration** : `celebrate()`, `showLotPreview()`, `clearCelebration()`,
`stopCelebLoop()`. `celebLocked` empêche la boucle de confettis d'effacer une annonce.

**Qualité** : `applyQuality()`, `setEcoMode()` (mode éco : plus de flou, d'ombres ni de
décoration). Le contexte WebGL perdu est rattrapé (`webglcontextlost`).

## Invariants — ne pas casser

- Un lot annoncé ne s'efface **jamais tout seul** : seulement B, C ou D.
- Le lot affiché est **toujours** celui de la case où le pion est posé.
- Pourcentages de chance : masqués dans la version en direct (`SHOW_ODDS = false`).
  L'affichage des chances calculées sur la pochette réelle et la mention « Cadeau de
  l'animateur » existaient sur `main` au 20/09 (commit 7993561) ; l'animateur ne les a pas
  repris dans sa version. Ne pas les remettre sans qu'il le demande.
- Le plafond de reversement est tenu **à chaque partie**, pas seulement en fin de cycle.
- Toute recette doit tenir sous le plafond, sinon la page ne se charge pas.

## Historique utile

- `main` est la référence. Depuis le 07/10/2026, elle contient la version **jouée en
  direct** (modifications jusqu'au 05/10), récupérée depuis l'artifact de l'animateur
  (https://claude.ai/artifact/PceEXQGHeWurcphjqXWe8Z) : ce travail avait été fait hors
  GitHub. Le bundle reconstruit a été comparé à l'artifact : code des deux plateaux,
  images, pion et three.js identiques.
- Deux agents travaillent sur ce dépôt : Claude et Astra (ChatGPT), qui lit `AGENTS.md`
  (brief commun, à garder à jour avec ce fichier). Chantier : refaire l'esthétique en
  partant du plateau Golden, sans toucher au moteur. Chacun sa branche, PR vers `main`,
  l'autre relit. Captures de référence : `docs/captures/`.
- Les autres branches `claude/*` sont l'historique des sessions précédentes.
- `git log` est la documentation la plus précise : chaque commit dit ce qui a changé
  et pourquoi, en français.
