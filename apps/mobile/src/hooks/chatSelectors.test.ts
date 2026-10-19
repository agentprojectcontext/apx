import assert from "node:assert/strict";
import test from "node:test";
import { translator } from "../i18n/index.ts";
import { blobEyes } from "../ui/blobEyes.ts";
import {
  activeThreads,
  bundleTasks,
  chatAgents,
  chatPreview,
  chatTitle,
  inboxThreads,
  isWorking,
  listedThreads,
  pickAgents,
  stateMark,
  threadContext,
  workingNow,
  workSubject,
} from "./chatSelectors.ts";
import type { Agent, Thread } from "./useWorkspace";

const thread = (id: string, extra: Partial<Thread> = {}): Thread => ({
  id,
  kind: "loose",
  title: id,
  agent_ids: [],
  state: "idle",
  preview: "",
  unread: 0,
  updated_at: "2026-01-01T00:00:00Z",
  ...extra,
});

test("active work includes submitted, streaming, waiting and nested task conversations", () => {
  const threads = [
    thread("idle"),
    thread("working", { state: "working" }),
    thread("archived-working", { state: "working", archived: true }),
    thread("archived-waiting", { state: "input-required", archived: true }),
    thread("nested", { state: "submitted", kind: "task", parent_id: "working", updated_at: "2026-01-02T00:00:00Z" }),
    thread("waiting", { state: "input-required" }),
    thread("done", { state: "completed" }),
  ];
  assert.deepEqual(
    activeThreads(threads).map((item) => item.id),
    ["nested", "working", "waiting"],
  );
  assert.equal(isWorking("input-required"), false);
  assert.equal(isWorking("submitted"), true);
});

test("chat list hides task, routine, archived and nested history while keeping pinned chats first", () => {
  const threads = [
    thread("recent", { updated_at: "2026-01-03T00:00:00Z" }),
    thread("pinned", { pinned: true }),
    thread("task", { kind: "task" }),
    thread("routine", { kind: "routine" }),
    thread("nested", { parent_id: "recent" }),
    thread("archived", { archived: true }),
  ];
  assert.deepEqual(
    listedThreads(threads).map((item) => item.id),
    ["pinned", "recent"],
  );
  assert.equal(threads[0]?.id, "recent");
});

test("agent picker follows web project boundaries and preserves all matching agents", () => {
  const agents: Agent[] = [
    { id: "secretary", name: "Office", kind: "secretary" },
    { id: "base", name: "Base", kind: "agent" },
    ...Array.from({ length: 8 }, (_, index) => ({
      id: `a${index}`,
      name: `Agent ${index}`,
      kind: "agent" as const,
      project_id: "project",
    })),
    { id: "other", name: "Other", kind: "agent", project_id: "other" },
  ];
  assert.deepEqual(
    chatAgents(agents).map((item) => item.id),
    ["secretary", "base"],
  );
  const project = chatAgents(agents, "project");
  assert.equal(project.length, 9);
  assert.equal(project[0]?.id, "secretary");
  assert.equal(
    project.some((item) => item.id === "other"),
    false,
  );
});

test("native blob overlays include Roby's face and valid shared canvas geometry", () => {
  assert.equal(Object.keys(blobEyes).length, 35);
  assert.equal(blobEyes.noche?.eyes.length, 2);
  for (const face of Object.values(blobEyes))
    for (const eye of face.eyes) {
      assert.ok(eye.w > 0 && eye.h > 0);
      assert.ok(eye.x >= 0 && eye.y >= 0 && eye.x + eye.w <= 256 && eye.y + eye.h <= 256);
    }
});

test("a chat's context names its project and where it happens", () => {
  const data = {
    projects: [{ id: "p1", name: "Acme" }],
    channels: [{ id: "tg-main", type: "telegram", label: "Main bot", enabled: true, agent_id: "a" }],
  };
  const tr = translator("es");
  assert.equal(threadContext(thread("a", { agent_ids: ["x"] }), data, tr), "Default · Web");
  assert.equal(
    threadContext(thread("b", { project_id: "p1", channel: { id: "tg-main", conversation: "1" } }), data, tr),
    "Acme · Telegram",
  );
  assert.equal(threadContext(thread("c", { project_id: "p1", engine: "claude" }), data, tr), "Acme · Claude Code");
  assert.equal(threadContext(thread("d", { agent_ids: ["x", "y", "z"] }), data, tr), "Default · Grupo · 3 agentes");
});

test("work going on now pairs each active chat with its running agent job", () => {
  const job = (id: string, thread_id: string, kind: "agent" | "terminal" = "agent") => ({
    id,
    kind,
    title: id,
    state: "working",
    thread_id,
    started_at: "2026-01-01T00:00:00Z",
  });
  const now = workingNow(
    [thread("w", { state: "working" }), thread("q", { state: "input-required" }), thread("i")],
    [job("t1", "w", "terminal"), job("j1", "w"), job("j2", "other")],
  );
  assert.deepEqual(
    now.map((item) => [item.thread.id, item.job?.id]),
    [
      ["w", "j1"],
      ["q", undefined],
    ],
  );
});

