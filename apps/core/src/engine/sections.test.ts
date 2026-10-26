import assert from "node:assert/strict";
import { test } from "node:test";
import type { Origin } from "../domain/runs.ts";
import { agentsMdOf, type Sections, sectionLines, turnInput } from "./context.ts";

const owner: Origin = {
  kind: "channel",
  channel: "wa",
  conversation: "1",
  person_id: "owner",
  name: "Owner",
  role: "owner",
};
const turn = (told?: Sections) =>
  turnInput({ origin: owner, text: "hola", now: new Date(0), channel: "whatsapp", voice: true, mode: "auto", told });
const home: Sections = { mode: "auto", chats: ["whatsapp"], ownerChats: ["whatsapp"], voice: true, stickers: true };

test("what the system prompt told once, a turn names only as a datum", () => {
  const system = sectionLines(home).join("\n");
  for (const said of [
    "## Permission mode: Auto",
    "APX asks them: make the call",
    "## Phone chats (channel: whatsapp)",
    "Plain text on a phone",
    "When your owner writes on whatsapp: Their whatsapp and the app are this one chat",
    "hand the rest off",
    "When the context says voice: Your first paragraph is sent as a voice note",
    "answer only STICKER",
  ])
    assert.ok(system.includes(said), said);
  const input = turn(home);
  assert.match(input, /^\[context: [^\]]* · channel: whatsapp · mode: Auto · voice\]\n\nhola$/);
});

test("a turn whose chat's prompt did not tell a text gets it whole, so nothing is lost", () => {
  const input = turn();
  for (const block of [
    "[channel style] Plain text",
    "[channel turn] Their whatsapp",
    "[voice] Your first",
    "[mode] Auto:",
  ])
    assert.ok(input.includes(block), block);
  // A prompt told for another channel or mode does not cover this turn's.
  const other = turn({ ...home, mode: "plan", chats: ["telegram"], ownerChats: ["telegram"] });
  for (const block of ["[channel style]", "[channel turn]", "[voice]", "[mode] Auto:"])
    assert.ok(other.includes(block), block);
});

test("the sections are only those a chat's turns call for: none for a plain chat with no mode", () => {
  assert.deepEqual(sectionLines({}), []);
  assert.doesNotMatch(sectionLines({ mode: "manual" }).join("\n"), /Phone chats|computer/);
  assert.match(sectionLines({ computer: "home" }).join("\n"), /Computer: not used from Home/);
  assert.match(sectionLines({ write: "read-only" }).join("\n"), /Writes there: read-only \(nothing here may change/);
});

test("a turn opens with one context header: the facts line, then the folder and the computer", () => {
  const input = turnInput({
    origin: { kind: "user" },
    text: "hola",
    now: new Date(0),
    mode: "auto",
    told: { mode: "auto", write: "auto" },
    workspace: "Folder: ~/work/acme · writes: auto",
    computer: "Computer: off; this chat works on this Mac.",
    roster: "Agents you can delegate to:\n- Scout (id: scout)",
  });
  assert.match(
    input,
    /^\[context: [^\]]* · channel: app · mode: Auto\]\nFolder: ~\/work\/acme · writes: auto\nComputer: off; this chat works on this Mac\.\n\[agents\]\n/,
  );
  assert.doesNotMatch(input, /\[workspace\]|\[computer\]|\[mode\]/);
});

test("a project's AGENTS.md reaches the prompt whole, its last rule included", () => {
  const section = (n: number) => `## Part ${n}\n\n${"- keep components small and tested.\n".repeat(40)}`;
  const long = `# Acme\n\n${Array.from({ length: 12 }, (_, i) => section(i + 1)).join("\n")}\n29. One worktree per task.`;
  assert.ok(long.length > 15_000);
  assert.equal(agentsMdOf({ context: long }), long);
  assert.equal(agentsMdOf({}), "");
});
