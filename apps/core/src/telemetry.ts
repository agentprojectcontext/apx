// Telemetry: the lifecycle steps of this install (installed → opened → consent → setup → first_run, then updated on
// each new version) under a random id of its own, and a daily usage report only after the owner said yes. Each step is
// sent once and kept until it lands, so a computer offline today reports tomorrow. See rules/DECISIONS.md#d-092.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type InstallInfo,
  TELEMETRY_STAGES,
  type TelemetryChannel,
  type TelemetryEvent,
  type TelemetryStage,
  type TelemetryState,
  type UsageStats,
} from "@apx/protocol";
import type { Store } from "./domain/store.ts";
import { errorMessage } from "./errors.ts";
import type { Log } from "./log.ts";
import type { TelemetrySink } from "./telemetry-sink.ts";

const EVERY_MS = 30 * 60_000;
const FIRST_MS = 20_000;
const SETUP_DONE = "setup_done";

export type Telemetry = ReturnType<typeof createTelemetry>;

export function createTelemetry(opts: {
  home: string;
  store: Store;
  log: Log;
  version: string;
  channel: TelemetryChannel;
  /** undefined: this APX sends nothing (APX_TELEMETRY=off, DO_NOT_TRACK, CI, a test). */
  sink: TelemetrySink | undefined;
  now?: () => Date;
}) {
  const { store, sink } = opts;
  const clock = opts.now ?? (() => new Date());
  const installId = readInstallId(opts.home);
  const info: InstallInfo = { version: opts.version, os: process.platform, arch: os.arch(), channel: opts.channel };
  const state = () => store.settings.read("telemetry");
  const save = (patch: Partial<ReturnType<typeof state>>) =>
    store.settings.write("telemetry", { ...state(), ...patch });

  /** The steps due now, in order: each needs the one before it to have landed (the record is created by the first). */
  const due = (): TelemetryStage[] => {
    const s = state();
    const want: Record<TelemetryStage, boolean> = {
      installed: true,
      opened: Boolean(s.opened_at),
      // Sent again when the owner changes their answer.
      consent: s.usage !== null && s.usage !== s.usage_reported,
      setup: store.settings.get(SETUP_DONE) === "1",
      first_run: store.messages.anyFromOwner(),
      updated: Boolean(s.reported_version && s.reported_version !== opts.version),
    };
    const again = new Set<TelemetryStage>(["consent", "updated"]);
    return TELEMETRY_STAGES.filter((st) => want[st] && (again.has(st) || !s.sent[st]));
  };

  const stats = (since: string): UsageStats => {
    const rows = store.runs.usage(since);
    return {
      tokens_in: rows.reduce((n, r) => n + r.input, 0),
      tokens_out: rows.reduce((n, r) => n + r.output, 0),
      runs: rows.reduce((n, r) => n + r.runs, 0),
      projects: store.projects.list().length,
      agents: store.agents.list().length,
      channels: store.settings.read("channels").length,
      routines: store.routines.list().length,
    };
  };

  const send = async (event: TelemetryEvent) => {
    if (!sink) return false;
    await sink(event);
    save({ last: { at: clock().toISOString(), event } });
    return true;
  };

  const flushOnce = async () => {
    if (!sink) return;
    for (const stage of due()) {
      const s = state();
      const event: TelemetryEvent = {
        kind: "stage",
        install_id: installId,
        stage,
        info,
        ...(s.usage === null ? {} : { usage: s.usage }),
      };
      await send(event);
      const at = clock().toISOString();
      const after = state();
      save({
        sent: { ...after.sent, [stage]: at },
        ...(stage === "installed" || stage === "updated" ? { reported_version: opts.version } : {}),
        ...(stage === "consent" ? { usage_reported: event.usage ?? null } : {}),
      });
    }
    const s = state();
    const today = clock().toISOString().slice(0, 10);
    // The first report is the day after the owner's yes: nothing from before it is ever counted.
    if (s.usage === true && s.usage_from && s.usage_day !== today) {
      await send({
        kind: "usage",
        install_id: installId,
        day: today,
        version: opts.version,
        stats: stats(s.usage_from),
      });
      save({ usage_day: today, usage_from: clock().toISOString() });
    }
  };

  let running: Promise<void> | undefined;
  let warned = false;
  /** Sends what is due; one at a time, and a failure waits for the next tick. */
  const flush = (): Promise<void> => {
    running ??= flushOnce()
      .then(() => {
        warned = false;
      })
      .catch((err) => {
        if (!warned) opts.log.warn({ err: errorMessage(err) }, "telemetry not sent; will try again");
        warned = true;
      })
      .finally(() => {
        running = undefined;
      });
    return running;
  };

  let timer: NodeJS.Timeout | undefined;
  const schedule = (ms: number) => {
    timer = setTimeout(() => {
      void flush().finally(() => schedule(EVERY_MS));
    }, ms);
    timer.unref();
  };

  return {
    installId,
    flush,
    start() {
      if (sink) schedule(FIRST_MS);
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
    get(): TelemetryState {
      const s = state();
      return {
        enabled: Boolean(sink),
        install_id: installId,
        usage: s.usage,
        sent: s.sent,
        last: s.last,
        preview: stats(s.usage_from ?? new Date(clock().getTime() - 86_400_000).toISOString()),
      };
    },
    set(usage: boolean): TelemetryState {
      const s = state();
      const at = clock().toISOString();
      // A new yes starts counting now; the day it was given is not reported.
      const fresh = usage && s.usage !== true;
      save({
        usage,
        ...(fresh ? { usage_from: at, usage_day: at.slice(0, 10) } : {}),
        ...(usage ? {} : { usage_from: null }),
      });
      void flush();
      return this.get();
    },
    seen() {
      if (!state().opened_at) save({ opened_at: clock().toISOString() });
      void flush();
    },
  };
}

/** A random id for telemetry alone, apart from the home id the panel and devices see: deleting the file resets it. */
function readInstallId(home: string): string {
  const file = path.join(home, "telemetry-id");
  try {
    const id = fs.readFileSync(file, "utf8").trim();
    if (/^[0-9a-f-]{36}$/.test(id)) return id;
  } catch {}
  fs.mkdirSync(home, { recursive: true });
  const id = randomUUID();
  fs.writeFileSync(file, `${id}\n`, { mode: 0o600 });
  return id;
}
