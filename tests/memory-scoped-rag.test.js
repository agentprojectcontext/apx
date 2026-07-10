// Pieza 5 — scoped RAG for per-project and per-agent memory. Proves the two
// guarantees that keep it from making a mess:
//   1. Isolation: retrieval for one scope never returns another scope's rows,
//      and the super-agent's "global" recall never pulls project/agent rows.
//   2. Hybrid: scoped memory IS indexed + retrievable (the "power").
// All offline: TF-fallback embeddings + JSON store (no Ollama, no sqlite-vec).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.APX_MEMORY_FORCE_JSON = "1";

const { tfEmbed } = await import("../src/core/memory/embeddings.js");
const { JsonStore } = await import("#core/memory/store.js");
const { indexNewMessages } = await import("#core/memory/indexer.js");
const { buildMemoryBlock } = await import("#core/memory/broker.js");

function tmpdir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `apx-${tag}-`));
}

// Build a temp APX_HOME with two agents + two projects' memory, then index it.
async function seed() {
  const apxHome = tmpdir("scoped-home");
  // Agent memory: <apxHome>/projects/<projdir>/agents/<slug>/memory.md
  const agentMem = (projdir, slug, body) => {
    const p = path.join(apxHome, "projects", projdir, "agents", slug, "memory.md");
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  };
  agentMem("proj-a", "scout", "# Memory — scout\n\n## Long-term facts\n- Scout always double-checks the DNS records before declaring a deploy healthy.\n");
  agentMem("proj-a", "writer", "# Memory — writer\n\n## Long-term facts\n- Writer prefers concise release notes with a highlights section at the top.\n");

  // Project memory: <repo>/.apc/memory.md, mapped by the registry list.
  const projRepo = (body) => {
    const repo = tmpdir("scoped-repo");
    const p = path.join(repo, ".apc", "memory.md");
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
    return repo;
  };
  const repoA = projRepo("# Project Memory\n\nThe billing service uses Stripe webhooks for subscription renewals and retries failed charges automatically.\n");
  const repoB = projRepo("# Project Memory\n\nThe mobile app ships via Fastlane to TestFlight every Friday afternoon after QA sign-off.\n");
  const projects = [
    { id: "10", path: repoA },
    { id: "20", path: repoB },
  ];

  const store = new JsonStore(path.join(apxHome, "idx.jsonl"));
  const r = await indexNewMessages(store, {
    apxHome,
    projects,
    messagesDir: path.join(apxHome, "messages"), // empty — no conversational rows
    cursorPath: path.join(apxHome, "cursor.json"),
    memoryPath: path.join(apxHome, "memory.md"), // absent — no global notebook rows
    embed: { forceTf: true },
  });
  return { store, r };
}

test("indexer: collects per-agent + per-project memory as scoped chunks", async () => {
  const { store, r } = await seed();
  assert.equal(r.indexed, 4, "2 agents + 2 projects = 4 scoped blocks");
  const channels = new Set([...store.rows.values()].map((row) => row.channel));
  assert.ok(channels.has("agent:proj-a:scout"));
  assert.ok(channels.has("agent:proj-a:writer"));
  assert.ok(channels.has("project:10"));
  assert.ok(channels.has("project:20"));
  // Sources are tagged so callers can tell memory kinds apart.
  const sources = new Set([...store.rows.values()].map((row) => row.source));
  assert.ok(sources.has("agent-memory"));
  assert.ok(sources.has("project-memory"));
});

test("isolation: scoped search returns ONLY that scope's rows", async () => {
  const { store } = await seed();
  const q = tfEmbed("how does billing handle subscription renewals");
  const hits = store.search(q, { embedder: "tf", k: 10, scope: "project:10" });
  assert.ok(hits.length >= 1, "project A memory is retrievable");
  assert.ok(hits.every((h) => h.channel === "project:10"), "no row from project:20 or any agent leaks in");
  assert.match(hits[0].text, /Stripe/);

  // A different project's scope never sees project A's billing note.
  const other = store.search(q, { embedder: "tf", k: 10, scope: "project:20" });
  assert.ok(other.every((h) => h.channel === "project:20"));
  assert.ok(!other.some((h) => /Stripe/.test(h.text)), "billing note stays in its own project");
});

test("isolation: agent scope stays within one agent", async () => {
  const { store } = await seed();
  const q = tfEmbed("check DNS records before calling a deploy healthy");
  const hits = store.search(q, { embedder: "tf", k: 10, scope: "agent:proj-a:scout" });
  assert.ok(hits.length >= 1);
  assert.ok(hits.every((h) => h.channel === "agent:proj-a:scout"), "writer's memory never surfaces for scout");
  assert.match(hits[0].text, /DNS/);
});

test("isolation: the super-agent's global recall excludes project/agent rows", async () => {
  const { store } = await seed();
  const q = tfEmbed("billing subscription renewals DNS release notes");
  // Everything in the store is scoped — global recall must return nothing.
  const globalHits = store.search(q, { embedder: "tf", k: 10, scope: "global" });
  assert.equal(globalHits.length, 0, "no project/agent row leaks into super-agent recall");
  // Without a scope filter (back-compat) the rows are visible — proving the
  // exclusion above is the scope filter doing its job, not an empty store.
  const unfiltered = store.search(q, { embedder: "tf", k: 10 });
  assert.ok(unfiltered.length >= 1);
});

test("hybrid: broker builds a scoped [RELEVANT MEMORY] block for one agent", async () => {
  const { store } = await seed();
  const block = await buildMemoryBlock("what do we always verify before a deploy?", {
    store,
    scope: "agent:proj-a:scout",
    embed: { forceTf: true },
    memoryPath: path.join(tmpdir("none"), "none.md"),
  });
  assert.match(block, /\[RELEVANT MEMORY\]/);
  assert.match(block, /DNS/);
  assert.ok(!/release notes/.test(block), "writer content does not bleed into scout's block");
});

test("multi-scope: an agent turn recalls its OWN memory + its project's, isolated", async () => {
  const { store } = await seed();
  // The consumer queries [agent:<id>:<slug>, project:<id>] in one shot.
  const scope = ["agent:proj-a:scout", "project:10"];
  const dns = store.search(tfEmbed("verify DNS before deploy"), { embedder: "tf", k: 10, scope });
  const billing = store.search(tfEmbed("subscription renewals via Stripe"), { embedder: "tf", k: 10, scope });
  // Both the agent's note and its project's note are reachable under the pair…
  assert.ok(dns.some((h) => h.channel === "agent:proj-a:scout" && /DNS/.test(h.text)));
  assert.ok(billing.some((h) => h.channel === "project:10" && /Stripe/.test(h.text)));
  // …and nothing from OUTSIDE the pair (other agent / other project) leaks in.
  const all = [...dns, ...billing];
  assert.ok(all.every((h) => scope.includes(h.channel)), "no writer or project:20 row leaks");
});

test("RAG-only: includeFlat:false drops the flat notebook slice", async () => {
  const { store } = await seed();
  const memoryPath = path.join(tmpdir("flat"), "memory.md");
  fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
  fs.writeFileSync(memoryPath, "# Notebook\n\n## 2026-07-09\n- [10:00][web] a flat notebook fact that should NOT appear\n");
  const block = await buildMemoryBlock("verify DNS before deploy", {
    store,
    scope: "agent:proj-a:scout",
    includeFlat: false,
    embed: { forceTf: true },
    memoryPath,
  });
  assert.match(block, /DNS/, "RAG hit still present");
  assert.ok(!/flat notebook fact/.test(block), "flat slice excluded when includeFlat:false");
});
