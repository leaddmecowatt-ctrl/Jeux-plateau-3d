import { creerPikachu } from './modeles/pikachu.js';
import { creerDracaufeu } from './modeles/dracaufeu.js';
import { creerMewtwo } from './modeles/mewtwo.js';
import { creerMew } from './modeles/mew.js';
import { creerDeoxys } from './modeles/deoxys.js';
import { creerRayquaza } from './modeles/rayquaza.js';
import { creerBrasegali } from './modeles/brasegali.js';

// Le spectacle vit exclusivement dans le décor : aucun accès au tirage,
// aux commandes de l'animateur, aux lots ou au stockage de la partie.
const DUREE_DUEL = 22;
const DISTRIBUTION = {
  pikachu: { nom: 'Pikachu', creer: creerPikachu, couleur: 0xffda39, bouche: 1.13 },
  dracaufeu: { nom: 'Dracaufeu', creer: creerDracaufeu, couleur: 0xff7929, bouche: 1.76 },
  mewtwo: { nom: 'Mewtwo', creer: creerMewtwo, couleur: 0xa67aff, bouche: 1.43, flotte: .09 },
  mew: { nom: 'Mew', creer: creerMew, couleur: 0xff8bd4, bouche: 1.24, flotte: .33 },
  deoxys: { nom: 'Deoxys', creer: creerDeoxys, couleur: 0x5bf7e1, bouche: 1.39, flotte: .17 },
  rayquaza: { nom: 'Rayquaza', creer: creerRayquaza, couleur: 0x96ffad, bouche: 1.77, flotte: .27 },
  brasegali: { nom: 'Braségali', creer: creerBrasegali, couleur: 0xffb541, bouche: .92 }
};
const ATTAQUES = {
  tonnerre: { nom: 'Tonnerre', type: 'foudre', couleur: 0xffdd35 },
  fatalFoudre: { nom: 'Fatal-Foudre', type: 'foudre', couleur: 0xffef7c, ciel: true },
  lanceFlammes: { nom: 'Lance-Flammes', type: 'feu', couleur: 0xff7a24 },
  deflagration: { nom: 'Déflagration', type: 'feu', couleur: 0xff4628, explosion: true },
  dracoAscension: { nom: 'Draco-Ascension', type: 'dragon', couleur: 0x6af7a2 },
  ultralaser: { nom: 'Ultralaser', type: 'energie', couleur: 0xffd785 },
  frappePsy: { nom: 'Frappe Psy', type: 'psy', couleur: 0xb17aff },
  psyko: { nom: 'Psyko', type: 'psy', couleur: 0xf68cef },
  psychoBoost: { nom: 'Psycho Boost', type: 'psy', couleur: 0x69f2e7, explosion: true },
  piedBruleur: { nom: 'Pied Brûleur', type: 'pied', couleur: 0xff9a29 }
};
const DUELS = [
  ['pikachu', 'dracaufeu', 'tonnerre', 'lanceFlammes'],
  ['rayquaza', 'mewtwo', 'dracoAscension', 'frappePsy'],
  ['mew', 'deoxys', 'psyko', 'psychoBoost'],
  ['brasegali', 'dracaufeu', 'piedBruleur', 'deflagration'],
  ['pikachu', 'mewtwo', 'fatalFoudre', 'psyko'],
  ['deoxys', 'rayquaza', 'ultralaser', 'ultralaser'],
  ['brasegali', 'pikachu', 'piedBruleur', 'tonnerre'],
  ['mewtwo', 'mew', 'frappePsy', 'psyko'],
  ['dracaufeu', 'rayquaza', 'deflagration', 'dracoAscension']
];

const borner = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lisser = v => { const x = borner(v); return x * x * (3 - 2 * x); };
const enveloppe = (t, debut, fin, rampe = .28) => lisser((t - debut) / rampe) * lisser((fin - t) / rampe);

