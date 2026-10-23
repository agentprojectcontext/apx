import assert from "node:assert/strict";
import { test } from "node:test";
import { existedBefore, html, summarize, text, toDay, toInstall } from "./telemetry-report.ts";

const root = "projects/apx-agents/databases/(default)/documents/installs";
// Each stage lands a 30-minute tick after the one before, as on a new install; `gapMs` sets that gap.
const install = (id: string, channel: string, stages: string[], usage?: boolean, gapMs = 30 * 60_000) =>
  toInstall({
    name: `${root}/${id}`,
    fields: {
      version: { stringValue: "2.4.0" },
      first_version: { stringValue: "2.4.0" },
      os: { stringValue: "darwin" },
      arch: { stringValue: "arm64" },
      channel: { stringValue: channel },
      ...(usage === undefined ? {} : { usage: { booleanValue: usage } }),
      updated_at: { timestampValue: "2026-03-02T10:00:00Z" },
      stages: {
        mapValue: {
          fields: Object.fromEntries(
            stages.map((s, n) => [
              s,
              { timestampValue: new Date(Date.parse("2026-03-01T10:00:00Z") + n * gapMs).toISOString() },
            ]),
          ),
        },
      },
    },
  });

test("the report reads Firestore documents into a funnel that leaves checkouts and tests out", () => {
  const installs = [
    install("a", "app", ["installed", "opened", "consent", "setup", "first_run"], true),
    install("b", "bundle", ["installed", "opened", "consent"], false),
    install("c", "app", ["installed"]),
    install("d", "source", ["installed", "opened"]),
    install("e", "test", ["installed"]),
  ];
  const days = [
    toDay({
      name: `${root}/a/days/2026-03-02`,
      fields: {
        version: { stringValue: "2.4.0" },
        tokens_in: { integerValue: "1200" },
        tokens_out: { integerValue: "300" },
        runs: { integerValue: "4" },
      },
    }),
    toDay({ name: `${root}/d/days/2026-03-02`, fields: { tokens_in: { integerValue: "99" } } }),
  ];
  const s = summarize(installs, days, { now: new Date("2026-03-02T12:00:00Z") });
  assert.equal(s.installs, 3);
  assert.deepEqual(
    s.funnel.map((f) => f.installs),
    [3, 2, 2, 1, 1],
  );
  assert.deepEqual(s.opt_in, { answered: 2, yes: 1 });
  assert.deepEqual(s.days, [["2026-03-02", { reports: 1, tokens_in: 1200, tokens_out: 300, runs: 4 }]]);
  assert.deepEqual(s.channels, [
    ["app", 2],
    ["bundle", 1],
  ]);
  assert.equal(summarize(installs, days, { all: true }).installs, 5);
  assert.match(text(s), /first_run\s+1\s+33%/);
  assert.match(html(s), /<h2>Funnel \(new installs\)<\/h2>/);
});

test("an APX that ran before telemetry is kept out of the funnel but not out of usage", () => {
  const before = install("old", "bundle", ["installed", "opened", "setup", "first_run"], true, 1_000);
  const firstRunOnly = install("old2", "app", ["installed", "first_run"], undefined, 2_000);
  const fresh = install("new", "app", ["installed", "opened", "setup", "first_run"]);
  const idle = install("idle", "app", ["installed"]);
  assert.equal(existedBefore(before), true);
  assert.equal(existedBefore(firstRunOnly), true);
  assert.equal(existedBefore(fresh), false);
  assert.equal(existedBefore(idle), false);

  const s = summarize([before, firstRunOnly, fresh, idle], [], { now: new Date("2026-03-02T12:00:00Z") });
  assert.equal(s.installs, 2);
  assert.equal(s.existing, 2);
  assert.deepEqual(
    s.funnel.map((f) => f.installs),
    [2, 1, 0, 1, 1],
  );
  assert.deepEqual(s.opt_in, { answered: 1, yes: 1 });
  assert.match(text(s), /Installs: 2 new · 2 running before telemetry/);
});
