import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { test } from "node:test";
import { readEdgePublicCopy } from "@apx/protocol/public-copy";
import { convertV4MiniflareOptions, Response as LocalResponse, Miniflare } from "miniflare";
import { waitFor } from "../../core/src/testkit/wait.ts";
import { localWorkerModules } from "./local-modules.ts";

async function runtimeFixture() {
  const generated = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  if (!("publicKey" in generated)) throw new Error("Expected an RSA key pair");
  const jwk = { ...(await crypto.subtle.exportKey("jwk", generated.publicKey)), kid: "local", alg: "RS256" };
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const seconds = Math.floor(Date.now() / 1000);
  const head = encode({ alg: "RS256", kid: "local" });
  const privateKey = generated.privateKey;
  async function identity(uid: string) {
    const payload = encode({
      sub: uid,
      aud: "apx-agents",
      iss: "https://securetoken.google.com/apx-agents",
      iat: seconds - 60,
      auth_time: seconds - 60,
      exp: seconds + 3600,
    });
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      privateKey,
      new TextEncoder().encode(`${head}.${payload}`),
    );
    return `${head}.${payload}.${Buffer.from(signature).toString("base64url")}`;
  }
  const token = await identity("person");
  const documents = new Map<string, { name: string; fields: Record<string, unknown>; updateTime: string }>();
  let firebaseDown = false;
  let firestoreReads = 0;
  let commits = 0;
  let held: { enter(): void; wait: Promise<void> } | undefined;
  const holdNextCommit = () => {
    const entered = Promise.withResolvers<void>();
    const released = Promise.withResolvers<void>();
    held = { enter: () => entered.resolve(), wait: released.promise };
    return { entered: entered.promise, release: () => released.resolve() };
  };
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      ...(await localWorkerModules()),
      compatibilityDate: "2026-11-13",
      bindings: { FIREBASE_PROJECT: "apx-agents" },
      r2Buckets: ["COPIES"],
      durableObjects: {
        ACCOUNTS: { className: "PublicationAccount", useSQLite: true },
        BUDGET: { className: "PublicationBudget", useSQLite: true },
      },
      ratelimits: { IP_LIMIT: { namespace_id: "24601", simple: { limit: 120, period: 60 } } },
      outboundService: async (request) => {
        const url = new URL(request.url);
        if (url.hostname === "www.googleapis.com") return LocalResponse.json({ keys: [jwk] });
        assert.equal(url.hostname, "firestore.googleapis.com");
        assert.equal(request.headers.get("authorization"), `Bearer ${token}`);
        firestoreReads++;
        if (firebaseDown) return LocalResponse.json({ error: { status: "RESOURCE_EXHAUSTED" } }, { status: 429 });
        if (url.pathname.endsWith(":commit")) {
          if (held) {
            const gate = held;
            held = undefined;
            gate.enter();
            await gate.wait;
          }
          const body = (await request.json()) as {
            writes: {
              update?: { name: string; fields: Record<string, unknown> };
              delete?: string;
              currentDocument?: { exists?: boolean; updateTime?: string };
            }[];
          };
          for (const write of body.writes) {
            const old = documents.get(write.update?.name ?? write.delete ?? "");
            if (write.currentDocument?.exists === false && old) return LocalResponse.json({}, { status: 409 });
            if (write.currentDocument?.updateTime && old?.updateTime !== write.currentDocument.updateTime)
              return LocalResponse.json({}, { status: 409 });
          }
          commits++;
          for (const write of body.writes) {
            if (write.delete) documents.delete(write.delete);
            if (write.update) documents.set(write.update.name, { ...write.update, updateTime: `revision-${commits}` });
          }
          return LocalResponse.json({});
        }
        const name = url.pathname.slice("/v1/".length);
        if (url.searchParams.has("pageSize"))
          return LocalResponse.json({
            documents: [...documents.values()].filter((doc) => doc.name.startsWith(`${name}/`)),
          });
        const value = documents.get(name);
        return LocalResponse.json(value ?? {}, { status: value ? 200 : 404 });
      },
    }),
  );
  return {
    mf,
    token,
    identity,
    holdNextCommit,
    counts: () => ({ commits, firestoreReads }),
    stopFirebase: () => {
      firebaseDown = true;
    },
    dropMetadata: () => {
      for (const key of documents.keys()) if (!key.includes("/artifactOwners/")) documents.delete(key);
    },
  };
}

