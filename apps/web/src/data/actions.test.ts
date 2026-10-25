import assert from "node:assert/strict";
import { after, beforeEach, type TestContext, test } from "node:test";
import { type Message, Surface, Thread } from "@apx/protocol";
import { data } from "./state.ts";

const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { location: { origin: "http://panel.example.test" } },
});
const actions = await import("./actions.ts");
const { newChatId } = await import("./newChat.ts");
after(() => {
  if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
  else Reflect.deleteProperty(globalThis, "window");
});
const initial = data.get();
beforeEach(() => {
  data.set(initial);
});
const at = "2026-01-01T00:00:00Z";
const thread = (id = "thr_1", state = "idle") =>
  Thread.parse({ id, title: id, kind: "loose", state, agent_ids: ["roby"], created_at: at, updated_at: at });
const message = (id: string, seq: number): Message => ({
  id,
  seq,
  thread_id: "thr_1",
  author: { kind: "user" },
  parts: [{ type: "text", text: id }],
  created_at: at,
});
const doc = () =>
  Surface.parse({
    id: "srf_1",
    name: "report",
    title: "Report",
    html: "<p>Acme</p>",
    pinned: false,
    app: false,
    version: 1,
    created_by: "owner",
    created_at: at,
    updated_at: at,
  });

function rpc(t: TestContext, replies: Record<string, unknown>) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls: [string, unknown][] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    const method = url.split("/").at(-1) ?? "";
    calls.push([method, JSON.parse(String(init.body))]);
    assert.ok(Object.hasOwn(replies, method), `unexpected RPC ${method}`);
    const answer = replies[method];
    if (answer instanceof Error) throw answer;
    return Response.json({ ok: true, result: typeof answer === "function" ? await answer() : answer });
  });
  return calls;
}

test("sending renders an optimistic attachment once, then replaces it with the persisted message and run", async (t) => {
  const pending = Promise.withResolvers<unknown>();
  const calls = rpc(t, { "threads.send": () => pending.promise });
  data.set({ threads: { thr_1: thread() }, messages: { thr_1: [message("first", 1)] } });
  const sent = actions.send("thr_1", "Hello", {
    attachments: [
      { id: "img_1", kind: "image", name: "photo.png", mime: "image/png", bytes: 3 },
      { id: "audio_1", kind: "audio", name: "voice.ogg", mime: "audio/ogg", bytes: 4 },
      { id: "file_1", kind: "file", name: "report.pdf", mime: "application/pdf", bytes: 5 },
    ],
  });
  const optimistic = data.get().messages.thr_1?.at(-1);
  assert.ok(optimistic);
  assert.ok(optimistic.id.startsWith("local_"));
  assert.deepEqual(
    optimistic.parts.map((p) => p.type),
    ["text", "image", "audio", "file"],
  );
  assert.equal(data.get().threads.thr_1?.state, "submitted");
  const saved = message("saved", 2);
  pending.resolve({ message: saved, run: { id: "run_1", state: "submitted" } });
  await sent;
  assert.deepEqual(calls, [
    ["threads.send", { thread: "thr_1", text: "Hello", mode: "queue", attachments: ["img_1", "audio_1", "file_1"] }],
  ]);
  assert.deepEqual(data.get().messages.thr_1, [message("first", 1), saved]);
  assert.equal(data.get().runs.run_1?.state, "submitted");
});

test("sending works without randomUUID and rejects missing randomness before sending or changing chat state", async (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  const source = globalThis.crypto;
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor);
  });
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { getRandomValues: source.getRandomValues.bind(source) },
  });
  const calls = rpc(t, { "threads.send": { message: message("saved", 1) } });
  data.set({ threads: { thr_1: thread() } });
  await actions.send("thr_1", "HTTP draft");
  assert.equal(calls.length, 1);
  assert.deepEqual(data.get().messages.thr_1, [message("saved", 1)]);
  data.set({ threads: { thr_1: thread() } });
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: {} });
  await assert.rejects(actions.send("thr_1", "Keep this draft"), /secure request key generator/);
  assert.equal(calls.length, 1);
  assert.deepEqual(data.get().messages.thr_1, [message("saved", 1)]);
  assert.equal(data.get().threads.thr_1?.state, "idle");
  data.set({ threads: { thr_1: thread("thr_1", "submitted") } });
  await assert.rejects(actions.send("thr_1", "Still queued"), /secure request key generator/);
  assert.equal(data.get().threads.thr_1?.state, "submitted");
  assert.equal(calls.length, 1);
});

