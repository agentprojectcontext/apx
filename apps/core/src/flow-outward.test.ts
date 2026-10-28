import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import type { FlowGraph, FlowNode } from "../../../packages/protocol/src/flow-graph.ts";
import type { ChannelAdapter, OutFile } from "./channels/types.ts";
import type { Presentation } from "./domain/channels.ts";
import { say, scriptedLlm, startCore } from "./engine/testkit.ts";
import { FLOW_CALLS_PER_HOUR, FLOW_SENDS_PER_HOUR } from "./flow-outward-steps.ts";
import { tempDir, waitFor } from "./testkit/platform.ts";

type Env = Awaited<ReturnType<typeof startCore>>;
const hook = { kind: "webhook" as const, id: "start", label: "Webhook" };
const SECRET = "tok-ACME-7f3a91c2d4";

/** A chat app that keeps what it was asked to send; `hold` leaves sends hanging, as a platform that never answers. */
function recorder() {
  const sent: { conversation: string; text: string }[] = [];
  let hold = false;
  const adapter: ChannelAdapter = {
    caps: { typing: false, buttons: false },
    start: async () => ({ account: "@acme_bot" }),
    stop: async () => {},
    send: (conversation: string, p: Presentation, _files?: OutFile[]) => {
      sent.push({ conversation, text: p.text });
      return hold ? new Promise(() => {}) : Promise.resolve({ external_id: `m${sent.length}` });
    },
  };
  return {
    sent,
    adapter,
    hold: (on: boolean) => {
      hold = on;
    },
  };
}

/** A service on this computer that a test lets Flows reach; `reply` answers each request. */
async function service(reply: (req: http.IncomingMessage, res: http.ServerResponse) => void) {
  const seen: { method?: string; url?: string; headers: http.IncomingHttpHeaders; body: string }[] = [];
  const s = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => {
      body += c.toString("utf8");
    });
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      reply(req, res);
    });
  });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const port = (s.address() as AddressInfo).port;
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    seen,
    close: () =>
      new Promise<void>((r) => {
        s.closeAllConnections();
        s.close(() => r());
      }),
  };
}

async function setup(env: Env) {
  await env.client.call("channels.set", {
    id: "chat",
    channel: {
      type: "discord",
      agent_id: "roby",
      rooms: { rooms: [{ id: "900", name: "sales", mode: "read" }] },
    },
    token: "acme-bot-token",
  });
  await waitFor(
    async () => (await env.client.call("channels.list", {})).channels[0]?.status === "running",
    "the channel runs",
  );
  const alex = env.core.store.persons.create({ name: "Alex Acme", role: "contact" });
  env.core.store.persons.link(alex.id, { channel: "chat", external_id: "alex-1" });
  const mallory = env.core.store.persons.create({ name: "Mallory", role: "contact" });
  env.core.store.persons.link(mallory.id, { channel: "chat", external_id: "mallory-1" });
  return { alex: alex.id, mallory: mallory.id };
}

const notify = (id: string, to: Extract<FlowNode, { kind: "notify" }>["to"], text: string, onlyIfContent = false) => ({
  id,
  kind: "notify" as const,
  label: id,
  channel: "chat",
  to,
  text,
  onlyIfContent,
});
const chain = (...nodes: FlowNode[]): FlowGraph => ({
  schemaVersion: 2,
  nodes,
  edges: nodes.slice(1).map((n, i) => ({ source: nodes[i]?.id ?? "", target: n.id })),
  layout: [],
});

/** A Flow whose drawing is published with the outward list the owner was shown, turned on. */
async function publish(env: Env, id: string, graph: FlowGraph): Promise<string> {
  const project = (await env.client.call("projects.create", { name: `Project ${id}` })).project.id;
  await env.client.call("flows.set", {
    id,
    projectId: project,
    name: id,
    enabled: false,
    predicates: [],
    tableKey: "latest",
    action: { kind: "none" },
  });
  const draft = await env.client.call("flows.draft_save", { flow: id, expectedVersion: null, graph });
  const { keys } = await env.client.call("flows.outward", { flow: id, graph });
  await env.client.call("flows.publish", {
    flow: id,
    expectedDraftVersion: draft.draftVersion ?? 0,
    expectedPublishedRevision: null,
    outward: keys,
  });
  const flow = env.core.store.flows.get(id);
  assert.ok(flow);
  await env.client.call("flows.set", { ...flow, enabled: true });
  return id;
}
async function post(env: Env, flow: string, id: string, data: unknown) {
  const route = env.core.flows.routes(`/flows/${flow}`);
  assert.ok(route);
  return route.handle(
    {
      method: "POST",
      path: `/flows/${flow}`,
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify({ id, data })),
    },
    new AbortController().signal,
  );
}
const ended = (env: Env, flow: string, id: string) =>
  waitFor(
    () => env.core.store.flows.events(flow, 50).find((e) => e.event_id === id && e.state !== "pending"),
    `run ${id} to end`,
  );
