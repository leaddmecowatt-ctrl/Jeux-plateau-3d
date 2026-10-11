#!/usr/bin/env python3
"""Golden Warm: polish the actual 3D board without changing prize images or gameplay."""
from pathlib import Path
p = Path("board3d_golden.js")
s = p.read_text(encoding="utf-8")
def once(a,b,label):
    global s
    if s.count(a)!=1:
        raise SystemExit(f"Golden Warm: {label}: expected 1 match, found {s.count(a)}")
    s=s.replace(a,b,1)

# Individual neon case rims: prizes keep gold/silver/bronze, specials become
# recognizable at a glance (amethyst, mint, ruby).
once(
"  jackpot300:'#FFFFFF', etb:'#FFC400', booster50:'#D4DBE4', gradee:'#E0782E', booster8:'#E0782E', alternative:'#E0782E', commune:'#E0782E', chance:'#EE8C80', chest:'#EE8C80', prison:'#d49354', parc:'#ffd54a', depart:'#ffd54a', visite:'#E0782E',",
"  jackpot300:'#FFF5DC', etb:'#FFD54A', booster50:'#DDE8F6', gradee:'#E9964B', booster8:'#E9964B', alternative:'#D48BC8', commune:'#7CBBD8', chance:'#B87BFF', chest:'#69D9AF', prison:'#F06A70', parc:'#9AD7CF', depart:'#FFE08A', visite:'#E9964B',",
"3D case rim categories")
once(
"  chance: metalLigne(makeMetalGradTex(['#ffd6d0','#e8867a','#9a3f36','#f4a79c','#5e221c']), 0.9),\n  chest: metalLigne(makeMetalGradTex(['#ffd6d0','#e8867a','#9a3f36','#f4a79c','#5e221c']), 0.9),\n  prison: metalLigne(makeMetalGradTex(['#d08944','#b46920','#643a12','#ca7b2e','#46280c']), 0.45),",
"  chance: metalLigne(makeMetalGradTex(['#f2deff','#ba83ff','#63389a','#ceacff','#462377']), 0.76),\n  chest: metalLigne(makeMetalGradTex(['#d6ffed','#70d9b2','#28785c','#aaefd4','#164638']), 0.72),\n  prison: metalLigne(makeMetalGradTex(['#ffb5b8','#e76b72','#97323c','#ff999b','#601b25']), 0.64),",
"3D special case metals")

# A fine iridescent hot-foil line on the OUTER FRAME ONLY, not over photos.
once(
"    // 4 pierres serties aux coins\n    const gemme = (x, y, r)=>{",
"""    // Golden Warm: holographic finish on the outer metal border only.
    ctx.save();
    const foil = ctx.createLinearGradient(32, 32, size-32, size-32);
    foil.addColorStop(0.00, 'rgba(255,245,208,.82)');
    foil.addColorStop(0.24, 'rgba(255,207,132,.53)');
    foil.addColorStop(0.48, 'rgba(208,182,255,.62)');
    foil.addColorStop(0.73, 'rgba(176,243,228,.57)');
    foil.addColorStop(1.00, 'rgba(255,241,195,.85)');
    ctx.lineWidth = 10; ctx.strokeStyle = foil;
    ctx.shadowColor = 'rgba(255,226,140,.38)'; ctx.shadowBlur = 10;
    roundRectPath(ctx, 34, 34, size-68, size-68, 46); ctx.stroke();
    ctx.restore();
    // 4 pierres serties aux coins
    const gemme = (x, y, r)=>{""",
"photo-border foil")

# Fine real geometry on the original SQUARE frame, behind no game tiles.
once(
"""  // moulure haute (arête du plateau) et moulure basse
  boudin(ext + 0.03, 0.2, -0.004, 0.032, orPoliMat);
  boudin(ext + 0.045, 0.2, -0.150, 0.042, orPoliMat);""",
"""  // moulure haute (arête du plateau) et moulure basse
  boudin(ext + 0.03, 0.2, -0.004, 0.032, orPoliMat);
  boudin(ext + 0.045, 0.2, -0.150, 0.042, orPoliMat);
  // Two handcrafted contrasting inlays give depth to the warm gold sides.
  const incrustationSombre = new THREE.MeshStandardMaterial({
    color:0x986027, metalness:0.69, roughness:0.35,
    emissive:0x261303, emissiveIntensity:0.12
  });
  const incrustationClaire = new THREE.MeshStandardMaterial({
    color:0xffe8b1, metalness:0.43, roughness:0.29,
    emissive:0x9a6925, emissiveIntensity:0.18
  });
  boudin(ext + 0.037, 0.2, -0.107, 0.010, incrustationSombre);
  boudin(ext + 0.034, 0.2, -0.044, 0.008, incrustationClaire);""",
"square 3D gold frame")
p.write_text(s,encoding="utf-8")
print("Golden Warm: 3D case colors, photo frame iridescence and gold side inlays applied")
