import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { printed, recordingClient } from "./testing.ts";
import { mcps, projects, skills, threads } from "./threads.ts";

test("threads search joins the words into one query and prints each hit", async () => {
  const { client, calls } = recordingClient({
    "threads.search": {
      hits: [
        {
          thread_id: "thr_1",
          message_id: "msg_1",
          seq: 4,
          author: { kind: "agent", id: "april" },
          snippet: "the Acme\ninvoice",
          created_at: "2026-10-02T12:00:00.000Z",
        },
      ],
    },
  });
  const out = await printed(() => threads(client, ["search", "acme", "invoice"]));
  assert.deepEqual(calls, [["threads.search", { query: "acme invoice" }]]);
  assert.match(out, /^thr_1 .* april {6}the Acme invoice$/);
  await assert.rejects(threads(client, ["search"]), /usage: apx threads search/);
});

test("threads get shows a code thread's folder and write policy, and --json prints the whole answer", async () => {
  const got = {
    thread: { id: "thr_c", kind: "code", title: "Audit", state: "idle", cwd: "~/work/acme", write: "read-only" },
    messages: [],
    runs: [],
  };
  const { client } = recordingClient({ "threads.get": got });
  const out = await printed(() => threads(client, ["get", "thr_c"]));
  assert.equal(out, "Audit · code · idle\nFolder: ~/work/acme · writes: read-only");
  const json = JSON.parse(await printed(() => threads(client, ["get", "thr_c"], { json: true })));
  assert.equal(json.thread.write, "read-only");
  assert.equal(json.thread.cwd, "~/work/acme");
});

test("projects list says when a project's AGENTS.md is longer than what its agents get", async () => {
  const { client } = recordingClient({
    "projects.list": {
      projects: [
        { id: "p_acme", name: "Acme", present: true, agents_md_chars: 18_400 },
        { id: "p_northwind", name: "Northwind", present: true },
      ],
    },
  });
  const out = await printed(() => projects(client, ["list"]));
  assert.match(out, /AGENTS\.md has 18400 chars; agents get 12000/);
  assert.equal(out.match(/AGENTS\.md/g)?.length, 1, "only the long one");
});

test("projects rm unregisters the project and says the folder stays", async () => {
  const { client, calls } = recordingClient({ "projects.unregister": { ok: true } });
  assert.match(await printed(() => projects(client, ["rm", "p_acme"])), /folder and files were not touched/);
  assert.deepEqual(calls, [["projects.unregister", { project: "p_acme" }]]);
});

test("mcps on|off switches a server inside the project given, and needs one", async () => {
  const { client, calls } = recordingClient({ "mcp.toggle": { servers: [] } });
  assert.equal(await printed(() => mcps(client, ["off", "files"], { project: "p_acme" })), "files in p_acme: off");
  assert.deepEqual(calls, [["mcp.toggle", { project: "p_acme", server: "files", on: false }]]);
  await assert.rejects(mcps(client, ["on", "files"]), /--project <project>/);
});

const skill = (name: string, on: boolean) => ({
  name,
  description: `${name} skill`,
  scope: "global",
  source: "owner",
  on,
  off_in: [],
  off_everywhere: false,
  editable: true,
  path: `~/skills/${name}`,
  copies: [],
});

test("skills list is not a project id; on|off toggles a skill everywhere or in one project", async () => {
  const { client, calls } = recordingClient({
    "skills.list": { skills: [skill("pdf", true), skill("deploy", false)] },
    "skills.toggle": { ok: true },
  });
  const out = await printed(() => skills(client, ["list"]));
  assert.match(out, /deploy +global +off deploy skill/);
  await printed(() => skills(client, ["list", "p_acme"]));
  await printed(() => skills(client, ["p_acme"]));
  assert.equal(await printed(() => skills(client, ["off", "deploy"])), "deploy: off everywhere");
  await printed(() => skills(client, ["on", "deploy"], { project: "p_acme" }));
  assert.deepEqual(calls, [
    ["skills.list", {}],
    ["skills.list", { project: "p_acme" }],
    ["skills.list", { project: "p_acme" }],
    ["skills.toggle", { name: "deploy", on: false }],
    ["skills.toggle", { name: "deploy", on: true, project: "p_acme" }],
  ]);
});

