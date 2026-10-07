# Ébauche Golden — direction rejetée, intégration arrêtée

Cette branche archive une **ébauche en brouillon** pour permettre à Claude de
relire son architecture. Elle ne constitue pas une version finale à présenter
aux investisseurs ni une direction artistique validée.

L’animateur a rejeté le décor sombre et le rendu des personnages, perçus comme
des jouets en plastique. Son retour est également consigné dans
[le journal de bord, issue 5](https://github.com/leaddmecowatt-ctrl/Jeux-plateau-3d/issues/5#issuecomment-6028725818).

**L’intégration et le recodage sont arrêtés jusqu’à la validation artistique.**
Les deux propositions sont dans [`../direction-artistique/`](../direction-artistique/README.md).
La PR reste en brouillon ; l’animateur décide seul de toute fusion.

## Direction à reprendre après validation des images

- Fantastique familial haut de gamme : lumineux, chaud et féerique, avec ciel
  doré, nuages et or brillant. Le rendu gothique sombre de l’ébauche est rejeté.
- Pokémon beaucoup plus grands et détaillés : fourrure, écailles, flammes
  vivantes et attaques spectaculaires, fidèles aux apparences demandées.
- Plaque centrale avec la liste des lots conservée ; compteur de coups gros et
  visible sur le plateau ; panneaux contrastés, textes adaptés à la télévision
  et couleurs propres à chaque lot.
- Idée d’arène, barre de commandes inférieure et cases conservées. Le spectacle
  doit respecter la lisibilité des informations de la partie.

## Ce qui est publié pour relecture

La branche contient les sources expérimentales de `demo/`, leur constructeur,
les outils de vérification et un fond généré. Les sept personnages actuels sont
des sculptures procédurales animées ; ils ne répondent pas à la qualité réaliste
attendue. La capture `docs/captures/demo-ebauche-initiale.png`, lorsqu’elle est
présente, montre l’**état initial avant les ajustements suivants**, dans la
direction rejetée. Elle est fournie comme trace de l’ébauche.

Le HTML historique, les deux moteurs et leur constructeur restent identiques à
`main`. Les modifications de la démo s’appliquent à des copies temporaires. Les
états et canaux du brouillon sont isolés de ceux des directs. La version jouée
en direct ne change pas.

## Vérification réellement effectuée

Les sept premiers contrôles navigateur ont été signalés comme réussis, incluant
le chargement Golden hors ligne, le silence de X/Y/Z, les commandes, la rotation
et la mise en page portrait. La conservation des sources a également été
vérifiée contre la référence Git. Le contrôle de partie B/D/U a ensuite
rencontré un timeout lors de l’observation fugace de l’overlay de tirage ; cette
attente ne permet pas de conclure à une régression du moteur. La vérification
de distribution a été interrompue.

**La suite complète n’a pas été validée.** La qualité, la fluidité et les
animations sur le MacBook Air M1 avec Safari restent à mesurer. Les captures
cloud et les contrôles DOM ne remplacent pas cette vérification sur le matériel
de diffusion.

## Relecture demandée à Claude

Relire l’isolation du stockage et des canaux, la conservation du moteur, la
construction hors ligne et l’architecture d’intégration des médias. Proposer
une voie concrète pour des assets vidéo ou 3D photoréalistes, avec leur
provenance, leur coût et leur compatibilité avec le Mac M1 et Safari. Aucune
nouvelle intégration avant la validation artistique des concepts.
