#!/usr/bin/env python3
"""Bundle Nsldkso.html + board3d.js + vendored three.js modules into one
self-contained HTML file (no server, no bundler, no build step for the
player — just open the file).

Why this exists: Claude Artifacts and the "send the file directly" delivery
path both need a single HTML file. Real ES module imports don't work over
`file://` (browsers block it), so every JS module the game imports is
inlined as a Blob and loaded through a hand-rolled bootstrap that rewrites
`import ... from '<path>'` into `import ... from '<blob: URL>'`.

This used to be two near-identical scripts (one per output path) that
hand-wired every single vendored module into the bootstrap by name. Adding
a new postprocessing pass meant editing 4 different places by hand, in the
right order — miss one and you get a silent stale build. VENDOR_MODULES
below is now the *only* place a new vendored file needs to be registered;
the dependency graph and the load order are both derived automatically by
scanning each file's own `import` statements.

Usage:
    python3 tools/build.py --out dist/pikajackpot.html
    python3 tools/build.py --out dist/pikajackpot.html --fonts   # + Google Fonts <link> (for real publishing)
"""
import re, base64, json, mimetypes, os, argparse, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Every local JS file (besides the entry point, board3d.js) that gets
# imported anywhere in the dependency tree. Register a new vendored file
# here and it's automatically picked up — no other edits needed, as long
# as its own `import` lines use relative paths or the bare 'three'
# specifier (both are resolved generically below).
VENDOR_MODULES = [
    # La règle d'argent (marge, prix, recettes) : module pur, sans
    # dépendance, donc en tête de liste.
    'regles/argent.js',
    'vendor/three/OrbitControls.js',
    'vendor/three/examples/jsm/utils/BufferGeometryUtils.js',
    'vendor/three/examples/jsm/loaders/GLTFLoader.js',
    'vendor/three/examples/jsm/postprocessing/Pass.js',
    'vendor/three/examples/jsm/postprocessing/MaskPass.js',
    'vendor/three/examples/jsm/postprocessing/RenderPass.js',
    'vendor/three/examples/jsm/postprocessing/ShaderPass.js',
    'vendor/three/examples/jsm/postprocessing/EffectComposer.js',
    'vendor/three/examples/jsm/postprocessing/UnrealBloomPass.js',
    'vendor/three/examples/jsm/shaders/CopyShader.js',
    'vendor/three/examples/jsm/shaders/LuminosityHighPassShader.js',
]
ENTRY = 'board3d.js'
THREE_CORE = 'vendor/three/three.module.min.js'

# Only real `import ... from '...'` statements — not any string that
# happens to contain "from '...'" (e.g. a comment or error message).
# Bounded lookback keeps a multi-line `import { a, b, c } from '...'`
# block matching without letting the regex run away across the file.
# Group 1 is everything up to and including `from `, kept as-is; group 2
# is just the quoted specifier, which is what actually gets swapped out.
# The lookback bound has to be generous: GLTFLoader.js alone imports ~80
# named symbols from 'three', spanning well over a thousand characters
# between `import {` and `from`.
IMPORT_RE_FULL = re.compile(r"""(^\s*import\s[\s\S]{0,6000}?from\s+)(['"][^'"]+['"])""", re.M)
# Bare specifier only (used for dependency-graph scanning, where the
# quotes/prefix don't matter).
IMPORT_RE = re.compile(r"""^\s*import\s[\s\S]{0,6000}?from\s+['"]([^'"]+)['"]""", re.M)


def token_for(path):
    """Deterministic placeholder token for a module path, e.g.
    'vendor/three/examples/jsm/postprocessing/BokehPass.js' -> '__BOKEHPASS__'."""
    name = os.path.splitext(os.path.basename(path))[0]
    return '__' + re.sub(r'[^A-Za-z0-9]', '', name).upper() + '__'


def load(path):
    with open(os.path.join(ROOT, path), encoding='utf-8') as f:
        return f.read()


def rewrite_imports(src, own_path):
    """Replace only the quoted module specifier in each `import ... from
    '...'` statement with its blob-token placeholder, leaving the rest of
    the statement (the `import { A, B }` clause) untouched. Relative
    specifiers are resolved against own_path's directory."""
    own_dir = os.path.dirname(own_path)

    def repl(m):
        prefix, quoted = m.group(1), m.group(2)
        spec = quoted[1:-1]
        if spec == 'three':
            token = '__THREE__'
        else:
            resolved = os.path.normpath(os.path.join(own_dir, spec)).replace(os.sep, '/')
            if resolved not in PATH_TO_TOKEN:
                raise SystemExit(
                    f"build.py: {own_path} imports '{spec}' (resolved: {resolved}) "
                    f"which isn't registered in VENDOR_MODULES — add it there."
                )
            token = PATH_TO_TOKEN[resolved]
        return prefix + "'" + token + "'"

    return IMPORT_RE_FULL.sub(repl, src)


