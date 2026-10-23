import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { methodAccess, methods } from "@apx/protocol";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { saveUpload } from "../services/uploads.ts";
import { SETTINGS } from "./settings.ts";
import { BY_TOOL, NOT_YET, OWNER_ONLY } from "./settings-reach.ts";

let northwind = "";
let sticker = "";

// Each owner message names the tool call the scripted model makes; the tool's result comes back as the answer.
const CALLS: Record<string, () => object> = {
  "what can you change?": () => ({}),
  "show my contacts": () => ({ method: "contacts.list" }),
  "how do I change a contact?": () => ({ method: "contacts.set" }),
  "tell her who she is": () => ({
    method: "contacts.set",
    params: { id: northwind, note: "My sister", rules: "Answer warmly, in Spanish." },
  }),
  "make her a friend": () => ({ method: "contacts.set", params: { id: northwind, relation: "best-friend-ever" } }),
  "change my keys": () => ({ method: "secrets.set", params: { name: "x", value: "y" } }),
  "show my whatsapp stickers": () => ({ method: "stickers.list", params: { platform: "whatsapp" } }),
  "that sticker is mate": () => ({ method: "stickers.set", params: { id: sticker, meaning: "mate shared, all good" } }),
};
const llm = scriptedLlm((req, { said, afterTool }) => {
  if (afterTool) return say(String(req.messages.at(-1)?.content));
  const call = CALLS[said];
  return call ? callTool("c1", "apx_settings", call()) : say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  env = await startCore({ llm });
  northwind = (await env.client.call("contacts.set", { name: "Northwind Sister" })).id;
  await env.client.call("agents.create", { slug: "acme-writer", name: "Acme Writer", prompt: "Write." });
  const webp = Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "base64");
  const media = saveUpload(env.home, env.core.store, { name: "sticker.webp", mime: "image/webp", bytes: webp });
  sticker = env.core.store.stickers.add({ platform: "whatsapp", hash: "h1", media_id: media.id, hint: "🧉" }).id;
});
after(async () => {
  await env.core.close();
  env.cleanup();
});

/** The owner asks; `decision` answers the confirmation the call waits on, and returns what the card said. */
async function ask(text: string, agent = "roby", decision?: "approve" | "deny") {
  const thread = await env.client.call("threads.create", { kind: "loose", agent_id: agent, title: "Settings" });
  await env.client.call("threads.send", { thread: thread.id, text });
  let detail: string | undefined;
  if (decision) {
    let pending: Array<{ id: string; tool?: string | undefined; detail?: string | undefined }> = [];
    for (let i = 0; i < 100 && !pending.length; i++) {
      pending = (await env.client.call("runs.pending", { thread: thread.id })).inputs;
      if (!pending.length) await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(pending[0]?.tool, "apx_settings");
    detail = pending[0]?.detail;
    await env.client.call("runs.respond", { input: pending[0]?.id ?? "", decision });
  }
  await env.settle(thread.id);
  return { answer: String(llm.calls.at(-1)?.messages.at(-1)?.content), detail };
}

const sister = async () => (await env.client.call("contacts.list", {})).persons.find((p) => p.id === northwind);

test("only the super-agent is offered apx_settings", async () => {
  const offered = async (agent: string) => {
    await ask("hello", agent);
    return llm.calls.at(-1)?.tools.map((t) => t.function.name) ?? [];
  };
  assert.ok((await offered("roby")).includes("apx_settings"));
  assert.ok(!(await offered("acme-writer")).includes("apx_settings"));
});

test("reading what it can change, the contacts and a method's fields asks nobody", async () => {
  assert.match((await ask("what can you change?")).answer, /- contacts\.set: /);
  assert.match((await ask("show my contacts")).answer, new RegExp(`Northwind Sister \\[${northwind}\\]`));
  assert.match((await ask("how do I change a contact?")).answer, /contacts\.set takes: .*"rules"/);
});

test("the owner approves who a contact is and how to answer them, read before and after", async () => {
  const { answer, detail } = await ask("tell her who she is", "roby", "approve");
  assert.match(detail ?? "", /^Change the contact Northwind Sister/);
  assert.match(detail ?? "", /note: \(none\) → "My sister"/);
  assert.match(detail ?? "", /rules: \(none\) → "Answer warmly, in Spanish\."/);
  assert.doesNotMatch(detail ?? "", /name:/);
  assert.match(answer, /^done: - Northwind Sister/);
  const p = await sister();
  assert.equal(p?.note, "My sister");
  assert.equal(p?.rules, "Answer warmly, in Spanish.");
  assert.equal(p?.name, "Northwind Sister");
});

test("the owner approves what a sticker means; the agent reads its stickers first", async () => {
  assert.match((await ask("show my whatsapp stickers")).answer, new RegExp(`\\[${sticker}\\] not named yet 🧉`));
  const { answer, detail } = await ask("that sticker is mate", "roby", "approve");
  assert.match(detail ?? "", /^Change the sticker/);
  assert.match(detail ?? "", /meaning: .* → "mate shared, all good"/);
  assert.match(answer, /"mate shared, all good"/);
  assert.equal(env.core.store.stickers.get(sticker)?.meaning, "mate shared, all good");
});

test("a declined change saves nothing", async () => {
  await env.client.call("contacts.set", { id: northwind, name: "Northwind Sister", note: "", rules: "" });
  await ask("tell her who she is", "roby", "deny");
  const p = await sister();
  assert.ok(!p?.rules && !p?.note);
});

test("a change the method would refuse, or a method out of reach, never reaches the owner", async () => {
  assert.match((await ask("make her a friend")).answer, /contacts\.set: relation: /);
  assert.match((await ask("change my keys")).answer, /no setting "secrets\.set"/);
});

test("every owner method that changes something is placed: apx_settings, a tool of its own, the owner's, or not yet", () => {
  const placed = [Object.keys(SETTINGS), Object.keys(BY_TOOL), Object.keys(OWNER_ONLY), [...NOT_YET]];
  const owner = Object.keys(methods).filter(
    (m) => methodAccess(m as keyof typeof methods) === "human" && methods[m as keyof typeof methods].effect,
  );
  const missing = owner.filter((m) => !placed.some((list) => list.includes(m)));
  assert.deepEqual(missing, [], "place each new owner method in tools/settings.ts or tools/settings-reach.ts");
  const twice = owner.filter((m) => placed.filter((list) => list.includes(m)).length > 1);
  assert.deepEqual(twice, []);
  const stale = placed.flat().filter((m) => !(m in methods));
  assert.deepEqual(stale, []);
});
