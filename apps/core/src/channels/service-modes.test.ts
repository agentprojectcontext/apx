import assert from "node:assert/strict";
import path from "node:path";
import { after, before, test } from "node:test";
import { z } from "zod";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";
import { defineTool } from "../tools/types.ts";
import { fakeWhatsApp } from "./fake-whatsapp.test-support.ts";
import { whatsappAdapter } from "./whatsapp.ts";

const customer = { phone: "5491100000002@s.whatsapp.net", name: "Customer" };
const calls: Array<{ text: string; project?: string }> = [];
let holdReview: (() => Promise<void>) | undefined;
let reviewOutput: string | undefined;
const llm = scriptedLlm(async (req, { system, said, afterTool }) => {
  if (system.includes("Review one proposed customer-service operation")) {
    await holdReview?.();
    return say(reviewOutput ?? JSON.stringify({ approve: !said.includes("decline"), reason: "Service policy" }));
  }
  if (afterTool) return say(`Service result: ${String(req.messages.at(-1)?.content).slice(0, 1000)}`);
  if (said.includes("use MCP"))
    return callTool("service", "mcp_call", { tool: "mcp_service_echo", args: { text: "catalog" } });
  if (said.includes("change settings")) return callTool("settings", "service_settings", {});
  if (said.includes("service request"))
    return callTool("service", "service_lookup", { text: said.includes("decline") ? "decline" : "catalog" });
  return say("Welcome");
});
const lookup = defineTool({
  name: "service_lookup",
  description: "Read the customer catalog",
  args: z.object({ text: z.string() }),
  effect: "none",
  confirm: "never",
  deadlineMs: 10_000,
  title: () => "Read catalog",
  run: async (args, ctx) => {
    calls.push({ text: args.text, project: ctx.thread.project_id });
    return `Catalog: ${args.text}`;
  },
});
const settings = defineTool({
  name: "service_settings",
  description: "Change owner settings",
  args: z.object({}),
  effect: "local",
  confirm: "always",
  ownerSetting: () => true,
  deadlineMs: 10_000,
  title: () => "Change settings",
  run: async () => {
    throw new Error("must not execute");
  },
});
let env: Awaited<ReturnType<typeof startCore>>;
let wa: ReturnType<typeof fakeWhatsApp>;
let agent = "";
let project = "";
let thread = "";
const otherAccount = fakeWhatsApp();

async function mode(service_mode: "base" | "review" | "full") {
  return env.client.call("channels.set", {
    id: "service",
    channel: {
      type: "whatsapp",
      agent_id: agent,
      strangers: "answer",
      service_mode,
    },
  });
}

async function request(text: string) {
  const previous = env.core.store.runs.list(thread).length;
  wa.message(customer, text);
  await waitFor(() => env.core.store.runs.list(thread).length > previous, "customer turn admitted");
  return env.settle(thread, 15_000);
}

before(async () => {
  wa = fakeWhatsApp();
  env = await startCore({
    llm,
    extraTools: [lookup, settings],
    channelAdapters: {
      whatsapp: (config) =>
        whatsappAdapter({
          dir: path.join(env.home, config.id),
          selfOwner: config.self_owner === true,
          lib: async () => (config.id === "service" ? wa.lib : otherAccount.lib),
        }),
    },
  });
  project = (await env.client.call("projects.create", { name: "Service project" })).project.id;
  agent = (
    await env.client.call("agents.create", {
      project_id: project,
      slug: "service-helper",
      name: "Service helper",
      role: "Customer service",
      prompt: "Use the catalog service when a customer asks for a catalog.",
    })
  ).id;
  await env.client.call("agents.update", { agent, autonomy: "total" });
  await env.client.call("mcp.set", {
    name: "service",
    server: {
      command: process.execPath,
      args: [path.join(import.meta.dirname, "../mcp/fake-server.test-support.mjs")],
    },
  });
  await mode("base");
  await waitFor(async () => Boolean((await env.client.call("channels.list", {})).channels[0]?.qr), "QR");
  wa.scan();
  await waitFor(
    async () => (await env.client.call("channels.list", {})).channels[0]?.status === "running",
    "connected",
  );
  wa.message(customer, "hello");
  await waitFor(() => Boolean(env.core.store.threads.byConversation("service", customer.phone)), "customer chat");
  thread = env.core.store.threads.byConversation("service", customer.phone)?.id ?? "";
  await env.settle(thread);
});

