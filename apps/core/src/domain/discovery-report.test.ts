import assert from "node:assert/strict";
import { test } from "node:test";
import { createBus } from "../bus.ts";
import { openDb } from "../db/db.ts";
import { tempDir } from "../testkit/platform.ts";
import { composeDiscoveryReport, reserveDiscoveryReport } from "./discovery-report.ts";
import { discoveryState } from "./discovery-state.ts";
import { saveOwnerIdentity } from "./owner.ts";
import { seed } from "./seed.ts";
import { createStore } from "./store.ts";

const AT = "2026-05-01T12:00:00.000Z";

test("one finding is reserved atomically and composed only once on its chosen run, not on admission or failed attempts", async () => {
  const dir = tempDir("apx-discovery-report-");
  const db = openDb(dir.path);
  const store = createStore(db, createBus());
  seed(store, "Nova");
  const state = discoveryState(store, () => new Date(AT));
  try {
    const report = store.routines.create({
      name: "Morning report",
      action: "agent",
      call_model: "always",
      next_run_at: undefined,
      agent_id: "superagent",
      enabled: true,
      schedule: { kind: "cron", cron: "0 9 * * *" },
      prompt: "Summarize the day",
    });
    state.configure({ enabled: true, timezone: "America/Argentina/Buenos_Aires", report_routine: report.id });
    state.write({
      ...state.read(),
      findings: [0, 1].map((index) => ({
        id: `finding-${index}`,
        topic: `topic-${index}`,
        title: `Relevant announcement ${index}`,
        summary: "A useful change for the planned workflow.",
        action: "Evaluate the change.",
        uncertainty: "Not tested.",
        evidence: [
          {
            url: "https://example.com/news",
            title: "Acme news",
            quote: "Acme announced a useful change.",
            read_at: AT,
          },
        ],
        found_at: AT,
        expires_at: "2026-05-07T12:00:00.000Z",
      })),
    });
    reserveDiscoveryReport(store, "other-report", "wrong", new Date(AT));
    assert.equal(state.read().claims.length, 0);
    store.routines.update(report.id, { ...report, next_run_at: report.next_run_at, action: "message" });
    reserveDiscoveryReport(store, report.id, "wrong", new Date(AT));
    assert.equal(state.read().claims.length, 0);
    store.routines.update(report.id, { ...report, next_run_at: report.next_run_at });
    assert.throws(
      () =>
        store.tx(() => {
          reserveDiscoveryReport(store, report.id, "rejected", new Date(AT));
          throw new Error("admission failed");
        }),
      /admission failed/,
    );
    assert.equal(state.read().findings[0]?.reserved_at, undefined);
    reserveDiscoveryReport(store, report.id, "run-1", new Date(AT));
    assert.equal(state.read().findings[0]?.included_at, undefined, "admission is not composition or external delivery");
    assert.equal(state.read().claims.length, 1);
    assert.equal(composeDiscoveryReport(store, "other-run", "Base report", new Date(AT)), "Base report");
    const text = composeDiscoveryReport(store, "run-1", "Base report", new Date(AT));
    assert.match(text, /^Base report/);
    assert.match(text, /Para tener en cuenta/, "the report follows the account's default language");
    assert.match(text, /Relevant announcement 0/);
    assert.match(text, /https:\/\/example.com\/news/);
    assert.doesNotMatch(text, /Relevant announcement 1/);
    assert.equal(composeDiscoveryReport(store, "run-1", "Second owner message", new Date(AT)), "Second owner message");
    reserveDiscoveryReport(store, report.id, "run-2", new Date(AT));
    assert.equal(state.read().claims.length, 1, "manual rerun cannot select a second topic that day");
    reserveDiscoveryReport(store, report.id, "next-day", new Date("2026-05-02T12:00:00.000Z"));
    assert.equal(state.read().seen.length, 2);
    state.feedback("finding-1", "mute");
    assert.equal(
      composeDiscoveryReport(store, "next-day", "", new Date("2026-05-02T12:00:00.000Z")),
      "",
      "feedback is checked again at composition",
    );
    state.feedback("finding-1", "unmute");
    assert.deepEqual(state.read().muted, []);
    saveOwnerIdentity(store, { language: "en" });
    const english = composeDiscoveryReport(store, "next-day", "", new Date("2026-05-02T12:00:00.000Z"));
    assert.match(english, /Worth a look/);
    assert.match(english, /Relevant announcement 1/);
    state.feedback("finding-1", "mute");
    state.configure({ enabled: false });
    assert.deepEqual(state.read().muted, ["topic-1"]);
    assert.equal(state.read().findings.length, 0);
    state.feedback("finding-1", "unmute");
    assert.deepEqual(state.read().muted, [], "muting remains reversible after cached evidence was discarded");
    assert.equal(composeDiscoveryReport(store, "next-day", "Base report", new Date(AT)), "Base report");
  } finally {
    db.close();
    await dir.remove();
  }
});
