import assert from "node:assert/strict";
import http from "node:http";
import { afterEach, test } from "node:test";
import { ApxClient, ApxError, ApxSocket } from "./client.ts";
import { PROTOCOL_VERSION } from "./constants.ts";
import type { MethodName } from "./methods.ts";

test("a chat read survives one dropped response without retrying a one-time effect", async (t) => {
  const reads: Array<{ headers: http.IncomingHttpHeaders; body: string }> = [];
  let effects = 0;
  const result = { thread: { id: "th_acme" }, messages: [], runs: [] };
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    if (req.url === "/rpc/threads.get") {
      reads.push({ headers: req.headers, body });
      if (reads.length === 1) return req.socket.destroy();
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, result }));
      return;
    }
    effects++;
    req.socket.destroy();
  });
  t.after(() => {
    server.closeAllConnections();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  let keys = 0;
  const client = new ApxClient({
    url: `http://127.0.0.1:${address.port}`,
    token: "test-owner",
    clientToken: "test-client",
    actor: "agent",
    requestKey: () => `key-${++keys}`,
  });
  assert.deepEqual(await client.call("threads.get", { thread: "th_acme" }), result);
  assert.equal(reads.length, 2);
  assert.equal(keys, 1);
  assert.equal(reads[0]?.body, '{"thread":"th_acme"}');
  assert.equal(reads[1]?.body, reads[0]?.body);
  for (const name of ["authorization", "x-apx-client", "x-apx-actor", "idempotency-key"])
    assert.equal(reads[1]?.headers[name], reads[0]?.headers[name]);
  await assert.rejects(client.call("clients.create", { name: "Acme", scopes: ["chat"] }), TypeError);
  assert.equal(effects, 1);
});

test("chat reads retry socket resets at most once within one deadline and request", async (t) => {
  const timeout = AbortSignal.timeout;
  let deadlines = 0;
  t.mock.method(AbortSignal, "timeout", (ms: number) => {
    deadlines++;
    return timeout(ms);
  });
  const client = new ApxClient({ url: "http://core.example.com" });
  for (const code of ["ECONNRESET", "UND_ERR_SOCKET"]) {
    const requests: RequestInit[] = [];
    const error = new TypeError("socket closed", { cause: { code } });
    t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
      requests.push(init);
      throw error;
    });
    const before = deadlines;
    await assert.rejects(client.call("threads.get", { thread: "th_acme" }), (e) => e === error);
    assert.equal(requests.length, 2);
    assert.equal(requests[1], requests[0]);
    assert.equal(deadlines - before, 1);
  }
});

test("chat read cancellation and non-socket failures never retry", async (t) => {
  const client = new ApxClient({ url: "http://core.example.com" });
  for (const code of ["ENOTFOUND", "ERR_TLS_CERT_ALTNAME_INVALID", undefined]) {
    let attempts = 0;
    const error = new TypeError("network failed", { cause: { code } });
    t.mock.method(globalThis, "fetch", async () => {
      attempts++;
      throw error;
    });
    await assert.rejects(client.call("threads.get", { thread: "th_acme" }), (e) => e === error);
    assert.equal(attempts, 1);
  }
  const controller = new AbortController();
  let attempts = 0;
  const error = new TypeError("socket closed", { cause: { code: "ECONNRESET" } });
  t.mock.method(globalThis, "fetch", async () => {
    attempts++;
    controller.abort(new Error("view closed"));
    throw error;
  });
  await assert.rejects(
    client.withSignal(controller.signal).call("threads.get", { thread: "th_acme" }),
    (e) => e === error,
  );
  assert.equal(attempts, 1);
  t.mock.method(AbortSignal, "timeout", () => AbortSignal.abort(new Error("deadline elapsed")));
  attempts = 0;
  await assert.rejects(client.call("threads.get", { thread: "th_acme" }), (e) => e === error);
  assert.equal(attempts, 1);
});

