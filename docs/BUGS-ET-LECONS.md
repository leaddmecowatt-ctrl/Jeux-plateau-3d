# Pikapoly — tous les bugs rencontrés, et leur leçon

Extrait de l'historique git de l'ancien jeu (branche
`claude/code-refactoring-clarity-wqplw1`), du plus récent au plus ancien.
Chaque entrée est un problème rencontré en vrai — souvent en direct — et la
façon dont il a été réglé. **C'est la liste de ce que la réécriture doit
éviter dès le départ.** Les commits « Revert » sont des pistes essayées puis
retirées : elles comptent autant que les autres.

Lecture rapide, les leçons qui reviennent :

1. **Ce qui n'est pas vérifié sur la vraie télé n'est pas vérifié** — le cloud
   n'a ni GPU ni Safari. Une photo de la télé a réglé en dix minutes ce que des
   heures de tests à l'aveugle n'avaient pas trouvé.
2. **Le mode télé pivotée est un monde à part** : `transform` sur le
   conteneur, unités `vh/vw` inversées, `position:fixed` piégé, canvas WebGL
   composé au-dessus de tout sur Safari. Le concevoir en premier, pas en
   dernier.
3. **Un lot affiché est sacré** : il ne s'efface jamais seul, il correspond
   toujours à la case du pion, et « Lot remporté » doit marcher même pendant
   une animation. Chaque fois qu'un mécanisme d'animation a pu effacer une
   annonce, ça s'est vu en direct.
4. **L'argent se tient à chaque partie**, pas en moyenne : dés honnêtes =
   130 % de reversement ; lots forcés hors comptabilité = dérive de marge ;
   d'où la file décidée d'avance, le plafond par préfixe, le recalibrage.
5. **La décoration coûte plus cher que le jeu** : fond en 36 calques, bloom,
   sprites un par un, double face dessinée deux fois. Mesurer avant d'ajouter.
6. **Le modèle 3D ne fait pas ce qu'il promet** : son clip de marche était
   inutilisable ; la marche a dû être construite en cinématique inverse.
7. **Le contexte WebGL peut lâcher** : le rattraper, imposer l'éco, garder la
   cagnotte — sinon le direct s'arrête.

---

## 077bfee — Dossier de passation pour la réécriture : prompt, construction, captures

L'animateur repart de zéro sur une session neuve pour refaire le jeu,
mieux, visuellement et fonctionnellement. Trois pièces s'ajoutent au
cahier des charges :
  - docs/PROMPT-REECRITURE.md : le prompt à coller, complet — quoi lire,
    quoi réutiliser, contraintes, architecture attendue, méthode ;
  - docs/COMMENT-LE-JEU-EST-FAIT.md : comment l'ancien est construit
    (scène, pion, dés pipés, argent, célébrations, fond, qualité,
    livraison), les pièges qui ont coûté cher, et ce que j'améliorerais ;
  - docs/captures/ : neuf écrans (repos portrait et paysage, télé pivotée,
    tirage, pion en marche, aperçu du lot, lot remporté, jackpot ETB,
    écran public).
Le cahier des charges est mis à jour (touche I, règle Safari, police à
embarquer). CLAUDE.md renvoie vers l'ensemble.


---

## 68ef014 — Lots mystère : sept sur dix sont des boosters

Demande de l'animateur. Le tirage booster/carte du lot mystère était
calibré sur un nombre fixe de boosters par cycle (30 en plan standard,
3 dans le recalibrage en cours, soit 12 % des 25 lots mystère). Il est
désormais calibré sur une PART : 7 lots mystère sur 10 (MYSTERY_BOOSTER_
SHARE dans regles/argent.js), tenue exactement sur les lots mystère du
cycle, comme avant (probabilité = boosters restants / lots mystère
restants).

Une file déjà en cours dans le navigateur de la télé n'est pas
reconstruite : elle garde sa position et ses lots, et son quota de
boosters est recalculé sur les lots mystère restants au chargement,
puis enregistré. Vérifié : file neuve du recalibrage 25 lots mystère →
18 boosters ; file en cours simulée (position 40, 20 lots mystère
restants, 2 boosters prévus) → position conservée, 14 boosters.

La comptabilité ne change pas (un lot mystère est compté 7,20 € quel que
soit son contenu) ; le stock de boosters, lui, sera sollicité davantage :
environ 18 boosters pour le cycle en cours au lieu de 3.


---

## 0bb637e — Diagnostic à distance : la touche I affiche les mesures internes de la page

Le mode télé pivotée pose encore problème sur le Mac (Safari) alors que
Chromium affiche tout : deux hypothèses successives n'ont pas suffi. Au
lieu d'une troisième, la page sait maintenant se décrire elle-même : la
touche I ouvre une fenêtre native avec le navigateur, la taille de la
fenêtre, les classes de <html>, les rectangles de #app, du plateau, des
panneaux et de la célébration, leurs styles calculés, et surtout QUEL
élément est réellement au-dessus de chacun (elementFromPoint). Une photo
de cette fenêtre, après R puis après D, dit exactement ce qui se passe.

Sans effet sur le jeu tant qu'on n'appuie pas sur I.


---

## ade90ea — Télé pivotée sur Safari : les fonds sortent de #app, les overlays deviennent des calques

Sur la vraie télé (Mac + Safari, image pivotée par R), il ne restait à
l'écran que les deux canvas — le plateau et le fond — sans bandeau, ni
légende, ni panneaux ; le lot apparaissait une fraction de seconde puis
disparaissait, et « Lot remporté » ne montrait rien. En mode normal,
tout allait bien. Chromium, lui, affiche tout correctement dans les deux
modes : le bug était invisible en test ici.

Cause : quand #app est pivoté (transform), Safari compose un canvas WebGL
placé DEDANS au-dessus de tout le reste du contenu de #app, quel que soit
le z-index. Le fond en canvas (introduit à la place des 36 bandes) a donc
recouvert toute l'interface en mode pivoté — une régression de ce
changement, spécifique à Safari. Et l'overlay de célébration, non promu
en calque, passait derrière le canvas du plateau sauf pendant une
animation : c'est le diagnostic déjà écrit dans f26d606, dont le
correctif avait été annulé.

