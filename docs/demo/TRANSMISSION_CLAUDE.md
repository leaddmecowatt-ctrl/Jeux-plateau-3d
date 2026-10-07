# Brouillon Golden : direction rejetée, architecture à relire

**État actuel : l’animateur a rejeté cette ébauche sombre et son rendu plastique.
Le recodage et l’intégration sont arrêtés jusqu’à la validation des images
de direction artistique.** Les deux concepts sont dans
[`../direction-artistique/`](../direction-artistique/README.md). Cette publication conserve le travail pour la
relecture ; elle ne propose pas de fusion ni une démo finale.

Le [retour de Claude dans l’issue 5](https://github.com/leaddmecowatt-ctrl/Jeux-plateau-3d/issues/5#issuecomment-6028725818)
demande du fantastique familial lumineux, chaud et féerique, des Pokémon grands
et très détaillés, la plaque centrale des lots, le compteur gros sur le plateau
et des panneaux contrastés avec les couleurs propres aux lots. L’idée de
l’arène, les cases et la barre de commandes inférieure sont à conserver.
L’état de l’ébauche et les limites des contrôles figurent dans
[`ETAT_EBAUCHE.md`](ETAT_EBAUCHE.md).

L'animateur a autorisé une démo indépendante de la version des directs, sans
limite de 16 Mio et utilisable hors ligne. Machine cible : MacBook Air M1 (2020).
Il conserve le pion Luffy et demande sept Pokémon fidèles à leur apparence :
Pikachu, Dracaufeu, Rayquaza, Mewtwo, Mew, Deoxys et Braségali. Les combats
constituent un spectacle autonome pendant que la partie continue.

## Architecture et conservation des directs

`Nsldkso.html`, `board3d.js`, `board3d_golden.js` et `tools/build.py` restent
identiques à `main`. `tools/build_demo.py` importe l'assembleur historique,
applique une liste de substitutions contrôlées à une copie temporaire, puis
embarque l'arène, ses modèles, le décor et la feuille de style. Un repère qui
change ou apparaît plusieurs fois arrête la construction et exige une revue.

Le jeu actuel compte **36 cases** (`N_SIDE=10`), bien que le brief indique 40.
Cette démo conserve les 36 cases, les catégories et le fonctionnement actuel.
Les recettes, plafonds, dés, touches et règles Golden ne sont pas retouchés.

La démo utilise `demo:` pour le Classique et `demo:vip:` pour le Golden ; ses
BroadcastChannel et chemins de pochette sont également séparés. Le choix du
plateau est sauvegardé sous `demo:pika_mode`. Elle n'accède donc pas à l'état
des directs, même si les deux versions sont servies depuis une même origine.

## Contenu de l’ébauche publiée pour relecture

- `demo/forteresse.js` : architecture obsidienne/or, ornements instanciés,
  tours arrière hautes et tours avant basses pour garder les cases visibles.
- `demo/arene.js` : plateau circulaire central, neuf affrontements sur une
  boucle de 198 secondes, deux combattants visibles à la fois, anticipation,
  attaque, réception, esquive, repos et transition. Aucun accès au moteur.
- `demo/modeles/` : sept sculptures 3D originales articulées, volumes profilés,
  queues et tentacules animés, ailes de Dracaufeu, yeux et anatomies propres.
- `demo/son.js` : ambiance et impacts synthétisés par WebAudio, activés seulement
  après clic. Aucun enregistrement provenant d'un jeu ou de l'anime.
- `demo/ambiance.css` et `demo/interface.html` : habillage de la démo Golden,
  fond sanctuaire, statut des affrontements et commandes du spectacle.

Le spectateur voit des maillages animés en temps réel. Aucune image fixe n'est
utilisée à la place des personnages. La vidéo générative n'est pas nécessaire
au fonctionnement de cette version. Les modèles constituent une première
production sculptée ; ce livrable ne doit pas être décrit comme un rendu
photoréaliste de studio déjà validé pour une licence.

Dans cette ébauche rejetée, l’ancienne légende centrale a cédé la place à
l’arène et le compteur a été placé dans le bandeau. Ces choix ne correspondent
pas au retour de l’animateur : la suite devra conserver la plaque centrale
et un compteur bien visible sur le plateau, après validation des images.

Le profil M1 limite le pixel ratio à 1,25 et les ombres à 1024 pixels. Le mode
économie conserve les personnages et le jeu mais coupe les postes coûteux.
Une mesure réelle sur le Mac reste nécessaire : SwiftShader cloud ne permet
pas d'extrapoler sa cadence.

## Construction et relecture demandée à Claude

```bash
python3 tools/build_demo.py
node tools/verifier_demo.mjs --partie --delai-partie 120000
```

Le résultat est `dist/demo-golden/index.html` et l'archive
`dist/pikapoly-golden-demo.zip`. Un fichier autonome facilite le double-clic
hors ligne ; le dossier reste compatible avec l'ajout futur de vidéos locales.

Les captures de référence sont `docs/captures/golden-paysage.jpg` et
`golden-vertical.jpg`. La capture initiale de la direction rejetée, lorsqu’elle
est présente, est `docs/captures/demo-ebauche-initiale.png` ; elle précède les
ajustements suivants. Les premiers contrôles navigateur ont passé, mais le
contrôle de partie a rencontré un timeout d’observation de l’overlay et la
distribution a été interrompue. La suite complète et les performances M1/Safari
ne sont pas validées. Le script écrit son rapport technique dans le dossier de
construction ; aucun rapport complet réussi n’est annoncé ici.

À relire en priorité :

1. Conservation des sources et absence de modification du tirage dans les
   substitutions du constructeur de démo.
2. Isolation du stockage et des canaux, y compris bascule G et écran public.
3. Correspondance case/lot, verrou de l'annonce et silence de X/Y/Z.
4. Rotation R, overlays de gain et lisibilité des cases en portrait.
5. Fidélité et animations des sept créatures ; départ des attaques depuis les
   points attachés aux modèles ; coût graphique sur le M1 réel.

Merci de commenter la PR en brouillon sur l’architecture et les invariants,
et de recommander une voie d’assets vidéo ou 3D photoréalistes compatible avec
le Mac M1 et Safari. Ne pas recoder ni intégrer de nouveaux médias avant la
validation des trois concepts par l’animateur. La fusion lui appartient.

## Provenance des nouveaux médias

`assets/demo/sanctuaire.jpg` provient d'une image générée dans cette conversation
avec l'outil natif de ChatGPT, puis convertie en JPEG pour la livraison. Le
prompt décrivait une forteresse noire et dorée sans Pokémon, sans texte et sans
plateau. Les géométries et sons nouveaux sont créés par le code de la démo.
Les médias de lots et le pion Luffy proviennent du dépôt existant, inchangés.

Les silhouettes, noms et couleurs des Pokémon sont les références officielles
demandées par l'animateur. Aucun modèle, son ou vidéo n'a été extrait d'un jeu,
de l'anime ou d'une vidéo YouTube pour ce chantier.