test("effects and chat read response errors are never retried", async (t) => {
  const client = new ApxClient({ url: "http://core.example.com" });
  let attempts = 0;
  const error = new TypeError("socket closed", { cause: { code: "ECONNRESET" } });
  t.mock.method(globalThis, "fetch", async () => {
    attempts++;
    throw error;
  });
  for (const call of [
    () => client.call("terminal.input", { terminal: "term_acme", data: "echo Acme\n" }),
    () => client.call("clients.create", { name: "Acme", scopes: ["chat"] }),
    () => client.call("threads.send", { thread: "th_acme", text: "hello" }),
  ]) {
    attempts = 0;
    await assert.rejects(call(), (e) => e === error);
    assert.equal(attempts, 1);
  }
  for (const response of [
    Response.json({ ok: false, error: { code: "unavailable", message: "try later" } }, { status: 503 }),
    new Response("not JSON"),
  ]) {
    attempts = 0;
    t.mock.method(globalThis, "fetch", async () => {
      attempts++;
      return response;
    });
    await assert.rejects(client.call("threads.get", { thread: "th_acme" }));
    assert.equal(attempts, 1);
  }
});

test("HTTP client sends credentials, actor, exact params and explicit or fresh idempotency keys", async (t) => {
  const requests: { url: string; init?: RequestInit }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    return Response.json({ ok: true, result: { pong: "Acme" } });
  });
  let key = 0;
  const client = new ApxClient({
    url: "https://core.example.com/",
    token: "test-owner",
    clientToken: "test-client",
    actor: "agent",
    requestKey: () => `key-${++key}`,
  });
  assert.deepEqual(await client.call("system.ping", { echo: "Acme" }, "retry-key"), { pong: "Acme" });
  await client.call("system.ping", {});
  assert.equal(requests[0]?.url, "https://core.example.com/rpc/system.ping");
  assert.equal(requests[0]?.init?.method, "POST");
  assert.deepEqual(requests[0]?.init?.headers, {
    "content-type": "application/json",
    authorization: "Bearer test-owner",
    "x-apx-actor": "agent",
    "x-apx-client": "test-client",
    "idempotency-key": "retry-key",
  });
  assert.equal(requests[0]?.init?.body, '{"echo":"Acme"}');
  assert.equal((requests[1]?.init?.headers as Record<string, string> | undefined)?.["idempotency-key"], "key-1");
});

test("HTTP errors preserve code, detail and retryability; malformed responses and network errors reject", async (t) => {
  const client = new ApxClient({ url: "http://core.example.com" });
  for (const shape of [
    { code: "unavailable", message: "Node offline", detail: { node: "n1" }, retryable: true },
    { code: "unauthorized", message: "Owner required" },
  ]) {
    t.mock.method(globalThis, "fetch", async () => Response.json({ ok: false, error: shape }, { status: 403 }));
    await assert.rejects(client.call("system.health", {}), (e) => {
      assert.ok(e instanceof ApxError);
      assert.equal(e.code, shape.code);
      assert.equal(e.message, shape.message);
      assert.equal(e.retryable, "retryable" in shape ? shape.retryable : false);
      assert.deepEqual(e.detail, "detail" in shape ? shape.detail : undefined);
      return true;
    });
  }
  t.mock.method(globalThis, "fetch", async () => Response.json({ ok: false }, { status: 502 }));
  await assert.rejects(client.call("system.health", {}), { name: "ApxError", code: "internal", message: "HTTP 502" });
  t.mock.method(globalThis, "fetch", async () => new Response("not JSON"));
  await assert.rejects(client.call("system.health", {}), SyntaxError);
  const error = new TypeError("network failed");
  t.mock.method(globalThis, "fetch", async () => {
    throw error;
  });
  await assert.rejects(client.call("system.health", {}), (e) => e === error);
});

