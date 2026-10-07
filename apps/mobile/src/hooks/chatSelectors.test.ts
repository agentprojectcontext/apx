import assert from "node:assert/strict";
import test from "node:test";
import { translator } from "../i18n/index.ts";
import { blobEyes } from "../ui/blobEyes.ts";
import { activeThreads, chatAgents, isWorking, listedThreads, threadContext, workingNow } from "./chatSelectors.ts";
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
