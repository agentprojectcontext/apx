import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { manualTimers, waitFor } from "../testkit/platform.ts";
import { listenHooks, PUBLIC_BODY_MAX, PUBLIC_DEADLINE_MS, publicPath, publicRateLimit } from "./hooks.ts";

const log = { info() {}, warn() {}, error() {} };

test("public paths reject normalization ambiguity before parsing", () => {
  for (const target of [
    "//hooks/a",
    "/hooks//a",
    "/x/../hooks/a",
    "/./hooks/a",
    "/hooks/%61",
    "/hooks/%2e%2e/a",
    "/hooks/a%2fb",
    "/hooks/a\\b",
    "https://example.com/hooks/a",
    "/hooks/a#x",
    "/hooks/a?token=%61",
  ])
    assert.equal(publicPath(target), undefined, target);
  assert.equal(publicPath("/hooks/a?event=one"), "/hooks/a");
});

test("public rate buckets are bounded and reset on an injected clock", () => {
  let at = 0;
  const allow = publicRateLimit(() => at, 2, 100);
  assert.equal(allow("route"), true);
  assert.equal(allow("route"), true);
  assert.equal(allow("route"), false);
  assert.equal(allow("other"), true);
  at = 100;
  assert.equal(allow("route"), true);
});

test("public listener denies routes/methods/auth before delivery and bounds uploads", async () => {
  let calls = 0;
  const server = await listenHooks({
    port: 0,
    log,
    routes: (p) =>
      p === "/flows/acme"
        ? {
            id: "flow:acme",
            methods: ["POST"],
            authorize: (h) => h.authorization === "Bearer example",
            handle: async (r) => {
              calls++;
              return { status: 202, body: r.body.toString() };
            },
          }
        : undefined,
  });
  const request = (p: string, method = "POST", token?: string, body = "{}") =>
    fetch(`http://127.0.0.1:${server.port}${p}`, {
      method,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      ...(method === "POST" ? { body } : {}),
    });
  try {
    for (const p of ["/", "/rpc/threads.send", "/health", "/flows/other", "/x/flows/acme", "/flows/acme/data"])
      assert.equal((await request(p, "POST", "example")).status, 404, p);
    assert.equal((await request("/flows/acme", "GET", "example")).status, 405);
    assert.equal((await request("/flows/acme")).status, 401);
    assert.equal((await request("/flows/acme", "POST", "wrong")).status, 401);
    assert.equal(calls, 0);
    const ok = await request("/flows/acme", "POST", "example", "raw bytes");
    assert.equal(ok.status, 202);
    assert.equal(await ok.text(), "raw bytes");
    assert.equal((await request("/flows/acme", "POST", "example", "x".repeat(PUBLIC_BODY_MAX + 1))).status, 413);
    assert.equal(calls, 1);
  } finally {
    await server.close();
  }
});

test("public listener rejects raw traversal and rates even unauthenticated requests", async () => {
  const timers = manualTimers();
  let calls = 0;
  const server = await listenHooks({
    port: 0,
    log,
    timers,
    routes: (path) =>
      path === "/flows/acme"
        ? {
            id: "flow:acme",
            methods: ["POST"],
            authorize: () => false,
            handle: async () => {
              calls++;
              return { status: 202 };
            },
          }
        : undefined,
  });
  const raw = (path: string) =>
    new Promise<number | undefined>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: server.port, path, method: "POST" }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on("error", reject);
      req.end();
    });
  try {
    for (const path of [
      "/x/../flows/acme",
      "/flows/%61cme",
      "/flows%2facme",
      "//flows/acme",
      "/flows/acme/..",
      "/flows/acme\\\\extra",
    ])
      assert.equal(await raw(path), 404, path);
    for (let i = 0; i < 120; i++) assert.equal(await raw("/flows/acme"), 401);
    assert.equal(await raw("/flows/acme"), 429);
    timers.tick(60_000);
    assert.equal(await raw("/flows/acme"), 401);
    assert.equal(calls, 0);
  } finally {
    await server.close();
  }
});

