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
