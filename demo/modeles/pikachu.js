/** Pikachu sculpté et articulé, créé intégralement pour la présentation. */
export function creerPikachu(THREE) {
  const racine = new THREE.Group();
  racine.name = 'Pikachu';
  const jaune = new THREE.MeshPhysicalMaterial({ color: 0xffd333, roughness: .74, metalness: .01, clearcoat: .035, clearcoatRoughness: .78 });
  const jauneClair = new THREE.MeshStandardMaterial({ color: 0xffdf57, roughness: .6 });
  const noir = new THREE.MeshStandardMaterial({ color: 0x19151a, roughness: .55 });
  const oeil = new THREE.MeshPhysicalMaterial({ color: 0x130e13, roughness: .12, clearcoat: 1, clearcoatRoughness: .04 });
  const iris = new THREE.MeshStandardMaterial({ color: 0x573217, roughness: .24 });
  const blanc = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const rouge = new THREE.MeshPhysicalMaterial({ color: 0xe94437, roughness: .52, clearcoat: .15 });
  const brun = new THREE.MeshStandardMaterial({ color: 0x76492c, roughness: .68 });
  const boucheMat = new THREE.MeshStandardMaterial({ color: 0x4b1622, roughness: .68 });
  const langueMat = new THREE.MeshStandardMaterial({ color: 0xfa7f8b, roughness: .62 });
  const matieres = [jaune, jauneClair, noir, oeil, iris, blanc, rouge, brun, boucheMat, langueMat];

  function poser(geometrie, matiere, parent, position = [0, 0, 0]) {
    const objet = new THREE.Mesh(geometrie, matiere);
    objet.position.set(...position);
    objet.castShadow = true;
    objet.receiveShadow = true;
    parent.add(objet);
    return objet;
  }
  function volume(parent, position, taille, matiere, details = 32) {
    const geometrie = new THREE.SphereGeometry(1, details, Math.round(details * .7));
    geometrie.scale(...taille);
    return poser(geometrie, matiere, parent, position);
  }
  function courbe(parent, points, rayon, matiere, segments = 24) {
    return poser(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), segments, rayon, 8, false), matiere, parent);
  }
  // Les sections elliptiques suivent une courbe : oreilles et membres sont des
  // volumes continus plutôt qu'un empilement de boules ou de cylindres.
  function fuseau(parent, points, rayons, profondeur, matiere, sections = 36, tours = 18) {
    const trajet = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    const positions = [], uv = [], indices = [];
    for (let i = 0; i <= sections; i++) {
      const t = i / sections, p = trajet.getPoint(t), tangente = trajet.getTangent(t);
      const devant = new THREE.Vector3(0, 0, 1);
      const lateral = new THREE.Vector3().crossVectors(tangente, devant).normalize();
      const normal = new THREE.Vector3().crossVectors(lateral, tangente).normalize();
      const indice = Math.min(rayons.length - 2, Math.floor(t * (rayons.length - 1)));
      const fraction = t * (rayons.length - 1) - indice;
      const rayon = THREE.MathUtils.lerp(rayons[indice], rayons[indice + 1], fraction);
      for (let j = 0; j <= tours; j++) {
        const a = j / tours * Math.PI * 2;
        const sommet = p.clone().addScaledVector(lateral, Math.cos(a) * rayon).addScaledVector(normal, Math.sin(a) * rayon * profondeur);
        positions.push(sommet.x, sommet.y, sommet.z);
        uv.push(j / tours, t);
        if (i < sections && j < tours) {
          const k = i * (tours + 1) + j;
          indices.push(k, k + tours + 1, k + 1, k + 1, k + tours + 1, k + tours + 2);
        }
      }
    }
    const geometrie = new THREE.BufferGeometry();
    geometrie.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometrie.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometrie.setIndex(indices);
    geometrie.computeVertexNormals();
    return poser(geometrie, matiere, parent);
  }

  const bassin = new THREE.Group();
  racine.add(bassin);
  const torseGeo = new THREE.SphereGeometry(1, 48, 32);
  const torsePositions = torseGeo.attributes.position;
  for (let i = 0; i < torsePositions.count; i++) {
    const x = torsePositions.getX(i), y = torsePositions.getY(i), z = torsePositions.getZ(i);
    const largeur = .68 * (1 - .19 * y);
    torsePositions.setXYZ(i, x * largeur, y * .89, z * .51 * (1 - .08 * y));
  }
  torseGeo.computeVertexNormals();
  const torse = poser(torseGeo, jaune, bassin, [0, 1.12, 0]);
  const ventre = volume(bassin, [0, 1.00, .29], [.51, .57, .26], jauneClair, 40);

  const jambes = [], pieds = [];
  for (const cote of [-1, 1]) {
    const hanche = new THREE.Group();
    hanche.position.set(cote * .4, .58, 0);
    bassin.add(hanche);
    volume(hanche, [0, 0, 0], [.33, .39, .34], jaune);
    const pied = volume(hanche, [cote * .055, -.38, .27], [.27, .16, .43], jauneClair);
    pied.rotation.y = cote * .12;
    for (let doigt = 0; doigt < 3; doigt++) {
      const x = cote * .055 + (doigt - 1) * .116;
      courbe(hanche, [[x, -.3, .58], [x, -.33, .65], [x, -.38, .67]], .012, brun, 8);
    }
    jambes.push(hanche);
    pieds.push(pied);
  }

  const bras = [];
  for (const cote of [-1, 1]) {
    const epaule = new THREE.Group();
    epaule.position.set(cote * .53, 1.54, .11);
    bassin.add(epaule);
    epaule.rotation.z = cote * .12;
    fuseau(epaule, [[0, .05, 0], [cote * .1, -.18, .10], [cote * .14, -.47, .19], [cote * .12, -.60, .23]], [.05, .22, .18, .025], .83, jaune, 24);
    const poignet = new THREE.Group();
    poignet.position.set(cote * .12, -.51, .24);
    epaule.add(poignet);
    volume(poignet, [0, -.04, 0], [.19, .19, .14], jauneClair, 24);
    for (let doigt = 0; doigt < 4; doigt++) {
      const x = (doigt - 1.5) * .079;
      const longueur = .13 + .025 * Math.sin((doigt + 1) / 5 * Math.PI);
      fuseau(poignet, [[x, -.11, .025], [x * 1.15, -.19, .06], [x * 1.2, -.11 - longueur, .065]], [.065, .052, .007], .76, jauneClair, 10, 10);
    }
    fuseau(poignet, [[-cote * .11, 0, .02], [-cote * .23, -.04, .1], [-cote * .2, -.12, .13]], [.06, .057, .008], .78, jauneClair, 10, 10);
    bras.push(epaule);
  }

  const tete = new THREE.Group();
  tete.position.set(0, 1.93, .035);
  bassin.add(tete);
  const teteGeo = new THREE.SphereGeometry(1, 64, 40);
  const sommetsTete = teteGeo.attributes.position;
  for (let i = 0; i < sommetsTete.count; i++) {
    const x = sommetsTete.getX(i), y = sommetsTete.getY(i), z = sommetsTete.getZ(i);
    const joues = 1 + .13 * Math.exp(-Math.pow((y + .2) / .37, 2));
    const museau = z > 0 ? .045 * Math.exp(-Math.pow(y / .35, 2)) * (1 - x * x) : 0;
    sommetsTete.setXYZ(i, x * .84 * joues, y * .70, z * .61 + museau);
  }
  teteGeo.computeVertexNormals();
  poser(teteGeo, jaune, tete);
  volume(tete, [0, -.23, .39], [.47, .29, .26], jauneClair, 36);
  const oreilles = [];
  for (const cote of [-1, 1]) {
    const oreille = new THREE.Group();
    oreille.position.set(cote * .54, .46, -.015);
    tete.add(oreille);
    const trajet = [[0, 0, 0], [cote * .15, .45, -.025], [cote * .26, .88, -.02], [cote * .28, 1.19, 0]];
    fuseau(oreille, trajet, [.15, .18, .145, .001], .48, jaune, 36, 22);
    // Le sommet noir épouse exactement l'oreille ; il n'est pas un cône rapporté.
    fuseau(oreille, [[cote * .206, .7, -.024], [cote * .265, .94, -.013], [cote * .281, 1.196, 0]], [.162, .106, .001], .49, noir, 20, 22);
    courbe(oreille, [[0, .16, .071], [cote * .10, .43, .077], [cote * .19, .67, .059]], .016, jauneClair, 14);
    oreilles.push(oreille);
  }

  const paupieres = [], yeux = [];
  for (const cote of [-1, 1]) {
    const ensemble = new THREE.Group();
    ensemble.position.set(cote * .35, .105, .55);
    ensemble.rotation.y = cote * .12;
    tete.add(ensemble);
    volume(ensemble, [0, 0, 0], [.139, .188, .067], oeil, 32);
    volume(ensemble, [0, -.062, .053], [.104, .084, .024], iris, 24);
    volume(ensemble, [0, .022, .062], [.094, .136, .023], oeil, 24);
    volume(ensemble, [-.039, .064, .084], [.045, .058, .012], blanc, 18);
    volume(ensemble, [.048, -.065, .078], [.020, .023, .009], blanc, 12);
    const paupiere = volume(ensemble, [0, 0, .026], [.145, .197, .071], jaune, 24);
    paupiere.visible = false;
    paupieres.push(paupiere);
    yeux.push(ensemble);
    const joue = volume(tete, [cote * .657, -.175, .435], [.203, .176, .041], rouge, 32);
    joue.rotation.y = cote * .44;
    // Deux reflets doux font ressortir la rondeur des poches électriques.
    const reflet = volume(tete, [cote * .645, -.132, .479], [.079, .026, .007], new THREE.MeshStandardMaterial({ color: 0xf65a42, roughness: .74 }), 16);
    reflet.rotation.y = cote * .44;
  }
  const nezForme = new THREE.Shape();
  nezForme.moveTo(-.077, .028);
  nezForme.quadraticCurveTo(0, .059, .077, .028);
  nezForme.quadraticCurveTo(.07, -.005, 0, -.041);
  nezForme.quadraticCurveTo(-.07, -.005, -.077, .028);
  poser(new THREE.ExtrudeGeometry(nezForme, { depth: .035, bevelEnabled: true, bevelThickness: .009, bevelSize: .009, bevelSegments: 3, steps: 1 }), noir, tete, [0, -.035, .657]);
  courbe(tete, [[-.245, -.203, .638], [-.14, -.259, .679], [0, -.211, .697], [.14, -.259, .679], [.245, -.203, .638]], .014, boucheMat, 28);
  const bouche = new THREE.Group();
  bouche.position.set(0, -.26, .654);
  tete.add(bouche);
  const interieur = volume(bouche, [0, -.07, 0], [.155, .135, .027], boucheMat, 28);
  volume(bouche, [0, -.118, .024], [.098, .057, .009], langueMat, 24);
  bouche.scale.y = .05;
  const origineAttaque = new THREE.Object3D();
  origineAttaque.name = 'Origine de la décharge électrique';
  origineAttaque.position.set(0, -.10, .76);
  tete.add(origineAttaque);

  // Les rayures de dos restent visibles quand le personnage pivote.
  for (const y of [1.31, .94]) {
    courbe(bassin, [[-.52, y + .10, -.39], [-.29, y + .075, -.51], [0, y, -.523], [.29, y + .075, -.51], [.52, y + .10, -.39]], .079, brun, 28);
  }
  const queue = new THREE.Group();
  queue.position.set(.47, .75, -.41);
  bassin.add(queue);
  queue.rotation.y = -.09;
  const contourBrun = new THREE.Shape();
  contourBrun.moveTo(-.07, -.03);
  contourBrun.lineTo(.16, .0);
  contourBrun.lineTo(.37, .34);
  contourBrun.lineTo(.17, .53);
  contourBrun.lineTo(.00, .28);
  contourBrun.closePath();
  poser(new THREE.ExtrudeGeometry(contourBrun, { depth: .12, bevelEnabled: true, bevelThickness: .028, bevelSize: .023, bevelSegments: 3 }), brun, queue, [0, 0, -.07]);
  const eclair = new THREE.Shape();
  eclair.moveTo(.13, .31);
  eclair.lineTo(.36, .49);
  eclair.lineTo(.21, .80);
  eclair.lineTo(.58, .94);
  eclair.lineTo(.38, 1.39);
  eclair.lineTo(.97, 1.64);
  eclair.lineTo(1.20, 1.04);
  eclair.lineTo(.82, .91);
  eclair.lineTo(1.01, .53);
  eclair.lineTo(.59, .37);
  eclair.lineTo(.36, .18);
  eclair.closePath();
  const queueGeo = new THREE.ExtrudeGeometry(eclair, { depth: .145, bevelEnabled: true, bevelThickness: .024, bevelSize: .025, bevelSegments: 3, curveSegments: 8 });
  poser(queueGeo, jaune, queue, [0, 0, -.08]);

  // Le microrelief directionnel évoque un duvet court, sans modifier les yeux.
  const dimension = 128;
  const reliefPixels = new Uint8Array(dimension * dimension * 4);
  const rugositePixels = new Uint8Array(dimension * dimension * 4);
  for (let y = 0; y < dimension; y++) {
    for (let x = 0; x < dimension; x++) {
      const i = (y * dimension + x) * 4;
      const fibre = Math.sin(x * 2.61 + Math.sin(y * .37) * .9);
      const bruit = (Math.sin(x * 127.1 + y * 311.7) * 43758.5453) % 1;
      const hauteur = Math.round(139 + 32 * fibre + 18 * bruit);
      const rugosite = Math.round(217 + 9 * bruit);
      reliefPixels[i] = reliefPixels[i + 1] = reliefPixels[i + 2] = hauteur;
      rugositePixels[i] = rugositePixels[i + 1] = rugositePixels[i + 2] = rugosite;
      reliefPixels[i + 3] = rugositePixels[i + 3] = 255;
    }
  }
  function texture(pixels) {
    const resultat = new THREE.DataTexture(pixels, dimension, dimension, THREE.RGBAFormat);
    resultat.wrapS = resultat.wrapT = THREE.RepeatWrapping;
    resultat.repeat.set(6, 6);
    resultat.needsUpdate = true;
    return resultat;
  }
  const duvet = texture(reliefPixels), rugosite = texture(rugositePixels);
  for (const matiere of [jaune, jauneClair]) {
    matiere.bumpMap = duvet;
    matiere.bumpScale = .007;
    matiere.roughnessMap = rugosite;
  }
  racine.userData = { espece: 'Pikachu', origine: 'Géométrie originale, apparence officielle de référence', matieres };

  function animer(t, pose = {}) {
    const attaque = THREE.MathUtils.clamp(pose.attaque || 0, 0, 1);
    const impact = THREE.MathUtils.clamp(pose.impact || 0, 0, 1);
    const energie = THREE.MathUtils.clamp(pose.energie || 0, 0, 1);
    const souffle = Math.sin(t * 2.8);
    bassin.position.y = .021 * souffle + .045 * attaque;
    bassin.rotation.x = -.10 * attaque + .22 * impact;
    bassin.rotation.z = .022 * Math.sin(t * 1.6) + .16 * impact * Math.sin(t * 33);
    torse.scale.set(1 + .012 * souffle, 1 - .01 * souffle, 1 + .014 * souffle);
    ventre.scale.set(1 + .009 * souffle, 1, 1 + .018 * souffle);
    tete.rotation.x = -.09 * attaque + .07 * Math.sin(t * 1.3) + .08 * impact;
    tete.rotation.y = .085 * Math.sin(t * .61) * (1 - attaque);
    tete.rotation.z = .035 * Math.sin(t * .83);
    oreilles[0].rotation.z = -.045 + .085 * Math.sin(t * 2.3) + .21 * attaque;
    oreilles[1].rotation.z = .045 + .075 * Math.sin(t * 2.1 + 1.2) - .21 * attaque;
    oreilles[0].rotation.x = -.06 + .1 * Math.sin(t * 1.4);
    oreilles[1].rotation.x = .05 + .1 * Math.sin(t * 1.7 + 1);
    bras.forEach((brasCourant, i) => {
      const cote = i === 0 ? -1 : 1;
      brasCourant.rotation.x = -.08 - attaque * .85 + .06 * Math.sin(t * 2.1 + i);
      brasCourant.rotation.z = cote * (.12 + attaque * .66 + energie * .07 * Math.sin(t * 15));
      jambes[i].rotation.x = -.055 * Math.sin(t * 2.6 + i * Math.PI) + .04 * impact;
    });
    queue.rotation.z = -.08 + .115 * Math.sin(t * 2.1) + .24 * attaque;
    queue.rotation.x = .12 * Math.sin(t * 1.6 + .6);
    bouche.scale.y = .05 + .92 * attaque;
    interieur.scale.y = 1;
    const clignement = Math.sin(t * 1.11) > .995 && attaque < .3;
    paupieres.forEach(paupiere => { paupiere.visible = clignement; });
    rouge.emissive.setHex(0xff3414);
    rouge.emissiveIntensity = energie * (.35 + .12 * Math.sin(t * 21));
  }
  animer(0);
  return { racine, hauteur: 3.58, animer, origineAttaque };
}
