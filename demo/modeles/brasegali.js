/**
 * Braségali : sculpture originale fidèle, rig de combat et poignets ardents.
 * Les plumes, membres et flammes sont des surfaces profilées, sans asset externe.
 */
export function creerBrasegali(THREE) {
  const racine = new THREE.Group();
  racine.name = 'Braségali — maître des flammes';
  const corps = new THREE.Group();
  racine.add(corps);
  const rouge = new THREE.MeshStandardMaterial({color: 0xc92d36, roughness: 0.43, metalness: 0.035});
  const rougeClair = new THREE.MeshStandardMaterial({color: 0xec4f43, roughness: 0.46});
  const creme = new THREE.MeshStandardMaterial({color: 0xf4e4bd, roughness: 0.69});
  const cremeOmbre = new THREE.MeshStandardMaterial({color: 0xd1bf95, roughness: 0.70});
  const masque = new THREE.MeshStandardMaterial({color: 0x9c2030, roughness: 0.49});
  const bec = new THREE.MeshStandardMaterial({color: 0xcda548, roughness: 0.34});
  const bleu = new THREE.MeshStandardMaterial({color: 0x49bff5, roughness: 0.16, emissive: 0x1267a5, emissiveIntensity: 0.32});
  const noir = new THREE.MeshStandardMaterial({color: 0x101214, roughness: 0.30});
  const blanc = new THREE.MeshStandardMaterial({color: 0xfff5db, roughness: 0.34});
  const griffe = new THREE.MeshStandardMaterial({color: 0xd5cbb7, roughness: 0.30});
  const feu = new THREE.MeshStandardMaterial({color: 0xff791b, emissive: 0xf54805, emissiveIntensity: 2, roughness: 0.8, transparent: true, opacity: 0.86, depthWrite: false});
  const coeurFeu = new THREE.MeshStandardMaterial({color: 0xffed99, emissive: 0xffba37, emissiveIntensity: 2.7, roughness: 0.6});
  const ajouter = (parent, geo, mat, position) => {
    const mesh = new THREE.Mesh(geo, mat);
    if (position) mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const ovoide = (parent, mat, position, taille) => {
    const m = ajouter(parent, new THREE.SphereGeometry(1, 20, 14), mat, position);
    m.scale.set(...taille);
    return m;
  };

  /** Profils elliptiques avec déplacement du centre : muscles et plumes courbes. */
  function profil(parent, mat, sections, facettes = 16) {
    const sommets = [], uv = [], indices = [];
    const descendant = sections[sections.length - 1][1] < sections[0][1];
    for (let i = 0; i < sections.length; i++) {
      const [x, y, z, rx, rz] = sections[i];
      for (let j = 0; j <= facettes; j++) {
        const a = j / facettes * Math.PI * 2;
        sommets.push(x + Math.cos(a) * Math.max(0.001, rx), y, z + Math.sin(a) * Math.max(0.001, rz));
        uv.push(j / facettes, i / (sections.length - 1));
        if (i < sections.length - 1 && j < facettes) {
          const k = i * (facettes + 1) + j;
          if (descendant) indices.push(k, k + 1, k + facettes + 1, k + 1, k + facettes + 2, k + facettes + 1);
          else indices.push(k, k + facettes + 1, k + 1, k + 1, k + facettes + 1, k + facettes + 2);
        }
      }
    }
    const geometrie = new THREE.BufferGeometry();
    geometrie.setAttribute('position', new THREE.Float32BufferAttribute(sommets, 3));
    geometrie.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometrie.setIndex(indices);
    geometrie.computeVertexNormals();
    return ajouter(parent, geometrie, mat);
  }

  /** Plume fuselée avec nervure et pointe rabattue ; sa courbure est sculptée. */
  function plume(parent, mat, depart, pointe, largeur, profondeur = 0.065, arc = 0.055) {
    const sections = [];
    const nombres = 9;
    for (let i = 0; i <= nombres; i++) {
      const u = i / nombres;
      const gonflement = Math.sin(Math.PI * Math.pow(u, 0.8));
      sections.push([
        depart[0] + (pointe[0] - depart[0]) * u,
        depart[1] + (pointe[1] - depart[1]) * u,
        depart[2] + (pointe[2] - depart[2]) * u + Math.sin(Math.PI * u) * arc,
        Math.max(0.002, largeur * (0.36 * (1 - u) + 0.74 * gonflement)),
        Math.max(0.002, profondeur * (0.5 * (1 - u) + gonflement))
      ]);
    }
    return profil(parent, mat, sections, 10);
  }
  const nervure = (parent, points, mat = cremeOmbre, rayon = 0.005) => ajouter(parent,
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), 8, rayon, 4, false), mat);

  // Torse athlétique rouge, taille fine : une seule surface continue.
  profil(corps, rouge, [
    [0, 1.40, 0, 0.06, 0.065], [0, 1.48, 0, 0.27, 0.20],
    [0, 1.66, 0, 0.30, 0.21], [0, 1.89, 0.01, 0.245, 0.19],
    [0, 2.13, 0.01, 0.29, 0.23], [0, 2.35, 0, 0.39, 0.24],
    [0, 2.53, -0.015, 0.43, 0.20], [0, 2.66, -0.02, 0.31, 0.17],
    [0, 2.72, -0.02, 0.14, 0.12]
  ], 24);
  profil(corps, rougeClair, [[0, 2.61, 0, 0.15, 0.115], [0, 2.79, 0.0, 0.14, 0.115], [0, 2.90, 0, 0.11, 0.10]], 18);

  // Le grand col de plumes descend en tablier, avec des mèches superposées.
  for (const cote of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const x = cote * (0.07 + i * 0.093);
      const z = 0.13 + Math.cos(i * 0.30) * 0.12;
      const longueur = 0.56 + (4 - i) * 0.065;
      plume(corps, i % 2 ? cremeOmbre : creme, [x, 2.64 - i * 0.022, z],
        [x * 0.87 + cote * 0.04, 2.64 - longueur, z + 0.035], 0.10, 0.057, 0.016);
      nervure(corps, [[x, 2.53, z + 0.052], [x * 0.97, 2.32, z + 0.06], [x * 0.89 + cote * 0.04, 2.68 - longueur, z + 0.035]], cremeOmbre, 0.0035);
    }
    for (let i = 0; i < 4; i++) {
      plume(corps, creme, [cote * (0.33 + i * 0.025), 2.62 - i * 0.03, -0.01 - i * 0.09],
        [cote * (0.52 + i * 0.022), 2.27 - i * 0.05, -0.02 - i * 0.10], 0.095, 0.059, 0.025);
    }
    // Les plumes arrière allongées renforcent la silhouette du col.
    for (let i = 0; i < 3; i++) plume(corps, creme, [cote * (0.1 + i * 0.11), 2.65, -0.19],
      [cote * (0.16 + i * 0.13), 2.09 - i * 0.035, -0.27], 0.105, 0.055, -0.025);
  }

  const tete = new THREE.Group();
  tete.position.set(0, 2.86, 0.025);
  corps.add(tete);
  // Base crème et masque rouge effilé, distincts du bec et des yeux.
  profil(tete, creme, [
    [0, -0.07, 0.035, 0.025, 0.026], [0, 0.01, 0.03, 0.12, 0.13],
    [0, 0.18, 0, 0.22, 0.20], [0, 0.36, -0.025, 0.25, 0.20],
    [0, 0.49, -0.045, 0.21, 0.16], [0, 0.56, -0.04, 0.10, 0.075]
  ], 22);
  const visage = ovoide(tete, masque, [0, 0.255, 0.159], [0.205, 0.17, 0.075]);
  visage.rotation.x = -0.05;
  plume(tete, rouge, [0, 0.45, 0.194], [0, 0.175, 0.252], 0.064, 0.029, 0.00);
  plume(tete, creme, [0, 0.44, 0.19], [0, 0.595, 0.045], 0.095, 0.032, 0.03);
  // Deux grandes mèches en V, dessin signature de Braségali.
  for (const cote of [-1, 1]) {
    plume(tete, creme, [cote * 0.125, 0.44, -0.055], [cote * 0.43, 1.08, -0.28], 0.125, 0.067, 0.08);
    plume(tete, creme, [cote * 0.21, 0.38, -0.025], [cote * 0.56, 0.88, -0.36], 0.108, 0.052, 0.05);
    plume(tete, creme, [cote * 0.23, 0.32, -0.04], [cote * 0.51, 0.62, -0.47], 0.082, 0.05, 0.03);
    nervure(tete, [[cote * 0.13, 0.54, -0.003], [cote * 0.25, 0.76, -0.08], [cote * 0.40, 1.02, -0.24]], cremeOmbre, 0.006);
    // Joues blanches en pointes et sourcils rouges agressifs.
    plume(tete, creme, [cote * 0.17, 0.22, 0.105], [cote * 0.27, -0.13, 0.03], 0.10, 0.049, 0.01);
    plume(tete, creme, [cote * 0.20, 0.21, 0.08], [cote * 0.36, -0.055, -0.10], 0.077, 0.05, 0.01);
    const yeux = new THREE.Group();
    yeux.position.set(cote * 0.104, 0.30, 0.211);
    yeux.rotation.y = cote * 0.24;
    yeux.rotation.z = cote * 0.21;
    tete.add(yeux);
    ovoide(yeux, noir, [0, 0, 0], [0.088, 0.058, 0.014]);
    ovoide(yeux, blanc, [0, -0.003, 0.012], [0.079, 0.046, 0.009]);
    ovoide(yeux, bleu, [cote * -0.012, -0.004, 0.021], [0.033, 0.042, 0.009]);
    ovoide(yeux, noir, [cote * -0.012, -0.004, 0.029], [0.015, 0.031, 0.004]);
    ovoide(yeux, blanc, [-0.022, 0.014, 0.033], [0.010, 0.008, 0.003]);
    nervure(tete, [[cote * 0.035, 0.345, 0.23], [cote * 0.10, 0.365, 0.23], [cote * 0.193, 0.393, 0.18]], rouge, 0.022);
  }
  // Petit bec angulaire ocre, composé de deux plans biseautés.
  const formeBec = new THREE.Shape();
  formeBec.moveTo(-0.066, 0.07); formeBec.lineTo(0.066, 0.07);
  formeBec.lineTo(0.037, -0.038); formeBec.lineTo(0, -0.072); formeBec.lineTo(-0.037, -0.038); formeBec.closePath();
  const meshBec = ajouter(tete, new THREE.ExtrudeGeometry(formeBec, {depth: 0.075, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.02, bevelSegments: 2, steps: 1}), bec, [0, 0.19, 0.218]);
  meshBec.rotation.x = 0.1;
  nervure(tete, [[-0.045, 0.15, 0.29], [0, 0.146, 0.313], [0.045, 0.15, 0.29]], masque, 0.005);

  /** Flammes sculptées en langues courbes ; animation légère par groupes. */
  function flammes(parent, position, taille) {
    const groupe = new THREE.Group();
    groupe.position.set(...position);
    groupe.scale.setScalar(taille);
    parent.add(groupe);
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5;
      const x = Math.cos(a) * 0.105, z = Math.sin(a) * 0.105;
      const p = profil(groupe, feu, [
        [x, 0, z, 0.075, 0.072], [x * 1.18, 0.14, z * 1.15, 0.085, 0.07],
        [x * 1.33, 0.29, z * 1.26, 0.052, 0.044],
        [x * 1.35 - 0.025, 0.42 + i * 0.023, z * 1.4, 0.025, 0.028],
        [x * 1.66, 0.53 + (i % 2) * 0.13, z * 1.25, 0.002, 0.002]
      ], 10);
      p.castShadow = false; p.receiveShadow = false;
      const coeur = profil(groupe, coeurFeu, [[x, 0, z, 0.045, 0.041], [x * 1.15, 0.10, z, 0.043, 0.035], [x * 1.12, 0.26, z * 1.1, 0.002, 0.002]], 8);
      coeur.castShadow = false; coeur.receiveShadow = false;
    }
    return groupe;
  }
  const bras = [];
  for (const cote of [-1, 1]) {
    const epaule = new THREE.Group();
    epaule.position.set(cote * 0.44, 2.52, -0.015);
    corps.add(epaule);
    profil(epaule, rouge, [[0, 0.04, 0, 0.015, 0.015], [0, -0.03, 0, 0.15, 0.16],
      [cote * 0.025, -0.20, 0, 0.135, 0.145], [cote * 0.028, -0.40, 0.005, 0.10, 0.105],
      [0, -0.59, 0.005, 0.10, 0.10], [0, -0.67, 0, 0.065, 0.064]], 18);
    const coude = new THREE.Group();
    coude.position.set(0, -0.61, 0);
    epaule.add(coude);
    profil(coude, rougeClair, [[0, 0.025, 0, 0.06, 0.07], [0, -0.055, 0, 0.115, 0.12],
      [0, -0.21, 0.015, 0.155, 0.15], [0, -0.39, 0.025, 0.14, 0.13],
      [0, -0.54, 0.02, 0.103, 0.096], [0, -0.64, 0.02, 0.085, 0.08]], 18);
    // Les manchettes crème et la main à trois doigts donnent l'anatomie aviaire.
    for (let j = 0; j < 5; j++) {
      const a = j * Math.PI * 2 / 5;
      const x = Math.cos(a) * 0.11, z = Math.sin(a) * 0.10;
      plume(coude, creme, [x, -0.45, z + 0.018], [x * 1.6, -0.67 - (j % 2) * 0.055, z * 1.6], 0.049, 0.031, 0.01);
    }
    ovoide(coude, rouge, [0, -0.66, 0.025], [0.132, 0.12, 0.10]);
    for (let j = 0; j < 3; j++) {
      const x = (j - 1) * 0.077;
      profil(coude, rouge, [[x, -0.71, 0.035, 0.043, 0.053], [x, -0.82, 0.085, 0.038, 0.047], [x, -0.86, 0.06, 0.017, 0.025]], 10);
      plume(coude, griffe, [x, -0.82, 0.112], [x, -0.91, 0.13], 0.017, 0.018, 0.01);
    }
    const feuPoignet = flammes(coude, [0, -0.48, 0.025], 0.57);
    bras.push({epaule, coude, feuPoignet, cote});
  }

  const jambes = [];
  const origineAttaque = new THREE.Object3D();
  origineAttaque.name = 'Origine Pied Brûleur — griffes du pied gauche';
  for (const cote of [-1, 1]) {
    const hanche = new THREE.Group();
    hanche.position.set(cote * 0.255, 1.53, 0);
    corps.add(hanche);
    profil(hanche, rouge, [[0, 0.03, 0, 0.05, 0.05], [0, -0.06, 0, 0.195, 0.20],
      [cote * 0.02, -0.23, -0.01, 0.20, 0.185], [cote * 0.025, -0.43, 0, 0.165, 0.16],
      [cote * 0.01, -0.62, 0.015, 0.12, 0.13], [0, -0.73, 0.01, 0.115, 0.11]], 20);
    const genou = new THREE.Group();
    genou.position.set(0, -0.70, 0.012);
    hanche.add(genou);
    profil(genou, rouge, [[0, 0.02, 0, 0.092, 0.09], [0, -0.10, 0, 0.127, 0.13],
      [cote * 0.008, -0.29, 0, 0.17, 0.155], [cote * 0.01, -0.45, 0.005, 0.22, 0.18],
      [cote * 0.015, -0.60, 0.005, 0.255, 0.20], [cote * 0.018, -0.70, 0.01, 0.225, 0.19]], 22);
    // Bas de pantalon plumeux évasé, et griffes solides orientées vers l'avant.
    for (let j = 0; j < 7; j++) {
      const a = j * Math.PI * 2 / 7;
      const x = Math.cos(a) * 0.20, z = Math.sin(a) * 0.17;
      plume(genou, j % 2 ? rouge : rougeClair, [x, -0.43, z], [x * 1.19, -0.76 - (j % 2) * 0.025, z * 1.26], 0.074, 0.043, 0.006);
    }
    ovoide(genou, rouge, [0, -0.68, 0.05], [0.17, 0.10, 0.24]);
    for (let j = 0; j < 3; j++) {
      const x = (j - 1) * 0.092;
      const courbe = new THREE.CatmullRomCurve3([
        new THREE.Vector3(x, -0.68, 0.17), new THREE.Vector3(x, -0.69, 0.28), new THREE.Vector3(x, -0.73, 0.36)
      ]);
      ajouter(genou, new THREE.TubeGeometry(courbe, 8, 0.031, 8, false), griffe);
      const pointe = ajouter(genou, new THREE.ConeGeometry(0.03, 0.10, 8), griffe, [x, -0.735, 0.38]);
      pointe.rotation.x = Math.PI / 2 + 0.28;
    }
    const feuPied = flammes(genou, [0, -0.52, 0.09], 0.68);
    if (cote < 0) {
      origineAttaque.position.set(0, -0.69, 0.40);
      genou.add(origineAttaque);
    }
    jambes.push({hanche, genou, feuPied, cote});
  }

  function animer(t, pose = {}) {
    const attaque = Math.max(0, Math.min(1, Number(pose.attaque) || 0));
    const impact = Math.max(0, Math.min(1, Number(pose.impact) || 0));
    const energie = Math.max(0, Math.min(1, Number(pose.energie) || 0));
    const souffle = Math.sin(t * 2.1);
    corps.position.y = 0.038 + souffle * 0.025 + attaque * 0.075;
    corps.rotation.x = attaque * 0.13 + impact * Math.sin(t * 31) * 0.075;
    corps.rotation.z = Math.sin(t * 1.55) * 0.018 - attaque * 0.12;
    tete.rotation.y = Math.sin(t * 1.1) * 0.075 - attaque * 0.10;
    tete.rotation.x = -0.025 - attaque * 0.06;
    for (const {epaule, coude, feuPoignet, cote} of bras) {
      // Garde martiale : mains devant le torse et épaules vivantes.
      epaule.rotation.x = -0.22 - attaque * (cote < 0 ? 0.26 : 0.74);
      epaule.rotation.z = cote * (0.27 + Math.sin(t * 2.1 + cote) * 0.035 + attaque * 0.16);
      coude.rotation.x = -0.74 - Math.sin(t * 2.2 + cote) * 0.06 - attaque * (cote < 0 ? 0.13 : -0.31);
      coude.rotation.z = -cote * 0.14;
      feuPoignet.visible = energie > 0.035 || attaque > 0.04;
      const taille = 0.35 + energie * 0.29 + attaque * 0.27;
      feuPoignet.scale.set(taille, taille * (1 + Math.sin(t * 15 + cote) * 0.10), taille);
      feuPoignet.rotation.y = t * 0.8;
    }
    for (const {hanche, genou, feuPied, cote} of jambes) {
      hanche.rotation.z = cote * (0.17 + attaque * (cote < 0 ? -0.10 : 0.08));
      // Pied gauche enflammé monte vers l'adversaire, jambe droite d'appui fléchie.
      hanche.rotation.x = cote < 0 ? -0.07 - attaque * 1.47 : 0.07 + attaque * 0.17;
      genou.rotation.x = cote < 0 ? 0.12 + Math.sin(attaque * Math.PI) * 0.48 : 0.06 + attaque * 0.18;
      feuPied.visible = cote < 0 && attaque > 0.12;
      const taille = 0.25 + attaque * 0.67;
      feuPied.scale.set(taille, taille * (1 + Math.sin(t * 18) * 0.12), taille);
      feuPied.rotation.y = -t;
    }
    feu.opacity = 0.80 + Math.sin(t * 17) * 0.09;
    feu.emissiveIntensity = 1.55 + energie * 1.1;
    bleu.emissiveIntensity = 0.22 + energie * 0.30;
  }
  animer(0);
  return {racine, hauteur: 4.0, origineAttaque, animer};
}
