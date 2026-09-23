"""Prépare le personnage anime du plateau à partir du modèle VRM d'origine.

Source : Seed-san (VirtualCast, Inc.), licence VRM 1.0
  https://github.com/vrm-c/vrm-specification/tree/master/samples/Seed-san
  usage commercial autorisé, modification autorisée, CRÉDIT OBLIGATOIRE
  (le crédit est affiché dans la bulle de règles, touche M).

Ce que fait le script, de façon reproductible :
  - retire le bras robot et le sac à dos (hors identité du pion) ;
  - ne garde que les expressions servies par le jeu (clignement, joie,
    détente, surprise, « a ») et supprime les autres morphs — 1,1 Mo ;
  - réduit les textures à 1024 px, JPEG quand elles n'ont pas de
    transparence ;
  - retire les gadgets des poignets (petites pièces isolées du maillage
    « wear » à hauteur des mains) ;
  - recolore la tenue aux couleurs du pion d'origine : haut rouge, short
    bleu, ceinture jaune façon écharpe, bras nus (manches et gants noirs
    passés en peau) — l'identité du pion au chapeau de paille ;
  - reconstruit un GLB compact avec seulement les données encore
    référencées.

Usage : python3 tools/prepare_avatar.py Seed-san.vrm assets/character/avatar.glb
"""
import json, struct, sys, io
import numpy as np
from PIL import Image

SRC, DST = sys.argv[1], sys.argv[2]
raw = open(SRC, 'rb').read()
jl = struct.unpack('<I', raw[12:16])[0]
j = json.loads(raw[20:20+jl])
bin0 = raw[20+jl+8:]

MAT = {m['name']: i for i, m in enumerate(j['materials'])}
RETIRE_MAT = {'armgear_plastic', 'robo_face', 'glass', 'backpack_metal', 'green_emit',
              'backpack_nm', 'backpack_plastic', 'anim_logo', 'arm_mat', 'arm_plastic'}
GARDE_EXPR = ['blink', 'blinkLeft', 'blinkRight', 'happy', 'relaxed', 'surprised', 'aa', 'neutral']

# 1. maillages : bras robot hors scène, primitives du sac à dos retirées
for n in j['nodes']:
    if n.get('name') == 'robo_arm':
        n.pop('mesh', None); n.pop('skin', None)
for m in j['meshes']:
    m['primitives'] = [p for p in m['primitives'] if j['materials'][p['material']]['name'] not in RETIRE_MAT]
used_meshes = {n['mesh'] for n in j['nodes'] if 'mesh' in n}

# 2. morphs : on ne garde que ceux des expressions conservées
vrm = j['extensions']['VRMC_vrm']
preset = vrm['expressions']['preset']
for k in list(preset):
    if k not in GARDE_EXPR: del preset[k]
vrm['expressions'].pop('custom', None)
vrm.get('lookAt', {}).pop('rangeMapHorizontalInner', None)
keep = {}   # mesh index -> sorted list of kept morph indices
node_mesh = {i: n['mesh'] for i, n in enumerate(j['nodes']) if 'mesh' in n}
for e in preset.values():
    for b in e.get('morphTargetBinds', []):
        keep.setdefault(node_mesh[b['node']], set()).add(b['index'])
for mi, m in enumerate(j['meshes']):
    if not any('targets' in p for p in m['primitives']): continue
    ks = sorted(keep.get(mi, set()))
    remap = {old: new for new, old in enumerate(ks)}
    for p in m['primitives']:
        if 'targets' in p: p['targets'] = [p['targets'][i] for i in ks]
    if 'weights' in m: m['weights'] = [m['weights'][i] for i in ks]
    names = m.get('extras', {}).get('targetNames')
    if names: m['extras']['targetNames'] = [names[i] for i in ks]
    for p in m['primitives']:
        tn = p.get('extras', {}).get('targetNames')
        if tn: p['extras']['targetNames'] = [tn[i] for i in ks]
    for e in preset.values():
        for b in e.get('morphTargetBinds', []):
            if node_mesh[b['node']] == mi: b['index'] = remap[b['index']]
# binds de matériaux vers des matériaux retirés : on les enlève
for e in preset.values():
    for key in ('materialColorBinds', 'textureTransformBinds'):
        if key in e:
            e[key] = [b for b in e[key] if j['materials'][b['material']]['name'] not in RETIRE_MAT]

# ressort du câble robot : inutile sans le bras
sb = j['extensions'].get('VRMC_springBone')
if sb: sb['springs'] = [s for s in sb['springs'] if s.get('name') != 'RoboWire']

