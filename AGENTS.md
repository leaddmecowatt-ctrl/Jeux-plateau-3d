# Pikapoly — brief pour les agents de code (ChatGPT / Codex et autres)

Lire aussi `CLAUDE.md` : même projet, même règles, plus de détails. Tout est en
français, y compris le code et les messages de commit.

## À quoi ressemble le jeu aujourd'hui

Le plateau est **dessiné par le code** (three.js, WebGL) : il n'existe pas en
image dans le dépôt, sauf ces captures, prises sur le bundle actuel :

- `docs/captures/plateau-paysage.jpg` : écran 1920 × 1080
- `docs/captures/plateau-vertical.jpg` : télé pivotée, 1080 × 1920

C'est le « plateau doré » : cases façon carte collector sur socle bleu nuit,
bordure en feuille d'or, plaque centrale avec les lots et leurs chances, pion
Luffy, fond en diorama plié.

## Le chantier en cours : refaire l'esthétique du plateau, à zéro

Objectif de l'animateur : **le même jeu, en bien plus belle définition**.

**Ne change pas** (c'est le moteur, il est juste et il touche à l'argent) :
- les règles, les 40 cases et leur catégorie (`CATS`, disposition sur l'anneau) ;
- le tirage : `OUTCOME_RECIPE`, `buildOutcomeBatch`, `nextPredeterminedOutcome`,
  les dés pipés, le lot mystère, `RECAL`, `ceilingFor`, `fundedCategory` ;
- les touches clavier (A, B, C, D, F, R, M, Z, 1–6) ;
- la synchronisation avec l'écran public (`?view=display`, `BroadcastChannel`) ;
- les clés `localStorage` (`pika_*`).

**Tout le reste peut être refait** : géométrie et matériaux des cases, base du
plateau, plaque centrale, éclairage, fond, caméra, effets, panneaux HTML/CSS.

## Où est quoi dans `board3d.js` (~9 100 lignes, un seul module ES)

Chercher ces titres de section (`grep`) plutôt que des numéros de ligne :

| visuel (à refaire librement) | moteur (ne pas toucher sans raison) |
|---|---|
| `Palette noir & or` | `Le plateau RICHE` (`CATS`) |
| `CASES « CARTE COLLECTOR »` | `Règle métier de rentabilité` |
| `Construction de la scène`, `Lumières` | `Recalibrage sur le stock réel` |
| `Plateau central`, `Plaque centrale` | `Lot prédéterminé` |
| `Les 40 cases`, `Feuille d'or`, `Base du plateau` | `Lot mystère` |
| `Pion articulé`, `LUFFY SCULPTÉ` | `Dés pipés vers le lot décidé d'avance` |
| `Caméra cinématique`, `Qualité adaptative` | `Interface Animateur` (touches, validation) |
| `DIORAMA`, `Célébration "Lot remporté"` | `État de jeu` |

La CSS et le HTML sont dans `Nsldkso.html`.

## Invariants (repris de `CLAUDE.md`)

- Un lot annoncé ne s'efface jamais tout seul : seulement B, C ou D.
- Le lot affiché est toujours celui de la case où le pion est posé.
- Les pourcentages affichés viennent de la pochette réelle
  (`refreshLotOddsFromBatch`), jamais d'un chiffre théorique.
- Un lot forcé est annoncé « Cadeau de l'animateur » (`GIFT_TEXT`).
- Le plafond de reversement est tenu à chaque partie.
- L'image doit rester juste en télé pivotée (`html.rotated`, `fitCelebToBoard`).
- Le jeu doit rester fluide sur la machine de diffusion : garder un mode éco
  (`setEcoMode`) à côté de tout rendu haute définition.

## Construire et vérifier

```bash
python3 tools/build.py --out dist/pikajackpot.html   # un seul fichier autonome, hors ligne
cp board3d.js /tmp/c.mjs && node --check /tmp/c.mjs   # syntaxe
```

Toujours livrer le bundle (les `import` ne marchent pas en `file://`). Après
chaque changement : ouvrir le bundle, **aucune erreur console**, et refaire les
deux captures de `docs/captures/` pour que l'autre agent voie le résultat.

## Travailler à deux agents sur ce dépôt

- `main` est la référence. Personne n'y pousse directement.
- Chaque agent travaille sur sa branche (`codex/...` pour ChatGPT,
  `claude/...` pour Claude) et ouvre une pull request vers `main`.
- L'autre agent relit la PR et commente ; l'animateur décide de la fusion.
- Chaque PR visuelle joint ses captures avant / après.
- Messages de commit en français, qui disent ce qui change **et pourquoi**.