test("the deployed module serves its embedded viewer without an asset service or Firebase request", async () => {
  const f = await runtimeFixture();
  try {
    const index = await f.mf.dispatchFetch("https://artifact.example.com/0123abcd");
    assert.equal(index.status, 200);
    assert.equal(index.headers.get("cache-control"), "no-store");
    assert.match(index.headers.get("content-security-policy") ?? "", /script-src 'self'/);
    const html = await index.text();
    for (const path of ["/", "/index.html", "/?code=0123abcd", "/index.html?next=https://example.com"]) {
      const root = await f.mf.dispatchFetch(`https://artifact.example.com${path}`, { redirect: "manual" });
      assert.equal(root.status, 302);
      assert.equal(root.headers.get("location"), "https://apxagent.app/");
      assert.equal(root.headers.get("cache-control"), "no-store");
      assert.equal(await root.text(), "");
    }
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"\s]+\.(?:js|css))"/g)].map((match) => match[1]);
    assert.ok(assets.length >= 2);
    for (const asset of assets) {
      const response = await f.mf.dispatchFetch(`https://artifact.example.com${asset}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
      assert.match(
        response.headers.get("content-type") ?? "",
        asset?.endsWith(".js") ? /^text\/javascript/ : /^text\/css/,
      );
      assert.equal(response.headers.get("set-cookie"), null);
      assert.equal(response.headers.get("access-control-allow-origin"), null);
      assert.ok((await response.text()).length > 0);
      if (asset?.endsWith(".js"))
        assert.equal((await f.mf.dispatchFetch(`https://artifact.example.com${asset}.map`)).status, 404);
    }
    const runner = await f.mf.dispatchFetch("https://artifact.example.com/runner.html");
    assert.equal(runner.status, 200);
    assert.equal(runner.headers.get("cache-control"), "no-store");
    assert.match(runner.headers.get("content-security-policy") ?? "", /sandbox allow-scripts/);
    assert.match(runner.headers.get("content-security-policy") ?? "", /connect-src 'none'/);
    assert.ok((await runner.text()).length > 0);
    for (const path of ["/assets/missing.js", "/assets/__proto__", "/.generated/viewer-assets.ts"])
      assert.equal((await f.mf.dispatchFetch(`https://artifact.example.com${path}`)).status, 404);
    assert.equal(f.counts().firestoreReads, 0);
  } finally {
    await f.mf.dispose();
  }
});

test("real Worker publishes, updates and revokes through R2; cached public copies survive Firestore quota failure", async () => {
  const f = await runtimeFixture();
  const { mf, token } = f;
  try {
    const code = "abcd1234";
    const bundle = (html: string) =>
      JSON.stringify({
        format: "apx-artifact@1",
        manifest: { name: "orders", title: "Orders", kind: "app", version: 1 },
        html,
        state: { chosen: 1 },
      });
    const headers = { authorization: `Bearer ${token}` };
    const published = await mf.dispatchFetch(`https://example.com/api/account/copies/${code}/publish`, {
      method: "POST",
      headers,
      body: bundle("<h1>Orders</h1>"),
    });
    assert.equal(published.status, 200, await published.text());
    assert.equal(f.counts().commits, 1);
    const root = "https://example.com";
    const send: typeof fetch = async (input, init) => {
      assert.equal(new Headers(init?.headers).get("authorization"), null);
      const response = await mf.dispatchFetch(String(input), { method: init?.method });
      return new Response(await response.arrayBuffer(), { status: response.status, headers: [...response.headers] });
    };
    assert.equal((await readEdgePublicCopy(code, { origin: root, fetch: send })).bundle.html, "<h1>Orders</h1>");
    const inspect = await mf.dispatchFetch(`${root}/api/account/copies/${code}/inspect`, { headers });
    const previous = (await inspect.json()) as { updateTime: string };
    const events = await mf.dispatchFetch(`${root}/api/copies/${code}/events`, { headers: { upgrade: "websocket" } });
    assert.equal(events.status, 101);
    const socket = events.webSocket;
    assert.ok(socket);
    socket.accept();
    const changes: string[] = [];
    socket.addEventListener("message", (event) => changes.push(String(event.data)));
    const updated = await mf.dispatchFetch(`${root}/api/account/copies/${code}/update`, {
      method: "POST",
      headers: { ...headers, "x-artifact-revision": previous.updateTime },
      body: bundle("<h1>Updated</h1>"),
    });
    assert.equal(updated.status, 200, await updated.text());
    assert.equal(f.counts().commits, 2);
    await waitFor(() => changes.includes(JSON.stringify({ state: "live" })), "live copy notification");
    const r2 = await mf.getR2Bucket("COPIES");
    const savedPointer = await (await r2.get(`heads/${code}`))?.text();
    assert.ok(savedPointer);
    const before = f.counts().firestoreReads;
    f.stopFirebase();
    assert.equal((await readEdgePublicCopy(code, { origin: root, fetch: send })).bundle.html, "<h1>Updated</h1>");
    assert.equal((await readEdgePublicCopy(code, { origin: root, fetch: send })).bundle.state?.chosen, 1);
    assert.equal(f.counts().firestoreReads, before, "anonymous reads must not touch Firebase even with a warm cache");
    const current = await mf.dispatchFetch(`${root}/api/account/copies/${code}/inspect`, { headers });
    const latest = (await current.json()) as { updateTime: string };
    const revoked = await mf.dispatchFetch(`${root}/api/account/copies/${code}/revoke`, {
      method: "POST",
      headers: { ...headers, "x-artifact-revision": latest.updateTime },
    });
    assert.equal(revoked.status, 200, await revoked.text());
    await waitFor(() => changes.includes(JSON.stringify({ state: "missing" })), "revocation notification");
    socket.close();
    const missing = await mf.dispatchFetch(`${root}/api/copies/${code}/bundle`);
    assert.equal(missing.status, 404, "a cached body must not bypass a revoked pointer");
    await r2.put(`heads/${code}`, savedPointer);
    assert.equal(
      (await mf.dispatchFetch(`${root}/api/copies/${code}/bundle`)).status,
      404,
      "an uncertain older R2 put must not resurrect a durably revoked code",
    );
    await r2.delete(`heads/${code}`);
    await assert.rejects(readEdgePublicCopy(code, { origin: root, fetch: send }), /public_artifact_missing/);
    assert.equal(
      (await mf.dispatchFetch(`${root}/runner.html`)).headers
        .get("content-security-policy")
        ?.includes("connect-src 'none'"),
      true,
    );
    assert.equal(
      (await mf.dispatchFetch(`${root}/${code}`)).headers
        .get("content-security-policy")
        ?.includes("connect-src 'self'"),
      true,
    );
    assert.equal((await mf.dispatchFetch(`${root}/_private-cache/${code}/anything`)).status, 404);
    assert.equal(
      (
        await mf.dispatchFetch(`${root}/api/account/copies/${code}/publish`, {
          method: "POST",
          body: bundle("<h1>Other</h1>"),
        })
      ).status,
      401,
    );
  } finally {
    await mf.dispose();
  }
});