test("new chat offers every project's agents, the recent ones apart, and searches names, roles and projects", () => {
  const agents: Agent[] = [
    { id: "roby", name: "Roby", kind: "secretary" },
    { id: "base", name: "Base", kind: "agent" },
    { id: "ansel", name: "Ansel", kind: "agent", role: "Lead orchestrator", project_id: "p_acme" },
    { id: "golf", name: "Coach", kind: "agent", project_id: "p_northwind" },
  ];
  const threads = [
    thread("t1", { agent_ids: ["golf"], project_id: "p_northwind", updated_at: "2026-10-12T10:00:00Z" }),
    thread("t2", { agent_ids: ["golf"], updated_at: "2026-10-12T09:00:00Z" }),
    thread("t3", { agent_ids: ["roby"], engine: "codex", updated_at: "2026-10-12T11:00:00Z" }),
  ];
  const projectName = (id: string) => ({ p_acme: "Acme", p_northwind: "Northwind" })[id] ?? id;
  const all = pickAgents(agents, threads, { query: "", projectName });
  assert.deepEqual(
    all.recent.map((a) => a.id),
    ["golf"],
    "a session with an outside engine is not the agent's",
  );
  assert.deepEqual(
    all.rest.map((a) => a.id),
    ["roby", "base", "ansel"],
  );
  assert.deepEqual(
    pickAgents(agents, threads, { query: "ácme", projectName }).rest.map((a) => a.id),
    ["ansel"],
  );
  assert.deepEqual(
    pickAgents(agents, threads, { query: "lead", projectName }).rest.map((a) => a.id),
    ["ansel"],
  );
  const inProject = pickAgents(agents, threads, { projectId: "p_acme", query: "", projectName });
  assert.deepEqual(
    [...inProject.recent, ...inProject.rest].map((a) => a.id),
    ["roby", "ansel"],
  );
});

test("routine runs that told something are listed when the owner wants them; quiet or running ones never", () => {
  const threads = [
    thread("a", { updated_at: "2026-10-12T08:00:00Z" }),
    thread("told", {
      kind: "routine",
      title: "Morning tip · 10/12/26",
      preview: "**Grip**: hold it light. Then swing.\nSee you tomorrow",
      updated_at: "2026-10-12T10:00:00Z",
    }),
    thread("quiet", { kind: "routine", archived: true }),
    thread("running", { kind: "routine", state: "working" }),
  ];
  assert.deepEqual(
    inboxThreads(threads, false).map((t) => t.id),
    ["a"],
  );
  assert.deepEqual(
    inboxThreads(threads, true).map((t) => t.id),
    ["told", "a"],
  );
  const told = threads[1] as Thread;
  assert.equal(chatTitle(told), "Grip: hold it light.");
  assert.equal(chatPreview(told), "Then swing. See you tomorrow");
  const short = thread("short", { kind: "routine", title: "Watch · 10/12/26", preview: "Nothing **new**" });
  assert.equal(chatTitle(short), "Watch");
  assert.equal(chatPreview(short), "Nothing new");
  const tr = translator("en");
  assert.equal(threadContext(told, { projects: [], channels: [] }, tr), "Default · Routine · Morning tip");
});

test("a working chat says what it is about under its agent's name, never that name twice", () => {
  const data = { projects: [{ id: "p1", name: "Acme" }], channels: [] };
  const tr = translator("es");
  assert.equal(workSubject(thread("a", { title: "Open source launch" }), "Abril", data, tr), "Open source launch");
  assert.equal(workSubject(thread("b", { title: "Abril", project_id: "p1" }), "Abril", data, tr), "Acme · Web");
  assert.equal(workSubject(thread("c", { title: "" }), "Abril", data, tr), "Default · Web");
});

test("a task's chats are one row of the list, where its most recent one is", () => {
  const entries = bundleTasks([
    thread("a"),
    thread("b", { task_id: "task_1" }),
    thread("c"),
    thread("d", { task_id: "task_1", agent_ids: ["vera"] }),
  ]);
  assert.deepEqual(
    entries.map((e) => (e.kind === "thread" ? e.thread.id : `${e.taskId}:${e.threads.map((t) => t.id).join(",")}`)),
    ["a", "task_1:b,d", "c"],
  );
});

test("a queued delegation is marked queued, never in progress or done, and says so in both languages", () => {
  assert.equal(stateMark("queued"), "queued");
  assert.equal(stateMark("submitted"), "working");
  assert.equal(stateMark("working"), "working");
  assert.equal(stateMark("completed"), "done");
  assert.equal(stateMark("canceled"), "done");
  assert.equal(stateMark("failed"), "failed");
  assert.equal(stateMark(undefined), "done");
  assert.equal(translator("en")("queued"), "Queued");
  assert.equal(translator("es")("queued"), "En cola");
});
