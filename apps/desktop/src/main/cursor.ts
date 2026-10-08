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
 * APX's own pointer: a rounded arrow in the brand's lime with a soft glow, a dark bubble with APX's mark for what the
 * agent is doing, and a lime ring when it clicks.
 */
const PAGE = () => `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;font:600 12px/1.25 -apple-system,system-ui}
#c{position:absolute;left:0;top:0;transform:translate(-100px,-100px);transition:transform .25s cubic-bezier(.2,.8,.2,1),opacity .3s;opacity:0}
#p{display:block;filter:drop-shadow(0 0 6px rgba(128,255,0,.55)) drop-shadow(0 3px 5px rgba(0,0,0,.5));animation:breathe 2.4s ease-in-out infinite}
@keyframes breathe{0%,100%{filter:drop-shadow(0 0 4px rgba(128,255,0,.45)) drop-shadow(0 3px 5px rgba(0,0,0,.5))}50%{filter:drop-shadow(0 0 9px rgba(128,255,0,.75)) drop-shadow(0 3px 5px rgba(0,0,0,.5))}}
#l{transition:opacity .4s;position:absolute;left:24px;top:24px;display:flex;align-items:center;gap:6px;max-width:280px;padding:5px 10px 5px 7px;border-radius:4px 12px 12px 12px;background:rgba(10,16,12,.92);border:1px solid rgba(128,255,0,.55);color:#eaffd6;box-shadow:0 4px 14px rgba(0,0,0,.4)}
#l svg{flex:none}
#t{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#r{position:absolute;left:-13px;top:-14px;width:32px;height:32px;border-radius:50%;border:2.5px solid #80ff00;box-shadow:0 0 10px rgba(128,255,0,.7);opacity:0}
#r.on{animation:ring .6s ease-out}
@keyframes ring{0%{opacity:1;transform:scale(.35)}100%{opacity:0;transform:scale(1.7)}}
</style></head><body><div id="c"><div id="r"></div>
<svg id="p" width="26" height="30" viewBox="0 0 26 30"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b6ff5c"/><stop offset=".55" stop-color="#80ff00"/><stop offset="1" stop-color="#3ec98b"/></linearGradient></defs>
<path d="M3.2 2.6c0-.9 1-1.4 1.7-.8l17 14.2c.7.6.3 1.8-.7 1.8h-7.1c-.4 0-.8.2-1 .5l-5.6 7.7c-.6.8-1.8.4-1.8-.6z" fill="url(#g)" stroke="#0b130d" stroke-width="1.6" stroke-linejoin="round"/>
<path d="M5.2 5.2v15.2" stroke="rgba(255,255,255,.55)" stroke-width="1.2" stroke-linecap="round"/></svg>
<div id="l">${mark()}<span id="t"></span></div></div>
<script>
const c=document.getElementById("c"),l=document.getElementById("l"),t=document.getElementById("t"),r=document.getElementById("r");let tl,tc;
const keep=()=>{c.style.opacity=1;clearTimeout(tc);tc=setTimeout(()=>c.style.opacity=0,60000)};
const note=(s)=>{t.textContent=s||"";l.style.display=s?"flex":"none";l.style.opacity=1;clearTimeout(tl);tl=setTimeout(()=>l.style.opacity=0,3500)};
window.moveTo=(x,y,label)=>{keep();c.style.transform="translate("+(x-3)+"px,"+(y-2)+"px)";note(label)};
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
