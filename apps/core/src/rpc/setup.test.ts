import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fakeWhatsApp } from "../channels/fake-whatsapp.test-support.ts";
import { whatsappAdapter } from "../channels/whatsapp.ts";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { v1Schedule } from "../import/v1-setup.ts";
import { realpath } from "../paths.ts";

let env: Awaited<ReturnType<typeof startCore>>;
let repo = "";
const json = (file: string, v: unknown) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof v === "string" ? v : JSON.stringify(v));
};
const lines = (...rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n");

before(async () => {
  // An emulated WhatsApp: importing creates the channel, which starts linking at once.
  const wa = fakeWhatsApp();
  env = await startCore({
    llm: scriptedLlm(() => say("ok")),
    channelAdapters: {
      whatsapp: (c) =>
        whatsappAdapter({ dir: path.join(env.home, "wa"), selfOwner: c.self_owner === true, lib: async () => wa.lib }),
      // Importing Discord starts its bot: a stand-in that connects nowhere.
      discord: () => ({
        caps: { typing: false, buttons: false },
        start: async () => ({ account: "@bot" }),
        stop: async () => {},
        send: async () => ({}),
      }),
    },
  });
  const v1 = path.join(env.home, "v1");
  repo = realpath(fs.mkdtempSync(path.join(os.tmpdir(), "apx-v1repo-")));
  json(path.join(repo, "AGENTS.md"), "# Acme\n");
  json(path.join(repo, ".apc", "project.json"), { name: "Acme", apx_id: "abc123def456" });
  json(path.join(repo, ".apc", "agents", "dev.md"), "---\nname: Dev\nrole: developer\n---\nYou build.\n");
  json(path.join(v1, "config.json"), {
    projects: [{ path: repo }, { path: "/nowhere/gone" }],
    memory: {
      embeddings: {
        order: ["ollama", "gemini", "openai"],
        ollama: { model: "embeddinggemma:300m", base_url: "" },
        gemini: { api_key: "", model: "gemini-embedding-001" },
        openai: { api_key: "sk-e2e-0000", model: "text-embedding-3-small", enabled: true },
      },
    },
    skills: { inspector: { enabled: false } },
    user: { language: "es", timezone: "America/Argentina/Buenos_Aires" },
    super_agent: { system: "Never book meetings before 10.", icon: "noche", permission_mode: "total" },
    profile: {
      active: "secretary",
      config: {
        day_open_schedule: "0 9 * * 1-5",
        watch_schedule: "0 */3 * * *",
        blocked_task_hours: 24,
        formality: "informal",
        nudge_budget_per_day: 5,
        quiet_hours: "22:00-07:30",
      },
    },
    discord: {
      enabled: true,
      token: "MTIzNDU2.fake.discord-token",
      owner_ids: ["123456789012345678"],
      names: ["Roby", "roby-superagent"],
      owner_only: false,
      knowledge: "Acme Notes installs with brew.",
      rules: "Never talk about prices.",
      reply_when: "Only install questions.",
      channels: {
        "100000000000000001": { mode: "mention", name: "general" },
        "100000000000000002": { mode: "useful", name: "help" },
        "not-a-snowflake": { mode: "always" },
        "100000000000000003": { mode: "shout" },
      },
      limits: {
        user_cooldown_ms: 30000,
        channel_replies_per_hour: 10,
        burst_window_ms: 8000,
        gate_checks_per_hour: 50,
      },
    },
    whatsapp: {
      self_is_owner: false,
      self_jid: "5491100000001:3@s.whatsapp.net",
      owner_jid: "100000000000009@lid",
      owner_alts: ["5491100000009@s.whatsapp.net"],
      contacts: [
        {
          jid: "5491100000002@s.whatsapp.net",
          alts: ["200000000000002@lid"],
          name: "Northwind Buyer",
          nickname: "NB",
          relationship: "supplier",
          bio: "Buys our coffee.",
          rules: "Be brief.",
          facts: "We open at 9.",
          capabilities: { errands: true, facts: true },
          role: "contact",
          auto_reply: true,
        },
        { jid: "300000000000003@lid", name: "Acme Guest", role: "guest" },
      ],
    },
  });
  json(path.join(v1, "update-check.json"), { current: "1.123.1" });
  json(path.join(v1, "identity.json"), {
    agent_name: "Roby",
    owner_name: "Ana",
    personality: "warm and direct",
    owner_context: "Runs a small bakery in Northwind.",
  });
  json(path.join(v1, "vars.json"), { NORTHWIND_TOKEN: "nw-secret-value" });
  json(path.join(v1, "skills", "brief", "SKILL.md"), "---\nname: brief\ndescription: A brief.\n---\nHow.\n");
  json(
    path.join(v1, "memory.md"),
    "# Self\n\n## 2026-09-01\n- [09:00][app] Ana prefers short answers\n- [10:00] Coffee at 10\n",
  );
  // The super-agent's chats (Telegram over two days, a Telegram group, web and its sidebar; a WhatsApp contact),
  // Default's agents and an agent's own chat and notes.
  json(
    path.join(v1, "messages", "telegram", "2026-09-01.jsonl"),
    lines(
      { ts: "2026-09-01T10:00:00.000Z", type: "user", body: "remind me to call Northwind", meta: { chat_id: 1 } },
      { ts: "2026-09-01T10:00:02.000Z", type: "tool", body: "", meta: { tool: "create_task", chat_id: 1 } },
      {
        ts: "2026-09-01T10:00:03.000Z",
        type: "agent",
        body: "Done: a task for Friday.",
        meta: { chat_id: 1, model: "m1" },
      },
    ),
  );
  json(
    path.join(v1, "messages", "telegram", "2026-09-04.jsonl"),
    lines(
      { ts: "2026-09-04T09:00:00.000Z", type: "user", body: "and the bakery?", meta: { chat_id: 1 } },
      { ts: "2026-09-04T09:00:01.000Z", type: "agent", body: "Open till 8.", meta: { chat_id: 1 } },
      { ts: "2026-09-04T09:30:00.000Z", type: "agent", body: "A restored reminder.", meta: { restored_from: "x" } },
      { ts: "2026-09-04T12:00:00.000Z", type: "user", body: "lunch at 1?", meta: { chat_id: -7, chat_title: "Team" } },
    ),
  );
  json(
    path.join(v1, "messages", "web", "2026-09-05.jsonl"),
    lines({ ts: "2026-09-05T10:00:00.000Z", type: "user", body: "from the web", meta: {} }),
  );
  json(
    path.join(v1, "messages", "web_sidebar", "2026-09-04.jsonl"),
    lines({ ts: "2026-09-04T10:00:00.000Z", type: "user", body: "from the sidebar", meta: {} }),
  );
  json(
    path.join(v1, "messages", "whatsapp", "2026-09-02.jsonl"),
    lines({
      ts: "2026-09-02T09:00:00.000Z",
      type: "user",
      author: "Northwind Buyer",
      body: "Do you have rye bread?",
      meta: { contact_key: "5491100000002@s.whatsapp.net", policy: "contact" },
    }),
  );
  json(
    path.join(v1, "projects", "default", ".apc", "agents", "andy.md"),
    "---\nname: Andy\nrole: orchestrator\nicon: eclipse\nmaster: true\n---\nYou route the work.\n",
  );
  json(path.join(v1, "projects", "default", "agents", "andy", "memory.md"), "- The owner likes lists short\n");
  json(
    path.join(v1, "projects", "default", "agents", "andy", "conversations", "2026-09-03-01.md"),
    "---\nagent: andy\nchannel: web\ntitle: Plan the week\n---\n## user — 2026-09-03T08:00:00.000Z\nWhat is on?\n\n## assistant — 2026-09-03T08:00:05.000Z\nTwo deliveries.\n",
  );
  const storage = path.join(v1, "projects", "abc123def456");
  json(path.join(storage, "memory.md"), "## 2026-09-02\n- [11:00][app] Deploys go out on Fridays\n");
  json(
    path.join(storage, "tasks", "2026-09.jsonl"),
    lines(
      {
        id: "t1",
        op: "create",
        ts: "2026-09-01T10:00:00Z",
        title: "Ship the invoice page",
        due: "2026-10-20",
        priority: "high",
        tags: ["billing"],
        status: "running",
      },
      { id: "t2", op: "create", ts: "2026-09-01T10:01:00Z", title: "Old chore" },
      { id: "t2", op: "done", ts: "2026-09-02T10:00:00Z" },
      { id: "t1", op: "update", ts: "2026-09-03T10:00:00Z", patch: { title: "Ship the invoice page v2" } },
    ),
  );
  json(
    path.join(storage, "commitments", "2026-09.jsonl"),
    lines(
      {
        id: "c1",
        op: "create",
        ts: "2026-09-01T10:00:00Z",
        counterparty: "Northwind",
        body: "Send the quote",
        due: "2026-09-15",
      },
      { id: "c2", op: "create", ts: "2026-09-01T10:00:00Z", counterparty: "Bob", body: "Return the drill" },
      { id: "c2", op: "kept", ts: "2026-09-04T10:00:00Z" },
    ),
  );
  json(path.join(storage, "routines.json"), {
    routines: [
      {
        id: "r1",
        name: "Morning brief",
        kind: "exec_agent",
        schedule: "30 8 * * 1-5",
        spec: { agent: "dev", prompt: "Brief me" },
        pre_commands: ["acme check"],
        post_commands: ['apx telegram send "$APX_LLM_OUTPUT"', "acme log done"],
        skip_prompt_on: "pre_failure",
        enabled: true,
      },
      {
        id: "r3",
        name: "secretary-watch",
        kind: "watch",
        schedule: "0 8-20/2 * * *",
        origin: "profile:secretary",
        spec: { prompt: "Call list_commitments" },
        enabled: true,
      },
      {
        id: "r2",
        name: "Backup",
        kind: "shell",
        schedule: "every:2h",
        spec: { command: "tar czf b.tgz notes" },
        enabled: true,
      },
    ],
  });
});
after(async () => {
  await env.core.close();
  env.cleanup();
  fs.rmSync(repo, { recursive: true, force: true });
});

test("the setup finds v1 and counts what it has, reading only real projects", async () => {
  const s = await env.client.call("setup.status", {});
  assert.equal(s.done, false);
  assert.equal(s.fresh, true);
  assert.deepEqual(
    { version: s.v1?.version, agent: s.v1?.agent_name, blob: s.v1?.agent_blob, projects: s.v1?.projects },
    { version: "1.123.1", agent: "Roby", blob: "noche", projects: 1 },
  );
  const { groups } = await env.client.call("setup.v1_scan", {});
  const count = Object.fromEntries(groups.map((g) => [g.id, g.count]));
  assert.deepEqual(count, {
    projects: 1,
    skills: 1,
    keys: 0,
    mcps: 0,
    vars: 1,
    memory: 3,
    embeddings: 2,
    services: 0,
    identity: 5,
    chats: 5,
    channels: 2,
    tasks: 1,
    commitments: 1,
    routines: 2,
  });
  assert.equal(groups.find((g) => g.id === "projects")?.detail, "2", "one agent in it and one in Default");
  assert.equal(
    groups.find((g) => g.id === "embeddings")?.detail,
    "Ollama · embeddinggemma:300m, OpenAI · text-embedding-3-small",
    "Gemini had no key of its own",
  );
});

test("importing brings projects, notes, open tasks and commitments, variables and routines (off)", async () => {
  const r = await env.client.call("setup.import_v1", {
    groups: ["projects", "skills", "vars", "memory", "tasks", "commitments", "routines"],
  });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.imported, { projects: 1, skills: 1, vars: 1, memory: 3, tasks: 1, commitments: 1, routines: 2 });

  const project = env.core.store.projects.byPath(repo)?.id;
  assert.ok(project);
  const { tasks } = await env.client.call("tasks.list", {});
  const ship = tasks.find((t) => t.title === "Ship the invoice page v2");
  assert.equal(ship?.project_id, project);
  assert.equal(ship?.priority, "high");
  assert.equal(ship?.status, "doing");
  assert.deepEqual(ship?.tags, ["billing"]);
  assert.ok(!tasks.some((t) => t.title === "Old chore"), "a done task stays behind");
  const quote = tasks.find((t) => t.title === "Send the quote");
  assert.equal(quote?.kind, "commitment");
  assert.equal(quote?.person_name, "Northwind");
  // Already due in v1: it arrives as known, so no burst of reminders the moment it lands.
  assert.ok(!env.core.store.tasks.remindDue(new Date().toISOString()).some((t) => t.title === "Send the quote"));

  const notes = env.core.store.memories.list({ limit: 50 }).map((m) => [m.scope, m.text]);
  assert.ok(notes.some(([s, t]) => s === "global" && t === "Ana prefers short answers"));
  assert.ok(notes.some(([s, t]) => s === "project" && t === "Deploys go out on Fridays"));

  assert.ok(env.core.secrets.has("secret://NORTHWIND_TOKEN"));

  const routines = env.core.store.routines.list(project);
  const brief = routines.find((x) => x.name === "Morning brief");
  assert.equal(brief?.enabled, false, "v1 may still run it");
  assert.equal(brief?.action, "agent");
  assert.equal(brief?.call_model, "succeeds", "v1 left the model out when the pre-command failed");
  assert.equal(env.core.store.agents.get(brief?.agent_id ?? "")?.slug, "dev");
  assert.equal(brief?.post_command, "acme log done", "v1's own send to a channel goes: v2 delivers the news itself");
  const backup = routines.find((x) => x.name === "Backup");
  assert.equal(backup?.action, "shell");
  assert.equal(backup?.pre_command, "tar czf b.tgz notes");
  assert.deepEqual(backup?.schedule, { kind: "every", minutes: 120 });

  await env.client.call("setup.finish", {});
  assert.equal((await env.client.call("setup.status", {})).done, true);
});

