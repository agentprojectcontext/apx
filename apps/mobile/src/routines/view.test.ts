import assert from "node:assert/strict";
import { test } from "node:test";
import type { RoutineRun } from "../../../../packages/protocol/src/index.ts";
import { failStreak, flowText, routineStatus, runOutcome, scheduleText } from "./view.ts";

const now = new Date(2026, 9, 7, 14, 0);
const run = (state: string, minutesAgo: number, extra: Partial<RoutineRun> = {}) =>
  ({
    run_id: `r${minutesAgo}`,
    thread_id: "t",
    state,
    started_at: new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
    ...extra,
  }) as RoutineRun;

test("schedules read as the panel says them", () => {
  assert.equal(scheduleText({ kind: "every", minutes: 30 }, "es"), "Cada 30 minutos");
  assert.equal(scheduleText({ kind: "every", minutes: 60 }, "es"), "Cada hora");
  assert.equal(scheduleText({ kind: "every", minutes: 120 }, "en"), "Every 2 hours");
  assert.equal(scheduleText({ kind: "cron", cron: "0 8 * * *" }, "es"), "Todos los días a las 08:00");
  assert.equal(scheduleText({ kind: "cron", cron: "30 8 * * 1-5" }, "es"), "Días hábiles a las 08:30");
  assert.equal(scheduleText({ kind: "cron", cron: "0 9 * * 1,3" }, "es"), "Lun, Mié a las 09:00");
  assert.equal(scheduleText({ kind: "cron", cron: "*/5 * * * *" }, "es"), "cron */5 * * * *");
  assert.equal(scheduleText({ kind: "manual" }, "es"), "A mano");
});

test("a flow names its steps in order", () => {
  const base = { enabled: true, schedule: { kind: "manual" as const } };
  assert.equal(
    flowText({ ...base, action: "agent", pre_command: "x", post_command: "y" }, "Roby", "es"),
    "Pre-comando → Roby → Post-comando",
  );
  assert.equal(flowText({ ...base, action: "shell", pre_command: "x" }, "Roby", "es"), "Comando");
  assert.equal(flowText({ ...base, action: "watch" }, "Roby", "en"), "Roby watches");
});

test("each run ends as told, ran, skipped, failed or still live", () => {
  assert.equal(runOutcome(run("failed", 1), "agent"), "failed");
  assert.equal(runOutcome(run("working", 1), "agent"), "live");
  assert.equal(runOutcome(run("completed", 1, { model_called: false }), "agent"), "skipped");
  assert.equal(runOutcome(run("completed", 1, { delivered: true }), "agent"), "told");
  assert.equal(runOutcome(run("completed", 1), "shell"), "ran");
});

test("the status says what comes next, or that it keeps failing", () => {
  const routine = {
    enabled: true,
    action: "agent",
    schedule: { kind: "every" as const, minutes: 30 },
    next_run_at: new Date(now.getTime() + 12 * 60_000).toISOString(),
  };
  assert.deepEqual(routineStatus(routine, [run("completed", 18)], now, "es"), {
    text: "Próxima en 12 min · última hace 18 min",
    bad: false,
  });
  assert.equal(failStreak([run("failed", 1), run("failed", 2), run("completed", 3)]), 2);
  assert.deepEqual(routineStatus(routine, [run("failed", 1), run("failed", 2)], now, "es"), {
    text: "Falló 2 veces seguidas",
    bad: true,
  });
  const later = { ...routine, next_run_at: new Date(2026, 9, 7, 21, 30).toISOString() };
  assert.equal(routineStatus(later, [], now, "es").text, "Próxima hoy 21:30");
  assert.deepEqual(routineStatus({ ...routine, enabled: false }, [], now, "es"), { text: "Pausada", bad: false });
});
