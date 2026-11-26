import assert from "node:assert/strict";
import { test } from "node:test";
import type { DiscoveryFinding } from "@apx/protocol";
import { createBus } from "../bus.ts";
import { openDb } from "../db/db.ts";
import type { Presentation } from "../domain/channels.ts";
import { composeDiscoveryReport, reserveDiscoveryReport } from "../domain/discovery-report.ts";
import { discoveryState } from "../domain/discovery-state.ts";
import { HOME_THREAD_ID, seed } from "../domain/seed.ts";
import { createStore } from "../domain/store.ts";
import { tempDir } from "../testkit/platform.ts";
import { createDiscovery } from "./discovery.ts";
import { say, scriptedLlm } from "./testkit.ts";

const finding = (id: string, urgency: "now" | "digest", title: string): DiscoveryFinding => ({
  id,
  topic: `topic-${id}`,
  title,
  summary: "Something on a public page that matters to the owner's work.",
  action: "Have a look this week.",
  uncertainty: "",
  evidence: [
    {
      url: `https://example.com/${id}`,
      title: "Example",
      quote: "A quote long enough.",
      read_at: "2030-05-01T00:00:00.000Z",
    },
  ],
  found_at: "2030-05-01T00:00:00.000Z",
  expires_at: "2030-05-09T00:00:00.000Z",
  urgency,
});

async function fixture() {
  const dir = tempDir("apx-discovery-deliver-");
  const db = openDb(dir.path);
  const store = createStore(db, createBus());
  seed(store, "Nova");
  store.settings.write("owner_profile", {
    ...store.settings.read("owner_profile"),
    timezone: "America/Argentina/Buenos_Aires",
  });
  const sent: Presentation[] = [];
  const discovery = createDiscovery({
    store,
    llm: scriptedLlm(() => say(JSON.stringify({ findings: [] }))),
    // No model: the checks below deliver what research already found, and run no research of their own.
    models: () => [],
    notifyOwner: (body) => sent.push(body),
  });
  const said = () =>
    store.messages
      .list(HOME_THREAD_ID, 50)
      .filter((m) => m.author.kind === "agent")
      .map((m) => m.parts.map((p) => (p.type === "text" ? p.text : "")).join(""));
  const close = async () => {
    await discovery.close();
    db.close();
    await dir.remove();
  };
  return { store, discovery, sent, said, close };
}

test("automatic: what cannot wait is told at once; the rest waits for one summary at the start of the owner's day", async () => {
  const f = await fixture();
  try {
    f.discovery.configure({ enabled: true });
    assert.equal(f.store.settings.read("discovery").delivery, "automatic", "the default");
    const state = discoveryState(f.store, () => new Date());
    state.write({
      ...state.read(),
      findings: [
        finding("price", "now", "Your pricing page shows last year's prices"),
        finding("event", "digest", "A photography fair near Córdoba"),
        finding("release", "digest", "A new Claude Code release"),
      ],
    });
    // 02:00 in Buenos Aires: the urgent one goes out now, the others wait for the morning.
    await f.discovery.check.run(new Date("2030-05-02T05:00:00.000Z"));
    assert.equal(f.said().length, 1);
    assert.match(f.said()[0] ?? "", /Esto conviene mirarlo hoy[\s\S]*last year's prices/);
    assert.doesNotMatch(f.said()[0] ?? "", /photography fair/);
    assert.equal(f.sent.length, 1, "sent on to the owner like a routine's message");
    await f.discovery.check.run(new Date("2030-05-02T10:00:00.000Z"));
    assert.equal(f.said().length, 1, "07:00: still before the owner's day starts");

    // 08:00 there: one summary with both, and only once that day.
    await f.discovery.check.run(new Date("2030-05-02T11:00:00.000Z"));
    assert.equal(f.said().length, 2);
    assert.match(
      f.said()[1] ?? "",
      /Lo que encontró la investigación[\s\S]*photography fair[\s\S]*Claude Code release/,
    );
    assert.doesNotMatch(f.said()[1] ?? "", /last year's prices/, "already told");
    state.write({ ...state.read(), findings: [...state.read().findings, finding("late", "digest", "A late find")] });
    await f.discovery.check.run(new Date("2030-05-02T15:00:00.000Z"));
    assert.equal(f.said().length, 2, "one summary a day: a later find waits for tomorrow");
    await f.discovery.check.run(new Date("2030-05-03T11:30:00.000Z"));
    assert.equal(f.said().length, 3);
    assert.match(f.said()[2] ?? "", /A late find/);
    assert.ok(
      state.read().findings.every((x) => x.included_at),
      "each told once",
    );
  } finally {
    await f.close();
  }
});

test("in a routine: findings join the chosen report as before, and nothing is told on its own", async () => {
  const f = await fixture();
  try {
    const report = f.store.routines.create({
      name: "Morning report",
      action: "agent",
      call_model: "always",
      next_run_at: undefined,
      agent_id: "superagent",
      enabled: true,
      schedule: { kind: "cron", cron: "0 9 * * *" },
      prompt: "Summarize the day",
    });
    assert.throws(() => f.discovery.configure({ enabled: true, delivery: "routine", report_routine: null }), /routine/);
    f.discovery.configure({ enabled: true, delivery: "routine", report_routine: report.id });
    const state = discoveryState(f.store, () => new Date());
    state.write({ ...state.read(), findings: [finding("price", "now", "Your pricing page shows last year's prices")] });
    await f.discovery.check.run(new Date("2030-05-02T12:00:00.000Z"));
    assert.equal(f.said().length, 0);
    assert.equal(f.sent.length, 0);
    const at = new Date("2030-05-02T12:00:00.000Z");
    reserveDiscoveryReport(f.store, report.id, "run_1", at);
    assert.match(composeDiscoveryReport(f.store, "run_1", "Your day.", at), /Your day\.[\s\S]*last year's prices/);
  } finally {
    await f.close();
  }
});
