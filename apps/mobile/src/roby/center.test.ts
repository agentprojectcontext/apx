import assert from "node:assert/strict";
import { test } from "node:test";
import type { Thread } from "../hooks/useWorkspace";
import { centerMode, isOwnChat, voiceNoteTarget } from "./center.ts";

const chat = (id: string, extra: Partial<Thread> = {}): Thread => ({
  id,
  kind: "loose",
  title: id,
  agent_ids: ["boss"],
  state: "idle",
  preview: "",
  unread: 0,
  updated_at: "2026-11-01T10:00:00Z",
  ...extra,
});

test("the button calls only when the phone has its voice and the computer says calls are ready", () => {
  assert.equal(centerMode({ nativeVoice: true, callsReady: true }), "call");
  assert.equal(centerMode({ nativeVoice: true, callsReady: false }), "record");
  // Not known yet: recording works either way, so it does not offer a call that may fail.
  assert.equal(centerMode({ nativeVoice: true, callsReady: undefined }), "record");
  assert.equal(centerMode({ nativeVoice: false, callsReady: true }), "record");
});

test("a voice note goes to the pinned chat with the super-agent before any other", () => {
  const threads = [
    chat("recent", { updated_at: "2026-11-03T10:00:00Z" }),
    chat("pinned", { pinned: true, updated_at: "2026-10-01T10:00:00Z" }),
    chat("opened", { updated_at: "2026-11-02T10:00:00Z" }),
  ];
  assert.equal(voiceNoteTarget(threads, "boss", "opened")?.id, "pinned");
});

test("without a pinned chat it goes to the last one opened, else the latest", () => {
  const threads = [
    chat("older", { updated_at: "2026-11-01T10:00:00Z" }),
    chat("recent", { updated_at: "2026-11-03T10:00:00Z" }),
  ];
  assert.equal(voiceNoteTarget(threads, "boss", "older")?.id, "older");
  assert.equal(voiceNoteTarget(threads, "boss", "gone")?.id, "recent");
  assert.equal(voiceNoteTarget(threads, "boss")?.id, "recent");
});

test("contacts, sessions, routine runs, tasks, archived chats and other agents' chats are never the target", () => {
  const threads = [
    chat("contact", { pinned: true, channel: { id: "wa", conversation: "c" } }),
    chat("session", { pinned: true, engine: "claude" }),
    chat("run", { pinned: true, kind: "routine", routine_id: "r" }),
    chat("task", { pinned: true, task_id: "t" }),
    chat("archived", { pinned: true, archived: true }),
    chat("scout", { pinned: true, agent_ids: ["scout"] }),
  ];
  for (const thread of threads) assert.equal(isOwnChat(thread, "boss"), false, thread.id);
  assert.equal(voiceNoteTarget(threads, "boss", "contact"), undefined);
  assert.equal(voiceNoteTarget([...threads, chat("mine")], "boss", "contact")?.id, "mine");
});
