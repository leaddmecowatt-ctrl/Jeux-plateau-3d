# Pikapoly — cahier des charges de la réécriture

Décision de l'animateur, 18/09/2026 : **le jeu est réécrit à partir de zéro.**
Le résultat à l'écran doit être **le même** ; la construction doit être
propre, modulaire et légère. Ce document est extrait du code actuel
(`board3d.js`, `Nsldkso.html`) : c'est la liste de ce qui doit être
reproduit. En cas de doute sur un détail, **l'ancien code fait foi** — il
reste dans l'historique git et sur la branche
`claude/code-refactoring-clarity-wqplw1`.

## 0. Ce qui est repris tel quel (ne pas réécrire)

| quoi | pourquoi |
|---|---|
| `regles/argent.js` + `tests/argent.test.mjs` | la règle d'argent, pure et testée (11 tests). C'est le seul morceau déjà propre. |
| `assets/` (photos des lots, fond ×2, dos de carte, jeton, `player.glb`) | le visuel |
| `tools/build.py` (à adapter à la nouvelle arborescence) | la livraison : **un seul fichier HTML** de ~7 Mo, tout incrusté, qui s'ouvre en double-clic hors ligne |
| les clés `localStorage` (§6) | la comptabilité du direct en cours doit survivre au changement de version |
| `vendor/three/` | three.js, même version |
| la police | Cinzel (titres) vient aujourd'hui de Google Fonts : **à embarquer**, la télé n'a pas toujours internet |

## 1. Ce que c'est

Un plateau façon Monopoly en vraie 3D (three.js), **36 cases** (anneau de
10 par côté), joué en direct. Le spectateur mise (9 € en moyenne),
l'animateur pilote au clavier, un pion 3D avance, la case où il s'arrête
donne un lot Pokémon réel. L'image est diffusée sur une télé, en général
**pivotée à la verticale**. Thème : noir & or « jeu télévisé », accents
Pokémon (bleu/blanc/rouge), fond = illustration du dragon (portrait et
paysage).

Ce qui ne se voit pas : **le lot de chaque mise est décidé à l'avance** par
une file calculée pour tenir une marge ; les dés amènent le pion sur une
case de ce lot. Le lot affiché est **toujours** celui de la case.

## 2. Le plateau

