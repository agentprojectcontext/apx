// Who is SPEAKING in an a2a exchange — resolved, like the recipient always was.
//
// The recipient went through resolvePeer → peerAddress, so `Roby`, `roby`,
// `default` and `apx` all reached one peer with one history. The sender did
// not, and the asymmetry wrote identities into the ledger that name nobody:
// `claude` beside `claude-code` (one agent, two threads), `apx` beside
// `super_agent`, and — worst — a coding CLI offering the PROJECT it was working
// in (`acme-web`, `northwind`) as if a session were a person.
//
// A session is not a speaker. The speaker is the runtime; the session is which
// conversation with it, which is what the `:thread` suffix has always meant.
import { test } from "node:test";
import assert from "node:assert/strict";

import { senderAddress, resolvePeer, peerAddress } from "#core/agent/a2a/peers.js";
import { canonicalRuntimeId, RUNTIME_IDS } from "#core/runtimes/index.js";
import { a2aThreadId } from "#core/stores/messages.js";

const AGENTS = [{ slug: "nova", name: "Nova", fields: { Name: "Nova" } }];
const CONFIG = {};

test("a runtime's short name folds into its canonical id", () => {
  assert.equal(canonicalRuntimeId("claude"), "claude-code");
  assert.equal(canonicalRuntimeId("Claude"), "claude-code");
  assert.equal(canonicalRuntimeId("gemini"), "gemini-cli");
  assert.equal(canonicalRuntimeId("qwen"), "qwen-code");
  assert.equal(canonicalRuntimeId("cursor"), "cursor-agent");
  // And an id that is already canonical stays put.
  for (const id of RUNTIME_IDS) assert.equal(canonicalRuntimeId(id), id);
  assert.equal(canonicalRuntimeId("nothing-claims-this"), null);
});

test("`claude` and `claude-code` are ONE sender, not two", () => {
  assert.equal(senderAddress("claude", AGENTS, CONFIG), "claude-code");
  assert.equal(senderAddress("claude-code", AGENTS, CONFIG), "claude-code");
  // Which is the property that actually matters: one thread, one history.
  assert.equal(
    a2aThreadId(senderAddress("claude", AGENTS, CONFIG), "super_agent"),
    a2aThreadId(senderAddress("claude-code", AGENTS, CONFIG), "super_agent"),
  );
});

test("every super-agent alias sends as super_agent", () => {
  for (const alias of ["apx", "default", "super-agent", "superagent"]) {
    assert.equal(senderAddress(alias, AGENTS, CONFIG), "super_agent", alias);
  }
});

test("a project agent sends under its slug, however it was spelled", () => {
  assert.equal(senderAddress("Nova", AGENTS, CONFIG), "nova");
  assert.equal(senderAddress("nova", AGENTS, CONFIG), "nova");
});

test("the session rides as a :thread suffix, and the speaker stays the runtime", () => {
  // This is the shape a session-labelled sender should have had.
  const addr = senderAddress("claude:acme-web", AGENTS, CONFIG);
  assert.equal(addr, "claude-code:acme-web", "canonical speaker, session preserved");

  const peer = resolvePeer("claude:acme-web", AGENTS, CONFIG);
  assert.equal(peer.name, "claude-code", "who is talking");
  assert.equal(peer.thread, "acme-web", "which conversation with them");
  assert.equal(peerAddress(peer), "claude-code:acme-web");
});

test("two sessions of the same runtime are two threads, one identity", () => {
  const web = senderAddress("claude:acme-web", AGENTS, CONFIG);
  const call = senderAddress("claude:northwind", AGENTS, CONFIG);
  assert.notEqual(
    a2aThreadId(web, "super_agent"),
    a2aThreadId(call, "super_agent"),
    "separate conversations",
  );
  assert.ok(web.startsWith("claude-code"), "and both are Claude speaking");
  assert.ok(call.startsWith("claude-code"));
});

test("a name nothing claims survives unchanged rather than 400ing", () => {
  // A relay that rejects is a relay that silently stops reporting. An unknown
  // label stays visible — and fixable — instead of becoming an error nobody
  // sees. It just no longer gets canonicalised into something it is not.
  assert.equal(senderAddress("some-external-thing", AGENTS, CONFIG), "some-external-thing");
  assert.equal(senderAddress("", AGENTS, CONFIG), "");
  assert.equal(senderAddress(null, AGENTS, CONFIG), "");
});

test("a project agent named after a runtime keeps its own name", () => {
  // A project that deliberately owns an agent called `codex` still owns it —
  // an agent wins over a runtime of the same name, for the sender too.
  const agents = [{ slug: "codex", name: "Codex", fields: { Name: "Codex" } }];
  assert.equal(senderAddress("codex", agents, CONFIG), "codex");
  assert.equal(resolvePeer("codex", agents, CONFIG).kind, "agent");
});
