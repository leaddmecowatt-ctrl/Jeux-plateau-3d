/* =========================================================================
   PIKAPOLY — LA RÈGLE D'ARGENT
   =========================================================================
   Tout ce qui décide combien le jeu reverse, et quel lot tombe quand.
   C'est le seul endroit où se règlent la marge, les prix et les recettes.

   Ce fichier ne connaît NI le plateau, NI three.js, NI le navigateur :
   aucun `document`, aucun `localStorage`, aucune texture. Il ne contient
   que des constantes et des fonctions pures — mêmes entrées, même
   sortie. C'est ce qui permet de le vérifier en une seconde avec Node,
   sans démarrer de scène 3D :

       node --test tests/*.test.mjs

   L'état qui vit (cagnotte encaissée, total déjà reversé, file en cours,
   recalibrage appliqué) reste dans board3d.js : il est passé en
   PARAMÈTRE à ces fonctions, jamais lu ici. Une fonction de ce fichier
   ne peut donc rien casser ailleurs.
   ========================================================================= */

/* ---------- Règle métier de rentabilité ----------
   Pour chaque cycle de CA_CYCLE euros de chiffre d'affaires (mise moyenne
   AVG_MISE), la marge doit être d'au moins MARGIN_TARGET. Cette marge est
   tenue À CHAQUE INSTANT, pas seulement en fin de cycle : à tout moment,
   le total reversé ne dépasse jamais (1 − marge) de ce qui a été
   encaissé — un gros lot ne tombe donc que lorsque la cagnotte déjà
   encaissée le paie. Les statistiques de chute de chaque lot
   (OUTCOME_RECIPE) sont une affaire séparée, réglable sans toucher à
   cette garantie. */
export const AVG_MISE = 9;              // mise moyenne (euros)
export const CA_CYCLE = 4500;           // chiffre d'affaires d'un cycle (euros) : tout le stock 30 ans
export const MARGIN_TARGET = 0.26;      // marge garantie sur le cycle et à chaque instant, lots comptés à leur VALEUR MARCHÉ (revente)
export const CEILING_RATIO = 1 - MARGIN_TARGET;  // part maximale reversée (dérivée, ne pas régler ici)

/* ---------- Recalibrage sur le stock réel (18/09/2026, soir) ----------
   L'hôte a sorti des lots à la touche forcée (hors comptabilité) et le
   plan initial ne correspond plus à rien. On repart de ce qu'il RESTE
   en stock, à zéro de compteur, avec une marge relevée de 26 % à 41 %
   (part reversée 59 % au lieu de 74 %) pour rattraper l'avance prise :
     4 ETB 30 ans · 3 coffrets ex (+1 entamé, dont les packs vont aux
     lots mystère) · 2 tripacks · 20 boosters · communes/promos à volonté.
   Ce stock est étalé sur 3 300 € encaissés (367 parties à 9 €) : c'est
   ce qu'il faut pour le reverser à 59 %. Au-delà, le jeu reprend le plan
   standard et la règle des 26 % — il faudra un nouveau stock.
   Bilan attendu sur tout le direct (1 500 € déjà faits + 3 300) : environ
   28 % de marge, soit l'objectif initial retrouvé.
   Appliqué UNE seule fois (clé pika_recal) ; « Démarrage cagnotte »
   l'efface définitivement, et il ne se réapplique jamais ensuite. */
export const RECAL = {
  id: '2026-09-18b',
  miseBase: 0,                          // nouveau départ de compteur
  paidBase: 0,
  miseEnd: 3300,                        // horizon du stock restant
  ratio: 0.59,                          // part reversée : marge 41 %
  games: Math.round(3300 / AVG_MISE),   // 367 parties
  recipe: [
    { cat:'jackpot300',  n:4  },   // ETB 30 ans
    { cat:'etb',         n:3  },   // coffrets ex entiers
    { cat:'booster50',   n:2  },   // tripacks
    { cat:'gradee',      n:0  },   // duopacks : plus en stock
    { cat:'booster8',    n:20 },   // boosters
    { cat:'alternative', n:25 },   // Zone Safari / promos (cartes, gratuites pour l'hôte)
    { cat:'prison',      n:15 },
  ],
};

/* Plafond de reversement cumulé pour un encaissé donné : la règle
   normale (74 %), ou la pente réduite du recalibrage tant qu'il court.
   `recal` est l'état du recalibrage tenu par board3d.js : l'objet
   mémorisé s'il court encore, null sinon. */
export function ceilingFor(mise, recal){
  if(recal && mise < RECAL.miseEnd) return RECAL.paidBase + RECAL.ratio*(mise - RECAL.miseBase);
  return CEILING_RATIO*mise;
}

/* Paliers du plus cher au moins cher : un lot qui ferait dépasser le
   plafond de reversement cumulé redescend au premier palier qui
   passe encore sous ce plafond. */
