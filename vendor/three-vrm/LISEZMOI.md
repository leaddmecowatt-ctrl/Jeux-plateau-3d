# @pixiv/three-vrm 2.0.10 (licence MIT, voir LICENSE)

Chargeur du personnage anime (`assets/character/avatar.glb`, format VRM 1.0).
Version 2.0.10 : la dernière compatible three r160 (celle de `vendor/three`).

Fichier : `lib/three-vrm.module.min.js` du paquet npm, avec UNE retouche —
ses deux `import` minifiés (`import*as e from"three"`) sont réécrits en
`import * as e from 'three';` sur leur propre ligne, pour que
`tools/build.py` les reconnaisse et les relie à three.js dans le bundle.