const steps = (env: Env, flow: string, id: string) =>
  Object.fromEntries(env.core.store.flowGraphRuns.detail(flow, id)?.steps.map((s) => [s.node, s]) ?? []);

test("publishing a send needs the owner to have seen where it goes, and a destination must be the owner's own", async () => {
  const chat = recorder();
  const env = await startCore({
    llm: scriptedLlm(() => say("unused")),
    channelAdapters: { discord: () => chat.adapter },
  });
  try {
    const { alex } = await setup(env);
    const project = (await env.client.call("projects.create", { name: "Acme" })).project.id;
    await env.client.call("flows.set", {
      id: "tell",
      projectId: project,
      name: "Tell",
      enabled: false,
      predicates: [],
      tableKey: "latest",
      action: { kind: "none" },
    });
    const graph = chain(hook, notify("say", { kind: "contact", person: alex }, "New lead: $trigger.company"));
    const draft = await env.client.call("flows.draft_save", { flow: "tell", expectedVersion: null, graph });
    const outward = await env.client.call("flows.outward", { flow: "tell", graph });
    assert.deepEqual(outward.sends, [
      { node: "say", channel: "Discord", type: "discord", to: "Alex Acme", owner: false },
    ]);
    // A contact who calls themselves "you" is still not the owner.
    const you = env.core.store.persons.create({ name: "you", role: "contact" });
    env.core.store.persons.link(you.id, { channel: "chat", external_id: "you-1" });
    const named = await env.client.call("flows.outward", {
      flow: "tell",
      graph: chain(hook, notify("say", { kind: "contact", person: you.id }, "Hi")),
    });
    assert.equal(named.sends[0]?.owner, false);
    assert.deepEqual(outward.keys, [`send:chat:contact:${alex}`]);
    const base = { flow: "tell", expectedDraftVersion: draft.draftVersion ?? 0, expectedPublishedRevision: null };
    await assert.rejects(env.client.call("flows.publish", base), /Confirm where it sends/);
    await assert.rejects(env.client.call("flows.publish", { ...base, outward: ["send:chat:room:900"] }), /Confirm/);
    const doc = await env.client.call("flows.publish", { ...base, outward: outward.keys });
    assert.equal(doc.publishedRevision, 1);

    // Someone not among the owner's contacts, a room not listed, a channel not set up: none can be published.
    for (const to of [
      { kind: "contact" as const, person: "p_nobody" },
      { kind: "room" as const, room: "901" },
    ]) {
      const { issues } = await env.client.call("flows.validate", {
        flow: "tell",
        graph: chain(hook, notify("say", to, "Hi")),
      });
      assert.ok(
        issues.some((i) => i.code === "destination_unavailable"),
        JSON.stringify(to),
      );
    }
    const other = { ...notify("say", { kind: "contact", person: alex }, "Hi"), channel: "telegram" };
    const { issues } = await env.client.call("flows.validate", { flow: "tell", graph: chain(hook, other) });
    assert.ok(issues.some((i) => i.code === "destination_unavailable"));
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("the payload fills the words only: the send goes to the drawn contact whatever the event says", async () => {
  const chat = recorder();
  const env = await startCore({
    llm: scriptedLlm(() => say("unused")),
    channelAdapters: { discord: () => chat.adapter },
  });
  try {
    const { alex } = await setup(env);
    const flow = await publish(
      env,
      "leads",
      chain(hook, notify("say", { kind: "contact", person: alex }, "Lead: $trigger.company ($$ $trigger.size)")),
    );
    await post(env, flow, "e1", { company: "Northwind", size: 12, to: "Mallory", channel: "other", person: "mallory" });
    assert.equal((await ended(env, flow, "e1")).state, "succeeded");
    assert.deepEqual(chat.sent, [{ conversation: "alex-1", text: "Lead: Northwind ($ 12)" }]);
    const s = steps(env, flow, "e1");
    assert.equal(s.say?.state, "succeeded");
    assert.deepEqual(JSON.parse(s.say?.input ?? "null"), {
      channel: "Discord",
      to: "Alex Acme",
      text: "Lead: Northwind ($ 12)",
    });
    assert.equal(JSON.parse(s.say?.output ?? "null").delivery, "sent");
    // Alex's chat agent reads it as the owner's flow's note, never as words it said itself (they came from outside).
    const chatThread = env.core.store.threads.byConversation("chat", "alex-1");
    assert.ok(chatThread);
    const log = env.core.store.modelLog.list(chatThread.id).map((e) => e.item as { role: string; content: string });
    assert.equal(log.filter((m) => m.role === "assistant").length, 0);
    assert.match(log.at(-1)?.content ?? "", /^\[Your owner's flow "leads" sent this in this chat:\]\nLead: Northwind/);
    // What the payload brings can't become a link or a mention in the owner's name; the owner's own text can.
    await post(env, flow, "e2", { company: "[Pay here](https://evil.example) @mallory", size: 1 });
    assert.equal((await ended(env, flow, "e2")).state, "succeeded");
    assert.equal(chat.sent[1]?.text, "Lead: [Pay here] (https://evil.example) @\u200bmallory ($ 1)");
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("'only if there is something to tell' skips the send when every placeholder came out empty", async () => {
  const chat = recorder();
  const env = await startCore({
    llm: scriptedLlm(() => say("unused")),
    channelAdapters: { discord: () => chat.adapter },
  });
  try {
    await setup(env);
    const flow = await publish(
      env,
      "alerts",
      chain(hook, notify("say", { kind: "room", room: "900" }, "Low stock: $trigger.items", true)),
    );
    await post(env, flow, "none", { items: [] });
    await post(env, flow, "absent", { other: 1 });
    await post(env, flow, "some", { items: ["lamps"] });
    for (const id of ["none", "absent"]) {
      assert.equal((await ended(env, flow, id)).state, "succeeded");
      assert.equal(steps(env, flow, id).say?.state, "skipped");
      assert.equal(steps(env, flow, id).say?.error, "nothing_to_tell");
    }
    assert.equal((await ended(env, flow, "some")).state, "succeeded");
    assert.deepEqual(chat.sent, [{ conversation: "900", text: 'Low stock: ["lamps"]' }]);
    // Off, a field the event lacks is a step that can't run, not an empty message.
    const strict = await publish(
      env,
      "strict",
      chain(hook, notify("say", { kind: "room", room: "900" }, "$trigger.items")),
    );
    await post(env, strict, "absent", { other: 1 });
    assert.equal((await ended(env, strict, "absent")).state, "failed");
    assert.equal(steps(env, strict, "absent").say?.error, "missing_value");
    assert.equal(chat.sent.length, 1);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a Flow sends at most its hourly limit; the next one fails without going out", async () => {
  const chat = recorder();
  const env = await startCore({
    llm: scriptedLlm(() => say("unused")),
    channelAdapters: { discord: () => chat.adapter },
  });
  try {
    const { alex } = await setup(env);
    const flow = await publish(
      env,
      "busy",
      chain(hook, notify("say", { kind: "contact", person: alex }, "Ping $trigger.n")),
    );
    const now = new Date();
    for (let i = 0; i < FLOW_SENDS_PER_HOUR - 1; i++) env.core.store.flowSends.add(flow, "message", now);
    await post(env, flow, "last", { n: 1 });
    assert.equal((await ended(env, flow, "last")).state, "succeeded");
    await post(env, flow, "over", { n: 2 });
    assert.equal((await ended(env, flow, "over")).state, "failed");
    assert.equal(steps(env, flow, "over").say?.error, "rate_limited");
    assert.deepEqual(
      chat.sent.map((m) => m.text),
      ["Ping 1"],
    );
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a send that may have gone out is never sent again after a restart: it is left to look at", async () => {
  const home = tempDir();
  const chat = recorder();
  chat.hold(true);
  let env = await startCore({
    home: home.path,
    llm: scriptedLlm(() => say("unused")),
    channelAdapters: { discord: () => chat.adapter },
  });
  try {
    const { alex } = await setup(env);
    const flow = await publish(
      env,
      "unsure",
      chain(hook, notify("say", { kind: "contact", person: alex }, "Hello $trigger.name"), {
        id: "after",
        kind: "table_write",
        label: "After",
        key: "x",
        value: { kind: "event", path: [] },
      }),
    );
    await post(env, flow, "e", { name: "Alex" });
    await waitFor(() => chat.sent.length === 1, "the send to start");
    await env.core.close();
    chat.hold(false);
    env = await startCore({
      home: home.path,
      llm: scriptedLlm(() => say("unused")),
      channelAdapters: { discord: () => chat.adapter },
    });
    const run = await ended(env, flow, "e");
    assert.equal(run.state, "uncertain");
    const s = steps(env, flow, "e");
    assert.equal(s.say?.state, "uncertain");
    assert.equal(s.say?.error, "send_uncertain");
    assert.equal(s.after?.state, "blocked");
    assert.equal(chat.sent.length, 1, "sent once, never again");
  } finally {
    await env.core.close();
    await env.cleanup();
    await home.remove();
  }
});

test("an HTTP step fills its body from bindings, reads its secret in the core and never keeps it", async () => {
  const api = await service((req, res) => {
    res.writeHead(201, { "content-type": "application/json" });
    res.end(JSON.stringify({ enrolled: true, echo: req.headers.authorization }));
  });
  const chat = recorder();
  const env = await startCore({
    llm: scriptedLlm(() => say("unused")),
    channelAdapters: { discord: () => chat.adapter },
    flowHttpAllow: [`127.0.0.1:${api.port}`],
  });
  try {
    const { alex } = await setup(env);
    await env.client.call("secrets.set", { name: "acme_key", value: SECRET });
    const call: FlowNode = {
      id: "enroll",
      kind: "http",
      label: "Enroll",
      method: "POST",
      url: `${api.url}/v1/enroll`,
      headers: [
        { name: "Authorization", value: "Bearer secret://acme_key" },
        { name: "X-Lead", value: "$trigger.email" },
      ],
      body: '{ "email": "$trigger.email", "seats": "$trigger.seats", "note": "from $trigger.company" }',
      timeoutMs: 5000,
    };
    const flow = await publish(
      env,
      "enroll",
      chain(hook, call, notify("say", { kind: "contact", person: alex }, "Enrolled: $steps.enroll.json.enrolled")),
    );
    // A payload that names a secret gets its words sent as they are, never the secret's value.
    await post(env, flow, "e", { email: "lu@northwind.example", seats: 3, company: "secret://acme_key" });
    assert.equal((await ended(env, flow, "e")).state, "succeeded");
    assert.equal(api.seen.length, 1);
    const got = api.seen[0];
    assert.equal(got?.method, "POST");
    assert.equal(got?.headers.authorization, `Bearer ${SECRET}`);
    assert.equal(got?.headers["x-lead"], "lu@northwind.example");
    assert.equal(got?.headers["content-type"], "application/json");
    assert.deepEqual(JSON.parse(got?.body ?? "null"), {
      email: "lu@northwind.example",
      seats: 3,
      note: "from secret://acme_key",
    });
    const s = steps(env, flow, "e");
    assert.equal(s.enroll?.state, "succeeded");
    assert.deepEqual(JSON.parse(s.enroll?.output ?? "null").json, { enrolled: true, echo: "Bearer [secret]" });
    assert.equal(JSON.parse(s.enroll?.output ?? "null").status, 201);
    const recorded = JSON.stringify(env.core.store.flowGraphRuns.detail(flow, "e"));
    assert.equal(recorded.includes(SECRET), false, "the secret is in no step record");
    assert.ok(recorded.includes("secret://acme_key"), "the reference is what the record shows");
    assert.deepEqual(
      chat.sent.map((m) => m.text),
      ["Enrolled: true"],
    );
  } finally {
    await env.core.close();
    await env.cleanup();
    await api.close();
  }
});

test("HTTP steps refuse what the owner must fix: a key typed in, a secret not there, an address inside", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("unused")) });
  try {
    const project = (await env.client.call("projects.create", { name: "Acme" })).project.id;
    const base = {
      id: "call",
      kind: "http" as const,
      label: "Call",
      method: "POST" as const,
      url: "https://api.example.com/v1",
      headers: [] as { name: string; value: string }[],
      body: "",
      timeoutMs: 5000,
    };
    const codes = async (node: FlowNode) =>
      (await env.client.call("flows.validate", { project, graph: chain(hook, node) })).issues.map((i) => i.code);
    assert.deepEqual(await codes(base), []);
    assert.ok(
      (await codes({ ...base, headers: [{ name: "Authorization", value: "Bearer abcdefghijklmnop" }] })).includes(
        "credential_literal",
      ),
    );
    assert.ok(
      (await codes({ ...base, headers: [{ name: "X-Api-Key", value: "$trigger.key" }] })).includes(
        "credential_literal",
      ),
    );
    assert.ok(
      (await codes({ ...base, headers: [{ name: "Authorization", value: "Bearer secret://missing" }] })).includes(
        "secret_missing",
      ),
    );
    assert.ok((await codes({ ...base, url: "http://169.254.169.254/latest" })).includes("url_private"));
    assert.ok((await codes({ ...base, url: "https://api.example.com/?k=secret://x" })).includes("url_secret"));
    assert.ok((await codes({ ...base, body: '{"k":"secret://x"}' })).includes("body_secret"));
    assert.ok((await codes({ ...base, headers: [{ name: "Host", value: "inside" }] })).includes("header_refused"));
    assert.ok((await codes({ ...base, body: "$steps.later.text" })).includes("binding_ancestor"));
    assert.ok((await codes({ ...base, method: "GET", body: "x" })).includes("get_body"));
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("a non-GET request cut before an answer is left to look at; a GET tries once more, then fails", async () => {
  const cut = await service((req) => req.socket.destroy());
  const env = await startCore({ llm: scriptedLlm(() => say("unused")), flowHttpAllow: [`127.0.0.1:${cut.port}`] });
  try {
    const call = (method: "GET" | "PUT"): FlowNode => ({
      id: "call",
      kind: "http",
      label: "Call",
      method,
      url: `${cut.url}/x`,
      headers: [],
      body: "",
      timeoutMs: 5000,
    });
    const put = await publish(env, "put", chain(hook, call("PUT")));
    await post(env, put, "e", { a: 1 });
    assert.equal((await ended(env, put, "e")).state, "uncertain");
    assert.equal(steps(env, put, "e").call?.error, "request_uncertain");
    assert.equal(cut.seen.length, 1, "never sent twice");
    const get = await publish(env, "get", chain(hook, call("GET")));
    await post(env, get, "e", { a: 1 });
    assert.equal((await ended(env, get, "e")).state, "failed");
    assert.equal(steps(env, get, "e").call?.error, "request_failed");
    assert.equal(cut.seen.length, 3, "the GET went twice");
    // An address on this computer the test did not let through can't be published.
    await assert.rejects(
      publish(env, "inside", chain(hook, { ...call("GET"), url: "http://127.0.0.1:9/x" } as FlowNode)),
      /this computer or a private network/,
    );
  } finally {
    await env.core.close();
    await env.cleanup();
    await cut.close();
  }
});

test("a schedule whose last run is still going skips its time and says so, instead of queueing it", async () => {
  const hang = await service(() => {});
  let now = new Date("2026-11-02T10:00:30Z");
  const env = await startCore({
    llm: scriptedLlm(() => say("unused")),
    flowHttpAllow: [`127.0.0.1:${hang.port}`],
    clock: () => now,
  });
  try {
    const flow = await publish(
      env,
      "slow",
      chain(
        { id: "tick", kind: "schedule", label: "Every 5 minutes", cron: "*/5 * * * *" },
        {
          id: "call",
          kind: "http",
          label: "Call",
          method: "GET",
          url: `${hang.url}/slow`,
          headers: [],
          body: "",
          timeoutMs: 30_000,
        },
      ),
    );
    env.core.flows.tick(now);
    now = new Date("2026-11-02T10:05:10Z");
    env.core.flows.tick(now);
    await waitFor(() => hang.seen.length === 1, "the first run's request");
    now = new Date("2026-11-02T10:10:10Z");
    env.core.flows.tick(now);
    now = new Date("2026-11-02T10:15:10Z");
    env.core.flows.tick(now);
    const events = env.core.store.flows.events(flow, 50).filter((e) => e.source === "schedule");
    assert.equal(events.length, 1, "one run, nothing queued behind it");
    const list = await env.client.call("flows.list", {});
    assert.equal(list.schedules[flow]?.skipped, 2);
    assert.equal(list.schedules[flow]?.skipped_at, "2026-11-02T10:15:10.000Z");
  } finally {
    await env.core.close();
    await env.cleanup();
    await hang.close();
  }
});

test("a message to a channel that isn't running is taken back at once, never sent later", async () => {
  let starts = 0;
  const sent: string[] = [];
  const down: ChannelAdapter = {
    caps: { typing: false, buttons: false },
    start: async () => {
      starts++;
      throw new Error("the chat app is down");
    },
    stop: async () => {},
    send: async (_c: string, p: Presentation) => {
      sent.push(p.text);
      return {};
    },
  };
  const env = await startCore({ llm: scriptedLlm(() => say("unused")), channelAdapters: { discord: () => down } });
  try {
    await env.client.call("channels.set", {
      id: "chat",
      channel: { type: "discord", agent_id: "roby" },
      token: "acme-bot-token",
    });
    await waitFor(() => starts > 0, "the channel tried to start");
    const alex = env.core.store.persons.create({ name: "Alex Acme", role: "contact" });
    env.core.store.persons.link(alex.id, { channel: "chat", external_id: "alex-1" });
    const flow = await publish(
      env,
      "down",
      chain(hook, notify("say", { kind: "contact", person: alex.id }, "Hi $trigger.n")),
    );
    await post(env, flow, "e", { n: 1 });
    assert.equal((await ended(env, flow, "e")).state, "failed");
    assert.equal(steps(env, flow, "e").say?.error, "channel_unavailable");
    const item = env.core.store.channels.outbox.recent(5)[0];
    assert.equal(item?.state, "failed");
    assert.deepEqual(sent, []);
  } finally {
    await env.core.close();
    await env.cleanup();
  }
});

test("calls that may change something have an hourly limit; consent names the secrets each address gets", async () => {
  const api = await service((_req, res) => res.end("{}"));
  const env = await startCore({ llm: scriptedLlm(() => say("unused")), flowHttpAllow: [`127.0.0.1:${api.port}`] });
  try {
    await env.client.call("secrets.set", { name: "acme_key", value: SECRET });
    const graph = chain(hook, {
      id: "call",
      kind: "http",
      label: "Call",
      method: "POST",
      url: `${api.url}/x`,
      headers: [{ name: "Authorization", value: "Bearer secret://acme_key" }],
      body: "",
      timeoutMs: 5000,
    });
    const flow = await publish(env, "calls", graph);
    const { keys, calls } = await env.client.call("flows.outward", { flow, graph });
    assert.deepEqual(keys, [`call:POST:${api.url}/x`, `secret:acme_key:${api.url}/x`]);
    assert.deepEqual(calls[0]?.secrets, ["acme_key"]);
    const now = new Date();
    for (let i = 0; i < FLOW_CALLS_PER_HOUR; i++) env.core.store.flowSends.add(flow, "request", now);
    await post(env, flow, "over", { a: 1 });
    assert.equal((await ended(env, flow, "over")).state, "failed");
    assert.equal(steps(env, flow, "over").call?.error, "rate_limited");
    assert.equal(api.seen.length, 0);
    // A body said to be JSON must be JSON: values are never pasted into JSON text.
    const project = env.core.store.flows.get(flow)?.projectId ?? "";
    const { issues } = await env.client.call("flows.validate", {
      project,
      graph: chain(hook, {
        id: "call",
        kind: "http",
        label: "Call",
        method: "POST",
        url: "https://api.example.com/x",
        headers: [{ name: "Content-Type", value: "application/json" }],
        body: '{"n": $trigger.n}',
        timeoutMs: 5000,
      }),
    });
    assert.ok(issues.some((i) => i.code === "body_not_json"));
  } finally {
    await env.core.close();
    await env.cleanup();
    await api.close();
  }
});