test("cancelling a derived client cancels its requests without changing the original client", async (t) => {
  const signals: AbortSignal[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const signal = init.signal;
    assert.ok(signal);
    signals.push(signal);
    signal.throwIfAborted();
    return Response.json({ ok: true, result: {} });
  });
  const client = new ApxClient({ url: "http://core.example.com" });
  const controller = new AbortController();
  controller.abort(new Error("view closed"));
  await assert.rejects(client.withSignal(controller.signal).call("system.health", {}), /view closed/);
  await client.call("system.health", {});
  assert.deepEqual(
    signals.map((s) => s.aborted),
    [true, false],
  );
});

test("derived clients retain cancellation from both their parent and their new signal", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    init.signal?.throwIfAborted();
    return Response.json({ ok: true, result: {} });
  });
  for (const cancelled of ["parent", "child"]) {
    const parent = new AbortController();
    const child = new AbortController();
    const client = new ApxClient({ url: "http://core.example.com", signal: parent.signal }).withSignal(child.signal);
    (cancelled === "parent" ? parent : child).abort(new Error(`${cancelled} canceled`));
    await assert.rejects(client.call("system.health", {}), new RegExp(`${cancelled} canceled`));
  }
});

test("every long-running method gives its server time to finish and other methods keep the configured deadline", async (t) => {
  const deadlines: number[] = [];
  t.mock.method(AbortSignal, "timeout", (ms: number) => {
    deadlines.push(ms);
    return new AbortController().signal;
  });
  t.mock.method(globalThis, "fetch", async () => Response.json({ ok: true, result: {} }));
  const client = new ApxClient({ url: "http://core.example.com", timeoutMs: 1234 });
  const cases: [MethodName, object, number][] = [
    ["browser.handoff", {}, 320_000],
    ["browser.handoff", { timeout_s: 1 }, 21_000],
    ["browser.import_cookies", {}, 130_000],
    ["mcp.call", {}, 180_000],
    ["mcp.describe", {}, 45_000],
    ["mcp.tools", {}, 45_000],
    ["mcp.test", {}, 45_000],
    ["system.import_v1", {}, 60_000],
    ["skills.preview", {}, 90_000],
    ["skills.import", {}, 90_000],
    ["system.update", {}, 1_500_000],
    ["system.updates", {}, 120_000],
    ["harness.call", {}, 1_020_000],
    ["models.list", {}, 150_000],
    ["threads.compact", {}, 120_000],
    ["media.image", {}, 720_000],
    ["media.speak", {}, 150_000],
    ["media.transcribe", {}, 190_000],
    ["media.upload", {}, 120_000],
    ["surfaces.media", {}, 120_000],
    ["surfaces.fetch", {}, 45_000],
    ["surfaces.export", {}, 180_000],
    ["surfaces.import", {}, 180_000],
    ["memory.reindex", {}, 600_000],
    ["sessions.projects", {}, 60_000],
    ["sessions.import", {}, 300_000],
    ["sessions.digest", {}, 660_000],
    ["channels.recover", {}, 170_000],
    ["runs.wait", {}, 70_000],
    ["runs.wait", { timeout_s: 0 }, 10_000],
    ["system.ping", {}, 1234],
  ];
  for (const [method, params, expected] of cases) {
    await client.call(method, params as never);
    assert.equal(deadlines.at(-1), expected, method);
  }
});

class FakeWebSocket extends EventTarget {
  static OPEN = 1;
  static CLOSED = 3;
  static latest: FakeWebSocket;
  readyState = 1;
  readonly sent: Record<string, unknown>[] = [];
  readonly url: string;
  constructor(url: string) {
    super();
    this.url = url;
    FakeWebSocket.latest = this;
    queueMicrotask(() => this.dispatchEvent(new Event("open")));
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  receive(data: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data: typeof data === "string" ? data : JSON.stringify(data) }));
  }
  close() {
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }
}

