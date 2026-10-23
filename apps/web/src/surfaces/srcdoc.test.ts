import assert from "node:assert/strict";
import { test } from "node:test";
import { bridgeCall, buildSrcdoc } from "./srcdoc.ts";

const opts = { theme: ":root{}", mode: "dark" as const, nonce: "n" };
const cspOf = (doc: string) => /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(doc)?.[1] ?? "";

test("a widget reaches no network unless it declared origins, and then only those", () => {
  assert.doesNotMatch(cspOf(buildSrcdoc("<p>hi</p>", opts)), /connect-src/);
  const csp = cspOf(
    buildSrcdoc("<p>hi</p>", {
      ...opts,
      connect: [
        "https://api.binance.com",
        "wss://stream.binance.com:9443",
        "https://x.com; script-src *",
        "http://a.com",
      ],
    }),
  );
  assert.match(csp, /; connect-src https:\/\/api\.binance\.com wss:\/\/stream\.binance\.com:9443$/);
  assert.doesNotMatch(csp, /script-src \*|http:\/\/a\.com/);
});

test("project media reaches a widget as its own blob: URLs, so its CSP names no server", () => {
  const csp = cspOf(buildSrcdoc('<video data-apx-src="clips/reel.mp4"></video>', opts));
  assert.match(csp, /img-src data: blob:;/);
  assert.match(csp, /media-src data: blob:$/);
  assert.doesNotMatch(csp, /https?:|'self'|\*/);
});

test("links to the web are left out: they never load here, and one held back would leave the page blank", () => {
  const page =
    '<link rel="preconnect" href="https://fonts.example.com" crossorigin><link rel="stylesheet" href="//cdn.example.com/a.css"><link rel="icon" href="data:,"><p>Hi</p>';
  const doc = buildSrcdoc(page, { theme: "", mode: "light", nonce: "n" });
  assert.doesNotMatch(doc, /example\.com/);
  assert.match(doc, /<link rel="icon" href="data:,">/);
  assert.match(doc, /<p>Hi<\/p>/);
});

test("the frame starts in the panel's mode and with what the widget remembered, which cannot break out of its script", () => {
  const doc = buildSrcdoc("<p>Hi</p>", { ...opts, state: { note: "</script><img src=x onerror=alert(1)>", n: 2 } });
  assert.match(doc, /setAttribute\("data-ax-mode","dark"\)/);
  // Its forms run their own submit handlers (the frame allows forms) but none is sent anywhere.
  assert.match(cspOf(doc), /^default-src 'none'; form-action 'none';/);
  assert.doesNotMatch(doc, /<\/script><img/);
  const bridge = /<script>([\s\S]*?)<\/script>/.exec(doc)?.[1] ?? "";
  const initial = /var ST=(\{.*?\}),subs=/.exec(bridge)?.[1] ?? "";
  assert.deepEqual(JSON.parse(initial), { note: "</script><img src=x onerror=alert(1)>", n: 2 });
  assert.match(
    bridge,
    /window\.apx=Object\.freeze\(\{host:"apx",sendPrompt:sendPrompt,media:media,state:state,call:call,/,
  );
});

test("a page reaches only its own store, database and fetch, always under the frame's surface id", () => {
  assert.deepEqual(bridgeCall("store_get", { keys: ["btc"] }, "s1"), {
    method: "surfaces.store_get",
    params: { keys: ["btc"], surface: "s1" },
  });
  assert.deepEqual(bridgeCall("db_exec", { sql: "delete from t", surface: "other" }, "s1"), {
    method: "surfaces.db_exec",
    params: { sql: "delete from t", surface: "s1" },
  });
  assert.equal(bridgeCall("fetch", { url: "https://api.example.com" }, "s1")?.method, "surfaces.fetch");
  for (const m of ["memory_clear", "export", "import", "surfaces.store_get", "set_state", "toString", "__proto__", 3])
    assert.equal(bridgeCall(m, {}, "s1"), undefined, String(m));
  for (const p of [null, "x", ["a"], undefined]) assert.equal(bridgeCall("store_get", p, "s1"), undefined);
});
