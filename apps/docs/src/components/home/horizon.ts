// The hero's "horizon": green light that hugs the top of the stage screenshot and fades down its sides, with a
// spectrum of bars on its edge, a beam on one side and sparks near the pointer. Light outside the card falls off with
// the true distance to its rounded box (no seam where the top edge meets the sides) and is gone by the card's bottom.
// WebGL; without it the page keeps its CSS glow. Still (one frame on each change) when motion is reduced.
const FRAG = [
  "precision highp float;",
  "uniform vec2 R; uniform float T; uniform vec2 M; uniform float E; uniform float HZ; uniform float BX; uniform vec4 CB; uniform float CH; uniform vec3 C1; uniform vec3 C2; uniform vec3 C3;",
  "float h1(float n){return fract(sin(n)*43758.5453);}",
  "float h2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}",
  "float n1(float x){float i=floor(x),f=fract(x);f=f*f*(3.-2.*f);return mix(h1(i),h1(i+1.),f);}",
  "float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h2(i),h2(i+vec2(1.,0.)),f.x),mix(h2(i+vec2(0.,1.)),h2(i+1.),f.x),f.y);}",
  "float sdRB(vec2 p,vec2 b,float r){vec2 q=abs(p)-b+r;return length(max(q,0.))+min(max(q.x,q.y),0.)-r;}",
  "void main(){",
  " vec2 fc=gl_FragCoord.xy; vec2 p=fc/R; float y=1.-p.y; float asp=R.x/R.y; float x=(p.x-.5)*asp;",
  " float mx=(M.x-.5)*asp; float my=M.y; float en=E; float bx0=(BX-.5)*asp;",
  " float hov=exp(-pow((my-HZ)*9.,2.))*en;",
  " float rip=sin(abs(x-mx)*60.-T*9.)*exp(-abs(x-mx)*5.)*hov*.006;",
  " float dy=y-HZ+rip; float up=max(0.,-dy);",
  " float cl=(CB.x-.5)*asp, cr=(CB.y-.5)*asp, ccx=(cl+cr)*.5, chw=(cr-cl)*.5, rad=CB.w;",
  " vec2 bp=vec2(x-ccx,y-(HZ+CH*.5)+rip); float sd=sdRB(bp,vec2(chw,CH*.5),rad);",
  " float depth=max(0.,y-HZ); float sidefade=1.-smoothstep(0.,CH,depth); sidefade*=sidefade;",
  " float osoft=smoothstep(-.004,.03,sd)*sidefade;",
  " float od=max(sd,0.); float su=sqrt(od*od+.0009)-.03;",
  " float onTop=step(abs(x-ccx),chw-rad*.5);",
  " float wenv=exp(-pow(max(0.,abs(x-ccx)-chw),2.)*30.)*smoothstep(-.02,0.,-max(0.,abs(x-ccx)-chw)*0.)+0.;",
  " float ix=x-bx0;",
  " float breathe=.9+.1*sin(T*.6);",
  " float line=exp(-max(sd,0.)*R.y*.045)*step(0.,sd)*sidefade*breathe;",
  " float core=exp(-abs(sd)*R.y*.38)*sidefade*(.55+.45*exp(-ix*ix*2.))*(1.+hov*exp(-abs(x-mx)*6.));",
  " float ang=atan(ix,up+.03);",
  " float rays=.45+.55*n2(vec2(ang*8.,T*.12))*n2(vec2(ang*21.+3.,T*.23+1.));",
  " float fan=exp(-su*3.2)*exp(-ix*ix*3.)*rays*osoft;",
  " float halo=exp(-su*5.)*exp(-ix*ix*1.2)*osoft;",
  " float below=0.;",
  " float bnear=exp(-pow((mx-bx0)*5.,2.))*en;",
  " float pull=(mx-bx0)*.25*bnear*exp(-pow(y-my,2.)*14.);",
  " float bx=bx0+sin(y*6.+T*.7)*.006+sin(y*17.-T*1.3)*.003+pull;",
  " float vfall=smoothstep(0.,HZ,y)*exp(-depth*R.y*.03)*sidefade;",
  " float flick=.82+.18*n1(T*7.+y*40.);",
  " float vb=exp(-abs(x-bx)*R.x*.01)*vfall*(.55+.45*smoothstep(0.,HZ,y))*(1.+bnear*.8);",
  " float vcore=exp(-abs(x-bx)*R.x*.11)*vfall*smoothstep(-.05,HZ,y)*(1.+bnear);",
  " float pulseY=.3+.7*fract(T*.35); float pulse=exp(-pow((y/HZ-pulseY)*18.,2.))*vfall*exp(-abs(x-bx)*R.x*.05);",
  " float colw=3.2/R.x*asp; float ci=floor(x/colw);",
  " float sh=n1(ci*.37+T*1.9)*n1(ci*.11-T*.55)*n1(ci*.07+T*.3);",
  " float mprox=exp(-pow((x-mx)*3.2,2.))*en;",
  " float spikeH=(.004+.09*pow(sh,2.4)*(1.+3.5*mprox*hov/max(en,.001)))*(exp(-ix*ix*4.)*.9+exp(-x*x*3.)*.4);",
  " float inCol=(1.-smoothstep(.25,.5,abs(fract(x/colw)-.5)))*onTop;",
  " float spike=inCol*(1.-smoothstep(0.,spikeH,abs(dy)));",
  " vec2 g=vec2(x*16.,y*16.+T*1.1); vec2 gi=floor(g); vec2 gf=fract(g);",
  " vec2 pp=vec2(h2(gi+3.1),h2(gi+7.7)); float rnd=h2(gi);",
  " float ember=smoothstep(.07,0.,length(gf-pp))*step(.95-.07*(en+bnear),rnd)*exp(-od*2.5)*osoft*(exp(-ix*ix*6.)*(.6+bnear*2.)+exp(-pow(x-mx,2.)*12.)*hov*1.5);",
  " vec3 col=vec3(0.);",
  " col+=C1*fan*.42*(.6+en*.8);",
  " col+=mix(C1,vec3(1.),.35)*halo*.5;",
  " col+=mix(C2,C1,.65)*line*1.15;",
  " col+=vec3(1.)*core*1.25;",
  " col+=C1*vb*.45*flick+vec3(.88,1.,.93)*vcore*.95*flick+vec3(1.)*pulse*.8;",
  " col+=mix(C1,mix(C2,C3,step(0.,x)),smoothstep(.0,.7,abs(x)))*spike*(.85+mprox*1.2);",
  " col+=C1*below;",
  " col+=vec3(.85,1.,.9)*ember;",
  " col+=C2*exp(-su*2.)*exp(-pow(ix+.25,2.)*6.)*.12*osoft;",
  " col+=C1*exp(-abs(x-mx)*7.)*exp(-abs(sd)*R.y*.08)*hov*.9*sidefade;",
  " col*=1.-step(sd,-.004);",
  " col+=(h2(fc+fract(T))-.5)/255.;",
  " float a=clamp(max(col.r,max(col.g,col.b)),0.,1.);",
  " gl_FragColor=vec4(min(col,vec3(a)),a);",
  "}",
].join("\n");