function textureObsidienne(THREE) {
  const toile = document.createElement('canvas');
  toile.width = toile.height = 1024;
  const dessin = toile.getContext('2d');
  dessin.fillStyle = '#11151c';
  dessin.fillRect(0, 0, 1024, 1024);
  let graine = 28641;
  const hasard = () => { graine = (1664525 * graine + 1013904223) >>> 0; return graine / 4294967296; };
  // Veines de pierre et microstriures préparées une fois, sans texture externe.
  for (let i = 0; i < 240; i++) {
    const x = hasard() * 1024, y = hasard() * 1024;
    dessin.strokeStyle = i % 8 === 0 ? 'rgba(185,147,72,.1)' : 'rgba(117,132,151,.055)';
    dessin.lineWidth = hasard() * 1.3 + .3;
    dessin.beginPath(); dessin.moveTo(x, y);
    dessin.bezierCurveTo(x + 75, y - 32, x - 54, y + 85, x + hasard() * 140, y + hasard() * 220);
    dessin.stroke();
  }
  const reflet = dessin.createRadialGradient(430, 310, 10, 512, 512, 650);
  reflet.addColorStop(0, 'rgba(127,135,150,.11)');
  reflet.addColorStop(1, 'rgba(0,0,0,.07)');
  dessin.fillStyle = reflet; dessin.fillRect(0, 0, 1024, 1024);
  const texture = new THREE.CanvasTexture(toile);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function creerDecor(THREE, parent) {
  const or = new THREE.MeshStandardMaterial({ color: 0xd49a36, metalness: .92, roughness: .25 });
  const orClair = new THREE.MeshStandardMaterial({ color: 0xffd995, metalness: .88, roughness: .24 });
  const pierre = new THREE.MeshPhysicalMaterial({ color: 0xb5b6be, map: textureObsidienne(THREE), metalness: .54, roughness: .39, clearcoat: .48, clearcoatRoughness: .3 });
  const noir = new THREE.MeshStandardMaterial({ color: 0x090d13, metalness: .75, roughness: .31 });
  const lueur = new THREE.MeshBasicMaterial({ color: 0xffd888, transparent: true, opacity: .8 });
  const ajouter = (geometrie, materiau, y) => {
    const objet = new THREE.Mesh(geometrie, materiau);
    objet.position.y = y; objet.receiveShadow = true; parent.add(objet); return objet;
  };
  ajouter(new THREE.BoxGeometry(7.94, .14, 7.94), noir, .13);
  ajouter(new THREE.CylinderGeometry(3.77, 3.83, .13, 96), or, .22);
  ajouter(new THREE.CylinderGeometry(3.70, 3.76, .07, 96), noir, .28);
  ajouter(new THREE.CylinderGeometry(3.65, 3.65, .025, 96), pierre, .326);

  const matrice = new THREE.Object3D();
  const anneaux = new THREE.InstancedMesh(new THREE.TorusGeometry(1, .008, 6, 96), orClair, 4);
  [3.63, 3.38, 2.94, .69].forEach((rayon, index) => {
    matrice.position.set(0, .348, 0); matrice.rotation.set(-Math.PI / 2, 0, 0); matrice.scale.setScalar(rayon); matrice.updateMatrix();
    anneaux.setMatrixAt(index, matrice.matrix);
  }); parent.add(anneaux);

  // Les inscriptions sont des incrustations géométriques ; pas de panneau
  // plaqué sur les personnages et aucune paroi haute devant les cases.
  const incrustations = new THREE.InstancedMesh(new THREE.BoxGeometry(.018, .005, .20), or, 80);
  for (let i = 0; i < 80; i++) {
    const angle = i * Math.PI * 2 / 80;
    matrice.position.set(Math.sin(angle) * 3.5, .35, Math.cos(angle) * 3.5);
    matrice.rotation.set(0, angle, 0); matrice.scale.set(1, 1, i % 5 === 0 ? 1 : .42); matrice.updateMatrix();
    incrustations.setMatrixAt(i, matrice.matrix);
  } parent.add(incrustations);
  const rayons = new THREE.InstancedMesh(new THREE.BoxGeometry(.011, .005, 1.98), or, 12);
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI * 2 / 12;
    matrice.position.set(Math.sin(angle) * 1.83, .346, Math.cos(angle) * 1.83);
    matrice.rotation.set(0, angle, 0); matrice.scale.set(1, 1, 1); matrice.updateMatrix(); rayons.setMatrixAt(i, matrice.matrix);
  } parent.add(rayons);

  const embleme = new THREE.Group();
  const demiDisque = new THREE.Mesh(new THREE.CircleGeometry(.42, 40, 0, Math.PI), or);
  demiDisque.rotation.x = -Math.PI / 2; demiDisque.position.y = .349; embleme.add(demiDisque);
  const demiDisque2 = demiDisque.clone(); demiDisque2.rotation.z = Math.PI; embleme.add(demiDisque2);
  const separateur = new THREE.Mesh(new THREE.BoxGeometry(.88, .005, .09), noir); separateur.position.y = .357; embleme.add(separateur);
  const bouton = new THREE.Mesh(new THREE.CylinderGeometry(.105, .105, .006, 24), orClair); bouton.position.y = .36; embleme.add(bouton); parent.add(embleme);

  const couronne = new THREE.InstancedMesh(new THREE.ConeGeometry(.075, 1, 4), or, 17);
  const gemmes = new THREE.InstancedMesh(new THREE.OctahedronGeometry(.053), orClair, 17);
  for (let i = 0; i < 17; i++) {
    const angle = -1.07 + i / 16 * 2.14;
    const hauteur = i % 4 === 0 ? .38 : .22;
    const x = Math.sin(angle) * 3.74, z = -Math.cos(angle) * 3.74;
    matrice.position.set(x, .35 + hauteur / 2, z); matrice.rotation.set(0, angle, 0); matrice.scale.set(1, hauteur, 1); matrice.updateMatrix(); couronne.setMatrixAt(i, matrice.matrix);
    matrice.position.y = .36 + hauteur; matrice.scale.setScalar(1); matrice.updateMatrix(); gemmes.setMatrixAt(i, matrice.matrix);
  } parent.add(couronne, gemmes);

  const bornes = new THREE.InstancedMesh(new THREE.CylinderGeometry(.14, .20, .34, 6), noir, 4);
  const cristaux = new THREE.InstancedMesh(new THREE.OctahedronGeometry(.09), orClair, 4);
  const veilleuses = new THREE.InstancedMesh(new THREE.TorusGeometry(.17, .018, 6, 24), lueur, 4);
  for (let i = 0; i < 4; i++) {
    const x = i < 2 ? -3.5 : 3.5, z = i % 2 ? -3.5 : 3.5;
    matrice.position.set(x, .34, z); matrice.rotation.set(0, Math.PI / 6, 0); matrice.scale.setScalar(1); matrice.updateMatrix(); bornes.setMatrixAt(i, matrice.matrix);
    matrice.position.y = .55; matrice.updateMatrix(); cristaux.setMatrixAt(i, matrice.matrix);
    matrice.position.y = .535; matrice.rotation.x = -Math.PI / 2; matrice.updateMatrix(); veilleuses.setMatrixAt(i, matrice.matrix);
  } parent.add(bornes, cristaux, veilleuses);

  const cercleTransition = new THREE.Mesh(new THREE.TorusGeometry(1, .027, 8, 80), new THREE.MeshBasicMaterial({ color: 0xffdfa0, transparent: true, opacity: .45, blending: THREE.AdditiveBlending, depthWrite: false }));
  cercleTransition.rotation.x = -Math.PI / 2; cercleTransition.position.y = .38; cercleTransition.scale.setScalar(3.15); parent.add(cercleTransition);
  return { cercleTransition };
}