test("socket fan-out is bounded per copy and account; updates and revocation reach every accepted subscriber", async () => {
  const f = await runtimeFixture();
  type Connection = WebSocket;
  const sockets: Connection[] = [];
  const notices: { code: string; state: string }[] = [];
  const closed = new Set<Connection>();
  const root = "https://example.com";
  const headers = { authorization: `Bearer ${f.token}` };
  const codes = Array.from({ length: 6 }, (_, i) => String(i).padStart(8, "0"));
  const body = (html: string) =>
    JSON.stringify({
      format: "apx-artifact@1",
      manifest: { name: "orders", title: "Orders", kind: "app", version: 1 },
      html,
    });
  const watch = (code: string) =>
    f.mf.dispatchFetch(`${root}/api/copies/${code}/events`, { headers: { upgrade: "websocket" } });
  try {
    for (const code of codes) {
      const response = await f.mf.dispatchFetch(`${root}/api/account/copies/${code}/publish`, {
        method: "POST",
        headers,
        body: body("Revision A"),
      });
      assert.equal(response.status, 200, await response.text());
    }
    for (const code of codes.slice(0, 5)) {
      for (let i = 0; i < 20; i++) {
        const socket = new WebSocket(`${(await f.mf.ready).origin.replace(/^http/, "ws")}/api/copies/${code}/events`);
        sockets.push(socket);
        await waitFor(() => socket.readyState === WebSocket.OPEN, "native socket connected");
        socket.addEventListener("message", (event) => {
          const state = JSON.parse(String(event.data)).state;
          notices.push({ code, state });
          if (state === "missing") socket.close();
        });
        socket.addEventListener("close", () => {
          closed.add(socket);
        });
      }
    }
    assert.equal((await watch(codes[0] ?? "")).status, 429, "twenty retained sockets is the per-copy ceiling");
    assert.equal((await watch(codes[5] ?? "")).status, 429, "one hundred retained sockets is the per-account ceiling");
    for (const [index, action] of [
      [1, "update"],
      [0, "revoke"],
    ] as const) {
      const code = codes[index];
      const inspected = await f.mf.dispatchFetch(`${root}/api/account/copies/${code}/inspect`, { headers });
      const meta = (await inspected.json()) as { updateTime: string };
      const response = await f.mf.dispatchFetch(`${root}/api/account/copies/${code}/${action}`, {
        method: "POST",
        headers: { ...headers, "x-artifact-revision": meta.updateTime },
        ...(action === "update" ? { body: body("Revision B") } : {}),
      });
      assert.equal(response.status, 200, await response.text());
      const state = action === "update" ? "live" : "missing";
      await waitFor(
        () => notices.filter((notice) => notice.code === code && notice.state === state).length === 20,
        "all accepted sockets notified",
      );
    }
    await waitFor(() => closed.size === 20, "revocation releases retained subscriptions");
    const replacement = new WebSocket(
      `${(await f.mf.ready).origin.replace(/^http/, "ws")}/api/copies/${codes[5]}/events`,
    );
    sockets.push(replacement);
    await waitFor(
      () => replacement.readyState === WebSocket.OPEN,
      "released sockets restore capacity for another copy",
    );
  } finally {
    for (const socket of sockets) if (socket.readyState < 2) socket.close();
    await f.mf.dispose();
  }
});

