// The panel's half of forwarding: which sessions may receive a message, and
// the two places the reader is told what is going on.
//
// Asserting on the front end from the backend suite is the established pattern
// here (web-guardrails, web-composer, chat-turn-shape and a dozen more read the
// same sources) — the panel is a separate pnpm workspace whose gate is a TYPE
// checker, and none of what is checked below is a type.
//
// The rule about WHO may receive a forward is real logic, so it is loaded and
// run rather than grepped. The two wiring checks are greps, because what they
// guard is an ordering: a send into a Telegram thread must be intercepted
// BEFORE it reaches the ordinary path, and that is a fact about source order
// that no unit test of a pure function can see.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const WEB_SRC = path.join(__dirname, "..", "src", "interfaces", "web", "src");
const read = (...p) => fs.readFileSync(path.join(WEB_SRC, ...p), "utf8");

function loadPanelModule(relPath) {
  const built = buildSync({
    entryPoints: [path.join(WEB_SRC, relPath)],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
    // Vite resolves an imported image to a URL; esbuild has no opinion unless
    // told. Nothing under test here draws one, so they resolve to nothing —
    // without this, reaching a module that transitively imports an avatar is a
    // build error about a .webp.
    loader: { ".webp": "empty", ".png": "empty", ".svg": "empty", ".jpg": "empty" },
    logLevel: "silent",
  });
  const mod = { exports: {} };
  new Function("module", "exports", "require", built.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}

const TODAY = "2026-09-18";
const row = (over = {}) => ({
  channel: "web",
  key: { kind: "thread", channel: "web", threadId: TODAY },
  ...over,
});

test("a forward is never offered into a conversation it cannot land in", () => {
  const { canReceiveForward } = loadPanelModule("lib/forwarded.ts");
  const opts = { surface: "web", today: TODAY };

  // The honest default: today's web thread, and any of an agent's own files.
  assert.equal(canReceiveForward(row(), undefined, opts), true);
  assert.equal(
    canReceiveForward({ channel: "web", key: { kind: "conv", agentSlug: "northwind", convId: "2026-01-02-01" } }, undefined, opts),
    true,
    "a conversation file is appended to by id — its date is nobody's business",
  );

  // Delivered somewhere else: the message is on a phone, in an app, and a turn
  // written here would go out on `web` instead.
  for (const channel of ["telegram", "whatsapp"]) {
    assert.equal(
      canReceiveForward(row({ channel, key: { kind: "thread", channel, threadId: TODAY } }), undefined, opts),
      false,
      `${channel} threads cannot be written back into`,
    );
  }
  // Transcripts and rooms.
  assert.equal(canReceiveForward(row({ channel: "a2a", key: { kind: "thread", channel: "a2a", threadId: "andy~claude" } }), undefined, opts), false);
  assert.equal(canReceiveForward(row({ channel: "group", key: { kind: "thread", channel: "group", threadId: "g1" } }), undefined, opts), false);
  // Put away on purpose.
  assert.equal(canReceiveForward(row({ archived: true }), undefined, opts), false);
});

test("a super-agent thread can only be continued where it is being written", () => {
  const { canReceiveForward } = loadPanelModule("lib/forwarded.ts");
  const opts = { surface: "web", today: TODAY };
  // Yesterday. The turn would be written into TODAY's file while the pane shows
  // yesterday's — shown in one thread, recorded in another.
  assert.equal(
    canReceiveForward(row({ key: { kind: "thread", channel: "web", threadId: "2026-09-17" } }), undefined, opts),
    false,
  );
  // Another surface. Same story, one file over.
  assert.equal(
    canReceiveForward(row({ channel: "desktop", key: { kind: "thread", channel: "desktop", threadId: TODAY } }), undefined, opts),
    false,
  );
});

test("a message is not offered a forward into the conversation it is already in", () => {
  const { canReceiveForward } = loadPanelModule("lib/forwarded.ts");
  const opts = { surface: "web", today: TODAY };
  const here = { kind: "thread", channel: "web", threadId: TODAY };
  assert.equal(canReceiveForward(row({ key: here }), here, opts), false);
  assert.equal(
    canReceiveForward(row({ key: here }), { kind: "thread", channel: "web", threadId: "2026-09-17" }, opts),
    true,
    "a different day of the same channel is a different conversation",
  );

  const conv = { kind: "conv", agentSlug: "northwind", convId: "2026-01-02-01" };
  assert.equal(canReceiveForward({ channel: "web", key: conv }, conv, opts), false);
  assert.equal(
    canReceiveForward({ channel: "web", key: { ...conv, agentSlug: "acme" } }, conv, opts),
    true,
    "two agents can each own a file with the same id",
  );
});

const SUPER = { slug: "__super_agent__", name: "Roby", icon: "noche" };
const HERE = [
  { slug: "northwind-bot", name: "Northwind" },
  { slug: "acme-bot", name: "Acme" },
];
const DIRECTORY = [
  // The current project's own agents come back in the directory too — the
  // picker already has them, and two copies would draw two rows.
  { project_id: "7", project_name: "Here", slug: "northwind-bot", name: "Northwind" },
  { project_id: "9", project_name: "Otro proyecto", slug: "magui", name: "Maguí" },
  { project_id: "9", project_name: "Otro proyecto", slug: "rocky", name: "Rocky" },
  { project_id: "3", project_name: "Apx", slug: "candela", name: "Candela" },
];
const people = (query = "") =>
  loadPanelModule("lib/forwarded.ts").forwardPeople({
    pid: "7", superAgent: SUPER, here: HERE, directory: DIRECTORY, query,
  });

test("the search field's visibility is decided by who EXISTS, not by what matched", () => {
  // THE BUG. `total` is what the dialog shows the search box for, and it is the
  // unfiltered count — so a query that matches nobody empties the list and
  // leaves the field standing. It used to be computed from the filtered list:
  // one mistyped letter took the search box away with the results, and there
  // was no way left to fix the typo. Manu, on his own screen: "el buscador se
  // corta y no veo mas nadie si busco mal".
  const all = people();
  assert.equal(all.total, 6, "Roby + the two here + the three elsewhere; the directory's copy of a local agent is not a seventh");
  const missed = people("zzzz");
  assert.deepEqual(missed.groups, [], "nothing matched");
  assert.equal(missed.total, all.total, "and the count the field keys off is unchanged");
});

test("the picker reaches into other projects, grouped by the project they are in", () => {
  const { groups } = people();
  assert.deepEqual(groups.map((g) => g.label), ["", "Apx", "Otro proyecto"], "here first, then the rest by name");
  assert.deepEqual(groups[0].people.map((p) => p.slug), ["__super_agent__", "northwind-bot", "acme-bot"]);
  assert.equal(groups[0].people[0].isSuper, true);
  // Nobody appears twice: the directory's copy of a local agent is dropped.
  const slugs = groups.flatMap((g) => g.people.map((p) => p.slug));
  assert.equal(new Set(slugs).size, slugs.length, "no duplicate rows");
  // And the ones from elsewhere carry the project they belong to, because the
  // send has to go there.
  const magui = groups.find((g) => g.label === "Otro proyecto").people.find((p) => p.slug === "magui");
  assert.equal(magui.projectId, "9");
});

test("searching matches the name, the slug, the project — and ignores accents", () => {
  assert.deepEqual(people("magui").groups.flatMap((g) => g.people.map((p) => p.slug)), ["magui"],
    "\"magui\" finds \"Maguí\": nobody types the accent");
  assert.deepEqual(people("MAGUÍ").groups.flatMap((g) => g.people.map((p) => p.slug)), ["magui"],
    "and it works back the other way");
  assert.deepEqual(people("acme-bot").groups.flatMap((g) => g.people.map((p) => p.slug)), ["acme-bot"],
    "the slug is a name too");
  // The project's name is often the half you remember.
  assert.deepEqual(people("otro").groups.flatMap((g) => g.people.map((p) => p.slug)), ["magui", "rocky"]);
});

test("a forward handed across projects is picked up exactly once", () => {
  // Crossing a project is a navigation: `<ChatTab key={pid}>` is remounted, so
  // the pane that took the click is gone before the destination exists and the
  // message waits in the module between the two. The "once" is the load-bearing
  // part — a parked forward RUNS A TURN when it is picked up, and two panes
  // mounted on the same chat would otherwise send it twice.
  const { parkForward, peekForward, takeForward } = loadPanelModule("lib/forward-handoff.ts");
  const key = { kind: "conv", agentSlug: "magui", convId: "2026-09-18-01" };
  const payload = { note: "¿lo ves?", fwd: { from: { kind: "thread", channel: "web" }, author: "user", text: "esto" } };

  assert.equal(peekForward("9", key), false, "nothing waiting yet");
  parkForward("9", key, payload);
  assert.equal(peekForward("9", key), true, "the loader has to see it WITHOUT consuming it");
  assert.equal(peekForward("7", key), false, "the same chat id in another project is another chat");

  assert.deepEqual(takeForward("9", key), payload);
  assert.equal(takeForward("9", key), null, "and never a second time");
  assert.equal(peekForward("9", key), false);
});

test("a reply typed into a delivered thread is intercepted before the ordinary send", () => {
  // THE BUG THIS GUARDS. A Telegram thread is readable here and cannot be
  // written to: the reply goes out on `web`, into a different conversation. It
  // used to be sent with the pane still showing Telegram — so the message
  // appeared to land in the thread and was gone on the next reload, which is
  // what "se traba y tengo que refrescar" was.
  //
  // The fix is an ORDER: the delivered branch must come before the branch that
  // sends into the open pane. A later reader moving it down would restore the
  // bug with every test still green, because nothing else can see this.
  const src = read("screens", "project", "ChatTab.tsx");
  const delivered = src.indexOf("if (deliveredThread) {");
  const ordinary = src.indexOf("if (activeIsRoby) {");
  assert.ok(delivered > 0, "the delivered-channel branch must exist in send()");
  assert.ok(ordinary > 0, "the ordinary super-agent branch must exist in send()");
  assert.ok(
    delivered < ordinary,
    "a send on a delivered thread must be intercepted BEFORE it reaches the open pane's own path",
  );
  // And it is defined from the shared set, not from a hand-typed "telegram".
  assert.match(src, /const deliveredThread =[\s\S]{0,160}DELIVERED_CHANNELS\.has\(selected\.channel\)/);
});

test("the composer says so before you press enter, not after", () => {
  const src = read("screens", "project", "ChatTab.tsx");
  assert.match(src, /data-testid="delivered-channel-notice"/, "the notice is rendered");
  assert.match(src, /t\("chat_ui\.delivered_notice"/, "and it goes through i18n");
  assert.match(src, /deliveredThread\s*\n?\s*\?\s*t\("chat_ui\.delivered_ph"\)/, "the placeholder says it too");
});

test("a forwarded turn does not land in the thread twice", () => {
  // THE TRAP. The pane composes the bubble with only what was TYPED — the
  // daemon writes the marker — so the copy that comes back from storage and
  // the copy on screen have different text. `mergeLocalTurns` matches them by
  // text, so without a key that strips the marker first, every background
  // refresh (and they fire on every live event) would leave the same message in
  // the conversation twice.
  const { mergeLocalTurns } = loadPanelModule("hooks/useChat.ts");
  const fwd = {
    from: { kind: "thread", channel: "telegram", thread_id: "2026-09-17", title: "Telegram" },
    author: "agent",
    author_name: "Northwind",
    text: "el pedido de acme sale el lunes",
  };
  const local = {
    role: "user",
    parts: [{ kind: "text", text: "¿lo cerramos?" }],
    ts: "2026-09-18T10:00:00Z",
    local: true,
    forwarded: fwd,
  };
  const stored = {
    role: "user",
    parts: [{
      kind: "text",
      text: "[forwarded message — from Telegram, said by Northwind]\n> el pedido de acme sale el lunes\n[end of forwarded message]\n\n¿lo cerramos?",
    }],
    ts: "2026-09-18T10:00:01Z",
    forwarded: fwd,
  };
  assert.equal(mergeLocalTurns([stored], [local]).length, 1, "the stored copy wins; the local one is recognised as the same turn");

  // Two forwards of DIFFERENT messages with the same (empty) note are two
  // turns, so the key cannot be the note alone.
  const other = { ...local, forwarded: { ...fwd, text: "otra cosa" }, parts: [{ kind: "text", text: "" }] };
  const storedEmpty = {
    role: "user",
    parts: [{ kind: "text", text: "[forwarded message — from Telegram, said by Northwind]\n> el pedido de acme sale el lunes\n[end of forwarded message]" }],
    forwarded: fwd,
  };
  assert.equal(mergeLocalTurns([storedEmpty], [other]).length, 2);
});

test("the turn after a forward still knows what the forward was about", () => {
  // A turn sent from this pane is in the pane's memory before it is on disk,
  // and the NEXT turn's history is built from that memory. Without the quote,
  // the agent would be handed "¿lo cerramos?" with nothing to say what "lo" is.
  const { historyTextOf } = loadPanelModule("hooks/useChat.ts");
  const fwd = {
    from: { kind: "thread", channel: "telegram", title: "Telegram" },
    author: "agent",
    author_name: "Northwind",
    text: "el pedido de acme sale el lunes",
  };
  const composedHere = historyTextOf({
    role: "user",
    parts: [{ kind: "text", text: "¿lo cerramos?" }],
    forwarded: fwd,
  });
  assert.match(composedHere, /^\[forwarded message — from Telegram/);
  assert.match(composedHere, /> el pedido de acme sale el lunes/);
  assert.ok(composedHere.endsWith("¿lo cerramos?"));

  // Read back from storage the marker is already in the text — adding a second
  // one would quote the quote.
  const fromStorage = historyTextOf({
    role: "user",
    parts: [{ kind: "text", text: composedHere }],
    forwarded: fwd,
  });
  assert.equal(fromStorage, composedHere, "the quote is added once, never twice");
});

test("the quote is drawn as a card, and never reaches the reader as its marker", () => {
  const src = read("components", "chat", "MessageBubble.tsx");
  assert.match(src, /<ForwardedQuote/, "a forwarded turn draws the card");
  // Copying a message must give you the message, not the machine-facing block
  // the model was handed.
  assert.match(src, /const copyText = visibleTextOf\(/);
  // The strip order is load-bearing: the attachment strip eats a leading
  // "[…]", and a forwarded turn's front is "[forwarded message — …]".
  const body = src.slice(src.indexOf("export function visibleTextOf"));
  assert.ok(
    body.indexOf("stripForwardMarker") < body.indexOf("stripMediaMarker"),
    "the forward marker comes off first, or the attachment strip eats its head",
  );
});