Deux corrections, sans rien changer à l'image :
  - les deux fonds (#bgFill flouté, #bgWave ondulant) sortent de #app,
    dans #bgLayer, frère à la racine qui reprend exactement sa géométrie
    et sa rotation, derrière lui (z-index 0 contre 1). Plus aucun canvas
    dans #app hors le plateau : l'empilement redevient celui des bandes ;
  - les overlays fixes (célébration, tirage, lot mystère, flash) sont
    promus en calque en permanence (will-change, backface-visibility),
    et la secousse passe en translate3d pour ne pas perdre la couche.

Vérifié sous Chromium : mode pivoté (1920×1080 et 1440×900) avec aperçu
du lot, lot remporté et derniers gains affichés ; mode normal identique
au pixel (0,02–0,03 %, le bruit) en paysage comme en portrait ; aucune
erreur console. La confirmation finale appartient au Mac et à la télé.


---

## f74ad5e — Plan : numéro du commit de la passe 2


---

## e26f71e — Cases instanciées, plans en une passe, nom de lieu en cache : 268 → 121 appels par image

Le profil processeur au repos montrait three.js en train de recalculer
les paramètres de shader à chaque image (getParameters, premier poste
JS). Cause, tracée jusqu'au moteur : chaque matériau transparent double
face est dessiné DEUX fois (dos puis face) et marqué « à recompiler » à
chaque passage. Les 18 objets concernés (cartes flottantes, reflets
holo) et la colonne de lumière et les éclairs sont des plans : un seul
côté est visible à la fois, une passe donne le même pixel. Ils portent
désormais forceSinglePass — plus de double dessin, plus de
recompilation par image.

Le socle, le corps et la face des 36 cases étaient 108 meshes, chacun
son appel de dessin (et le corps un second dans la passe d'ombres). Ils
deviennent trois familles d'InstancedMesh, comme le liseré et les rivets
l'étaient déjà : même géométrie, même matériau, même éclairage ; la
couleur d'accent de chaque corps passe par la couleur d'instance, pour
la diffuse ET l'émissive (une ligne de shader). setTileInstances()
recompose leurs matrices à chaque image — le produit group × topGroup ×
local d'avant, développé — pour suivre la « ola », la respiration, le
rebond d'arrivée et l'onde de l'orage exactement comme quand ils
étaient enfants de topGroup.

Le nom du lieu (fitPlaceBanner) réduisait sa police par pas de 1 px en
relisant scrollWidth à chaque pas, un recalcul de mise en page à chaque
lecture, à chaque case franchie. Le résultat ne dépend que du texte, de
la largeur et de la taille de base : mémorisé.

Les objets qui ne bougent jamais (groupes des cases, ornements, lots
instanciés) ont leur matrice figée. Le fond ne relit plus l'état éco et
la visibilité de l'onglet 60 fois par seconde : un booléen tenu à jour
par les observateurs qui existaient déjà.

Mesuré sur le bundle : 268 → 121 appels de dessin par image (344 au
départ de cette branche). Vérifié au pixel, mouvement figé, en 1280×720
et 1080×1920 : seuls le médaillon Prison (qui pulse) et le pion au repos
diffèrent, comme entre deux captures du même bundle. Une partie jouée et
un jackpot forcé (orage complet) : aucune erreur console.


---

## ed3ac72 — Plan : numéro du commit des lots instanciés


---

## a3a0f1d — Sprites et disques d'ombre en lots instanciés : 344 → 268 appels par image

Chaque THREE.Sprite coûte un appel de dessin. Les 48 loupiotes du
liseré, les 12 halos sous les lots, les 4 loupiotes tournantes, les 48
étincelles et les 17 disques d'ombre étaient envoyés un par un à la
carte graphique : 129 appels par image pour deux textures et un seul
mode de fondu.

Chaque famille devient un lot instancié — un quad par sprite, orienté
face caméra dans le shader, avec sa position, sa taille et son opacité
par instance (SpriteBatch) ; un InstancedMesh pour les disques
(DiscBatch). Même texture, même fondu additif, même atténuation avec la
distance, mêmes corrections de tonalité et de couleur : MeshBasicMaterial
et SpriteMaterial partagent ces morceaux de shader, le pixel calculé est
le même. Mesuré sur le bundle : 344 → 268 appels de dessin par image.

Vérifié au pixel, mouvement figé, avant/après en 1280×720 et 1080×1920,
avec en référence le bruit entre deux captures du même bundle : les
seules zones qui diffèrent sont le médaillon Prison (son opacité pulse
dans le temps) et le pion au repos — les mêmes qui diffèrent entre deux
captures de l'ancien. Une partie jouée : aucune erreur console.

Deux détails d'ordre de dessin, trouvés au pixel et traités :
  - les halos passent avant les cartes flottantes et après les disques,
    comme le tri par profondeur le faisait sprite par sprite ;
  - les 4 loupiotes d'angle restent des sprites individuels : elles
    croisent l'ornement doré de l'angle, et seul le tri sprite par sprite
    les fait passer dessus ou dessous exactement comme avant. 4 appels
    pour 4 pixels justes.

Mode éco et prefers-reduced-motion inchangés (les lots se cachent et se
figent comme les sprites le faisaient).


---

## 3d36af2 — Cahier des charges de la réécriture à zéro

L'animateur a décidé de réécrire le jeu à partir de zéro, même résultat à
l'écran, construction propre. Ce document liste tout ce que le nouveau
jeu doit reproduire, extrait du code actuel : plateau (36 cases, lieux,
catégories, couleurs), déroulé d'une partie et touches, tirage de cartes,
dés pipés vers le lot décidé d'avance, argent (regles/argent.js repris
tel quel, clés localStorage conservées), lots forcés et repères de
l'animateur, célébrations par niveau, pion, caméra et rendu adaptatif,
écran public et télé verticale, invariants, architecture attendue et
vérification. L'ancien code reste la référence en cas de doute.

PLAN-ALLEGEMENT.md et CLAUDE.md renvoient vers cette décision.


---

## a7eb805 — Plan d'allègement : le contrat de toute session qui touche au code

Le but (même écran, construction plus légère), ce qu'on ne fait pas
(pas de réécriture, pas de couche en plus), le diagnostic mesuré, ce
qui est fait, ce qui reste dans l'ordre, et la méthode de chaque
chantier. CLAUDE.md y renvoie en premier.


---

## 1eb5969 — Fond : un seul canvas et un shader à la place des 36 bandes

Le fond ondulant était découpé en 36 <div>, chacun avec sa copie de la
photo et un transform animé en CSS sous « will-change ». Résultat mesuré
sur la télé, et documenté dans la page elle-même : 36 calques GPU
permanents recomposés à chaque image, le poste le plus cher de toute la
page (+73 % d'images par seconde une fois figé), jusqu'à saturer la
mémoire vidéo et faire lâcher le contexte WebGL. Tout ça pour un
balancement de ±2,2 px.

Même effet, autre construction : un <canvas> unique et un shader WebGL
minuscule. La photo est une texture, l'ondulation une ligne de calcul
par pixel faite par le GPU. Un calque, un appel de dessin par image,
aucun travail JS entre deux images, cadence bridée à 30/s. L'onde garde
ses paramètres (±2,2 px, 8 s, 1,4 tour sur la hauteur) mais devient
continue : plus de bandes, donc plus de jonctions à masquer — les
fines lignes horizontales de l'ancien fond disparaissent.

Vérifié sur le bundle, onde figée des deux côtés (prefers-reduced-
motion) : écart moyen 1,2 à 1,5 sur 255 entre l'ancien fond et le
nouveau, en paysage comme en portrait ; les seuls pixels vraiment
différents (0,07 %) sont les anciennes jonctions. Aucune erreur
console.

Tout ce qui s'appuyait sur les bandes suit : l'orage (filtre CSS) et
la transition s'appliquent au canvas ; le mode éco et
prefers-reduced-motion figent l'onde (une image sans décalage, puis
arrêt) ; onglet caché = arrêt. Sans WebGL, ou si le contexte lâche,
html.bg-static remet la même photo en fond CSS, sans onde — jamais
d'écran noir.

Le commentaire de #bgWave garde l'historique des quatre approches et
les mesures, pour qu'on n'y revienne pas.


---

## 44c0d0e — La règle d'argent sort du plateau : un module pur, et des tests

Jusqu'ici la règle qui décide de l'argent réel vivait au milieu de la
scène 3D : marge, prix des lots, recettes et construction de la file
étaient dispersées dans board3d.js entre des appels three.js. Le calcul
des probabilités repeignait même une texture au passage. Conséquence :
impossible de vérifier la marge sans démarrer un navigateur et une scène
WebGL, donc impossible de la vérifier vraiment.

Tout ce qui décide est déplacé tel quel dans regles/argent.js : mêmes
constantes, mêmes calculs, mêmes commentaires. Le module ne connaît ni
le DOM, ni three.js, ni localStorage — que des fonctions pures.

board3d.js garde ce qui doit rester : les compteurs, leur écriture dans
le navigateur, et l'affichage. La frontière est nette — argent.js décide,
board3d.js encaisse et montre. fundedCategory() en est l'exemple :
tierFor() choisit le palier payable, board3d.js écrit le total.

Deux fonctions deviennent des passe-plats d'une ligne (ceilingFor,
outcomeCovered), qui passent simplement l'état du recalibrage à la règle.

