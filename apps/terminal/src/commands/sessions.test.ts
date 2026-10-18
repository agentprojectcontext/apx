import assert from "node:assert/strict";
import { test } from "node:test";
import { sessions } from "./sessions.ts";
import { printed, recordingClient } from "./testing.ts";

const project = {
  name: "Acme",
  cwd: "/work/acme",
  project_id: "prj_1",
  sessions: [{ id: "s1", thread: "thr_1", title: "Review", updated_at: "2026-01-01T12:00:00Z" }],
};
const imported = {
  project: { name: "Acme", id: "prj_1" },
  chats: [
    { thread: "thr_1", title: "New", created: true, added: 2 },
    { thread: "thr_2", title: "More", created: false, added: 3 },
    { thread: "thr_3", title: "Same", created: false, added: 0 },
  ],
  pages: ["report.html"],
  extras: {
    mcps: { added: ["acme"], existing: ["docs"], need_values: [{ name: "private", keys: ["API_KEY"] }] },
    notes: 2,
    tasks: 1,
    skipped: ["private data"],
    routines: ["Review"],
  },
};

test("session listings support both engines, mark imported chats and provide JSON without display text", async () => {
  for (const engine of ["codex", "claude"]) {
    const { client, calls } = recordingClient({ "sessions.projects": { projects: [project] } });
    const out = await printed(() => sessions(client, ["projects", engine], {}));
    assert.match(out, /Acme {2}\/work\/acme {2}\(APX project prj_1\)/);
    assert.match(out, /\* s1 {2}2026-01-01 {2}Review/);
    assert.deepEqual(calls, [["sessions.projects", { engine }]]);
    assert.deepEqual(JSON.parse(await printed(() => sessions(client, ["list", engine], { json: true }))), {
      projects: [project],
    });
  }
  const { client } = recordingClient({ "sessions.projects": { projects: [] } });
  assert.equal(await printed(() => sessions(client, ["projects", "codex"], {})), "No codex sessions on this computer.");
});

test("import resolves a name or trailing-slash folder and passes only requested sessions and project name", async () => {
  for (const which of ["acME", "/work/acme/"]) {
    const { client, calls } = recordingClient({
      "sessions.projects": { projects: [project] },
      "sessions.import": imported,
    });
    const out = await printed(() =>
      sessions(client, ["import", "codex", which], { only: " s1, s2 ,,", name: "Acme import" }),
    );
    assert.deepEqual(calls, [
      ["sessions.projects", { engine: "codex" }],
      ["sessions.import", { engine: "codex", cwd: "/work/acme", sessions: ["s1", "s2"], name: "Acme import" }],
    ]);
    for (const text of [
      "thr_1  new",
      "thr_2  +3",
      "thr_3  up to date",
      "MCP servers added",
      "already there: docs",
      "holds a credential (API_KEY)",
      "Memory notes: 2",
      "Open tasks on the board: 1",
      "Skipped: private data",
      "Routines, turned off",
      "report.html",
    ])
      assert.ok(out.includes(text), out);
  }
});

test("missing and ambiguous imports never call the import method", async () => {
  for (const projects of [[], [project, { ...project, cwd: "/work/other" }]]) {
    const { client, calls } = recordingClient({ "sessions.projects": { projects } });
    await assert.rejects(
      sessions(client, ["import", "codex", "Acme"], {}),
      /no codex project|matches .*use the folder/,
    );
    assert.deepEqual(calls, [["sessions.projects", { engine: "codex" }]]);
  }
});

test("digest, adoption and page import preserve refresh and presentation choices", async () => {
  const { client, calls } = recordingClient({
    "sessions.digest": { digest: "The Acme review" },
    "sessions.adopt": { id: "thr_1", title: "Review" },
    "surfaces.import_page": { id: "srf_1", title: "Report" },
  });
  assert.equal(await printed(() => sessions(client, ["digest", "thr_1"], { refresh: true })), "The Acme review");
  assert.equal(
    await printed(() => sessions(client, ["adopt", "thr_1", "scout"], {})),
    "Review (thr_1) is now scout's chat",
  );
  assert.match(
    await printed(() => sessions(client, ["page", "prj_1", "report.html"], { name: "report", title: "Report" })),
    /^Widget Report \(srf_1\) pinned/,
  );
  assert.deepEqual(calls, [
    ["sessions.digest", { thread: "thr_1", refresh: true }],
    ["sessions.adopt", { thread: "thr_1", agent: "scout" }],
    ["surfaces.import_page", { project_id: "prj_1", path: "report.html", name: "report", title: "Report" }],
  ]);
});

test("invalid engines and incomplete session commands fail before touching core; help stays offline", async () => {
  const { client, calls } = recordingClient({});
  for (const args of [["projects", "unknown"], ["import", "claude"], ["digest"], ["adopt", "thr_1"], ["page", "prj_1"]])
    await assert.rejects(sessions(client, args, {}), /apx sessions/);
  assert.match(await printed(() => sessions(client, [], {})), /^apx sessions projects/);
  assert.deepEqual(calls, []);
});

test("session import failure propagates without claiming imported chats", async () => {
  const error = new Error("session unreadable");
  const { client } = recordingClient({ "sessions.projects": { projects: [project] }, "sessions.import": error });
  assert.equal(
    await printed(async () => {
      await assert.rejects(sessions(client, ["import", "claude", "Acme"], {}), (e) => e === error);
    }),
    "",
  );
});
