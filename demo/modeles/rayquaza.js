/**
 * Rayquaza : sculpture procédurale originale, proportions et couleurs officielles.
 * Le dragon possède une peau continue et une courbe vertébrale réellement animée.
 * Aucun modèle ni texture n'est repris d'un jeu ; construction locale synchrone.
 */
export function creerRayquaza(THREE) {
  const racine = new THREE.Group();
  racine.name = 'Rayquaza — dragon céleste';
  const squelette = new THREE.Group();
  racine.add(squelette);
  const vert = new THREE.MeshStandardMaterial({color: 0x158758, roughness: 0.32, metalness: 0.08});
  const sombre = new THREE.MeshStandardMaterial({color: 0x075137, roughness: 0.38});
  const menthe = new THREE.MeshStandardMaterial({color: 0x68b98d, roughness: 0.41});
  const jaune = new THREE.MeshStandardMaterial({color: 0xf7d453, roughness: 0.24, metalness: 0.2, emissive: 0xaf6600, emissiveIntensity: 0.16});
  const rouge = new THREE.MeshStandardMaterial({color: 0xc92c43, roughness: 0.38});
  const bouche = new THREE.MeshStandardMaterial({color: 0x591e32, roughness: 0.67});
  const gencive = new THREE.MeshStandardMaterial({color: 0xcd5867, roughness: 0.54});
  const dent = new THREE.MeshStandardMaterial({color: 0xffefce, roughness: 0.29});
  const noir = new THREE.MeshStandardMaterial({color: 0x070c0b, roughness: 0.25});
  const oeil = new THREE.MeshStandardMaterial({color: 0xffdc2a, roughness: 0.15, emissive: 0xf6a700, emissiveIntensity: 0.36});

  // Un grain minuscule casse les surfaces plastiques, sans aucune image externe.
  const grain = new Uint8Array(64 * 64 * 4);
  let graine = 3197;
  for (let i = 0; i < 64 * 64; i++) {
    graine = (graine * 1664525 + 1013904223) >>> 0;
    const v = 118 + ((graine >>> 24) & 23);
    grain.set([v, v, v, 255], i * 4);
  }
  const texture = new THREE.DataTexture(grain, 64, 64, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 12);
  texture.needsUpdate = true;
  vert.bumpMap = texture;
  vert.bumpScale = 0.009;
  sombre.bumpMap = texture;
  sombre.bumpScale = 0.006;

  const ajouter = (parent, geometrie, mat, position) => {
    const objet = new THREE.Mesh(geometrie, mat);
    if (position) objet.position.set(...position);
    objet.castShadow = true;
    objet.receiveShadow = true;
    parent.add(objet);
    return objet;
  };
  const ellipsoide = (parent, mat, position, dimensions) => {
    const objet = ajouter(parent, new THREE.SphereGeometry(1, 20, 12), mat, position);
    objet.scale.set(...dimensions);
    return objet;
  };

  /** Une pointe profilée suit une vraie courbe, au lieu d'empiler des cônes. */
  function pointe(parent, mat, points, rayon, aplatissement = 1) {
    const courbe = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    const etapes = 15, faces = 12;
    const cadres = courbe.computeFrenetFrames(etapes, false);
    const pos = [], indices = [];
    for (let i = 0; i <= etapes; i++) {
      const u = i / etapes;
      const centre = courbe.getPointAt(u);
      const r = Math.max(0.002, rayon * Math.pow(1 - u, 0.72));
      for (let j = 0; j <= faces; j++) {
        const a = j / faces * Math.PI * 2;
        const p = centre.clone().addScaledVector(cadres.normals[i], Math.cos(a) * r)
          .addScaledVector(cadres.binormals[i], Math.sin(a) * r * aplatissement);
        pos.push(p.x, p.y, p.z);
        if (i < etapes && j < faces) {
          const k = i * (faces + 1) + j;
          indices.push(k, k + 1, k + faces + 1, k + 1, k + faces + 2, k + faces + 1);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return ajouter(parent, geo, mat);
  }

  function filet(parent, points, rayon = 0.012, mat = jaune) {
    return ajouter(parent, new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), 20, rayon, 6, false
    ), mat);
  }

  // Nageoires biseautées : base verte, membrane rouge, liseré jaune discret.
  function nageoire(parent, cote, taille = 1) {
    const groupe = new THREE.Group();
    parent.add(groupe);
    groupe.scale.set(cote * taille, taille, taille);
    const forme = new THREE.Shape();
    forme.moveTo(0.16, -0.1);
    forme.quadraticCurveTo(0.43, -0.03, 0.78, -0.35);
    forme.quadraticCurveTo(0.64, 0.06, 0.49, 0.22);
    forme.quadraticCurveTo(0.25, 0.1, 0.16, -0.1);
    const geo = new THREE.ExtrudeGeometry(forme, {depth: 0.035, bevelEnabled: true, bevelThickness: 0.018, bevelSize: 0.016, bevelSegments: 2, steps: 1, curveSegments: 10});
    ajouter(groupe, geo, vert).rotation.x = -Math.PI / 2;
    const formeRouge = new THREE.Shape();
    formeRouge.moveTo(0.27, -0.055);
    formeRouge.quadraticCurveTo(0.48, -0.1, 0.66, -0.24);
    formeRouge.quadraticCurveTo(0.58, 0.015, 0.46, 0.12);
    formeRouge.closePath();
    const membrane = ajouter(groupe, new THREE.ShapeGeometry(formeRouge, 10), rouge);
    membrane.material = rouge;
    membrane.rotation.x = -Math.PI / 2;
    membrane.position.y = 0.058;
    membrane.material.side = THREE.DoubleSide;
    return groupe;
  }

  // Tube elliptique continu : 72 anneaux, donc aucune jointure dans la silhouette.
  const N = 72, M = 18;
  const positions = new Float32Array((N + 1) * (M + 1) * 3);
  const normales = new Float32Array(positions.length);
  const couleurs = new Float32Array(positions.length);
  const uv = new Float32Array((N + 1) * (M + 1) * 2);
  const indices = [];
  const peau = new THREE.BufferGeometry();
  const vertClair = new THREE.Color(0x85c59a), vertBase = new THREE.Color(0x158758);
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= M; j++) {
      const k = i * (M + 1) + j;
      const a = j / M * Math.PI * 2;
      const couleur = vertBase.clone().lerp(vertClair, Math.pow(Math.max(0, -Math.sin(a)), 8) * 0.5);
      couleurs[k * 3] = couleur.r; couleurs[k * 3 + 1] = couleur.g; couleurs[k * 3 + 2] = couleur.b;
      uv[k * 2] = j / M; uv[k * 2 + 1] = i / N;
      if (i < N && j < M) indices.push(k, k + 1, k + M + 1, k + 1, k + M + 2, k + M + 1);
    }
  }
  peau.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  peau.setAttribute('normal', new THREE.BufferAttribute(normales, 3).setUsage(THREE.DynamicDrawUsage));
  peau.setAttribute('color', new THREE.BufferAttribute(couleurs, 3));
  peau.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  peau.setIndex(indices);
  const matPeau = vert.clone();
  matPeau.color.set(0xffffff);
  matPeau.vertexColors = true;
  const corps = ajouter(squelette, peau, matPeau);
  corps.frustumCulled = false;
  const original = [
    [-0.64, 0.46, -1.78], [-1.56, 0.95, -1.06], [-1.64, 1.62, 0.31],
    [-0.67, 2.04, 1.03], [0.94, 2.09, 0.59], [1.55, 2.47, -0.45],
    [0.94, 3.02, -1.04], [-0.13, 3.18, -0.63], [-0.05, 3.25, 0.74]
  ].map(p => new THREE.Vector3(...p));
  const colonne = new THREE.CatmullRomCurve3(original.map(p => p.clone()), false, 'catmullrom', 0.42);
  const centres = Array.from({length: N + 1}, () => new THREE.Vector3());
  const axesX = centres.map(() => new THREE.Vector3());
  const axesY = centres.map(() => new THREE.Vector3());
  const tangentes = centres.map(() => new THREE.Vector3());
  const matrice = new THREE.Matrix4();
  const rayonCorps = u => (0.025 + 0.215 * Math.pow(Math.sin(u * Math.PI / 2), 0.7)) * (1 - 0.11 * Math.sin(u * Math.PI * 3));

  // Les collerettes et ailettes suivent les mêmes repères que la peau, sans dérive.
  const ornements = [];
  for (const u of [0.18, 0.30, 0.43, 0.56, 0.69, 0.80, 0.90]) {
    const groupe = new THREE.Group();
    squelette.add(groupe);
    const r = rayonCorps(u);
    const anneau = ajouter(groupe, new THREE.TorusGeometry(r + 0.011, 0.016, 6, 24), jaune);
    anneau.scale.y = 0.91;
    // Motifs ovoïdes isolés, signature graphique du Pokémon.
    for (const cote of [-1, 1]) {
      const marque = ajouter(groupe, new THREE.TorusGeometry(0.088, 0.011, 6, 18), jaune, [cote * r * 0.91, 0, 0.12]);
      marque.rotation.y = cote * Math.PI / 2;
      marque.scale.y = 1.45;
    }
    if (u > 0.25 && u < 0.86) {
      nageoire(groupe, 1, Math.min(0.74, r * 3));
      nageoire(groupe, -1, Math.min(0.74, r * 3));
    }
    ornements.push({groupe, indice: Math.round(u * N)});
  }

  // Crâne sculpté : joues, museau plat, arcade, mâchoire indépendante.
  const tete = new THREE.Group();
  tete.name = 'Tête et mâchoire articulée';
  squelette.add(tete);
  const origineAttaque = new THREE.Object3D();
  origineAttaque.name = 'Origine Ultralaser — gueule';
  origineAttaque.position.set(0, -0.12, 0.76);
  tete.add(origineAttaque);
  ellipsoide(tete, vert, [0, 0.075, 0.12], [0.33, 0.26, 0.44]);
  const museau = ellipsoide(tete, vert, [0, -0.012, 0.42], [0.295, 0.17, 0.34]);
  museau.rotation.x = -0.09;
  ellipsoide(tete, sombre, [0, -0.12, 0.38], [0.265, 0.055, 0.31]);
  ellipsoide(tete, bouche, [0, -0.10, 0.48], [0.253, 0.059, 0.255]);
  const machoire = new THREE.Group();
  machoire.position.set(0, -0.12, -0.02);
  tete.add(machoire);
  ellipsoide(machoire, vert, [0, -0.045, 0.39], [0.28, 0.105, 0.33]);
  ellipsoide(machoire, gencive, [0, 0.04, 0.39], [0.237, 0.025, 0.26]);
  filet(machoire, [[-0.2, -0.02, 0.60], [0, -0.035, 0.70], [0.2, -0.02, 0.60]], 0.013);
  for (const cote of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const z = 0.19 + i * 0.095;
      const x = cote * (0.20 + Math.sin(i / 4 * Math.PI) * 0.029);
      const d = ajouter(tete, new THREE.ConeGeometry(0.030, i === 1 ? 0.105 : 0.075, 8), dent, [x, -0.145, z]);
      d.rotation.z = Math.PI;
      ajouter(machoire, new THREE.ConeGeometry(0.025, 0.068, 8), dent, [x * 0.95, 0.065, z + 0.045]);
    }
    // Yeux obliques : orbite rouge, iris or lumineux, pupille verticale noire.
    const yeux = new THREE.Group();
    yeux.position.set(cote * 0.29, 0.105, 0.285);
    yeux.rotation.y = cote * 1.02;
    yeux.rotation.z = cote * 0.16;
    tete.add(yeux);
    ellipsoide(yeux, rouge, [0, 0, 0], [0.142, 0.087, 0.031]);
    ellipsoide(yeux, oeil, [0, 0.005, 0.022], [0.113, 0.061, 0.022]);
    ellipsoide(yeux, noir, [cote * -0.024, 0, 0.043], [0.014, 0.052, 0.008]);
    ellipsoide(yeux, dent, [-0.024, 0.024, 0.046], [0.013, 0.012, 0.004]);
    filet(tete, [[cote * 0.24, 0.18, 0.42], [cote * 0.36, 0.19, 0.23], [cote * 0.32, 0.18, 0.05]], 0.028, vert);
    filet(tete, [[cote * 0.24, -0.025, 0.30], [cote * 0.36, -0.01, 0.12], [cote * 0.30, 0.015, -0.1]], 0.013);
    ellipsoide(tete, noir, [cote * 0.119, 0.062, 0.671], [0.026, 0.012, 0.01]);
    // Les quatre longues excroissances caractéristiques encadrent la tête.
    pointe(tete, vert, [[cote * 0.22, 0.19, -0.02], [cote * 0.39, 0.45, -0.20], [cote * 0.62, 0.63, -0.76]], 0.105, 0.52);
    pointe(tete, rouge, [[cote * 0.30, 0.25, -0.075], [cote * 0.40, 0.45, -0.24], [cote * 0.57, 0.57, -0.67]], 0.05, 0.22);
    filet(tete, [[cote * 0.30, 0.28, -0.03], [cote * 0.43, 0.49, -0.22], [cote * 0.61, 0.62, -0.73]], 0.012);
    pointe(tete, vert, [[cote * 0.26, -0.075, -0.045], [cote * 0.49, -0.13, -0.29], [cote * 0.60, -0.14, -0.70]], 0.094, 0.43);
    pointe(tete, rouge, [[cote * 0.35, -0.075, -0.12], [cote * 0.46, -0.09, -0.3], [cote * 0.55, -0.12, -0.62]], 0.042, 0.25);
  }
  // Une fine arête dorsale termine le front ; les lignes restent nettes à distance.
  filet(tete, [[0, 0.315, -0.10], [0, 0.323, 0.15], [0, 0.18, 0.58]], 0.015);

  const bras = [];
  const ceinture = new THREE.Group();
  squelette.add(ceinture);
  for (const cote of [-1, 1]) {
    const brasGroupe = new THREE.Group();
    brasGroupe.position.set(cote * 0.20, -0.055, 0.0);
    ceinture.add(brasGroupe);
    pointe(brasGroupe, vert, [[0, 0, 0], [cote * 0.25, -0.11, 0.03], [cote * 0.34, -0.23, 0.31]], 0.105, 0.88);
    ellipsoide(brasGroupe, vert, [cote * 0.34, -0.22, 0.29], [0.12, 0.08, 0.14]);
    for (let j = 0; j < 3; j++) {
      const x = cote * (0.25 + j * 0.079);
      pointe(brasGroupe, vert, [[x, -0.22, 0.32], [x + cote * 0.015, -0.25, 0.43], [x, -0.31, 0.47]], 0.040, 0.75);
      pointe(brasGroupe, dent, [[x, -0.285, 0.45], [x, -0.32, 0.49], [x, -0.38, 0.45]], 0.026, 0.72);
    }
    bras.push({groupe: brasGroupe, cote});
  }

  function animer(t, pose = {}) {
    const attaque = Math.max(0, Math.min(1, Number(pose.attaque) || 0));
    const impact = Math.max(0, Math.min(1, Number(pose.impact) || 0));
    const energie = Math.max(0, Math.min(1, Number(pose.energie) || 0));
    // Repos et souffle draconique parcourent la colonne, avec la tête stabilisée.
    for (let i = 0; i < original.length; i++) {
      const u = i / (original.length - 1);
      colonne.points[i].copy(original[i]);
      colonne.points[i].x += Math.sin(t * 1.35 - u * 5.6) * (0.09 + 0.06 * (1 - u)) * (1 - attaque * 0.55);
      colonne.points[i].y += Math.sin(t * 1.9 - u * 4.1) * 0.055 + attaque * u * 0.11;
      colonne.points[i].z += Math.sin(t * 1.4 - u * 3.9) * 0.04 + attaque * Math.pow(u, 4) * 0.16;
    }
    // L'échantillonnage paramétrique n'alloue pas de table de longueur par image.
    for (let i = 0; i <= N; i++) colonne.getPoint(i / N, centres[i]);
    const precedente = new THREE.Vector3(1, 0, 0);
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      tangentes[i].subVectors(centres[Math.min(N, i + 1)], centres[Math.max(0, i - 1)]).normalize();
      axesX[i].copy(precedente).addScaledVector(tangentes[i], -precedente.dot(tangentes[i])).normalize();
      axesY[i].crossVectors(tangentes[i], axesX[i]).normalize();
      precedente.copy(axesX[i]);
      const r = rayonCorps(u);
      for (let j = 0; j <= M; j++) {
        const a = j / M * Math.PI * 2;
        const cos = Math.cos(a), sin = Math.sin(a);
        const k = (i * (M + 1) + j) * 3;
        const microRelief = 1 + 0.025 * Math.cos(a * 5) * Math.sin(u * Math.PI);
        positions[k] = centres[i].x + r * microRelief * (axesX[i].x * cos + axesY[i].x * sin * 0.90);
        positions[k + 1] = centres[i].y + r * microRelief * (axesX[i].y * cos + axesY[i].y * sin * 0.90);
        positions[k + 2] = centres[i].z + r * microRelief * (axesX[i].z * cos + axesY[i].z * sin * 0.90);
        normales[k] = axesX[i].x * cos + axesY[i].x * sin / 0.90;
        normales[k + 1] = axesX[i].y * cos + axesY[i].y * sin / 0.90;
        normales[k + 2] = axesX[i].z * cos + axesY[i].z * sin / 0.90;
      }
    }
    peau.attributes.position.needsUpdate = true;
    peau.attributes.normal.needsUpdate = true;
    for (const {groupe, indice} of ornements) {
      groupe.position.copy(centres[indice]);
      matrice.makeBasis(axesX[indice], axesY[indice], tangentes[indice]);
      groupe.quaternion.setFromRotationMatrix(matrice);
    }
    tete.position.copy(centres[N]);
    matrice.makeBasis(axesX[N], axesY[N], tangentes[N]);
    tete.quaternion.setFromRotationMatrix(matrice);
    tete.rotateZ(Math.sin(t * 1.1) * 0.035 + impact * Math.sin(t * 42) * 0.07);
    machoire.rotation.x = 0.08 + attaque * 0.40 + Math.sin(t * 1.3) * 0.018;
    const indiceBras = Math.round(N * 0.91);
    ceinture.position.copy(centres[indiceBras]);
    matrice.makeBasis(axesX[indiceBras], axesY[indiceBras], tangentes[indiceBras]);
    ceinture.quaternion.setFromRotationMatrix(matrice);
    for (const {groupe, cote} of bras) {
      groupe.rotation.z = cote * (Math.sin(t * 1.7) * 0.09 - attaque * 0.24);
      groupe.rotation.x = -attaque * 0.28;
    }
    jaune.emissiveIntensity = 0.14 + energie * 0.90;
    oeil.emissiveIntensity = 0.35 + energie * 0.7;
  }
  animer(0);
  return {racine, hauteur: 4.15, origineAttaque, animer};
}