test("R2 quota stays trusted even if an owner deletes Firebase metadata directly; other accounts cannot inspect or change a copy", async () => {
  const f = await runtimeFixture();
  const json = JSON.stringify({
    format: "apx-artifact@1",
    manifest: { name: "orders", title: "Orders", kind: "app", version: 1 },
    html: "<h1>Orders</h1>",
  });
  const headers = { authorization: `Bearer ${f.token}` };
  try {
    for (let i = 0; i < 20; i++) {
      const response = await f.mf.dispatchFetch(
        `https://example.com/api/account/copies/000000${String(i).padStart(2, "0")}/publish`,
        { method: "POST", headers, body: json },
      );
      assert.equal(response.status, 200, await response.text());
    }
    const other = { authorization: `Bearer ${await f.identity("other")}` };
    for (const action of ["inspect", "update", "revoke"]) {
      const response = await f.mf.dispatchFetch(`https://example.com/api/account/copies/00000000/${action}`, {
        method: action === "inspect" ? "GET" : "POST",
        headers: other,
        ...(action === "update" ? { body: json } : {}),
      });
      assert.equal(response.status, 403);
    }
    f.dropMetadata();
    const before = f.counts().commits;
    const overflow = await f.mf.dispatchFetch("https://example.com/api/account/copies/extra000/publish", {
      method: "POST",
      headers,
      body: json,
    });
    assert.equal(overflow.status, 429);
    assert.equal(f.counts().commits, before, "the trusted edge quota must reject before consulting writable metadata");
    assert.equal((await f.mf.dispatchFetch("https://example.com/api/copies/00000000/bundle")).status, 200);
    const inspect = await f.mf.dispatchFetch("https://example.com/api/account/copies/00000000/inspect", { headers });
    const previous = (await inspect.json()) as { updateTime: string };
    const revoked = await f.mf.dispatchFetch("https://example.com/api/account/copies/00000000/revoke", {
      method: "POST",
      headers: { ...headers, "x-artifact-revision": previous.updateTime },
    });
    assert.equal(revoked.status, 200);
    const replacement = await f.mf.dispatchFetch("https://example.com/api/account/copies/extra000/publish", {
      method: "POST",
      headers,
      body: json,
    });
    assert.equal(replacement.status, 200, await replacement.text());
  } finally {
    await f.mf.dispose();
  }
});

test("a held Firebase update cannot block anonymous viewing or the durable revocation check", {
  timeout: 30_000,
}, async (t) => {
  const f = await runtimeFixture();
  let release: (() => void) | undefined;
  t.after(async () => {
    release?.();
    await f.mf.dispose();
  });
  const code = "abcd1234";
  const root = `https://example.com/api/account/copies/${code}`;
  const headers = { authorization: `Bearer ${f.token}` };
  const bundle = (html: string) =>
    JSON.stringify({
      format: "apx-artifact@1",
      manifest: { name: "orders", title: "Orders", kind: "app", version: 1 },
      html,
    });
  assert.equal(
    (await f.mf.dispatchFetch(`${root}/publish`, { method: "POST", headers, body: bundle("<h1>Before</h1>") })).status,
    200,
  );
  const previous = (await (await f.mf.dispatchFetch(`${root}/inspect`, { headers })).json()) as { updateTime: string };
  const held = f.holdNextCommit();
  release = held.release;
  const update = f.mf.dispatchFetch(`${root}/update`, {
    method: "POST",
    headers: { ...headers, "x-artifact-revision": previous.updateTime },
    body: bundle("<h1>After</h1>"),
  });
  await held.entered;
  const readable = await f.mf.dispatchFetch(`https://example.com/api/copies/${code}/bundle`);
  assert.equal(readable.status, 200);
  assert.equal(((await readable.json()) as { html: string }).html, "<h1>Before</h1>");
  held.release();
  assert.equal((await update).status, 200);
});
