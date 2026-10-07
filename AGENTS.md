# Pikapoly — brief pour Astra (ChatGPT) et tout agent de code

Lire aussi `CLAUDE.md` : même projet, mêmes règles, plus de détails. Tout est en
français, y compris le code et les messages de commit.

## Le jeu

Plateau 3D façon Monopoly (40 cases), univers Pokémon, joué **en direct** : un pion
avance et remporte des lots Pokémon (boosters, duopacks, tripacks, coffrets, ETB).
L'animateur pilote au clavier ; l'image passe sur une télé, souvent **pivotée à la
verticale**. Tout tourne dans un navigateur (three.js / WebGL), livré en **un seul
fichier HTML** autonome.

Il y a **deux plateaux** dans le même jeu (bouton ⇄ ou touche G) :

| plateau | fichier | pochette | aspect |
|---|---|---|---|
| **Golden** (« VIP » dans le code) | `board3d_golden.js` | 130 coups, lots 30 ans | forteresse d'or : tours, remparts, pièces €, Luffy couronné |
| **Classique** | `board3d.js` | 210 coups | cases colorées sur dalle dorée, Luffy au chapeau de paille |

## À quoi il ressemble aujourd'hui

Le plateau est **dessiné par le code** : il n'existe pas en image dans le dépôt,
sauf ces captures du bundle actuel :

- `docs/captures/golden-paysage.jpg` (écran 1920 × 1080)
- `docs/captures/golden-vertical.jpg` (télé pivotée, 1080 × 1920)
- `docs/captures/classique-paysage.jpg`

## Le chantier : une nouvelle esthétique, à partir du plateau Golden

Le jeu sera présenté à des investisseurs pour obtenir la licence Pokémon. Objectif :
**le même jeu, avec une finition digne d'un film d'animation**, en gardant l'esprit
et les couleurs du Golden (or, noir, lumière chaude), et avec des Pokémon visibles,
en mouvement, qui se battent.

**Ne change pas** (c'est le moteur, il est juste et il touche à l'argent) :
- les règles, les 40 cases et leur catégorie ;
- le tirage : pochette (`OUTCOME_RECIPE`, `buildOutcomeBatch`,
  `nextPredeterminedOutcome`), règles Golden (`gPlanifier`, `gRefuser`), dés pipés,
  plafond de reversement (`ceilingFor`, `fundedCategory`, `RECAL`) ;
- les touches : A, B, C, D, U, M, F, R, G, et X / Y / Z (lots armés en silence) ;
- l'écran public synchronisé (`?view=display`, `BroadcastChannel`) ;
- les clés `localStorage` (`pika_*`, préfixe `vip:` pour le Golden).

**Tout le reste peut être refait** : géométrie et matériaux des cases, base du
plateau, plaque centrale, éclairage, fond, caméra, pion, effets, panneaux HTML/CSS.

## Où est quoi dans les fichiers JS (~10 700 lignes chacun)

Chercher ces titres de section (`grep`) plutôt que des numéros de ligne :

| visuel (à refaire librement) | moteur (ne pas toucher sans raison) |
|---|---|
| `Palette`, `NOUVELLES CASES « BIJOU »` (`CASE_ART_SRC`) | `Le plateau RICHE` (`CATS`) |
| `Construction de la scène`, `Lumières` | `Règle métier de rentabilité` |
| `Plateau central`, `Plaque centrale` | `Recalibrage` |
| `Les 40 cases`, `Feuille d'or`, `Base du plateau` | `Lot prédéterminé`, `Lot mystère` |
| `VIP : FORTERESSE D'OR` (Golden seulement) | `RÈGLES DU PLATEAU GOLDEN` (Golden seulement) |
| `Pion articulé`, `LUFFY SCULPTÉ` | `Dés pipés vers le lot décidé d'avance` |
| `Caméra cinématique`, `Qualité adaptative`, `DIORAMA` | `Interface Animateur` (touches, validation) |
| `Célébration "Lot remporté"` | `État de jeu` |

La CSS et le HTML sont dans `Nsldkso.html`. Les images : `assets/lots/` (photos des
lots), `assets/cases/` (illustrations des cases), `assets/bg/` (fond),
`assets/character/player.glb` (squelette et chapeau du pion).

## Invariants

- Un lot annoncé ne s'efface jamais tout seul : seulement B, C ou D.
- Le lot affiché est toujours celui de la case où le pion est posé.
- Les touches X / Y / Z n'affichent **rien** à l'écran.
- Le plafond de reversement est tenu à chaque partie ; une recette qui le dépasse
  empêche la page de se charger.
- L'image doit rester juste en télé pivotée (`html.rotated`, `fitCelebToBoard`).
- Le jeu doit rester fluide sur la machine de diffusion : garder un mode éco
  (`setEcoMode`) à côté de tout rendu haute définition.
- Aucun modèle 3D, image, vidéo ou son extrait des jeux ou de l'anime officiels :
  ce dossier est présenté au détenteur de la licence. Créations originales, ou
  contenus dont la licence est claire.

## Construire et vérifier

```bash
python3 tools/build.py --out dist/pikajackpot.html     # un seul fichier autonome, hors ligne
cp board3d.js /tmp/c.mjs && node --check /tmp/c.mjs     # syntaxe
cp board3d_golden.js /tmp/c.mjs && node --check /tmp/c.mjs
```

- Toujours livrer le bundle (les `import` ne marchent pas en `file://`).
- Le bundle doit rester sous la limite d'un artifact (16 Mio, soit 16,7 Mo). Il en
  fait 16,6 Mo aujourd'hui, tout près de la limite : toute nouvelle image ou vidéo lourde demande d'en
  alléger d'autres, ou un autre mode de livraison (à décider avec l'animateur).
- Ouvrir `dist/pikajackpot.html#vip` (Golden) et `#classique` : **aucune erreur
  console**. Puis refaire les captures de `docs/captures/` pour que l'autre agent
  voie le résultat.
- Un changement commun aux deux plateaux se fait dans les **deux** fichiers JS.

## Travailler à deux agents sur ce dépôt

- `main` est la référence. Personne n'y pousse directement.
- Chaque agent sur sa branche (`codex/...` ou `astra/...` pour ChatGPT, `claude/...`
  pour Claude), une pull request vers `main` par étape.
- L'autre agent relit la PR et commente ; l'animateur décide de la fusion.
- Chaque PR visuelle joint ses captures avant / après.
- Messages de commit en français, qui disent ce qui change **et pourquoi**.
