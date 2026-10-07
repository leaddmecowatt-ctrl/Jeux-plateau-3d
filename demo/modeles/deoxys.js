/** Deoxys forme normale : cuirasse organique sculptée et quatre tentacules hélicoïdales. */
export function creerDeoxys(THREE) {
  const racine=new THREE.Group();racine.name='Deoxys';const corps=new THREE.Group();racine.add(corps);
  const orange=new THREE.MeshStandardMaterial({color:0xde7040,roughness:.32,metalness:.1});
  const clair=new THREE.MeshStandardMaterial({color:0xf99554,roughness:.35,metalness:.06});
  const bleu=new THREE.MeshStandardMaterial({color:0x3b9eae,roughness:.29,metalness:.1});
  const sombre=new THREE.MeshStandardMaterial({color:0x285f73,roughness:.42,metalness:.08});
  const violet=new THREE.MeshStandardMaterial({color:0xa77bce,roughness:.14,metalness:.2,emissive:0x6c32a2,emissiveIntensity:.5});
  const blanc=new THREE.MeshStandardMaterial({color:0xd5fff6,roughness:.17,emissive:0x67dcca,emissiveIntensity:.25});
  const noir=new THREE.MeshStandardMaterial({color:0x112931,roughness:.38});
  const ajouter=(g,mat,parent=corps)=>{const m=new THREE.Mesh(g,mat);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;};
  function galet(x,y,z,rx,ry,rz,mat,parent=corps) {const g=new THREE.SphereGeometry(1,26,18);g.scale(rx,ry,rz);const m=ajouter(g,mat,parent);m.position.set(x,y,z);return m;}
  function fuseau(a,b,r,prof,parent,mat=orange) {
    const p=new THREE.Vector3(...a),d=new THREE.Vector3(...b).sub(p),l=d.length();
    const profil=[[0,0],[.64,.045*l],[1,.18*l],[.93,.58*l],[.65,.91*l],[0,l]].map(([v,y])=>new THREE.Vector2(v*r,y));
    const g=new THREE.LatheGeometry(profil,24);g.scale(1,1,prof/r);const m=ajouter(g,mat,parent);m.position.copy(p);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());return m;
  }
  // Coques à contour angulaire et section bombée : les arêtes dessinées suivent l'anatomie.
  function coque(contour,profondeur,mat,parent=corps) {
    const f=new THREE.Shape();contour.forEach(([x,y],i)=>i?f.lineTo(x,y):f.moveTo(x,y));f.closePath();
    const g=new THREE.ExtrudeGeometry(f,{depth:profondeur,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:.04,bevelThickness:.035,curveSegments:8});
    g.translate(0,0,-profondeur*.5);g.computeVertexNormals();return ajouter(g,mat,parent);
  }
  const buste=new THREE.Group();buste.position.y=1.64;corps.add(buste);
  fuseau([0,-.08,0],[0,.96,0],.36,.23,buste);
  const thorax=coque([[-.24,.2],[-.49,.76],[-.4,.91],[-.19,.98],[0,.86],[.19,.98],[.4,.91],[.49,.76],[.24,.2],[0,.02]],.33,orange,buste);
  thorax.position.z=.07;
  const poitrine=coque([[-.22,.57],[-.08,.82],[.08,.82],[.22,.57],[.14,.37],[-.14,.37]],.105,sombre,buste);poitrine.position.z=.247;
  // Le cristal mauve demeure facetté ; son socle est séparé de la cuirasse.
  const cristal=ajouter(new THREE.OctahedronGeometry(.174,0),violet,buste);cristal.position.set(0,.6,.348);cristal.scale.set(.78,1.12,.57);cristal.rotation.z=Math.PI/4;
  const origineAttaque=new THREE.Object3D();origineAttaque.name='origine-attaque-cristal';origineAttaque.position.set(0,0,.235);cristal.add(origineAttaque);
  const liseres=[];
  for(const s of [-1,1]) {
    const bord=coque([[s*.235,.42],[s*.32,.7],[s*.37,.79],[s*.41,.74],[s*.3,.42]],.037,clair,buste);bord.position.z=.257;liseres.push(bord);
    fuseau([s*.14,.11,.08],[s*.115,-.13,.04],.107,.085,buste,bleu);
  }
  const tete=new THREE.Group();tete.position.set(0,2.97,-.01);corps.add(tete);
  const teteOrange=coque([[-.11,-.25],[-.29,-.055],[-.23,.32],[-.13,.43],[.13,.43],[.23,.32],[.29,-.055],[.11,-.25]],.27,orange,tete);
  teteOrange.position.z=-.025;
  const masque=coque([[-.112,-.23],[-.225,-.015],[-.145,.185],[0,.305],[.145,.185],[.225,-.015],[.112,-.23],[0,-.28]],.055,bleu,tete);masque.position.z=.156;
  const front=coque([[-.073,.075],[0,.252],[.073,.075],[0,-.1]],.024,sombre,tete);front.position.z=.199;
  for(const s of [-1,1]) {
    const f=new THREE.Shape();f.moveTo(s*.04,.027);f.lineTo(s*.192,.078);f.quadraticCurveTo(s*.185,-.048,s*.085,-.041);f.closePath();
    const oeil=ajouter(new THREE.ShapeGeometry(f),blanc,tete);oeil.position.z=.209;
    galet(s*.111,.001,.219,.022,.047,.006,noir,tete);
    // Les pointes latérales du crâne poussent vers l'arrière.
    fuseau([s*.204,.19,-.018],[s*.39,.38,-.135],.085,.073,tete);
  }
  fuseau([0,2.51,-.01],[0,2.74,-.005],.124,.103,corps,bleu);
  const jambes=[];
  for(const s of [-1,1]) {
    const j=new THREE.Group();j.position.set(s*.145,1.7,.005);corps.add(j);jambes.push(j);
    fuseau([0,0,0],[s*.095,-.52,.002],.138,.12,j);
    const genou=new THREE.Group();genou.position.set(s*.095,-.52,.002);j.add(genou);
    galet(0,0,.001,.132,.14,.118,bleu,genou);
    fuseau([0,-.018,0],[s*.12,-.68,-.01],.143,.123,genou);
    const plaque=coque([[-.09,-.06],[-.127,-.31],[-.082,-.62],[.092,-.65],[.12,-.25],[.068,-.045]],.06,clair,genou);plaque.position.z=.103;plaque.rotation.z=-s*.095;
    const pied=new THREE.Group();pied.position.set(s*.12,-.69,.01);genou.add(pied);
    fuseau([0,0,-.01],[s*.095,-.255,.11],.15,.156,pied);
    const pointe=coque([[-.12,-.19],[-.15,-.29],[.17,-.29],[.105,-.12]],.235,orange,pied);pointe.position.z=.067;
    j.userData.genou=genou;
  }
  const bras=[],tentacules=[];
  for(const s of [-1,1]) {
    const bras=new THREE.Group();bras.position.set(s*.405,2.44,.008);corps.add(bras);
    fuseau([0,0,0],[s*.16,-.18,-.012],.145,.13,bras,orange);
    for(let fil=0;fil<2;fil++) {
      // Deux brins entrelacés, orange et turquoise, prolongent chaque épaule.
      const pts=[];
      for(let k=0;k<=16;k++) {const u=k/16,angle=u*Math.PI*3.5+fil*Math.PI,r=.11*Math.sin(Math.PI*Math.min(1,u*1.6))+.032;pts.push(new THREE.Vector3(s*(.17+.14*u+Math.sin(angle)*r),-.17-u*1.12,Math.cos(angle)*r));}
      const courbe=new THREE.CatmullRomCurve3(pts),n=64,cotes=10,nb=12;
      const g=new THREE.TubeGeometry(courbe,n,.067,cotes,false),p=g.attributes.position;
      for(let a=0;a<=n;a++){const u=a/n,c=courbe.getPointAt(u),r=.88-.38*u;for(let k=0;k<=cotes;k++){const i=a*(cotes+1)+k;p.setXYZ(i,c.x+(p.getX(i)-c.x)*r,c.y+(p.getY(i)-c.y)*r,c.z+(p.getZ(i)-c.z)*r);}}
      g.computeVertexNormals();
      const os=[],indices=[],poids=[];
      for(let k=0;k<=nb;k++){const o=new THREE.Bone();o.position.copy(courbe.getPointAt(k/nb));if(k){o.position.sub(courbe.getPointAt((k-1)/nb));os[k-1].add(o);}os.push(o);}
      for(let a=0;a<=n;a++){const v=a/n*nb,k=Math.min(nb-1,Math.floor(v)),f=Math.min(1,v-k);for(let j=0;j<=cotes;j++){indices.push(k,k+1,0,0);poids.push(1-f,f,0,0);}}
      g.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(indices,4));g.setAttribute('skinWeight',new THREE.Float32BufferAttribute(poids,4));
      const m=new THREE.SkinnedMesh(g,fil?bleu:orange);m.add(os[0]);m.bind(new THREE.Skeleton(os));m.castShadow=true;m.receiveShadow=true;m.frustumCulled=false;bras.add(m);
      galet(0,0,0,.048,.062,.048,fil?bleu:orange,os[nb]);
      tentacules.push({os,s,fil});
    }
    // Le groupe de bras est conservé séparément des quatre chaînes de déformation.
    corps.userData['bras'+s]=bras;
  }
  function animer(t,pose={}) {
    const a=Math.max(0,Math.min(1,pose.attaque||0)),c=Math.max(0,Math.min(1,pose.impact||0));
    corps.position.y=.08+Math.sin(t*1.6)*.085+a*.19;corps.rotation.x=-c*.14;corps.rotation.z=Math.sin(t*.83)*.018+c*.08;
    tete.rotation.y=Math.sin(t*.63)*.12;tete.rotation.x=-a*.12+Math.sin(t*1.25)*.018;
    buste.rotation.y=Math.sin(t*.85)*.05;
    for(const s of [-1,1]){const b=corps.userData['bras'+s];b.rotation.z=s*(Math.sin(t*.95+s)*.055+a*1.05);b.rotation.x=-a*.74;}
    for(const {os,s,fil} of tentacules)for(let i=1;i<os.length;i++){os[i].rotation.z=Math.sin(t*1.6-i*.35+fil*Math.PI)*.025+s*a*.016;os[i].rotation.x=Math.cos(t*1.12-i*.33+fil*Math.PI)*.022;}
    jambes.forEach((j,i)=>{j.rotation.x=Math.sin(t*1.1+i*Math.PI)*.025+a*.08;j.rotation.z=(i?1:-1)*a*.08;j.userData.genou.rotation.x=.035+Math.sin(t*1.3+i)*.028;});
    cristal.rotation.y=Math.sin(t*.8)*.18;violet.emissiveIntensity=.5+(pose.energie||0)*1.7+a*1.2;
  }
  animer(0);return {racine,hauteur:3.54,animer,origineAttaque};
}
