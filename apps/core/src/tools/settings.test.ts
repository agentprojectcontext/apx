import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { methodAccess, methods } from "@apx/protocol";
import { SPANISH_TITLES } from "../engine/tool-titles.ts";
import { settingsCore } from "./settings.test-support.ts";
import { SETTINGS } from "./settings.ts";
import { BY_TOOL, NOT_YET, OWNER_ONLY } from "./settings-reach.ts";

let northwind = "";
let h: Awaited<ReturnType<typeof settingsCore>>;
before(async () => {
  h = await settingsCore();
  northwind = (await h.env.client.call("contacts.set", { name: "Northwind Sister" })).id;
  await h.env.client.call("agents.create", { slug: "acme-writer", name: "Acme Writer", prompt: "Write." });
});
after(async () => {
  await h.env.core.close();
  await h.env.cleanup();
});

const tellHer = () => ({
  method: "contacts.set",
  params: { id: northwind, note: "My sister", rules: "Answer warmly, in Spanish." },
});
const sister = async () => (await h.env.client.call("contacts.list", {})).persons.find((p) => p.id === northwind);

test("only the super-agent is offered apx_settings", async () => {
  const offered = async (agent: string) => {
    await h.ask("hello", undefined, agent);
    return h.llm.calls.at(-1)?.tools.map((t) => t.function.name) ?? [];
  };
  assert.ok((await offered("roby")).includes("apx_settings"));
  assert.ok(!(await offered("acme-writer")).includes("apx_settings"));
});

test("reading what it can change, the contacts and a method's fields asks nobody", async () => {
  // No args is an index by area, short enough to read every time; an area lists what each method does.
  const index = (await h.ask({})).answer;
  assert.match(index, /^- contacts: list, set, remove, address, claim$/m);
  assert.match(index, /^- memory: .*set_settings/m);
  assert.ok(index.length < 2_000, `the index is ${index.length} chars`);
  const list = (await h.ask({ method: "contacts" })).answer;
  assert.match(list, /- contacts\.set: /);
  assert.match(list, /- contacts\.list \(read\): /);
  assert.doesNotMatch(list, /channels\.set/);
  assert.match((await h.ask({ method: "channels" })).answer, /- channels\.set: .*hours/);
  assert.match((await h.ask({ method: "contacts.list" })).answer, new RegExp(`Northwind Sister \\[${northwind}\\]`));
  assert.match((await h.ask({ method: "contacts.set" })).answer, /contacts\.set takes: .*"rules"/);
});

test("the contacts read narrows by name and says when the list is cut", async () => {
  for (let i = 0; i < 101; i++)
    await h.env.client.call("contacts.set", { name: `Acme Guest ${String(i).padStart(3, "0")}` });
  const all = (await h.ask({ method: "contacts.list" })).answer;
  assert.equal(all.split("\n").filter((l) => l.startsWith("- ")).length, 100);
  assert.match(all, /…and 2 more: narrow it with params\.query\./);
  const one = (await h.ask({ method: "contacts.list", params: { query: "northwind" } })).answer;
  assert.match(one, /^- Northwind Sister/);
  assert.equal(one.split("\n").length, 1);
  assert.match((await h.ask({ method: "contacts.list", params: { query: "nobody" } })).answer, /no contact matches/);
});

test("the owner approves who a contact is and how to answer them, read before and after", async () => {
  const { answer, detail } = await h.ask(tellHer(), "approve");
  assert.match(detail, /^Change the contact Northwind Sister/);
  assert.match(detail, /note: \(none\) → "My sister"/);
  assert.match(detail, /rules: \(none\) → "Answer warmly, in Spanish\."/);
  assert.doesNotMatch(detail, /name:/);
  assert.match(answer, /^done: - Northwind Sister/);
  const p = await sister();
  assert.equal(p?.note, "My sister");
  assert.equal(p?.rules, "Answer warmly, in Spanish.");
  assert.equal(p?.name, "Northwind Sister");
});

test("a change to what already is so asks nobody and changes nothing", async () => {
  // Asked without a decision: a card waiting for the owner would leave the turn unsettled.
  const { answer } = await h.ask(tellHer());
  assert.match(answer, /^nothing to change: Change the contact Northwind Sister/);
  assert.equal((await sister())?.note, "My sister");
});

test("a declined change saves nothing", async () => {
  await h.env.client.call("contacts.set", { id: northwind, name: "Northwind Sister", note: "", rules: "" });
  await h.ask(tellHer(), "deny");
  const p = await sister();
  assert.ok(!p?.rules && !p?.note);
});

test("a change the method would refuse, or a method out of reach, never reaches the owner", async () => {
  const friend = { method: "contacts.set", params: { id: northwind, relation: "best-friend-ever" } };
  assert.match((await h.ask(friend)).answer, /contacts\.set: relation: /);
  assert.match(
    (await h.ask({ method: "secrets.set", params: { name: "x", value: "y" } })).answer,
    /no setting "secrets\.set"/,
  );
});

test("the card's title names the area, not the method", () => {
  const title = SPANISH_TITLES.apx_settings;
  assert.equal(title?.({ method: "channels.set", params: {} }), "Cambió un canal");
  assert.equal(title?.({ method: "contacts.remove", params: {} }), "Quitó un contacto");
  assert.equal(title?.({ method: "contacts.list", params: { query: "x" } }), "Revisó la configuración");
});

test("every owner method that changes something is placed: apx_settings, a tool of its own, the owner's, or not yet", () => {
  const placed = [Object.keys(SETTINGS), Object.keys(BY_TOOL), Object.keys(OWNER_ONLY), [...NOT_YET]];
  const owner = Object.keys(methods).filter(
    (m) => methodAccess(m as keyof typeof methods) === "human" && methods[m as keyof typeof methods].effect,
  );
  const missing = owner.filter((m) => !placed.some((list) => list.includes(m)));
  assert.deepEqual(missing, [], "place each new owner method in tools/settings-*.ts or tools/settings-reach.ts");
  const twice = owner.filter((m) => placed.filter((list) => list.includes(m)).length > 1);
  assert.deepEqual(twice, []);
  const stale = placed.flat().filter((m) => !(m in methods));
  assert.deepEqual(stale, []);
  assert.deepEqual(NOT_YET, [], "every owner setting is decided");
  const reads = Object.entries(SETTINGS).filter(([m, s]) => s.read && methods[m as keyof typeof methods].effect);
  assert.deepEqual(reads, [], "a read answers from the store, so it is never a method that changes something");
});