test("public route failures do not leak exceptions or crash later requests", async () => {
  const server = await listenHooks({
    port: 0,
    log,
    routes: (path) => {
      if (path === "/throws") throw new Error("private-secret-marker");
      return undefined;
    },
  });
  try {
    const failed = await fetch(`http://127.0.0.1:${server.port}/throws`);
    assert.equal(failed.status, 500);
    assert.equal((await failed.text()).includes("private-secret-marker"), false);
    assert.equal((await fetch(`http://127.0.0.1:${server.port}/unknown`)).status, 404);
  } finally {
    await server.close();
  }
});

test("public deadline covers a stalled upload without calling its destination", async () => {
  const timers = manualTimers();
  let calls = 0;
  const server = await listenHooks({
    port: 0,
    log,
    timers,
    routes: () => ({
      id: "upload",
      methods: ["POST"],
      authorize: () => true,
      handle: async () => {
        calls++;
        return { status: 200 };
      },
    }),
  });
  const req = http.request({ host: "127.0.0.1", port: server.port, path: "/upload", method: "POST" });
  const result = new Promise<number | undefined>((resolve, reject) => {
    req.on("response", (r) => {
      r.resume();
      resolve(r.statusCode);
    });
    req.on("error", reject);
  });
  try {
    req.flushHeaders();
    req.write("partial");
    await waitFor(() => timers.pending() === 1, "upload deadline armed");
    timers.tick(PUBLIC_DEADLINE_MS);
    assert.equal(await result, 503);
    assert.equal(calls, 0);
  } finally {
    req.destroy();
    await server.close();
  }
});

test("public deadline aborts delivery and never returns a late response", async () => {
  const timers = manualTimers();
  let aborted = false;
  const server = await listenHooks({
    port: 0,
    log,
    timers,
    routes: () => ({
      id: "slow",
      methods: ["POST"],
      authorize: () => true,
      handle: async (_r, signal) =>
        new Promise((resolve) =>
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              resolve({ status: 200 });
            },
            { once: true },
          ),
        ),
    }),
  });
  try {
    const result = fetch(`http://127.0.0.1:${server.port}/slow`, { method: "POST", body: "{}" });
    await waitFor(() => timers.pending() === 1, "delivery deadline armed");
    timers.tick(PUBLIC_DEADLINE_MS);
    assert.equal((await result).status, 503);
    assert.equal(aborted, true);
  } finally {
    await server.close();
  }
});

test("a non-cooperative route retains its slots after timeout without starving another route", async () => {
  const timers = manualTimers();
  let calls = 0;
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const server = await listenHooks({
    port: 0,
    log,
    timers,
    routes: (path) => ({
      id: path,
      methods: ["POST"],
      authorize: () => true,
      handle: async () => {
        if (path === "/held") {
          calls++;
          await held;
        }
        return { status: 202 };
      },
    }),
  });
  const send = (path: string) => fetch(`http://127.0.0.1:${server.port}${path}`, { method: "POST", body: "{}" });
  const pending: Promise<Response>[] = [];
  try {
    for (let i = 0; i < 16; i++) pending.push(send("/held"));
    await waitFor(() => calls === 16, "all route slots occupied");
    timers.tick(PUBLIC_DEADLINE_MS);
    assert.deepEqual(await Promise.all(pending.map(async (p) => (await p).status)), Array(16).fill(503));
    let answered = false;
    const overflow = send("/held").then((response) => {
      answered = true;
      return response;
    });
    await waitFor(() => answered || calls > 16, "overflow admitted or rejected");
    if (!answered) timers.tick(PUBLIC_DEADLINE_MS);
    assert.equal((await overflow).status, 429);
    assert.equal(calls, 16, "timed-out work is still counted");
    assert.equal((await send("/healthy")).status, 202);
    release?.();
    await waitFor(() => timers.pending() === 0, "held work settles");
    assert.equal((await send("/held")).status, 202);
  } finally {
    release?.();
    await Promise.allSettled(pending);
    await server.close();
  }
});