Ajout de tests/argent.test.mjs : 11 tests, moins d'une seconde, sans
navigateur. Ils construisent 60 files complètes (30 standard, 30 de
recalibrage) et vérifient qu'à CHAQUE partie le total reversé tient sous
le plafond — la garantie qui coûte de l'argent en direct, et qui n'avait
jamais pu être vérifiée autrement qu'à l'œil.

Aucun changement de comportement : mêmes prix, mêmes recettes, même
recalibrage. Bundle reconstruit et chargé dans Chromium — plateau
identique, aucune erreur JS, recalibrage appliqué comme avant (file de
367 parties, 3 packs de lot mystère).


---

## 30876e2 — Transmission : main est désormais la référence

main vient d'être mis à jour par avance rapide sur tout le jeu ; les deux
documents disaient encore de ne pas en partir. Ils pointent maintenant sur
main, et le premier message suggéré au Claude repreneur ne mentionne plus
de branche.


---

## 7d82a85 — Dossier de transmission : CLAUDE.md et docs/TRANSMISSION.md

Le projet change de mains. CLAUDE.md est la fiche technique que Claude Code
lit automatiquement : fichiers, construction, concepts et où les chercher
(grep), invariants à ne pas casser, clés localStorage, pièges (bundle
obligatoire, pas de GPU en test cloud, télé pivotée, lots forcés hors
comptabilité, recette qui doit tenir sous le plafond). docs/TRANSMISSION.md
est le guide humain, en français : récupérer la bonne branche, faire tourner
le jeu, comment la marge est tenue, le recalibrage en place et comment en
refaire un, les modifications courantes, ce que Claude ne peut pas vérifier
seul.


---

## 306836f — Recalibrage sur le stock réel, marge relevée de 26 % à 41 %

L'hôte a sorti des lots à la touche forcée (hors comptabilité) et le
plan initial ne correspond plus à rien. On repart de ce qu'il reste en
stock, à zéro de compteur, avec une part reversée de 59 % (marge 41 %)
au lieu de 74 % pour rattraper l'avance prise :
  4 ETB 30 ans, 3 coffrets ex (+1 entamé dont les packs vont aux lots
  mystère), 2 tripacks, 20 boosters, 25 lots mystère, 15 prison, le
  reste en communes.

Étalé sur 3 300 € encaissés (367 parties). Au-delà, plan standard et
règle des 26 % : il faudra un nouveau stock. Bilan attendu sur tout le
direct (1 500 € déjà faits + 3 300) : environ 28 % de marge, soit
l'objectif initial retrouvé.

Même mécanique que le recalibrage précédent (ceilingFor, recette
paramétrée, application unique sous la clé pika_recal, nouvel id donc
appliqué même si l'ancien l'avait été). Vérifié dans le navigateur :
premier chargement, idempotence, remise à zéro.


---

## 49a90ad — Recalibrage du cycle en cours : 380 € d'avance étalés sur les 3 000 € restants

Constat à 1 500 € encaissés, aux prix annoncés par l'hôte : 1 490 € de
lots déjà sortis (6 coffrets, 1 ETB, 3 tripacks, 20 boosters — pour
l'essentiel à la touche forcée, donc invisibles pour la comptabilité du
jeu), là où la règle des 26 % en autorisait 1 110. Soit 380 € d'avance.

Plutôt que de bloquer tous les gros lots jusqu'à ce que la cagnotte
rattrape (une soixantaine de parties à communes), l'avance est étalée
sur le reste du cycle : sur les 3 000 € restants la part reversée passe
de 74 % à 61,3 % (1 840 € au lieu de 2 220), et la file des lots est
reconstruite avec le stock qui reste vraiment : 4 ETB, 31 boosters,
50 lots mystère, 13 prison, le reste en communes. Plus de coffret, de
tripack ni de duopack : leur budget de cycle est consommé. Au terme du
cycle (4 500 €), la règle normale reprend.

Mécanique :
- ceilingFor(mise) remplace CEILING_RATIO*mise partout où le jeu vérifie
  qu'un lot est couvert (fundedCategory, outcomeCovered, peekNextOutcome) ;
- buildOutcomeBatch accepte une recette, une pente et une taille de
  référence ; sans argument, comportement inchangé ;
- appliqué UNE fois au chargement (clé pika_recal) : compteurs posés à
  l'état réel, file de 333 parties reconstruite. « Démarrage cagnotte »
  l'efface définitivement et il ne se réapplique jamais.

Vérifié dans le navigateur : premier chargement (compteurs et file
attendus, aucune erreur de plafond), second chargement (idempotent),
remise à zéro puis rechargement (cycle normal, pas de réapplication).


---

## f14be42 — Télé verticale : la photo du lot ne déborde plus de la zone du plateau

