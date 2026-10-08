// The agent's cursor: a pointer drawn over the screen where an agent is about to click, so the owner sees what it does.
// It stays on screen while the agent keeps working (gone after a minute idle or on the stop); its note fades sooner.
// A transparent window that lets every click through, kept out of screen pictures (content protection), on the screen
// of the point.
import { BrowserWindow, screen } from "electron";

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;font:600 12px -apple-system,system-ui}
#c{position:absolute;left:0;top:0;transform:translate(-100px,-100px);transition:transform .25s cubic-bezier(.2,.8,.2,1),opacity .3s;opacity:0}
#c svg{filter:drop-shadow(0 2px 4px rgba(0,0,0,.45))}
#l{transition:opacity .4s;position:absolute;left:22px;top:20px;max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:4px 10px;border-radius:12px 12px 12px 4px;background:#2fb67c;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.3)}
#r{position:absolute;left:-14px;top:-14px;width:28px;height:28px;border-radius:50%;border:3px solid #2fb67c;opacity:0}
#r.on{animation:p .6s ease-out}
@keyframes p{0%{opacity:1;transform:scale(.4)}100%{opacity:0;transform:scale(1.6)}}
</style></head><body><div id="c"><div id="r"></div><svg width="22" height="26" viewBox="0 0 22 26"><path d="M2 2 L2 21 L7.5 16 L11 24 L14.5 22.5 L11 15 L18.5 15 Z" fill="#2fb67c" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg><div id="l"></div></div>
<script>
const c=document.getElementById("c"),l=document.getElementById("l"),r=document.getElementById("r");let tl,tc;
const keep=()=>{c.style.opacity=1;clearTimeout(tc);tc=setTimeout(()=>c.style.opacity=0,60000)};
const note=(s)=>{l.textContent=s||"";l.style.display=s?"block":"none";l.style.opacity=1;clearTimeout(tl);tl=setTimeout(()=>l.style.opacity=0,3500)};
window.moveTo=(x,y,label)=>{keep();c.style.transform="translate("+x+"px,"+y+"px)";note(label)};
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
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      // Out of every screen picture: the agent must not see its own pointer.
      win.setContentProtection(true);
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`);
      display = d.id;
    } else if (display !== d.id) {
      win.setBounds(d.bounds);
      display = d.id;
    }
    // Above every window, every time: an app brought forward must not cover it.
    win.setAlwaysOnTop(true, "screen-saver");
    win.showInactive();
    return { w: win, lx: x - d.bounds.x, ly: y - d.bounds.y };
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
