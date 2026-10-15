import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSrcdoc } from "./srcdoc.ts";

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
