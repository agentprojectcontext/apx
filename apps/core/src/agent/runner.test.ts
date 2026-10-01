import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { CoreEvent, Message } from "@apx/protocol";
import { ApxClient } from "@apx/protocol/client";
import { createCore } from "../server.ts";
import type { ChatMessage, Completion, Llm } from "./provider.ts";

// Scripted model: decides by the agent named in the system prompt and by how far the turn got.
const calls: ChatMessage[][] = [];
const fakeLlm: Llm = {
  label: "fake",
  async complete(messages) {
    calls.push(messages);
    const system = String(messages[0]?.content ?? "");
    const last = messages.at(-1);
    const user = [...messages].reverse().find((m) => m.role === "user");
    const said = String(user?.content ?? "");
    const reply = (m: Completion["message"]): Completion => ({ message: m, model: "fake-1" });
    if (system.startsWith("Sos Scout")) return reply({ role: "assistant", content: "Encontré 3 fuentes sobre A2A." });
    if (said.includes("widget") && last?.role !== "tool") {
      return reply({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "c1",
            type: "function",
            function: {
              name: "show_widget",
              arguments: JSON.stringify({ name: "ventas-mes", title: "Ventas", html: "<b>42</b>", pin: true }),
            },
          },
        ],
      });
    }
    if (said.includes("investigá") && last?.role !== "tool") {
      return reply({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "c2",
            type: "function",
            function: { name: "ask_agent", arguments: JSON.stringify({ agent: "scout", task: "buscá info de A2A" }) },
          },
        ],
      });
    }
    if (said.includes("lento")) {
      await new Promise((r) => setTimeout(r, 400));
    }
    return reply({
      role: "assistant",
      content: last?.role === "tool" ? `Hecho: ${String(last.content).slice(0, 40)}` : "Hola, soy Roby.",
    });
  },
};

let core: Awaited<ReturnType<typeof createCore>>;
let client: ApxClient;
const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx2-runner-"));
const events: CoreEvent[] = [];

before(async () => {
  core = await createCore({ host: "127.0.0.1", port: 0, home, token: undefined }, { quiet: true, llm: fakeLlm });
  core.bus.on((e) => events.push(e));
  client = new ApxClient({ url: core.url });
});
after(async () => {
  await core.close();
  fs.rmSync(home, { recursive: true, force: true });
});

async function waitIdle(thread: string, ms = 3000): Promise<Message[]> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const t = await client.call("threads.get", { thread });
    if (["idle", "failed", "canceled"].includes(t.thread.state) && t.runs.every((r) => r.ended_at)) return t.messages;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error("thread never settled");
}

test("first run seeds a secretary and the Home thread", async () => {
  const { agents } = await client.call("agents.list", {});
  assert.ok(agents.some((a) => a.kind === "secretary"));
  const { threads } = await client.call("threads.list", {});
  assert.ok(threads.some((t) => t.id === "home" && t.kind === "home"));
});

test("a message runs a turn whose answer lands in the thread, with the model recorded", async () => {
  await client.call("threads.send", { thread: "home", text: "hola" });
  const msgs = await waitIdle("home");
  const answer = msgs.at(-1);
  assert.deepEqual(answer?.author, { kind: "agent", id: "roby" });
  assert.equal(answer?.model, "fake-1");
  assert.deepEqual(answer?.parts, [{ type: "text", text: "Hola, soy Roby." }]);
  assert.ok(events.some((e) => e.type === "message.created"));
});

test("show_widget creates a pinned surface and a surface card in the message", async () => {
  await client.call("threads.send", { thread: "home", text: "armame un widget" });
  const msgs = await waitIdle("home");
  const parts = msgs.at(-1)?.parts ?? [];
  assert.ok(parts.some((p) => p.type === "tool" && p.tool === "show_widget" && p.status === "ok"));
  const card = parts.find((p) => p.type === "surface");
  assert.ok(card && card.type === "surface");
  const surface = await client.call("surfaces.get", { surface: card.surface_id });
  assert.equal(surface.html, "<b>42</b>");
  assert.equal(surface.pinned, true);
});

test("ask_agent runs the other agent in a sub-thread and shows a sub-thread card", async () => {
  await client.call("threads.send", { thread: "home", text: "investigá A2A" });
  const msgs = await waitIdle("home", 5000);
  const card = msgs.at(-1)?.parts.find((p) => p.type === "subthread");
  assert.ok(card && card.type === "subthread");
  assert.equal(card.state, "completed");
  assert.match(card.summary ?? "", /3 fuentes/);
  const sub = await client.call("threads.get", { thread: card.thread_id });
  assert.equal(sub.thread.kind, "a2a");
  assert.equal(sub.thread.parent_id, "home");
  // Sub-threads stay out of the top-level list.
  const top = await client.call("threads.list", {});
  assert.ok(!top.threads.some((t) => t.id === card.thread_id));
  // The other agent's reply reached the caller framed as untrusted.
  const sawFramed = calls.some((m) =>
    m.some((x) => x.role === "tool" && String(x.content).includes('trust="untrusted"')),
  );
  assert.ok(sawFramed);
});

test("a retried send with the same idempotency key does not post twice", async () => {
  const before_ = (await client.call("threads.get", { thread: "home" })).messages.length;
  const a = await client.call("threads.send", { thread: "home", text: "una vez" }, "idem-1");
  const b = await client.call("threads.send", { thread: "home", text: "una vez" }, "idem-1");
  assert.equal(a.message.id, b.message.id);
  const msgs = await waitIdle("home");
  assert.equal(msgs.length, before_ + 2); // one user message + one answer
});

test("cancel ends a running turn in the canceled state", async () => {
  const t = await client.call("threads.create", { kind: "loose", agent_id: "roby", title: "prueba" });
  await client.call("threads.send", { thread: t.id, text: "algo lento" });
  await new Promise((r) => setTimeout(r, 100));
  const { canceled } = await client.call("threads.cancel", { thread: t.id });
  assert.equal(canceled, 1);
  await waitIdle(t.id);
  const got = await client.call("threads.get", { thread: t.id });
  assert.equal(got.runs[0]?.state, "canceled");
});

test("a shared surface is served at /a/<token> isolated from the API, and revoking removes it", async () => {
  const { surfaces } = await client.call("surfaces.list", {});
  const first = surfaces[0];
  assert.ok(first);
  const shared = await client.call("surfaces.share", { surface: first.id, shared: true });
  assert.match(shared.share_path ?? "", /^\/a\/[a-f0-9]{32}$/);
  const res = await fetch(`${core.url}${shared.share_path}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-security-policy") ?? "", /^sandbox allow-scripts/);
  assert.match(await res.text(), /<b>42<\/b>/);
  const revoked = await client.call("surfaces.share", { surface: first.id, shared: false });
  assert.equal(revoked.share_path, undefined);
  assert.equal((await fetch(`${core.url}${shared.share_path}`)).status, 404);
});