after(async () => {
  await env.core.close();
  await env.cleanup();
});

test("base attention preserves the sealed contact and does not execute a known tool name", async () => {
  const before = calls.length;
  await request("service request");
  assert.equal(calls.length, before);
  assert.deepEqual(
    llm.calls.at(-1)?.tools.map((tool) => tool.function.name),
    [],
  );
});

test("full access runs the assigned project's tool while keeping customer identity", async () => {
  await mode("full");
  const before = calls.length;
  await request("service request");
  assert.equal(calls.length, before + 1);
  assert.equal(calls.at(-1)?.project, project);
  const person = env.core.store.persons.get(env.core.store.threads.get(thread)?.channel?.person_id ?? "");
  assert.equal(person?.role, "contact");
  assert.match(String(llm.calls.at(-1)?.messages[0]?.content), /Use the catalog service/);
  assert.match(String(llm.calls.at(-1)?.messages[0]?.content), /not your owner/);
});

test("full access discovers and invokes an enabled MCP from a customer WhatsApp turn", async () => {
  await request("use MCP");
  const seen = llm.calls.at(-1);
  assert.ok(seen?.tools.some((tool) => tool.function.name === "mcp_search"));
  assert.match(String(seen?.messages.at(-1)?.content), /echo: catalog/);
});

test("full access cannot perform an owner-setting operation for a customer", async () => {
  await request("change settings");
  assert.match(String(llm.calls.at(-1)?.messages.at(-1)?.content), /only when they ask you themselves/);
  assert.equal(env.core.store.inputs.pending(thread).length, 0);
});

test("review mode approves only the bound operation and records the decision", async () => {
  await mode("review");
  const before = calls.length;
  await request("service request");
  assert.equal(calls.length, before + 1);
  const reviews = env.core.store.threads
    .descendants(thread, true)
    .filter((t) => env.core.store.threads.context(t.id).service_review);
  assert.equal(reviews.length, 1);
  const review = reviews[0];
  assert.ok(review);
  const context = env.core.store.threads.context(review.id).service_review;
  assert.equal(context?.tool, "service_lookup");
  assert.deepEqual(context?.decision, { approve: true, reason: "Service policy" });
  const reviewCall = llm.calls.find((call) => String(call.messages[0]?.content).includes("Review one proposed"));
  assert.deepEqual(
    reviewCall?.tools.map((tool) => tool.function.name),
    ["ask_owner"],
  );
});

test("a declined review executes nothing and does not approve the next request", async () => {
  const before = calls.length;
  const runsBefore = env.core.store.runs.list(thread).length;
  await request("service request decline");
  assert.equal(calls.length, before);
  assert.equal(
    env.core.store.runs.list(thread).length,
    runsBefore + 1,
    "review decisions do not create customer turns",
  );
  assert.match(String(llm.calls.at(-1)?.messages.at(-1)?.content), /super-agent declined/);
  await request("service request");
  assert.equal(calls.length, before + 1);
});

test("malformed review output fails closed", async () => {
  reviewOutput = "Please go ahead";
  const before = calls.length;
  try {
    await request("service request");
    assert.equal(calls.length, before);
    assert.match(String(llm.calls.at(-1)?.messages.at(-1)?.content), /valid decision/);
  } finally {
    reviewOutput = undefined;
  }
});

