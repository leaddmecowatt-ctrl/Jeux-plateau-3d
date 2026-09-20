# Pikapoly — comment le jeu est construit

Ce document explique **comment** l'ancien jeu est fait : les techniques, les
choix, ce qui a coûté cher à trouver, et ce que j'améliorerais. Il complète
`CAHIER-DES-CHARGES.md` (le *quoi* : tout ce que le jeu doit reproduire) et
`PLAN-ALLEGEMENT.md` (les pièges mesurés). Les captures d'écran de chaque
état sont dans `captures/`.

## 1. Vue d'ensemble

Trois fichiers de code, un outil, un fichier livré :

| pièce | rôle |
|---|---|
| `Nsldkso.html` (~1 600 lignes) | la page : tout le HTML, toute la CSS, le script du fond ondulant, le diagnostic (touche I) |
| `board3d.js` (~6 400 lignes, un module ES) | le jeu : scène three.js, cases, pion, caméra, lumières, effets, déroulé, tirage, dés pipés, célébrations, écran public, qualité, compteurs |
| `regles/argent.js` (~320 lignes, module **pur**) | la règle d'argent : marge, prix, recettes, file des lots, lot mystère. Ni DOM, ni three.js, ni `localStorage`. 11 tests (`tests/argent.test.mjs`) |
| `tools/build.py` | fabrique **un seul fichier HTML** de ~7,5 Mo : incruste les images et le modèle 3D en data URI, inline three.js et ses modules via des blob URL (les `import` ES ne marchent pas en `file://`) |
| `dist/pikajackpot.html` | ce qu'on livre : s'ouvre en double-clic, hors ligne (sauf la police, voir §9) |

Tout l'état vit dans le `localStorage` du navigateur de la machine de diffusion.
Aucun serveur, aucune dépendance en ligne à part la police Cinzel.

## 2. La scène three.js

- **Plateau** : anneau de 36 cases (`N_SIDE = 10`, `4·(N_SIDE−1)`), index 0 =
  Départ. Chaque case = socle noir + corps coloré (couleur d'accent de sa
  catégorie, diffuse et émissive) + face (photo du lot encadrée or) +
  collerette dorée + bezel + 4 rivets. Tout est en **InstancedMesh** (une
  famille = un appel de dessin) ; les matrices des corps et faces sont
  recomposées à chaque image pour suivre la « ola » (vague de position y
  autour du plateau), la respiration (échelle y) et le rebond d'arrivée.
- **Faces** : textures dessinées en canvas 2D (`getFlatPhotoFace`) : photo
  du lot, cadre noir & or, bandeau du nom, badge « visite » ; **cachées par
  catégorie** (pas par case) pour ne pas générer 36 textures.