- 36 cases, index 0 = Départ (coin), 9 par côté coins compris. Catégories
  dans l'ordre (`BOARD_DATA`) :
  ```
  booster8, alternative, chest, commune, commune, commune, chance, commune, commune*(visite),
  gradee, booster8, alternative, gradee, commune, commune, chest, commune, commune,
  commune, chance, commune, commune, commune, gradee, commune, booster50, prison,
  commune, commune, commune, booster8, booster8, chance, commune, etb, jackpot300
  ```
  (la première case listée est l'index 0… vérifier l'alignement avec
  `tiles[0]` dans l'ancien code : `tiles[0]` = Départ.)
- Chaque case porte un **lieu Pokémon** (`POKEMON_PLACES`, 36 noms, de
  « Bourg Palette » à « Ligue Pokémon — Salle du Champion ») affiché dans
  la bannière « vous marchez vers … ».
- Catégories, libellés, valeur affichée, couleur (`CATS`, `SWATCH_COLORS`) :

  | clé | libellé | valeur | couleur |
  |---|---|---|---|
  | commune | Pioche du Prof. Chen | ~0,68 € | bronze `#a9793a` |
  | booster8 | Booster du Marchand 30 ans | ~17 € | bleu `#2f6fdc` |
  | alternative | Lot Mystère | ~7,20 € | rouge `#e0323f` |
  | gradee | Duopack 30 ans | ~30 € | teal `#2fb8b0` |
  | booster50 | Tripack 30 ans | ~58 € | rose `#d6549c` |
  | etb | Coffret 30 ans | ~85 € | orange `#e8863c` |
  | jackpot300 | ETB 30 ans | ~190 € | or `#ffd700` |
  | chance | Chance | tirage | violet `#9a5fe0` |
  | chest | Caisse Communautaire | tirage | vert `#33b46a` |
  | prison | Prison | 0 € | rouge danger `#d62b2b` |

  Or de la charte : `#e9c34a`, or clair `#ffe27a`.
- Sur chaque case de lot : la **vraie photo** du lot (`assets/lots/<clé>.jpg`)
  encadrée noir & or ; les gros lots (`tier:'float'`) flottent au-dessus de
  la case avec un disque d'ombre ; les petits (`flat`) sont à plat ;
  chance/caisse/prison portent un glyphe. Numéro de case en sprite.
- Centre : plaque « PIKAPOLY — Tous les lots à gagner » avec la légende des
  lots (photo + libellé), Chance, Caisse, « Bonne chance ! ». **Aucun
  pourcentage de chance affiché** (invariant).
- Ornements dorés dans les 4 angles, reflet holographique façon carte rare,
  liseré de loupiotes et loupiotes tournantes (décoration, coupée en éco).

## 3. Une partie, pas à pas

États : `au départ (index -1)` → `en jeu` → `terminée`.

| touche / bouton | effet |
|---|---|
| **A** / « Démarrer » | commence la partie : le pion est sur Départ, 0 lancer utilisé |
| **B** / « Tirer les cartes » | un tirage = **2 cartes** tirées parmi 12 face cachée (à la place de 2 dés), valeurs 1–6, total 2–12 ; le pion avance du total. **3 lancers** par partie, **+1 sur un double** (l'animateur relance lui-même). Pendant un déplacement ou un tirage : B ignoré (indication discrète animateur) |
| **D** / « Lot remporté » | garde le lot de la case courante : il est **compté** (§6), célébré (§8), la partie est finie. Pressé pendant le déplacement : mémorisé, appliqué à l'arrivée |
| **C** / « Recommencer » | remet au départ (nouvelle partie = nouvelle mise) |
| « Annuler » | annule le dernier lot validé (décompte) — bouton seulement, pas de touche |
| **F** | plein écran |
| **R** | pivote l'image (0 → 90 → 270), mémorisé (`pika_rot`), aussi `?rot=90` |
| **Z / M / 1–6** | **lot forcé** pour la partie à venir, avant le premier lancer (§7). Rien à l'écran |
| **I** | fenêtre de diagnostic (mesures internes, pour l'envoyer en photo) |

Règles de case :
- **Départ** ne donne jamais de lot.
- **Prison** : fin de partie immédiate, lot = carte commune de consolation
  (coût 0,68 €).
- **Chance / Caisse** : une carte s'affiche (« Avancez de 3 cases »,
  « Reculez de 2 »…) et **déplace toujours le pion jusqu'à une case de
  lot** — jamais de fin de partie sur Chance/Caisse, même sans lancer
  restant. Le déplacement est décidé par le planificateur (§5) ; les jeux
  `CHANCE_DECK` / `CHEST_DECK` ne sont que le repli. Carte rare
  « ★ CARTE GRADÉE OFFERTE (20-80 €) — TRÈS RARE ★ » : environ 1 tirage
  sur 25, avec **garde-fou anti-malchance** : au-delà de 32 tirages
  Chance/Caisse sans elle, garantie au suivant (`pika_pity_counter`).
- **Lot Mystère** (`alternative`) : deux cartes noires se retournent
  (booster / carte), une ombre saute de l'une à l'autre, vite puis de plus
  en plus lentement, et finit sur la carte **non** gagnante. Le résultat
  est décidé avant (`drawMysterySub`) : probabilité = boosters restants /
  lots mystère restants, avec **7 lots mystère sur 10 en boosters**
  (`MYSTERY_BOOSTER_SHARE`, `boostersMystere()`), compteurs persistés avec
  la file et recalculés sur les lots restants si la part change.
- À l'arrivée sur une case de lot : **aperçu du lot** (photo en grand,
  sans confettis) qui **reste affiché** tant que l'animateur commente.
  Il ne s'efface que par B, C ou D (invariant).

Panneaux (écran animateur) : « Lots à gagner » (légende), « Partie en
cours » (Lancer n / 3, statut, phrase d'état), « Derniers gains », « Règles »
(3 lancers, +1 par double ; je garde ou je relance ; prison ; Chance et
Caisse déplacent le pion), boutons Pivoter / Plein écran (s'effacent seuls
sans souris), bouton **« Démarrage cagnotte »** (remise à zéro des
compteurs = nouveau cycle, avec confirmation visuelle discrète).

## 4. Le tirage de cartes (à la place des dés)

- 12 mini-cartes face cachée disposées en grille, mélangées
  (`slotOrder`) ; deux se retournent et montrent 1–6 chacune ; face
  révélée = vraie face de carte (rayons, double liseré, index dans deux
  coins, reflet holo au retournement). Total affiché.
- Mise en scène sonore synthétisée **Web Audio, sans fichier** : montée de
  tension (riser sinus 170 → 760 Hz), impacts. Coupée si
  `prefers-reduced-motion`.
- Les valeurs viennent du planificateur (§5) ; sinon hasard honnête.

## 5. Dés pipés vers le lot décidé d'avance (`planTotal`)

À chaque tirage, le lot visé est `pendingOutcome` (tête de file, §6, ou
lot forcé). Le total 2–12 est choisi ainsi :
- si une case du lot visé est atteignable : on y va ;
- sinon on pose le pion sur une case **neutre** — commune, ou un lot
  **moins cher** que le lot visé et ≤ 17 € (booster) ; **jamais** Chance,
  Caisse, Prison ni Départ — depuis laquelle le lot visé reste atteignable
  avec les lancers restants (`canReachTarget`, récursif, mémoïsé) ;
- les totaux 2 et 12 sont évités en route (doubles forcés) ; le double
  bonus est décidé par le planificateur ;
- tirage au sort parmi les candidats avec les **poids réels de deux dés**
  (`DICE_W` : 7 six fois plus probable que 2) — rien ne trahit ;
- **détours** par Chance/Caisse : 8 % des arrivées (`CARD_ROUTE_P`) quand
  c'est possible, la carte (`CARD_DELTAS` : +1…+6, −1…−3) amenant sur la
  case du lot prévu.
- Si l'animateur valide **avant** que le pion soit sur la case prévue :
  il gagne le lot de sa case (moins cher, par construction) et le lot
  décidé retourne en tête de file. **Le pion ne bouge jamais après un
  lancer.**

## 6. L'argent — `regles/argent.js`, inchangé

Voir `CLAUDE.md` § Rentabilité. Ce que le nouveau code doit faire autour :
- tenir `totalMise` / `totalPaid` (clés `pika_total_mise`, `pika_total_paid`),
  `+9 €` de mise par partie validée, `+coût` du palier réellement payé
  (`tierFor` → `fundedCategory`) ;
- la file : `pika_outcome_batch` = `{version, batch, pos, mystN, mystB}` ;
  reconstruite si la version change, à l'épuisement, et au « Démarrage
  cagnotte » ;
- `nextPredeterminedOutcome()` : prend la tête de file **si elle est
  couverte** (`estCouvert`, mise de la partie comprise), sinon la première
  couverte plus loin, sinon commune ;
- le **recalibrage** (`RECAL`, clé `pika_recal`) appliqué une seule fois au
  chargement : compteurs posés, file reconstruite avec sa recette et sa
  pente ; « Démarrage cagnotte » l'efface définitivement ;
- garde-fou : si la recette ne tient pas sous le plafond, `buildOutcomeBatch`
  lève une exception et **la page ne se charge pas** (volontaire).

Conserver **exactement** les noms de clés `localStorage` : un direct en
cours ne doit pas perdre sa cagnotte au changement de version.

## 7. Lots forcés et repères de l'animateur

- Z = ETB, M = Tripack, 1 = ETB, 2 = Coffret, 3 = Tripack, 4 = Duopack,
  5 = Booster, 6 = Lot Mystère (par **position physique** de touche,
  `e.code`, donc sans Maj en AZERTY). Avant le premier lancer seulement ;
  re-presser annule. **Hors comptabilité** : ni la mise ni le lot ne
  comptent (partie-bonus). Rien, absolument rien à l'écran.
- Repères, **jamais sur l'écran public** : un point de 5 px en bas à
  gauche (doré = prochain lot ETB, bleuté = coffret, blanc = lot forcé
  programmé) ; les deux ★ du titre « ★ PIKAPOLY ★ » passent à une teinte
  un peu plus claire quand le prochain lot est ETB ou coffret. Le
  prochain lot est connu **dès la validation** du précédent.
- Indications clavier (`showKeyHint`) : petit texte discret côté animateur
  quand une touche est pressée au mauvais moment (« Attendez la fin du
  déplacement »…). **Jamais** pour une touche de lot forcé.

## 8. Célébrations — même intensité par lot

Niveaux (`TIER_LEVEL`) : prison 0 · commune, booster, mystère, chance,
caisse 1 · duopack 2 · tripack 3 · coffret 4 · ETB 5.

- Message par catégorie (`CATEGORY_MESSAGES`) : « 🃏 PIOCHE DU PROF. CHEN
  GAGNÉE ! 🃏 », « 🎁 BOOSTER DU MARCHAND GAGNÉ ! 🎁 », « 🎁 LOT MYSTÈRE
  GAGNÉ ! 🎁 », « ⭐ DUOPACK 30 ANS GAGNÉ ! ⭐ », « 🎁 TRIPACK 30 ANS
  GAGNÉ ! 🎁 », « 🎁 COFFRET 30 ANS GAGNÉ ! 🎁 », « 👑 ETB 30 ANS GAGNÉ ! 👑 ».
- Niveau 1–2 : photo + message, étincelles façon Pikachu, éclat façon
  Pokéball, confettis (canvas 2D dédié, objets filtrés à chaque image).
- **Gros lot** (3, 4, 5) : sous-titre « 🔥 GROS LOT ! 🔥 » / « 🔥🔥
  ÉNORME ! 🔥🔥 » / « 👑 LE GROS LOT DU LIVE ! 👑 », éclairs en rafale
  synchronisés avec des coups de caméra et des impacts sonores, secousse
  du plateau, pluie d'or 3D pour le coffret, pluie de confettis pendant
  plusieurs secondes derrière la photo.
- **ETB (5) — « orage du champion »**, 4,3 s : le décor s'assombrit
  (`html.storm`, fond et voile), la caméra tourne autour du pion, la
  foudre frappe sa case en rafale à 0,45 / 0,95 / 1,35 / 1,68 / 1,95 /
  2,18 s (éclairs 3D ramifiés, flash des lumières, onde qui parcourt les
  cases depuis l'impact, étincelles, tonnerre, coups de caméra), puis une
  colonne de lumière dorée monte de la case avec une pluie d'or, jusqu'au
  flash blanc qui révèle le lot. Carte « Darkrai » : verdict différé,
  annulé si l'animateur relance entre-temps.
- Impact à l'arrivée sur chaque case (flash, éclats dorés à chaque case
  franchie), réactions du pion calibrées sur l'importance du lot.
- Bandeau « derniers gains » sur l'écran public.
- **Invariant** : une annonce ne s'efface jamais seule.

## 9. Le pion

`assets/character/player.glb` (dresseur, sac à dos), squelette articulé.
Le clip « walk » du modèle **ne marche pas** (mesuré : 3 % de longueur
de jambe par pas). La marche est **construite en cinématique inverse** :
on décrit la trajectoire du pied (posé au sol pendant l'appui, arc en
l'air pendant le transfert) et on résout hanche et genou — un pied au
sol y reste, quelle que soit la vitesse. Marche et course (`speedK`),
rampes courtes au départ et à l'arrivée (0,3 case), bond de case en case
supprimé. Au repos : respiration, regard qui se promène (yaw/pitch
amortis), curiosité en arrivant quelque part, petits sauts / hochements /
salut selon l'événement. Calibrage automatique de la hauteur du pied et
du sommet du modèle. Sans texture chargée : filet de sécurité (peau
unie) pour ne jamais avoir un personnage tout blanc.

## 10. Caméra, lumière, rendu

- Caméra cinématique : cadrage automatique selon la forme du cadre
  (paysage / portrait / pivoté), garde-fou anti-rognage des coins (les 4
  coins du plateau toujours visibles), coups de caméra (punch) sur les
  impacts, rotation autour du pion pendant l'orage, distance absolue
  (vue d'origine × facteur), jamais un cumul de ratios.
- Lumières « roue de la fortune » : key, hemi, fill, rim, spot central,
  tone mapping ACES (exposition 1,45), ombres portées.
- **Rendu adaptatif**, invisible pour le public : DPR max 1,5 ; bloom en
  demi-résolution d'office (mesuré : le bloom coûte ~17× le reste) ; si la
  cadence reste sous ~45 im/s pendant ~1,5 s, on descend d'un cran (jamais
  plus d'un par 2 s, jamais de remontée) : 1,25× → 1× → ombres PCF simples
  → bloom quart → 0,85× → **mode éco** (bloom, ombres, sprites décoratifs,
  disques d'ombre et décoration de page coupés — jamais du jeu). Petit
  écran / mobile : cran 3 d'office ; > 2,4 Mpx : cran 1.
- **Contexte WebGL perdu** : rattrapé ; le mode éco est imposé au
  rechargement (`pika_q_forced`).
- **Fond** : un seul `<canvas>` + shader (onde ±2,2 px, période 8 s, 1,4
  tour sur la hauteur, 30 im/s max) ; image portrait ou paysage selon le
  cadre ; voile lumineux qui respire (opacité seule) ; assombri pendant
  l'orage ; figé en éco ; repli CSS statique sans WebGL. **Ne jamais
  refaire les 36 bandes** (voir `PLAN-ALLEGEMENT.md`).

## 11. Écran public et télé verticale

- `?view=display` : seconde fenêtre, même navigateur, synchronisée par
  `BroadcastChannel('pikajackpot-sync')` — messages `start`, `draw`,
  `move`, `celebrate`, `restart`. Aucun bouton, aucun repère animateur,
  bandeau des derniers gains visible, badge « écran public ».
- Télé verticale : `html.rotated` + `rot90`/`rot270` = `transform` sur
  `#app` (100dvh × 100vw). Conséquence à respecter : les overlays
  (célébration, tirage, mystère) vivent **dans** `#app` et se calent sur
  la zone du plateau (`fitCelebToBoard`, `--celeb-box-h`), jamais en
  `vh`/`vw` bruts ; positions mesurées en `offsetLeft/Top`, jamais
  `getBoundingClientRect` (repère tourné). Disposition : plateau en haut
  pleine largeur, deux panneaux en dessous (légende / partie en cours),
  règles masquées.
- La mise en page verticale doit être écrite **une seule fois** (l'ancien
  code la duplique à `vw`/`vh` près).
- **Safari (Mac, iPhone)** : un canvas WebGL placé *dans* le conteneur
  pivoté (`transform`) est composé au-dessus de tout le reste, quel que soit
  le z-index → les fonds et tout canvas autre que le plateau restent **hors**
  du conteneur pivoté, avec leur propre rotation ; les overlays fixes sont
  promus en calque (`will-change:transform`, `backface-visibility:hidden`).
  Vu sur la vraie télé, invisible sous Chromium.

## 12. Invariants (ne jamais casser)

- Un lot annoncé ne s'efface **jamais** seul : seulement B, C ou D.
- Le lot affiché est **toujours** celui de la case où le pion est posé.
- Aucun pourcentage de chance à l'écran.
- Aucun texte à l'écran sur une touche de lot forcé.
- Plafond de reversement tenu **à chaque partie**.
- Une recette qui ne tient pas empêche la page de se charger.
- Le pion ne bouge jamais après un lancer.

## 13. Architecture attendue (la raison de la réécriture)

- **Modules séparés par responsabilité**, un fichier par sujet :
  `regles/` (argent — existant ; déroulé d'une partie ; planificateur des
  dés — **purs, testables en Node**), `scene/` (plateau, pion, caméra,
  lumières, effets), `ui/` (panneaux, clavier, overlays, écran public),
  `etat/` (état de la partie + persistance `localStorage`), `fond/`.
- **Un seul état de partie**, dans un objet, pas 68 variables globales.
- **Un seul mécanisme par problème** : un compteur de génération pour les
  animations annulables (pas quatre verrous), une mise en page verticale
  (pas deux), un fond (pas 36).
- Chaque effet visuel = un module avec `start()` / `stop()` / `dispose()`,
  qui libère ce qu'il crée.
- **Budget** : pas de `will-change` empilés, pas de calque GPU par
  décoration, pas de redessin plein écran par image en JS, textures des
  cases partagées par catégorie (cache), tout ce qui est créé par partie
  est libéré.
- `build.py` adapté : `VENDOR_MODULES` liste chaque module local.

## 14. Vérification

- `node --test tests/*.test.mjs` (argent ; ajouter des tests pour le
  déroulé et le planificateur, qui sont purs).
- Bundle construit, chargé dans Chromium : **aucune erreur console**,
  captures 1280×720 et 1080×1920, comparées à l'ancien jeu (le bundle de
  l'ancien se construit depuis la branche
  `claude/code-refactoring-clarity-wqplw1`).
- Le cloud n'a **pas de GPU** : animations, confettis, timings et
  fluidité se vérifient **uniquement sur la télé**. L'animateur tranche.