PATH_TO_TOKEN = {THREE_CORE: '__THREE__'}
for p in VENDOR_MODULES:
    PATH_TO_TOKEN[p] = token_for(p)



def inline_glb_images(raw):
    """Réécrit un GLB pour que ses images embarquées (bufferView) deviennent
    des data: URI dans le JSON du modèle. GLTFLoader charge alors chaque
    texture depuis un data: URI, comme les images des cases, au lieu d'une
    URL blob: temporaire — bloquée par la politique de sécurité de
    l'hébergement des artefacts sur certains navigateurs (iPhone : le
    personnage apparaissait tout blanc, sans tee-shirt ni cicatrices)."""
    import struct
    magic, version, total = struct.unpack('<III', raw[:12])
    if magic != 0x46546C67:
        return raw
    off = 12
    chunks = []
    while off < len(raw):
        clen, ctype = struct.unpack('<II', raw[off:off+8])
        chunks.append((ctype, raw[off+8:off+8+clen]))
        off += 8 + clen
    jchunk = next(c for c in chunks if c[0] == 0x4E4F534A)
    bchunk = next((c for c in chunks if c[0] == 0x004E4942), None)
    gltf = json.loads(jchunk[1].decode('utf-8'))
    n = 0
    if bchunk is not None:
        for img in gltf.get('images', []):
            if 'bufferView' in img:
                bv = gltf['bufferViews'][img['bufferView']]
                start = bv.get('byteOffset', 0)
                blob = bchunk[1][start:start+bv['byteLength']]
                mime = img.get('mimeType', 'image/png')
                img['uri'] = 'data:%s;base64,%s' % (mime, base64.b64encode(blob).decode('ascii'))
                del img['bufferView']
                n += 1
    if not n:
        return raw
    jbytes = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    jbytes += b' ' * ((4 - len(jbytes) % 4) % 4)
    out = b''
    out += struct.pack('<II', len(jbytes), 0x4E4F534A) + jbytes
    if bchunk is not None:
        b = bchunk[1] + b'\0' * ((4 - len(bchunk[1]) % 4) % 4)
        out += struct.pack('<II', len(b), 0x004E4942) + b
    header = struct.pack('<III', 0x46546C67, version, 12 + len(out))
    print('build.py: %d image(s) du modèle 3D converties en data: URI' % n)
    return header + out