# 2 bis. gadgets des poignets, et logo de poitrine : composantes connexes isolées, loin de l'axe
# du corps (|x| > 0,38) et sous la hauteur des épaules, dans le maillage
# « wear ». Les doigts (body_bake) et les bras (body_nm) sont d'autres
# primitives, jamais touchées ici.
def read_acc(i):
    A = j['accessors'][i]; bv = j['bufferViews'][A['bufferView']]
    o = bv.get('byteOffset', 0) + A.get('byteOffset', 0)
    n = {'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[A['type']]
    dt = {5126:np.float32,5125:np.uint32,5123:np.uint16,5121:np.uint8}[A['componentType']]
    a = np.frombuffer(bin0, dtype=dt, count=A['count']*n, offset=o)
    return a.reshape(-1, n) if n > 1 else a
acc_override = {}
for n in j['nodes']:
    if n.get('name') != 'wear' or 'mesh' not in n: continue
    for p in j['meshes'][n['mesh']]['primitives']:
        mname = j['materials'][p['material']]['name']
        if mname not in ('huku_bake', 'wear_metal', 'body_bake'): continue
        P = read_acc(p['attributes']['POSITION']); I = read_acc(p['indices']).reshape(-1, 3)
        par = np.arange(len(P))
        def f(a):
            while par[a] != a:
                par[a] = par[par[a]]; a = par[a]
            return a
        for t in I:
            r = f(t[0]); par[f(t[1])] = r; par[f(t[2])] = r
        roots = np.array([f(v) for v in range(len(P))])
        drop = set()
        for r in set(roots.tolist()):
            q = P[roots == r]; c = (q.min(0) + q.max(0)) / 2
            sz = q.max(0) - q.min(0)
            if mname != 'body_bake' and abs(c[0]) > 0.38 and c[1] < 1.05: drop.add(r)
            # logo hexagonal de la marque d'origine, décalque posé sur la poitrine
            if mname == 'body_bake' and c[2] > 0.06 and 1.05 < c[1] < 1.25 and 0 < c[0] < 0.16 and sz.max() < 0.1:
                drop.add(r)
        keepT = np.array([roots[t[0]] not in drop for t in I])
        A = j['accessors'][p['indices']]
        dt = {5125:np.uint32,5123:np.uint16,5121:np.uint8}[A['componentType']]
        acc_override[p['indices']] = I[keepT].astype(dt).tobytes()
        A['count'] = int(keepT.sum()) * 3
        A.pop('byteOffset', None)

# 3. accessors / textures réellement référencés
acc_used, tex_used = set(), set()
for mi in used_meshes:
    for p in j['meshes'][mi]['primitives']:
        acc_used.update(p['attributes'].values()); acc_used.add(p['indices'])
        for t in p.get('targets', []): acc_used.update(t.values())
for s in j['skins']:
    if 'inverseBindMatrices' in s: acc_used.add(s['inverseBindMatrices'])
mat_used = {p['material'] for mi in used_meshes for p in j['meshes'][mi]['primitives']}
def walk_tex(o):
    if isinstance(o, dict):
        if 'index' in o and set(o) <= {'index', 'texCoord', 'scale', 'strength', 'extensions', 'extras'}:
            tex_used.add(o['index'])
        for v in o.values(): walk_tex(v)
    elif isinstance(o, list):
        for v in o: walk_tex(v)
for mi in mat_used: walk_tex(j['materials'][mi])
img_used = {j['textures'][t]['source'] for t in tex_used}
meta = vrm['meta']; meta.pop('thumbnailImage', None)


# 3 bis. tenue aux couleurs du pion. Régions en coordonnées de texture
# (0..1), relevées sur l'atlas « wear » : haut (deux pièces + cols), short,
# ceinture. La luminance d'origine est gardée : plis, coutures et ombres
# cuites restent, seule la teinte change.
TENUE = [  # (x0, y0, x1, y1, couleur)
    (0.00, 0.00, 0.655, 0.46, (200, 34, 44)),    # haut rouge (et manches courtes)
    (0.00, 0.46, 0.66, 0.865, (52, 86, 150)),    # short bleu
    (0.00, 0.865, 0.40, 0.985, (236, 178, 38)),  # ceinture -> écharpe jaune
]
def recolor(name, img):
    if name == 'wear':
        a = np.asarray(img.convert('RGBA')).astype(np.float32)
        h, w = a.shape[:2]
        lum = (0.30*a[...,0] + 0.59*a[...,1] + 0.11*a[...,2]) / 255.0
        for x0, y0, x1, y1, col in TENUE:
            ys, xs = slice(int(y0*h), int(y1*h)), slice(int(x0*w), int(x1*w))
            L = np.clip(lum[ys, xs] / 0.93, 0, 1) ** 1.15
            if col == (236, 178, 38): L = 0.62 + 0.38*L   # cuir noir : la teinte doit rester lisible
            for k in range(3): a[ys, xs, k] = col[k] * L
        return Image.fromarray(a.clip(0, 255).astype(np.uint8), 'RGBA')
    if name == 'body':
        a = np.asarray(img.convert('RGBA')).astype(np.float32)
        h, w = a.shape[:2]
        skin = np.median(a[int(.30*h):int(.45*h), int(.12*w):int(.28*w), :3].reshape(-1, 3), axis=0)
        # manches et gants : tout ce qui est sombre ou bleu dans la colonne de droite
        reg = a[:, int(0.76*w):, :]
        lum = (0.30*reg[...,0] + 0.59*reg[...,1] + 0.11*reg[...,2]) / 255.0
        blue = (reg[...,2] > reg[...,0] + 40)
        m = ((lum < 0.35) | blue) & (reg[...,3] > 0)
        shade = 0.86 + 0.14*np.clip(lum/0.35, 0, 1)
        for k in range(3): reg[...,k] = np.where(m, skin[k]*shade, reg[...,k])
        a[:, int(0.76*w):, :] = reg
        # logo hexagonal de la marque d'origine (décalque de poitrine) : repeint
        # dans le rouge du haut, ombrage conservé
        ys, xs = slice(int(0.695*h), int(0.775*h)), slice(int(0.595*w), int(0.640*w))
        L = 0.80 + 0.20*np.clip((0.30*a[ys, xs, 0] + 0.59*a[ys, xs, 1] + 0.11*a[ys, xs, 2]) / 255.0, 0, 1)
        for k, c in enumerate((200, 34, 44)): a[ys, xs, k] = c * L
        return Image.fromarray(a.clip(0, 255).astype(np.uint8), 'RGBA')
    return img

# 4. reconstruction du binaire
out = bytearray(); bv_new = []; bv_map = {}
def push(data):
    while len(out) % 4: out.append(0)
    off = len(out); out.extend(data)
    bv_new.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(data)})
    return len(bv_new) - 1