const realWebSocket = globalThis.WebSocket;
afterEach(() => {
  globalThis.WebSocket = realWebSocket;
});

async function openSocket(timeout = 1000) {
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  const socket = new ApxSocket("ws://core.example.com/ws", timeout, () => "fresh-key");
  const opening = socket.open({ t: "hello", protocol: PROTOCOL_VERSION });
  const wire = FakeWebSocket.latest;
  await Promise.resolve();
  wire.receive({
    t: "welcome",
    protocol: PROTOCOL_VERSION,
    session: "s1",
    server: { version: "test", code_sha: "abc" },
  });
  await opening;
  return { socket, wire };
}

test("a socket handshake uses the configured client, encoded token, role and capabilities", async () => {
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  const client = new ApxClient({
    url: "https://core.example.com/",
    token: "a+b&c",
    actor: "agent",
    client: { name: "Acme", version: "1.2.3" },
  });
  const opening = client.connect("node", ["browser"]);
  const wire = FakeWebSocket.latest;
  await Promise.resolve();
  assert.equal(wire.url, "wss://core.example.com/ws?token=a%2Bb%26c");
  assert.deepEqual(wire.sent, [
    {
      t: "hello",
      protocol: PROTOCOL_VERSION,
      actor: "agent",
      role: "node",
      caps: ["browser"],
      client: { name: "Acme", version: "1.2.3" },
    },
  ]);
  wire.receive({ t: "welcome", session: "s1" });
  const socket = await opening;
  assert.equal(socket.welcome?.session, "s1");
  socket.close();
});

test("client cancellation closes a pending handshake and refuses an already canceled connection", async () => {
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  const controller = new AbortController();
  const client = new ApxClient({ url: "https://core.example.com", signal: controller.signal });
  const opening = client.connect("node", ["browser"]);
  const denied = assert.rejects(opening, /connection changed/);
  const wire = FakeWebSocket.latest;
  await Promise.resolve();
  controller.abort(new Error("connection changed"));
  await denied;
  assert.equal(wire.readyState, FakeWebSocket.CLOSED);
  await assert.rejects(client.connect(), /connection changed/);
  assert.equal(FakeWebSocket.latest, wire);
});

test("client cancellation closes an established socket and rejects its pending calls", async () => {
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  const controller = new AbortController();
  const client = new ApxClient({ url: "https://core.example.com" }).withSignal(controller.signal);
  const opening = client.connect("node", ["browser"]);
  await Promise.resolve();
  FakeWebSocket.latest.receive({ t: "welcome", session: "s1" });
  const socket = await opening;
  const pending = assert.rejects(socket.call("system.ping", {}), /socket closed/);
  controller.abort();
  await pending;
  await socket.closed;
  assert.equal(FakeWebSocket.latest.readyState, FakeWebSocket.CLOSED);
});

test("socket calls correlate out-of-order responses, reject typed errors, and ignore malformed or unknown frames", async () => {
  const { socket, wire } = await openSocket();
  try {
    const first = socket.call("system.ping", { echo: "first" }, "explicit-key");
    const second = socket.call("system.ping", { echo: "second" });
    assert.deepEqual(wire.sent.slice(1), [
      { t: "req", id: "r1", method: "system.ping", params: { echo: "first" }, idem: "explicit-key" },
      { t: "req", id: "r2", method: "system.ping", params: { echo: "second" }, idem: "fresh-key" },
    ]);
    for (const malformed of ["broken JSON", "null", "[]", '{"t":"unknown"}', '{"t":"res","id":"missing","ok":true}'])
      wire.receive(malformed);
    wire.receive({ t: "res", id: "r2", ok: true, result: { pong: "second" } });
    wire.receive({
      t: "res",
      id: "r1",
      ok: false,
      error: { code: "unauthorized", message: "Owner only", retryable: false },
    });
    assert.deepEqual(await second, { pong: "second" });
    await assert.rejects(first, { name: "ApxError", code: "unauthorized", message: "Owner only" });
  } finally {
    socket.close();
  }
});