def build(out_path):
    html = load('Nsldkso.html')
    # The previous version of this script kept only the <style> block and
    # hand-reconstructed a Google Fonts <link> separately, silently
    # dropping <meta charset>, the viewport meta and <title> from <head>.
    # Without an explicit charset the browser has to guess the page's text
    # encoding, and it guessed wrong for the accented/★ characters used
    # throughout the UI (rendered as "â~..." mojibake). Keeping the whole
    # <head> verbatim — it already contains the Google Fonts links —
    # fixes that and is simpler than reassembling it piecemeal.
    head = re.search(r'<head>.*?</head>', html, re.S).group(0)
    body = re.search(r'<body>(.*)</body>', html, re.S).group(1)
    entry_js = load(ENTRY)

    # ---- inline every ./assets/... image (and 3D model) as a data URI,
    # wherever it's referenced (HTML, CSS or JS) ----
    asset_paths = set(re.findall(r"\./assets/[A-Za-z0-9_/.\-]+\.(?:jpg|jpeg|png|webp|glb)", html))
    asset_paths |= set(re.findall(r"\./assets/[A-Za-z0-9_/.\-]+\.(?:jpg|jpeg|png|webp|glb)", entry_js))
    data_uris = {}
    glb_b64 = {}
    for p in asset_paths:
        full = os.path.join(ROOT, p.lstrip('./'))
        with open(full, 'rb') as imgf:
            raw = imgf.read()
        if full.endswith('.glb'):
            raw = inline_glb_images(raw)
        data = base64.b64encode(raw).decode('ascii')
        if full.endswith('.glb'):
            # Le modèle 3D n'est PAS incrusté en data: URI « model/gltf-binary » :
            # ce type de fichier ne passe pas la vérification du partage public
            # des artefacts (« embeds a file type that can't be reviewed »), ce
            # qui bloquait toute nouvelle version sur une ancienne. On le
            # transporte en simple chaîne base64 dans un <script>, et le jeu le
            # reconstruit en ArrayBuffer pour GLTFLoader.parse().
            glb_b64[p] = data
            continue
        mime = mimetypes.guess_type(full)[0] or 'application/octet-stream'
        data_uris[p] = f'data:{mime};base64,{data}'

    # ---- chaque fichier n'est incrusté qu'UNE fois ----
    # Avant, chaque occurrence du chemin était remplacée par le data: URI
    # complet : le fond (CSS x2 + JS) pesait 3 fois, chaque lot 2 fois
    # (tableau JS + vignette HTML) — 4 Mo de doublons dans le fichier.
    #   • JS   : 'chemin' entre quotes  -> window.__ASSETS["chemin"]
    #   • CSS  : url("chemin")          -> var(--asset-N), défini une fois dans :root
    #   • HTML : <img src="chemin">      -> <img data-asset="chemin">, src posé au chargement
    css_vars = {}        # nom de variable CSS -> data: URI
    css_var_of = {}      # chemin -> nom de variable CSS
    js_used = set()      # chemins lus depuis JS/HTML (window.__ASSETS)
    def inline_js(text):
        for p in data_uris:
            # une seule passe (regex) : sinon la forme "p" produite par la
            # première passe se faisait re-remplacer par la seconde
            pat = re.compile('([\'"])' + re.escape(p) + '\\1')
            text, n = pat.subn(lambda m, p=p: 'window.__ASSETS[' + json.dumps(p) + ']', text)
            if n: js_used.add(p)
        return text
    def inline_css(text):
        for i, (p, uri) in enumerate(data_uris.items()):
            var = '--asset-%d' % i
            for form in ('url("%s")' % p, "url('%s')" % p, 'url(%s)' % p):
                if form in text:
                    css_vars[var] = uri
                    css_var_of[p] = var
                    text = text.replace(form, 'var(%s)' % var)
        return text
    def inline_html(text):
        for p in data_uris:
            if ('src="%s"' % p) in text:
                js_used.add(p)
                text = text.replace('src="%s"' % p, 'data-asset="%s"' % p)
        return text
    # ordre important : CSS (url("p")) puis HTML (src="p") AVANT le JS
    # ('p' / "p"), sinon la forme JS avale les deux autres
    head = inline_css(head)
    body = inline_js(inline_html(inline_css(body)))
    entry_js = inline_js(entry_js)
    # aucune référence ne doit rester sous une forme non prévue
    for p in data_uris:
        for name, text in (('head', head), ('body', body), ('board3d.js', entry_js)):
            rest = text.count(p) - text.count('__ASSETS[' + json.dumps(p) + ']') - text.count('data-asset="%s"' % p)
            if rest:
                raise SystemExit('build.py: référence non gérée à %s dans %s (x%d)' % (p, name, rest))
    # window.__ASSETS ne contient que ce que le JS/HTML lit ; un fichier
    # déjà porté par une variable CSS est relu depuis cette variable
    # (accesseur) au lieu d'être incrusté une seconde fois.
    assets_map = {p: uri for p, uri in data_uris.items() if p in js_used and p not in css_var_of}
    getters = ''.join(
        'Object.defineProperty(window.__ASSETS,%s,{get:function(){var v=getComputedStyle(document.documentElement)'
        '.getPropertyValue(%s).trim();var m=/^url\\((["\']?)([\\s\\S]*)\\1\\)$/.exec(v);return m?m[2]:v;}});'
        % (json.dumps(p), json.dumps(css_var_of[p]))
        for p in sorted(js_used) if p in css_var_of)
    assets_script = ('<style>:root{' + ''.join('%s:url("%s");' % (k, v) for k, v in css_vars.items()) + '}</style>\n'
        + '<script>window.__ASSETS = ' + json.dumps(assets_map) + ';' + getters + '</script>')
    head = head.replace('</head>', assets_script + '\n</head>')
    body = body + ('<script>document.querySelectorAll("img[data-asset]").forEach(function(i){'
                   ' i.src = window.__ASSETS[i.getAttribute("data-asset")] || ""; });</script>\n')

    # ---- resolve every module's own imports to blob-token placeholders ----
    entry_js = rewrite_imports(entry_js, ENTRY)
    module_src = {THREE_CORE: load(THREE_CORE)}  # three.module.min.js has no imports of its own
    for p in VENDOR_MODULES:
        module_src[p] = rewrite_imports(load(p), p)

    # ---- topologically order modules so each is blobified only after
    # every module it imports already has a blob URL (three.module.min.js
    # is always the root; RenderPass/BokehPass/etc. all fan out from it) ----
    remaining = list(VENDOR_MODULES)
    order = [THREE_CORE]
    resolved_tokens = {'__THREE__'}
    guard = 0
    while remaining:
        guard += 1
        if guard > 10 * (len(VENDOR_MODULES) + 1):
            raise SystemExit(f"build.py: circular or unresolved vendor import among {remaining}")
        progressed = False
        for p in list(remaining):
            deps = set(IMPORT_RE.findall(load(p)))
            dep_tokens = {'__THREE__' if d == 'three' else PATH_TO_TOKEN[os.path.normpath(os.path.join(os.path.dirname(p), d)).replace(os.sep, '/')] for d in deps}
            if dep_tokens <= resolved_tokens:
                order.append(p)
                resolved_tokens.add(PATH_TO_TOKEN[p])
                remaining.remove(p)
                progressed = True
        if not progressed:
            raise SystemExit(f"build.py: circular or unresolved vendor import among {remaining}")

    bundle_sources = {PATH_TO_TOKEN[p]: module_src[p] for p in order}
    bundle_sources['__ENTRY__'] = entry_js
    load_order = [PATH_TO_TOKEN[p] for p in order] + ['__ENTRY__']

    bootstrap_lines = [
        "<script>",
        "window.__GLB_B64 = " + json.dumps(glb_b64) + ";",
        "</script>",
        "<script>",
        "(function(){",
        "  var SRC = " + json.dumps(bundle_sources) + ";",
        "  var urls = {};",
        "  function blobify(token){",
        "    var code = SRC[token];",
        "    for (var k in urls) { code = code.split(k).join(urls[k]); }",
        "    var blob = new Blob([code], {type:'text/javascript'});",
        "    urls[token] = URL.createObjectURL(blob);",
        "  }",
    ]
    for tok in load_order:
        bootstrap_lines.append(f"  blobify('{tok}');")
    bootstrap_lines += [
        "  var s = document.createElement('script');",
        "  s.type = 'module';",
        "  s.src = urls['__ENTRY__'];",
        "  document.body.appendChild(s);",
        "})();",
        "</script>",
    ]
    bootstrap = '\n'.join(bootstrap_lines)

    # The importmap only matters when Nsldkso.html is served as-is over a
    # dev HTTP server (so a plain `import ... from 'three'` resolves); it's
    # dead weight once every import is rewritten to a blob URl below, and
    # some Chromium builds speculatively (and pointlessly) try to fetch its
    # target, which then 404s as a relative path once bundled elsewhere.
    body = re.sub(r'<script type=["\']importmap["\']>.*?</script>\s*', '', body, flags=re.S)

    body = re.sub(
        r'<script[^>]*type=["\']module["\'][^>]*src=["\']\.?/?board3d\.js["\'][^>]*>\s*</script>',
        lambda m: bootstrap, body,
    )
    assert '<script>\n(function' in body, "build.py: could not find the board3d.js <script type=module> tag to replace"

    html_tag = re.search(r'<html[^>]*>', html).group(0)   # garde data-rot & co
    out = ('<!doctype html>\n' + html_tag + '\n' + head + '\n<body>' + body + '</body>\n</html>\n')
    # GLTFLoader embarque deux images de test (AVIF et WebP, 1 px) pour
    # détecter les formats supportés. Ces types ne passent pas la
    # vérification du partage public des artefacts. On ne se sert d'aucune
    # texture AVIF/WebP : on neutralise les tests (l'image ne charge pas,
    # le loader conclut « non supporté », sans conséquence).
    out, n_strip = re.subn(r'data:image/(?:avif|webp);base64,[A-Za-z0-9+/=]+', 'data:,', out)
    print(f'build.py: {n_strip} image(s) de test AVIF/WebP neutralisée(s)')
    os.makedirs(os.path.dirname(os.path.abspath(out_path)) or '.', exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(out)
    print(f'done: {out_path} ({len(out)} bytes)')
    return out_path


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True, help='output HTML path')
    args = ap.parse_args()
    build(args.out)
