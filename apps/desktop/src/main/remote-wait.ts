// A remote APX (an address, or one over SSH) the window waits for: the screen says so and it retries until the server
// answers, then loads the panel. A server restarting after an update, or this app restarting, comes back on its own.
import type { Tunnel } from "./ssh-tunnel.ts";

export type Remote = {
  /** Where, as the screen names it ("ops@box (SSH)"). */
  where: string;
  url: string;
  /** The SSH forward, when there is one. */
  tunnel?: Pick<Tunnel, "alive" | "problem" | "restart">;
};

export type WaitDeps = {
  /** Still the connection the owner chose (a change of connection ends the wait). */
  current(): boolean;
  isUp(url: string): Promise<boolean>;
  load(url: string): Promise<boolean>;
  /** Puts the waiting text on screen. */
  show(w: Waiting): Promise<void>;
  sleep(ms: number): Promise<void>;
  now(): number;
  es: boolean;
};

export const RETRY_MS = 1500;
/** A forward that stays up this long with nothing answering through it may be half dead: ssh starts again. */
export const SILENT_MS = 30_000;

/** True once the panel loaded and the connection is still the one asked for. */
export async function reachRemote(remote: Remote, d: WaitDeps): Promise<boolean> {
  const linked = () => remote.tunnel?.alive() ?? true;
  let shown: string | undefined;
  let silentSince = d.now();
  while (d.current()) {
    if (!linked()) silentSince = d.now();
    else if (await d.isUp(remote.url)) {
      if (!d.current()) return false;
      if ((await d.load(remote.url)) && linked()) return d.current();
      // A failed load left its own (blank) page: the waiting text goes back on screen.
      shown = undefined;
    } else if (remote.tunnel && d.now() - silentSince >= SILENT_MS) {
      remote.tunnel.restart();
      silentSince = d.now();
    }
    if (!d.current()) return false;
    const now = waiting(remote, linked(), d.es);
    const text = waitingText(now);
    if (text !== shown) {
      shown = text;
      await d.show(now);
    }
    await d.sleep(RETRY_MS);
  }
  return false;
}

/** What the waiting screen says, in parts so the page can lay them out. */
export type Waiting = { title: string; where: string; status: string; detail?: string; hint: string };

export function waiting(remote: Remote, linked: boolean, es: boolean): Waiting {
  const problem = linked ? undefined : remote.tunnel?.problem();
  const status = !remote.tunnel
    ? es
      ? "Esperando que el servidor responda."
      : "Waiting for the server to answer."
    : linked
      ? es
        ? "La conexión SSH está lista. Esperando que APX responda en el servidor; puede estar reiniciándose después de una actualización."
        : "The SSH connection is up. Waiting for APX on the server to answer; it may be restarting after an update."
      : es
        ? "Esperando la conexión SSH con el servidor. Puede estar reiniciándose o sin red por un momento."
        : "Waiting for the SSH connection to the server. It may be restarting or briefly offline.";
  return {
    title: es ? "Conectando con APX" : "Connecting to APX",
    where: remote.where,
    status,
    ...(problem ? { detail: problem } : {}),
    hint: es
      ? "Se abre solo cuando responde. Para elegir otro APX: menú APX › Cambiar conexión."
      : "It opens by itself once it answers. To pick another APX: APX menu › Change connection.",
  };
}

export function waitingText(w: Waiting): string {
  return [w.title, w.where, w.status, w.detail, w.hint].filter(Boolean).join(" ");
}

const esc = (t: string) => t.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** The waiting screen: a calm card in the app's colors, with ssh's own words kept small. */
export function waitingHtml(w: Waiting, es: boolean): string {
  const detail = w.detail ? `<p class="detail"><span>${es ? "Detalle" : "Details"}</span>${esc(w.detail)}</p>` : "";
  return `<!doctype html><html lang="${es ? "es" : "en"}"><head><meta charset="utf-8"><title>APX</title><style>
:root{color-scheme:light dark;--bg:#f6f5f2;--card:#fff;--fg:#1f1e1c;--muted:#6b6963;--line:#e6e3dc;--accent:#d97757}
@media (prefers-color-scheme:dark){:root{--bg:#1a1a19;--card:#232321;--fg:#ecebe7;--muted:#9c9a93;--line:#34332f}}
*{box-sizing:border-box}html,body{height:100%;margin:0}
body{background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,sans-serif;display:flex;align-items:center;
justify-content:center;padding:48px 16px 16px;-webkit-app-region:drag;user-select:none}
.card{width:min(440px,100%);background:var(--card);border:1px solid var(--line);border-radius:14px;padding:28px 28px 22px;
text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.08)}
.spin{width:28px;height:28px;margin:0 auto 16px;border-radius:50%;border:3px solid var(--line);border-top-color:var(--accent);
animation:r 1s linear infinite}@keyframes r{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.spin{animation-duration:3s}}
h1{font-size:17px;font-weight:600;margin:0 0 6px}
.where{display:inline-block;font:12px ui-monospace,Menlo,monospace;color:var(--muted);border:1px solid var(--line);
border-radius:999px;padding:2px 10px;margin-bottom:14px}
.status{margin:0 0 12px}
.detail{margin:0 0 14px;padding:8px 10px;border-radius:8px;background:var(--bg);color:var(--muted);
font:12px ui-monospace,Menlo,monospace;text-align:left;word-break:break-word;-webkit-app-region:no-drag;user-select:text}
.detail span{display:block;font:600 11px system-ui,sans-serif;margin-bottom:2px}
.hint{margin:0;font-size:12px;color:var(--muted)}
</style></head><body><main class="card" role="status" aria-live="polite"><div class="spin" aria-hidden="true"></div>
<h1>${esc(w.title)}</h1><div class="where">${esc(w.where)}</div><p class="status">${esc(w.status)}</p>${detail}
<p class="hint">${esc(w.hint)}</p></main></body></html>`;
}