En disposition pivotée, l'overlay de célébration est volontairement
ramené sur la seule zone du plateau (fitCelebToBoard), qui ne fait que
260 px de haut dans le repère de #app. Mais la photo et le panneau sont
dimensionnés en vh/vw — or #app est tourné de 90°, donc ces unités ne
correspondent plus à ses axes : la photo était calculée sur le viewport
(jusqu'à 349 px de haut, .celeb-text jusqu'à 1248 px) et débordait
largement de sa boîte, par-dessus le plateau et les panneaux.

fitCelebToBoard publie désormais la hauteur réelle de l'overlay dans
--celeb-box-h, et la photo comme le panneau s'y mesurent. Le contenu
tient dans sa boîte quelle que soit l'orientation.

Reproduit et vérifié en captures, écran vertical 760x1300 pivoté : avant,
la photo et l'annonce traversaient les panneaux ; après, la photo reste
contenue dans la zone du plateau. Aucun effet hors disposition pivotée :
la variable n'est posée que dans cette branche.

Réserve : le libellé du lot ("BOOSTER DU MARCHAND GAGNÉ !") traverse
toujours les panneaux dans ce test, et les proportions testées ne sont
pas forcément celles de la télé réelle.


---

## b1c3d3d — Revert "La photo du lot ne repasse plus derrière le plateau sur iOS"

This reverts commit f26d6061c0a5980ee47c9ad910d819f2cf9f99c5.

---

## f26d606 — La photo du lot ne repasse plus derrière le plateau sur iOS

Sur iPhone/iPad la photo du lot s'affichait DERRIÈRE le plateau, à
l'aperçu comme sur un lot remporté, en ne venant devant qu'environ une
seconde. Sous Chrome/Android l'empilement était correct — d'où un bug
invisible en test sur ordinateur.