test("busy chats steer by default and queue only when explicitly chosen; failed sends remove placeholders", async (t) => {
  const replies: Record<string, unknown> = { "threads.send": { message: message("saved", 1) } };
  const calls = rpc(t, replies);
  data.set({ threads: { thr_1: thread("thr_1", "working") } });
  await actions.send("thr_1", "Steer");
  await actions.send("thr_1", "Later", { queue: true });
  assert.deepEqual(
    calls.map(([, p]) => p),
    [
      { thread: "thr_1", text: "Steer", mode: "steer" },
      { thread: "thr_1", text: "Later", mode: "queue" },
    ],
  );
  assert.equal(data.get().threads.thr_1?.state, "working");
  const error = new Error("offline");
  replies["threads.send"] = error;
  data.set({ threads: { thr_1: thread() } });
  await assert.rejects(actions.send("thr_1", "Lost"), (e) => e === error);
  assert.equal(
    data.get().messages.thr_1?.some((m) => m.id.startsWith("local_")),
    false,
  );
  assert.equal(data.get().threads.thr_1?.state, "idle");
});

test("a failed steer or late send failure cannot erase a turn that is still working", async (t) => {
  const replies: Record<string, unknown> = { "threads.send": new Error("offline") };
  rpc(t, replies);
  data.set({ threads: { thr_1: thread("thr_1", "working") } });
  await assert.rejects(actions.send("thr_1", "Steer"), /offline/);
  assert.equal(data.get().threads.thr_1?.state, "working");
  const pending = Promise.withResolvers<unknown>();
  replies["threads.send"] = () => pending.promise;
  data.set({ threads: { thr_1: thread() } });
  const sent = actions.send("thr_1", "Next");
  data.set({ threads: { thr_1: thread("thr_1", "working") } });
  pending.reject(new Error("late failure"));
  await assert.rejects(sent, /late failure/);
  assert.equal(data.get().threads.thr_1?.state, "working");
});

test("thread loading deduplicates pending reads and keeps locally optimistic messages in sequence order", async (t) => {
  const pending = Promise.withResolvers<unknown>();
  const calls = rpc(t, { "threads.get": () => pending.promise });
  const local = message("local_1", 2.5);
  data.set({ messages: { thr_1: [local] } });
  const loading = actions.loadThread("thr_1");
  pending.resolve({ thread: thread(), messages: [message("second", 2), message("first", 1)], runs: [] });
  await loading;
  assert.deepEqual(
    data.get().messages.thr_1?.map((m) => m.id),
    ["first", "second", "local_1"],
  );
  assert.equal(data.get().threadLoad.thr_1, "ready");
  assert.equal(calls.length, 1);
  data.set({ threadLoad: { thr_1: "loading" } });
  await actions.loadThread("thr_1");
  assert.equal(calls.length, 1);
});

test("failed transcript reads distinguish empty errors from cached transcripts, and reconnect refetches loaded chats", async (t) => {
  const replies: Record<string, unknown> = { "threads.get": new Error("offline") };
  const calls = rpc(t, replies);
  await actions.loadThread("missing");
  assert.equal(data.get().threadLoad.missing, "error");
  data.set({ messages: { thr_1: [message("saved", 1)] } });
  await actions.loadThread("thr_1");
  assert.equal(data.get().threadLoad.thr_1, "ready");
  replies["threads.get"] = { thread: thread(), messages: [message("new", 2)], runs: [] };
  await actions.refetchLoaded();
  assert.equal(calls.length, 3);
  assert.deepEqual(
    data.get().messages.thr_1?.map((m) => m.id),
    ["new"],
  );
});

test("new chats preserve code policy, cache their transcript and reject malformed draft ids before calling core", async (t) => {
  const created = thread("new-thread");
  const calls = rpc(t, { "threads.create": created });
  assert.deepEqual(
    await actions.createThread({ agentId: "roby", projectId: "prj_1", code: { write: "read-only" } }),
    created,
  );
  assert.deepEqual(calls[0], [
    "threads.create",
    { kind: "code", agent_id: "roby", project_id: "prj_1", write: "read-only" },
  ]);
  assert.deepEqual(data.get().messages[created.id], []);
  assert.equal(data.get().threadLoad[created.id], "ready");
  await actions.makeChat(newChatId({ agent: "roby" }));
  assert.equal(calls.length, 2);
  // No title of its own, so the core names it after its agent and upkeep can give it a real one.
  assert.deepEqual(calls[1], ["threads.create", { kind: "loose", agent_id: "roby" }]);
  await assert.rejects(actions.makeChat("bad-id"), /not a new chat/);
  assert.equal(calls.length, 2);
});

test("read actions avoid already-read or missing chats and mark unread chats locally before the server responds", async (t) => {
  const calls = rpc(t, { "threads.read": {} });
  data.set({ threads: { unread: { ...thread("unread"), unread: 3 }, read: thread("read") } });
  await actions.markAllRead(["unread", "read", "missing"]);
  assert.deepEqual(calls, [["threads.read", { thread: "unread" }]]);
  assert.equal(data.get().threads.unread?.unread, 0);
});

