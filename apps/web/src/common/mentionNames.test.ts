import assert from "node:assert/strict";
import { test } from "node:test";
import type { Agent } from "@apx/protocol";
import { namedMentions, namedTitle } from "./mentionNames.ts";

const agent = (id: string, name: string, slug?: string) =>
  ({ id, name, slug, role: "", kind: "agent", browser_profile: "shared", source: "apc" }) as Agent;
const agents = {
  "a1b2c3d4e5f6-security": agent("a1b2c3d4e5f6-security", "Alma", "security"),
  bruno: agent("bruno", "Bruno"),
};

test("a mention by id reads as the agent's name", () => {
  assert.equal(namedMentions("ask @a1b2c3d4e5f6-security and @bruno", agents), "ask @Alma and @Bruno");
});

test("a mention by a unique slug reads as the name; unknown ones and emails stay", () => {
  assert.equal(
    namedMentions("@security look; @nobody; user@example.com", agents),
    "@Alma look; @nobody; user@example.com",
  );
});

test("the addressee's leading mention goes: the row already names them", () => {
  assert.equal(namedMentions("@a1b2c3d4e5f6-security Final review", agents, "a1b2c3d4e5f6-security"), "Final review");
  assert.equal(namedMentions("@bruno Final review", agents, "a1b2c3d4e5f6-security"), "@Bruno Final review");
});

test("a conversation's title keeps who asked whom and names the request's mentions", () => {
  assert.equal(
    namedTitle("Ramiro → Alma: @a1b2c3d4e5f6-security Final review of @bruno", agents, "a1b2c3d4e5f6-security"),
    "Ramiro → Alma: Final review of @Bruno",
  );
  assert.equal(namedTitle("Plain title", agents), "Plain title");
});