test("projects create and set send only what was given, and a wrong kind never reaches the core", async () => {
  const project = { id: "p_nw", name: "Northwind", kind: "company", path: "/work/northwind", present: true };
  const { client, calls } = recordingClient({
    "projects.create": { project, agents: 0 },
    "projects.update": { project },
  });
  const out = await printed(() =>
    projects(client, ["create", "Northwind"], { kind: "company", desc: "Wholesale client" }),
  );
  assert.match(out, /Northwind \(p_nw\)/);
  await printed(() => projects(client, ["create", "Acme", "site"], { path: path.resolve("/work/acme") }));
  await printed(() => projects(client, ["set", "p_nw"], { desc: "" }));
  await printed(() => projects(client, ["set", "p_nw"], { autonomy: "accept_edits" }));
  await assert.rejects(projects(client, ["set", "p_nw"], { autonomy: "yolo" }), /--autonomy is one of/);
  await assert.rejects(projects(client, ["create", "X"], { kind: "shop" }), /--kind is one of/);
  await assert.rejects(projects(client, ["set", "p_nw"], {}), /usage: apx projects set/);
  assert.deepEqual(calls, [
    ["projects.create", { name: "Northwind", kind: "company", description: "Wholesale client" }],
    ["projects.create", { name: "Acme site", path: path.resolve("/work/acme") }],
    ["projects.update", { project: "p_nw", description: "" }],
    ["projects.update", { project: "p_nw", autonomy: "accept_edits" }],
  ]);
});

test("projects folders add, list and remove a read-only folder through projects.update", async () => {
  const project = { id: "p_nw", name: "Northwind", present: true, read_only_folders: [path.resolve("/work/v1")] };
  const { client, calls } = recordingClient({
    "projects.list": { projects: [project], base: { name: "Base" } },
    "projects.update": {
      project: { ...project, read_only_folders: [path.resolve("/work/v1"), path.resolve("/work/docs")] },
    },
  });
  assert.equal(await printed(() => projects(client, ["folders", "list", "p_nw"])), path.resolve("/work/v1"));
  assert.equal(
    await printed(() => projects(client, ["folders", "add", "p_nw", "/work/docs"])),
    `${path.resolve("/work/v1")}\n${path.resolve("/work/docs")}`,
  );
  await printed(() => projects(client, ["folders", "rm", "p_nw", "/work/v1"]));
  await assert.rejects(projects(client, ["folders", "rm", "p_nw", "/work/other"]), /not a read-only folder/);
  await assert.rejects(projects(client, ["folders", "add", "p_nw"]), /usage: apx projects folders/);
  assert.deepEqual(
    calls.filter(([m]) => m === "projects.update"),
    [
      [
        "projects.update",
        { project: "p_nw", read_only_folders: [path.resolve("/work/v1"), path.resolve("/work/docs")] },
      ],
      ["projects.update", { project: "p_nw", read_only_folders: [] }],
    ],
  );
});

test("skills import previews first; --yes copies the new ones, --only picks by id or name", async () => {
  const { importSource, skillsImport } = await import("./skills-import.ts");
  assert.deepEqual(importSource("git@github.com:acme/skills.git"), {
    kind: "repo",
    url: "git@github.com:acme/skills.git",
  });
  assert.deepEqual(importSource("skills", "/work"), { kind: "folder", path: path.resolve("/work/skills") });
  const candidate = (id: string, status: string) => ({
    id,
    name: id,
    description: "",
    folder: id,
    files: [{ path: "SKILL.md", bytes: 10 }],
    notes: id === "pdf" ? [{ kind: "scripts", items: ["fill.py"] }] : [],
    status,
  });
  const { client, calls } = recordingClient({
    "skills.preview": { candidates: [candidate("pdf", "new"), candidate("notes", "exists")] },
    "skills.import": { imported: [{ ...skill("pdf", true), path: "~/skills/pdf/SKILL.md" }], skipped: [] },
  });
  const look = await printed(() => skillsImport(client, "/work/pack", {}));
  assert.match(look, /pdf +pdf +new +1 files\n +scripts an agent could run: fill\.py/);
  assert.match(look, /Add --yes to import 1/);
  assert.deepEqual(
    calls.map((c) => c[0]),
    ["skills.preview"],
  );
  await printed(() => skillsImport(client, "/work/pack", { yes: true, project: "p_acme" }));
  assert.deepEqual(calls.at(-1), [
    "skills.import",
    {
      source: { kind: "folder", path: path.resolve("/work/pack") },
      target: "project",
      project: "p_acme",
      pick: ["pdf"],
      replace: false,
    },
  ]);
  await printed(() => skillsImport(client, "/work/pack", { yes: true, only: "notes", replace: true }));
  assert.deepEqual((calls.at(-1)?.[1] as { pick?: string[] } | undefined)?.pick, ["notes"]);
});