test("importing the embedding engines brings them in v1's order, with their keys, and v1's skill picker choice", async () => {
  const r = await env.client.call("setup.import_v1", { groups: ["embeddings"] });
  assert.deepEqual(r.errors, []);
  assert.equal(r.imported.embeddings, 2);
  // Read as stored: listing them would call the engines to check they answer.
  const services = env.core.store.settings.read("services").filter((s) => s.kind === "embedding");
  assert.deepEqual(
    services.map((s) => [s.id, s.label, s.base_url, s.model, env.core.secrets.has(`secret://service-${s.id}`)]),
    [
      ["v1-ollama", "Ollama", "http://127.0.0.1:11434", "embeddinggemma:300m", false],
      ["v1-openai", "OpenAI", "https://api.openai.com/v1", "text-embedding-3-small", true],
    ],
  );
  assert.equal((await env.client.call("memory.settings", {})).skill_picker, false);
  // Again: what v2 already has is kept, nothing doubles.
  assert.equal((await env.client.call("setup.import_v1", { groups: ["embeddings"] })).imported.embeddings, 0);
  await env.client.call("memory.set_settings", { mode: "notes", auto_compact: true, skill_picker: true });
});

test("importing the identity brings who the owner is, the super-agent's personality and the profile it ran", async () => {
  const r = await env.client.call("setup.import_v1", { groups: ["identity"] });
  assert.deepEqual(r.errors, []);
  const owner = await env.client.call("owner.get", {});
  assert.deepEqual(owner, {
    name: "Ana",
    about: "Runs a small bakery in Northwind.",
    language: "es",
    timezone: "America/Argentina/Buenos_Aires",
  });
  const roby = await env.client.call("agents.get", { agent: "roby" });
  assert.equal(roby.prompt, "Never book meetings before 10.");
  assert.deepEqual([roby.agent.name, roby.agent.blob, roby.agent.personality], ["Roby", "noche", "warm and direct"]);
  assert.equal(roby.agent.autonomy, "total", "v1's permission_mode: it acts without asking, as it did there");
  const { active, routines } = await env.client.call("profiles.list", {});
  assert.equal(active.id, "secretary");
  assert.equal(active.values.day_open, "0 9 * * 1-5");
  assert.equal(active.values.watch_every_h, 3);
  assert.equal(active.values.waiting_hours, 24);
  assert.equal(active.values.formality, "informal");
  assert.equal(routines.filter((x) => x.enabled).length, 5, "v1's four, and important mail");
  assert.ok(routines.some((x) => x.origin === "secretary:mail" && x.action === "mail"));
  const notices = env.core.store.settings.read("notices");
  assert.deepEqual([notices.budget_per_day, notices.quiet_from, notices.quiet_to], [5, "22:00", "07:30"]);
  await env.client.call("profiles.set", { id: null, values: {} });
});

