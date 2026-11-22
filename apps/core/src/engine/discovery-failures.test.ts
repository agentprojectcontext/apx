import assert from "node:assert/strict";
import { test } from "node:test";
import { createBus } from "../bus.ts";
import { openDb } from "../db/db.ts";
import { seed } from "../domain/seed.ts";
import { createStore } from "../domain/store.ts";
import { tempDir, waitFor } from "../testkit/platform.ts";
import { createDiscovery } from "./discovery.ts";
import { say, scriptedLlm } from "./testkit.ts";

const AT = "2026-05-01T12:00:00.000Z";
const source = { label: "Acme", pages: ["https://example.com/"], public_terms: "" };

test("injected deadline cancels research with a persisted terminal state and no immediate replay", async () => {
  const dir = tempDir("apx-discovery-deadline-");
  const db = openDb(dir.path);
  const store = createStore(db, createBus());
  seed(store, "Nova");
  const deadline = new AbortController();
  let started = false;
  const llm = scriptedLlm(async (request) => {
    started = true;
    return await new Promise<never>((_resolve, reject) => {
      request.signal?.addEventListener("abort", () => reject(request.signal?.reason), { once: true });
    });
  });
  const discovery = createDiscovery({
    store,
    llm,
    models: () => ["fake/model"],
    now: () => new Date(AT),
    deadline: () => deadline.signal,
    web: {
      async search() {
        return [];
      },
      async read(url) {
        return { url, title: "Public", text: "Public announcement", read_at: AT };
      },
    },
  });
  try {
    discovery.configure({ enabled: true, sources: [source] });
    const running = discovery.check.run(new Date(AT));
    await waitFor(() => started, "research starts", { ms: 5000 });
    deadline.abort(new Error("deadline"));
    await running;
    assert.equal(discovery.status().state, "cancelled");
    assert.deepEqual(discovery.status().findings, []);
    await discovery.check.run(new Date(AT));
    assert.equal(llm.calls.length, 1);
  } finally {
    deadline.abort();
    await discovery.close();
    db.close();
    await dir.remove();
  }
});

test("one malformed source response cannot exhaust the model budget or prevent later sources from being checked", async () => {
  const dir = tempDir("apx-discovery-failure-");
  const db = openDb(dir.path);
  const store = createStore(db, createBus());
  seed(store, "Nova");
  const reads: string[] = [];
  const llm = scriptedLlm(() => say("not JSON"));
  const discovery = createDiscovery({
    store,
    llm,
    models: () => ["fake/model"],
    now: () => new Date(AT),
    web: {
      async search() {
        return [];
      },
      async read(url) {
        reads.push(url);
        return { url, title: "Public", text: "Public announcement", read_at: AT };
      },
    },
  });
  try {
    discovery.configure({
      enabled: true,
      sources: [
        source,
        { ...source, label: "Northwind", pages: ["https://example.org/"] },
        { ...source, label: "Globex", pages: ["https://example.net/"] },
      ],
      max_model_calls: 2,
    });
    await discovery.check.run(new Date(AT));
    assert.equal(llm.calls.length, 2);
    assert.deepEqual(reads, ["https://example.com/", "https://example.org/"]);
    assert.equal(discovery.status().state, "failed");
    assert.equal(discovery.status().inaccessible.length, 2);
    assert.deepEqual(discovery.status().findings, []);
    await discovery.check.run(new Date("2026-05-03T12:00:00.000Z"));
    assert.equal(reads[2], "https://example.net/", "the previously untouched source is checked first");
    assert.equal(llm.calls.length, 4);
  } finally {
    await discovery.close();
    db.close();
    await dir.remove();
  }
});
