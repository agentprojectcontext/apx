// The agent's cursor: a pointer drawn over the screen where an agent is about to click, so the owner sees what it does.
// It stays on screen while the agent keeps working (gone after a minute idle or on the stop); its note fades sooner.
// A transparent window that lets every click through, kept out of screen pictures (content protection), on the screen
// of the point.
import fs from "node:fs";
import path from "node:path";
import { BrowserWindow, screen } from "electron";

/** APX's mark, inline (the cursor page loads nothing from outside). */
function mark(): string {
  try {
    return fs
      .readFileSync(path.join(import.meta.dirname, "logo-green.svg"), "utf8")
      .replace(/<title[^>]*>.*?<\/title>/s, "")
      .replace("<svg ", '<svg width="14" height="14" ');
  } catch {
    return "";
  }
}

/**
 * APX's own pointer: a white arrow with a thick rounded edge in APX's lime (outlined dark, to read on light pages), a soft glow and three twinkling sparks, a dark
 * bubble with APX's mark for what the agent is doing, and a green ring when it clicks.
 */
const PAGE = () => `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;font:600 12px/1.25 -apple-system,system-ui}
#c{position:absolute;left:0;top:0;transform:translate(-100px,-100px);transition:transform .25s cubic-bezier(.2,.8,.2,1),opacity .3s;opacity:0}
#p{display:block;overflow:visible;filter:drop-shadow(0 0 5px rgba(128,255,0,.7)) drop-shadow(0 2px 4px rgba(0,0,0,.35))}
.sp{transform-box:fill-box;transform-origin:center;animation:tw 1.8s ease-in-out infinite}
.sp2{animation-delay:.6s}.sp3{animation-delay:1.2s}
@keyframes tw{0%,100%{opacity:.55;transform:scale(.75)}50%{opacity:1;transform:scale(1.15)}}
#l{transition:opacity .4s;position:absolute;left:36px;top:30px;display:flex;align-items:center;gap:6px;max-width:280px;padding:5px 10px 5px 7px;border-radius:4px 12px 12px 12px;background:rgba(10,16,12,.92);border:1px solid rgba(128,255,0,.55);color:#eaffd6;box-shadow:0 4px 14px rgba(0,0,0,.4)}
#l svg{flex:none}
#t{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#r{position:absolute;left:-11px;top:-12px;width:32px;height:32px;border-radius:50%;border:2.5px solid #80ff00;box-shadow:0 0 10px rgba(128,255,0,.7);opacity:0}
#r.on{animation:ring .6s ease-out}
@keyframes ring{0%{opacity:1;transform:scale(.35)}100%{opacity:0;transform:scale(1.7)}}
</style></head><body><div id="c"><div id="r"></div>
<svg id="p" width="34" height="34" viewBox="0 0 34 34">
<path d="M5 4.2 24.6 18.6c.8.6.5 1.8-.5 2l-8 1.6c-.4.1-.7.3-.9.6l-4.7 6.6c-.6.8-1.8.6-2-.4L4.1 5.3c-.2-.9.6-1.6.9-1.1z" fill="none" stroke="#0e1a10" stroke-width="5" stroke-linejoin="round"/>
<path d="M5 4.2 24.6 18.6c.8.6.5 1.8-.5 2l-8 1.6c-.4.1-.7.3-.9.6l-4.7 6.6c-.6.8-1.8.6-2-.4L4.1 5.3c-.2-.9.6-1.6.9-1.1z" fill="#fff" stroke="#80ff00" stroke-width="3" stroke-linejoin="round"/>
<path class="sp" d="M28 21.5l1 2.4 2.4 1-2.4 1-1 2.4-1-2.4-2.4-1 2.4-1z" fill="#80ff00" stroke="#0e1a10" stroke-width=".5" stroke-linejoin="round"/>
<path class="sp sp2" d="M22.5 26.5l.7 1.7 1.7.7-1.7.7-.7 1.7-.7-1.7-1.7-.7 1.7-.7z" fill="#80ff00" stroke="#0e1a10" stroke-width=".5" stroke-linejoin="round"/>
<path class="sp sp3" d="M27.3 30.2l.45 1.05 1.05.45-1.05.45-.45 1.05-.45-1.05-1.05-.45 1.05-.45z" fill="#80ff00" stroke="#0e1a10" stroke-width=".5" stroke-linejoin="round"/>
</svg>
<div id="l">${mark()}<span id="t"></span></div></div>
<script>
const c=document.getElementById("c"),l=document.getElementById("l"),t=document.getElementById("t"),r=document.getElementById("r");let tl,tc;
const keep=()=>{c.style.opacity=1;clearTimeout(tc);tc=setTimeout(()=>c.style.opacity=0,60000)};
const note=(s)=>{t.textContent=s||"";l.style.display=s?"flex":"none";l.style.opacity=1;clearTimeout(tl);tl=setTimeout(()=>l.style.opacity=0,3500)};
window.moveTo=(x,y,label)=>{keep();c.style.transform="translate("+(x-5)+"px,"+(y-4)+"px)";note(label)};
window.pulse=()=>{keep();r.classList.remove("on");void r.offsetWidth;r.classList.add("on")};
window.setLabel=(s)=>{keep();note(s)};
</script></body></html>`;

