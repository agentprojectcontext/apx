// Unit tests for Telegram sender identity resolution
// (src/core/identity/telegram.js) and the relationship block it feeds into
// the agent prompt (src/core/agent buildRelationshipBlock).
//
// The unit of identity is the person, keyed by their Telegram user_id. A
// channel's owner_user_id marks who owns that channel; unknown senders are
// recorded as role-less guests; the first private-chat sender on an
// owner-less channel is claimed as owner.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Per-test APX home so we never touch the real ~/.apx/config.json.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-tg-identity-"));
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

const {
  readConfig,
  upsertTelegramChannel,
  setContactRole,
  setRole,
  removeRole,
  listRoles,
} = await import("#core/config/index.js");
const { resolveSender, registerSender, resolveAllowedTools } = await import(
  "../src/core/identity/telegram.js"
);
const { buildRelationshipBlock } = await import("#core/agent/index.js");

function seedChannel(name, patch = {}) {
  const cfg = readConfig();
  upsertTelegramChannel(cfg, name, patch);
  return readConfig();
}

test("first private sender on an owner-less channel is claimed as owner", () => {
  seedChannel("default", { chat_id: "1" });
  const cfg = readConfig();
  const { sender, mutated } = registerSender({
    cfg,
    channelName: "default",
    from: { id: 100, first_name: "Manu" },
    chatType: "private",
  });
  assert.equal(mutated, true);
  assert.equal(sender.isOwner, true);
  assert.equal(sender.role, "owner");

  const disk = readConfig();
  assert.equal(disk.telegram.channels[0].owner_user_id, 100);
  assert.equal(disk.telegram.contacts[0].user_id, 100);
  assert.equal(disk.telegram.contacts[0].role, "owner");
});

test("a different sender after owner is claimed becomes a guest, not owner", () => {
  const cfg = readConfig();
  const { sender, mutated } = registerSender({
    cfg,
    channelName: "default",
    from: { id: 200, first_name: "Stranger", username: "rando" },
    chatType: "private",
  });
  assert.equal(mutated, true);
  assert.equal(sender.isOwner, false);
  assert.equal(sender.role, "guest");
});

test("owner is recognized again across a NEW chat (different chat_id)", () => {
  // Same user_id, no claim path (owner already set) → still resolves to owner.
  const cfg = readConfig();
  const sender = resolveSender({
    cfg,
    channelName: "default",
    from: { id: 100, first_name: "Manu (new phone)" },
    chatType: "private",
  });
  assert.equal(sender.isOwner, true);
  assert.equal(sender.role, "owner");
  // Name comes from the stored contact, not the new device's first_name.
  assert.equal(sender.name, "Manu");
});

test("owner is NOT auto-claimed in a group chat", () => {
  const cfg2 = seedChannel("grp", { chat_id: "9" });
  const { sender, mutated } = registerSender({
    cfg: cfg2,
    channelName: "grp",
    from: { id: 300, first_name: "Someone" },
    chatType: "supergroup",
  });
  assert.equal(sender.isGroup, true);
  assert.equal(sender.isOwner, false);
  // Recorded as a guest, but the channel stays owner-less.
  assert.equal(mutated, true);
  const disk = readConfig();
  const grp = disk.telegram.channels.find((c) => c.name === "grp");
  assert.equal(grp.owner_user_id, undefined);
});

test("a role assigned via config is honored on the next resolve", () => {
  const cfg = readConfig();
  setContactRole(cfg, 200, "editor");
  const sender = resolveSender({
    cfg: readConfig(),
    channelName: "default",
    from: { id: 200, username: "rando" },
    chatType: "private",
  });
  assert.equal(sender.role, "editor");
});

test("buildRelationshipBlock: owner tells the model not to ask their name", () => {
  const block = buildRelationshipBlock({
    userId: 100,
    name: "Manu",
    role: "owner",
    isOwner: true,
    isGroup: false,
  });
  assert.match(block, /your owner, Manu/);
  assert.match(block, /never ask their name/);
});

test("buildRelationshipBlock: guest gets the 'I don't know you' instruction", () => {
  const block = buildRelationshipBlock({
    userId: 200,
    name: "Stranger",
    username: "rando",
    role: "guest",
    isOwner: false,
    isGroup: false,
  });
  // Phrasing changed in the prompt refactor but the rule must still flag the
  // sender as a guest with no permissions and tell the agent to ask politely.
  assert.match(block, /guest/i);
  assert.match(block, /no permissions/i);
  assert.match(block, /politely/i);
});

test("buildRelationshipBlock: group says do not assume a single owner", () => {
  const block = buildRelationshipBlock({
    userId: 300,
    name: "Someone",
    role: "guest",
    isOwner: false,
    isGroup: true,
  });
  assert.match(block, /GROUP chat/);
  assert.match(block, /do NOT assume a single owner/);
});

test("buildRelationshipBlock returns empty string without a sender", () => {
  assert.equal(buildRelationshipBlock(null), "");
  assert.equal(buildRelationshipBlock({ userId: null }), "");
});

// ── role → tool gating (Phase C) ────────────────────────────────────────────

test("resolveAllowedTools: owner gets '*' regardless of roles map", () => {
  assert.equal(resolveAllowedTools({}, { isOwner: true, role: "owner" }), "*");
});

test("resolveAllowedTools: guest gets no tools by default", () => {
  assert.deepEqual(resolveAllowedTools({}, { isOwner: false, role: "guest" }), []);
});

test("resolveAllowedTools: a defined custom role returns its tool list", () => {
  const cfg = { telegram: { roles: { editor: { tools: ["call_agent", "list_tasks"] } } } };
  assert.deepEqual(
    resolveAllowedTools(cfg, { isOwner: false, role: "editor" }),
    ["call_agent", "list_tasks"],
  );
});

test("resolveAllowedTools: an assigned-but-undefined role fails closed (no tools)", () => {
  // A typo'd or removed role must NOT silently grant every tool. Define the
  // role in telegram.roles to grant access.
  assert.deepEqual(resolveAllowedTools({ telegram: { roles: {} } }, { role: "vip" }), []);
});

test("resolveAllowedTools: a role can be defined with '*' for all tools", () => {
  const cfg = { telegram: { roles: { admin: { tools: "*" } } } };
  assert.equal(resolveAllowedTools(cfg, { role: "admin" }), "*");
});

test("setRole persists a custom role and listRoles reads it back", () => {
  const cfg = readConfig();
  setRole(cfg, "editor", { tools: ["call_agent"] });
  const roles = listRoles(readConfig());
  assert.deepEqual(roles.editor, { tools: ["call_agent"] });
});

test("removeRole refuses to delete the built-in owner/guest roles", () => {
  assert.throws(() => removeRole(readConfig(), "owner"), /built-in/);
  assert.throws(() => removeRole(readConfig(), "guest"), /built-in/);
});

test("removeRole deletes a custom role", () => {
  const cfg = readConfig();
  setRole(cfg, "temp", { tools: [] });
  const { removed } = removeRole(readConfig(), "temp");
  assert.equal(removed, 1);
  assert.equal("temp" in listRoles(readConfig()), false);
});
