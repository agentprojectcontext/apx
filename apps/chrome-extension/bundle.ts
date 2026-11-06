import fs from "node:fs";
import path from "node:path";
import { CHROME_HOST } from "../../packages/protocol/src/chrome.ts";
import { extensionIcons, ICON_PATHS } from "./icons.ts";
import { EXTENSION_PUBLIC_KEY } from "./identity.ts";

const portNumber = (port: number) => {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Choose a port from 1 to 65535");
  return port;
};

const messages = {
  en: {
    description: {
      message: "Chat with APX in Chrome's side panel and let it work in your tabs. Requires APX on this computer.",
    },
    open: { message: "Open APX in a tab" },
    reload: { message: "Reload" },
    help: { message: "Help" },
    recovery: {
      message:
        "APX not showing? Make sure APX is open on this computer, then choose Reload. You can also open APX in a tab.",
    },
  },
  es: {
    description: {
      message: "Conversá con APX en el panel lateral de Chrome y dejá que trabaje en tus pestañas. Requiere APX.",
    },
    open: { message: "Abrir APX en una pestaña" },
    reload: { message: "Recargar" },
    help: { message: "Ayuda" },
    recovery: {
      message:
        "¿No aparece APX? Asegurate de tener APX abierto en esta computadora y elegí Recargar. También podés abrir APX en una pestaña.",
    },
  },
};

/** The worker that lends the "APX" tab group to APX: the native host it connects to and the APX it never drives. */
const worker = (origin: string) => {
  const source = fs.readFileSync(path.join(import.meta.dirname, "worker.js"), "utf8");
  if (!source.includes(`const HOST = "${CHROME_HOST}";`)) throw new Error("worker.js names another native host");
  const panel = 'const PANEL = "http://127.0.0.1:7440";';
  if (!source.includes(panel)) throw new Error("worker.js does not name the APX it shows");
  return source.replace(panel, `const PANEL = ${JSON.stringify(origin)};`);
};

/**
 * The frame owns APX authentication; the extension has no bridge into it. The panel loads APX with `quick=chrome`,
 * which makes what the owner writes there a turn in their Chrome. The store upload carries no `key`: the store refuses
 * one on a new item and signs the package with its own.
 */
export function extensionBundle(
  port = 7440,
  opts: { store?: boolean } = {},
): Record<string, string | Uint8Array> & { "manifest.json": string } {
  const origin = `http://127.0.0.1:${portNumber(port)}`;
  return {
    ...extensionIcons(),
    "manifest.json": JSON.stringify(
      {
        manifest_version: 3,
        ...(opts.store ? {} : { key: EXTENSION_PUBLIC_KEY }),
        minimum_chrome_version: "116",
        name: "APX",
        version: "0.2.0",
        default_locale: "en",
        description: "__MSG_description__",
        permissions: ["sidePanel", "nativeMessaging", "debugger", "tabs", "tabGroups"],
        background: { service_worker: "worker.js" },
        icons: ICON_PATHS,
        action: { default_title: "APX", default_icon: ICON_PATHS },
        side_panel: { default_path: "panel.html" },
        content_security_policy: {
          extension_pages: `default-src 'none'; script-src 'self'; style-src 'self'; frame-src ${origin}; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`,
        },
      },
      null,
      2,
    ),
    "worker.js": worker(origin),
    "panel.html": `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>APX</title><link rel="stylesheet" href="panel.css"></head>
<body><nav aria-label="APX"><a id="open" href="${origin}/?quick" target="_blank" rel="noopener noreferrer"></a><details><summary id="help"></summary><p id="recovery"></p></details><button id="reload" type="button"></button></nav>
<iframe src="${origin}/?quick=chrome" title="APX" referrerpolicy="no-referrer"></iframe>
<script src="panel.js"></script></body></html>`,
    "panel.css": `:root{color-scheme:light dark;font-family:system-ui,sans-serif;background:Canvas;color:CanvasText}*{box-sizing:border-box}body{margin:0;height:100dvh;display:flex;flex-direction:column}nav{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:28px;padding:2px 10px;border-bottom:1px solid color-mix(in srgb,CanvasText 15%,Canvas)}a,button{font:inherit;font-size:12px;color:inherit}a{text-decoration:none;display:inline-flex;align-items:center;min-height:24px}button{border:0;border-radius:4px;background:transparent;padding:2px 6px;min-height:24px;cursor:pointer}details{margin-left:auto;font-size:12px}summary{cursor:pointer;min-height:24px;display:flex;align-items:center;padding:2px 6px}details p{position:absolute;z-index:1;top:28px;right:10px;width:min(320px,calc(100vw - 20px));margin:0;padding:12px;font-size:13px;line-height:1.5;background:Canvas;color:CanvasText;border:1px solid color-mix(in srgb,CanvasText 25%,Canvas);border-radius:6px;box-shadow:0 3px 12px #0002}a:focus-visible,button:focus-visible,summary:focus-visible{outline:2px solid Highlight;outline-offset:1px}iframe{display:block;width:100%;flex:1;min-height:0;border:0;background:Canvas}\n`,
    "panel.js": `chrome.runtime.sendMessage({ t: 'connect' }).catch(() => {});
const language = navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en';
const labels = ${JSON.stringify(messages)}[language];
document.documentElement.lang = language;
document.querySelector('#open').textContent = labels.open.message;
document.querySelector('#help').textContent = labels.help.message;
document.querySelector('#recovery').textContent = labels.recovery.message;
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') document.querySelector('details').open = false; });
const reload = document.querySelector('#reload');
reload.textContent = labels.reload.message;
reload.addEventListener('click', () => { document.querySelector('details').open = false; const frame = document.querySelector('iframe'); frame.src = frame.getAttribute('src'); });
`,
    "_locales/en/messages.json": JSON.stringify(messages.en, null, 2),
    "_locales/es/messages.json": JSON.stringify(messages.es, null, 2),
  };
}