Cause : le canvas WebGL du plateau (#gl) a sa propre couche de
composition, et Safari peut peindre un calque NON promu derrière elle
quel que soit son z-index. L'overlay de célébration n'était promu que
par accident, pendant l'animation .shake : le transform de ses keyframes
lui donnait une couche, et le script retirant la classe au bout de
700-900 ms la lui reprenait aussitôt. C'est exactement la seconde
pendant laquelle le lot passait devant.

Correctif : translateZ(0) permanent sur .celebration, pour que la couche
ne dépende plus d'une animation en cours. Les keyframes de celebShake
passent en translate3d afin de ne pas retirer la composante Z pendant
l'animation. backface-visibility:hidden évite le clignotement au
basculement de couche.

Aucun changement de mise en page : seule la façon dont Safari compose le
calque change. Vérifié sans régression sous Chromium (aperçu et lot
remporté restent devant le plateau).

À CONFIRMER SUR UN VRAI IPHONE : ce conteneur n'a ni Safari ni GPU, le
symptôme ne s'y reproduit pas et le correctif ne peut donc pas y être
observé.


---

## 3dfb76d — Aperçu du lot : reprendre la surface de célébration avant de l'utiliser

Durcissement défensif — PAS un correctif de bug observé.

showLotPreview() remet celebLocked à false puis affiche l'aperçu, sans
arrêter la boucle de confettis d'une célébration précédente. Or celebFrame(),
en se terminant, retire lui-même la classe 'show' quand rien ne le verrouille :
une boucle encore en vol peut donc effacer ce qui vient d'être affiché.

Ce scénario n'a PAS pu être reproduit : tous les chemins menant à l'aperçu
passent d'abord par clearCelebration(), qui annulait déjà la boucle. Le défaut
est latent, pas atteignable en jeu normal. Le comportement du jeu est donc
inchangé sur tous les chemins existants.

Deux points nettoyés au passage :
- stopCelebLoop() regroupe l'arrêt de la boucle, jusque-là recopié à la main ;
- le canvas est effacé à l'arrêt. celebFrame() ne nettoie qu'au DÉBUT de
  chaque image : une boucle annulée en vol laissait sa dernière image peinte.

Non vérifié en conditions réelles : ce conteneur n'a pas de GPU, la scène
tourne à ~1,2 image/s et les confettis ne se dessinent jamais. À confirmer
sur un vrai appareil.


---

## d480f28 — Les lots programmés à la touche sortent enfin tous

Signalé à l'usage : « j'ai programmé au moins trois fois des cases à
l'aide des touches, je pense que ça dérègle le jeu ». Vérifié en jouant
des parties entières au clavier, la programmation échouait — mais pas
pour la raison supposée, et pas pour tous les lots.

Le mécanisme lui-même était bon : planTotal visait correctement la case
demandée à chaque lancer. Le problème est arithmétique. Le plateau
compte 36 cases, le Coffret est en case 34 et l'ETB en case 35, alors
que 3 lancers (+1 par double) parcourent une vingtaine de cases. Les dés
visaient la bonne case sans jamais avoir assez de lancers pour
l'atteindre : la partie se terminait sur une commune, et le lot
programmé passait à la trappe.

Relevé avant correction, une partie complète par touche :
  Tripack (3), Duopack (4), Mystère (6) : atteints
  Coffret (2) : jamais — et par construction ETB (1) et Z non plus,
  puisque ce sont les deux cases les plus éloignées du plateau.
Autrement dit, les deux plus gros lots — ceux qu'un animateur programme
justement pour un direct — étaient exactement ceux qui ne pouvaient pas
sortir.

Une partie programmée accorde désormais les lancers nécessaires pour
atteindre sa case, dans la limite de 15. La rallonge est appliquée avant
le test d'épuisement des lancers : sinon le lot de la case d'arrivée
était validé automatiquement à cet instant précis et la programmation
tombait à l'eau malgré tout.

Cela ne touche QUE les parties programmées, déjà hors comptabilité.

Vérifié après correction, une partie complète par touche :
  1 ETB, 2 Coffret, 3 Tripack, 4 Duopack, 5 Booster, 6 Mystère,
  Z ETB bonus, M Tripack bonus : 8 sur 8 atteints, en 3 à 5 lancers.
  Aucune mise ni aucun lot compté sur ces parties, aucun résidu d'état
  après coup (forcedCat et forcedGame remis à zéro).
  Partie normale de contrôle : 3 lancers, mise comptée normalement.


---

## 4e0c32d — Mode éco : figer les 36 bandes du fond, le poste le plus cher de la page

Mesuré au lieu de supposé. En désactivant chaque poste décoratif l'un
après l'autre et en comptant les images rendues, les suspects évidents se
sont révélés négligeables (étoiles filantes, flou du fond, voile
lumineux, backdrop-filter : tous dans le bruit de mesure), alors que
« couper toutes les animations CSS » rapportait 64 %. L'inventaire des
animations réellement en cours donne la réponse : 37 animations, dont 36
sur les bandes du fond.

Le fond est découpé en 36 bandes pour lui donner une ondulation. Chaque
bande porte will-change:transform, ce qui force le navigateur à lui
allouer son propre calque GPU : 36 grands calques, chacun gardant sa
copie rasterisée de la photo, tous recomposés à chaque image — et
d'autant plus grands que l'écran est grand, ce qui explique qu'une télé
souffre plus qu'un petit écran, et que la mémoire GPU finisse par
saturer jusqu'à faire lâcher le contexte.

Le tout pour un balancement de ±2,2 pixels.

En mode éco l'ondulation est figée et les bandes redeviennent des
éléments ordinaires. La photo de fond est exactement la même ; seul le
tremblement disparaît.

Mesuré (télé 1080x1920 pivotée, mode éco, images rendues en 4 s) :
  bandes animées ....................... 44
  figées seulement ..................... 52  (+18 %)
  sans will-change seulement ........... 52  (+18 %)
  figées ET sans will-change ........... 76  (+73 %)
Les deux ensemble valent bien plus que chacun séparément : tant qu'une
animation tourne dessus, le calque reste promu.

Sur la version livrée, en configuration télé (images rendues en 5 s) :
  qualité pleine : 24 images, 347 dessins/image, 45 animations CSS
  mode éco       : 75 images, 220 dessins/image,  1 animation CSS
soit 3,1 fois plus d'images. Fond, plateau et boutons intacts, aucune
erreur.


---

## 0649e36 — Une annonce ne s'efface plus jamais toute seule

Retour d'usage : « les lots ne s'affichent pas à certains moments, ou ils
restent une seconde ». C'était exact, et il restait un chemin non
corrigé.

Sur trois endroits qui affichent un lot, deux passaient déjà le verrou
locked. Le troisième, la révélation automatique d'une carte Chance ou
Caisse Communautaire, ne le passait pas. Conséquence : la durée
d'affichage de la carte n'était pas décidée par le jeu mais par
l'animation de confettis, qui retire l'annonce dès ses particules
retombées — 2,4 s en général, et 1,2 s dès qu'il s'agit d'un lot de
consolation. La carte disparaissait donc avant d'avoir été lue, parfois
avant même la fin du temps de lecture prévu juste en dessous. Le code
prévoyait pourtant déjà d'effacer la carte explicitement à la fin : le
minuteur des confettis le faisait avant lui.

Ce chemin est désormais verrouillé comme les deux autres, et la carte
est effacée explicitement après le temps de lecture, pour dégager le
plateau avant le déplacement. La règle est maintenant la même partout :
une annonce ne s'efface que quand le code le décide.

Temps de lecture porté à 2,8 s (3,6 s pour une carte rare), regroupé en
deux constantes nommées en tête de fonction pour être réglable à
l'antenne.

Vérifié en jouant une partie complète avec un mouchard sur l'annonce :
toutes les disparitions sont provoquées par la touche B, aucune n'est
spontanée. Les lots sont restés affichés 10,3 s et 6,7 s, c'est-à-dire
aussi longtemps que l'animateur l'a voulu.


---

## 78ac512 — Mode éco : couper aussi la décoration de la page, pas seulement la 3D

Retour d'usage : sur un Mac relié à une télé en HDMI, ça rame en
permanence, « même à l'arrêt ». Un coût constant et indépendant de
l'action ne vient pas de la scène 3D — il vient de la page.

Deux postes tournent sans fin, plateau immobile :

  - les 8 étoiles filantes du fond. Chacune combine un clip-path en
    étoile et une ombre portée, et son animation la fait tourner ET
    changer d'échelle. Le navigateur ne peut donc rien mettre en cache :
    il redessine les 8 formes à chaque image, indéfiniment. Ce sont les
    mêmes étoiles qui disparaissent déjà quand le système demande moins
    d'animations — c'est de la décoration, rien d'autre ;

  - #bgFill, un calque plus grand que l'écran flouté à 22 px. Il n'est
    affiché QUE dans le mode pivoté, c'est-à-dire précisément la
    configuration télé, et il est placé dans #app, qui subit la rotation
    CSS.

Le mode éco pose désormais une classe « eco » sur <html> : les étoiles
sont retirées et le fond garde son assombrissement sans le flou.

Vérifié (1080x1920, pivot 270) :
  qualité pleine : 8 étoiles animées sur 8, 45 animations CSS,
                   filtre du fond « blur(22px) brightness(.45) ... »
  mode éco       : 0 étoile sur 8, 37 animations CSS,
                   filtre du fond « brightness(.45) saturate(1.15) »


---

## c4f6ec6 — Le plantage GPU n'est plus fatal, et le mode éco coupe deux fois plus

Le jeu s'est arrêté net en plein direct. Ce n'était plus de la lenteur :
quand le GPU sature (chauffe, mémoire), le navigateur retire le contexte
WebGL. Rien ne gérait cet événement, donc le plateau se figeait
définitivement — pour l'animateur, « le jeu a crashé ».

1. Perte de contexte rendue non fatale. On écoute webglcontextlost, on
   appelle preventDefault (sans quoi le navigateur ne restaure jamais),
   on mémorise que cet appareil a lâché, on prévient à l'écran et on
   relance la page. Au rechargement, un appareil qui a déjà lâché repart
   verrouillé en mode éco : sans ça il relâche dans la minute. Les
   totaux, la cagnotte et les lots déjà décidés sont persistés, la
   partie reprend.

   Vérifié en arrachant réellement le contexte (WEBGL_lose_context) :
   le jeu se relance seul et revient avec le mode éco verrouillé.

2. 39 halos sur 40 étaient dessinés à chaque image pour rien. Un objet
   transparent d'opacité nulle est quand même trié et rendu ; ils sont
   maintenant masqués (visible=false). Aucun changement visible.

3. Mode éco renforcé : disques d'ombre sous les lots masqués (40 objets
   transparents de plus), rendu à 0,6x, et cadence plafonnée à 30
   images/s. Un appareil qui suffoque tient une cadence régulière à 30
   bien mieux qu'une cadence erratique entre 15 et 25, et il chauffe
   deux fois moins — or c'est la chauffe qui fait lâcher le GPU.

Mesuré (téléphone 390x844, pendant une partie), par rapport au relevé
d'origine de 382 appels de dessin par image :
  - qualité pleine : 382 -> 347
  - mode éco       : 382 -> 155 (-59 %)
  - images rendues sur une même durée : 40 -> 143


---

## d85beaa — Retour à la disposition d'origine en télé pivotée, règles toujours masquées

Regrouper « Lots à gagner », « Partie en cours » et « Derniers gains »
dans une bande sous le plateau obligeait à redécouper la grille du mode
pivoté : le plateau passait d'une zone couvrant toute la grille à une
seule colonne. Résultat à l'usage : tout le plateau se retrouvait
décalé. La disposition d'origine est rétablie telle quelle.