test("revoking channel access while a review waits prevents the operation", async () => {
  let release = () => {};
  let began = () => {};
  const entered = new Promise<void>((resolve) => {
    began = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  holdReview = async () => {
    began();
    await held;
  };
  const before = calls.length;
  try {
    const pending = request("service request");
    await entered;
    await mode("base");
    release();
    await pending;
    assert.equal(calls.length, before);
    assert.match(String(llm.calls.at(-1)?.messages.at(-1)?.content), /permissions changed/);
  } finally {
    release();
    holdReview = undefined;
  }
});

test("saving other channel settings preserves its service mode", async () => {
  await mode("full");
  const saved = await env.client.call("channels.set", {
    id: "service",
    channel: { type: "whatsapp", agent_id: agent },
  });
  assert.equal(saved.channels[0]?.service_mode, "full");
});

test("full access respects the agent's tool list, including late MCP calls by known name", async () => {
  await env.client.call("agents.update", { agent, tools: ["service_lookup"] });
  try {
    await request("use MCP");
    const seen = llm.calls.at(-1);
    assert.ok(!seen?.tools.some((tool) => tool.function.name === "mcp_call"));
    assert.match(String(seen?.messages.at(-1)?.content), /unknown tool mcp_service_echo/);
  } finally {
    await env.client.call("agents.update", { agent, tools: [] });
  }
});

test("another account keeps base attention for the same customer and agent", async () => {
  await env.client.call("channels.set", {
    id: "other",
    channel: {
      type: "whatsapp",
      agent_id: agent,
      strangers: "answer",
    },
  });
  await waitFor(
    async () => (await env.client.call("channels.list", {})).channels.some((c) => c.id === "other" && c.qr),
    "other QR",
  );
  otherAccount.scan();
  await waitFor(
    async () =>
      (await env.client.call("channels.list", {})).channels.some((c) => c.id === "other" && c.status === "running"),
    "other connected",
  );
  const before = calls.length;
  otherAccount.message(customer, "service request");
  await waitFor(() => Boolean(env.core.store.threads.byConversation("other", customer.phone)), "other chat");
  const otherThread = env.core.store.threads.byConversation("other", customer.phone);
  assert.ok(otherThread);
  await env.settle(otherThread.id);
  assert.equal(calls.length, before);
  assert.notEqual(otherThread.id, thread);
  assert.deepEqual(
    llm.calls.at(-1)?.tools.map((tool) => tool.function.name),
    [],
  );
  assert.equal(
    (await env.client.call("channels.list", {})).channels.find((c) => c.id === "service")?.service_mode,
    "full",
  );
});

test("base attention also revokes tools in an existing delegated customer chat", async () => {
  const child = env.core.store.threads.create({
    kind: "a2a",
    title: "Service work",
    parent_id: thread,
    agent_ids: [agent],
    project_id: project,
  });
  await mode("base");
  await env.client.call("threads.send", { thread: child.id, text: "use MCP" });
  await env.settle(child.id);
  assert.deepEqual(
    llm.calls.at(-1)?.tools.map((tool) => tool.function.name),
    [],
  );
  assert.match(String(llm.calls.at(-1)?.messages[0]?.content), /NOT your owner/);
  assert.match(String(llm.calls.at(-1)?.messages.at(-1)?.content), /unknown tool mcp_service_echo/);
});

test("blocking a customer during review revokes the pending operation", async () => {
  await mode("review");
  const person = env.core.store.persons.get(env.core.store.threads.get(thread)?.channel?.person_id ?? "");
  assert.ok(person);
  let release = () => {};
  let began = () => {};
  const entered = new Promise<void>((resolve) => {
    began = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  holdReview = async () => {
    began();
    await held;
  };
  const before = calls.length;
  try {
    const pending = request("service request");
    await entered;
    await env.client.call("contacts.set", { id: person.id, name: person.name, role: "blocked" });
    release();
    await pending;
    assert.equal(calls.length, before);
    assert.match(String(llm.calls.at(-1)?.messages.at(-1)?.content), /permissions changed/);
  } finally {
    release();
    holdReview = undefined;
    await env.client.call("contacts.set", { id: person.id, name: person.name, role: "contact" });
  }
});

test("full access allows the owner's MCP on WhatsApp without handoff-only instructions", async () => {
  await env.client.call("channels.set", {
    id: "service",
    channel: {
      type: "whatsapp",
      agent_id: agent,
      service_mode: "full",
      self_owner: true,
    },
  });
  await waitFor(
    async () =>
      (await env.client.call("channels.list", {})).channels.find((c) => c.id === "service")?.status === "running",
    "owner account ready",
  );
  wa.fromOwner("use MCP");
  await waitFor(() => Boolean(env.core.store.threads.byConversation("service", wa.owner)), "owner account chat");
  const own = env.core.store.threads.byConversation("service", wa.owner);
  assert.ok(own);
  await env.settle(own.id);
  const seen = llm.calls.at(-1);
  assert.ok(seen?.tools.some((tool) => tool.function.name === "mcp_search"));
  assert.match(String(seen?.messages.at(-1)?.content), /echo: catalog/);
  assert.doesNotMatch(String(seen?.messages[0]?.content), /Here you keep notes.*hand the rest off/);
});
