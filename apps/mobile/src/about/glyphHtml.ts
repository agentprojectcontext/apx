import type { Scene } from "./scenes.ts";

type Eyes = { color: string; eyes: Array<{ x: number; y: number; w: number; h: number; rx: number }> };

/**
 * A self-contained page for the About portrait: an agent's face drawn with the text of its own markdown file, as on
 * the landing. It cycles through `scenes`, and a finger scatters the characters it passes over. No network, no
 * navigation: everything it draws is inlined.
 */
export function glyphHtml({
  scenes,
  faces,
  eyes,
  drawnWith,
  background,
}: {
  scenes: Scene[];
  faces: Record<string, string>;
  eyes: Record<string, Eyes | undefined>;
  /** "drawn with", before the file name. */
  drawnWith: string;
  background: string;
}): string {
  const data = JSON.stringify({
    scenes,
    faces: Object.fromEntries(scenes.map((s) => [s.key, faces[s.key]])),
    eyes: Object.fromEntries(scenes.map((s) => [s.key, eyes[s.key]])),
    drawnWith,
  }).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
html,body{margin:0;height:100%;background:${background};overflow:hidden;-webkit-user-select:none;user-select:none}
canvas{display:block;width:100%;height:calc(100% - 30px);touch-action:none}
#tag{height:30px;display:flex;align-items:center;justify-content:center}
#tag span{font:11px ui-monospace,Menlo,monospace;color:#a6a59f;border:1px solid #3b3b38;border-radius:999px;padding:3px 10px;background:${background}}
</style></head><body><canvas id="c"></canvas><div id="tag"><span id="t"></span></div>
<script>
var D=${data};
var RAND='01#%&*+=<>{}[]/\\\\|~:;abcdefghijklmnopqrstuvwxyz';
var cv=document.getElementById('c'),ctx=cv.getContext('2d'),tag=document.getElementById('t');
var G={cols:0,rows:0,cell:8,lh:10.4,cells:[],w:0,h:0,dpr:1,mx:-1e4,my:-1e4},faces={},i=0,timer=0;
function face(key){
  if(!faces[key])faces[key]=new Promise(function(res){var im=new Image();im.onload=function(){
    var oc=document.createElement('canvas');oc.width=oc.height=256;var o=oc.getContext('2d');o.drawImage(im,0,0,256,256);
    var e=D.eyes[key];if(e){o.fillStyle=e.color;e.eyes.forEach(function(r){o.beginPath();if(o.roundRect)o.roundRect(r.x,r.y,r.w,r.h,r.rx);else o.rect(r.x,r.y,r.w,r.h);o.fill();});}
    res(oc);};im.src=D.faces[key];});
  return faces[key];
}
function size(){
  var r=cv.getBoundingClientRect();G.dpr=Math.min(3,devicePixelRatio||1);G.w=r.width;G.h=r.height;
  cv.width=Math.round(r.width*G.dpr);cv.height=Math.round(r.height*G.dpr);
  G.cell=r.width<440?7:9;G.lh=G.cell*1.3;G.cols=Math.floor(G.w/G.cell);G.rows=Math.floor(G.h/G.lh);G.cells=[];
  for(var k=0;k<G.cols*G.rows;k++)G.cells.push({ch:' ',to:' ',r:70,g:76,b:82,a:0,tr:70,tg:76,tb:82,ta:.3,sw:0});
}
function target(s){
  var cols=G.cols,rows=G.rows;
  face(s.key).then(function(im){
    if(cols!==G.cols||rows!==G.rows)return;
    var oc=document.createElement('canvas');oc.width=cols;oc.height=rows;var o=oc.getContext('2d',{willReadFrequently:true});
    var sw=Math.min(cols,rows*1.3)*1.05,sh=sw/1.3;
    o.drawImage(im,(cols-sw)/2,(rows-sh)/2,sw,sh);
    var px=o.getImageData(0,0,cols,rows).data,text=s.text.replace(/\\s+/g,' '),ti=0,now=performance.now();
    for(var k=0;k<G.cells.length;k++){
      var c=G.cells[k],R=px[k*4],Gg=px[k*4+1],B=px[k*4+2],A=px[k*4+3]/255,lum=(R*.3+Gg*.59+B*.11)/255;
      if(A>.4&&lum>.12){var ch=text[ti++%text.length];if(ch===' ')ch='·';var bo=1.15+(1-lum)*.6;
        c.to=ch;c.tr=Math.min(255,R*bo+12);c.tg=Math.min(255,Gg*bo+12);c.tb=Math.min(255,B*bo+12);c.ta=.62+lum*.38;}
      else if(A>.4){c.to=' ';c.ta=0;}
      else{c.to=((k*7919)%23===0)?'.':' ';c.tr=90;c.tg=98;c.tb=106;c.ta=.35;}
      c.sw=now+Math.random()*500+(k%cols)/cols*500;
    }
  });
}
function draw(t){
  requestAnimationFrame(draw);if(!G.cols)return;
  ctx.setTransform(G.dpr,0,0,G.dpr,0,0);ctx.clearRect(0,0,G.w,G.h);
  ctx.font='600 '+(G.cell+2)+'px ui-monospace,Menlo,monospace';ctx.textBaseline='top';ctx.textAlign='center';
  var R2=70*70,k=.1;
  for(var y=0;y<G.rows;y++)for(var x=0;x<G.cols;x++){
    var c=G.cells[y*G.cols+x],px=x*G.cell+G.cell/2,py=y*G.lh;
    c.r+=(c.tr-c.r)*k;c.g+=(c.tg-c.g)*k;c.b+=(c.tb-c.b)*k;c.a+=(c.ta-c.a)*k;
    var g=c.ch,a=c.a,ox=0,oy=0;
    if(t>c.sw&&c.ch!==c.to){if(t-c.sw<280){g=RAND[(Math.random()*RAND.length)|0];a=Math.max(a,.5);}else{c.ch=c.to;g=c.to;}}
    var dx=px-G.mx,dy=py-G.my,d2=dx*dx+dy*dy;
    if(d2<R2){var f=1-d2/R2;ox=dx*f*.45;oy=dy*f*.45;if(g!==' '){a=Math.min(1,a+f*.5);if(Math.random()<f*.25)g=RAND[(Math.random()*RAND.length)|0];}}
    if(g===' '||a<.02)continue;
    ctx.fillStyle='rgba('+(c.r|0)+','+(c.g|0)+','+(c.b|0)+','+a.toFixed(2)+')';ctx.fillText(g,px+ox,py+oy);
  }
}
function show(){var s=D.scenes[i%D.scenes.length];tag.textContent=D.drawnWith+' '+s.file;target(s);i++;clearTimeout(timer);timer=setTimeout(show,5500);}
function point(e){var r=cv.getBoundingClientRect();G.mx=e.clientX-r.left;G.my=e.clientY-r.top;}
function away(){G.mx=G.my=-1e4;}
cv.addEventListener('pointerdown',point);cv.addEventListener('pointermove',point);
cv.addEventListener('pointerup',away);cv.addEventListener('pointercancel',away);cv.addEventListener('pointerleave',away);
size();show();requestAnimationFrame(draw);
addEventListener('resize',function(){size();target(D.scenes[(i+D.scenes.length-1)%D.scenes.length]);});
</script></body></html>`;
}
