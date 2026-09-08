// The WhatsApp channel prompts, and the line between them.
//
// Three generations of contract live behind this file, and the scars are why
// each assertion is here:
//
// 1. The channel had no prompt file at all (until 2026-08-29): the turn read as
//    if the owner had written, so a contact was answered politely and the owner
//    never heard that anyone had written.
// 2. The prompt then told it to ANSWER the sender in the turn — so it did,
//    instantly, from an Android notification already collapsed into "7 mensajes
//    nuevos". It was replying to text that was not the message, through a path
//    that delivered nothing by itself.
// 3. 2026-09-08: WhatsApp became a real channel with a real session, so the
//    transport stopped being a notification bridge and the alert contract went
//    with it. What replaced it is a SPLIT — the owner's line and everybody
//    else's are two different prompts, and the whole safety story is that the
//    second one cannot be handed the first one's contents.
//
// The third-party half is pinned in third-party-prompt.test.js (the containment
// proof). This file pins the two blocks themselves and the fact that they stay
// distinct.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildChannelContextBlock, buildSuperAgentSystem, buildThirdPartySystem } from "#core/agent/prompt-builder.js";
import { CHANNELS } from "#core/constants/channels.js";
import { TOOLS } from "#core/agent/tools/names.js";

const META = { projectId: "0", projectName: "acme", projectPath: "/path/to/acme" };

test("the whatsapp channel has a context block, and it is reached by name", () => {
  const block = buildChannelContextBlock(CHANNELS.WHATSAPP, META);
  assert.ok(block.length > 200, "an empty block is the bug this test exists for");
  assert.match(block, /whatsapp/i);
  // Rendered, not left as a template: `{{projectName}}` reaching a model is a
  // prompt that leaked its own scaffolding.
  assert.match(block, /acme/);
  assert.doesNotMatch(block, /\{\{/);
});

test("the owner's block says this line is the owner's, and that other people are elsewhere", () => {
  const block = buildChannelContextBlock(CHANNELS.WHATSAPP, META);
  // The owner turn must not believe it can see, or answer, a stranger's thread:
  // that conversation runs sealed, in another turn, with another prompt.
  assert.match(block, /paired this session is your owner/i);
  assert.match(block, /sealed turn/i);
  assert.match(block, /cannot see it/i);
});

test("it says how to write on a phone, because WhatsApp renders no markdown", () => {
  const block = buildChannelContextBlock(CHANNELS.WHATSAPP, META);
  assert.match(block, /no markdown/i);
  assert.match(block, /literal characters/i);
  assert.match(block, /one message per turn/i);
});

test("it names what can and cannot be perceived", () => {
  const block = buildChannelContextBlock(CHANNELS.WHATSAPP, META);
  for (const marker of [/\[audio\]/, /\[sticker/, /gif/i, /photo|pixels/i]) {
    assert.match(block, marker);
  }
  // The one refusal. An agent that guesses a video's contents from its caption
  // is worse than one that says it cannot watch it.
  assert.match(block, /cannot watch|can't watch/i);
});

test("it names the tool that reaches another person, and says it is irreversible", () => {
  const block = buildChannelContextBlock(CHANNELS.WHATSAPP, META);
  assert.match(block, new RegExp(TOOLS.SEND_WHATSAPP));
  assert.match(block, /no undo/i);
  // Answering the owner is not a tool call — the turn already goes to them.
  // Without this the model reaches for send_whatsapp to reply to its own owner.
  assert.match(block, /just write your reply/i);
});

test("a whatsapp turn carries the block through the assembled system prompt", () => {
  const system = buildSuperAgentSystem({
    globalConfig: { super_agent: { enabled: true, model: "mock:m" } },
    projects: { list: () => [] },
    listSkills: () => [],
    channel: CHANNELS.WHATSAPP,
    channelMeta: META,
  });
  assert.match(system, /Channel: \*\*whatsapp\*\*/);
  assert.doesNotMatch(system, /\{\{/);
});

test("the owner's block and the stranger's block are not the same file", () => {
  // The failure this guards is a fallback: a third-party turn quietly rendering
  // the owner-facing file, which interpolates the project id, name and PATH.
  const owner = buildChannelContextBlock(CHANNELS.WHATSAPP, META);
  const guest = buildThirdPartySystem({
    globalConfig: { user: { language: "es" } },
    channel: CHANNELS.WHATSAPP,
    channelMeta: META,
  });
  assert.notEqual(owner, guest);
  assert.ok(!guest.includes("/path/to/acme"), "the stranger's prompt must not carry the project path");
  assert.ok(!guest.includes("acme"), "nor its name");
  assert.match(guest, /whatsapp/i, "…but it is still a WhatsApp prompt");
});
