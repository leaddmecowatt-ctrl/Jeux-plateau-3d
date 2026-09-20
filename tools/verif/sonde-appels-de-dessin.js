
/* SONDE TEMPORAIRE — jamais commitée */
renderer.info.autoReset = false;
window.__dbg = () => new Promise(res => requestAnimationFrame(() => { renderer.info.reset(); requestAnimationFrame(() => {
  let sprites=0, meshes=0; scene.traverse(o => { if(o.isSprite) sprites++; else if(o.isMesh) meshes++; });
  res({ appelsParImage: renderer.info.render.calls, triangles: renderer.info.render.triangles, sprites, meshes });
}); }));
