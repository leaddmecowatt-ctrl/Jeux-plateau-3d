# Vérification de la démo Golden

La démo se livre séparément de la version des directs. Le constructeur historique,
le HTML d’origine et les deux moteurs doivent rester identiques à la référence Git.
Les états sauvegardés et les canaux de la démo utilisent exclusivement `demo:`.

## Contrôles automatisés

Construire d’abord la démo avec `tools/build_demo.py`, puis lancer :

```bash
node tools/verifier_demo.mjs
node tools/verifier_demo.mjs --partie
```

Dans le cloud actuel, Chromium Playwright a été installé dans
`/tmp/pikapoly-browser`. La commande de vérification des états sans captures est :

```bash
PLAYWRIGHT_BROWSERS_PATH=/tmp/pikapoly-browser node tools/verifier_demo.mjs --partie --sans-captures --delai-partie 120000
```

Un exécutable précis peut aussi être passé par la variable `PIKAPOLY_CHROME`.
Le Chromium système peut imposer une politique interdisant les fichiers locaux ;
un refus `ERR_BLOCKED_BY_ADMINISTRATOR` dans ce navigateur ne prouve pas un défaut
du bundle. Utiliser le Chromium Playwright pour vérifier le double-clic hors ligne.

Le script utilise Playwright et son Chromium, déjà disponibles dans l’environnement
de travail inspecté. Il ne dépend pas d’un serveur extérieur. La première partie
ouvre directement le fichier en `file://`, avec le navigateur hors ligne. La seconde
sert le dossier sur une adresse locale temporaire pour vérifier les deux fenêtres
avec une origine commune et `BroadcastChannel`.

Par défaut, la référence de conservation des sources est `origin/main`. Une autre
référence se passe avec `--reference <commit>`. Pour un autre chemin de livraison :
`--fichier <chemin/index.html>`. L’option `--sans-captures` conserve les contrôles
fonctionnels. `--delai-partie 120000` augmente le délai d’arrivée du pion, sans
accélérer ni remplacer le moteur.

Les contrôles vérifient les comportements suivants :

- Les deux moteurs, le HTML et le constructeur des directs restent identiques à
  la référence Git. Cela protège également les règles, les catégories, la recette,
  les dés, le plafond et les planificateurs, sans réécrire ces algorithmes dans les tests.
- Le Golden s’ouvre hors ligne et expose les diagnostics `window.__PIKA_ARENE`.
- Neuf finales sont échantillonnées avec `?spectacle_t=`, sans attendre toute la
  boucle : deux personnages en vrais maillages, sept Pokémon présents au total,
  attaques de la distribution, pion restant au Départ. Les diagnostics appellent
  `window.__PIKA_ARENE.diagnostics()` et `window.__PIKA_DEMO_DIAGNOSTIC()`.
- Les formats 1920 × 1080 et 1080 × 1920 affichent une surface de plateau visible.
- Le cycle de rotation R reste 90°, 270°, puis 0° ; A, C, M, Échap, F et G gardent
  leur effet habituel. Le Classique se charge également hors ligne.
- X, Y et Z, puis leur annulation par la même touche, laissent les messages, les
  compteurs, les annonces et les notifications identiques.
- Des sentinelles posées sur les clés de la version des directs restent intactes.
  Les écritures et les canaux observés commencent tous par `demo:`.
- L’écran public suit A et C de la régie ; sa touche C ne pilote pas le jeu.
- Aucune ressource extérieure n’est demandée, et aucune erreur de script ou de
  console n’est tolérée.

Avec `--partie`, le script effectue aussi un vrai lancer B, attend l’arrivée,
compare la photo de la case avec celle du lot gardé par D, surveille l’annonce
pendant 7,2 secondes sans commande, vérifie que U annule le paiement, puis que C
efface l’annonce. La mise créditée pour le premier lancer Golden reste 29 €.
Ce contrôle ne force aucun résultat et ne remplace ni le tirage ni l’animation.

Les captures se trouvent dans `docs/captures/demo-*.png` et le rapport JSON dans
le dossier de livraison. Le rapport distingue les contrôles réussis, échoués
et ceux restant à exécuter. Une simple ouverture réussie ne vaut pas validation
d’une partie complète.

## Contrôles sur le MacBook Air M1 de diffusion

Le navigateur du cloud utilise SwiftShader : ses captures vérifient la mise en
page et les états, mais ne mesurent pas la fluidité d’un GPU Apple. Avant la
présentation, exécuter sur le vrai Mac les vérifications suivantes :

1. Copier le dossier complet sur le Mac ou une clé USB, couper le Wi-Fi, puis
   ouvrir `index.html#vip` par double-clic. Recharger sans réseau.
2. Tester le navigateur réellement utilisé, le branchement HDMI et la télévision
   dans les deux orientations. Contrôler les bordures, les textes des lots et
   l’annonce pendant les attaques. Répéter F et le cycle complet de R.
3. Laisser le spectacle tourner dix minutes, puis tirer plusieurs parties en
   alternant B, D, U et C. Vérifier visuellement la correspondance entre pion,
   case et lot annoncé. Ne pas confondre un lot présenté avec un lot validé.
4. Ouvrir l’écran public depuis la régie et comparer tirages, déplacements,
   annonces, annulation et recommencement. Vérifier également les fenêtres
   temporairement en arrière-plan.
5. Comparer les modes de qualité disponibles sur le Mac, vérifier la lisibilité
   et le confort visuel, puis conserver le réglage le plus stable. Vérifier le
   volume et l’absence de son imposé avant toute interaction, si des sons existent.
6. Ouvrir la version habituelle des directs et vérifier qu’elle retrouve ses
   compteurs, sa pochette et sa rotation précédents. La démo ne doit pas les toucher.

## Écart historique du brief

Le brief parle de 40 cases. Le moteur actuellement livré utilise `N_SIDE = 10`
et `N_TILES = 4 × (N_SIDE − 1)`, soit **36 cases**. Le commentaire du moteur
explique la réduction effectuée avant ce chantier. Les tests protègent la
géométrie réellement existante ; remettre 40 cases changerait le moteur et
demanderait une décision distincte.

## Limites à consigner pour la revue

La persistance de l’annonce et les commandes ne prouvent pas à elles seules
le respect économique sur une série complète ; la conservation des sources
protège ce comportement existant. Les captures ne prouvent pas non plus une
qualité photoréaliste : chaque personnage, attaque et séquence doit être revu
en mouvement. Les diagnostics et le rapport technique doivent rester dans
les outils de vérification, hors de l’interface destinée aux investisseurs.
