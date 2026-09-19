// Forwarding one message into another session.
//
// The feature has two halves that must agree or it silently breaks: the MARKER
// folded into the turn's text, which is what the model reads, and the META
// recorded on the row, which is what every surface draws the card from. A third
// party holds a copy of the marker — the panel, which has to take it back out
// of the text before showing it — and the panel is a separate pnpm workspace
// that cannot import from core. So two of these tests exist purely to pin that
// copy to the original: let them drift and the failure is machine-facing prose
// ("[forwarded message — from Telegram…]") printed in the middle of somebody's
// conversation, which nothing else in the build would catch.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Anything that writes under ~/.apx has to be pointed somewhere disposable
// BEFORE the modules resolve their paths at import time — rule 1.
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-forwards-home-"));
process.env.HOME = TMP_HOME;
process.env.USERPROFILE = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test, after } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { buildSync } = await import("esbuild");
const express = (await import("express")).default;

const {
  normalizeForward, forwardMarker, forwardPrompt, stripForwardMarker, MAX_QUOTE,
} = await import("#core/stores/forwards.js");
const { readGlobalThread } = await import("#core/stores/messages.js");
const { readConversation, shapeConversationMessage } = await import("#core/stores/conversations.js");
const { register: registerSuperAgent } = await import("#host/daemon/api/super-agent.js");
const { register: registerExec } = await import("../src/host/daemon/api/exec.js");
const { register: registerAgents } = await import("#host/daemon/api/agents.js");
const { apiRouter, makeTempProject, cleanupTempProject } = await import("./_helpers.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const TODAY = new Date().toISOString().slice(0, 10);

after(() => {
  fs.rmSync(TMP_HOME, { recursive: true, force: true });
});

/** A forward as a client sends one, before normalisation. */
const raw = (over = {}) => ({
  from: { kind: "thread", channel: "telegram", thread_id: "2026-09-17", title: "Telegram" },
  author: "agent",
  author_name: "Northwind",
  text: "el pedido de acme sale el lunes",
  ts: "2026-09-17T19:42:00.000Z",
  ...over,
});

// ── The shape ───────────────────────────────────────────────────────────────

test("normalizeForward keeps an address and refuses anything that is not one", () => {
  const ok = normalizeForward(raw());
  assert.equal(ok.from.kind, "thread");
  assert.equal(ok.from.channel, "telegram");
  assert.equal(ok.from.thread_id, "2026-09-17");
  assert.equal(ok.author, "agent");
  assert.equal(ok.ts, "2026-09-17T19:42:00.000Z");

  assert.equal(normalizeForward(null), null);
  assert.equal(normalizeForward({ text: "hola" }), null, "a quote with no source is not a forward");
  assert.equal(normalizeForward({ from: { kind: "thread" }, text: "  " }), null, "nor is an empty one");
  assert.equal(normalizeForward(raw({ from: { kind: "nonsense" } })), null, "the address must be one we can reopen");
  // Anything that is not the owner is an agent; the NAME carries who.
  assert.equal(normalizeForward(raw({ author: "roby" })).author, "agent");
  assert.equal(normalizeForward(raw({ author: "user" })).author, "user");
});

test("the quote is capped, and says so when it was cut", () => {
  const long = "x".repeat(MAX_QUOTE + 500);
  const fwd = normalizeForward(raw({ text: long }));
  assert.equal(fwd.text.length, MAX_QUOTE);
  assert.equal(fwd.truncated, true);
  // The cap is the whole point: a forward must not be a way to paste four
  // megabytes of tool output into somebody else's context window.
  assert.ok(forwardMarker(fwd).length < MAX_QUOTE + 500);

  const short = normalizeForward(raw());
  assert.equal(short.truncated, undefined, "an untouched quote is not flagged");
});

test("the source records which project it was said in", () => {
  // A conversation id means nothing outside the project that holds it. Without
  // this, the card's way back from a forward that crossed projects would open
  // the right address in the wrong one — or nothing at all.
  const fwd = normalizeForward(raw({
    from: { kind: "conv", agent_slug: "northwind", conversation_id: "2026-09-17-01", title: "Northwind", project_id: 9, project_name: "Otro proyecto" },
  }));
  assert.equal(fwd.from.project_id, "9", "coerced to a string, the way every other id here is");
  assert.equal(fwd.from.project_name, "Otro proyecto");
  // And it stays out of the marker: the model is being shown a quote, not a
  // routing table.
  assert.doesNotMatch(forwardMarker(fwd), /Otro proyecto/);
});

test("a title cannot break out of the marker it is printed inside", () => {
  // Everything in the head lands inside `[…]`, and the strip ends at the first
  // `]`. A session someone called "Acme] urgente" would otherwise end the
  // marker early and leave half a machine-facing line on screen — on every
  // surface at once, because they all strip the same way.
  const fwd = normalizeForward(raw({ from: { kind: "thread", channel: "telegram", title: "Acme] urgente\nsegunda línea" } }));
  assert.equal(fwd.from.title, "Acme urgente segunda línea");
  assert.equal(stripForwardMarker(forwardPrompt(fwd, "¿lo vemos?")), "¿lo vemos?");
});

test("the marker quotes every line, and the strip gives back exactly what was typed", () => {
  const fwd = normalizeForward(raw({ text: "primera\nsegunda\n\ncuarta" }));
  const marker = forwardMarker(fwd);
  assert.match(marker, /^\[forwarded message — from Telegram, said by Northwind, on 2026-09-17 19:42 UTC\]\n/);
  assert.ok(marker.endsWith("[end of forwarded message]"));
  for (const line of ["> primera", "> segunda", "> ", "> cuarta"]) {
    assert.ok(marker.includes(line), `every line of the quote is marked as one: ${JSON.stringify(line)}`);
  }
  assert.equal(stripForwardMarker(forwardPrompt(fwd, "mirá esto")), "mirá esto");
  // A forward with nothing typed under it is still a turn: the quote alone.
  assert.equal(stripForwardMarker(forwardPrompt(fwd, "")), "");
  assert.equal(forwardPrompt(fwd, ""), marker);
});

test("the owner's own words are attributed to the owner, not to a name", () => {
  const fwd = normalizeForward(raw({ author: "user", author_name: "Northwind" }));
  assert.match(forwardMarker(fwd), /said by the owner/);
});

// ── The panel's copies ──────────────────────────────────────────────────────

/** Load one of the panel's modules by bundling it — the same trick
 *  tests/web-guardrails.test.js uses to read the real i18n dictionaries. */
function loadPanelModule(relPath) {
  const built = buildSync({
    entryPoints: [path.join(__dirname, "..", "src", "interfaces", "web", "src", relPath)],
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

test("the panel strips the marker this module writes (rule: one spelling, two workspaces)", () => {
  const panel = loadPanelModule("lib/forwarded.ts");
  const fwd = normalizeForward(raw({ text: "línea uno\nlínea dos" }));
  const stored = forwardPrompt(fwd, "¿qué opinás?");
  assert.equal(
    panel.stripForwardMarker(stored),
    "¿qué opinás?",
    "the panel must take the whole marker block off — a regex that drifts prints it to the reader",
  );
  // And it must not eat an ordinary message that merely opens with a bracket.
  assert.equal(panel.stripForwardMarker("[no es un reenvío] hola"), "[no es un reenvío] hola");
});

test("the panel builds the same marker this module does", () => {
  // The panel needs its own builder for HISTORY: a turn it just sent is in the
  // pane's memory before it is on disk, and the next turn's previousMessages is
  // built from that memory. Two spellings would hand the model two different
  // accounts of the same message depending on whether the page had reloaded.
  const panel = loadPanelModule("lib/forwarded.ts");
  for (const over of [
    {},
    { author: "user" },
    { ts: undefined },
    { author_name: undefined },
    { text: "una\ndos\ntres" },
    { from: { kind: "conv", agent_slug: "northwind", conversation_id: "2026-09-17-01", title: "Northwind" } },
    { from: { kind: "live", agent_slug: "northwind" } },
  ]) {
    const fwd = normalizeForward(raw(over));
    assert.equal(panel.forwardMarker(fwd), forwardMarker(fwd), `same marker for ${JSON.stringify(over)}`);
  }
});

// ── Who the message can go to ───────────────────────────────────────────────

test("the agent directory answers across every project, and survives a broken one", async () => {
  // A forward's destination is very often in ANOTHER project, and the panel had
  // no way to ask: `/projects/:pid/agents` answers for one, and fourteen of
  // those is a fan-out, not a list.
  const here = fs.mkdtempSync(path.join(TMP_HOME, "dir-a-"));
  const there = fs.mkdtempSync(path.join(TMP_HOME, "dir-b-"));
  for (const [root, slug, name] of [[here, "northwind", "Northwind"], [there, "magui", "Maguí"]]) {
    fs.mkdirSync(path.join(root, ".apc", "agents"), { recursive: true });
    fs.writeFileSync(path.join(root, ".apc", "project.json"), JSON.stringify({ name: "x", apx: "installed" }));
    fs.writeFileSync(
      path.join(root, ".apc", "agents", `${slug}.md`),
      `---\nName: ${name}\nRole: Tester\nEmoji: 🚀\nIcon: noche\n---\n\nbody\n`,
    );
  }
  const projects = {
    list: () => [
      { id: 1, name: "Acme", path: here },
      { id: 2, name: "Northwind", path: there },
      // A project whose folder was renamed or removed. It must cost its own
      // rows and nothing else — a registry that reads as empty looks exactly
      // like an install with no agents at all.
      { id: 3, name: "Gone", path: path.join(TMP_HOME, "does-not-exist") },
    ],
    get: () => null,
    rebuild: () => {},
  };
  const app = express();
  app.use(express.json());
  registerAgents(apiRouter(express, app), { projects, project: () => null });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/agents/directory`);
    assert.equal(res.status, 200);
    const rows = await res.json();
    assert.equal(rows.length, 2, "both live projects, and the broken one costs only itself");
    const magui = rows.find((r) => r.slug === "magui");
    assert.equal(magui.project_id, "2");
    assert.equal(magui.project_name, "Northwind");
    // Read through the one shaper: the frontmatter keys are capitalised, and
    // reading them by hand is how a picker draws slugs where names should be.
    assert.equal(magui.name, "Maguí");
    assert.equal(magui.emoji, "🚀");
    assert.equal(magui.icon, "noche");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

// ── The super-agent's turn ──────────────────────────────────────────────────

async function serveSuperAgent(root, id = 31) {
  const app = express();
  app.use(express.json());
  const p = {
    id,
    name: "northwind",
    path: root,
    storagePath: path.join(TMP_HOME, ".apx", "projects", String(id)),
    config: null,
  };
  const router = apiRouter(express, app);
  registerSuperAgent(router, {
    projects: { list: () => [p], get: () => p, rebuild: () => {} },
    registries: null,
    plugins: { get: () => null },
    project: () => p,
    config: {
      super_agent: { enabled: true, name: "apx", model: "mock:test", permission_mode: "total" },
      engines: {},
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  return { server, url: `http://127.0.0.1:${server.address().port}`, id };
}

test("a forwarded web turn: the model reads the quote, the ledger records where it came from", async () => {
  const root = makeTempProject({ name: "northwind" });
  const { server, url, id } = await serveSuperAgent(root);
  try {
    const res = await fetch(`${url}/api/projects/${id}/super-agent/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "¿lo cerramos?",
        channel: "web",
        confirm: false,
        forwarded: raw(),
      }),
    });
    assert.equal(res.status, 200);
    await res.json();

    const thread = readGlobalThread({ channel: "web", date: TODAY, project: String(id) });
    const user = thread.messages.find((m) => m.role === "user");
    assert.ok(user, "the forwarded turn is in the record");
    // The half the MODEL reads.
    assert.match(user.content, /^\[forwarded message — from Telegram/);
    assert.match(user.content, /> el pedido de acme sale el lunes/);
    assert.ok(user.content.endsWith("¿lo cerramos?"), "what was typed comes under the quote");
    // The half every SURFACE reads.
    assert.equal(user.forwarded.from.channel, "telegram");
    assert.equal(user.forwarded.from.thread_id, "2026-09-17");
    assert.equal(user.forwarded.author_name, "Northwind");
    assert.equal(user.forwarded.text, "el pedido de acme sale el lunes");
    // And the two agree: strip one, get the other's note back.
    assert.equal(stripForwardMarker(user.content), "¿lo cerramos?");
  } finally {
    await new Promise((r) => server.close(r));
    cleanupTempProject(root);
  }
});

test("forwarding with nothing typed under it is still a turn", async () => {
  const root = makeTempProject({ name: "acme" });
  const { server, url, id } = await serveSuperAgent(root, 32);
  try {
    const res = await fetch(`${url}/api/projects/${id}/super-agent/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // No prompt at all: "read this" is a complete thing to say, and the guard
      // that refuses an empty turn must not refuse this one.
      body: JSON.stringify({ channel: "web", confirm: false, forwarded: raw({ text: "mirá el adjunto" }) }),
    });
    assert.equal(res.status, 200, "a quote with no note is not an empty prompt");
    await res.json();
    const thread = readGlobalThread({ channel: "web", date: TODAY, project: String(id) });
    const user = thread.messages.find((m) => m.role === "user");
    assert.equal(user.forwarded.text, "mirá el adjunto");
    assert.equal(stripForwardMarker(user.content), "");
  } finally {
    await new Promise((r) => server.close(r));
    cleanupTempProject(root);
  }
});

// ── A project agent's turn ──────────────────────────────────────────────────

test("a forwarded turn in a project agent's chat keeps the quote on the conversation file", async () => {
  const root = fs.mkdtempSync(path.join(TMP_HOME, "proj-"));
  const storage = fs.mkdtempSync(path.join(TMP_HOME, "store-"));
  fs.mkdirSync(path.join(root, ".apc", "agents"), { recursive: true });
  fs.writeFileSync(path.join(root, ".apc", "project.json"), JSON.stringify({ name: "acme", apx: "installed" }));
  fs.writeFileSync(
    path.join(root, ".apc", "agents", "northwind.md"),
    "---\nRole: Tester\nModel: mock\n---\n\nYou are a test agent.\n",
  );
  const p = { id: "1", name: "acme", path: root, storagePath: storage, logMessage: () => {} };

  const app = express();
  app.use(express.json());
  const router = apiRouter(express, app);
  registerExec(router, {
    projects: { list: () => [p], get: () => p, rebuild: () => {} },
    project: () => p,
    config: { model: "mock", engines: {} },
    plugins: {},
    registries: null,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  try {
    const res = await fetch(
      `http://127.0.0.1:${server.address().port}/api/projects/1/agents/northwind/chat`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "seguí vos", model: "mock", forwarded: raw() }),
      },
    );
    assert.equal(res.status, 200);
    const body = await res.json();

    const conv = readConversation(storage, "northwind", body.conversation_id);
    // Through the shaper the viewer uses, not the raw turn: the point is that
    // what a reader gets back carries the quote.
    const user = conv.turns.map(shapeConversationMessage).find((m) => m.role === "user");
    assert.ok(user, "the turn is in the file");
    assert.match(user.content, /^\[forwarded message — from Telegram/);
    assert.equal(user.forwarded.from.channel, "telegram");
    assert.equal(user.forwarded.text, "el pedido de acme sale el lunes");
    assert.equal(stripForwardMarker(user.content), "seguí vos");
  } finally {
    await new Promise((r) => server.close(r));
  }
});