- **Lots flottants** (gros lots) : un plan double face avec la photo, qui
  flotte, oscille (`MOTION` par catégorie), s'élève quand le pion approche
  pour passer au-dessus de sa tête ; un **reflet holo** (plan additif, bande
  diagonale dont l'offset défile) ; un **disque d'ombre** au sol et un
  **halo** additif dessous. Chance/Caisse/Prison : médaillons en sprites
  (glyphe canvas), Prison pulse.
- **Plaque centrale** : une texture canvas (titre, légende des lots avec
  photos, « Bonne chance ! »), redessinée quand les chances changent.
- **Décor** : ornements dorés dans les 4 angles (plans texturés), liseré de
  48 loupiotes + 4 loupiotes qui tournent (`SpriteBatch`), étincelles
  (pool de 48) à chaque case franchie et poussière ambiante.
- **Lumières** : key (ombres PCF douces, carte 1024), hémisphérique, fill,
  rim, spot central ; tone mapping ACES (exposition 1,45) ;
  `EffectComposer` + `UnrealBloomPass` en demi-résolution. Renderer
  `alpha:true` (le fond est derrière le canvas, dans la page).
- **Caméra** : vue plateau à 52° par défaut ; modes cinématiques quand il se
  passe quelque chose (VOYAGE : suit l'azimut du pion ; ARRIVÉE : zoom) ;
  garde-fou qui élargit le champ pour garder les 4 coins visibles ; coups
  de caméra sur les impacts ; cadrage automatique selon la forme du cadre.

## 3. Le pion

`assets/character/player.glb` (dresseur au chapeau de paille, sac à dos),
chargé par `GLTFLoader`, textures ré-incrustées par `build.py`. **Le clip
« walk » du modèle ne marche pas** (mesuré : 3 % de longueur de jambe par
pas). La marche est construite en **cinématique inverse** : on décrit la
trajectoire du pied (au sol pendant l'appui, arc pendant le transfert) et
on résout hanche et genou ; marche/course selon la distance ; rampes de
0,3 case au départ et à l'arrivée. Au repos : respiration, regard qui se
promène (yaw/pitch amortis), curiosité en arrivant, petits sauts, hochements,
salut selon l'importance de l'événement. Calibrage automatique de la hauteur
du pied et du sommet du modèle au chargement. Peau et yeux repeints en
canvas (repli peau unie si la texture manque).

## 4. Le déroulé et les dés pipés

- Machine à états simple dans `board3d.js` : `currentIndex` (−1 = au
  départ), `moving`, `finished`, `rollsUsed/rollsAllowed` (3, +1 par double),
  `pendingOutcome` (lot décidé), `forcedCat` (lot forcé).
- **Tirage** : 12 mini-cartes DOM, deux se retournent (valeurs 1–6),
  sons synthétisés Web Audio (montée de tension, impacts). Le total vient du
  **planificateur** (`planTotal`) : il amène le pion sur une case du lot
  décidé d'avance, ou sur une case neutre (commune / lot moins cher ≤ 17 €,
  jamais Chance/Caisse/Prison/Départ) d'où le lot reste atteignable ;
  totaux tirés avec les poids réels de deux dés ; 2 et 12 évités en route ;
  8 % de détours par Chance/Caisse.
- **Cases spéciales** : Prison = fin + commune ; Chance/Caisse = carte qui
  déplace jusqu'à une case de lot (carte rare « gradée » ~1/25, garde-fou
  anti-malchance à 32) ; Lot Mystère = deux cartes, une ombre qui choisit,
  résultat décidé avant (7 boosters sur 10).
- **Aperçu du lot** à l'arrivée (photo, reste affiché) ; **D** compte le lot,
  célèbre, termine ; **C** recommence.

## 5. L'argent

Tout dans `regles/argent.js` : `AVG_MISE` 9 €, `CA_CYCLE` 4 500 €,
`MARGIN_TARGET` 0,26, `PAYOUT_LADDER` (valeur marché de chaque lot),
`OUTCOME_RECIPE` (nombre de chaque lot par cycle), `buildOutcomeBatch()`
(file mélangée qui tient le plafond **à chaque préfixe**, gros lots placés
là où la cagnotte les couvre, jamais plus de N communes d'affilée),
`tierFor()` (redescend un lot non couvert au palier inférieur), `RECAL`
(recalibrage appliqué une fois). `board3d.js` ne fait qu'encaisser
(`totalMise += 9`, `totalPaid += coût`) et afficher. Les lots forcés sont
hors comptabilité. Clés `localStorage` : voir `CLAUDE.md`.

## 6. Les célébrations

- Un overlay DOM fixe (`.celebration`) : photo du lot, message, sous-titre,
  un canvas 2D pour confettis/étincelles/éclats (objets filtrés à chaque
  image, jamais alloués en boucle).
- Niveaux 1 à 5 (`TIER_LEVEL`). Gros lots : éclairs, secousse du plateau,
  pluie d'or 3D, pluie de confettis. **ETB** : « orage du champion »
  (4,3 s) — décor assombri, caméra qui tourne, foudre 3D ramifiée en rafale
  à 0,45/0,95/1,35/1,68/1,95/2,18 s, onde sur les cases, colonne de lumière,
  flash blanc, révélation.
- Un compteur de génération annule proprement un reveal différé si
  l'animateur relance entre-temps. Invariant : une annonce ne s'efface
  jamais seule.

## 7. Le fond et la page

- **Fond** : un canvas WebGL séparé (`#bgWave`, shader de 6 lignes) qui fait
  onduler la photo du dragon (±2,2 px, 8 s) ; `#bgFill` flouté sur les côtés
  en paysage ; `#bgGlow` voile lumineux qui respire. Les trois sont dans
  `#bgLayer`, **hors de `#app`** (voir §10, Safari).
- **Mises en page** (CSS) : paysage ordinateur (légende à gauche, panneaux
  à droite), portrait (`@media max-aspect-ratio 3/4`), et **télé pivotée**
  (`html.rotated` : `transform` sur `#app`, plateau en haut pleine largeur,
  légende et panneaux dessous). La verticale est écrite deux fois (media et
  rotated) : à unifier.
- **Écran public** : `?view=display`, `BroadcastChannel`, aucune commande.
- **Repères animateur** : point de 5 px en bas à gauche, ★ du titre.

## 8. Qualité adaptative

DPR max 1,5 ; bloom en demi-résolution d'office ; si la cadence reste sous
~45 im/s pendant 1,5 s, on descend d'un cran (1,25× → 1× → ombres simples →
bloom quart → 0,85× → **éco** : bloom, ombres, sprites décoratifs et
décoration de page coupés). Contexte WebGL perdu rattrapé, éco imposé au
rechargement (`pika_q_forced`). Mesuré : 121 appels de dessin par image
(344 au départ), aucune fuite mémoire sur 12 parties.

## 9. La livraison

`python3 tools/build.py --out dist/pikajackpot.html`. Chaque image n'est
incrustée qu'une fois (CSS → variable, JS → `window.__ASSETS`), le GLB est
réécrit avec ses textures en data URI, les modules three.js listés dans
`VENDOR_MODULES` deviennent des blob URL. **Dépendance en ligne restante :
la police Cinzel (Google Fonts)** — sans internet, la télé retombe sur
Georgia. À embarquer dans la réécriture.

## 10. Les pièges qui ont coûté cher (ne pas les refaire)

1. **Le fond en 36 bandes CSS** (36 calques GPU) : le poste le plus cher de
   la page, jusqu'à faire lâcher le contexte WebGL de la télé.
2. **Un canvas WebGL dans un conteneur `transform`é, sur Safari** : composé
   au-dessus de tout le reste. D'où les fonds hors de `#app`, et les overlays
   fixes promus en calque (`will-change`, `backface-visibility`).
3. **Matériaux transparents double face** : three.js les dessine deux fois
   et recompile à chaque image → `forceSinglePass` sur les plans.
4. **Un sprite = un appel de dessin** : lots instanciés pour tout ce qui
   partage une texture.
5. **Mesurer scrollWidth dans une boucle** (nom du lieu) : un recalcul de
   mise en page par pas → mémoriser.
6. **Le cloud n'a pas de GPU** : animations, timings, fluidité et Safari ne
   se vérifient que sur le Mac et la télé. La touche **I** affiche les
   mesures internes : demander une photo avant toute hypothèse.
7. **Les lots forcés hors comptabilité** : première cause de dérive de la
   marge en direct.

## 11. Le matériel réel

- **Un Mac** (MacBook, Safari le plus souvent) pilote le jeu au clavier ; le
  navigateur n'est pas toujours en plein écran (barre d'onglets visible sur
  les photos) : conseiller F.
