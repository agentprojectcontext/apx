import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import type { HermesItem } from "@apx/protocol";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { type TempDir, tempDir } from "../testkit/platform.ts";

// A Hermes home as its docs describe it: config.yaml, .env, SOUL.md, memories/, skills/, cron/jobs.json, profiles/.
const CONFIG = `model:
  provider: openrouter
  default: acme/model-large
providers:
  acme-gateway:
    api: https://llm.example.com/v1
    api_key: not-a-real-provider-key
agent:
  personalities:
    pirate: "Talk like a pirate."
mcp_servers:
  docs:
    command: npx
    args: ["-y", "acme-docs-mcp"]
  tracker:
    command: npx
    args:
      - -y
      - northwind-tracker-mcp
    env:
      TRACKER_API_TOKEN: not-a-real-tracker-token
      TRACKER_REGION: eu
  remote:
    url: https://mcp.example.com/mcp
    headers:
      Authorization: Bearer not-a-real-bearer-value
platforms:
  telegram:
    enabled: true
`;
const SKILL = "---\nname: log-triage\ndescription: Steps for finding the cause in logs\n---\n\n# Log triage\n";
const job = (o: Record<string, unknown>): Record<string, unknown> => ({
  enabled: true,
  state: "scheduled",
  deliver: "origin",
  ...o,
});
const JOBS = {
  jobs: [
    job({
      id: "a1",
      name: "Morning feeds",
      prompt: "Summarize new items",
      schedule: { kind: "cron", expr: "0 9 * * *", display: "0 9 * * *" },
      skills: ["log-triage"],
    }),
    job({ id: "a2", name: "Ping", prompt: "Ping the site", schedule: { kind: "interval", minutes: 1 } }),
    job({ id: "a3", name: "Backup", prompt: "", script: "backup.sh", schedule: { kind: "interval", minutes: 60 } }),
  ],
  updated_at: "2026-10-01T09:00:00Z",
};

function write(root: string, files: Record<string, string>) {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
}

let env: Awaited<ReturnType<typeof startCore>>;
let dir: TempDir;
let hermes = "";

before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  dir = tempDir("apx-hermes-");
  hermes = path.join(dir.path, ".hermes");
  write(hermes, {
    "config.yaml": CONFIG,
    ".env": "OPENROUTER_API_KEY=not-a-real-openrouter-key\nTELEGRAM_BOT_TOKEN=000:not-a-real-bot-token\n",
    "auth.json": '{"nous": {"access_token": "not-a-real-oauth-token"}}',
    "SOUL.md": "You are Acme's assistant. Be brief.\n",
    "memories/MEMORY.md": "Acme ships on Tuesdays\n§\n-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n",
    "memories/USER.md": "The owner prefers short answers\n",
    "skills/devops/log-triage/SKILL.md": SKILL,
    "cron/jobs.json": JSON.stringify(JOBS),
    "profiles/work/SOUL.md": "You handle Northwind's support.\n",
    "profiles/work/memories/MEMORY.md": "Northwind tickets close within a day\n",
    "profiles/work/skills/log-triage/SKILL.md": SKILL,
  });
});
after(async () => {
  await env.core.close();
  await env.cleanup();
  await dir.remove();
});

const brief = (items: HermesItem[]) => items.map((i) => [i.kind, i.profile, i.name, i.action, i.why ?? ""].join(" "));

/** Every file under `root`, as text. */
function allText(root: string): string {
  return fs
    .readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => fs.readFileSync(path.join(e.parentPath, e.name), "latin1"))
    .join("\n");
}

let preview: HermesItem[] = [];

test("the preview maps each profile and says what is skipped and why, writing nothing", async () => {
  preview = (await env.client.call("hermes.preview", { path: hermes })).items;
  assert.deepEqual(brief(preview), [
    "agent default hermes add ",
    "setting default personality pirate skip none",
    "note default Acme ships on Tuesdays add ",
    "note default -----BEGIN OPENSSH PRIVATE KEY----- skip secret",
    "note default The owner prefers short answers add ",
    "skill default log-triage add ",
    "routine default Morning feeds add off",
    "routine default Ping skip invalid",
    "routine default Backup skip none",
    "server default docs add ",
    "server default tracker add secret",
    "server default remote add secret",
    "setting default OPENROUTER_API_KEY skip secret",
    "setting default TELEGRAM_BOT_TOKEN skip secret",
    "setting default model acme/model-large skip none",
    "setting default provider acme-gateway skip secret",
    "setting default platform telegram skip none",
    "setting default auth.json skip secret",
    "agent work hermes-work add ",
    "note work Northwind tickets close within a day add ",
    "skill work log-triage skip same",
  ]);
  assert.equal(preview.find((i) => i.name === "tracker")?.detail, "TRACKER_API_TOKEN");
  assert.equal(preview.find((i) => i.name === "remote")?.detail, "REMOTE_AUTHORIZATION");
  const { agents } = await env.client.call("agents.list", {});
  assert.ok(!agents.some((a) => a.id.startsWith("hermes")));
});

