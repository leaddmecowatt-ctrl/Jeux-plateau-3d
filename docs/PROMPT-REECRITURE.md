# Prompt pour la réécriture — à coller tel quel dans une session neuve

> Tu vas construire **Pikapoly**, un jeu de plateau 3D façon Monopoly joué en
> direct devant des spectateurs, en repartant de zéro à partir du dossier
> de passation fourni. Il existe déjà une version qui marche, en production ;
> le but n'est pas de la copier ligne à ligne, c'est de faire **le même
> jeu, mieux** : plus beau à l'écran (une télé, souvent pivotée à la
> verticale, regardée à trois mètres), plus fluide, plus propre dans sa
> construction, et avec les fonctionnalités qui manquent. Tout est en
> français : code, commentaires, commits, messages à l'écran.
>
> **Lis d'abord, dans cet ordre, sans rien écrire :**
> 1. `COMMENT-LE-JEU-EST-FAIT.md` — comment l'ancien est construit, ses
>    techniques, ses pièges (§10, à ne pas refaire) et mes suggestions (§11) ;
> 2. `CAHIER-DES-CHARGES.md` — **le contrat** : tout ce que le jeu doit
>    reproduire (plateau, 36 cases, déroulé, touches, dés pipés vers le lot
>    décidé d'avance, argent, lots forcés, célébrations, pion, rendu, écran
>    public, télé pivotée, invariants) ;
> 3. `captures/` — à quoi ressemble chaque écran aujourd'hui ;
> 4. `regles/argent.js` et `tests/argent.test.mjs` — la règle d'argent,
>    pure et testée : **à reprendre telle quelle**, c'est la seule pièce
>    déjà propre ;
> 5. `board3d.js` et `Nsldkso.html` (à la racine du dossier) — l'ancien code,
>    qui fait foi en cas de doute sur un comportement (jamais à recopier).
>    `python3 tools/build.py --out dist/pikajackpot.html` le reconstruit.
>
> **Ce qui est fourni et à réutiliser** : `assets/` (photos des lots, deux
> fonds, dos de carte, jeton, pion 3D `player.glb`), `vendor/three/`
> (three.js et ses modules), `tools/build.py` (fabrique un seul fichier HTML
> autonome — à adapter à ta structure, la livraison reste **un seul fichier
> qui s'ouvre en double-clic hors ligne**), les clés `localStorage`
> (`pika_total_mise`, `pika_total_paid`, `pika_outcome_batch`, `pika_recal`,
> `pika_pity_counter`, `pika_q_forced`, `pika_rot`) **à conserver** pour
> qu'un direct en cours ne perde pas sa cagnotte.
>
> **Contraintes non négociables** (les invariants du cahier) : un lot
> annoncé ne s'efface jamais seul (seulement B, C ou D) ; le lot affiché est
> toujours celui de la case où le pion est posé ; aucun pourcentage de
> chance à l'écran ; rien à l'écran sur une touche de lot forcé ; le
> plafond de reversement est tenu à chaque partie ; une recette qui ne
> tient pas empêche la page de se charger ; le pion ne bouge jamais après
> un lancer. Mêmes touches : A, B, D, C, F, R, Z/M/1–6, I.
>
> **Architecture attendue** : modules séparés par responsabilité (règles
> pures testables en Node : argent, déroulé, planificateur des dés ; scène ;
> interface ; état + persistance ; fond), un seul état de partie, un seul
> mécanisme par problème, chaque effet visuel avec `start/stop/dispose`,
> pas de `will-change` empilés, pas de redessin plein écran par image en JS,
> textures partagées par catégorie. **Le fond et tout canvas WebGL restent
> hors du conteneur pivoté** ; les overlays fixes sont promus en calque
> (Safari). Police embarquée, pas de dépendance en ligne.
>
> **Méthode** : avant de coder, présente-moi en une page ton arborescence,
> ton ordre de construction (par étapes qui donnent chacune quelque chose de
> jouable, comparable aux captures), ta façon de vérifier (tests Node,
> bundle, zéro erreur console, captures 1280×720 et 1080×1920, et ce que
> seule la télé peut confirmer) et tes questions. Attends mon accord. À
> chaque étape : tests, bundle, capture, commit en français qui dit
> pourquoi. Le cloud n'a pas de GPU : la fluidité, les timings et Safari se
> vérifient sur mon Mac et ma télé — quand quelque chose cloche là-bas, je
> t'envoie une photo de la fenêtre de la touche I.
>
> **Ce que « mieux » veut dire pour moi** : lis §11 de
> `COMMENT-LE-JEU-EST-FAIT.md`, puis propose. Je tranche ce qui touche au
> spectacle ; tu tranches ce qui touche à la technique.
