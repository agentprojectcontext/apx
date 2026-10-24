// The public address for channels' webhooks: the listener takes only `/hooks/<channel>` and hands the request to that
// channel's adapter; Tailscale Funnel, ngrok or the owner's own URL put it in front, and each channel learns its address.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { TailscaleRun } from "./access.ts";
import type { ChannelAdapter, HookRequest } from "./channels/types.ts";
import { say, scriptedLlm, startCore } from "./engine/testkit.ts";
import { waitFor } from "./testkit/platform.ts";
import { createWebhooks, NGROK_WAIT_MS, type NgrokProcess, type NgrokStart, ngrokLine } from "./webhooks.ts";

const got: HookRequest[] = [];
let hookUrl: (() => string | undefined) | undefined;
const hookAdapter = (): ChannelAdapter => ({
  caps: { typing: false, buttons: false },
  async start(io) {
    hookUrl = io.hookUrl;
    return { account: "acme-bot" };
  },
  async stop() {},
  async send() {
    return {};
  },
  async webhook(req) {
    got.push(req);
    return req.headers["x-sig"] === "ok" ? { status: 200, body: { ok: true } } : { status: 401 };
  },
});

const tsCalls: string[][] = [];
const tailscale: TailscaleRun = async (args) => {
  tsCalls.push(args);
  if (args[0] === "status")
    return { ok: true, out: JSON.stringify({ Self: { DNSName: "acme.tailnet-1234.ts.net." } }) };
  return { ok: true, out: "" };
};

let ngrokArgs: string[] = [];
let ngrokLines: ((line: string) => void) | undefined;
let ngrokExit: ((code: number | null) => void) | undefined;
let ngrokStopped = 0;
let ngrokSays = '{"lvl":"info","msg":"started tunnel","url":"https://abc-123.ngrok-free.app"}';
const ngrok: NgrokStart = (args) => {
  ngrokArgs = args;
  const p: NgrokProcess = {
    onLine: (fn) => {
      ngrokLines = fn;
      setTimeout(() => fn(ngrokSays), 5);
    },
    onExit: (fn) => {
      ngrokExit = fn;
    },
    stop: () => {
      ngrokStopped++;
    },
  };
  return p;
};

let env: Awaited<ReturnType<typeof startCore>>;
let port = 0;
const post = (path: string, body: string, headers: Record<string, string> = {}, method = "POST") =>
  fetch(`http://127.0.0.1:${port}${path}`, { method, headers, ...(method === "POST" ? { body } : {}) });

before(async () => {
  env = await startCore({
    llm: scriptedLlm(() => say("ok")),
    channelAdapters: { teams: () => hookAdapter() },
    tailscale,
    ngrok,
  });
  await env.client.call("channels.set", {
    id: "teams",
    channel: { type: "teams", agent_id: "roby" },
    token: "example-token",
  });
  port = (await env.client.call("webhooks.get", {})).port;
});
after(async () => {
  await env.core.close();
  await env.cleanup();
});

test("the listener hands a channel's webhook to its adapter, bytes as they came, and nothing else gets through", async () => {
  const r = await post("/hooks/teams", '{"type":"message"}', { "x-sig": "ok", "content-type": "application/json" });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  const req = got.at(-1);
  assert.equal(req?.body.toString(), '{"type":"message"}');
  assert.equal(req?.path, "");
  assert.equal(req?.headers["x-sig"], "ok", "headers come lowercased");

  assert.equal((await post("/hooks/teams", "{}")).status, 401, "the adapter refuses what it cannot verify");
  assert.equal((await post("/apx/hooks/teams/files/1", "{}", { "x-sig": "ok" })).status, 200, "a prefix is fine");
  assert.equal(got.at(-1)?.path, "/files/1");
  assert.equal((await post("/hooks/nobody", "{}")).status, 404, "an unknown channel");
  assert.equal((await post("/hooks/teams", "", {}, "GET")).status, 405);
  for (const path of ["/rpc/threads.list", "/", "/health", "/index.html"])
    assert.equal((await post(path, "{}")).status, 404, `${path}: the panel and the API are not here`);
  const big = await post("/hooks/teams", "x".repeat(1024 * 1024 + 10), { "x-sig": "ok" }).catch(() => undefined);
  assert.ok(!big || big.status === 413, "a body over 1 MB is refused");
});