export type AgentCursor = ReturnType<typeof createCursor>;

export function createCursor() {
  let win: BrowserWindow | undefined;
  let display: number | undefined;
  /** Where the pointer was last put (screen points), so a note can show there. */
  let at: { x: number; y: number } | undefined;

  async function onScreenOf(x: number, y: number): Promise<{ w: BrowserWindow; lx: number; ly: number }> {
    const d = screen.getDisplayNearestPoint({ x, y });
    if (!win || win.isDestroyed()) {
      win = new BrowserWindow({
        ...d.bounds,
        transparent: true,
        frame: false,
        focusable: false,
        hasShadow: false,
        resizable: false,
        skipTaskbar: true,
        show: false,
        webPreferences: { sandbox: true, contextIsolation: true },
      });
      win.setIgnoreMouseEvents(true);
      win.setAlwaysOnTop(true, "screen-saver");
      // At this level macOS lets it cover the menu bar too; asked before, it moved the window down under it.
      win.setBounds(d.bounds);
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      // Out of every screen picture: the agent must not see its own pointer.
      win.setContentProtection(true);
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE())}`);
      display = d.id;
    } else if (display !== d.id) {
      win.setBounds(d.bounds);
      display = d.id;
    }
    // Above every window, every time: an app brought forward must not cover it.
    win.setAlwaysOnTop(true, "screen-saver");
    win.showInactive();
    // From where the window really is: macOS may keep it off the menu bar, and the pointer must land on the point.
    const at = win.getBounds();
    return { w: win, lx: x - at.x, ly: y - at.y };
  }

  const run = (js: string) => win?.webContents.executeJavaScript(js).catch(() => {});

  return {
    /** Glides the pointer to a screen point, then waits for it to land. */
    async moveTo(x: number, y: number, label: string): Promise<void> {
      at = { x, y };
      const { lx, ly } = await onScreenOf(x, y);
      await run(`moveTo(${Math.round(lx)},${Math.round(ly)},${JSON.stringify(label.slice(0, 80))})`);
      await new Promise((r) => setTimeout(r, 250));
    },
    pulse: () => void run("pulse()"),
    /** A note beside the pointer where it is (or mid-screen the first time): what the agent is doing now. */
    say(s: string) {
      const p =
        at ??
        (() => {
          const d = screen.getPrimaryDisplay().bounds;
          return { x: d.x + d.width / 2, y: d.y + d.height / 2 };
        })();
      void onScreenOf(p.x, p.y).then(({ lx, ly }) =>
        run(`moveTo(${Math.round(lx)},${Math.round(ly)},${JSON.stringify(s.slice(0, 80))})`),
      );
    },
    hide: () => win?.hide(),
    close: () => win?.destroy(),
  };
}
