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

Il n'y a pas de suite de tests. Après toute modification de la pochette, charger le
bundle dans un navigateur et vérifier qu'il n'y a **aucune erreur console** : `POUCH`
et `MYSTERY_MIX` lèvent une exception si les quantités ne font pas 245 coups (dont
90 Lots Mystère), et la page ne se charge pas. Un script Playwright suffit (lire `localStorage` après chargement).

Clés `localStorage` (tout l'état vit dans le navigateur de la machine de diffusion) :
`pika_total_mise` / `pika_total_paid` (cagnotte et lots comptés, pour information),
`pika_outcome_batch` (pochette de 245 coups + position + sous-file des Lots Mystère), `pika_recal` (recalibrage appliqué ou effacé),
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
`commune`, `chest` (Caisse Communautaire, un lot depuis le 23/09), `prison` (hors pochette), plus `chance` qui est un détour, pas un lot.

**Pochette de 245 coups** (depuis le 23/09, décision de l'hôte) : `POUCH` = 1 ETB, 2 coffrets,
2 tripacks, 1 duopack, 42 boosters, 90 Lots Mystère, 7 Caisses Communautaires, 100 communes.
Un coup = une partie (une mise = un lot, même en plusieurs lancers). Quantités **exactes** :
plus aucun plafond de rentabilité ne retire ni ne décale un lot (`outcomeCovered` renvoie
toujours vrai ; l'hôte calcule sa rentabilité sur ses coûts réels, `PAYOUT_LADDER` ne sert
plus qu'au suivi). `buildPouch()` mélange tout à chaque pochette (boosters : 6 à 15 par quart ;
ETB : poids croissant ×1 → ×1,6, ~56 % en 2e moitié, jamais de fenêtre fixe).
`MYSTERY_MIX` : 60 « Mystère EX » (`carte`) + 30 « booster japonais » (`booster`), sous-file
mélangée `myst` / `mystPos`. `nextPredeterminedOutcome()` consomme la pochette ; les dés amènent
ensuite le pion sur une case du lot déjà décidé (section « Dés pipés », `planTotal`).
Si l'hôte garde un lot avant la case prévue, `claimCurrentLot` **échange** dans la pochette
(le lot gardé est retiré plus loin, le lot prévu réinséré au hasard) : les quantités tiennent ;
les cases de passage n'offrent que des lots encore en stock (`pouchHas`).

**Caisse Communautaire** : un LOT de la pochette (plus un détour). Le jeu n'en connaît pas le
contenu (promos des coffrets et tripacks ouverts, remises physiquement). Seule Chance reste un
détour (carte déplacement pipée, `CARD_ROUTE_P`).

**Chemins variés** : le résultat est décidé avant l'animation. Allure de marche ±15 %, rampes,
anticipation et stabilisation tirées au sort (`startWalk`) ; arrivée anticipée possible sur la
bonne case (`EARLY_LANDING_P`) ; au même lancer, jamais le total de la partie précédente
(`prevGameTotals`).

**Recalibrage** (`RECAL`) : historique ; il ne construit plus de file depuis la pochette de 245.

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

**Cases « carte collector »** (`getFlatPhotoFace`, `getTicketFace`, `getDepartFace`,
`CASE_ACCENT`) : même structure pour toutes (socle bleu nuit, bordure feuille d'or,
fenêtre ivoire avec UNE photo, filet + gemme d'accent, nom en capitales dorées). Accents :
lots = or, Chance = violet, Caisse = vert, spéciales = bleu, Prison = rouge. Coins 10,
19, 28 = billets inclinés à 45° (une seule photo, rien dessous). Règle : **jamais deux fois
la même photo sur une case** : les gros lots gardent leur carte photo FLOTTANTE (ce qui les fait reconnaître), leur case montre alors un socle doré (`drawPedestal`) ; pas de carte flottante sur un coin (le billet porte la photo).

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
- La pochette fait **exactement 245 coups** avec les quantités de `POUCH` : rien ne s'y ajoute,
  rien ne s'en retire (sauf les lots forcés, hors pochette).
- Le résultat est décidé avant l'animation ; l'animation ne change jamais les quantités.

## Historique utile

- `main` est la référence, à jour du 18/09/2026 (tout le jeu, ce dossier compris).
  Les branches `claude/*` sont l'historique des sessions précédentes.
- `git log` est la documentation la plus précise : chaque commit dit ce qui a changé
  et pourquoi, en français.
