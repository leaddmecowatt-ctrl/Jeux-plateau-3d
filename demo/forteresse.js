/* Architecture de la démo : obsidienne polie, laiton brossé et lumière chaude.
   Les cases et le moteur d'origine restent indépendants de ce décor. */
export function installerForteresse({THREE, boardGroup, taille}) {
  const racine = new THREE.Group();
  racine.name = 'Forteresse Golden — sanctuaire';
  boardGroup.add(racine);
  const or = new THREE.MeshStandardMaterial({color:0xd8b76d,metalness:.88,roughness:.27,envMapIntensity:1.4});
  const noir = new THREE.MeshStandardMaterial({color:0x0c1015,metalness:.65,roughness:.25,envMapIntensity:.8});
  const bronze = new THREE.MeshStandardMaterial({color:0x72522e,metalness:.85,roughness:.38});
  const lueur = new THREE.MeshBasicMaterial({color:0xffd59b,transparent:true,opacity:.8,toneMapped:false});
  function piece(geo,mat,x,y,z,parent=racine){
    const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.receiveShadow=true;m.castShadow=true;parent.add(m);return m;
  }
  // Socle monolithique, trois strates séparées par de vrais filets métalliques.
  const largeur=taille+1.15;
  piece(new THREE.BoxGeometry(largeur,.48,largeur),noir,0,-.66,0);
  piece(new THREE.BoxGeometry(largeur+.13,.065,largeur+.13),or,0,-.9,0);
  piece(new THREE.BoxGeometry(largeur+.38,.16,largeur+.38),noir,0,-1.02,0);
  const demi=taille/2+.37;
  const section=new THREE.BoxGeometry(.095,.055,taille+.68);
  for(const s of [-1,1]){
    piece(section,or,s*demi,-.34,0);
    const bar=piece(section,or,0,-.34,s*demi);bar.rotation.y=Math.PI/2;
  }
  // Piles facettées et flèches : les deux premières restent basses pour les cases proches.
  const allumettes=[];
  for(const [sx,sz] of [[-1,-1],[1,-1],[-1,1],[1,1]]){
    const tour=new THREE.Group();racine.add(tour);tour.position.set(sx*(demi+.16),0,sz*(demi+.16));
    const haut=sz<0?1.82:.65;
    piece(new THREE.CylinderGeometry(.38,.51,.25,8),bronze,0,-.4,0,tour);
    piece(new THREE.CylinderGeometry(.28,.37,haut,8),noir,0,haut/2-.31,0,tour);
    for(const yy of [haut*.25,haut*.72,haut-.3])piece(new THREE.CylinderGeometry(.32,.32,.04,8),or,0,yy,0,tour);
    const runes=new THREE.InstancedMesh(new THREE.BoxGeometry(.026,haut*.7,.026),or,8);
    const dummy=new THREE.Object3D();
    for(let i=0;i<8;i++){const a=i*Math.PI/4;dummy.position.set(Math.sin(a)*.298,haut*.5-.2,Math.cos(a)*.298);dummy.rotation.y=a;dummy.updateMatrix();runes.setMatrixAt(i,dummy.matrix);}
    tour.add(runes);
    const couronne=piece(new THREE.CylinderGeometry(.43,.33,.16,8),or,0,haut-.26,0,tour);
    const flamme=piece(new THREE.OctahedronGeometry(sz<0?.18:.12,1),lueur,0,haut-.09,0,tour);
    allumettes.push(flamme);
    if(sz<0){piece(new THREE.ConeGeometry(.28,.64,8),noir,0,haut+.08,0,tour);piece(new THREE.ConeGeometry(.06,.33,8),or,0,haut+.54,0,tour);}
    couronne.castShadow=false;
  }
  // Emblème de la forteresse sur la tranche, géométrie et gravure sans image.
  const sceau=new THREE.Group();sceau.position.set(0,-.66,largeur/2+.014);racine.add(sceau);
  const anneau=piece(new THREE.TorusGeometry(.19,.017,8,48),or,0,0,0,sceau);
  piece(new THREE.CylinderGeometry(.071,.071,.013,24),or,0,0,.006,sceau).rotation.x=Math.PI/2;
  piece(new THREE.BoxGeometry(.38,.021,.02),or,0,0,0,sceau);
  const geo=new THREE.BoxGeometry(.055,.13,.025);
  const signes=new THREE.InstancedMesh(geo,bronze,48);
  const tmp=new THREE.Object3D();
  for(let i=0;i<48;i++){const x=(i-23.5)*.19;tmp.position.set(x,-.65,largeur/2+.016);tmp.rotation.z=(i%2?.55:-.55);tmp.updateMatrix();signes.setMatrixAt(i,tmp.matrix);}
  racine.add(signes);
  return {racine};
}
