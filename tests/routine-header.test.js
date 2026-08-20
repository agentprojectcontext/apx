// The routine header is the native replacement for the old `echo …date…`
// pre_command trick: name / id / memory path / last run / this run, prepended to
// the prompt so the model opens on its identity and the current time without any
// shell plumbing. The clock is machine-friendly (ISO + epoch, UTC) and, when a
// timezone is configured, human-friendly in the owner's zone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRoutineHeader, prependRoutineHeader } from "#core/routines/header.js";

// 2026-08-20T13:00:35.123Z — a fixed instant so the assertions are deterministic.
const NOW = 1787230835123;

test("buildRoutineHeader — machine stamp is ISO-with-millis + epoch ms", () => {
  const h = buildRoutineHeader(
    { name: "magui-cron", id: "r_ab12cd", last_run_at: "" },
    { storagePath: "/store", config: {}, nowMs: NOW },
  );
  assert.match(h, /^Automation: magui-cron$/m);
  assert.match(h, /^Automation ID: r_ab12cd$/m);
  assert.match(h, /^Automation memory: \/store\/routines\/r_ab12cd\/memory\.md$/m);
  assert.match(h, /^Last run: never$/m);
  assert.match(h, /^This run: 2026-08-20T13:00:35\.123Z \(1787230835123\)/m);
});

test("buildRoutineHeader — a prior run renders as ISO + epoch, not 'never'", () => {
  const h = buildRoutineHeader(
    { name: "r", id: "r_1", last_run_at: "2026-08-19T12:00:17Z" },
    { storagePath: "/store", config: {}, nowMs: NOW },
  );
  assert.match(h, /^Last run: 2026-08-19T12:00:17\.000Z \(1787140817000\)$/m);
});

test("buildRoutineHeader — configured timezone adds a local wall-clock line", () => {
  const h = buildRoutineHeader(
    { name: "r", id: "r_1", last_run_at: "" },
    {
      storagePath: "/store",
      config: { user: { timezone: "America/Argentina/Buenos_Aires", locale: "es-AR" } },
      nowMs: NOW,
    },
  );
  // 13:00 UTC is 10:00 in Buenos Aires (-03), and the zone is named for the model.
  assert.match(h, /This run: .+ — .+10:00:35.+\(America\/Argentina\/Buenos_Aires\)/);
});

test("buildRoutineHeader — no timezone means no local line, just the machine stamp", () => {
  const h = buildRoutineHeader(
    { name: "r", id: "r_1", last_run_at: "" },
    { storagePath: "/store", config: {}, nowMs: NOW },
  );
  assert.ok(!h.includes(" — "), "no local suffix when timezone is unset");
});

test("buildRoutineHeader — an unusable timezone degrades to the machine stamp only", () => {
  const h = buildRoutineHeader(
    { name: "r", id: "r_1", last_run_at: "" },
    { storagePath: "/store", config: { user: { timezone: "Not/AZone" } }, nowMs: NOW },
  );
  assert.match(h, /^This run: 2026-08-20T13:00:35\.123Z \(1787230835123\)$/m);
});

test("buildRoutineHeader — no id/storage omits the memory line, never crashes", () => {
  const h = buildRoutineHeader({ name: "r" }, { nowMs: NOW });
  assert.ok(!h.includes("Automation memory:"), "memory line omitted without a path");
  assert.match(h, /^Automation ID: —$/m);
});

test("prependRoutineHeader — header sits atop the body with a blank line", () => {
  const out = prependRoutineHeader("Do the thing.", "Automation: r");
  assert.equal(out, "Automation: r\n\nDo the thing.");
});

test("prependRoutineHeader — a non-string body passes through untouched", () => {
  assert.equal(prependRoutineHeader(undefined, "h"), undefined);
  assert.equal(prependRoutineHeader("body", ""), "body");
});
