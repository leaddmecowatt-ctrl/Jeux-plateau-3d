/* Le squelette du pion, quel que soit le modèle fourni : reconnaissance des
   os (Kenney, Mixamo, VRM, Ready Player Me…), mesures automatiques des
   jambes, et un outil pour orienter un os vers un point du monde sans rien
   savoir de ses axes locaux. Tout ce qui dépendait des conventions du modèle
   Kenney vit dans son profil ; un autre modèle passe par le profil
   automatique. */
import * as THREE from 'three';

/* nom interne → noms rencontrés dans les rigs courants (comparés après
   normalisation : minuscules, sans « mixamorig », « : », « _ », « . ») */
const ALIAS = {
  Hips:          ['Hips','pelvis','J_Bip_C_Hips'],
  Spine:         ['Spine','J_Bip_C_Spine','spine01'],
  Chest:         ['Chest','Spine1','J_Bip_C_Chest','spine02'],
  UpperChest:    ['UpperChest','Spine2','J_Bip_C_UpperChest','spine03'],
  Neck:          ['Neck','J_Bip_C_Neck'],
  Head:          ['Head','J_Bip_C_Head'],
  LeftShoulder:  ['LeftShoulder','J_Bip_L_Shoulder','clavicle_l'],
  RightShoulder: ['RightShoulder','J_Bip_R_Shoulder','clavicle_r'],
  LeftArm:       ['LeftArm','J_Bip_L_UpperArm','upperarm_l','LeftUpperArm'],
  RightArm:      ['RightArm','J_Bip_R_UpperArm','upperarm_r','RightUpperArm'],
  LeftForeArm:   ['LeftForeArm','J_Bip_L_LowerArm','lowerarm_l','LeftLowerArm'],
  RightForeArm:  ['RightForeArm','J_Bip_R_LowerArm','lowerarm_r','RightLowerArm'],
  LeftHand:      ['LeftHand','J_Bip_L_Hand','hand_l'],
  RightHand:     ['RightHand','J_Bip_R_Hand','hand_r'],
  LeftUpLeg:     ['LeftUpLeg','J_Bip_L_UpperLeg','thigh_l','LeftUpperLeg'],
  RightUpLeg:    ['RightUpLeg','J_Bip_R_UpperLeg','thigh_r','RightUpperLeg'],
  LeftLeg:       ['LeftLeg','J_Bip_L_LowerLeg','calf_l','LeftLowerLeg'],
  RightLeg:      ['RightLeg','J_Bip_R_LowerLeg','calf_r','RightLowerLeg'],
  LeftFoot:      ['LeftFoot','J_Bip_L_Foot','foot_l'],
  RightFoot:     ['RightFoot','J_Bip_R_Foot','foot_r'],
  LeftToeBase:   ['LeftToeBase','J_Bip_L_ToeBase','ball_l','LeftToes'],
  RightToeBase:  ['RightToeBase','J_Bip_R_ToeBase','ball_r','RightToes'],
};
export const OS_REQUIS = ['Hips','Head','LeftArm','RightArm','LeftForeArm','RightForeArm','LeftUpLeg','RightUpLeg','LeftLeg','RightLeg','LeftFoot','RightFoot'];
function normaliser(n){ return String(n || '').toLowerCase().replace(/mixamorig/g,'').replace(/[:_.\s-]/g,''); }

/* Retourne { bones, manquants, mode } : mode 'kenney' si c'est le modèle
   d'origine (noms exacts + os de contrôle « HipsCtrl »), sinon 'auto'. */
export function reconnaitreSquelette(model){
  const parNom = new Map();
  model.traverse(o=>{ if(o.isBone) parNom.set(normaliser(o.name), o); });
  const bones = {}, manquants = [];
  for(const [interne, cands] of Object.entries(ALIAS)){
    let b = null;
    for(const c of [interne, ...cands]){ b = parNom.get(normaliser(c)); if(b) break; }
    bones[interne] = b || null;
    if(!b && OS_REQUIS.includes(interne)) manquants.push(interne);
  }
  let kenney = false;
  model.traverse(o=>{ if(o.isBone && o.name === 'HipsCtrl') kenney = true; });
  return { bones, manquants, mode: kenney && !manquants.length ? 'kenney' : 'auto' };
}

/* Mesures des jambes en pose de liaison, dans le repère de `root` (le
   modèle est déjà mis à l'échelle et posé). */
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
export function mesurerJambes(root, bones){
  root.updateWorldMatrix(true, true);
  const pos = b => root.worldToLocal(b.getWorldPosition(new THREE.Vector3()));
  const hip = pos(bones.LeftUpLeg), knee = pos(bones.LeftLeg), foot = pos(bones.LeftFoot);
  const thigh = hip.distanceTo(knee), shin = knee.distanceTo(foot);
  let footL = shin*0.49, footA = 0.663;
  if(bones.LeftToeBase){
    const toe = pos(bones.LeftToeBase);
    const horiz = Math.hypot(toe.x-foot.x, toe.z-foot.z), dy = foot.y - toe.y;
    if(horiz > 1e-4){ footL = Math.hypot(horiz, dy); footA = Math.atan2(Math.max(0,dy), horiz); }
  }
  return { thigh, shin, hipY: hip.y, footY: foot.y, footL, footA, hipX: hip.x };
}

/* Oriente `bone` pour que son enfant `child` (ou le point qu'il portait)
   se retrouve dans la direction de `targetWorld`. Rotation appliquée dans
   le monde, ramenée dans le repère local : aucune hypothèse sur les axes. */
const _q = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _pqi = new THREE.Quaternion();
const _cur = new THREE.Vector3(), _want = new THREE.Vector3(), _bw = new THREE.Vector3();
export function viserAvec(bone, child, targetWorld){
  bone.updateWorldMatrix(true, false);
  child.updateWorldMatrix(false, false);
  _bw.setFromMatrixPosition(bone.matrixWorld);
  _cur.setFromMatrixPosition(child.matrixWorld).sub(_bw);
  _want.copy(targetWorld).sub(_bw);
  if(_cur.lengthSq() < 1e-10 || _want.lengthSq() < 1e-10) return;
  _cur.normalize(); _want.normalize();
  _q.setFromUnitVectors(_cur, _want);
  if(bone.parent) bone.parent.getWorldQuaternion(_pq); else _pq.identity();
  _pqi.copy(_pq).invert();
  // local' = parent⁻¹ · q · parent · local
  bone.quaternion.premultiply(_pq).premultiply(_q).premultiply(_pqi);
}

/* Donne à `bone` l'orientation monde `targetWorldQ`. */
export function orienterMonde(bone, targetWorldQ){
  if(bone.parent) bone.parent.getWorldQuaternion(_pq); else _pq.identity();
  bone.quaternion.copy(_pq.invert()).multiply(targetWorldQ);
}
