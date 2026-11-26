import assert from "node:assert/strict";
import { test } from "node:test";
import { createBus } from "../bus.ts";
import { openDb } from "../db/db.ts";
import { tempDir } from "../testkit/platform.ts";
import type { AgentRecord } from "./agents.ts";
import { canReadChat, canReadOwnScope, canRecallOwnChat } from "./chat-access.ts";
import { CONTACT_CONSULT } from "./runs.ts";
import { seed } from "./seed.ts";
import { createStore } from "./store.ts";

function fixture() {
  const dir = tempDir("apx-chat-access-");
  const db = openDb(dir.path);
  const store = createStore(db, createBus());
  seed(store);
  for (const [id, name] of [
    ["acme", "Acme"],
    ["northwind", "Northwind"],
    ["vault", "Vault"],
  ] as const)
    store.projects.upsert({ id, name });
  const agent = (id: string, project_id?: string): AgentRecord => {
    store.agents.upsert({
      id,
      name: id,
      role: "Research",
      kind: "agent",
      ...(project_id ? { project_id } : {}),
      browser_profile: "isolated",
      prompt: "",
    });
    return store.agents.get(id) as AgentRecord;
  };
  const chat = (title: string, extra: Partial<Parameters<typeof store.threads.create>[0]>) =>
    store.threads.create({ kind: "loose", title, agent_ids: ["superagent"], ...extra });
  const close = async () => {
    db.close();
    await dir.remove();
  };
  return { store, agent, chat, close };
}

test("the owner's agents read the owner's chats in any project, their sessions included (D-271)", async () => {
  const { store, agent, chat, close } = fixture();
  try {
    const builder = agent("builder", "acme");
    const editor = agent("editor");
    const other = chat("Northwind plan", { project_id: "northwind" });
    const session = chat("Northwind session", { kind: "a2a", project_id: "northwind", parent_id: other.id });
    const home = chat("Errands", {});
    for (const t of [other, session, home]) {
      assert.equal(canReadChat(store, builder, t), true, `project agent reads ${t.title}`);
      assert.equal(canReadChat(store, editor, t), true, `global agent reads ${t.title}`);
    }
    // The narrow rule still holds for the uses that keep it.
    assert.equal(canReadOwnScope(store, builder, other), false);
    assert.equal(canReadOwnScope(store, editor, session), false);
  } finally {
    await close();
  }
});

test("outside apps, contacts, rooms, Flow bots, consults, moves and protected projects stay walled", async () => {
  const { store, agent, chat, close } = fixture();
  try {
    const builder = agent("builder", "acme");
    const editor = agent("editor");
    const contact = store.persons.create({ name: "Alex Acme", role: "contact" });
    const client = chat("Outside app", { project_id: "northwind" });
    store.threads.mergeContext(client.id, { client: "external" });
    const room = chat("Room", { project_id: "northwind" });
    store.threads.mergeContext(room.id, { room: { name: "general" } });
    const bot = chat("Flow bot", { project_id: "northwind" });
    store.threads.mergeContext(bot.id, { flow_step: { delegate: false, bot: true } });
    const contactChat = chat("Alex", {
      project_id: "northwind",
      channel: { id: "ch_test", conversation: "c1", person_id: contact.id },
    });
    const consult = chat("Consult", {
      kind: "a2a",
      project_id: "northwind",
      parent_id: contactChat.id,
      session: CONTACT_CONSULT,
    });
    const delegated = chat("Contact's delegated session", {
      kind: "a2a",
      project_id: "northwind",
      parent_id: contactChat.id,
    });
    const vault = chat("Vault plan", { project_id: "vault" });
    store.projectProtection.protect("move_1", "vault");
    const moving = chat("Moving", { project_id: "northwind" });
    store.agentMigrationPending.reserve({
      id: "6f1c3c1e-8a63-4c4e-9a52-1e7c0f4f7a10",
      agent: "someone",
      source: "acme",
      destination: "acme",
      threads: [moving.id],
    });
    for (const t of [client, room, bot, contactChat, consult, delegated, vault, moving])
      for (const a of [builder, editor]) assert.equal(canReadChat(store, a, t), false, `${a.id} reads ${t.title}`);
    // A protected project's own agent still reads its chats, and only those.
    const keeper = agent("keeper", "vault");
    assert.equal(canReadChat(store, keeper, vault), true);
    assert.equal(canReadChat(store, keeper, chat("Errands", {})), false);
  } finally {
    await close();
  }
});

test("automatic recall keeps the narrow rule: never another project's chat", async () => {
  const { store, agent, chat, close } = fixture();
  try {
    const builder = agent("builder", "acme");
    const current = chat("Acme now", { project_id: "acme", agent_ids: ["builder"] });
    const elsewhere = chat("Northwind earlier", { project_id: "northwind", agent_ids: ["superagent"] });
    assert.equal(canReadChat(store, builder, elsewhere), true);
    assert.equal(canRecallOwnChat(store, builder, current, elsewhere), false);
  } finally {
    await close();
  }
});
