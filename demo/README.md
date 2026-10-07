# Démo Pikapoly Golden : le moteur, prêt pour un nouveau visuel

Ce dossier sert à **reconstruire tout le visuel de zéro** pour la démo destinée aux
investisseurs et à la demande de licence. Le jeu joué en direct (`board3d.js`,
`board3d_golden.js`, `Nsldkso.html`, `tools/build.py` à la racine) **n'est pas touché**.

## Ce qui est déjà fait

- `moteur/moteur.js` : toute la logique du plateau Golden, sortie du visuel. Il n'y a ni
  DOM, ni three.js, ni son. Le code est repris du jeu fonction par fonction, avec les
  mêmes noms (`buildPouch`, `gPlanifier`, `planTotal`…) pour qu'on puisse comparer.
- `moteur/moteur.test.mjs` : 11 tests sur plus de 2 000 parties simulées.
- `index.html` : une page **volontairement brute** qui pilote le moteur au clavier. Elle
  prouve que tout marche ; elle n'est pas un modèle de visuel.

## Lancer

```bash
cd demo
node --test moteur/moteur.test.mjs        # les tests : tout doit passer
python3 -m http.server 8000               # puis ouvrir http://localhost:8000
```

Les modules ES ne se chargent pas en double-clic (`file://`) : il faut le petit
serveur ci-dessus. Pour la livraison hors ligne du jour J, prévoir un assemblage en
un dossier ou un fichier, comme `tools/build.py` le fait pour le jeu en direct.

## Le jeu en bref (ce que le moteur garantit)

- **36 cases** sur un anneau de 10 × 10 (`PLATEAU`, `positionCase(i)`). Case 1 = Départ,
  qui ne donne jamais de lot.
- **Une partie** : le joueur tire 2 cartes de 1 à 6 (elles remplacent les dés), le pion
  avance du total. Il a 3 lancers, plus 1 à chaque double. Après chaque lancer, il
  **garde** le lot de sa case (D) ou **relance** (B). À la fin des lancers, il garde la
  case où il est. La **Prison** termine la partie tout de suite. **Chance / Caisse**
  font avancer ou reculer le pion.
- **La pochette** : une série de **130 coups** (un coup = une partie) qui contient
  exactement 110 boosters, 2 duopacks, 3 tripacks, 4 coffrets, 2 ETB, 4 Parc gratuit et
  5 Prison. Le lot de chaque partie est tiré dans la pochette au premier lancer, puis
  les cartes amènent le pion sur une case de ce lot.
- **Règles Golden** : le lot prévu se présente avec au moins un lancer derrière. S'il
  est refusé (le joueur relance), le joueur ne peut plus tomber que sur des boosters,
  et le lot refusé repart dans la pochette 2 à 15 coups plus loin.
- **X / Y / Z** (animateur, pion sur Départ) arment l'ETB, le coffret ou le tripack pour
  le prochain coup, **sans rien afficher**. Sans armement, ces trois lots ne tombent
  pas (ils ne sortent seuls qu'en toute fin de série).
- **Le lot gagné est toujours celui de la case où le pion est posé.**

## L'API

```js
import { creerMoteur, PLATEAU, CATEGORIES, LIEUX, positionCase } from './moteur/moteur.js';
const m = creerMoteur();   // enregistre l'état dans localStorage, clés « demo:… »
```

| appel | touche | rend |
|---|---|---|
| `m.tirer()` | B | le lancer complet, voir ci-dessous |
| `m.garder()` | D | `{ lot, caseIndex, prison, mystere, serieTerminee }` ou `{ refuse }` |
| `m.annuler()` | U | annule le dernier lot gardé, la partie reprend |
| `m.recommencer()` | C | nouvelle partie (le lot d'une partie non terminée retourne dans la pochette) ; après le 130e coup, repart à 0/130 tout seul |
| `m.armer('x' \| 'y' \| 'z')` | X Y Z | `{ arme }` : ne rien afficher |
| `m.etat()` | — | tout ce qu'il faut pour l'affichage (case, lancers, coups joués, ETB sorties, derniers gains, `peutGarder`, `peutTirer`…) |

`m.tirer()` calcule **tout le lancer d'un coup** et rend :

```js
{
  cartes: { a, b, total, isDouble,          // les deux cartes tirées
            slotOrder, reste, hop1, hop2, susp },  // pour mettre en scène le paquet de 12 cartes
  depart,            // case de départ (-1 = Départ)
  caseDes,           // case atteinte avec le total
  carte,             // détour Chance/Caisse : { type, texte, delta, de, vers } ou null
  caseFinale,        // où le pion s'arrête
  lotDeLaCase,       // la catégorie de cette case
  lancersUtilises, lancersAutorises,
  finAuto,           // 'prison' | 'lancers-epuises' | null
  gain,              // si la partie s'est terminée d'elle-même : le lot gagné, sinon null
}
```

**C'est au visuel de mettre en scène, dans l'ordre :**
1. le tirage des cartes ;
2. la marche du pion de `depart` à `caseDes` ;
3. la carte Chance/Caisse et le déplacement jusqu'à `caseFinale` ;
4. l'aperçu du lot, ou la célébration si `gain` est rempli.

Il ne doit accepter la touche suivante qu'une fois la scène jouée. Si D est pressé
pendant la marche, il est retenu et appliqué à l'arrivée, comme dans le jeu.

## Ce que le visuel ne doit jamais faire

- Afficher le lot prévu ou la suite de la pochette (`m._interne` est réservé aux tests).
- Effacer un lot annoncé tout seul : seulement sur B, C ou D.
- Afficher quoi que ce soit pour X / Y / Z.
- Modifier `moteur.js` pour changer une règle sans relancer les tests et le dire à
  l'animateur.