test("importing brings Default's agents with their notes, and the chats: one per channel, a contact's, an agent's", async () => {
  const r = await env.client.call("setup.import_v1", { groups: ["projects", "chats"] });
  assert.deepEqual(r.errors, []);
  const andy = env.core.store.agents.get("andy");
  assert.deepEqual(
    [andy?.name, andy?.blob, andy?.project_id, andy?.prompt],
    ["Andy", "eclipse", undefined, "You route the work."],
  );
  assert.ok(
    env.core.store.memories.list({ agent_id: "andy", limit: 10 }).some((m) => m.text === "The owner likes lists short"),
  );
  assert.equal(r.imported.chats, 5);
  const threads = env.core.store.threads.list().filter((t) => /Telegram|WhatsApp|Web|Plan the week/.test(t.title));
  const tg = threads.find((t) => t.title === "Telegram (v1)");
  assert.ok(tg, "the owner's Telegram chat is one conversation, whatever the days");
  assert.equal(tg.updated_at, "2026-09-04T09:30:00.000Z", "the chat keeps v1's time");
  const msgs = env.core.store.messages.list(tg.id);
  assert.equal(msgs.length, 5, "a row that lost its chat id is the owner's chat too");
  assert.equal(msgs[0]?.created_at, "2026-09-01T10:00:00.000Z");
  assert.deepEqual(
    msgs[1]?.parts.map((p) => p.type),
    ["tool", "text"],
    "the tool call rides on the answer",
  );
  assert.ok(
    threads.some((t) => t.title === "Telegram · Team"),
    "a group is its own conversation",
  );
  const web = threads.find((t) => t.title === "Web (v1)");
  assert.deepEqual(
    env.core.store.messages.list(web?.id ?? "").map((m) => m.parts[0]?.type === "text" && m.parts[0].text),
    ["from the sidebar", "from the web"],
    "v1's web and sidebar chats are one, in time order",
  );
  const wa = threads.find((t) => t.title === "WhatsApp · Northwind Buyer");
  assert.equal(env.core.store.messages.list(wa?.id ?? "")[0]?.author.kind, "user");
  const week = threads.find((t) => t.title === "Plan the week");
  assert.deepEqual(week?.agent_ids, ["andy"]);
  assert.equal((await env.client.call("setup.import_v1", { groups: ["chats"] })).imported.chats, 0, "once only");
});