test("Tailscale Funnel publishes the listener on 8443 and each channel learns its address; off undoes only that", async () => {
  const on = await env.client.call("webhooks.set", { mode: "tailscale" });
  assert.equal(on.url, "https://acme.tailnet-1234.ts.net:8443");
  assert.equal(on.url_may_change, false);
  assert.deepEqual(
    tsCalls.find((c) => c[0] === "funnel"),
    ["funnel", "--bg", "--https=8443", `http://127.0.0.1:${port}`],
  );
  assert.equal(hookUrl?.(), "https://acme.tailnet-1234.ts.net:8443/hooks/teams");

  const off = await env.client.call("webhooks.set", { mode: "off" });
  assert.equal(off.url, undefined);
  assert.deepEqual(
    tsCalls.findLast((c) => c[0] === "funnel"),
    ["funnel", "--https=8443", "off"],
  );
  assert.equal(hookUrl?.(), undefined);
});

test("ngrok: its address is used; the owner is told only when it is new; a reserved domain is passed on", async () => {
  const on = await env.client.call("webhooks.set", { mode: "ngrok" });
  assert.equal(on.url, "https://abc-123.ngrok-free.app");
  assert.equal(on.url_may_change, true, "the first address: paste it into the platform");
  assert.deepEqual(ngrokArgs.slice(0, 2), ["http", `127.0.0.1:${port}`]);

  await env.client.call("webhooks.set", { mode: "off" });
  const again = await env.client.call("webhooks.set", { mode: "ngrok" });
  assert.equal(again.url, "https://abc-123.ngrok-free.app");
  assert.equal(again.url_may_change, false, "the same address as last time: nothing to paste again");

  ngrokSays = '{"lvl":"info","msg":"started tunnel","url":"https://xyz-789.ngrok-free.app"}';
  const moved = await env.client.call("webhooks.set", { mode: "ngrok" });
  assert.equal(moved.url_may_change, true, "another address after a restart: the owner is told");

  ngrokSays = '{"lvl":"info","msg":"started tunnel","url":"https://acme.ngrok.app"}';
  await env.client.call("webhooks.set", { mode: "ngrok", domain: "acme.ngrok.app" });
  assert.deepEqual(ngrokArgs.slice(-2), ["--url", "acme.ngrok.app"]);
  assert.equal(hookUrl?.(), "https://acme.ngrok.app/hooks/teams");
  assert.ok(ngrokStopped >= 3, "each new start stopped the tunnel before it");

  ngrokExit?.(1);
  const down = await env.client.call("webhooks.get", {});
  assert.equal(down.url, undefined, "ngrok stopped: no address");
  assert.equal(down.url_may_change, false);
  assert.equal(down.error, "ngrok_stopped");
  assert.equal(down.error_detail, "exit 1");
  assert.ok(ngrokLines, "the log was read");
  await env.client.call("webhooks.set", { mode: "off" });
});

test("the owner's own address takes only https, and the choice is kept for the next start", async () => {
  await assert.rejects(env.client.call("webhooks.set", { mode: "custom", url: "http://example.com" }), /https/);
  const own = await env.client.call("webhooks.set", { mode: "custom", url: "https://hooks.example.com/" });
  assert.equal(own.url, "https://hooks.example.com");
  const kept = env.core.store.settings.read("webhooks");
  assert.deepEqual([kept.mode, kept.url], ["custom", "https://hooks.example.com/"]);
  assert.equal(kept.ngrok_last, "https://acme.ngrok.app", "ngrok's last address is kept for when it is chosen again");
  await env.client.call("webhooks.set", { mode: "off" });
});

