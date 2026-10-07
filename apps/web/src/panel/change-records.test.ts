import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message, Part } from "@apx/protocol";
import { recordedChanges } from "./change-records.ts";

const change = (file: string, diff = "", edits = true): Part => ({
  type: "changes",
  cwd: "/work",
  edits,
  files: [{ path: file, status: "M", diff }],
});
const message = (id: string, parts: Part[], thread = "visible"): Message => ({
  id,
  thread_id: thread,
  seq: 1,
  author: { kind: "agent", id: "roby" },
  parts,
  created_at: "",
});

test("latest selects the last editing turn, omitting unrelated chats and duplicate git summaries", () => {
  const messages = [
    message("old", [change("Old.md")]),
    message("new", [change("New.md", "patch"), change("Unrelated.md", "", false)]),
    message("other", [change("Hidden.md")], "background"),
    message("chat", [{ type: "text", text: "Done" }]),
  ];
  const rows = recordedChanges(messages, "visible", "latest");
  assert.deepEqual(
    rows.map((row) => [row.file.path, row.message, row.part]),
    [["New.md", "new", 0]],
  );
  assert.equal(rows[0]?.file.diff, "patch");
});

test("all turns flatten into one row per folder and path, with its latest edit and source index", () => {
  const messages = [
    message("first", [change("A.md", "first"), change("B.md")]),
    message("second", [{ type: "text", text: "Done" }, change("A.md", "latest")]),
  ];
  const rows = recordedChanges(messages, "visible", "all");
  assert.deepEqual(
    rows.map((row) => [row.file.path, row.message, row.part]),
    [
      ["A.md", "second", 1],
      ["B.md", "first", 1],
    ],
  );
  assert.equal(rows[0]?.file.diff, "latest");
  const updated = messages.map((m) => (m.id === "second" ? { ...m, parts: [change("A.md", "live revision")] } : m));
  assert.equal(recordedChanges(updated, "visible", "all")[0]?.file.diff, "live revision");
});
