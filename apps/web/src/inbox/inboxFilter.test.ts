import assert from "node:assert/strict";
import { test } from "node:test";
import type { Project, Thread } from "@apx/protocol";
import { type InboxFilter, passesFilter, soleFilter } from "./inboxFilter.ts";

const chat = (agent: string, project?: string, extra: Partial<Thread> = {}) =>
  ({
    id: `${agent}-${project}`,
    agent_ids: [agent],
    ...(project ? { project_id: project } : {}),
    ...extra,
  }) as unknown as Thread;
const projects = [
  { id: "p_web", name: "Web", parent: "p_acme" },
  { id: "p_acme", name: "Acme" },
] as unknown as Project[];
const none: InboxFilter = { agents: [], projects: [], accounts: [], channels: [], engines: [] };
const on = (f: Partial<InboxFilter>): InboxFilter => ({ ...none, ...f });
const contact = (account: string) => chat("roby", undefined, { channel: { id: account, conversation: "c1" } });
const apps: Record<string, string> = { wa_sales: "whatsapp", wa_home: "whatsapp", tg_team: "telegram" };
const kindOf = (account: string) => apps[account];

test("nothing chosen lets every chat through", () => {
  assert.equal(passesFilter(chat("roby"), none, projects), true);
});

test("agents: any of them; projects: any of them; both kinds must match", () => {
  const f = on({ agents: ["roby", "cody"], projects: ["p_acme"] });
  assert.equal(passesFilter(chat("cody", "p_acme"), f, projects), true);
  assert.equal(passesFilter(chat("magui", "p_acme"), f, projects), false);
  assert.equal(passesFilter(chat("roby", "p_other"), f, projects), false);
});

test("a project takes its subprojects' chats", () => {
  assert.equal(passesFilter(chat("roby", "p_web"), on({ projects: ["p_acme"] }), projects), true);
});

test("an account keeps only the chats on it", () => {
  const f = on({ accounts: ["wa_sales"] });
  assert.equal(passesFilter(contact("wa_sales"), f, projects, kindOf), true);
  assert.equal(passesFilter(contact("wa_home"), f, projects, kindOf), false);
  assert.equal(passesFilter(chat("roby"), f, projects, kindOf), false);
});

test("a channel app keeps the chats of every account of it", () => {
  const f = on({ channels: ["whatsapp"] });
  assert.equal(passesFilter(contact("wa_sales"), f, projects, kindOf), true);
  assert.equal(passesFilter(contact("wa_home"), f, projects, kindOf), true);
  assert.equal(passesFilter(contact("tg_team"), f, projects, kindOf), false);
  assert.equal(passesFilter(chat("roby"), f, projects, kindOf), false);
});

test("an engine keeps only its own sessions", () => {
  const f = on({ engines: ["claude"] });
  assert.equal(passesFilter(chat("roby", undefined, { engine: "claude" }), f, projects), true);
  assert.equal(passesFilter(chat("roby", undefined, { engine: "codex" }), f, projects), false);
  assert.equal(passesFilter(chat("roby"), f, projects), false);
});

test("kinds combine: an account and an agent must both match", () => {
  const f = on({ accounts: ["wa_sales"], agents: ["magui"] });
  assert.equal(passesFilter(contact("wa_sales"), f, projects, kindOf), false);
});

test("the sole pick is named only when the filter holds exactly one", () => {
  assert.deepEqual(soleFilter(on({ accounts: ["wa_sales"] })), { kind: "accounts", id: "wa_sales" });
  assert.equal(soleFilter(none), undefined);
  assert.equal(soleFilter(on({ accounts: ["wa_sales"], engines: ["claude"] })), undefined);
  assert.equal(soleFilter(on({ accounts: ["wa_sales", "tg_team"] })), undefined);
});

test("a hidden account's chats are left out, unless the filter picks that account", () => {
  const hidden = ["mail"];
  assert.equal(passesFilter(contact("mail"), none, projects, kindOf, hidden), false);
  assert.equal(passesFilter(contact("wa_sales"), none, projects, kindOf, hidden), true);
  assert.equal(passesFilter(chat("roby"), none, projects, kindOf, hidden), true);
  assert.equal(passesFilter(contact("mail"), on({ accounts: ["mail"] }), projects, kindOf, hidden), true);
});
