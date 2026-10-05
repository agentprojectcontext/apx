import assert from "node:assert/strict";
import test from "node:test";
import { blobEyes } from "../ui/blobEyes.ts";
import { activeThreads, chatAgents, isWorking, listedThreads } from "./chatSelectors.ts";
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
