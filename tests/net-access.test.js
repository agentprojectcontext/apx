// Reaching this daemon from somewhere else.
//
// One process answers at several addresses — loopback for the local toolchain,
// a LAN address for a phone on the same Wi-Fi, a tailnet name that survives
// leaving the house. Three things depend on getting that list right:
//
//   • the pairing QR sends a phone to ONE of them, and that becomes the origin
//     its installed app launches at forever after;
//   • a client whose address stopped answering tries the rest before failing;
//   • only an https:// origin gets a secure context, and without one the
//     browser switches off installing as an app, the microphone and the
//     clipboard — which is why the ordering here is not cosmetic.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (...p) => fs.readFileSync(path.join(__dirname, "..", "src", ...p), "utf8");

const { reachableEndpoints, corsBetweenOwnAddresses } = await import("#host/daemon/api/net.js");

test("the endpoint list is ordered by how long the address keeps working", async () => {
  const eps = await reachableEndpoints({ port: 7430, host: "192.168.1.40" });
  assert.ok(eps.length >= 2, "at least the bound address and loopback");
  assert.equal(eps.at(-1).kind, "loopback", "loopback is last: it only ever helps this machine");
  const kinds = eps.map((e) => e.kind);
  const rank = { "tailscale-https": 0, tailscale: 1, lan: 2, loopback: 3 };
  const ranks = kinds.map((k) => rank[k]);
  assert.deepEqual([...ranks].sort((a, b) => a - b), ranks, `out of order: ${kinds.join(", ")}`);
});

test("a daemon bound to one address does not advertise the others", async () => {
  const eps = await reachableEndpoints({ port: 7430, host: "192.168.1.40" });
  const lan = eps.filter((e) => e.kind === "lan");
  assert.equal(lan.length, 1, "binding one address means exactly one LAN address answers");
  assert.equal(lan[0].url, "http://192.168.1.40:7430");
});

test("loopback is the only http URL reported as secure", async () => {
  const eps = await reachableEndpoints({ port: 7430, host: "192.168.1.40" });
  for (const e of eps) {
    const secure = e.url.startsWith("https://") || new URL(e.url).hostname === "127.0.0.1";
    assert.equal(e.secure, secure, `${e.url} is marked secure=${e.secure}`);
  }
});

test("CORS is granted to our own other addresses and to nobody else", async () => {
  const mw = corsBetweenOwnAddresses({ port: 7430, host: "192.168.1.40" });
  const call = (origin, method = "GET") => {
    const headers = {};
    const res = {
      setHeader: (k, v) => (headers[k] = v),
      status() { return this; },
      end: () => {},
    };
    let nexted = false;
    mw({ headers: { origin }, method }, res, () => (nexted = true));
    return { headers, nexted };
  };

  const ours = call("http://192.168.1.40:7430");
  assert.equal(ours.headers["access-control-allow-origin"], "http://192.168.1.40:7430");

  // Same port, someone else's name: the port is not an identity.
  const theirs = call("http://evil.example:7430");
  assert.equal(theirs.headers["access-control-allow-origin"], undefined);
  assert.equal(theirs.nexted, true, "a request from anywhere else still runs, just without the header");

  // A request with no Origin at all (curl, the CLI) is untouched.
  assert.equal(call(undefined).nexted, true);
});

test("a preflight is answered above the auth wall", async () => {
  const mw = corsBetweenOwnAddresses({ port: 7430, host: "192.168.1.40" });
  let ended = false;
  let status = 0;
  const headers = {};
  const res = {
    setHeader: (k, v) => (headers[k] = v),
    status(s) { status = s; return this; },
    end: () => (ended = true),
  };
  let nexted = false;
  mw(
    { headers: { origin: "http://127.0.0.1:7430", "access-control-request-headers": "authorization" }, method: "OPTIONS" },
    res,
    () => (nexted = true),
  );
  assert.equal(ended, true, "the preflight is answered here");
  assert.equal(status, 204);
  assert.equal(nexted, false, "it must NOT fall through to auth — a preflight carries no bearer by definition");
  assert.match(headers["access-control-allow-headers"], /authorization/);
});

test("the web and the daemon agree on what may be attached", () => {
  const daemon = readSrc("host", "daemon", "api", "media.js");
  const web = readSrc("interfaces", "web", "src", "lib", "api", "media.ts");
  const extsOf = (src, marker) => {
    const start = src.indexOf(marker);
    const chunk = src.slice(start, src.indexOf("]", start));
    return new Set(chunk.match(/"\.[a-z0-9]+"/g) || []);
  };
  const a = extsOf(daemon, "const UPLOAD_EXT");
  const b = extsOf(web, "const ALLOWED_EXT");
  assert.deepEqual([...a].sort(), [...b].sort(), "the picker must offer exactly what the daemon accepts");
  // A voice note recorded in a browser is Opus in a WebM container. Stored as
  // ".webm" it would be served as video/webm and render as a player with no
  // picture; ".weba" is the audio-only spelling of the same container.
  assert.ok(a.has('".weba"'), "browser recordings need an audio-only WebM extension");
  assert.match(daemon, /"\.weba": "audio\/webm"/);
});

test("the service worker never caches data or another origin", () => {
  const sw = fs.readFileSync(
    path.join(__dirname, "..", "src", "interfaces", "web", "public", "sw.js"),
    "utf8",
  );
  assert.match(sw, /url\.pathname\.startsWith\("\/api\/"\)/, "API responses must never be served from cache");
  assert.match(sw, /url\.origin !== self\.location\.origin/, "a failed-over request belongs to another origin");
  // Network-first, always: a panel that served yesterday's bundle after a
  // rebuild would be worse than having no installed app at all.
  const fetchBody = sw.slice(sw.indexOf('addEventListener("fetch"'));
  assert.ok(
    fetchBody.indexOf("await fetch(req)") < fetchBody.indexOf("cache.match"),
    "the network is tried before the cache",
  );
});

test("failing over needs OUR daemon at the other end, not just a 200", () => {
  const net = fs.readFileSync(
    path.join(__dirname, "..", "src", "interfaces", "web", "src", "lib", "net.ts"),
    "utf8",
  );
  // A LAN address is a lease: the 192.168.x.x that was this Mac yesterday can
  // be a printer today, and it will answer. The probe checks the health body,
  // not the status code.
  assert.match(net, /body\?\.status === "ok" && typeof body\.version === "string"/);
  // And the same repeated private ranges mean leaving the house does not
  // always produce a network error — sometimes it produces a stranger's 404.
  assert.match(net, /export function mayBeWrongAddress/);
  assert.match(net, /status === 404 \|\| status === 502/);
  // An auth failure is not an address problem; retrying elsewhere would only
  // hide it.
  assert.doesNotMatch(net, /status === 401/);

  const http = fs.readFileSync(
    path.join(__dirname, "..", "src", "interfaces", "web", "src", "lib", "http.ts"),
    "utf8",
  );
  assert.match(http, /mayBeWrongAddress\(res\.status\) && \(await recoverIfAddressIsWrong\(\)\)/);
});
