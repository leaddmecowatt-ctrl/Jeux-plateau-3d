/** Dracaufeu articulé : sculpture originale, ailes nervurées et feu vivant. */
export function creerDracaufeu(THREE) {
  const racine = new THREE.Group();
  racine.name = 'Dracaufeu';
  const orange = new THREE.MeshPhysicalMaterial({ color: 0xef8235, roughness: .78, metalness: .01, clearcoat: .045, clearcoatRoughness: .8 });
  const orangeClair = new THREE.MeshStandardMaterial({ color: 0xf39947, roughness: .67 });
  const orangeSombre = new THREE.MeshStandardMaterial({ color: 0xb65525, roughness: .66 });
  const creme = new THREE.MeshStandardMaterial({ color: 0xffdfac, roughness: .76 });
  const bleu = new THREE.MeshPhysicalMaterial({ color: 0x258d9c, roughness: .58, metalness: .02, side: THREE.DoubleSide, clearcoat: .11 });
  const nervure = new THREE.MeshStandardMaterial({ color: 0x1c7180, roughness: .65 });
  const ivoire = new THREE.MeshPhysicalMaterial({ color: 0xfff2d6, roughness: .33, clearcoat: .22 });
  const noir = new THREE.MeshStandardMaterial({ color: 0x221c19, roughness: .62 });
  const oeilMat = new THREE.MeshPhysicalMaterial({ color: 0xf7f3e1, roughness: .16, clearcoat: 1 });
  const iris = new THREE.MeshPhysicalMaterial({ color: 0x38a5b2, roughness: .17, clearcoat: 1 });
  const pupille = new THREE.MeshPhysicalMaterial({ color: 0x091819, roughness: .09, clearcoat: 1 });
  const reflet = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const boucheMat = new THREE.MeshStandardMaterial({ color: 0x54232c, roughness: .65 });
  const langue = new THREE.MeshStandardMaterial({ color: 0xda716f, roughness: .66 });

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
  function courbe(parent, points, rayon, matiere, segments = 24, tours = 8) {
    return poser(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), segments, rayon, tours, false), matiere, parent);
  }
  function fuseau(parent, points, rayons, matiere, profondeur = 1, sections = 36, tours = 16) {
    const trajet = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    const positions = [], uv = [], indices = [];
    for (let i = 0; i <= sections; i++) {
      const t = i / sections, p = trajet.getPoint(t), tangente = trajet.getTangent(t);
      let reference = new THREE.Vector3(0, 0, 1);
      if (Math.abs(tangente.dot(reference)) > .96) reference.set(0, 1, 0);
      const lateral = new THREE.Vector3().crossVectors(tangente, reference).normalize();
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
  // Une seule peau relie l'abdomen, le thorax et le cou effilé.
  const profil = new THREE.CatmullRomCurve3([
    new THREE.Vector3(.02, .40, .02), new THREE.Vector3(.48, .65, .40),
    new THREE.Vector3(.69, 1.19, .61), new THREE.Vector3(.66, 1.75, .57),
    new THREE.Vector3(.47, 2.21, .41), new THREE.Vector3(.27, 2.54, .27),
    new THREE.Vector3(.22, 2.90, .24), new THREE.Vector3(.08, 3.16, .08)
  ]);
  const torsePositions = [], torseUv = [], torseIndices = [];
  const sectionsTorse = 64, toursTorse = 48;
  for (let i = 0; i <= sectionsTorse; i++) {
    const t = i / sectionsTorse, p = profil.getPoint(t);
    const avant = .10 * Math.pow(t, 3);
    for (let j = 0; j <= toursTorse; j++) {
      const a = j / toursTorse * Math.PI * 2;
      torsePositions.push(Math.cos(a) * Math.max(.005, p.x), p.y, Math.sin(a) * Math.max(.005, p.z) + avant);
      torseUv.push(j / toursTorse, t);
      if (i < sectionsTorse && j < toursTorse) {
        const k = i * (toursTorse + 1) + j;
        torseIndices.push(k, k + toursTorse + 1, k + 1, k + 1, k + toursTorse + 1, k + toursTorse + 2);
      }
    }
  }
  const torseGeo = new THREE.BufferGeometry();
  torseGeo.setAttribute('position', new THREE.Float32BufferAttribute(torsePositions, 3));
  torseGeo.setAttribute('uv', new THREE.Float32BufferAttribute(torseUv, 2));
  torseGeo.setIndex(torseIndices);
  torseGeo.computeVertexNormals();
  const torse = poser(torseGeo, orange, bassin);
  const abdomen = volume(bassin, [0, 1.43, .399], [.52, .91, .25], creme, 48);
  fuseau(bassin, [[0, 1.90, .37], [0, 2.33, .386], [0, 2.71, .326], [0, 2.93, .286]], [.28, .24, .17, .015], creme, .20, 32, 22);

  const jambes = [];
  for (const cote of [-1, 1]) {
    const hanche = new THREE.Group();
    hanche.position.set(cote * .48, .88, -.02);
    bassin.add(hanche);
    volume(hanche, [cote * .03, -.09, 0], [.40, .54, .43], orange, 36);
    fuseau(hanche, [[cote * .06, -.23, .13], [cote * .08, -.46, .17], [cote * .07, -.67, .27]], [.27, .26, .07], orange, 1.15, 24, 18);
    const pied = volume(hanche, [cote * .075, -.69, .31], [.30, .17, .44], orangeClair, 32);
    pied.rotation.y = cote * .12;
    for (let doigt = 0; doigt < 3; doigt++) {
      const x = cote * .075 + (doigt - 1) * .174;
      volume(hanche, [x, -.692, .59], [.115, .111, .24], orangeClair, 22);
      fuseau(hanche, [[x, -.65, .71], [x, -.67, .86], [x, -.71, .97]], [.09, .063, .001], ivoire, .68, 15, 12);
    }
    jambes.push(hanche);
  }

  const bras = [], poignets = [];
  for (const cote of [-1, 1]) {
    const epaule = new THREE.Group();
    epaule.position.set(cote * .48, 2.20, .04);
    bassin.add(epaule);
    fuseau(epaule, [[0, .05, 0], [cote * .18, -.13, .03], [cote * .29, -.43, .13], [cote * .31, -.71, .32]], [.16, .235, .175, .13], orange, .90, 32, 20);
    const poignet = new THREE.Group();
    poignet.position.set(cote * .31, -.67, .30);
    epaule.add(poignet);
    volume(poignet, [0, -.06, .02], [.19, .21, .16], orangeClair, 28);
    for (let doigt = 0; doigt < 3; doigt++) {
      const x = (doigt - 1) * .136;
      fuseau(poignet, [[x, -.17, .01], [x * 1.13, -.27, .15], [x * 1.17, -.29, .25]], [.081, .074, .049], orangeClair, .85, 16, 12);
      fuseau(poignet, [[x * 1.17, -.29, .23], [x * 1.20, -.31, .35], [x * 1.2, -.33, .42]], [.055, .044, .001], ivoire, .76, 12, 12);
    }
    bras.push(epaule);
    poignets.push(poignet);
  }

  const tete = new THREE.Group();
  tete.position.set(0, 3.00, .12);
  bassin.add(tete);
  const craneGeo = new THREE.SphereGeometry(1, 48, 32);
  const sommets = craneGeo.attributes.position;
  for (let i = 0; i < sommets.count; i++) {
    const x = sommets.getX(i), y = sommets.getY(i), z = sommets.getZ(i);
    const joues = 1 + .1 * Math.exp(-Math.pow((y + .2) / .5, 2));
    sommets.setXYZ(i, x * .35 * joues, y * .40, z * .42 + .1 * Math.max(0, z));
  }
  craneGeo.computeVertexNormals();
  poser(craneGeo, orange, tete, [0, .04, .025]);
  const museauGeo = new THREE.SphereGeometry(1, 40, 28);
  const museauPositions = museauGeo.attributes.position;
  for (let i = 0; i < museauPositions.count; i++) {
    const x = museauPositions.getX(i), y = museauPositions.getY(i), z = museauPositions.getZ(i);
    museauPositions.setXYZ(i, x * .31 * (1 + .08 * z), y * .185, z * .40);
  }
  museauGeo.computeVertexNormals();
  poser(museauGeo, orangeClair, tete, [0, -.08, .46]);
  volume(tete, [0, -.17, .72], [.292, .108, .15], orangeClair, 32);

  const cornes = [];
  for (const cote of [-1, 1]) {
    const corne = new THREE.Group();
    corne.position.set(cote * .25, .28, -.025);
    tete.add(corne);
    fuseau(corne, [[0, 0, 0], [cote * .035, .28, -.085], [cote * .087, .54, -.17], [cote * .12, .69, -.24]], [.136, .11, .067, .001], orange, .82, 32, 18);
    courbe(corne, [[-cote * .024, .10, .093], [cote * .007, .3, .01], [cote * .069, .53, -.11]], .012, orangeClair, 16);
    cornes.push(corne);
    // L'oeil effilé, la paupière et l'arcade expriment une détermination de dragon.
    const ensemble = new THREE.Group();
    ensemble.position.set(cote * .267, .101, .317);
    ensemble.rotation.y = cote * .49;
    ensemble.rotation.z = cote * -.22;
    tete.add(ensemble);
    volume(ensemble, [0, 0, 0], [.168, .093, .052], noir, 30);
    volume(ensemble, [0, -.003, .017], [.151, .074, .041], oeilMat, 30);
    volume(ensemble, [-cote * .022, -.007, .048], [.061, .068, .017], iris, 24);
    volume(ensemble, [-cote * .022, -.007, .063], [.018, .062, .009], pupille, 20);
    volume(ensemble, [-cote * .045, .022, .074], [.016, .022, .005], reflet, 12);
    courbe(ensemble, [[-cote * .178, .085, -.008], [-cote * .063, .09, .062], [cote * .102, .052, .04], [cote * .161, .016, .00]], .045, orange, 20, 10);
    const narine = volume(tete, [cote * .135, .008, .754], [.045, .024, .033], noir, 20);
    narine.rotation.y = cote * .18;
    courbe(tete, [[cote * .045, .048, .718], [cote * .14, .055, .756], [cote * .218, .016, .714]], .017, orangeSombre, 12);
    courbe(tete, [[cote * .265, -.137, .641], [cote * .337, -.13, .435], [cote * .315, -.124, .224]], .013, boucheMat, 20);
  }

  const machoire = new THREE.Group();
  machoire.position.set(0, -.21, .14);
  tete.add(machoire);
  volume(machoire, [0, -.055, .355], [.285, .105, .435], orange, 40);
  volume(machoire, [0, -.101, .40], [.225, .064, .32], creme, 30);
  const origineAttaque = new THREE.Object3D();
  origineAttaque.name = 'Origine du souffle enflammé';
  origineAttaque.position.set(0, .13, .80);
  machoire.add(origineAttaque);
  const cavite = volume(machoire, [0, .019, .395], [.249, .022, .342], boucheMat, 32);
  volume(machoire, [0, .043, .44], [.131, .015, .206], langue, 28);
  // Des dents pointues existent sur les deux mâchoires, visibles à l'attaque.
  for (const cote of [-1, 1]) {
    for (let dent = 0; dent < 3; dent++) {
      const z = .41 + dent * .14;
      const x = cote * (.228 - dent * .026);
      fuseau(machoire, [[x, .027, z], [x * .96, .107, z + .009], [x * .93, .153 - dent * .011, z + .016]], [.038, .024, .001], ivoire, 1, 12, 10);
      fuseau(tete, [[x, -.192, z + .145], [x * .97, -.244, z + .15], [x * .93, -.302 + dent * .013, z + .16]], [.033, .025, .001], ivoire, 1, 12, 10);
    }
  }

  // La membrane est triangulée entre les doigts porteurs, avec bombement et
  // festons : c'est une véritable aile en volume et non un panneau rectangulaire.
  const ailes = [];
  for (const cote of [-1, 1]) {
    const aile = new THREE.Group();
    aile.position.set(cote * .42, 2.23, -.30);
    bassin.add(aile);
    const points = [
      [0, 0, 0], [cote * .38, .54, -.09], [cote * .85, 1.00, -.12],
      [cote * 1.44, 1.27, -.02], [cote * 2.00, 1.02, .055],
      [cote * 1.53, .12, -.08], [cote * 1.32, -.34, -.10],
      [cote * .93, .08, -.09], [cote * .75, -.59, -.16],
      [cote * .41, -.11, -.16], [cote * .19, -.67, -.12]
    ];
    courbe(aile, [points[0], points[1], points[2], points[3], points[4]], .063, orange, 46, 12);
    const depart = new THREE.Vector3(...points[2]);
    const bouts = [points[4], points[6], points[8], points[10], points[0]].map(p => new THREE.Vector3(...p));
    const milieux = [points[5], points[7], points[9], [.04 * cote, -.41, -.08]].map(p => new THREE.Vector3(...p));
    for (let panneau = 0; panneau < 4; panneau++) {
      const a = bouts[panneau], b = bouts[panneau + 1], milieu = milieux[panneau];
      const pos = [], couleurs = [], uv = [], indices = [], subdivisions = 18;
      for (let i = 0; i <= subdivisions; i++) {
        const v = i / subdivisions;
        const arc = new THREE.Vector3().lerpVectors(a, b, v);
        const correction = milieu.clone().sub(a.clone().add(b).multiplyScalar(.5));
        arc.addScaledVector(correction, 4 * v * (1 - v));
        for (let j = 0; j <= subdivisions; j++) {
          const u = j / subdivisions;
          const sommet = depart.clone().lerp(arc, u);
          sommet.z -= .092 * Math.sin(u * Math.PI) * Math.sin(v * Math.PI);
          pos.push(sommet.x, sommet.y, sommet.z);
          const luminosite = .82 + .18 * Math.sin(u * Math.PI) + .06 * Math.sin(v * 9 + u * 4);
          couleurs.push(luminosite, luminosite, luminosite);
          uv.push(u, v);
          if (i < subdivisions && j < subdivisions) {
            const k = i * (subdivisions + 1) + j;
            indices.push(k, k + subdivisions + 1, k + 1, k + 1, k + subdivisions + 1, k + subdivisions + 2);
          }
        }
      }
      const geometrie = new THREE.BufferGeometry();
      geometrie.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geometrie.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map(() => 0), 3));
      geometrie.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geometrie.setAttribute('color', new THREE.Float32BufferAttribute(couleurs, 3));
      geometrie.setIndex(indices);
      geometrie.computeVertexNormals();
      const matiere = bleu.clone();
      matiere.vertexColors = true;
      poser(geometrie, matiere, aile);
      courbe(aile, [[a.x, a.y, a.z], [milieu.x, milieu.y, milieu.z], [b.x, b.y, b.z]], .020, orangeSombre, 25, 8);
    }
    for (let doigt = 1; doigt < 4; doigt++) {
      const bout = bouts[doigt];
      const milieu = depart.clone().lerp(bout, .52);
      milieu.z -= .045;
      fuseau(aile, [[depart.x, depart.y, depart.z], [milieu.x, milieu.y, milieu.z], [bout.x, bout.y, bout.z]], [.045, .038, .014], orange, 1, 24, 10);
      // Fines nervures translucides dans chaque voile.
      const fin = bout.clone().lerp(bouts[doigt - 1], .44);
      const milieuFin = depart.clone().lerp(fin, .54);
      milieuFin.z -= .1;
      courbe(aile, [[depart.x, depart.y, depart.z - .014], [milieuFin.x, milieuFin.y, milieuFin.z], [fin.x, fin.y, fin.z - .008]], .008, nervure, 20, 6);
    }
    fuseau(aile, [[cote * .83, 1.0, -.12], [cote * .86, 1.16, -.08], [cote * .80, 1.30, -.06]], [.067, .045, .001], ivoire, 1, 14, 12);
    ailes.push(aile);
  }

  const queue = new THREE.Group();
  queue.position.set(0, .83, -.36);
  bassin.add(queue);
  fuseau(queue, [[0, .0, .0], [.13, -.16, -.57], [.29, -.12, -1.20], [.45, .24, -1.58], [.55, .79, -1.65], [.50, 1.17, -1.59]], [.38, .29, .22, .17, .11, .055], orange, 1, 58, 22);
  fuseau(queue, [[0, -.14, -.23], [.14, -.32, -.57], [.30, -.26, -1.17], [.46, .11, -1.59], [.53, .58, -1.66]], [.17, .13, .095, .055, .008], creme, .44, 42, 14);
  const feu = new THREE.Group();
  feu.position.set(.50, 1.16, -1.59);
  queue.add(feu);
  const feuRouge = new THREE.MeshBasicMaterial({ color: 0xff4615, transparent: true, opacity: .80, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const feuOrange = new THREE.MeshBasicMaterial({ color: 0xff981c, transparent: true, opacity: .88, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const feuCoeur = new THREE.MeshBasicMaterial({ color: 0xfff5a1, transparent: true, opacity: .95, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const flammes = [];
  for (let i = 0; i < 7; i++) {
    const angle = i * 2.399963;
    const rayon = i === 0 ? 0 : .10 + (i % 3) * .035;
    const x = Math.cos(angle) * rayon, z = Math.sin(angle) * rayon;
    const hauteur = i === 0 ? .96 : .60 + .07 * (i % 3);
    const flamme = fuseau(feu, [[x, -.08, z], [x * .85, .22, z * .9], [x * .7 + .065 * Math.sin(i), hauteur * .61, z * .7], [x * .3 + .1 * Math.sin(i + 1), hauteur, z * .25]], [.055, i === 0 ? .17 : .12, .074, .001], i === 0 ? feuOrange : feuRouge, 1, 20, 10);
    flamme.userData = { phase: i * 1.8, hauteur };
    flammes.push(flamme);
  }
  fuseau(feu, [[0, -.05, 0], [0, .19, .01], [.025, .40, .0], [.04, .56, -.02]], [.04, .107, .057, .001], feuCoeur, 1, 24, 12);
  const lumiereFeu = new THREE.PointLight(0xff6a1e, 1.15, 3.7, 2);
  lumiereFeu.position.set(0, .3, .08);
  feu.add(lumiereFeu);
  const braises = [];
  const braiseGeo = new THREE.SphereGeometry(.020, 6, 4);
  for (let i = 0; i < 9; i++) {
    const braise = poser(braiseGeo, feuCoeur, feu);
    braise.castShadow = false;
    braise.receiveShadow = false;
    braises.push(braise);
  }
  racine.userData = { espece: 'Dracaufeu', origine: 'Géométrie originale, apparence officielle de référence' };

  // De petites écailles imbriquées donnent un relief vivant à la peau orange.
  const dimension = 128;
  const reliefPixels = new Uint8Array(dimension * dimension * 4);
  const rugositePixels = new Uint8Array(dimension * dimension * 4);
  for (let y = 0; y < dimension; y++) {
    for (let x = 0; x < dimension; x++) {
      const ligne = Math.floor(y / 10), centre = (ligne % 2) * 5;
      const dx = (((x + centre) % 10) - 5) / 5;
      const dy = ((y % 10) - 5) / 5;
      const bombe = Math.max(0, 1 - dx * dx - dy * dy);
      const bruit = (Math.sin(x * 127.1 + y * 311.7) * 43758.5453) % 1;
      const i = (y * dimension + x) * 4;
      const hauteur = Math.round(80 + 110 * Math.pow(bombe, .56) + 9 * bruit);
      const rugosite = Math.round(213 + 18 * bombe + 5 * bruit);
      reliefPixels[i] = reliefPixels[i + 1] = reliefPixels[i + 2] = hauteur;
      rugositePixels[i] = rugositePixels[i + 1] = rugositePixels[i + 2] = rugosite;
      reliefPixels[i + 3] = rugositePixels[i + 3] = 255;
    }
  }
  function texture(pixels) {
    const resultat = new THREE.DataTexture(pixels, dimension, dimension, THREE.RGBAFormat);
    resultat.wrapS = resultat.wrapT = THREE.RepeatWrapping;
    resultat.repeat.set(3, 4);
    resultat.needsUpdate = true;
    return resultat;
  }
  const ecailles = texture(reliefPixels), rugosite = texture(rugositePixels);
  for (const matiere of [orange, orangeClair, orangeSombre]) {
    matiere.bumpMap = ecailles;
    matiere.bumpScale = .013;
    matiere.roughnessMap = rugosite;
  }
  creme.bumpMap = ecailles;
  creme.bumpScale = .004;

  function animer(t, pose = {}) {
    const attaque = THREE.MathUtils.clamp(pose.attaque || 0, 0, 1);
    const impact = THREE.MathUtils.clamp(pose.impact || 0, 0, 1);
    const energie = THREE.MathUtils.clamp(pose.energie || 0, 0, 1);
    const souffle = Math.sin(t * 1.75);
    bassin.position.y = .023 * souffle;
    bassin.rotation.x = -.10 * attaque + .15 * impact;
    bassin.rotation.z = .015 * Math.sin(t * .8) + .08 * impact * Math.sin(t * 27);
    torse.scale.set(1 + .013 * souffle, 1, 1 + .012 * souffle);
    abdomen.scale.set(1 + .011 * souffle, 1, 1 + .016 * souffle);
    tete.rotation.x = -.06 - .10 * attaque + .055 * Math.sin(t * 1.15) + .16 * impact;
    tete.rotation.y = .10 * Math.sin(t * .45) * (1 - attaque);
    machoire.rotation.x = .018 + .36 * attaque + .035 * Math.max(0, souffle);
    cavite.scale.y = 1 + attaque * 1.5;
    bras.forEach((brasCourant, i) => {
      const cote = i === 0 ? -1 : 1;
      brasCourant.rotation.z = cote * (.12 + .22 * attaque + .05 * Math.sin(t * 1.3 + i));
      brasCourant.rotation.x = -.05 - .45 * attaque + .045 * Math.sin(t * 1.8 + i);
      poignets[i].rotation.x = -.08 * Math.sin(t * 1.5 + i);
      jambes[i].rotation.x = .045 * Math.sin(t * 1.4 + i * 2) + .08 * impact;
    });
    ailes.forEach((aile, i) => {
      const cote = i === 0 ? -1 : 1;
      aile.rotation.y = cote * (.06 + .115 * Math.sin(t * 1.65) - .17 * attaque);
      aile.rotation.z = cote * (.015 + .035 * Math.sin(t * 1.65 + .2) + .09 * attaque);
      aile.rotation.x = .04 * Math.sin(t * 1.65 + .5);
    });
    queue.rotation.y = .16 * Math.sin(t * .85);
    queue.rotation.x = -.04 + .045 * Math.sin(t * 1.15) - .11 * attaque;
    feu.rotation.y = t * .42;
    feu.scale.set(1 + energie * .23, 1 + energie * .46, 1 + energie * .23);
    flammes.forEach(flamme => {
      const phase = flamme.userData.phase;
      flamme.scale.y = .91 + .16 * Math.sin(t * 12 + phase);
      flamme.rotation.z = .10 * Math.sin(t * 8 + phase);
      flamme.rotation.x = .075 * Math.sin(t * 9 + phase * .4);
    });
    braises.forEach((braise, i) => {
      const cycle = ((t * .48 + i / braises.length) % 1 + 1) % 1;
      braise.position.set(Math.sin(i * 2.4 + cycle * 3) * (.08 + cycle * .22), .15 + cycle * 1.3, Math.cos(i * 2.4 + cycle * 2) * (.07 + cycle * .2));
      braise.scale.setScalar(Math.max(.05, Math.sin(cycle * Math.PI)));
    });
    lumiereFeu.intensity = (1.15 + energie * .85) * (1 + .12 * Math.sin(t * 21));
  }
  animer(0);
  return { racine, hauteur: 4.02, animer, origineAttaque };
}
