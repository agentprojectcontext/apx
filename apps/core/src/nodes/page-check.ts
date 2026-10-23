// Loads an artifact's page in a throwaway headless tab and reports what broke while it started: uncaught errors,
// rejected promises and console errors. The page gets a bridge like the panel's, answered by `onCall`, and no network.

type Send = <T>(method: string, params?: object, session?: string) => Promise<T>;
type Message = { method?: string; params?: unknown };
export type PageCdp = { send: Send; listen(session: string, fn: (m: Message) => void): () => void };
export type PageCall = (method: string, params: Record<string, unknown>) => Promise<unknown>;

/** How long a page may run its start-up code (loads, first queries) before it is judged. */
export const CHECK_WAIT_MS = 2_500;
const MAX_ERRORS = 8;

/** The bridge the panel gives a page (window.apx), with calls sent to the checker and fetch/WebSocket that never answer. */
const BRIDGE = `(function(){var ST={},seq=0,calls={};
window.__apxResult=function(id,ok,v){var c=calls[id];if(!c)return;delete calls[id];ok?c.ok(v):c.no(new Error(String(v)));};
function call(m,p){return new Promise(function(ok,no){var id=++seq;calls[id]={ok:ok,no:no};__apxCheck(JSON.stringify({id:id,method:String(m),params:p||{}}));});}
var state=Object.freeze({persistent:true,patch:function(p){for(var k in p){if(p[k]==null)delete ST[k];else ST[k]=p[k];}},
all:function(){return JSON.parse(JSON.stringify(ST));},get:function(k,d){return k in ST?ST[k]:d;},set:function(k,v){ST[k]=v;},
remove:function(k){delete ST[k];},on:function(){return function(){};}});
window.apx=Object.freeze({host:"apx",sendPrompt:function(){},media:function(){return new Promise(function(){});},state:state,call:call,
visible:function(){return true;},onVisibility:function(){return function(){};}});
window.fetch=function(){return new Promise(function(){});};
window.WebSocket=function(){this.send=function(){};this.close=function(){};this.addEventListener=function(){};};})();`;

/** The page as checked: the bridge first, before any of its own scripts. */
export function withBridge(html: string): string {
  const tag = `<script>${BRIDGE}</script>`;
  const head = /<head[^>]*>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + tag + html.slice(head.index + head[0].length);
  return tag + html;
}

type Details = { text?: string; exception?: { description?: string }; lineNumber?: number };
const describe = (d: Details) =>
  `${(d.exception?.description ?? d.text ?? "error").split("\n")[0]}${d.lineNumber ? ` (line ${d.lineNumber + 1})` : ""}`;

/** One view of an app as the check saw it: its trigger's label and what its panel shows. */
export type PageView = { view: string; text: string };
/** The errors a page threw while starting, the text it shows after, and each of an app's views. */
export type PageCheck = { errors: string[]; text: string; views: PageView[] };
const MAX_VIEWS = 12;

/** Clicks each distinct [data-view] trigger in turn and reads the panel it opens. */
const VIEW_WALK = `(async()=>{const seen=new Set(),out=[];
for(const b of document.querySelectorAll("[data-view]")){const v=b.dataset.view;if(!v||seen.has(v))continue;seen.add(v);
b.click();await new Promise(r=>setTimeout(r,400));
const p=document.querySelector('[data-view-panel="'+v+'"]');const t=((p||document.body).innerText||"").replace(/\\s+/g," ").trim();
out.push({view:(b.dataset.label||b.innerText||v).trim().slice(0,40)||v,text:t.slice(0,240)});}
const first=document.querySelector("[data-view]");if(first)first.click();return out;})()`;

export async function runPageCheck(
  cdp: PageCdp,
  html: string,
  onCall: PageCall,
  waitMs = CHECK_WAIT_MS,
): Promise<PageCheck> {
  const { browserContextId } = await cdp.send<{ browserContextId: string }>("Target.createBrowserContext", {
    disposeOnDetach: true,
  });
  const { targetId } = await cdp.send<{ targetId: string }>("Target.createTarget", {
    url: "about:blank",
    browserContextId,
  });
  const { sessionId } = await cdp.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
  const send = <T>(method: string, params?: object) => cdp.send<T>(method, params ?? {}, sessionId);
  const errors: string[] = [];
  let text = "";
  let views: PageView[] = [];
  const add = (e: string) => {
    if (errors.length < MAX_ERRORS && !errors.includes(e)) errors.push(e);
  };
  const stop = cdp.listen(sessionId, (m) => {
    if (m.method === "Runtime.exceptionThrown")
      add(describe((m.params as { exceptionDetails: Details }).exceptionDetails));
    if (m.method === "Runtime.consoleAPICalled") {
      const p = m.params as { type: string; args: { value?: unknown; description?: string }[] };
      if (p.type === "error")
        add(
          p.args
            .map((a) => String(a.value ?? a.description ?? ""))
            .join(" ")
            .slice(0, 300),
        );
    }
    if (m.method === "Runtime.bindingCalled") {
      const p = m.params as { name: string; payload: string };
      if (p.name !== "__apxCheck") return;
      const req = JSON.parse(p.payload) as { id: number; method: string; params: Record<string, unknown> };
      void onCall(req.method, req.params).then(
        (v) => answer(req.id, true, v),
        (e: unknown) => answer(req.id, false, e instanceof Error ? e.message : String(e)),
      );
    }
  });
  // A call that never resolves (a fetch) simply gets no answer.
  const answer = (id: number, ok: boolean, value: unknown) => {
    if (value === undefined) return;
    const expr = `window.__apxResult(${id},${ok},${JSON.stringify(value)})`;
    void send("Runtime.evaluate", { expression: expr }).catch(() => {});
  };
  try {
    await send("Runtime.enable");
    await send("Page.enable");
    await send("Network.enable");
    await send("Network.setBlockedURLs", { urls: ["*"] });
    await send("Runtime.addBinding", { name: "__apxCheck" });
    const { frameTree } = await send<{ frameTree: { frame: { id: string } } }>("Page.getFrameTree");
    await send("Page.setDocumentContent", { frameId: frameTree.frame.id, html: withBridge(html) });
    await new Promise((r) => setTimeout(r, waitMs));
    // What it shows once started: a page that catches its own failure only says so on screen.
    const shown = await send<{ result?: { value?: unknown } }>("Runtime.evaluate", {
      expression: "(document.body && document.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 1200)",
      returnByValue: true,
    }).catch(() => undefined);
    text = typeof shown?.result?.value === "string" ? shown.result.value : "";
    // An app's other views: opened one by one, so one that breaks or stays empty shows too.
    const walked = await send<{ result?: { value?: unknown } }>("Runtime.evaluate", {
      expression: VIEW_WALK,
      awaitPromise: true,
      returnByValue: true,
    }).catch(() => undefined);
    const list = walked?.result?.value;
    if (Array.isArray(list)) views = list.filter((v): v is PageView => typeof v?.view === "string").slice(0, MAX_VIEWS);
  } finally {
    stop();
    await cdp.send("Target.closeTarget", { targetId }).catch(() => {});
    await cdp.send("Target.disposeBrowserContext", { browserContextId }).catch(() => {});
  }
  return { errors, text, views };
}