/* Coût de chaque lot = sa VALEUR MARCHÉ (revente constatée à la sortie,
   16/09/2026), volontairement plus sévère que le prix d'achat réel
   (stock complet payé ~1 200 €) : la marge garantie ici est donc une
   marge « même si on comptait les lots à ce qu'ils valent sur Vinted ». */
export const PAYOUT_LADDER = [
  { cat:'jackpot300', cost:190 },   // ETB 30 ans
  { cat:'etb',         cost:85  },   // Coffret Amphinobi-ex / Nymphali-ex
  { cat:'booster50',   cost:58  },   // Tripack 30 ans
  { cat:'gradee',      cost:30  },   // Duopack 30 ans
  { cat:'booster8',    cost:17  },   // Booster 30 ans
  { cat:'alternative', cost:7.2 },   // Zone Safari (ou carte promo/jumbo 30 ans issue des coffrets ouverts)
  { cat:'commune',     cost:0.68 },
];
export const LADDER_IDX = {};
PAYOUT_LADDER.forEach((t,i)=>{ LADDER_IDX[t.cat] = i; });

// Coût réel de chaque catégorie (PAYOUT_LADDER + prison, qui n'y
// figure pas puisqu'il ne coûte jamais rien).
// Prison paie tout de même une carte commune de consolation.
export const OUTCOME_COST = { prison: 0.68 };
PAYOUT_LADDER.forEach(t=>{ OUTCOME_COST[t.cat] = t.cost; });

/* Quel palier peut-on RÉELLEMENT payer pour la catégorie demandée ?
   Rend l'entrée de PAYOUT_LADDER à payer (jamais null pour une
   catégorie connue : au pire le dernier palier, la commune), ou null si
   la catégorie n'est pas un lot (chance, caisse, détours).
   Fonction PURE : elle ne touche à aucun compteur. C'est l'appelant qui
   ajoute `tier.cost` à son total — voir fundedCategory() dans
   board3d.js. */
export function tierFor(catKey, totalMise, totalPaid, recal){
  const startIdx = LADDER_IDX[catKey];
  if(startIdx===undefined) return null;
  for(let i=startIdx;i<PAYOUT_LADDER.length;i++){
    const tier = PAYOUT_LADDER[i];
    const covered = totalMise>0 ? (totalPaid+tier.cost <= ceilingFor(totalMise, recal) + 1e-9) : true;
    if(covered || i===PAYOUT_LADDER.length-1) return tier;
  }
  return PAYOUT_LADDER[PAYOUT_LADDER.length-1];
}

/* Un lot est « couvert » si, une fois payé, le total reversé reste sous
   le plafond de la cagnotte RÉELLEMENT encaissée. La file est construite
   pour respecter ce plafond à 9 € par partie, mais la réalité peut
   diverger (parties recommencées sans valider, validation anticipée,
   ancienne file…) : ce contrôle en direct est la garantie finale. */
export function estCouvert(cat, totalMise, totalPaid, recal){
  const cost = OUTCOME_COST[cat];
  if(cost===undefined) return true;
  return totalPaid + cost <= ceilingFor(totalMise, recal) + 1e-9;
}

/* ---------- Lot prédéterminé (façon carte à gratter / machine à sous)
   ----------
   Les dés, les lancers et l'animation du pion restent un vrai spectacle
   (rien n'est truqué visuellement), mais le lot réellement remporté à
   chaque mise ne dépend plus de la case où le hasard des dés amène le
   pion : il est tiré à l'avance, dans un LOT (batch) de résultats déjà
   calculé et mélangé pour respecter exactement le taux de reversement
   cible (CEILING_RATIO), plutôt que de dépendre d'une moyenne sur le
   long terme qui peut dériver (cf. simulation : ~130% de reversement
   moyen avec des dés honnêtes sur ce plateau, très au-dessus des 50%
   visés, à cause des cases ETB/jackpot final à elles seules). À la fin
   de la partie, le pion est amené sur une case qui correspond VRAIMENT
   au lot déjà décidé, pour que la photo affichée corresponde toujours
   exactement à la case sur laquelle il est posé. */
export const OUTCOME_BATCH_SIZE = Math.round(CA_CYCLE/AVG_MISE);   // 500 parties = un cycle de 4500 €

/* Nombre de lots de chaque sorte PAR CYCLE de 500 parties (4500 €) :
   un cycle = TOUT le stock 30 ans de l'hôte (5 ETB, 11 coffrets dont 9
   ouverts, 6 tripacks dont 3 ouverts, 6 duopacks dont 3 ouverts : les
   ouvertures donnent 51 boosters + 24 promos/jumbos).
   Recette retenue avec l'hôte : 17,6 % de 30 ans (1 partie sur 5,7),
   communes 60 %, Zone Safari 23 % (dont les 24 promos/jumbos, remises
   par l'animateur), prison 4 %, marge 26,6 % à la valeur marché (~46 %
   sur le prix payé). Total 3304 € pour un plafond de 3330 €.
   Chance et Caisse ne sont pas des lots : ce sont des détours (la carte
   amène sur la case du lot prévu), voir CARD_ROUTE_P. */
