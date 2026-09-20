import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");
const activity = () => read(
  "src", "interfaces", "android", "app", "src", "main", "java",
  "dev", "agentprojectcontext", "apx", "MainActivity.java",
);

test("a page that will not load is an APX screen, not Chromium's", () => {
  const src = activity();

  // The failure has to be caught at all. Without these the WebView paints
  // whatever Chromium paints — which is how Manu got a white "Página web no
  // disponible" with net::ERR_ADDRESS_UNREACHABLE inside the app.
  assert.match(src, /public void onReceivedError\(WebView view, WebResourceRequest request, WebResourceError error\)/);
  assert.match(src, /public void onReceivedHttpError\(WebView view, WebResourceRequest request, WebResourceResponse response\)/);

  // A sub-resource failing is not the page failing. Only the document counts.
  const handlers = src.slice(src.indexOf("onReceivedError"));
  assert.equal((handlers.match(/if \(!request\.isForMainFrame\(\)\) return;/g) || []).length, 2);

  assert.match(src, /private void showLoadFailure\(Uri address, String reason\)/);
});

test("the failure screen is the way to the connection, not a dead end", () => {
  const src = activity();

  // This is the whole point. The native menu is reached through the page's own
  // JS bridge, so when the page does not load the only screen that can change
  // the address has to be ON the failure screen itself.
  assert.match(src, /connection\.setText\("Ver o cambiar la conexión"\)/);
  assert.match(src, /connection\.setOnClickListener\(ignored -> showPairing\(null, null, false\)\)/);
  assert.match(src, /retry\.setOnClickListener\(ignored -> openMobile\(pendingPath\)\)/);

  // Back off this screen must retry, not close the app — which is what
  // super.onBackPressed() does when a WebView is still held.
  assert.match(src, /private void showLoadFailure[\s\S]*?webView = null;/);

  // And a page that never finished loading keeps a way to the menu.
  assert.match(src, /if \(webView != null && !pageLoaded\) \{ showNativeMenu\(\); return; \}/);
  assert.match(src, /if \(view == webView\) pageLoaded = true;/);
  assert.match(src, /pageLoaded = false;\s*\n\s*webView\.loadUrl\(target\);/);
});

test("the failure screen does not print the token, and does not steal the panel's own 404", () => {
  const src = activity();

  // The old error page showed the full URL — `#token=<bearer>` included — in
  // bold, on screen, for anything that photographs a phone.
  assert.match(src, /private String addressLabel\(Uri address\)/);
  assert.match(src, /int cut = shown\.indexOf\('#'\);/);

  // The daemon answers 404 for an unknown route while still serving the shell,
  // so the panel can render its own styled 404 (host/daemon/api/web.js). Only
  // an address the app itself opened may be treated as a failure.
  assert.match(src, /if \(!openedByApx\(request\.getUrl\(\)\)\) return;/);
  assert.match(src, /private boolean openedByApx\(Uri address\)/);
  assert.match(src, /path\.startsWith\("\/mobile"\)/);

  const web = read("src", "host", "daemon", "api", "web.js");
  assert.match(web, /res\.status\(isKnownSpaRoute\(req\.path\) \? 200 : 404\);/);
  assert.match(web, /\/\^\\\/mobile\(\\\/\.\*\)\?\$\//);
});

test("a net:: code is turned into something a person can act on", () => {
  const src = activity();

  // Each branch names WHICH of the two halves to go fix — the phone's
  // Tailscale, or the machine the daemon runs on.
  assert.match(src, /WebViewClient\.ERROR_HOST_LOOKUP/);

  // A lookup error on a LITERAL IP is not a lookup problem. Chromium answers
  // ERROR_HOST_LOOKUP with the Wi-Fi off even when there is no name to look
  // up, and that is the commonest case of all — a LAN address whose DHCP lease
  // moved. Verified on the A55 on 2026-09-20: pointed at 192.168.18.134 with
  // no route, the first version of this screen sent the reader after their
  // DNS and their Tailscale, neither of which could be the cause.
  assert.match(src, /private boolean looksNumeric\(Uri address\)/);
  assert.match(src, /return looksNumeric\(address\)/);
  assert.match(src, /Esa dirección no está en la red donde está este teléfono/);
  assert.match(src, /Tailscale esté conectado acá/);
  assert.match(src, /WebViewClient\.ERROR_CONNECT \|\| code == WebViewClient\.ERROR_IO/);
  assert.match(src, /cambió de IP en la red/);
  assert.match(src, /WebViewClient\.ERROR_TIMEOUT/);
  assert.match(src, /private String httpReason\(int status\)/);
  assert.match(src, /status == 401 \|\| status == 403/);
});
