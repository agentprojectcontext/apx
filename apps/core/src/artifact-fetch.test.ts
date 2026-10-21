import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { artifactFetch, artifactSecretName } from "./artifact-fetch.ts";
import { artifactMemory } from "./domain/artifact-memory.ts";

const TOKEN = "tok_0123456789abcdef";

/** An API that echoes what it got, the credential included, and sets a cookie. */
async function echoServer() {
  const seen: { url: string; headers: http.IncomingHttpHeaders; body: string }[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ url: req.url ?? "", headers: req.headers, body });
      if (req.url === "/hop") {
        res.writeHead(302, { location: "/final" }).end();
        return;
      }
      if (req.url === "/away") {
        res.writeHead(302, { location: "https://elsewhere.example.com/x" }).end();
        return;
      }
      if (req.url === "/big") {
        res.end("x".repeat(2_100_000));
        return;
      }
      res.writeHead(200, {
        "content-type": "application/json",
        "set-cookie": "sid=1",
        "x-echo": String(req.headers.authorization ?? ""),
      });
      res.end(JSON.stringify({ refresh_token: TOKEN, auth: req.headers.authorization ?? null, url: req.url, body }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { origin, seen, close: () => new Promise<void>((r) => server.close(() => r())) };
}

test("a secret is named after its own artifact only", () => {
  assert.equal(artifactSecretName("sales", "api"), "artifact.sales.api");
  assert.equal(artifactSecretName("sales", "artifact.sales.api"), "artifact.sales.api");
  assert.throws(() => artifactSecretName("sales", "artifact.other.api"), /not one of this artifact's secrets/);
  assert.throws(() => artifactSecretName("sales", "telegram.token"), /not one of this artifact's secrets/);
  assert.throws(() => artifactSecretName("sales", "../x"), /not one of this artifact's secrets/);
});

test("fetch reaches only the artifact's origins and injects its secret without ever returning it", async () => {
  const api = await echoServer();
  const asked: [string, string | undefined][] = [];
  const resolve = (ref: string, project: string | undefined) => {
    asked.push([ref, project]);
    return ref === "secret://artifact.sales.api" ? TOKEN : undefined;
  };
  const target = { name: "sales", project_id: "prj_acme", connect: [api.origin] };
  const pinned = new Map<string, string>();
  const pins = { get: (k: string) => pinned.get(k), set: (k: string, o: string) => void pinned.set(k, o) };
  try {
    await assert.rejects(
      artifactFetch(target, { url: "https://evil.example.com/steal" }, resolve, pins),
      /not among the origins/,
    );
    await assert.rejects(
      artifactFetch(
        target,
        { url: `${api.origin}/x`, secret: { name: "artifact.other.api", in: "bearer" } },
        resolve,
        pins,
      ),
      /not one of this artifact's secrets/,
    );
    await assert.rejects(
      artifactFetch(target, { url: `${api.origin}/x`, secret: { name: "missing", in: "bearer" } }, resolve, pins),
      /artifact\.sales\.missing is not set/,
    );
    assert.equal(api.seen.length, 0);

    const bearer = await artifactFetch(
      target,
      { url: `${api.origin}/me`, headers: { cookie: "c=1", "x-page": "yes" }, secret: { name: "api", in: "bearer" } },
      resolve,
      pins,
    );
    assert.equal(api.seen.at(-1)?.headers.authorization, `Bearer ${TOKEN}`);
    assert.equal(api.seen.at(-1)?.headers["x-page"], "yes");
    assert.equal(api.seen.at(-1)?.headers.cookie, undefined);
    assert.deepEqual(asked.at(-1), ["secret://artifact.sales.api", "prj_acme"]);
    assert.equal(bearer.status, 200);
    // An API that echoes the credential (body or header) gets it replaced.
    assert.ok(!bearer.body.includes(TOKEN));
    assert.equal(JSON.parse(bearer.body).refresh_token, "[secret]");
    assert.equal(JSON.parse(bearer.body).auth, "Bearer [secret]");
    assert.equal(bearer.headers["x-echo"], "Bearer [secret]");
    assert.equal(bearer.headers["set-cookie"], undefined);

    const query = await artifactFetch(
      target,
      { url: `${api.origin}/q?a=1`, secret: { name: "api", in: "query", param: "key" } },
      resolve,
      pins,
    );
    assert.equal(api.seen.at(-1)?.url, `/q?a=1&key=${TOKEN}`);
    assert.equal(JSON.parse(query.body).url, "/q?a=1&key=[secret]");

    await artifactFetch(
      target,
      { url: `${api.origin}/f`, method: "POST", body: "a=1", secret: { name: "api", in: "form", param: "token" } },
      resolve,
      pins,
    );
    assert.equal(api.seen.at(-1)?.body, `a=1&token=${TOKEN}`);
    assert.equal(api.seen.at(-1)?.headers["content-type"], "application/x-www-form-urlencoded");

    await artifactFetch(
      target,
      { url: `${api.origin}/h`, secret: { name: "api", in: "header", param: "x-api-key" } },
      resolve,
      pins,
    );
    assert.equal(api.seen.at(-1)?.headers["x-api-key"], TOKEN);

    // Redirects stay within the artifact's origins; the body has a cap.
    assert.equal(
      JSON.parse((await artifactFetch(target, { url: `${api.origin}/hop` }, resolve, pins)).body).url,
      "/final",
    );
    await assert.rejects(artifactFetch(target, { url: `${api.origin}/away` }, resolve, pins), /does not connect to/);
    await assert.rejects(artifactFetch(target, { url: `${api.origin}/big` }, resolve, pins), /over 2000000 bytes/);
  } finally {
    await api.close();
  }
});

test("a secret is pinned to the first origin it reaches, refused elsewhere until the pins are reset", async () => {
  const a = await echoServer();
  const b = await echoServer();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-artifact-pins-"));
  const mem = artifactMemory({ home });
  const ref = { name: "sales" };
  const pins = { get: (k: string) => mem.pins(ref)[k], set: (k: string, o: string) => mem.pin(ref, k, o) };
  const target = { name: "sales", connect: [a.origin, b.origin] };
  const resolve = (r: string) => (r === "secret://artifact.sales.api" ? TOKEN : undefined);
  const call = (origin: string) =>
    artifactFetch(target, { url: `${origin}/me`, secret: { name: "api", in: "bearer" } }, resolve, pins);
  try {
    // Without a secret nothing is pinned.
    await artifactFetch(target, { url: `${b.origin}/plain` }, resolve, pins);
    assert.deepEqual(mem.pins(ref), {});
    assert.equal((await call(a.origin)).status, 200);
    assert.deepEqual(mem.info(ref).secrets, [{ key: "api", origin: a.origin }]);
    assert.equal((await call(a.origin)).status, 200);
    await assert.rejects(call(b.origin), new RegExp(`this secret is pinned to ${a.origin}; the owner can reset it`));
    assert.equal(b.seen.filter((r) => r.headers.authorization).length, 0);
    // Clearing the store or the database keeps the pins; resetting them frees the secret for its next first use.
    mem.clear(ref, { store: true, db: true });
    assert.equal(mem.pins(ref).api, a.origin);
    mem.clear(ref, { secrets: true });
    assert.deepEqual(mem.info(ref).secrets, []);
    assert.equal((await call(b.origin)).status, 200);
    assert.equal(mem.pins(ref).api, b.origin);
    await assert.rejects(call(a.origin), /pinned to/);
  } finally {
    await a.close();
    await b.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
