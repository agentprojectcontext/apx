import assert from "node:assert/strict";
import { test } from "node:test";
import { type Message, Thread } from "@apx/protocol";
import { isRoom, ownerOnChannel } from "./room.ts";

const at = "2026-01-01T00:00:00Z";
const home = Thread.parse({
  id: "home",
  title: "Home",
  kind: "home",
  state: "idle",
  agent_ids: ["roby"],
  created_at: at,
  updated_at: at,
});
const said = (seq: number, author: Message["author"]): Message => ({
  id: `msg_${seq}`,
  seq,
  thread_id: "home",
  author,
  parts: [{ type: "text", text: "Hello" }],
  created_at: at,
});

test("the owner's words relayed from a channel keep Home a one-to-one chat", () => {
  const relayed = said(2, { kind: "person", id: "owner", name: "Owner", channel: "discord" });
  assert.equal(ownerOnChannel(relayed), true);
  assert.equal(isRoom(home, [said(1, { kind: "user" }), relayed, said(3, { kind: "agent", id: "roby" })]), false);
});

test("someone else's words make it a room", () => {
  const other = said(2, { kind: "person", id: "per_acme", name: "Northwind", channel: "discord" });
  assert.equal(ownerOnChannel(other), false);
  assert.equal(isRoom(home, [said(1, { kind: "user" }), other]), true);
});