test("importing does what the preview listed, and never copies a secret", async () => {
  const { items } = await env.client.call("hermes.import", { path: hermes });
  assert.deepEqual(items, preview);

  const hermesAgent = await env.client.call("agents.get", { agent: "hermes" });
  assert.equal(hermesAgent.agent.name, "Hermes");
  assert.equal(hermesAgent.prompt, "You are Acme's assistant. Be brief.");
  assert.equal((await env.client.call("agents.get", { agent: "hermes-work" })).agent.name, "Hermes work");

  const own = (await env.client.call("memory.list", { scope: "agent", agent: "hermes" })).memories;
  assert.deepEqual(
    own.map((m) => m.text),
    ["Acme ships on Tuesdays"],
  );
  const global = (await env.client.call("memory.list", { scope: "global" })).memories;
  assert.ok(global.some((m) => m.text === "The owner prefers short answers"));

  const skills = (await env.client.call("skills.list", {})).skills;
  assert.equal(skills.filter((s) => s.name === "log-triage").length, 1);

  const routine = (await env.client.call("routines.list", {})).routines.find((r) => r.name === "Morning feeds");
  assert.equal(routine?.enabled, false);
  assert.equal(routine?.agent_id, "hermes");
  assert.deepEqual(routine?.schedule, { kind: "cron", cron: "0 9 * * *" });
  assert.match(routine?.prompt ?? "", /Use the skills: log-triage\./);

  const servers = (await env.client.call("mcp.list", {})).servers;
  const tracker = servers.find((s) => s.name === "tracker");
  assert.deepEqual(tracker?.definition?.env, { TRACKER_API_TOKEN: "secret://TRACKER_API_TOKEN", TRACKER_REGION: "eu" });
  assert.deepEqual(tracker?.vars, [{ name: "TRACKER_API_TOKEN", set: false }]);
  assert.equal(tracker?.enabled, false);
  assert.equal(servers.find((s) => s.name === "remote")?.enabled, false);
  assert.equal(servers.find((s) => s.name === "docs")?.enabled, true);

  const stored = allText(env.home);
  for (const secret of ["not-a-real-tracker-token", "not-a-real-bearer-value", "not-a-real-openrouter-key"])
    assert.ok(!stored.includes(secret), `${secret} reached APX's home`);
  for (const secret of ["not-a-real-bot-token", "not-a-real-oauth-token", "not-a-real-provider-key", "hunter22"])
    assert.ok(!stored.includes(secret), `${secret} reached APX's home`);
});

test("importing the same folder again changes nothing", async () => {
  const count = async () => ({
    agents: (await env.client.call("agents.list", {})).agents.length,
    notes: (await env.client.call("memory.list", { limit: 500 })).memories.length,
    routines: (await env.client.call("routines.list", {})).routines.length,
    servers: (await env.client.call("mcp.list", {})).servers.length,
    skills: (await env.client.call("skills.list", {})).skills.length,
  });
  const before = await count();
  const again = (await env.client.call("hermes.preview", { path: hermes })).items;
  assert.deepEqual(
    again.filter((i) => i.action !== "skip"),
    [],
  );
  const { items } = await env.client.call("hermes.import", { path: hermes });
  assert.deepEqual(items, again);
  assert.deepEqual(await count(), before);
});

test("what changed in Hermes is updated, keeping what the owner set in APX", async () => {
  const routine = (await env.client.call("routines.list", {})).routines.find((r) => r.name === "Morning feeds");
  assert.ok(routine);
  const { id, name, agent_id, schedule, prompt } = routine;
  await env.client.call("routines.set", { id, name, agent: agent_id, schedule, prompt, enabled: true });
  write(hermes, {
    "SOUL.md": "You are Acme's assistant. Be warm.\n",
    "cron/jobs.json": JSON.stringify({
      ...JOBS,
      jobs: JOBS.jobs.map((j) => (j.id === "a1" ? { ...j, prompt: "Summarize new items twice" } : j)),
    }),
  });
  const { items } = await env.client.call("hermes.import", { path: hermes });
  assert.deepEqual(brief(items.filter((i) => i.action !== "skip")), [
    "agent default hermes update ",
    "routine default Morning feeds update ",
  ]);
  assert.equal((await env.client.call("agents.get", { agent: "hermes" })).prompt, "You are Acme's assistant. Be warm.");
  const now = (await env.client.call("routines.list", {})).routines.find((r) => r.id === routine.id);
  assert.equal(now?.enabled, true);
  assert.match(now?.prompt ?? "", /twice/);
});

test("a folder that is not a Hermes home is refused", async () => {
  await assert.rejects(env.client.call("hermes.preview", { path: dir.path }), /no Hermes setup/);
});
