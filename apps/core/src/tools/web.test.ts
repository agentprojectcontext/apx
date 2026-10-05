import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { bingHits, blockedAddress, braveHits, ddgHits, getPublic, pageText } from "./web.ts";

test("a page reads as text: title, description, headings and links kept, scripts and menus dropped", () => {
  const html = `<html><head><title>Acme &amp; Co</title><meta name="description" content="Tools for small shops"></head>
  <body><nav><a href="/x">Menu</a></nav><script>evil()</script><main><h1>Prices</h1><p>From <b>10</b> a month.</p>
  <ul><li>One</li><li>Two</li></ul><p>See <a href="/plans">the plans</a>.</p></main><footer>©</footer></body></html>`;
  const { title, text } = pageText(html, "https://acme.example/");
  assert.equal(title, "Acme & Co");
  assert.match(text, /^Tools for small shops/);
  assert.match(text, /# Prices/);
  assert.match(text, /From 10 a month\./);
  assert.match(text, /- One\n+- Two/);
  assert.match(text, /the plans \(https:\/\/acme\.example\/plans\)/);
  assert.doesNotMatch(text, /evil|Menu|©/);
});

test("search result pages: Brave's, Bing's (behind its click tracker) and DuckDuckGo's", () => {
  const brave = `<div data-type="web"><a href="https://acme.example/a"><div class="title search-snippet-title x" title="Acme A">Acme A</div></a><div class="generic-snippet s"><div class="content">Best <strong>tools</strong></div></div></div>`;
  assert.deepEqual(braveHits(brave), [{ url: "https://acme.example/a", title: "Acme A", snippet: "Best tools" }]);
  const target = Buffer.from("https://acme.example/b").toString("base64url");
  const bing = `<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&amp;p=1&amp;u=a1${target}&amp;ntb=1">Acme <b>B</b></a></h2><p>Snippet B</p></li>`;
  assert.deepEqual(bingHits(bing), [{ url: "https://acme.example/b", title: "Acme B", snippet: "Snippet B" }]);
  const ddg = `<a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Facme.example%2Fc&amp;rut=1" class='result-link'>Acme C</a>`;
  assert.deepEqual(ddgHits(ddg), [{ url: "https://acme.example/c", title: "Acme C", snippet: "" }]);
});

test("this machine, the local network and cloud metadata are never fetched, not even through a redirect", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "192.168.1.5",
    "172.20.0.1",
    "169.254.169.254",
    "::1",
    "fd00::1",
    "::ffff:127.0.0.1",
  ])
    assert.ok(blockedAddress(ip), ip);
  assert.ok(!blockedAddress("93.184.216.34"));
  const ac = new AbortController();
  await assert.rejects(getPublic("http://127.0.0.1:7440/health", ac.signal), /not public/);
  await assert.rejects(getPublic("http://localhost/", ac.signal), /not public/);
  await assert.rejects(getPublic("file:///etc/hosts", ac.signal), /only http/);
  // A local server stands in for a public page that redirects inward: refused at the first hop (it is local itself).
  const srv = http.createServer((_q, r) => r.writeHead(302, { location: "http://127.0.0.1:1/" }).end());
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as AddressInfo).port;
  await assert.rejects(getPublic(`http://127.0.0.1:${port}/`, ac.signal), /not public/);
  srv.close();
});
