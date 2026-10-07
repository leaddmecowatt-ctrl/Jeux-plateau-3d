/** Mewtwo : sculpture originale articulée, sans modèle ni texture provenant d'un jeu. */
export function creerMewtwo(THREE) {
  const racine = new THREE.Group();
  racine.name = 'Mewtwo';
  const corps = new THREE.Group();
  racine.add(corps);
  const peau = new THREE.MeshStandardMaterial({color: 0xc9c7df, roughness: .37, metalness: .025});
  const clair = new THREE.MeshStandardMaterial({color: 0xdddbea, roughness: .4});
  const violet = new THREE.MeshStandardMaterial({color: 0x83509d, roughness: .32, metalness: .045});
  const iris = new THREE.MeshStandardMaterial({color: 0xa668ed, roughness: .2, emissive: 0x6626b2, emissiveIntensity: .38});
  const noir = new THREE.MeshStandardMaterial({color: 0x110d23, roughness: .35});
  const blanc = new THREE.MeshStandardMaterial({color: 0xf8efff, roughness: .15});
  const ajouter = (g, mat, parent = corps) => {
    const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
  };
  // Profils tournés : les renflements des muscles sont modelés dans la géométrie.
  function volume(profil, largeur, profondeur, parent, mat = peau) {
    const g = new THREE.LatheGeometry(profil.map(([r,y]) => new THREE.Vector2(r,y)), 28);
    g.scale(largeur, 1, profondeur); g.computeVertexNormals();
    return ajouter(g, mat, parent);
  }
  function ellipsoide(x,y,z,rx,ry,rz,mat,parent = corps) {
    const g = new THREE.SphereGeometry(1, 24, 16); g.scale(rx,ry,rz);
    const m = ajouter(g,mat,parent); m.position.set(x,y,z); return m;
  }
  function muscle(debut,fin,rayon,profondeur,parent,mat = peau) {
    const a = new THREE.Vector3(...debut), b = new THREE.Vector3(...fin), d = b.clone().sub(a), l = d.length();
    const m = volume([[0,0],[.55,.025*l],[.86,.12*l],[1,.35*l],[.86,.63*l],[.57,.88*l],[0,l]],rayon,profondeur,parent,mat);
    m.position.copy(a); m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize()); return m;
  }
  const buste = new THREE.Group(); buste.position.y = 1.38; corps.add(buste);
  const tronc = volume([[0,0],[.28,.05],[.35,.19],[.32,.4],[.36,.7],[.48,.93],[.43,1.04],[.23,1.12],[0,1.14]],1,.77,buste);
  // L'avant du ventre et les pectoraux restent continus et lisses.
  ellipsoide(0,.3,.23,.25,.32,.155,violet,buste);
  muscle([-.15,.88,.15],[.15,.88,.15],.15,.18,buste,clair);
  muscle([0,1.02,0],[0,1.39,.02],.16,.17,buste);
  const tete = new THREE.Group(); tete.position.set(0,1.4,.015); buste.add(tete);
  const crane = new THREE.SphereGeometry(1,32,24);
  const cp = crane.attributes.position;
  for(let i=0;i<cp.count;i++) {
    const y = cp.getY(i), z = cp.getZ(i);
    cp.setXYZ(i,cp.getX(i)*(.335-.075*Math.max(0,-y)),y*.36,z*.29 + Math.max(0,-y)*.045);
  }
  crane.computeVertexNormals(); ajouter(crane,peau,tete).position.y = .1;
  // Museau félin court, arcade basse et deux pointes inclinées.
  ellipsoide(0,-.045,.245,.145,.094,.104,clair,tete);
  muscle([-.265,.22,-.025],[-.265,.53,-.075],.092,.083,tete);
  muscle([.265,.22,-.025],[.265,.53,-.075],.092,.083,tete);
  function oeil(signe) {
    const groupe = new THREE.Group(); groupe.position.set(signe*.175,.085,.262); groupe.rotation.y = signe*.34; tete.add(groupe);
    const forme = new THREE.Shape(); forme.moveTo(-.118,.045); forme.quadraticCurveTo(0,.068,.118,.005); forme.quadraticCurveTo(.02,-.08,-.1,-.022); forme.closePath();
    const blancOeil = ajouter(new THREE.ShapeGeometry(forme,16),blanc,groupe); blancOeil.rotation.z = -signe*.13;
    ellipsoide(signe*.01,-.007,.004,.043,.052,.014,iris,groupe);
    ellipsoide(signe*.01,-.01,.015,.014,.041,.008,noir,groupe);
    ellipsoide(signe*.024,.014,.024,.009,.011,.006,blanc,groupe);
    muscle([-.115,.047,.014],[.109,.012,.014],.015,.015,groupe,peau);
  }
  oeil(-1); oeil(1);
  ellipsoide(0,-.018,.343,.035,.018,.013,peau,tete);
  const bouche = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-.064,-.087,.33),new THREE.Vector3(0,-.112,.342),new THREE.Vector3(.064,-.087,.33));
  ajouter(new THREE.TubeGeometry(bouche,16,.006,6,false),violet,tete);
  // Tube organique caractéristique reliant l'occiput au haut du dos.
  const liaison = new THREE.CatmullRomCurve3([new THREE.Vector3(0,2.99,-.21),new THREE.Vector3(0,2.95,-.38),new THREE.Vector3(0,2.65,-.42),new THREE.Vector3(0,2.39,-.235)]);
  ajouter(new THREE.TubeGeometry(liaison,28,.086,12,false),peau);
  const bras = [];
  const origineAttaque = new THREE.Object3D();
  origineAttaque.name = 'origine-attaque-psy';
  for(const s of [-1,1]) {
    const epaule = new THREE.Group(); epaule.position.set(s*.43,.93,.015); buste.add(epaule); bras.push(epaule);
    muscle([0,0,0],[s*.19,-.4,.025],.17,.153,epaule);
    const coude = new THREE.Group(); coude.position.set(s*.19,-.4,.025); epaule.add(coude);
    muscle([0,0,0],[s*.075,-.38,.145],.125,.123,coude);
    const main = new THREE.Group(); main.position.set(s*.075,-.42,.145); coude.add(main);
    if(s===1){origineAttaque.position.set(0,-.035,.115);main.add(origineAttaque);}
    ellipsoide(0,0,0,.135,.16,.092,peau,main);
    for(const [dx,dy,dz] of [[s*.1,-.075,.015],[s*.025,-.13,.045],[-s*.067,-.095,.033]]) {
      muscle([dx*.35,-.02,0],[dx,dy,dz],.037,.04,main);
      ellipsoide(dx,dy-.045,dz,.059,.065,.055,clair,main);
    }
    epaule.userData.coude = coude;
  }
  const jambes = [];
  for(const s of [-1,1]) {
    const hanche = new THREE.Group(); hanche.position.set(s*.3,1.46,-.025); corps.add(hanche); jambes.push(hanche);
    muscle([0,0,0],[s*.17,-.68,.045],.28,.245,hanche);
    const genou = new THREE.Group(); genou.position.set(s*.17,-.68,.045); hanche.add(genou);
    muscle([0,0,0],[-s*.045,-.43,-.09],.13,.123,genou);
    muscle([-s*.045,-.43,-.09],[-s*.018,-.57,.095],.11,.103,genou);
    const pied = new THREE.Group(); pied.position.set(-s*.018,-.56,.1); genou.add(pied);
    ellipsoide(0,-.068,.09,.17,.11,.235,peau,pied);
    for(let j=-1;j<=1;j++) muscle([j*.098,-.074,.1],[j*.115,-.082,.34-Math.abs(j)*.035],.054,.055,pied,clair);
  }
  // Queue en vraie géométrie déformable : aucun maillage n'est recréé par image.
  const chemin = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0,1.54,-.27),new THREE.Vector3(-.28,1.17,-.66),new THREE.Vector3(-.9,.69,-.71),
    new THREE.Vector3(-1.38,.78,-.32),new THREE.Vector3(-1.55,1.42,.015),new THREE.Vector3(-1.28,1.95,.06),new THREE.Vector3(-.96,2.02,-.06)
  ]);
  const anneaux=72,cotes=12,segments=12,rayon=.155;
  const gq = new THREE.TubeGeometry(chemin,anneaux,rayon,cotes,false), pq=gq.attributes.position;
  for(let a=0;a<=anneaux;a++) {
    const u=a/anneaux, centre=chemin.getPointAt(u), r=(.85+.2*Math.sin(u*Math.PI))*Math.pow(1-u,.52)+.025;
    for(let j=0;j<=cotes;j++) {const i=a*(cotes+1)+j; pq.setXYZ(i,centre.x+(pq.getX(i)-centre.x)*r,centre.y+(pq.getY(i)-centre.y)*r,centre.z+(pq.getZ(i)-centre.z)*r);}
  }
  gq.computeVertexNormals();
  const indices=[],poids=[],os=[];
  for(let i=0;i<=segments;i++) {const o=new THREE.Bone(),p=chemin.getPointAt(i/segments); o.position.copy(p); if(i){o.position.sub(chemin.getPointAt((i-1)/segments));os[i-1].add(o);} os.push(o);}
  for(let a=0;a<=anneaux;a++) {const f=a/anneaux*segments,k=Math.min(segments-1,Math.floor(f)),v=Math.min(1,f-k); for(let j=0;j<=cotes;j++){indices.push(k,k+1,0,0);poids.push(1-v,v,0,0);}}
  gq.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(indices,4));gq.setAttribute('skinWeight',new THREE.Float32BufferAttribute(poids,4));
  const queue = new THREE.SkinnedMesh(gq,violet);queue.add(os[0]);queue.bind(new THREE.Skeleton(os));queue.castShadow=true;queue.receiveShadow=true;queue.frustumCulled=false;corps.add(queue);
  const hauteur=3.35;
  function animer(t,pose={}) {
    const a=Math.max(0,Math.min(1,pose.attaque||0)),c=Math.max(0,Math.min(1,pose.impact||0));
    corps.position.y=.055+Math.sin(t*1.8)*.055+a*.19;
    corps.rotation.x=-c*.12;corps.rotation.z=Math.sin(t*2.1)*.012+c*.07;
    buste.rotation.y=Math.sin(t*.63)*.055-a*.12;
    buste.scale.set(1,1+Math.sin(t*1.9)*.013,1+Math.sin(t*1.9)*.018);
    tete.rotation.y=Math.sin(t*.72)*.1;tete.rotation.x=Math.sin(t*1.13)*.025-a*.1+c*.12;
    bras.forEach((b,i)=>{const s=i?1:-1;b.rotation.z=s*(.04+a*.82+Math.sin(t*1.7+i)*.025);b.rotation.x=-a*.88+c*.3;b.userData.coude.rotation.x=-.12-a*.52;});
    jambes.forEach((j,i)=>{j.rotation.x=Math.sin(t*1.25+i*Math.PI)*.026+a*.04;j.rotation.z=(i?1:-1)*a*.055;});
    for(let i=1;i<os.length;i++){os[i].rotation.z=Math.sin(t*1.3-i*.45)*(.017+i*.001);os[i].rotation.x=Math.sin(t*.86-i*.33)*.018+a*.01;}
    iris.emissiveIntensity=.38+(pose.energie||0)*1.25+a*.7;
  }
  animer(0);
  return {racine,hauteur,animer,origineAttaque};
}
