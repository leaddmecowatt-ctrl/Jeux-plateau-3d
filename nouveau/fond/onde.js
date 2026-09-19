/* Le fond ondulant : UN <canvas>, un shader, un appel de dessin par image.
   Onde ±2,2 px, période 8 s, 1,4 tour sur la hauteur, cadence bridée à
   30/s. Figée (une image, puis rien) si prefers-reduced-motion, en mode
   éco (html.eco) ou onglet caché. Sans WebGL, ou si le contexte lâche :
   html.bg-static remet la photo en fond CSS. Ne jamais revenir aux bandes
   CSS (36 calques GPU : le poste le plus cher de l'ancienne page). */
export function demarrerFond(){
  const cvs = document.getElementById('bgWave');
  if(!cvs) return;
  const html = document.documentElement;
  const fill = document.getElementById('bgFill');
  const AMP = 2.2, WAVE_CYCLES = 1.4, DURATION_S = 8, FPS = 30;
  const img = new Image();
  const imgWide = new Image();
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  function statique(){ html.classList.add('bg-static'); }
  let gl = null;
  try{ gl = cvs.getContext('webgl', {alpha:true, antialias:false, depth:false, stencil:false, powerPreference:'low-power'}); }catch(e){}
  if(!gl){ statique(); return; }
  const VS = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  const FS = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n'
    + 'uniform sampler2D t;uniform vec2 res;uniform vec4 geo;uniform float time,amp;uniform vec2 wave;'
    + 'void main(){vec2 s=vec2(gl_FragCoord.x,res.y-gl_FragCoord.y)/geo.w;float ch=res.y/geo.w;'
    + 'float ph=time/wave.y+(s.y/ch)*wave.x;float dx=-amp*cos(6.2831853*ph);'
    + 'vec2 uv=vec2((s.x-geo.x-dx)/geo.y,s.y/geo.z);'
    + 'if(uv.x<0.||uv.x>1.||uv.y>1.)discard;gl_FragColor=texture2D(t,uv);}';
  function shader(type, src){
    const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
    if(!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  }
  let prog, U = {}, tex = {}, geo = null, raf = null, last = 0;
  function init(){
    prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if(!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    ['t','res','geo','time','amp','wave'].forEach(n=>{ U[n] = gl.getUniformLocation(prog, n); });
    gl.uniform1i(U.t, 0);
    gl.uniform2f(U.wave, WAVE_CYCLES, DURATION_S);
    gl.clearColor(0,0,0,0);
    tex = {};
  }
  function texture(im){
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, im);
    return t;
  }
  try{ init(); }catch(e){ statique(); return; }
  function layout(){
    const app = document.getElementById('app');
    const cw = app.clientWidth, ch = app.clientHeight;
    if(cw<=0 || ch<=0) return;
    const wide = cw > ch;
    const src = wide ? imgWide : img;
    const iw = src.naturalWidth, ih = src.naturalHeight;
    if(!iw || !ih) return;
    cvs.classList.toggle('wide', wide);
    if(fill) fill.classList.toggle('wide', wide);
    const scale = Math.max(cw/iw, ch/ih);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pw = Math.round(cw*dpr), ph = Math.round(ch*dpr);
    if(cvs.width !== pw || cvs.height !== ph){ cvs.width = pw; cvs.height = ph; }
    gl.viewport(0, 0, pw, ph);
    const key = wide ? 'wide' : 'tall';
    if(!tex[key]) tex[key] = texture(src);
    gl.bindTexture(gl.TEXTURE_2D, tex[key]);
    gl.uniform2f(U.res, pw, ph);
    gl.uniform4f(U.geo, (cw - iw*scale)/2, iw*scale, ih*scale, dpr);
    geo = true;
    start();
  }
  function actif(){ return !reduce.matches && !html.classList.contains('eco') && !document.hidden; }
  function draw(now){
    if(!geo) return;
    gl.uniform1f(U.time, (now/1000) % DURATION_S);
    gl.uniform1f(U.amp, actif() ? AMP : 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function tick(now){
    raf = null;
    if(!actif()){ draw(now); return; }
    if(now - last >= 1000/FPS){ last = now; draw(now); }
    raf = requestAnimationFrame(tick);
  }
  function start(){
    if(!geo) return;
    if(!actif()){ draw(performance.now()); return; }
    if(raf === null) raf = requestAnimationFrame(tick);
  }
  new MutationObserver(start).observe(html, {attributes:true, attributeFilter:['class']});
  document.addEventListener('visibilitychange', start);
  if(reduce.addEventListener) reduce.addEventListener('change', start);
  cvs.addEventListener('webglcontextlost', ()=>{
    geo = null; if(raf !== null){ cancelAnimationFrame(raf); raf = null; }
    statique();
  }, false);
  window.addEventListener('resize', layout, {passive:true});
  window.addEventListener('orientationchange', ()=>setTimeout(layout,150), {passive:true});
  if(window.ResizeObserver){ new ResizeObserver(layout).observe(document.getElementById('app')); }
  img.onload = layout;
  imgWide.onload = layout;
  img.src = '../assets/bg/dragon_sky.jpg';
  imgWide.src = '../assets/bg/dragon_sky_wide.jpg';
}