def copy_bv(i):
    if i not in bv_map:
        bv = j['bufferViews'][i]; o = bv.get('byteOffset', 0)
        n = push(bin0[o:o+bv['byteLength']])
        for k in ('byteStride', 'target'):
            if k in bv: bv_new[n][k] = bv[k]
        bv_map[i] = n
    return bv_map[i]
for ai, a in enumerate(j['accessors']):
    if ai in acc_used:
        if ai in acc_override:
            a['bufferView'] = push(acc_override[ai]); bv_new[a['bufferView']]['target'] = 34963
        elif 'bufferView' in a: a['bufferView'] = copy_bv(a['bufferView'])
        if 'sparse' in a:
            a['sparse']['indices']['bufferView'] = copy_bv(a['sparse']['indices']['bufferView'])
            a['sparse']['values']['bufferView'] = copy_bv(a['sparse']['values']['bufferView'])
    else:
        a.pop('bufferView', None); a.pop('sparse', None); a.pop('byteOffset', None)
PIX = io.BytesIO(); Image.new('RGBA', (1, 1), (0, 0, 0, 0)).save(PIX, 'PNG'); PIX = PIX.getvalue()
for ii, im in enumerate(j['images']):
    bv = j['bufferViews'][im['bufferView']]; o = bv.get('byteOffset', 0)
    data = bin0[o:o+bv['byteLength']]
    if ii not in img_used:
        im['bufferView'] = push(PIX); im['mimeType'] = 'image/png'; continue
    img = Image.open(io.BytesIO(data)); img.load()
    img = recolor(im.get('name'), img)
    if max(img.size) > 1024:
        img = img.resize((img.width * 1024 // max(img.size), img.height * 1024 // max(img.size)), Image.LANCZOS)
    has_alpha = img.mode in ('RGBA', 'LA') and img.getchannel('A').getextrema()[0] < 255
    buf = io.BytesIO()
    if has_alpha:
        img.save(buf, 'PNG', optimize=True); im['mimeType'] = 'image/png'
    else:
        img.convert('RGB').save(buf, 'JPEG', quality=88, optimize=True); im['mimeType'] = 'image/jpeg'
    im['bufferView'] = push(buf.getvalue())
while len(out) % 4: out.append(0)
j['bufferViews'] = bv_new
j['buffers'] = [{'byteLength': len(out)}]

js = json.dumps(j, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
while len(js) % 4: js += b' '
glb = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(out))
glb += struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(out), 0x004E4942) + bytes(out)
open(DST, 'wb').write(glb)
print('écrit', DST, len(glb) // 1024, 'Ko')
