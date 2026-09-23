# Pikapoly — dossier de transmission

Ce document explique le jeu à une personne qui le reprend, et à son Claude.
Le fichier `CLAUDE.md` à la racine est la version technique que Claude Code lit
tout seul en ouvrant le dépôt. Ici, c'est pour un humain.

## 1. Récupérer le bon code

Le dépôt GitHub est `leaddmecowatt-ctrl/Jeux-plateau-3d`. La branche **`main`** contient
tout le jeu, à jour du 18/09/2026 : cloner le dépôt suffit. Les branches `claude/*` sont
l'historique des sessions précédentes, il n'y a rien à y chercher.

En ouvrant le dépôt dans Claude Code, un bon premier message :

> Lis `CLAUDE.md` et `docs/TRANSMISSION.md` avant tout. Construis le bundle et ouvre-le
> pour vérifier qu'il n'y a aucune erreur, puis dis-moi ce que tu as compris du jeu.

## 2. Ce que c'est

Un plateau 3D de 40 cases en direct : le spectateur mise (9 € en moyenne), l'animateur
lance, le pion avance, la case donne un lot. Les lots sont des produits Pokémon réels
(boosters, tripacks, duopacks, coffrets ex, ETB 30 ans). L'image passe sur une télé,
en général **à la verticale** (touche R pour pivoter).

Ce qui ne se voit pas : **le lot de chaque mise est décidé à l'avance**, dans une file
calculée pour respecter une marge. Les dés restent honnêtes à l'écran mais amènent le
pion sur une case du lot déjà décidé. Le lot affiché est toujours celui de la case.

## 3. Faire tourner le jeu

```
python3 tools/build.py --out dist/pikajackpot.html
```
Ça produit **un seul fichier** (~7 Mo) qui s'ouvre en double-clic, sans internet.
Toujours donner ce fichier (ou le publier en lien), jamais les sources : les sources ne
fonctionnent pas ouvertes directement.

**Commandes** : A démarrer · B tirer · D garder le lot · C recommencer ·
F plein écran · R pivoter · **M** affiche les règles en grand au milieu de l'écran
(M ou Échap pour refermer). Les touches qui forçaient un lot (Z, 1 à 6) sont
**supprimées** depuis le 23/09 : tous les lots sortent de la pochette de 245 coups.

**Écran public** : bouton « ouvrir l'écran public » (ou `?view=display` dans l'adresse)
ouvre une deuxième fenêtre sans les commandes, synchronisée avec la première.

**Bouton « Démarrage cagnotte »** : remet les compteurs à zéro = nouveau cycle.
À ne pas cliquer en cours de direct.

## 4. L'argent — comment le jeu tient sa marge

Tout est dans `board3d.js`, section « Règle métier de rentabilité ».

| réglage | valeur | rôle |
|---|---|---|
| `AVG_MISE` | 9 € | mise moyenne par partie |
| `CA_CYCLE` | 4 500 € | recette d'un cycle = tout le stock |
| `MARGIN_TARGET` | 0,26 | marge garantie (26 %) |
| `PAYOUT_LADDER` | ETB 190, coffret 85, tripack 58, duopack 30, booster 17, mystère 7,2, commune 0,68 | valeur comptée de chaque lot |
| `OUTCOME_RECIPE` | 5 ETB, 2 coffrets, 3 tripacks, 3 duopacks, 51 boosters, 116 mystères, 20 prison / 500 parties | combien de chaque lot par cycle |

**Depuis le 23/09, ce tableau est historique** : le jeu tire ses lots d'une pochette de
**245 coups aux quantités exactes** (1 ETB 30 ans, 2 coffrets, 2 tripacks, 1 duopack,
42 boosters, 90 Lots Mystère, 7 Parc gratuit, 100 communes ; voir `POUCH`), sans plafond
de reversement : aucun lot n'est retiré ni rétrogradé. L'hôte calcule sa rentabilité sur
ses coûts réels.

**Historique : les touches forcées.** Un lot forcé (Z, M, 1–6) ne comptait ni la mise ni
le lot ; sur le direct du 17/09, c'est ce qui a fait déraper le résultat. Ces touches sont
supprimées depuis le 23/09.

## 5. Le recalibrage en place (18/09)

Après ce dérapage, le jeu a été recalé sur le **stock réel** avec une marge relevée à
**41 %** : 4 ETB, 3 coffrets, 2 tripacks, 20 boosters, 25 lots mystère, étalés sur
3 300 € encaissés. C'est le bloc `RECAL` dans `board3d.js`. Il s'applique **une seule
fois** à l'ouverture (mémorisé dans le navigateur, clé `pika_recal`). Passé 3 300 €, le
plan standard reprend — **il faudra du stock**, ou un nouveau recalibrage.

Pour recalibrer à nouveau (demander à Claude) :
1. changer `RECAL.id` (sinon il ne se réappliquera pas) ;
2. mettre le stock réel dans `RECAL.recipe`, les compteurs de départ, `ratio` (part
   reversée) et `miseEnd` (recette sur laquelle étaler) ;
3. vérifier que la recette tient : somme des lots × leur coût ≤ `games × 9 × ratio`,
   sinon **la page ne se charge plus** (erreur volontaire) ;
4. reconstruire le bundle, l'ouvrir, vérifier aucune erreur console.

## 6. Modifier les choses courantes

| je veux… | où |
|---|---|
| changer un prix / une valeur de lot | `PAYOUT_LADDER` |
| changer le nombre de lots par cycle | `OUTCOME_RECIPE` (puis vérifier le plafond) |
| changer la marge | `MARGIN_TARGET` (la recette standard doit encore tenir) |
| changer la photo d'un lot | `assets/lots/<catégorie>.jpg`, même nom |
| changer le texte annoncé | `CATEGORY_MESSAGES` |
| changer l'intensité d'une célébration | `TIER_LEVEL` |
| ajouter un raccourci clavier | le `addEventListener('keydown'` |
| changer la mise en page télé verticale | CSS `html.rotated …` dans `Nsldkso.html` |

Après chaque changement : reconstruire, ouvrir, jouer une partie complète.

## 7. Ce que Claude ne peut pas vérifier tout seul

Dans Claude Code sur le web, le navigateur de test n'a **pas de carte graphique** : la 3D
tourne à une image par seconde et les confettis ne s'affichent pas. Claude peut vérifier
la mise en page, l'empilement des calques et la comptabilité (captures d'écran, lecture
du `localStorage`), mais **pas** les animations ni les timings. Tout ce qui est visuel
et animé doit être testé sur un vrai ordinateur + la télé.

Conseil concret : quand quelque chose « ne s'affiche pas » sur la télé, **envoyer une
photo de la télé** à Claude. La photo du 17/09 a réglé en dix minutes ce que des heures
de tests à l'aveugle n'avaient pas trouvé.

## 8. Historique

`git log` raconte tout, commit par commit, en français, avec le pourquoi. C'est la
meilleure documentation du projet. Les commits « Revert » sont normaux : une piste
essayée puis retirée.