Il ne reste de ce chantier que ce qui était vraiment demandé : le
panneau « Règles » n'est pas affiché en mode pivoté. Vérifié : le
fichier ne diffère de la disposition d'origine que par cette seule
règle CSS.


---

## de54496 — L'aperçu du lot reste affiché, et le ralenti du lot mystère est resserré

1. À l'arrivée sur une case, l'aperçu du lot s'effaçait tout seul au
   bout de 2,6 s. Le public n'avait pas le temps de le regarder et
   l'animateur ne pouvait pas le commenter. Le commentaire qui décrit
   l'appel de cet aperçu annonçait d'ailleurs déjà le comportement
   voulu — « il ne disparaît que si l'animateur relance un tirage » —
   c'est le minuteur qui était resté.

   Il reste maintenant à l'écran jusqu'à une action de l'animateur :
   relancer (TIRER LES CARTES / touche B, qui passe déjà par
   clearCelebration), garder le lot (LOT REMPORTÉ, qui le verrouille),
   ou RECOMMENCER. Le motif invoqué pour l'effacement automatique
   — dégager les boutons — ne tenait pas : l'overlay est en
   pointer-events:none et n'a jamais intercepté un clic.

   Vérifié bout en bout : aperçu affiché à l'arrivée, toujours présent
   à +3 s, +6 s et +10 s, puis effacé par la touche B.

2. Lot mystère : la fin de course de l'ombre était trop étirée. Les
   trois derniers sauts duraient 1,24 s à eux seuls, le dernier 520 ms,
   et l'ombre paraissait bloquée sur une carte avant l'annonce. Le
   ralenti est conservé mais resserré — dernier saut à 350 ms, 2,37 s
   de suspense au lieu de 2,80 s. Le nombre de sauts reste impair (11),
   donc l'ombre finit toujours sur la carte perdante.


---

## 7db4778 — Télé pivotée : les trois panneaux regroupés sous le plateau, sans les règles

Sur une télé tournée, le plateau s'étalait sur toute la grille et les
deux panneaux se retrouvaient de part et d'autre de lui : « Partie en
cours / Derniers gains / Règles » tout en haut de l'écran, « Lots à
gagner » tout en bas, le plateau coincé entre les deux.

L'interface étant tournée de 90°, les colonnes de la grille se lisent
verticalement à l'écran et ses lignes horizontalement : « sous le
plateau » à l'écran veut dire « à côté du plateau » dans la grille. Le
plateau prend donc maintenant une seule colonne — une bande à l'écran —
et les deux panneaux la colonne voisine, côte à côte dans la bande
restante. Le sens du pivot décide laquelle des deux colonnes tombe en
bas, d'où un bloc par sens (rot90 et rot270).

Les règles ne sont plus affichées dans ce mode : elles s'adressent à
l'animateur, pas au public.

Mesuré (1080x1920, pivot 270) : plateau 937x1252 en haut de l'écran,
puis sur une même bande en dessous « Lots à gagner » (600x553, à
gauche), « Partie en cours » et « Derniers gains » (324x553, à droite).
Panneau des règles : 0x0.


---

## 4203d39 — Mode éco : cran de qualité supplémentaire pour les téléphones

Relevé sur la scène pendant une partie : 380 appels de dessin par image,
309 objets dessinables visibles dont 117 sprites décoratifs en fondu
additif et 191 objets transparents, plus 43 objets redessinés dans la
passe d'ombres. C'est ce volume, et non un calcul du jeu, qui étrangle
un GPU de téléphone.

L'échelle de qualité existante s'arrêtait trop haut : son dernier cran
gardait le flou lumineux (à lui seul ~17x le coût du reste du rendu),
les ombres et toute la décoration. Nouveau cran 5 « éco » :
  - flou lumineux désactivé (la passe est sautée, le rendu part
    directement à l'écran) ;
  - passe d'ombres désactivée ;
  - liseré de loupiotes, loupiotes tournantes et étincelles d'ambiance
    masqués, et leur animation par image court-circuitée ;
  - rendu à 0,75x.

Deux autres changements pour que ça serve vraiment :
  - l'échelle réagit en ~0,6 s par palier au lieu de ~1,5 s, avec 0,8 s
    d'attente entre deux crans au lieu de 2 s. Atteindre le bas prenait
    une dizaine de secondes, soit exactement la durée pendant laquelle
    l'animateur lance sa partie ;
  - un écran de téléphone démarre directement au cran 3 au lieu de
    découvrir sa lenteur en route, et ?q=0..5 impose un cran figé pour
    préparer un réglage connu avant un direct.

Le plateau, le pion, les lots, les règles et la comptabilité sont
inchangés : seule de la décoration est retirée.

Mesuré (téléphone 390x844, rendu logiciel, pendant une partie) :
382 -> 270 appels de dessin par image (-29 %), et 64 images rendues au
lieu de 40 sur la même durée (+60 %). Aucune erreur JS.


---

## 950b79e — Lot mystère lisible et lot remporté qui reste à l'écran

Deux défauts visibles pendant une partie :

1. L'ombre du Lot Mystère ne choisissait plus rien. Elle était placée
   avec getBoundingClientRect, or l'interface pivotée (télé verticale,
   touche R, ?rot=90) tourne tout #app : les rectangles écran sont
   tournés, largeur et hauteur s'inversent et l'écart horizontal entre
   les deux cartes tombe à zéro. L'ombre apparaissait donc de travers,
   au mauvais format, et ne sautait plus d'une carte à l'autre — le
   suspense du tirage disparaissait. Les positions sont maintenant
   lues dans le repère de mise en page (offsetLeft/offsetTop),
   insensible à la rotation, comme le fait déjà fitCelebToBoard(). Le
   saut gère aussi l'axe vertical, au cas où les deux cartes se
   retrouvent l'une sous l'autre sur un écran étroit.

   Mesuré (télé pivotée, 1280x720) : avant, écart entre les cartes
   0 px et ombre en 383x274 sur une carte de 274x383 ; après, écart
   308 px et ombre pile sur la carte.

2. Sur l'écran public, le lot remporté s'effaçait tout seul dès la fin
   des confettis — 1,8 s mesurée sur un petit lot. La fenêtre de
   contrôle verrouille l'affichage (locked), l'écran public recevait le
   même événement sans ce verrou. Il l'applique désormais aussi : le lot
   reste affiché jusqu'à RECOMMENCER, qui arrive déjà par le message
   'restart'.

   Mesuré : avant 1,8 s puis disparition ; après, toujours affiché au
   bout de 10 s, et correctement effacé au RECOMMENCER.


---

## 2796291 — Touche Z : plus d'annulation du dernier lot

Z ne sert plus qu'à programmer l'ETB avant le premier lancer.
L'annulation d'un lot validé reste possible avec le bouton à l'écran.


---

## 757cf87 — Lots programmés (touches 1-6 / Z / M) : plus aucun texte à l'écran