test("socket listeners unsubscribe and node events carry an increasing sequence", async () => {
  const { socket, wire } = await openSocket();
  const seen: unknown[] = [];
  const off = socket.onEvent((event) => seen.push(event));
  const event = { t: "event", stream: "tasks", seq: 1, type: "changed", payload: { id: "tsk_1" } };
  wire.receive(event);
  off();
  wire.receive({ ...event, seq: 2 });
  assert.deepEqual(seen, [event]);
  socket.emit("browser", "changed", { tab: "t1" });
  socket.emit("browser", "closed", { tab: "t1" });
  assert.deepEqual(
    wire.sent.slice(1).map((e) => [e.t, e.stream, e.seq, e.type]),
    [
      ["event", "browser", 1, "changed"],
      ["event", "browser", 2, "closed"],
    ],
  );
  socket.close();
  await socket.closed;
  await new ApxSocket("ws://core.example.com", 10).closed;
});

test("nodes answer inbound requests and preserve typed failures without exposing exception details", async () => {
  const { socket, wire } = await openSocket();
  wire.receive({ t: "req", id: "n1", method: "browser.tabs", params: {} });
  await Promise.resolve();
  assert.deepEqual(wire.sent.at(-1), {
    t: "res",
    id: "n1",
    ok: false,
    error: { code: "unknown_method", message: "client does not serve browser.tabs" },
  });
  socket.onRequest(async (method, params) => ({ method, params }));
  wire.receive({ t: "req", id: "n2", method: "browser.tabs", params: { by: "scout" } });
  await Promise.resolve();
  assert.deepEqual(wire.sent.at(-1), {
    t: "res",
    id: "n2",
    ok: true,
    result: { method: "browser.tabs", params: { by: "scout" } },
  });
  for (const [error, code, message] of [
    [new ApxError({ code: "bad_request", message: "Invalid tab", detail: "private" }), "bad_request", "Invalid tab"],
    [new Error("Node failed"), "internal", "Node failed"],
    ["failed", "internal", "failed"],
  ] as const) {
    socket.onRequest(async () => {
      throw error;
    });
    wire.receive({ t: "req", id: "n3", method: "browser.tabs", params: {} });
    await Promise.resolve();
    assert.deepEqual(wire.sent.at(-1), { t: "res", id: "n3", ok: false, error: { code, message } });
  }
  socket.close();
});

test("closed sockets reject pending calls and new calls instead of leaving promises unresolved", async () => {
  const { socket } = await openSocket();
  const pending = socket.call("system.ping", {});
  const rejected = assert.rejects(pending, /socket closed/);
  const closed = socket.closed;
  socket.close();
  await rejected;
  await closed;
  await assert.rejects(socket.call("system.ping", {}), /socket not open/);
});

test("socket call and handshake deadlines reject, and closing before welcome rejects immediately", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { socket, wire } = await openSocket(50);
  const call = assert.rejects(socket.call("system.ping", {}), { name: "ApxError", code: "timeout" });
  t.mock.timers.tick(50);
  await call;
  wire.receive({ t: "res", id: "r1", ok: true, result: {} });
  socket.close();
  for (const kind of ["timeout", "close", "error"] as const) {
    const next = new ApxSocket("ws://core.example.com", 50);
    const failed = assert.rejects(
      next.open({}),
      kind === "timeout" ? /welcome timeout/ : kind === "close" ? /closed before welcome/ : /socket error/,
    );
    if (kind === "timeout") t.mock.timers.tick(50);
    else if (kind === "close") FakeWebSocket.latest.close();
    else FakeWebSocket.latest.dispatchEvent(new Event("error"));
    await failed;
    assert.equal(FakeWebSocket.latest.readyState, FakeWebSocket.CLOSED, `${kind} must release the connection`);
    next.close();
  }
});
