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