La bulle « … forcé pour cette partie » et la ligne des touches dans les
règles télé sont retirées : les joueurs ne doivent rien voir. Seul le
point discret en bas à gauche passe au blanc pour confirmer à
l'animateur qu'un lot est programmé.


---

## 12d5423 — Télé verticale / pivot : la célébration du lot reste sur la zone du plateau

En disposition verticale (pivot R ou vrai écran vertical), l'overlay
« lot remporté » couvrait tout l'écran et masquait « Partie en cours »
(dernier tirage) et les derniers gains. Il est maintenant calé sur la
zone du plateau (offsets de mise en page, insensibles à la rotation
CSS), avec une photo plafonnée à 46 % de la hauteur. Horizontal inchangé.


---

## 450d679 — Pourcentages de chances masqués (plaque centrale et légende télé)

Les joueurs ne doivent pas voir les chances de chaque lot : SHOW_ODDS
à false, fmtOddsPct rend une chaîne vide. Les chances restent calculées
pour la simulation et les réglages, elles ne sont plus dessinées.


---

## 39c5087 — Touches 1 à 6 avant le premier lancer : un lot forcé par touche

1 ETB, 2 Coffret, 3 Tripack, 4 Duopack, 5 Booster, 6 Lot Mystère (par
position physique de touche, donc sans Maj sur AZERTY ; pavé numérique
accepté). Z et M restent. Même mécanique de partie-bonus hors
comptabilité ; le Lot Mystère forcé tire booster/carte à 50/50 sans
toucher aux compteurs. Légende TV mise à jour.


---

## 362fac4 — Fluidité : plus de filtres CSS plein écran recalculés à chaque image, crans de qualité en plus

- La respiration lumineuse du ciel animait « filter:brightness/saturate »
  sur le conteneur plein écran des bandes : un filtre plein écran à
  chaque image. Remplacée par un voile dont seule l'opacité est animée.
- L'ombre du plateau était un « filter:drop-shadow » sur le conteneur du
  canvas WebGL, donc un flou de toute la zone du plateau à chaque image
  rendue. Remplacée par un dégradé fixe sous le canvas.
- Qualité adaptative : ombres PCF simples à partir du cran 2, cran 4 à
  0,85x ; départ un cran plus bas quand le canvas dépasse ~2,4 Mpx.


---

## 394fc30 — Pivot par défaut via data-rot sur <html> (version « télé verticale » livrée déjà pivotée)

L'attribut data-rot posé sur <html> fixe le pivot initial quand aucun
choix n'a encore été mémorisé (?rot= dans l'adresse et le choix R /
Pivoter gardent la priorité). Le bundler conserve désormais les
attributs de la balise <html>. Une copie du bundle avec data-rot="90"
donne une version qui s'affiche droite sur une télé tournée, sans
toucher à aucun bouton.


---

## 3f009a5 — Touche M avant le premier lancer : Tripack forcé (même mécanique que Z)

Généralisation du lot forcé : Z = ETB, M = Tripack, partie-bonus hors
comptabilité dans les deux cas (ni mise ni lot comptés, file intacte).
Une seconde pression annule ; C remet à zéro. Légende TV mise à jour.


---

## 6eb8699 — ETB forcée (Z) : partie-bonus hors comptabilité

La partie lancée après Z ne compte ni sa mise ni son lot dans la
cagnotte / le plafond de reversement, et ne touche pas la file
pré-calculée des 500 parties : c'est une ETB en plus, offerte par
l'animateur. Annulation (Z) et recommencer (C) restaurent l'état.


---

## b84e614 — Touche Z avant le premier lancer : ETB forcée pour la partie

Z, appuyée avant le premier lancer, force l'ETB comme lot de la partie
à venir, sans aucune règle de couverture ni de rentabilité. L'ETB est
prise dans la file pré-calculée (la prochaine en attente est avancée)
pour que le stock reste juste ; Z une seconde fois annule. Z pendant
une partie reste « annuler le dernier lot validé ». Le signal animateur
(étoiles, point) reflète l'ETB forcée ; C remet à zéro.


---

## d450d4b — Boutons écran « Pivoter » et « Plein écran » (souris), plaque centrale plus fine sur grand écran

Les touches R et F n'atteignent le jeu que si sa fenêtre a le clavier :
deux boutons discrets en bas à droite, visibles au mouvement de la
souris et effacés après 6 s, font la même chose au trackpad. Jamais sur
l'écran public. La texture de la plaque centrale passe à 1400 px quand
l'écran fait au moins 1600 px.


---

## 536e571 — Pivot 90° de l'interface (touche R, ?rot=90/270) pour une télé tournée avec le Mac resté en paysage