function creerEffet(THREE, parent) {
  const groupe = new THREE.Group(); parent.add(groupe); groupe.visible = false;
  const couleur = new THREE.Color(0xffcf50);
  const matHalo = new THREE.MeshBasicMaterial({ color: couleur, transparent: true, opacity: .28, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const matCoeur = new THREE.MeshBasicMaterial({ color: 0xfff7e5, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false });
  const rayon = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12, 1, true), matHalo); groupe.add(rayon);
  const coeur = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8, 1, true), matCoeur); groupe.add(coeur);
  const impact = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), matHalo); groupe.add(impact);
  const anneaux = [];
  const geoAnneau = new THREE.TorusGeometry(1, .035, 8, 32);
  for (let i = 0; i < 4; i++) { const anneau = new THREE.Mesh(geoAnneau, matHalo); groupe.add(anneau); anneaux.push(anneau); }
  const charge = new THREE.Mesh(new THREE.IcosahedronGeometry(.20, 2), matHalo); groupe.add(charge);

  const positions = new Float32Array(240 * 3);
  const eclairGeo = new THREE.BufferGeometry();
  eclairGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  const eclairMat = new THREE.LineBasicMaterial({ color: couleur, transparent: true, opacity: .96, blending: THREE.AdditiveBlending, depthWrite: false });
  const eclairs = new THREE.LineSegments(eclairGeo, eclairMat); eclairs.frustumCulled = false; groupe.add(eclairs);

  const feuUniformes = { temps: { value: 0 }, intensite: { value: 0 }, teinte: { value: new THREE.Color(0xff7433) } };
  const feuMat = new THREE.ShaderMaterial({
    uniforms: feuUniformes, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec3 vPosition; varying vec2 vUv; uniform float temps;
      void main(){vPosition=position;vUv=uv;vec3 p=position;
      float s=(p.y+.5);p.x+=sin(s*17.-temps*11.+p.z*5.)*s*.08;p.z+=cos(s*15.-temps*9.+p.x*6.)*s*.075;
      gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
    fragmentShader: `varying vec3 vPosition; varying vec2 vUv; uniform float temps; uniform float intensite; uniform vec3 teinte;
      void main(){float axe=vPosition.y+.5;float motif=sin(axe*38.-temps*16.+sin(vUv.x*31.+temps*3.)*3.);
      float detail=sin(vUv.x*59.-temps*7.+axe*21.);float bord=pow(max(0.,sin(vUv.x*3.14159265)),.35);
      float coeur=smoothstep(.94,.02,axe)*(.62+.24*motif+.12*detail);
      vec3 c=mix(teinte,vec3(1.,.94,.66),coeur);float a=(.36+.17*motif)*bord*smoothstep(1.,.54,axe)*intensite;
      gl_FragColor=vec4(c*1.55,a);}`
  });
  const geoFeu = new THREE.CylinderGeometry(.36, .06, 1, 16, 16, true);
  const flammes = [];
  for (let i = 0; i < 3; i++) { const flamme = new THREE.Mesh(geoFeu, feuMat); groupe.add(flamme); flammes.push(flamme); }
  return { groupe, rayon, coeur, impact, anneaux, charge, eclairs, positions, feuUniformes, flammes, matHalo, matCoeur, eclairMat, direction: new THREE.Vector3(), milieu: new THREE.Vector3(), depart: new THREE.Vector3(), cible: new THREE.Vector3(), axeAnneau: new THREE.Vector3(0, 0, 1) };
}

