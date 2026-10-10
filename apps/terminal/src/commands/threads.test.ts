import assert from "node:assert/strict";
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
