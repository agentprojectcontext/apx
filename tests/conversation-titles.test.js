// What a conversation is CALLED, and the fact that it is called the same thing
// everywhere.
//
// A conversation file is born unnamed: its id is a date and a counter
// (`2026-09-11-01`). The sidebar has always derived a name from the first thing
// the user said. The route that serves the OPEN conversation handed back raw
// frontmatter, which has no `title` until somebody renames it by hand — so the
// pane fell back to printing the id. The same chat read "te fijas que le pedí a
// roby…" in the list and "2026-09-11-01" in its own header, two inches apart.
//
// One question, one answer: `conversationTitle`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-titles-home-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const {
  startConversation, appendTurn, listConversations, readConversation,
  setConversationMeta, conversationTitle,
} = await import("#core/stores/conversations.js");

function seed({ id = "2026-09-11-01", first = "te fijas que le pedí a roby lo de knot?" } = {}) {
  const storagePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "apx-titles-")), "storage");
  const started = startConversation({
    storagePath, agentSlug: "ansel", engine: "mock", channel: "web", id,
  });
  appendTurn({ filePath: started.path, role: "user", content: first });
  appendTurn({ filePath: started.path, role: "assistant", content: "Lo miro." });
  return { storagePath, id };
}

/** The same three arguments the daemon route reads a conversation with. */
const open = (storagePath, id) => readConversation(storagePath, "ansel", id);

test("an unnamed conversation is named after the first thing said", () => {
  const { storagePath, id } = seed();
  const conv = open(storagePath, id);
  assert.equal(conversationTitle(conv.fm, conv.turns), "te fijas que le pedí a roby lo de knot?");
  // And the list agrees, because it is the same function.
  const [row] = listConversations(storagePath, "ansel");
  assert.equal(row.title, "te fijas que le pedí a roby lo de knot?");
});

test("the list and the open conversation cannot disagree", () => {
  // The whole bug: two derivations, one of them missing. Asserted as an
  // equality rather than two separate expectations, because what went wrong was
  // never the value — it was that there were two of them.
  const { storagePath, id } = seed({ first: "arrancamos con el brief de carwash" });
  const conv = open(storagePath, id);
  const [row] = listConversations(storagePath, "ansel");
  assert.equal(conversationTitle(conv.fm, conv.turns), row.title);
  assert.ok(row.title && row.title !== row.id, "and it is a name, not the id");
});

test("a name the reader typed always wins", () => {
  const { storagePath, id } = seed();
  setConversationMeta(storagePath, "ansel", id, { title: "Knot: alta con CUIT duplicado" });
  const conv = open(storagePath, id);
  assert.equal(conversationTitle(conv.fm, conv.turns), "Knot: alta con CUIT duplicado");
  assert.equal(listConversations(storagePath, "ansel")[0].title, "Knot: alta con CUIT duplicado");
});

test("only the first LINE, capped, so a pasted wall of text is not the name", () => {
  const long = "revisá esto\nsegunda línea que no va en el título";
  const { storagePath, id } = seed({ first: long });
  const conv = open(storagePath, id);
  assert.equal(conversationTitle(conv.fm, conv.turns), "revisá esto");

  const wall = "x".repeat(200);
  const two = seed({ first: wall, id: "2026-09-11-02" });
  const c2 = open(two.storagePath, two.id);
  assert.equal(conversationTitle(c2.fm, c2.turns).length, 80);
});

test("a conversation with nothing said yet has no name to show", () => {
  // It must come back undefined rather than "" — the surfaces fall through to
  // the id, and an empty string is a name that renders as a blank header.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-titles-"));
  const storagePath = path.join(dir, "storage");
  startConversation({
    storagePath, agentSlug: "ansel", engine: "mock", channel: "web", id: "2026-09-11-03",
  });
  const conv = open(storagePath, "2026-09-11-03");
  assert.equal(conversationTitle(conv.fm, conv.turns), undefined);
});