Toute l'interface tourne d'un quart de tour dans l'écran horizontal et
prend la disposition « télé verticale » (copie des règles avec vw/vh
inversés, puisque l'écran réel reste en paysage). Les écrans superposés
tournent avec elle ; le canvas de célébration prend la taille de sa
boîte et non de la fenêtre. Sens mémorisé dans le navigateur. Le mode
horizontal ne s'applique plus quand l'image est pivotée.


---

## 9ad5a5b — Mode TV verticale (télé 16:9 en portrait) + cadrage caméra par mode

Portrait haut (≥ 1100 px de haut, ratio ≤ 3:4) : bannière agrandie,
plateau sur toute la largeur, puis « Lots à gagner » sur deux colonnes
et « Partie en cours » / « Derniers gains » côte à côte, règles en une
ligne. Caméra nettement plus en plongée pour ce cadre (le plateau
projeté remplit largeur et hauteur). Distance caméra absolue par mode
(plus de cumul de ratios), et correction d'une mutation en place des
directions de référence qui faussait le cadrage au 2e changement de
mode. Téléphone et mode horizontal inchangés.


---

## 07eab53 — Écran 16:9 : cadrage caméra recalculé à chaque redimensionnement et au plein écran, écrans superposés dimensionnés pour la TV

Le facteur de recul/rapprochement de la caméra n'était calculé qu'au
chargement : après un passage en plein écran ou un déplacement vers un
écran externe, le plateau restait cadré pour l'ancienne fenêtre. Il est
maintenant recalculé dans resize() et sur fullscreenchange, avec passage
automatique en plongée pour le cadre presque carré du mode TV.
Tirage, lot mystère, lot remporté, éclair et aide clavier passent en
fractions d'écran sur les grands écrans au lieu de bornes en pixels.


---

## a5ab2eb — Mode TV 16:9 : plateau plein hauteur au centre, lots à gauche, partie en cours à droite

Sur un écran large (ratio ≥ 3:2, largeur ≥ 1100 px) : colonne « Lots à
gagner » (photos, noms, chances, mêmes données que la plaque), plateau
3D qui occupe toute la hauteur au centre (caméra un peu plus en plongée
et plus proche pour un cadre presque carré), colonne « Partie en cours »
(lancers, dernier tirage, état), « Derniers gains » et « Règles ».
Dimensions en vw/vh, lisibles en 1920×1080 comme en 2560×1440. Touche F
pour le plein écran. Téléphone et tablette inchangés.


---

## 46f50a7 — Lot mystère à la place de la Zone Safari : booster ou carte rare, 30 boosters par cycle

La case « Lot Mystère » donne un booster ou une carte rare. Le tirage est
calibré pour donner exactement 30 boosters sur les 116 lots mystère du
cycle (probabilité = boosters restants / lots mystère restants),
compteurs persistés avec la file, rendus à l'annulation. Mise en scène à
la validation : deux cartes noires se retournent, une ombre saute de
l'une à l'autre en ralentissant et s'arrête sur la perdante, la carte
restée en lumière est le lot ; puis affichage classique du lot gagné.
Nouvelles images : booster, carte rare, et visuel « ? » pour la case,
la plaque et l'aperçu.


---

## 1acb07d — Dos de carte : photo entière regradée dans les tons foncés de l'ancienne (bleu plus profond, logos complets)


---

## c4636eb — Repère animateur : les deux étoiles changent de teinte pour l'ETB comme pour un coffret


---

## 4bdfb44 — Repère animateur plus discret : teinte de l'étoile du titre au lieu de sa forme


---

## 2039653 — Repère animateur dans le titre : ✦ à la place de ★ quand l'ETB (2 étoiles) ou un coffret (étoile gauche) est le prochain lot


---

## 20e8ea2 — Tirage : vrai dos de carte Pokémon entier, sans cadre ajouté

L'image fournie par l'hôte remplit toute la carte (logo haut et bas
visibles), coins arrondis, plus de liseré doré ni de photo rognée.


---

## 84a44c0 — Repère animateur : passe au lot de la partie suivante dès la validation, avant « Recommencer »


---

## d0ca829 — Repère discret animateur : point de 5 px quand le prochain lot est l'ETB ou un coffret

Doré pour l'ETB, bleuté pour un coffret, opacité 22 %, en bas à gauche
de l'écran animateur uniquement (jamais sur l'écran public). Connu dès
la fin de la partie précédente (même règle de couverture qu'au tirage),
maintenu pendant les lancers, éteint à la validation.


---

## caaeee2 — Photo du Tripack 30 ans remplacée par le Coffret Poster fourni par l'hôte


---

## 6d6f834 — Recette : stock réel de 28 produits (11 coffrets, 6 tripacks, 6 duopacks, 5 ETB)

9 coffrets, 3 tripacks et 3 duopacks ouverts : 51 boosters et 24
promos/jumbos. Par cycle de 500 parties : 5 ETB, 2 coffrets, 3 tripacks,
3 duopacks, 51 boosters, 116 Zone Safari (dont 24 promos/jumbos),
20 prisons, 300 communes. Simulé : marge 27,1 à 29,3 % à la valeur
marché, plafond jamais dépassé.


---

## 3cba46a — Jackpot ETB : orage sur la case du pion à la place du plateau qui éclate

Le décor et l'exposition s'assombrissent, la caméra tourne autour du
pion, la foudre frappe sa case en rafale (éclairs 3D ramifiés, flash
des lumières, onde qui parcourt les cases, étincelles, tonnerre, coups
de caméra), puis une colonne de lumière dorée monte de la case avec la
pluie d'or, jusqu'au flash blanc final qui révèle le lot. Tout est
remis à plat à « Recommencer » ; désactivé avec prefers-reduced-motion.


---

## 9a976a2 — Célébration "gros lot" pour tripack, coffret et ETB

Rayons lumineux qui tournent derrière le lot, stroboscope à l'ouverture,
panneau qui claque à l'écran, titre et photo qui pulsent, bandeau
« GROS LOT », éclairs en rafale synchronisés avec des coups de caméra et
des impacts sonores, secousse du plateau (tripack, coffret), pluie d'or
3D pour le coffret, pluie de confettis et feux d'artifice plus denses.
Respecte prefers-reduced-motion. Les pioches Chance/Caisse gardent leur
retournement de carte.


---

## 64b2eef — Recette : 15 % de lots 30 ans (2 tripacks et 2 duopacks ouverts en plus), prison 4 %, Safari 28 %

Par cycle de 500 parties : 5 ETB, 2 coffrets, 3 tripacks, 3 duopacks,
42 boosters, 140 Zone Safari (dont 20 promos/jumbos), 20 prisons,
285 communes (57 %). Simulé : marge 26,4 à 27,5 % à la valeur marché,
plafond jamais dépassé, 100 % des lots atteints.


---

## 813aab9 — Rentabilité : cycle = tout le stock 30 ans (500 parties, 4500 €), lots à leur valeur marché

Recette convenue avec l'hôte : 5 ETB, 2 coffrets, 5 tripacks, 5 duopacks,
32 boosters, 136 Zone Safari (dont 16 promos/jumbos des coffrets ouverts),
15 prisons, 300 communes (60 %). Coûts = valeur de revente constatée à la
sortie ; marge garantie 26 % à chaque instant sur cette base (~48 % sur le
prix payé). Un produit scellé prévu (≥ 30 €) retourne toujours en file si
le joueur s'arrête avant. Simulé sur 9 cycles : marge 26,7 à 27,5 %,
plafond jamais dépassé, 100 % des lots atteints.


---

## bf42821 — Plateau : chances de chaque lot (%) affichées sur la plaque centrale

Les pourcentages sont calculés à partir de la recette réelle du cycle
(OUTCOME_RECIPE / taille du cycle), jamais retapés à la main ; la plaque
est redessinée une fois la recette connue. Le nom du lot se réduit si
besoin pour laisser la place au chiffre.


---

## dcf7089 — Touche D : retenue pendant la marche et validée à l'arrivée, retour visible des touches

Le personnage semble arrêté pendant la décélération finale (~0,7 s)
alors que le trajet n'est pas fini côté jeu : un D pressé pile à
l'arrivée était perdu. Il est maintenant retenu dès que la marche a
commencé (destination déjà connue) et le lot est validé à l'arrivée
réelle. Un appui pendant le tirage n'est pas retenu ; un détour
Chance/Caisse l'oublie.

La barre de statut étant masquée, une petite bulle en bas de l'écran
explique désormais les appuis sans effet (B/D pendant la marche, lot
déjà validé, aucun lot à garder, partie terminée).


---

## e21ace7 — Touches B et D : message à l'écran quand l'appui n'a pas d'effet

D ne valide le lot que lorsque le personnage est arrivé sur une case à
lot. Pendant le tirage ou la marche, avant le premier lancer ou une fois
le lot déjà validé, la ligne d'état explique maintenant pourquoi rien ne
se passe et quelle touche utiliser. Aucun changement de règle.


---