test("importing channels brings v1's WhatsApp: whose phone the line is, the owner's numbers and who each contact is", async () => {
  const r = await env.client.call("setup.import_v1", { groups: ["channels"] });
  assert.deepEqual(r.errors, []);
  assert.equal(r.imported.channels, 6, "WhatsApp and its 2 contacts, Discord and its 2 rooms");
  const { persons } = await env.client.call("contacts.list", {});
  const wa = (p: (typeof persons)[number] | undefined) =>
    p?.addresses.filter((a) => a.channel === "whatsapp").map((a) => a.external_id);
  assert.deepEqual(wa(persons.find((p) => p.role === "owner"))?.sort(), [
    "100000000000009@lid",
    "5491100000009@s.whatsapp.net",
  ]);
  const buyer = persons.find((p) => p.name === "Northwind Buyer");
  assert.deepEqual(
    {
      nickname: buyer?.nickname,
      relation: buyer?.relation,
      note: buyer?.note,
      muted: buyer?.muted,
      perms: buyer?.perms,
    },
    {
      nickname: "NB",
      relation: "provider",
      note: "Buys our coffee.",
      muted: false,
      perms: { appointments: false, requests: true, notes: true },
    },
  );
  assert.match(buyer?.rules ?? "", /Be brief\.[\s\S]*We open at 9\./);
  assert.equal(wa(buyer)?.length, 2, "their number and their private id");
  assert.equal(persons.find((p) => p.name === "Acme Guest")?.muted, true, "v1 never answered a guest");
  const channel = (await env.client.call("channels.list", {})).channels.find((c) => c.id === "whatsapp");
  assert.deepEqual(
    { strangers: channel?.strangers, self_owner: channel?.self_owner },
    { strangers: "ask", self_owner: false },
  );
});