- **La télé** : un moniteur Acer **physiquement pivoté** en portrait, branché
  au Mac qui lui envoie une image paysage 1920×1080 ; c'est la touche **R**
  du jeu qui pivote le contenu, pas le système. Donc : fenêtre 1920×1080,
  `#app` = 1080 de large × 1920 de haut, tourné de 90°.
- Regardé à ~3 m par les spectateurs (lisibilité : textes grands, contrastes).
- L'écran public (`?view=display`) tourne sur la même machine, dans une
  seconde fenêtre : **deux scènes 3D sur une seule carte graphique**.
- Les chiffres mesurés sur cette télé : 44 → 76 images en 4 s en figeant
  l'ancien fond (le fond en bandes coûtait 42 % de chaque image).

## 12. Ce qui n'est PAS à reprendre

- Les 36 bandes CSS du fond, le canvas 2D redessiné par image, le filtre SVG
  (les 4 approches sont racontées dans le commentaire de `#bgWave`).
- Les quatre verrous de la célébration (`celebLocked`, `celebGen`, `hypeGen`,
  `stopCelebLoop`) : un seul compteur de génération.
- La mise en page verticale écrite deux fois (`@media 3/4` et `html.rotated`).
- Les 68 variables globales d'état.
- Les `showKeyHint` de texte à l'écran : utiles pour l'animateur, mais jamais
  sur l'écran public, jamais pour un lot forcé.
- `RECAL` tel quel : le recalibrage doit devenir une donnée éditable (écran
  animateur), pas un bloc de code à modifier à la main avant un direct.
- Google Fonts.

## 13. Où sont les données exactes

`docs/donnees/` : `plateau.json` (les 36 cases, lieu, catégorie, couleur),
`lots.json` (catégories, libellés, valeurs, couleurs, coûts, niveaux, messages,
mouvements), `argent.json` (marge, barème, recette, recalibrage — exporté
directement de `regles/argent.js`), `cartes-et-des.json` (Chance, Caisse,
carte rare, poids des dés, détours), `touches.json`, `constantes.txt` (les
57 constantes de réglage de l'ancien code avec leur commentaire : tailles,
vitesses, durées, seuils de qualité). `docs/BUGS-ET-LECONS.md` : les 62
commits, chacun un problème et sa solution. `docs/RECETTE-DE-TEST.md` : la
liste à cocher sur la télé. `tools/verif/` : les scripts de vérification.

## 14. Ce que j'améliorerais

**Visuel**
- Interface télé pensée d'abord pour la verticale (aujourd'hui c'est le
  paysage qui est « natif ») : bannière du lieu plus grande, panneaux
  lisibles à 3 m, légende avec les vraies photos.
- Police embarquée (pas de Google Fonts) ; un vrai système typographique.
- Célébrations par niveau plus différenciées (le coffret et le tripack se
  ressemblent) ; un écran « Derniers gains » plus riche (photo, heure).
- Le pion : expressions, une petite danse sur gros lot ; la caméra : moins
  de coupures, une seule logique de cadrage.
- Le plateau : cases plus lisibles (nom du lieu sur la case), un chemin
  éclairé pendant le déplacement.

**Fonctionnel**
- **Export / import de la comptabilité** (JSON) : aujourd'hui tout vit dans
  un seul navigateur, sans sauvegarde.
- Un écran animateur (protégé, jamais public) : recette, stock restant,
  marge en cours, historique des gains, recalibrage sans toucher au code.
- Tests du planificateur des dés et du déroulé (purs, en Node), pas
  seulement de l'argent.
- Un seul état de partie dans un objet (pas 68 variables globales), un seul
  mécanisme par problème (un compteur de génération pour les animations
  annulables, une mise en page verticale).
- Mode répétition (jouer sans compter), mode démo (le jeu joue seul en
  attendant le direct).
- Écran public : diffusion sur une autre machine (petit serveur local ou
  WebRTC), pas seulement un autre onglet.