function creerParticules(THREE, parent) {
  const nombre = 256, positions = new Float32Array(nombre * 3), couleurs = new Float32Array(nombre * 3), tailles = new Float32Array(nombre);
  const geometrie = new THREE.BufferGeometry();
  geometrie.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometrie.setAttribute('color', new THREE.BufferAttribute(couleurs, 3).setUsage(THREE.DynamicDrawUsage));
  geometrie.setAttribute('taille', new THREE.BufferAttribute(tailles, 1));
  for (let i = 0; i < nombre; i++) tailles[i] = 7 + ((i * 17) % 19);
  const materiau = new THREE.ShaderMaterial({
    uniforms: { definition: { value: 720 }, opacite: { value: .82 } }, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float taille;varying vec3 vCouleur;uniform float definition;void main(){vCouleur=color;vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_PointSize=clamp(taille*definition/720.*12./max(4.,-p.z),2.,32.);}`,
    fragmentShader: `varying vec3 vCouleur;uniform float opacite;void main(){float d=length(gl_PointCoord-.5)*2.;if(d>1.)discard;float a=pow(1.-d,2.4)*opacite;gl_FragColor=vec4(vCouleur*1.55,a);}`
  });
  const nuage = new THREE.Points(geometrie, materiau); nuage.frustumCulled = false; parent.add(nuage);
  return { nuage, positions, couleurs, nombre, materiau };
}

function appliquerEffet(THREE, effet, attaque, puissance, charge, progression, t, depart, cible, eco) {
  const actif = puissance > .01 || charge > .01;
  effet.groupe.visible = actif;
  if (!actif) return;
  effet.depart.copy(depart); effet.cible.copy(cible);
  effet.direction.subVectors(cible, depart);
  const longueur = effet.direction.length(); effet.direction.normalize();
  effet.milieu.copy(depart).addScaledVector(effet.direction, longueur / 2);
  effet.matHalo.color.setHex(attaque.couleur); effet.eclairMat.color.setHex(attaque.couleur);
  effet.matHalo.opacity = .21 + puissance * .26;
  effet.matCoeur.opacity = puissance * .91;
  effet.charge.visible = charge > .01;
  effet.charge.position.copy(depart); effet.charge.scale.setScalar(1 + charge * 2.1 + Math.sin(t * 16) * .12);
  effet.charge.rotation.set(t * .8, t, t * .5);
  const rayonVisible = puissance > .01 && attaque.type !== 'foudre' && attaque.type !== 'feu' && attaque.type !== 'pied';
  effet.rayon.visible = effet.coeur.visible = rayonVisible;
  for (const objet of [effet.rayon, effet.coeur]) {
    objet.position.copy(effet.milieu); objet.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, effet.direction);
  }
  const largeur = attaque.type === 'dragon' ? .12 : attaque.type === 'psy' ? .10 : .19;
  effet.rayon.scale.set(largeur * (1.7 + puissance), longueur, largeur * (1.7 + puissance));
  effet.coeur.scale.set(largeur * .36 * puissance, longueur, largeur * .36 * puissance);

  const feu = puissance > .01 && (attaque.type === 'feu' || attaque.type === 'pied');
  effet.feuUniformes.temps.value = t; effet.feuUniformes.intensite.value = puissance;
  effet.feuUniformes.teinte.value.setHex(attaque.couleur);
  for (let i = 0; i < 3; i++) {
    const flamme = effet.flammes[i]; flamme.visible = feu && (!eco || i === 0);
    if (!flamme.visible) continue;
    flamme.position.copy(effet.milieu); flamme.position.z += Math.sin(t * 7 + i * 2.1) * .09;
    flamme.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, effet.direction);
    flamme.rotateY(t * 2 + i * 2.1);
    const epaisseur = attaque.type === 'pied' ? .45 : .8;
    flamme.scale.set(epaisseur * (1 + i * .11), longueur, epaisseur * (1 + i * .11));
  }

  const impact = puissance * lisser((progression - .23) / .21);
  effet.impact.visible = impact > .01;
  effet.impact.position.copy(cible);
  effet.impact.rotation.set(t * 3, t * 2, t);
  const taille = (attaque.explosion ? .48 : .23) * impact * (1.15 + Math.sin(t * 17) * .14);
  effet.impact.scale.setScalar(taille);
  for (let i = 0; i < 4; i++) {
    const anneau = effet.anneaux[i]; anneau.visible = puissance > .01 && (!eco || i < 2);
    if (!anneau.visible) continue;
    if (attaque.type === 'pied') {
      anneau.position.copy(depart).addScaledVector(effet.direction, longueur * (i / 3));
      anneau.rotation.set(Math.PI / 2 + i * .6, t * 4 + i, t * 3);
      anneau.scale.setScalar(.28 + .14 * i + .1 * Math.sin(t * 9 + i));
    } else {
      const onde = (t * 1.7 + i / 4) % 1;
      anneau.position.copy(depart).addScaledVector(effet.direction, longueur * onde);
      anneau.quaternion.setFromUnitVectors(effet.axeAnneau, effet.direction);
      anneau.scale.setScalar((attaque.type === 'psy' ? .26 : .19) + onde * .37);
    }
  }

  effet.eclairs.visible = attaque.type === 'foudre' && puissance > .01;
  if (effet.eclairs.visible) {
    let curseur = 0;
    const branches = eco ? 2 : 4;
    const segments = 22;
    const phase = Math.floor(t * 22);
    for (let b = 0; b < branches; b++) {
      for (let j = 0; j < segments; j++) {
        for (let point = 0; point < 2; point++) {
          const u = (j + point) / segments;
          const arc = Math.sin(u * Math.PI);
          const sin = Math.sin((j + point) * 127.1 + phase * 7.13 + b * 31.7);
          const cos = Math.sin((j + point) * 67.3 + phase * 13.71 + b * 17.1);
          effet.positions[curseur++] = depart.x + (cible.x - depart.x) * u;
          effet.positions[curseur++] = depart.y + (cible.y - depart.y) * u + (sin * .16 + (b - 1.5) * .08) * arc;
          effet.positions[curseur++] = depart.z + (cible.z - depart.z) * u + (cos * .18 + (b - 1.5) * .09) * arc;
        }
      }
    }
    if (attaque.ciel) {
      for (let j = 0; j < 12; j++) {
        for (let point = 0; point < 2; point++) {
          const u = (j + point) / 12;
          effet.positions[curseur++] = cible.x + Math.sin((j + point) * 31.7 + phase) * .22 * Math.sin(u * Math.PI);
          effet.positions[curseur++] = cible.y + 2.9 * (1 - u);
          effet.positions[curseur++] = cible.z + Math.cos((j + point) * 27.1 + phase) * .18 * Math.sin(u * Math.PI);
        }
      }
    }
    effet.eclairs.geometry.setDrawRange(0, curseur / 3);
    effet.eclairs.geometry.attributes.position.needsUpdate = true;
  }
}

export function installerArene({ THREE, scene, renderer, camera, boardGroup }) {
  const racine = new THREE.Group(); racine.name = 'Pikapoly — arène Golden de présentation';
  (boardGroup || scene).add(racine);
  const decor = creerDecor(THREE, racine);
  const personnages = {};
  const modeles = new THREE.Group(); racine.add(modeles);
  for (const [identifiant, fiche] of Object.entries(DISTRIBUTION)) {
    const personnage = fiche.creer(THREE);
    const groupe = new THREE.Group(); groupe.name = fiche.nom; groupe.add(personnage.racine); groupe.visible = false;
    modeles.add(groupe);
    const dimensions = new THREE.Box3().setFromObject(personnage.racine).getSize(new THREE.Vector3());
    const hauteur = personnage.hauteur || dimensions.y || 2.3;
    const hauteurCible = identifiant === 'pikachu' ? 2.4 : identifiant === 'dracaufeu' ? 2.7 : identifiant === 'rayquaza' ? 2.85 : identifiant === 'mew' ? 2.15 : 2.65;
    let echelle = hauteurCible / hauteur;
    // Face +Z devient l'axe de combat X. Les ailes peuvent s'étendre dans
    // la profondeur de l'arène, sans diminuer inutilement le corps entier.
    const largeurMax = identifiant === 'dracaufeu' ? 4.3 : identifiant === 'rayquaza' ? 3.8 : 3.3;
    const profondeurMax = identifiant === 'rayquaza' ? 3.8 : 3.4;
    if (dimensions.x * echelle > largeurMax) echelle = largeurMax / dimensions.x;
    if (dimensions.z * echelle > profondeurMax) echelle = profondeurMax / dimensions.z;
    personnage.racine.scale.multiplyScalar(echelle);
    personnages[identifiant] = { ...personnage, groupe, fiche, echelle, hauteurEffective: hauteur * echelle, pose: { attaque: 0, impact: 0, energie: 0 } };
  }
  const effets = [creerEffet(THREE, racine), creerEffet(THREE, racine)];
  const particules = creerParticules(THREE, racine);
  const lumiere = [new THREE.PointLight(0xffbe73, 0, 5, 2), new THREE.PointLight(0xb895ff, 0, 5, 2)];
  lumiere.forEach(lampe => { lampe.castShadow = false; racine.add(lampe); });

  const ombres = [], auras = [];
  const geoOmbre = new THREE.CircleGeometry(1, 40);
  const geoAura = new THREE.TorusGeometry(1, .014, 6, 48);
  for (let cote = 0; cote < 2; cote++) {
    const ombre = new THREE.Mesh(geoOmbre, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .29, depthWrite: false }));
    ombre.rotation.x = -Math.PI / 2; ombre.scale.set(1.0, .7, 1); ombre.position.y = .353; racine.add(ombre); ombres.push(ombre);
    const aura = new THREE.Mesh(geoAura, new THREE.MeshBasicMaterial({ color: 0xffca71, transparent: true, opacity: .27, blending: THREE.AdditiveBlending, depthWrite: false }));
    aura.rotation.x = -Math.PI / 2; aura.position.y = .36; racine.add(aura); auras.push(aura);
  }

  const hud = {
    noms: document.querySelector('#demo-combat-noms'),
    attaque: document.querySelector('#demo-combat-attaque'),
    phase: document.querySelector('#demo-combat-phase'),
    pause: document.querySelector('#demo-spectacle')
  };
  const textes = {};
  function ecrire(cle, valeur) { if (textes[cle] !== valeur) { textes[cle] = valeur; if (hud[cle]) hud[cle].textContent = valeur; } }

  const parametres = new URLSearchParams(window.location.search);
  const captureDemandee = parametres.get('spectacle_t');
  const tempsCapture = captureDemandee !== null && Number.isFinite(Number(captureDemandee)) ? Math.max(0, Number(captureDemandee)) : null;
  let origine = null, pause = false, tempsPause = 0, tempsSoustrait = 0, tempsGlobal = 0;
  let tempsScene = 0, ancienDuel = -1, detruit = false, modeEco = false;
  const derniersEvenements = ['', ''];
  let etat = { duel: 0, attaque: '', type: '', phase: 'Entrée dans l’arène', pokemon: [] };
  const departs = [new THREE.Vector3(), new THREE.Vector3()], cibles = [new THREE.Vector3(), new THREE.Vector3()];
  const tailleRendu = new THREE.Vector2();
  const puissances = [0, 0], charges = [0, 0], progressions = [0, 0];

  function basculerPause() {
    pause = !pause;
    if (pause) tempsPause = tempsGlobal;
    else tempsSoustrait += tempsGlobal - tempsPause;
    if (hud.pause) { hud.pause.setAttribute('aria-pressed', String(!pause)); hud.pause.textContent = pause ? '▶ Reprendre le spectacle' : 'Ⅱ Pause du spectacle'; }
  }
  hud.pause?.addEventListener('click', basculerPause);

  function notifierAttaque(duel, cote, attaque, finale) {
    const signature = `${Math.floor(tempsScene / (DUREE_DUEL * DUELS.length))}:${duel}:${cote}:${finale ? 1 : 0}`;
    if (derniersEvenements[cote] === signature || tempsCapture !== null) return;
    derniersEvenements[cote] = signature;
    window.dispatchEvent(new CustomEvent('pikapoly:attaque', { detail: { type: attaque.type, intensite: finale ? .65 : 1, pokemon: DISTRIBUTION[DUELS[duel][cote]].nom, attaque: attaque.nom } }));
  }

  function update(t, dt, eco = false) {
    if (detruit) return;
    tempsGlobal = Number.isFinite(t) ? t : tempsGlobal + Math.max(0, dt || 0);
    if (origine === null) origine = tempsGlobal - 2.4;
    tempsScene = tempsCapture ?? Math.max(0, (pause ? tempsPause : tempsGlobal) - origine - tempsSoustrait);
    modeEco = Boolean(eco);
    const cycle = tempsScene % (DUREE_DUEL * DUELS.length);
    const duel = Math.floor(cycle / DUREE_DUEL), moment = cycle % DUREE_DUEL;
    const ficheDuel = DUELS[duel];
    if (duel !== ancienDuel) {
      Object.values(personnages).forEach(personnage => { personnage.groupe.visible = false; });
      personnages[ficheDuel[0]].groupe.visible = personnages[ficheDuel[1]].groupe.visible = true;
      ancienDuel = duel;
      ecrire('noms', `${DISTRIBUTION[ficheDuel[0]].nom}  ×  ${DISTRIBUTION[ficheDuel[1]].nom}`);
    }
    const attaques = [ATTAQUES[ficheDuel[2]], ATTAQUES[ficheDuel[3]]];
    const entree = lisser(moment / 1.25), sortie = lisser((22 - moment) / 1.25), apparition = entree * sortie;
    charges[0] = enveloppe(moment, 3.1, 5.3, .5); charges[1] = enveloppe(moment, 10.1, 12.3, .5);
    puissances[0] = enveloppe(moment, 5.0, 7.65, .22); puissances[1] = enveloppe(moment, 12.0, 14.65, .22);
    progressions[0] = borner((moment - 5) / 2.65); progressions[1] = borner((moment - 12) / 2.65);
    const finale = enveloppe(moment, 17.9, 19.3, .28);
    if (moment > 16.9 && moment < 19.4) {
      charges[0] = charges[1] = enveloppe(moment, 16.9, 18.15, .3);
      puissances[0] = puissances[1] = finale;
      progressions[0] = progressions[1] = borner((moment - 17.9) / 1.4);
    }
    const nomGauche = DISTRIBUTION[ficheDuel[0]].nom, nomDroite = DISTRIBUTION[ficheDuel[1]].nom;
    let phase = 'Les combattants se jaugent';
    let acteur = -1;
    if (moment < 2.5) phase = 'Entrée dans l’arène';
    else if (moment >= 3.1 && moment < 5) { phase = `${nomGauche} rassemble son énergie`; acteur = 0; }
    else if (moment >= 5 && moment < 7.8) { phase = `${nomGauche} passe à l’offensive`; acteur = 0; }
    else if (moment >= 10.1 && moment < 12) { phase = `${nomDroite} prépare sa riposte`; acteur = 1; }
    else if (moment >= 12 && moment < 14.8) { phase = `${nomDroite} contre-attaque`; acteur = 1; }
    else if (moment >= 16.9 && moment < 19.5) phase = 'Les deux puissances se rencontrent';
    else if (moment >= 20.3) phase = 'Prochain affrontement';
    const texteAttaque = acteur >= 0 ? `${DISTRIBUTION[ficheDuel[acteur]].nom} · ${attaques[acteur].nom}` : moment >= 16.9 && moment < 19.5 ? `${attaques[0].nom}  ×  ${attaques[1].nom}` : 'Le spectacle continue';
    ecrire('phase', phase); ecrire('attaque', texteAttaque);
    etat = { duel: duel + 1, attaque: acteur >= 0 ? attaques[acteur].nom : finale > 0 ? `${attaques[0].nom} × ${attaques[1].nom}` : '', type: acteur >= 0 ? attaques[acteur].type : finale > 0 ? 'duo' : '', phase, pokemon: [DISTRIBUTION[ficheDuel[0]].nom, DISTRIBUTION[ficheDuel[1]].nom] };

    for (let cote = 0; cote < 2; cote++) {
      const personnage = personnages[ficheDuel[cote]], ennemi = 1 - cote, sens = cote === 0 ? 1 : -1;
      const frappe = puissances[cote], reception = puissances[ennemi] * lisser((progressions[ennemi] - .2) / .18);
      const esquive = enveloppe(moment, cote === 0 ? 12.4 : 5.4, cote === 0 ? 13.1 : 6.1, .18);
      const course = attaques[cote].type === 'pied' || attaques[cote].type === 'dragon' ? .83 : .19;
      personnage.groupe.position.set(-sens * 1.62 + sens * frappe * course - sens * reception * .21, .351 + (personnage.fiche.flotte || 0), -.04 + esquive * .34 * sens);
      if (personnage.fiche.flotte) personnage.groupe.position.y += Math.sin(tempsScene * 2.4 + cote) * .075;
      if (attaques[cote].type === 'dragon') personnage.groupe.position.y += frappe * .25;
      personnage.groupe.rotation.set(0, sens * Math.PI / 2, -sens * reception * .13 + sens * frappe * .05);
      personnage.groupe.scale.setScalar(Math.max(.001, apparition));
      personnage.pose.attaque = frappe;
      personnage.pose.impact = reception;
      personnage.pose.energie = charges[cote];
      personnage.animer(tempsScene, personnage.pose);
      ombres[cote].position.x = personnage.groupe.position.x; ombres[cote].position.z = personnage.groupe.position.z;
      ombres[cote].material.opacity = apparition * (personnage.fiche.flotte ? .17 : .30);
      auras[cote].position.x = personnage.groupe.position.x; auras[cote].position.z = personnage.groupe.position.z;
      auras[cote].material.color.setHex(attaques[cote].couleur);
      auras[cote].material.opacity = apparition * (.12 + charges[cote] * .65 + frappe * .24);
      auras[cote].scale.setScalar(.64 + charges[cote] * .20 + Math.sin(tempsScene * 3 + cote) * .025);
      if (personnage.origineAttaque?.isObject3D) {
        personnage.origineAttaque.getWorldPosition(departs[cote]);
        racine.worldToLocal(departs[cote]);
      } else {
        departs[cote].set(personnage.groupe.position.x + sens * .39, personnage.groupe.position.y + personnage.fiche.bouche * personnage.hauteurEffective / 2.3, personnage.groupe.position.z);
      }
    }
    for (let cote = 0; cote < 2; cote++) {
      const ciblePersonnage = personnages[ficheDuel[1 - cote]];
      cibles[cote].set(ciblePersonnage.groupe.position.x, ciblePersonnage.groupe.position.y + 1.04, ciblePersonnage.groupe.position.z);
      if (finale > 0) cibles[cote].set(0, 1.66, 0);
      appliquerEffet(THREE, effets[cote], attaques[cote], puissances[cote], charges[cote], progressions[cote], tempsScene, departs[cote], cibles[cote], modeEco);
      lumiere[cote].position.copy(cibles[cote]);
      lumiere[cote].color.setHex(attaques[cote].couleur);
      lumiere[cote].intensity = modeEco ? 0 : puissances[cote] * 2.4 + charges[cote] * .75;
      if (puissances[cote] > .2) notifierAttaque(duel, cote, attaques[cote], finale > 0);
    }
    decor.cercleTransition.scale.setScalar(.7 + (1 - apparition) * 2.9);
    decor.cercleTransition.material.opacity = (1 - apparition) * .7 + finale * .21;
    decor.cercleTransition.rotation.z = tempsScene * .12;

    const actif = Math.max(...puissances, ...charges) > .01;
    particules.nuage.visible = actif;
    if (actif) {
      const nombre = modeEco ? 96 : particules.nombre;
      particules.nuage.geometry.setDrawRange(0, nombre);
      const taille = renderer.getSize ? renderer.getSize(tailleRendu) : { y: 720 };
      particules.materiau.uniforms.definition.value = Math.min(1600, taille.y);
      for (let i = 0; i < nombre; i++) {
        const cote = i % 2;
        const p = (tempsScene * (attaques[cote].type === 'feu' ? 1.8 : 1.35) + i * .6180339) % 1;
        const vitesse = (i * .754877666) % 1;
        const angle = i * 2.399963 + tempsScene * .65;
        const amplitude = (puissances[cote] > .01 ? .10 + p * .25 : .18 + p * .28) * (i % 7 === 0 ? 1.5 : 1);
        const voyage = puissances[cote] > .01 ? p : .04;
        const debut = departs[cote], fin = cibles[cote];
        const curseur = i * 3;
        particules.positions[curseur] = debut.x + (fin.x - debut.x) * voyage + Math.cos(angle) * amplitude;
        particules.positions[curseur + 1] = debut.y + (fin.y - debut.y) * voyage + Math.sin(angle) * amplitude + p * vitesse * .20;
        particules.positions[curseur + 2] = debut.z + (fin.z - debut.z) * voyage + Math.sin(angle * 1.3) * amplitude;
        const couleur = effets[cote].matHalo.color;
        const visibilite = Math.max(puissances[cote], charges[cote]) * (1 - p * .75);
        particules.couleurs[curseur] = couleur.r * visibilite;
        particules.couleurs[curseur + 1] = couleur.g * visibilite;
        particules.couleurs[curseur + 2] = couleur.b * visibilite;
      }
      particules.nuage.geometry.attributes.position.needsUpdate = true;
      particules.nuage.geometry.attributes.color.needsUpdate = true;
    }
  }

  function diagnostics() {
    let maillagesVisibles = 0, trianglesModeles = 0;
    const visibles = Object.values(personnages).filter(personnage => personnage.groupe.visible);
    visibles.forEach(personnage => personnage.groupe.traverseVisible(objet => {
      if (!objet.isMesh) return;
      maillagesVisibles++;
      trianglesModeles += (objet.geometry.index ? objet.geometry.index.count : objet.geometry.attributes.position.count) / 3 * (objet.isInstancedMesh ? objet.count : 1);
    }));
    return { ...etat, temps: Number(tempsScene.toFixed(2)), dureeBoucle: DUREE_DUEL * DUELS.length, pause, capture: tempsCapture !== null, eco: modeEco,
      personnagesVisibles: visibles.length, maillagesModelesVisibles: maillagesVisibles, trianglesModeles: Math.round(trianglesModeles), lumiereLocale: modeEco ? 0 : 2,
      appelsRendu: renderer.info?.render?.calls || 0, trianglesRendus: renderer.info?.render?.triangles || 0,
      ressourcesGeometries: renderer.info?.memory?.geometries || 0, ressourcesTextures: renderer.info?.memory?.textures || 0 };
  }
  const diagnosticPublic = Object.freeze({ diagnostics });
  window.__PIKA_ARENE = diagnosticPublic;

  function dispose() {
    if (detruit) return;
    detruit = true;
    hud.pause?.removeEventListener('click', basculerPause);
    racine.removeFromParent();
    const geometries = new Set(), materiaux = new Set(), textures = new Set();
    racine.traverse(objet => {
      if (objet.geometry) geometries.add(objet.geometry);
      if (objet.material) (Array.isArray(objet.material) ? objet.material : [objet.material]).forEach(materiau => {
        materiaux.add(materiau);
        for (const valeur of Object.values(materiau)) if (valeur?.isTexture) textures.add(valeur);
      });
    });
    geometries.forEach(geometrie => geometrie.dispose());
    materiaux.forEach(materiau => materiau.dispose());
    textures.forEach(texture => texture.dispose());
    if (window.__PIKA_ARENE === diagnosticPublic) delete window.__PIKA_ARENE;
  }
  return { update, dispose, diagnostics };
}