test("importing channels brings v1's Discord: the owner's id, its rooms with their modes, words, notes and limits", async () => {
  const channel = (await env.client.call("channels.list", {})).channels.find((c) => c.id === "discord");
  assert.ok(channel?.token_set, "the bot's token, in v2's secret store");
  assert.deepEqual(channel?.rooms?.rooms, [
    { id: "100000000000000001", name: "general", mode: "mention" },
    { id: "100000000000000002", name: "help", mode: "useful" },
  ]);
  assert.deepEqual(
    {
      names: channel?.rooms?.names,
      knowledge: channel?.rooms?.knowledge,
      rules: channel?.rooms?.rules,
      reply_when: channel?.rooms?.reply_when,
      limits: channel?.rooms?.limits,
      strangers: channel?.strangers,
    },
    {
      names: ["roby", "roby-superagent"],
      knowledge: "Acme Notes installs with brew.",
      rules: "Never talk about prices.",
      reply_when: "Only install questions.",
      limits: { user_cooldown_s: 30, room_replies_per_hour: 10, checks_per_hour: 50 },
      strangers: "ask",
    },
  );
  const owner = (await env.client.call("contacts.list", {})).persons.find((p) => p.role === "owner");
  assert.ok(owner?.addresses.some((a) => a.channel === "discord" && a.external_id === "123456789012345678"));
});

test("v1 schedules read as v2's", () => {
  assert.deepEqual(v1Schedule("manual"), { kind: "manual" });
  assert.deepEqual(v1Schedule("every:30s"), { kind: "every", minutes: 5 });
  assert.deepEqual(v1Schedule("cron 0 */2 * * *"), { kind: "cron", cron: "0 */2 * * *" });
  assert.deepEqual(v1Schedule("once:2026-10-05T09:00:00Z"), { kind: "once", at: "2026-10-05T09:00:00Z" });
});
