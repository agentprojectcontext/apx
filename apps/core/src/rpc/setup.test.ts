import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { v1Schedule } from "../import/v1-setup.ts";

let env: Awaited<ReturnType<typeof startCore>>;
let repo = "";
const json = (file: string, v: unknown) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof v === "string" ? v : JSON.stringify(v));
};
const lines = (...rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n");

before(async () => {
  env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const v1 = path.join(env.home, "v1");
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "apx2-v1repo-")));
  json(path.join(repo, "AGENTS.md"), "# Acme\n");
  json(path.join(repo, ".apc", "project.json"), { name: "Acme", apx_id: "abc123def456" });
  json(path.join(repo, ".apc", "agents", "dev.md"), "---\nname: Dev\nrole: developer\n---\nYou build.\n");
  json(path.join(v1, "config.json"), { projects: [{ path: repo }, { path: "/nowhere/gone" }] });
  json(path.join(v1, "update-check.json"), { current: "1.123.1" });
  json(path.join(v1, "identity.json"), { agent_name: "Roby", owner_name: "Ana" });
  json(path.join(v1, "vars.json"), { NORTHWIND_TOKEN: "nw-secret-value" });
  json(path.join(v1, "skills", "brief", "SKILL.md"), "---\nname: brief\ndescription: A brief.\n---\nHow.\n");
  json(
    path.join(v1, "memory.md"),
    "# Self\n\n## 2026-09-01\n- [09:00][app] Ana prefers short answers\n- [10:00] Coffee at 10\n",
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
        due: "2026-10-15",
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
    { version: s.v1?.version, agent: s.v1?.agent_name, projects: s.v1?.projects },
    { version: "1.123.1", agent: "Roby", projects: 2 },
  );
  const { groups } = await env.client.call("setup.v1_scan", {});
  const count = Object.fromEntries(groups.map((g) => [g.id, g.count]));
  assert.deepEqual(count, {
    projects: 1,
    skills: 1,
    keys: 0,
    vars: 1,
    memory: 3,
    channels: 0,
    tasks: 1,
    commitments: 1,
    routines: 2,
  });
  assert.equal(groups.find((g) => g.id === "projects")?.detail, "1", "one agent in it");
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

  const notes = env.core.store.memories.list({ limit: 50 }).map((m) => [m.scope, m.text]);
  assert.ok(notes.some(([s, t]) => s === "global" && t === "Ana prefers short answers"));
  assert.ok(notes.some(([s, t]) => s === "project" && t === "Deploys go out on Fridays"));

  assert.ok(env.core.secrets.has("secret://NORTHWIND_TOKEN"));

  const routines = env.core.store.routines.list(project);
  const brief = routines.find((x) => x.name === "Morning brief");
  assert.equal(brief?.enabled, false, "v1 may still run it");
  assert.equal(brief?.action, "agent");
  assert.equal(env.core.store.agents.get(brief?.agent_id ?? "")?.slug, "dev");
  const backup = routines.find((x) => x.name === "Backup");
  assert.equal(backup?.action, "shell");
  assert.equal(backup?.pre_command, "tar czf b.tgz notes");
  assert.deepEqual(backup?.schedule, { kind: "every", minutes: 120 });

  await env.client.call("setup.finish", {});
  assert.equal((await env.client.call("setup.status", {})).done, true);
});

test("v1 schedules read as v2's", () => {
  assert.deepEqual(v1Schedule("manual"), { kind: "manual" });
  assert.deepEqual(v1Schedule("every:30s"), { kind: "every", minutes: 5 });
  assert.deepEqual(v1Schedule("cron 0 */2 * * *"), { kind: "cron", cron: "0 */2 * * *" });
  assert.deepEqual(v1Schedule("once:2026-10-05T09:00:00Z"), { kind: "once", at: "2026-10-05T09:00:00Z" });
});
