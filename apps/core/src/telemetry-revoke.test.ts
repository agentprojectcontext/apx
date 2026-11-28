import assert from "node:assert/strict";
import { test } from "node:test";
import type { TelemetryEvent } from "@apx/protocol";
import { say, scriptedLlm, startCore } from "./engine/testkit.ts";
import { createLog } from "./log.ts";
import { createTelemetry } from "./telemetry.ts";
import { countUsage } from "./telemetry-counts.ts";

test("revoking usage while a flush is queued drops its old counts and does not send a usage report", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  const blocked = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let at = new Date("2026-04-01T10:00:00Z");
  let hold = false;
  const events: TelemetryEvent[] = [];
  const telemetry = createTelemetry({
    home: env.home,
    store: env.core.store,
    log: createLog("test", true),
    version: "2.0.0",
    channel: "test",
    now: () => at,
    sink: async (event) => {
      if (hold && event.kind === "stage" && event.stage === "setup") {
        blocked.resolve();
        await release.promise;
      }
      events.push(event);
    },
  });
  try {
    telemetry.set(true);
    await telemetry.flush();
    countUsage(env.core.store, "signins");
    at = new Date("2026-04-02T10:00:00Z");
    env.core.store.settings.set("setup_done", "1");
    hold = true;
    const flushing = telemetry.flush();
    await blocked.promise;
    await env.client.call("telemetry.set", { usage: false });
    countUsage(env.core.store, "signins");
    release.resolve();
    await flushing;
    await telemetry.flush();
    assert.equal(telemetry.get().usage, false);
    assert.equal(
      events.some((event) => event.kind === "usage"),
      false,
    );
    assert.equal(telemetry.get().preview.signins, undefined);
    telemetry.set(true);
    await telemetry.flush();
    at = new Date("2026-04-03T10:00:00Z");
    await telemetry.flush();
    const report = events.findLast((event) => event.kind === "usage");
    assert.ok(report?.kind === "usage");
    assert.equal(report.stats.signins, undefined, "reenabling cannot send the revoked queue");
  } finally {
    release.resolve();
    await telemetry.flush();
    await env.core.close();
    await env.cleanup();
  }
});