test("surface operations retain fetched documents, update metadata, copy, publish and bound prompt size", async (t) => {
  const surface = doc();
  const updated = { ...surface, pinned: true };
  const shared = { ...updated, share_path: "/s/test-share" };
  const calls = rpc(t, {
    "surfaces.get": surface,
    "surfaces.update": updated,
    "surfaces.copy": { ...surface, id: "srf_copy" },
    "surfaces.share": shared,
    "surfaces.prompt": { run: "run_1" },
  });
  await actions.loadSurfaceDoc(surface.id);
  await actions.setSurfaceFlags(surface.id, { pinned: true, app: false });
  await actions.copySurface(surface.id, undefined, true);
  assert.equal(await actions.shareSurface(surface.id, true), "/s/test-share");
  assert.equal(data.get().surfaces.srf_1?.pinned, true);
  assert.equal(data.get().surfaceDocs.srf_1?.html, surface.html);
  assert.equal(data.get().surfaceDocs.srf_1?.share_path, "/s/test-share");
  assert.equal(data.get().surfaces.srf_copy?.id, "srf_copy");
  await actions.surfacePrompt(surface.id, "x".repeat(5000));
  assert.deepEqual(calls.at(-1), ["surfaces.prompt", { surface: "srf_1", text: "x".repeat(4000) }]);
  assert.deepEqual(calls[2], ["surfaces.copy", { surface: "srf_1", project_id: null, pinned: true }]);
});

test("browser actions update tabs without duplicates, preserve other tabs and encode screenshot mime", async (t) => {
  const tab = { tab: "t1", url: "https://example.com", title: "Acme", profile: "shared", control: { kind: "user" } };
  const replies: Record<string, unknown> = {
    "browser.open": tab,
    "browser.control": { ...tab, control: { kind: "idle" } },
    "browser.screenshot": { mime: "image/jpeg", data: "AA==" },
    "browser.close": {},
    "browser.navigate": {},
    "browser.history": {},
    "browser.tabs": { tabs: [tab] },
  };
  const calls = rpc(t, replies);
  assert.equal(await actions.browserOpen(tab.url), "t1");
  await actions.browserOpen(tab.url);
  assert.equal(data.get().tabs.length, 1);
  await actions.browserControl("t1", "idle");
  assert.equal(data.get().tabs[0]?.control.kind, "idle");
  assert.equal(await actions.screenshot("t1"), "data:image/jpeg;base64,AA==");
  await actions.browserNavigate("t1", "https://example.com/prices");
  await actions.browserHistory("t1", "back");
  await actions.browserClose("t1");
  assert.deepEqual(data.get().tabs, []);
  assert.ok(
    calls.some(
      ([method, params]) =>
        method === "browser.navigate" &&
        JSON.stringify(params) === JSON.stringify({ tab: "t1", url: "https://example.com/prices", by: "operator" }),
    ),
  );
  replies["browser.open"] = new Error("offline");
  assert.equal(await actions.browserOpen(tab.url), undefined);
  replies["browser.tabs"] = new Error("offline");
  await actions.loadTabs();
  assert.deepEqual(data.get().tabs, []);
});

test("browser cookie reads do not request a desktop-only operation while no browser node is available", async (t) => {
  const replies: Record<string, unknown> = {
    "system.health": { subsystems: { browser: { status: "off" } } },
    "browser.cookie_sources": { sources: [{ id: "firefox", family: "firefox" }] },
    "browser.cookie_domains": { domains: [{ domain: "example.com", count: 1 }] },
    "browser.import_cookies": { imported: 1, skipped: 2, failed: 1 },
  };
  const calls = rpc(t, replies);
  assert.deepEqual(await actions.cookieSources(), []);
  assert.deepEqual(calls, [["system.health", {}]]);
  replies["system.health"] = { subsystems: { browser: { status: "ok" } } };
  assert.deepEqual(await actions.cookieSources(), [{ id: "firefox", family: "firefox" }]);
  assert.deepEqual(await actions.cookieDomains("firefox", "example"), [{ domain: "example.com", count: 1 }]);
  await actions.importCookies("firefox", ["example.com"]);
  assert.deepEqual(calls.at(-1), [
    "browser.import_cookies",
    { source: "firefox", domains: ["example.com"], profile: "shared" },
  ]);
});

test("stop, input responses and compaction target the selected entity and keep approval scope", async (t) => {
  const calls = rpc(t, {
    "jobs.cancel": {},
    "threads.cancel": {},
    "runs.respond": {},
    "threads.compact": { compacted: false, reason: "short chat" },
  });
  await actions.cancelJob("job_1");
  await actions.cancel("thr_1");
  await actions.respond("input_1", { decision: "approve", scope: "session" });
  await actions.compactThread("thr_1");
  assert.deepEqual(calls, [
    ["jobs.cancel", { job: "job_1" }],
    ["threads.cancel", { thread: "thr_1" }],
    ["runs.respond", { input: "input_1", decision: "approve", scope: "session" }],
    ["threads.compact", { thread: "thr_1" }],
  ]);
});
