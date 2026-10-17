// What this APX tells the APX project about itself: a few lifecycle steps (installed, opened, set up, first used,
// updated) under a random install id, and — only if the owner said yes — a daily count of tokens and of what it holds.
// Nothing the owner wrote, no names, paths, models or keys. See rules/DECISIONS.md#d-092.
import { z } from "zod";

/** The lifecycle steps, in the order an install goes through them; `updated` repeats on each new version. */
export const TELEMETRY_STAGES = ["installed", "opened", "consent", "setup", "first_run", "updated"] as const;
export const TelemetryStage = z.enum(TELEMETRY_STAGES);
export type TelemetryStage = z.infer<typeof TelemetryStage>;

/** Where this APX came from: a git checkout, an install.sh/ps1 bundle, the desktop app. */
export const TelemetryChannel = z.enum(["source", "bundle", "app", "other", "test"]);
export type TelemetryChannel = z.infer<typeof TelemetryChannel>;

/** What every lifecycle step carries besides the install id. */
export const InstallInfo = z.object({
  version: z.string(),
  os: z.string(),
  arch: z.string(),
  channel: TelemetryChannel,
});
export type InstallInfo = z.infer<typeof InstallInfo>;

/** One day's usage, sent only with the owner's yes: totals over every model, and how many of each thing there are. */
export const UsageStats = z.object({
  tokens_in: z.number().int().min(0),
  tokens_out: z.number().int().min(0),
  runs: z.number().int().min(0),
  projects: z.number().int().min(0),
  agents: z.number().int().min(0),
  channels: z.number().int().min(0),
  routines: z.number().int().min(0),
});
export type UsageStats = z.infer<typeof UsageStats>;

export const TelemetryEvent = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("stage"),
    install_id: z.string(),
    stage: TelemetryStage,
    info: InstallInfo,
    /** The owner's answer on usage statistics, once they gave one. */
    usage: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("usage"),
    install_id: z.string(),
    /** The UTC day it was sent on (YYYY-MM-DD): one report per install and day. */
    day: z.string(),
    version: z.string(),
    stats: UsageStats,
  }),
]);
export type TelemetryEvent = z.infer<typeof TelemetryEvent>;

export const TelemetryState = z.object({
  /** false when this APX sends nothing at all (APX_TELEMETRY=off, DO_NOT_TRACK=1, CI). */
  enabled: z.boolean(),
  install_id: z.string(),
  /** The owner's answer on usage statistics; null until they gave one (the panel asks then). */
  usage: z.boolean().nullable(),
  /** Lifecycle steps already sent, with when. */
  sent: z.partialRecord(TelemetryStage, z.string()),
  /** The last thing sent, exactly as it left. */
  last: z.object({ at: z.string(), event: TelemetryEvent }).nullable(),
  /** The usage report the next day would send, so the owner sees it before saying yes. */
  preview: UsageStats,
});
export type TelemetryState = z.infer<typeof TelemetryState>;

export const telemetryMethods = {
  "telemetry.get": {
    params: z.object({}).strict(),
    result: TelemetryState,
    effect: false,
    access: "human",
  },
  /** The owner's answer on usage statistics (the first one also sends the `consent` step). */
  "telemetry.set": {
    params: z.object({ usage: z.boolean() }).strict(),
    result: TelemetryState,
    effect: true,
    access: "human",
  },
  /** The panel opened on this install: sends the `opened` step the first time. */
  "telemetry.seen": {
    params: z.object({}).strict(),
    result: z.object({ ok: z.literal(true) }),
    effect: true,
    access: "human",
  },
} as const;
