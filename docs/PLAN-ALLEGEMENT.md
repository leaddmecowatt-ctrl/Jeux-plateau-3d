# Plan d'allègement — Pikapoly

> **Décision de l'animateur, 18/09/2026 : réécriture à zéro.** Le cahier des
> charges est `docs/CAHIER-DES-CHARGES.md`. Ce plan reste utile comme liste
> des pièges mesurés dans l'ancien code (fond, bloom, verrous, CSS en double) :
> la réécriture ne doit pas les reproduire.

État au 18/09/2026, branche `claude/code-refactoring-clarity-wqplw1`.
Ce fichier est **le contrat** de toute session qui touche au code : on le lit
avant, on le met à jour après. Il remplace les explications de vive voix.

## Le but, en une phrase

Le jeu reste **exactement le même à l'écran** — mêmes effets, mêmes lots,
mêmes timings, même ambiance. Ce qui change est **la façon dont c'est
construit**, pour que la page coûte moins cher à la télé et ne lâche plus.

## Ce qu'on ne fait pas

- **Pas de réécriture à partir de zéro.** Le comportement fin (marche du pion
  en cinématique inverse, rythme des lots, timings de célébration, cadrage
  télé) a été réglé pendant des mois sur le vrai appareil. Un jeu refait de
  zéro *ressemblerait* à celui-ci et se comporterait autrement partout.
- **Pas de couche en plus.** Chaque chantier **remplace** un mécanisme par un
  autre, plus léger, qui produit le même résultat. Si une correction ajoute
  un garde-fou sans retirer l'ancien, c'est la mauvaise correction.
- **Rien ne change à l'écran** sans que l'animateur l'ait décidé.

## Diagnostic (mesuré, pas supposé)

- **Aucune fuite mémoire.** 12 parties jouées au clavier, mémoire ramassée de
  force avant chaque mesure : tout est stable dès la 6ᵉ partie (géométries
  186 → 186, textures 72 → 72, objets 3D 504 → 504, écouteurs 52 → 52).
  Jouer plus ne dégrade rien.
- **Le coût est un niveau de base trop haut, en permanence** : le fond en
  36 calques GPU (réglé), le bloom, les ombres douces, un jeton PNG de
  548 Ko. Sur la télé, ce plafond touche la limite ; la moindre pression
  supplémentaire faisait lâcher le contexte WebGL (d'où `pika_q_forced`).
- **La règle d'argent était mêlée à la 3D** (réglé) : impossible de vérifier
  la marge sans démarrer une scène WebGL.

## Fait

| # | chantier | commit | à valider |
|---|---|---|---|
| 1 | Règle d'argent isolée dans `regles/argent.js`, 11 tests (`node --test tests/*.test.mjs`) | `44c0d0e` | rien : même comportement, vérifié |
| 2 | Fond : 36 bandes → 1 canvas + shader. Diff pixel avant/après : 1,2–1,5/255 | `1eb5969` | **sur la télé** : fluidité d'un jackpot |
| 2b | Sprites et disques d'ombre en lots instanciés : 344 → 268 appels de dessin par image. Diff pixel : seuls le médaillon Prison (qui pulse) et le pion (au repos) diffèrent, comme entre deux captures de l'ancien | `a3a0f1d` | **sur la télé** : fluidité |

## Reste, dans l'ordre

3. **Valider le nouveau fond sur la télé.** Ouvrir le bundle, lancer un
   jackpot (touche Z avant le premier lancer), comparer la fluidité à
   l'ancienne version. Si c'est moins bon : le dire, on revient en arrière.
4. **`assets/ui/jeton_confirm.png`** : 548 Ko pour 640×640. Même image,
   ré-encodée (~50 Ko). Vérification : capture avant/après du jeton.
5. **Bloom et ombres douces** (`UnrealBloomPass`, `PCFSoftShadowMap`) :
   mesurer leur coût sur la télé (les couper l'un puis l'autre en mode éco
   et compter les images). Décision avec l'animateur : ce sont des choix de
   rendu.
6. **Célébration** : quatre verrous pour un seul problème (`celebLocked`,
   `celebGen`, `hypeGen`, `stopCelebLoop`) → un seul compteur de
   génération. Même comportement (invariant : une annonce ne s'efface
   jamais seule). Ne se vérifie qu'à la main sur un vrai appareil.
7. **CSS** : la mise en page verticale est écrite deux fois
   (`@media (max-aspect-ratio: 3/4)` et `html.rotated`, ~80 lignes
   identiques à `vw`/`vh` près) → une seule. Vérification : captures
   dans les deux orientations.
8. **Sauvegarde de la comptabilité** : `pika_total_*` et la file vivent dans
   le `localStorage` d'un seul navigateur, sans export. Ajouter un export
   / import JSON (touche animateur, rien à l'écran public).
9. **`main`** : ne contient qu'un commit « Add files via upload », sans lien
   avec les 52 commits de cette branche. Faire de cette branche la référence.

## Méthode, pour chaque chantier

1. Lire ce fichier et `CLAUDE.md`.
2. **Capture avant** : bundle construit, Playwright, 1280×720 et 1080×1920.
3. Remplacer, pas ajouter. Supprimer ce que le nouveau mécanisme rend inutile.
4. `node --test tests/*.test.mjs` · `python3 tools/build.py --out dist/pikajackpot.html`
   · charger le bundle : **aucune erreur console** · capture après · comparer.
5. Commit en français qui dit *pourquoi*, puis mettre à jour ce fichier.
6. Le verdict sur la fluidité appartient à la télé, pas au cloud (pas de GPU ici).

## Pour démarrer une session neuve

> Lis `CLAUDE.md` puis `docs/PLAN-ALLEGEMENT.md`. Dis-moi en dix lignes ce
> que tu as compris et ce que tu comptes faire pour le chantier N, et attends
> mon accord avant de toucher au code.