export const OUTCOME_RECIPE = [
  { cat:'jackpot300',  n:5   },   // ETB 30 ans
  { cat:'etb',         n:2   },   // Coffret ex (1 Amphinobi, 1 Nymphali)
  { cat:'booster50',   n:3   },   // Tripack 30 ans
  { cat:'gradee',      n:3   },   // Duopack 30 ans
  { cat:'booster8',    n:51  },   // Booster 30 ans
  { cat:'alternative', n:116 },   // Zone Safari (92) + promos/jumbos 30 ans (24)
  // Prison : fin de partie immédiate, carte commune de consolation
  { cat:'prison',      n:20  },
];

/* ---------- Lot mystère ----------
   La case « Lot Mystère » (catégorie alternative) donne soit un booster,
   soit une carte rare. Décision de l'animateur (19/09/2026) : SEPT lots
   mystère sur DIX sont des boosters. Le tirage booster/carte est calibré
   pour tenir exactement cette part sur les lots mystère du cycle
   (probabilité = boosters restants / lots mystère restants), jamais plus,
   jamais moins. Compteurs persistés avec la file. La part s'applique
   aussi à une file déjà en cours (voir loadOutcomeState dans board3d.js). */
export const MYSTERY_BOOSTER_SHARE = 0.7;
export function boostersMystere(mystN){ return Math.round(mystN * MYSTERY_BOOSTER_SHARE); }

/* Chances par partie de chaque lot (recette / taille du cycle), pour la
   plaque centrale du plateau et la légende télé — le reste (commune) est
   déduit. Purement arithmétique : c'est l'appelant qui en fait une
   texture. */
export function chancesParLot(recipe = OUTCOME_RECIPE, baseSize = OUTCOME_BATCH_SIZE){
  const odds = {}; let used = 0;
  recipe.forEach(r=>{ odds[r.cat] = 100*r.n/baseSize; used += r.n; });
  odds.commune = 100*(baseSize-used)/baseSize;
  return odds;
}

/* Construit la file des lots d'un cycle : mélangée, mais garantie sous
   le plafond de reversement À CHAQUE PRÉFIXE (voir tests/argent.test.mjs,
   qui vérifie exactement ça). Lève une exception si la recette elle-même
   ne tient pas sous le plafond — volontaire : mieux vaut une page qui ne
   se charge pas qu'un direct qui reverse trop. */
