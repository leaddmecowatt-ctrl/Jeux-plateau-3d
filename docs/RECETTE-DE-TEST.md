# Recette de test — à cocher sur le Mac et la télé avant un direct

Rien de ceci ne se vérifie dans le cloud. Une ligne qui coince = photo de
la télé, et touche **I** (fenêtre de mesures) en photo aussi.

## Chargement
- [ ] Le fichier s'ouvre en double-clic, sans internet (police comprise).
- [ ] Aucune erreur dans la console du navigateur (Safari : Développement → Console).
- [ ] La cagnotte et la file d'un direct précédent sont toujours là (Démarrage cagnotte **non** cliqué).

## Mode normal (sans R)
- [ ] A démarre ; B tire 2 cartes, le pion avance, la bannière du lieu suit.
- [ ] Aperçu du lot à l'arrivée ; il **reste** tant qu'on ne touche pas B, C ou D.
- [ ] D : célébration, lot compté (« Derniers gains » + compteurs), partie terminée.
- [ ] C : retour au départ.
- [ ] Double → un lancer de plus, relancé à la main.
- [ ] Prison : fin immédiate, commune de consolation.
- [ ] Chance / Caisse : la carte s'affiche, le pion repart jusqu'à une case de lot.
- [ ] Lot mystère : deux cartes, l'ombre choisit, ~7 boosters sur 10.
- [ ] Z avant A : jackpot ETB en ≤ 4 lancers, orage complet, révélation ; **rien** à l'écran au moment d'appuyer sur Z ; cagnotte inchangée (hors comptabilité).
- [ ] 3 (Tripack) : gros lot niveau 3 (éclairs, secousse, confettis).

## Télé pivotée (R)
- [ ] R : bandeau du lieu en haut, plateau pleine largeur, légende et panneaux dessous, **tout visible**.
- [ ] Même parcours complet qu'en mode normal : aperçu, D, Derniers gains, jackpot.
- [ ] Le lot ne « clignote » pas puis disparaît ; les overlays sont devant le plateau.
- [ ] R deux fois de plus : 270° puis retour ; la mémoire du pivot survit à un rechargement.
- [ ] F : plein écran (sans barre d'onglets).

## Écran public
- [ ] Bouton « écran public » : seconde fenêtre sans commandes, synchronisée (départ, tirage, déplacement, célébration, recommencer).
- [ ] Aucun repère animateur dessus (point, étoiles).

## Tenue
- [ ] 30 parties d'affilée, plusieurs gros lots : pas de ralentissement croissant, pas de passage en éco (le flou lumineux reste), pas de perte de contexte.
- [ ] Après une perte de contexte provoquée (onglets lourds à côté) : le jeu revient, cagnotte intacte.

## Argent
- [ ] `node --test tests/*.test.mjs` : tout vert.
- [ ] Après 5 parties normales : mise = 45 €, reversé ≤ plafond, file avancée de 5.
- [ ] Annuler : le dernier lot est décompté.
