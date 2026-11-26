import assert from "node:assert/strict";
import dns from "node:dns/promises";
import http from "node:http";
import { test } from "node:test";
import { discoveryWeb, researchDiscoverySource } from "../engine/discovery-research.ts";
import { getPublic, PublicPageScopeError, searchPublic } from "./web.ts";

test("a real redirect response cannot connect outside the authorized origin or carry a query", async (t) => {
  let target = "";
  const received: string[] = [];
  const server = http.createServer((req, res) => {
    received.push(req.url ?? "");
    if (req.url === "/start") {
      res.writeHead(302, { location: target });
      res.end();
    } else {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("Readable authorized public content.");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    return realFetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, init);
  });
  const origin = "http://93.184.216.34";
  const authorized = (url: URL) => url.origin === origin && !url.search && !url.username && !url.password;
  try {
    for (target of ["http://93.184.216.35/blocked", `${origin}/blocked?private=data`, "ftp://93.184.216.34/blocked"]) {
      received.length = 0;
      await assert.rejects(
        getPublic(`${origin}/start`, new AbortController().signal, {}, authorized),
        PublicPageScopeError,
      );
      assert.deepEqual(received, ["/start"], "the redirect destination received no request");
    }
    target = `${origin}/allowed`;
    received.length = 0;
    const page = await getPublic(`${origin}/start`, new AbortController().signal, {}, authorized);
    assert.equal(page.status, 200);
    assert.deepEqual(received, ["/start", "/allowed"], "authorized redirects still follow the real network path");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    t.mock.restoreAll();
  }
});

test("three failed search engines are unavailable, unlike successful empty searches", async (t) => {
  t.mock.method(dns, "lookup", async () => [{ address: "93.184.216.34", family: 4 }]);
  let status = 503;
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("<html><body>No matching pages</body></html>", { status }),
  );
  const signal = new AbortController().signal;
  const failed = await searchPublic("public export announcements", 4, signal);
  assert.equal(failed.available, false);
  assert.equal(failed.failed.length, 3);
  const failures: string[] = [];
  const source = { label: "Public exports", public_terms: "public export announcements", pages: [] };
  await researchDiscoverySource({
    source,
    web: discoveryWeb,
    signal,
    take: () => true,
    failure: (_url, _reason, kind) => failures.push(kind),
  });
  assert.deepEqual(failures, ["search_unavailable"]);
  status = 200;
  const empty = await searchPublic("public export announcements", 4, signal);
  assert.equal(empty.available, true);
  assert.deepEqual(empty.hits, []);
  failures.length = 0;
  await researchDiscoverySource({
    source,
    web: discoveryWeb,
    signal,
    take: () => true,
    failure: (_url, _reason, kind) => failures.push(kind),
  });
  assert.deepEqual(failures, []);
});
