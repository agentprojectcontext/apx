import assert from "node:assert/strict";
import { test } from "node:test";
import { createBus } from "../bus.ts";
import { openDb } from "../db/db.ts";
import { seed } from "../domain/seed.ts";
import { createStore } from "../domain/store.ts";
import { tempDir, waitFor } from "../testkit/platform.ts";
import { createDiscovery } from "./discovery.ts";
import type { DiscoveryWeb } from "./discovery-research.ts";
import { say, scriptedLlm } from "./testkit.ts";

const AT = "2026-05-01T12:00:00.000Z";
const quote = "Acme has announced a new public export format.";
function proposal(text = quote) {
  return {
    findings: [
      {
        topic: "Acme export format",
        title: "A new export format to evaluate",
        summary: "Acme has announced a new public export format that could simplify your planned exports.",
        action: "Compare the new format with your export requirements.",
        uncertainty: "Compatibility has not been tested.",
        expires_at: "2026-05-07T12:00:00.000Z",
        relevance: 4,
        impact: 4,
        novelty: 4,
        actionable: 4,
        timely: 3,
        local: 0,
        evidence: [{ page: 0, quote: text }],
      },
    ],
  };
}
function fixture() {
  const dir = tempDir("apx-discovery-");
  const db = openDb(dir.path);
  const store = createStore(db, createBus());
  seed(store, "Nova");
  const urls: string[] = [];
  const web: DiscoveryWeb = {
    async search() {
      assert.fail("No search terms were configured");
    },
    async read(url) {
      urls.push(url);
      return { url, title: "Acme news", text: quote, read_at: AT };
    },
  };
  return {
    store,
    db,
    web,
    urls,
    async close() {
      db.close();
      await dir.remove();
    },
  };
}
const sources = [{ label: "Acme", public_terms: "", pages: ["https://example.com/news"] }];

test("disabled research has no network, model or routine side effects; enabled research persists literal evidence", async () => {
  const f = fixture();
  const llm = scriptedLlm((request) =>
    say(
      JSON.stringify(
        String(request.messages[0]?.content).startsWith("Independently check")
          ? { supported: true, relevant: true, new_topic: true, limitation: "" }
          : proposal(),
      ),
    ),
  );
  const discovery = createDiscovery({
    store: f.store,
    llm,
    web: f.web,
    models: () => ["fake/model"],
    now: () => new Date(AT),
  });
  try {
    await discovery.check.run(new Date(AT));
    assert.equal(llm.calls.length, 0);
    assert.deepEqual(f.urls, []);
    const routines = f.store.routines.list().length;
    discovery.configure({ enabled: true, sources });
    await discovery.check.run(new Date(AT));
    assert.equal(llm.calls.length, 2);
    assert.deepEqual(llm.calls[0]?.tools, []);
    assert.equal(discovery.status().findings.length, 1);
    assert.equal(discovery.status().findings[0]?.evidence[0]?.quote, quote);
    assert.equal(f.store.routines.list().length, routines);
    assert.equal(f.store.notifications.list({ unreadOnly: false, limit: 10 }).length, 0);
    await discovery.check.run(new Date(AT));
    assert.equal(llm.calls.length, 2);
    await discovery.check.run(new Date("2026-05-02T12:00:00.000Z"));
    assert.equal(llm.calls.length, 2, "intermediate day does not launch deep research");
    await discovery.check.run(new Date("2026-05-03T12:00:00.000Z"));
    assert.equal(llm.calls.length, 3, "duplicate evidence is rejected before another verification call");
    assert.equal(discovery.status().findings.length, 1, "a pending topic is not duplicated");
  } finally {
    await discovery.close();
    await f.close();
  }
});

test("invented quotations and weak results are silently discarded", async () => {
  const f = fixture();
  const llm = scriptedLlm(() => say(JSON.stringify(proposal("A quotation that is absent from the source."))));
  const discovery = createDiscovery({
    store: f.store,
    llm,
    web: f.web,
    models: () => ["fake/model"],
    now: () => new Date(AT),
  });
  try {
    discovery.configure({ enabled: true, sources });
    await discovery.check.run(new Date(AT));
    assert.equal(discovery.status().state, "completed");
    assert.deepEqual(discovery.status().findings, []);
    assert.equal(f.store.notifications.list({ unreadOnly: false, limit: 10 }).length, 0);
  } finally {
    await discovery.close();
    await f.close();
  }
});

test("fenced model JSON still passes the same quotation and independent-verification checks", async () => {
  const f = fixture();
  const llm = scriptedLlm((request) =>
    say(
      `\`\`\`json\n${JSON.stringify(String(request.messages[0]?.content).startsWith("Independently check") ? { supported: true, relevant: true, new_topic: true, limitation: "Compatibility is untested." } : proposal())}\n\`\`\``,
    ),
  );
  const discovery = createDiscovery({
    store: f.store,
    llm,
    web: f.web,
    models: () => ["fake/model"],
    now: () => new Date(AT),
  });
  try {
    discovery.configure({ enabled: true, sources });
    await discovery.check.run(new Date(AT));
    assert.equal(llm.calls.length, 2);
    assert.equal(discovery.status().state, "completed");
    assert.equal(discovery.status().findings.length, 1);
    assert.equal(discovery.status().findings[0]?.evidence[0]?.quote, quote);
  } finally {
    await discovery.close();
    await f.close();
  }
});

test("independent verification can reject a confident proposal even with a real quotation", async () => {
  const f = fixture();
  const llm = scriptedLlm((request) =>
    say(
      JSON.stringify(
        String(request.messages[0]?.content).startsWith("Independently check")
          ? {
              supported: false,
              relevant: true,
              new_topic: true,
              limitation: "The quotation does not establish compatibility.",
            }
          : proposal(),
      ),
    ),
  );
  const discovery = createDiscovery({
    store: f.store,
    llm,
    web: f.web,
    models: () => ["fake/model"],
    now: () => new Date(AT),
  });
  try {
    discovery.configure({ enabled: true, sources });
    await discovery.check.run(new Date(AT));
    assert.equal(llm.calls.length, 2);
    assert.deepEqual(discovery.status().findings, []);
    assert.equal(discovery.status().state, "completed");
  } finally {
    await discovery.close();
    await f.close();
  }
});

test("late in-flight output cannot revive revoked sources", async () => {
  const f = fixture();
  let release: (() => void) | undefined;
  let started = false;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const llm = scriptedLlm(async () => {
    started = true;
    await pending;
    return say(JSON.stringify(proposal()));
  });
  const discovery = createDiscovery({
    store: f.store,
    llm,
    web: f.web,
    models: () => ["fake/model"],
    now: () => new Date(AT),
  });
  try {
    discovery.configure({ enabled: true, sources });
    const running = discovery.check.run(new Date(AT));
    await waitFor(() => started, "research model starts", { ms: 5000 });
    discovery.configure({ enabled: false, sources: [] });
    release?.();
    await running;
    assert.deepEqual(discovery.status().findings, []);
    assert.equal(discovery.status().settings.enabled, false);
    assert.equal(discovery.status().state, "cancelled");
  } finally {
    release?.();
    await discovery.close();
    await f.close();
  }
});
