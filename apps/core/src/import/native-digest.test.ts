import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message } from "@apx/protocol";
import { digestChat } from "./native-digest.ts";

const msg = (seq: number, kind: "user" | "agent", text: string): Message => ({
  id: `m${seq}`,
  thread_id: "t",
  seq,
  author: kind === "user" ? { kind: "user" } : { kind: "agent", id: "roby" },
  parts: [{ type: "text", text }],
  created_at: "2026-09-01T10:00:00.000Z",
});

test("a stretch the model cannot read leaves a gap, not a failed digest", async () => {
  // Three stretches of about 30k characters each.
  const long = "x".repeat(5000);
  const messages = Array.from({ length: 12 }, (_, i) => msg(i + 1, i % 2 ? "agent" : "user", `${i} ${long}`));
  const seen: string[] = [];
  const text = await digestChat(messages, "Reels", async (system, user) => {
    if (system.startsWith("You merge")) return `## Role\nmerged from: ${user.match(/### Stretch \d/g)?.join(", ")}`;
    const n = /stretch (\d) of/.exec(user)?.[1] ?? "";
    seen.push(n);
    if (n === "2") throw new Error("The operation was aborted due to timeout");
    return `notes ${n}`;
  });
  assert.deepEqual(seen, ["1", "3", "2"]);
  assert.match(text ?? "", /merged from: ### Stretch 1, ### Stretch 3/);
});

test("without a model there is no digest", async () => {
  assert.equal(await digestChat([msg(1, "user", "hi")], "Hi", async () => undefined), undefined);
});
