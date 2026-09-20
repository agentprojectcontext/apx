// A GROUP CHAT CALLS PEOPLE BY THEIR NAME.
//
// The room's identity is the slug — a mention only reaches an agent if it
// carries the exact `@slug`, the ledger files every turn under it, and the
// roster is a list of them. None of that is a reason to PRINT one. On
// 2026-09-20 the phone showed a bubble headed `romi` with the tag beside it
// reading "traído por Productor Reels": the same kind of thing, on the same
// line, spelled as an address and as a name at once.
//
// Two halves, both here because they are one bug: the thread row (title and
// preview, written in core) and the transcript (speaker header and @mentions,
// rendered in the panel).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-group-name-home-"));
process.env.HOME = TMP_HOME;
process.env.USERPROFILE = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const {
  appendMessageToFs,
  createGroupThread,
  appendGroupOwnerMessage,
  appendGroupAgentMessage,
  listProjectGroupThreads,
  readProjectGroupThread,
} = await import("#core/stores/messages.js");
const { createAgent } = await import("#core/apc/agent-write.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

function seedRoom() {
  const root = makeTempProject({ name: "reels" });
  const project = { id: "grp", path: root };
  createAgent(project, { slug: "romi", system: "x", name: "Romi" });
  createAgent(project, { slug: "productor-reels", system: "x", name: "Frida", role: "Productor de reels" });
  const logMessage = (row) => appendMessageToFs({ projectRoot: root, ...row });
  const gid = createGroupThread(logMessage, { participants: ["romi", "productor-reels"] });
  appendGroupOwnerMessage(logMessage, gid, "arranquen");
  appendGroupAgentMessage(logMessage, gid, { slug: "romi", body: "dale" });
  return { root, gid };
}

test("a group with no title is named after the people in it", () => {
  const { root, gid } = seedRoom();
  try {
    assert.equal(listProjectGroupThreads(root)[0].title, "Romi · Frida");
    assert.equal(readProjectGroupThread(root, gid).title, "Romi · Frida");
  } finally {
    cleanupTempProject(root);
  }
});

test("the roster it hands back is still slugs — that is the address", () => {
  const { root, gid } = seedRoom();
  try {
    assert.deepEqual(readProjectGroupThread(root, gid).participants, ["romi", "productor-reels"]);
    // And the turn keeps pointing at the slug, so the panel can resolve the
    // face, the mention and the "traído por" tag against the roster.
    const last = readProjectGroupThread(root, gid).messages.at(-1);
    assert.equal(last.agent, "romi");
  } finally {
    cleanupTempProject(root);
  }
});

test("the list preview says who spoke, by name", () => {
  const { root } = seedRoom();
  try {
    assert.match(listProjectGroupThreads(root)[0].preview, /^Romi: dale/);
  } finally {
    cleanupTempProject(root);
  }
});

test("an agent the project no longer has keeps printing what the ledger holds", () => {
  const root = makeTempProject({ name: "ghost" });
  try {
    const logMessage = (row) => appendMessageToFs({ projectRoot: root, ...row });
    const gid = createGroupThread(logMessage, { participants: ["gone"] });
    appendGroupAgentMessage(logMessage, gid, { slug: "gone", body: "adiós" });
    assert.equal(readProjectGroupThread(root, gid).title, "gone");
  } finally {
    cleanupTempProject(root);
  }
});

// ── The transcript, in the panel ────────────────────────────────────────────

test("the speaker header is resolved through the roster, not read off the row", () => {
  const src = read("src/interfaces/web/src/components/chat/MessageBubble.tsx");
  assert.match(src, /const fromRoster = nameOf \? nameOf\(speakerId\) : "";/);
  assert.match(src, /<span className="font-semibold text-foreground\/90">\{speakerName\}<\/span>/);
  assert.doesNotMatch(
    src,
    /<span className="font-semibold text-foreground\/90">\{msg\.agent\}<\/span>/,
    "msg.agent is the ledger's author — for a group turn that is the slug",
  );
});

test("on the phone the speaker wears a mini face, where the avatar column is gone", () => {
  const src = read("src/interfaces/web/src/components/chat/MessageBubble.tsx");
  assert.match(src, /\{compact && \(face\s*\n?\s*\? <AgentAvatar \{\.\.\.face\} size=\{16\} \/>/);
});

test("an @mention prints the name and keeps the handle a hover away", () => {
  const src = read("src/interfaces/web/src/components/files/MarkdownPreview.tsx");
  assert.match(src, /export function MentionChip\(\{ handle, nameOf \}/);
  assert.match(src, /\{resolved \? `@\$\{name\}` : handle\}/);
  // Unresolved stays verbatim: a person, another project's agent, or a word
  // that merely starts with an @.
  assert.match(src, /const resolved = name && name !== slug;/);
});

test("the bubble hands its resolver to the text it renders", () => {
  const src = read("src/interfaces/web/src/components/chat/MessageBubble.tsx");
  assert.match(src, /renderMentions\(shown, nameOf\)/);
  assert.match(src, /nameOf=\{nameOf\}/);
});