/** The card as fractions of the canvas: left, right, top, corner radius and height. */
type Card = () => [number, number, number, number, number] | null;

/** Starts the effect on `canvas`; returns false when WebGL is unavailable. */
export function startHorizon(canvas: HTMLCanvasElement, card: Card): boolean {
  // Readers saving data keep the CSS glow; phones get a lighter frame (1x pixels, about 30 fps).
  if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return false;
  const light = matchMedia("(max-width: 760px), (pointer: coarse)").matches;
  const g = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!g) return false;
  const shader = (type: number, source: string) => {
    const s = g.createShader(type);
    if (!s) return null;
    g.shaderSource(s, source);
    g.compileShader(s);
    return g.getShaderParameter(s, g.COMPILE_STATUS) ? s : null;
  };
  const vs = shader(g.VERTEX_SHADER, "attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}");
  const fs = shader(g.FRAGMENT_SHADER, FRAG);
  const program = g.createProgram();
  if (!vs || !fs || !program) return false;
  g.attachShader(program, vs);
  g.attachShader(program, fs);
  g.linkProgram(program);
  if (!g.getProgramParameter(program, g.LINK_STATUS)) return false;
  g.useProgram(program);
  g.bindBuffer(g.ARRAY_BUFFER, g.createBuffer());
  g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
  const at = g.getAttribLocation(program, "a");
  g.enableVertexAttribArray(at);
  g.vertexAttribPointer(at, 2, g.FLOAT, false, 0, 0);
  const u = (name: string) => g.getUniformLocation(program, name);
  const U = {
    R: u("R"),
    T: u("T"),
    M: u("M"),
    E: u("E"),
    HZ: u("HZ"),
    BX: u("BX"),
    CB: u("CB"),
    CH: u("CH"),
    C1: u("C1"),
    C2: u("C2"),
    C3: u("C3"),
  };

  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Token colours, read again when the theme changes.
  const probe = (v: string) => {
    const i = document.createElement("i");
    i.style.color = v;
    document.body.appendChild(i);
    const rgb = (getComputedStyle(i).color.match(/[\d.]+/g) ?? ["0", "0", "0"]).slice(0, 3).map((n) => Number(n) / 255);
    i.remove();
    return rgb;
  };
  let theme = "";
  let colors: number[][] = [];
  const mouse = { x: 0.5, y: 0.3, in: false };
  let energy = 0;
  const t0 = performance.now();
  if (!reduce)
    addEventListener(
      "pointermove",
      (e) => {
        const r = canvas.getBoundingClientRect();
        mouse.x = (e.clientX - r.left) / r.width;
        mouse.y = (e.clientY - r.top) / r.height;
        mouse.in = mouse.x >= 0 && mouse.x <= 1 && mouse.y >= 0 && mouse.y <= 1;
      },
      { passive: true },
    );

  let raf = 0;
  let visible = true;
  let lastFrame = 0;
  const draw = (now: number) => {
    raf = 0;
    if (light && now - lastFrame < 30 && lastFrame) {
      wake();
      return;
    }
    lastFrame = now;
    const mode = document.documentElement.dataset.theme ?? "";
    if (mode !== theme) {
      theme = mode;
      colors = ["var(--apx-brand)", "var(--apx-info)", "var(--apx-violet)"].map(probe);
    }
    const dpr = light ? 1 : Math.min(1.5, devicePixelRatio || 1);
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    g.viewport(0, 0, w, h);
    g.clearColor(0, 0, 0, 0);
    g.clear(g.COLOR_BUFFER_BIT);
    const box = card() ?? [0.08, 0.92, 0.62, 0.025, 0.3];
    const cw = canvas.clientWidth;
    const beam = cw < 760 ? 0.92 : cw < 1200 ? 0.9 : 0.82;
    const target = mouse.in
      ? Math.max(0, 1 - Math.min(Math.abs(mouse.y - box[2]) / 0.3, Math.abs(mouse.x - beam) / 0.18))
      : 0;
    energy += (target - energy) * 0.05;
    g.uniform2f(U.R, w, h);
    g.uniform1f(U.T, reduce ? 4 : (now - t0) / 1000);
    g.uniform2f(U.M, mouse.x, mouse.y);
    g.uniform1f(U.E, energy);
    g.uniform1f(U.HZ, box[2]);
    g.uniform1f(U.BX, beam);
    g.uniform4f(U.CB, box[0], box[1], box[2], box[3]);
    g.uniform1f(U.CH, box[4]);
    g.uniform3fv(U.C1, colors[0] ?? [0, 0, 0]);
    g.uniform3fv(U.C2, colors[1] ?? [0, 0, 0]);
    g.uniform3fv(U.C3, colors[2] ?? [0, 0, 0]);
    g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
    if (visible && !reduce && !document.hidden) wake();
  };
  const wake = () => {
    if (!raf) raf = requestAnimationFrame(draw);
  };
  new IntersectionObserver(([entry]) => {
    visible = Boolean(entry?.isIntersecting);
    if (visible) wake();
  }).observe(canvas);
  document.addEventListener("visibilitychange", wake);
  addEventListener("resize", wake);
  // The card's size changes when its screenshot loads or the layout reflows.
  new ResizeObserver(wake).observe(document.body);
  // With reduced motion the frame is redrawn only when the layout or theme may have changed.
  if (reduce) {
    addEventListener("scroll", wake, { passive: true });
    new MutationObserver(wake).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }
  wake();
  return true;
}
