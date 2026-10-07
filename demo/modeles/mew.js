/** Mew : volumes félins lisses, yeux incrustés et queue souple à squelette. */
export function creerMew(THREE) {
  const racine=new THREE.Group();racine.name='Mew';
  const corps=new THREE.Group();racine.add(corps);
  const rose=new THREE.MeshStandardMaterial({color:0xf3bacd,roughness:.4,metalness:.015});
  const doux=new THREE.MeshStandardMaterial({color:0xffd4df,roughness:.42});
  const oreilleRose=new THREE.MeshStandardMaterial({color:0xcf869f,roughness:.58});
  const blanc=new THREE.MeshStandardMaterial({color:0xfff9ff,roughness:.19});
  const bleu=new THREE.MeshStandardMaterial({color:0x337fc5,roughness:.21,emissive:0x214b96,emissiveIntensity:.2});
  const pupil=new THREE.MeshStandardMaterial({color:0x101b38,roughness:.28});
  const ajouter=(g,mat,parent=corps)=>{const m=new THREE.Mesh(g,mat);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;};
  function ellipsoide(x,y,z,rx,ry,rz,mat,parent=corps) {
    const g=new THREE.SphereGeometry(1,28,20);g.scale(rx,ry,rz);const m=ajouter(g,mat,parent);m.position.set(x,y,z);return m;
  }
  function fuseau(a,b,r,prof,parent,mat=rose) {
    const debut=new THREE.Vector3(...a),d=new THREE.Vector3(...b).sub(debut),l=d.length();
    const points=[[0,0],[.68,l*.035],[.9,l*.16],[1,l*.45],[.78,l*.77],[.5,l*.96],[0,l]].map(([v,y])=>new THREE.Vector2(v*r,y));
    const g=new THREE.LatheGeometry(points,24);g.scale(1,1,prof/r);const m=ajouter(g,mat,parent);m.position.copy(debut);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());return m;
  }
  const bassin=new THREE.Group();bassin.position.set(0,.8,0);corps.add(bassin);
  const profil=[[0,-.31],[.19,-.27],[.27,-.14],[.265,.06],[.2,.27],[.125,.34],[0,.36]].map(([r,y])=>new THREE.Vector2(r,y));
  const torse=new THREE.LatheGeometry(profil,32);torse.scale(1,1,.72);ajouter(torse,rose,bassin);
  ellipsoide(0,-.04,.115,.176,.215,.091,doux,bassin);
  fuseau([0,.23,0],[0,.42,.018],.105,.09,bassin);
  const tete=new THREE.Group();tete.position.set(0,1.28,.02);corps.add(tete);
  const origineAttaque=new THREE.Object3D();origineAttaque.name='origine-attaque-psy';origineAttaque.position.set(0,.075,.33);tete.add(origineAttaque);
  // La tête est taillée en poire féline, les joues se resserrent vers le museau.
  const crane=new THREE.SphereGeometry(1,36,24),p=crane.attributes.position;
  for(let i=0;i<p.count;i++){const y=p.getY(i),z=p.getZ(i);p.setXYZ(i,p.getX(i)*(.34-.075*Math.max(0,-y)),y*.31,z*.253+Math.max(0,-y)*.015);}
  crane.computeVertexNormals();ajouter(crane,rose,tete);
  ellipsoide(0,-.095,.231,.116,.076,.055,doux,tete);
  const oreilles=[];
  for(const s of [-1,1]) {
    const oreille=new THREE.Group();oreille.position.set(s*.225,.202,-.027);oreille.rotation.z=-s*.21;tete.add(oreille);oreilles.push(oreille);
    // Coque bombée à six anneaux, plutôt qu'un triangle plaqué.
    const contour=[[0,0],[.102,.035],[.085,.145],[.042,.236],[0,.268]].map(([r,y])=>new THREE.Vector2(r,y));
    const go=new THREE.LatheGeometry(contour,22);go.scale(1,1,.53);ajouter(go,rose,oreille);
    const f=new THREE.Shape();f.moveTo(-.059,.055);f.quadraticCurveTo(-.055,.15,0,.211);f.quadraticCurveTo(.055,.15,.059,.055);f.quadraticCurveTo(0,.031,-.059,.055);
    ajouter(new THREE.ShapeGeometry(f,16),oreilleRose,oreille).position.z=.047;
  }
  for(const s of [-1,1]) {
    const oeil=new THREE.Group();oeil.position.set(s*.152,-.005,.224);oeil.rotation.y=s*.27;oeil.rotation.z=-s*.09;tete.add(oeil);
    const f=new THREE.Shape();f.moveTo(-.095,-.058);f.bezierCurveTo(-.113,.025,-.078,.105,-.012,.108);f.bezierCurveTo(.075,.107,.116,.033,.082,-.066);f.quadraticCurveTo(0,-.106,-.095,-.058);
    ajouter(new THREE.ShapeGeometry(f,20),blanc,oeil);
    ellipsoide(s*.009,-.002,.009,.060,.079,.015,bleu,oeil);
    ellipsoide(s*.009,-.005,.021,.025,.053,.009,pupil,oeil);
    ellipsoide(-.014,.032,.032,.017,.024,.007,blanc,oeil);
    ellipsoide(.026,-.032,.031,.008,.011,.005,blanc,oeil);
  }
  ellipsoide(0,-.095,.287,.02,.012,.011,rose,tete);
  const sourire=new THREE.QuadraticBezierCurve3(new THREE.Vector3(-.044,-.143,.265),new THREE.Vector3(0,-.169,.276),new THREE.Vector3(.044,-.143,.265));
  ajouter(new THREE.TubeGeometry(sourire,14,.0048,6,false),oreilleRose,tete);
  const bras=[];
  for(const s of [-1,1]) {
    const b=new THREE.Group();b.position.set(s*.19,.195,.022);bassin.add(b);bras.push(b);
    fuseau([0,0,0],[s*.067,-.235,.02],.066,.069,b);
    const main=new THREE.Group();main.position.set(s*.067,-.234,.023);b.add(main);
    ellipsoide(0,0,0,.065,.085,.056,rose,main);
    for(let i=-1;i<=1;i++)fuseau([i*.029,-.03,.018],[i*.029,-.087,.036],.019,.019,main,doux);
  }
  const jambes=[];
  for(const s of [-1,1]) {
    const j=new THREE.Group();j.position.set(s*.155,.66,-.026);corps.add(j);jambes.push(j);
    fuseau([0,0,0],[s*.073,-.28,-.025],.105,.112,j);
    const pied=new THREE.Group();pied.position.set(s*.074,-.275,.016);j.add(pied);
    ellipsoide(0,-.067,.115,.105,.127,.228,rose,pied);
    for(let i=-1;i<=1;i++)fuseau([i*.044,-.065,.23],[i*.047,-.079,.303],.026,.026,pied,doux);
  }
  const chemin=new THREE.CatmullRomCurve3([new THREE.Vector3(0,.71,-.18),new THREE.Vector3(.28,.55,-.36),new THREE.Vector3(.73,.5,-.39),new THREE.Vector3(.99,.83,-.21),new THREE.Vector3(.84,1.2,-.06),new THREE.Vector3(.64,1.49,-.1),new THREE.Vector3(.76,1.72,-.11)]);
  const n=72,cotes=10,nbOs=14,g=new THREE.TubeGeometry(chemin,n,.044,cotes,false),gp=g.attributes.position;
  for(let a=0;a<=n;a++){const u=a/n,c=chemin.getPointAt(u),r=.92-.58*u;for(let j=0;j<=cotes;j++){const k=a*(cotes+1)+j;gp.setXYZ(k,c.x+(gp.getX(k)-c.x)*r,c.y+(gp.getY(k)-c.y)*r,c.z+(gp.getZ(k)-c.z)*r);}}
  g.computeVertexNormals();
  const os=[],indices=[],poids=[];
  for(let i=0;i<=nbOs;i++){const o=new THREE.Bone();o.position.copy(chemin.getPointAt(i/nbOs));if(i){o.position.sub(chemin.getPointAt((i-1)/nbOs));os[i-1].add(o);}os.push(o);}
  for(let a=0;a<=n;a++){const v=a/n*nbOs,k=Math.min(nbOs-1,Math.floor(v)),f=Math.min(1,v-k);for(let j=0;j<=cotes;j++){indices.push(k,k+1,0,0);poids.push(1-f,f,0,0);}}
  g.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(indices,4));g.setAttribute('skinWeight',new THREE.Float32BufferAttribute(poids,4));
  const queue=new THREE.SkinnedMesh(g,rose);queue.add(os[0]);queue.bind(new THREE.Skeleton(os));queue.castShadow=true;queue.receiveShadow=true;queue.frustumCulled=false;corps.add(queue);
  ellipsoide(0,0,0,.061,.106,.061,rose,os[nbOs]);
  function animer(t,pose={}) {
    const a=Math.max(0,Math.min(1,pose.attaque||0)),c=Math.max(0,Math.min(1,pose.impact||0));
    corps.position.y=.15+Math.sin(t*1.7)*.115+a*.15;corps.position.z=Math.sin(t*.9)*.045;
    corps.rotation.z=Math.sin(t*1.15)*.055+c*.14;corps.rotation.x=-a*.16+c*.15;
    tete.rotation.y=Math.sin(t*.79)*.17;tete.rotation.x=Math.sin(t*1.23)*.048-a*.1;
    bassin.scale.set(1,1+Math.sin(t*2.2)*.018,1+Math.sin(t*2.2)*.025);
    bras.forEach((b,i)=>{const s=i?1:-1;b.rotation.z=s*(.12+a*1.06+Math.sin(t*1.9+i)*.04);b.rotation.x=-a*.63;});
    jambes.forEach((j,i)=>{j.rotation.x=.13+Math.sin(t*1.35+i*1.7)*.055+a*.13;j.rotation.z=(i?1:-1)*.08;});
    oreilles.forEach((o,i)=>{o.rotation.z=(i?1:-1)*(-.21+Math.sin(t*2.1+i)*.018);});
    for(let i=1;i<os.length;i++){os[i].rotation.z=Math.sin(t*1.9-i*.42)*.022;os[i].rotation.x=Math.cos(t*1.13-i*.35)*.016;}
    bleu.emissiveIntensity=.2+(pose.energie||0)*.9+a*.3;
  }
  animer(0);return {racine,hauteur:1.98,animer,origineAttaque};
}