test("ngrok's JSON log: the tunnel's address, or its error", () => {
  assert.deepEqual(ngrokLine('{"msg":"started tunnel","url":"https://x.ngrok.app"}'), { url: "https://x.ngrok.app" });
  assert.deepEqual(ngrokLine('{"lvl":"eror","err":"authentication failed: ERR_NGROK_4018"}'), {
    error: "authentication failed: ERR_NGROK_4018",
  });
  assert.deepEqual(ngrokLine("not json"), {});
});

test("a Teams group chat's long id can be listed as a room", async () => {
  const id = `19:${"a".repeat(36)}_${"b".repeat(36)}@unq.gbl.spaces`;
  const list = await env.client.call("channels.set", {
    id: "teams",
    channel: { type: "teams", agent_id: "roby", rooms: { rooms: [{ id, name: "Acme team", mode: "mention" }] } },
  });
  assert.equal(list.channels.find((c) => c.id === "teams")?.rooms?.rooms[0]?.id, id);
});

test("what this computer has is asked once a while, not on every look the panel takes", async () => {
  const before = tsCalls.filter((c) => c[0] === "status").length;
  for (let i = 0; i < 5; i++) await env.client.call("webhooks.get", {});
  assert.ok(tsCalls.filter((c) => c[0] === "status").length - before <= 1, "one tailscale status at most");
});

test("a tunnel that dies while ngrok is chosen comes back on its own, later each time", async () => {
  const waits: number[] = [];
  let exit: ((code: number | null) => void) | undefined;
  let starts = 0;
  const hooks = createWebhooks({
    store: env.core.store,
    port: () => 1234,
    log: { info: () => {}, warn: () => {}, error: () => {} },
    ngrok: () => {
      starts++;
      return {
        onLine: (fn) => setTimeout(() => fn('{"msg":"started tunnel","url":"https://abc-123.ngrok-free.app"}'), 1),
        onExit: (fn) => {
          exit = fn;
        },
        stop: () => {},
      };
    },
    retryMs: (attempt) => {
      waits.push(attempt);
      return 5;
    },
  });
  try {
    assert.equal((await hooks.set({ mode: "ngrok" })).url, "https://abc-123.ngrok-free.app");
    exit?.(1);
    assert.equal(hooks.base(), undefined);
    await waitFor(() => starts >= 2, "ngrok started again", { every: 5 });
    await waitFor(() => hooks.base(), "the address back", { every: 5 });
    assert.equal(starts, 2, "started again");
    assert.equal(hooks.base(), "https://abc-123.ngrok-free.app");
    exit?.(1);
    await waitFor(() => starts >= 3, "ngrok started a third time", { every: 5 });
    assert.deepEqual(waits, [0, 0], "an address that came back starts the waits over");
    await hooks.set({ mode: "off" });
    exit?.(1);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(starts, 3, "off: never started again");
  } finally {
    hooks.close();
  }
});

test("a core whose ngrok is slow to answer starts its channels without waiting for it", async () => {
  const first = await startCore({ llm: scriptedLlm(() => say("ok")), tailscale, ngrok });
  await first.client.call("webhooks.set", { mode: "ngrok" });
  await first.core.close();
  const silent: NgrokStart = () => ({ onLine: () => {}, onExit: () => {}, stop: () => {} });
  const t0 = Date.now();
  const second = await startCore({ llm: scriptedLlm(() => say("ok")), tailscale, ngrok: silent, home: first.home });
  try {
    assert.ok(Date.now() - t0 < NGROK_WAIT_MS / 3, `started in ${Date.now() - t0} ms`);
    const st = await second.client.call("webhooks.get", {});
    assert.deepEqual([st.mode, st.url], ["ngrok", undefined]);
  } finally {
    await second.core.close();
    await second.cleanup();
  }
});