export function buildOutcomeBatch(size, recipe, ratio, baseSize){
  // par défaut : la recette du cycle complet ; le recalibrage passe la
  // sienne, avec sa pente de reversement réduite
  recipe   = recipe   || OUTCOME_RECIPE;
  ratio    = ratio    || CEILING_RATIO;
  baseSize = baseSize || OUTCOME_BATCH_SIZE;
  const counts = {};
  let assigned = 0;
  recipe.forEach(r=>{
    const n = Math.round(r.n * size / baseSize);
    counts[r.cat] = n;
    assigned += n;
  });
  counts.commune = Math.max(0, size-assigned);
  // garde-fou : le cycle entier doit tenir sous la part reversée
  {
    let tot = 0; Object.keys(counts).forEach(c=>{ tot += counts[c]*(OUTCOME_COST[c]||0); });
    const cap = size*AVG_MISE*ratio;
    if(tot > cap + 1e-9) throw new Error('OUTCOME_RECIPE : '+tot.toFixed(0)+' € de lots pour un plafond de '+cap.toFixed(0)+' €');
  }

  /* Deux familles :
       - les GROS lots (≥ 100 €) : placés à part, à une position tirée au
         sort parmi toutes celles où les mises déjà encaissées les
         couvrent — sinon le tirage au hasard les enterre parmi des
         centaines d'autres cartes et ils finissent systématiquement en
         toute fin de file (mesuré : jackpot à la partie n° 989 dans 10
         files sur 10, prévisible) ;
       - le reste : séquencé avec la règle de rythme ci-dessous. */
  const BIG = 100;
  const bigs = [], remaining = [];
  Object.keys(counts).forEach(cat=>{
    for(let i=0;i<counts[cat];i++) (OUTCOME_COST[cat] >= BIG ? bigs : remaining).push(cat);
  });
  bigs.sort((a,b)=>OUTCOME_COST[b]-OUTCOME_COST[a]);   // le plus cher d'abord

  /* ---- 1. séquence des lots courants, sous contrainte de couverture
          et de rythme ----
     Rythme : jamais plus de MAX_SMALL_RUN petits lots (commune) d'affilée,
     et ce jusqu'à la DERNIÈRE partie de la file. Un simple tirage
     proportionnel ne suffit pas : le hasard finit par épuiser les vraies
     cartes quelques dizaines de parties avant la fin (mesuré : série
     finale de 62 communes). On vérifie donc à chaque position que ce
     qu'il reste peut ENCORE être disposé sans dépasser la règle :
       petits restants ≤ (MAX − série en cours) + MAX × vraies cartes restantes
     et on ne tire au sort qu'entre les choix qui préservent cette
     garantie. Couverture : un lot n'est éligible que si les mises
     encaissées jusqu'ici le paient sous le plafond. */
  const isSmall = cat => cat==='commune' || cat==='prison';
  let goodsLeft = remaining.filter(c=>!isSmall(c)).length;
  let smallsLeft = remaining.length - goodsLeft;
  // série maximale de communes : la plus courte que la recette permet
  const MAX_SMALL_RUN = Math.max(2, Math.ceil(smallsLeft / Math.max(1, goodsLeft)));
  const seq = [];
  let cumMise = 0, cumPaid = 0, smallRun = 0;
  const nSeq = remaining.length;
  for(let pos=0; pos<nSeq; pos++){
    cumMise += AVG_MISE;
    const headroom = cumMise*ratio - cumPaid;
    const affGood = [], affSmall = [];
    for(let i=0;i<remaining.length;i++){
      if(OUTCOME_COST[remaining[i]] > headroom) continue;
      (isSmall(remaining[i]) ? affSmall : affGood).push(i);
    }
    // ce qui reste possible SANS casser la règle de rythme jusqu'au bout
    const okSmall = affSmall.length && smallRun < MAX_SMALL_RUN
                 && (smallsLeft-1) <= (MAX_SMALL_RUN-smallRun-1) + MAX_SMALL_RUN*goodsLeft;
    const okGood  = affGood.length
                 && smallsLeft <= MAX_SMALL_RUN*goodsLeft;   // après ce lot, série remise à 0
    let pool;
    if(okSmall && okGood) pool = Math.random() < goodsLeft/remaining.length ? affGood : affSmall;
    else if(okGood)  pool = affGood;
    else if(okSmall) pool = affSmall;
    else pool = affGood.length ? affGood : affSmall;   // filet : on préserve au moins la couverture
    let pickAt;
    if(pool.length){
      pickAt = pool[Math.floor(Math.random()*pool.length)];
    } else {
      // rien de couvert (ne devrait pas arriver) : le moins cher restant
      pickAt = 0;
      for(let i=1;i<remaining.length;i++){
        if(OUTCOME_COST[remaining[i]] < OUTCOME_COST[remaining[pickAt]]) pickAt = i;
      }
    }
    const cat = remaining.splice(pickAt,1)[0];
    cumPaid += OUTCOME_COST[cat];
    if(isSmall(cat)){ smallRun++; smallsLeft--; } else { smallRun = 0; goodsLeft--; }
    seq.push(cat);
  }

  /* ---- 2. insertion des gros lots ----
     Pour chaque gros lot, on liste TOUTES les positions où, une fois
     inséré, chaque préfixe de la file reste sous le plafond (le lot est
     donc payé par des mises déjà encaissées, jamais avancé), et on en
     tire une au sort. Le jackpot peut ainsi tomber n'importe quand
     entre le moment où il est couvert et la fin — plus jamais toujours
     au même endroit. */
  const prefixOK = (arr)=>{
    let mise=0, paid=0;
    for(let k=0;k<arr.length;k++){
      mise += AVG_MISE; paid += OUTCOME_COST[arr[k]];
      if(paid > mise*ratio + 1e-9) return false;
    }
    return true;
  };
  const arr = seq;
  bigs.forEach(cat=>{
    const cost = OUTCOME_COST[cat];
    // position minimale : premier préfixe dont la réserve couvre le lot
    const candidates = [];
    let mise=0, paid=0;
    for(let p=0; p<=arr.length; p++){
      // insérer à p = payer `cost` à la partie p+1, avant les suivantes
      if((mise+AVG_MISE)*ratio - paid >= cost) candidates.push(p);
      if(p<arr.length){ mise += AVG_MISE; paid += OUTCOME_COST[arr[p]]; }
    }
    // on garde celles qui laissent TOUS les préfixes suivants sous le plafond
    const ok = [];
    for(const p of candidates){
      const trial = arr.slice(0,p).concat([cat], arr.slice(p));
      if(prefixOK(trial)) ok.push(p);
    }
    const p = ok.length ? ok[Math.floor(Math.random()*ok.length)] : arr.length;
    arr.splice(p, 0, cat);
  });
  return arr;
}
