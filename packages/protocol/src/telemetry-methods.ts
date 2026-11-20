// What this APX tells the APX project about itself: a few lifecycle steps (installed, opened, set up, first used,
// updated) under a random install id, and — only if the owner said yes — a daily count of tokens, of what it holds and
// of a few things done that day. Nothing the owner wrote, no names, paths, URLs, models or keys. See
// rules/DECISIONS.md#d-092 and #d-257.
import { z } from "zod";
import { deferMethod } from "./defer-method.ts";
import { schemaFields } from "./schema-fields.ts";

/** The lifecycle steps, in the order an install goes through them; `updated` repeats on each new version. */
export const TELEMETRY_STAGES = ["installed", "opened", "consent", "setup", "first_run", "updated"] as const;
export const TelemetryStage = z.enum(TELEMETRY_STAGES);
export type TelemetryStage = z.infer<typeof TelemetryStage>;

/** Where this APX came from: a git checkout, an install.sh/ps1 bundle, the desktop app. */
export const TelemetryChannel = z.enum(["source", "bundle", "app", "other", "test"]);
export type TelemetryChannel = z.infer<typeof TelemetryChannel>;

/** What every lifecycle step carries besides the install id. */
export const InstallInfo = z.object(
  schemaFields({
    version: () => z.string(),
    os: () => z.string(),
    arch: () => z.string(),
    channel: () => TelemetryChannel,
  }),
);
export type InstallInfo = z.infer<typeof InstallInfo>;

/**
 * What is counted as it happens, only after the owner's yes: Marketplace searches (how many, and how many found
 * nothing; never the words), extension installs by where they came from, APX account sign-ins, public copies made and
 * live links ("Live from this computer") created. Undoing one later does not take it back.
 */
export const USAGE_COUNTS = [
  "searches",
  "searches_empty",
  "installs_official",
  "installs_catalog",
  "installs_file",
  "installs_url",
  "installs_folder",
  "installs_server",
  "signins",
  "public_artifacts",
  "public_links",
] as const;
export type UsageCount = (typeof USAGE_COUNTS)[number];
/** At most this many extension ids in one day's report. */
export const USAGE_EXTENSIONS_MAX = 50;
/** `id@version` of an extension from APX's catalog or a public suggested catalog; the version only when plain. */
export const UsageExtension = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,19}(@[0-9A-Za-z.+_-]{1,40})?$/);

const count = () => z.number().int().min(0);

/**
 * One day's usage, sent only with the owner's yes: totals over every model, how many of each thing there are, and the
 * counts above. The counts are optional so an older core's report (and an older record) still reads.
 */
export const UsageStats = z.object(
  schemaFields({
    tokens_in: count,
    tokens_out: count,
    runs: count,
    projects: count,
    agents: count,
    channels: count,
    routines: count,
    searches: () => count().optional(),
    searches_empty: () => count().optional(),
    installs_official: () => count().optional(),
    installs_catalog: () => count().optional(),
    installs_file: () => count().optional(),
    installs_url: () => count().optional(),
    installs_folder: () => count().optional(),
    installs_server: () => count().optional(),
    signins: () => count().optional(),
    public_artifacts: () => count().optional(),
    public_links: () => count().optional(),
    /** Each install from APX's catalog or a public suggested one, as `id@version`; others count only by kind. */
    extensions: () => z.array(UsageExtension).max(USAGE_EXTENSIONS_MAX).optional(),
  }),
);
export type UsageStats = z.infer<typeof UsageStats>;

export const TelemetryEvent = z.discriminatedUnion("kind", [
  z.object(
    schemaFields({
      kind: () => z.literal("stage"),
      install_id: () => z.string(),
      stage: () => TelemetryStage,
      info: () => InstallInfo,
      /** The owner's answer on usage statistics, once they gave one. */
      usage: () => z.boolean().optional(),
    }),
  ),
  z.object(
    schemaFields({
      kind: () => z.literal("usage"),
      install_id: () => z.string(),
      /** The UTC day it was sent on (YYYY-MM-DD): one report per install and day. */
      day: () => z.string(),
      version: () => z.string(),
      stats: () => UsageStats,
    }),
  ),
]);
export type TelemetryEvent = z.infer<typeof TelemetryEvent>;

export const TelemetryState = z.object(
  schemaFields({
    /** false when this APX sends nothing at all (APX_TELEMETRY=off, DO_NOT_TRACK=1, CI). */
    enabled: () => z.boolean(),
    install_id: () => z.string(),
    /** The owner's answer on usage statistics; null until they gave one (the panel asks then). */
    usage: () => z.boolean().nullable(),
    /** Lifecycle steps already sent, with when. */
    sent: () => z.partialRecord(TelemetryStage, z.string()),
    /** The last thing sent, exactly as it left. */
    last: () =>
      z
        .object(
          schemaFields({
            at: () => z.string(),
            event: () => TelemetryEvent,
          }),
        )
        .nullable(),
    /** The usage report the next day would send, so the owner sees it before saying yes. */
    preview: () => UsageStats,
  }),
);
export type TelemetryState = z.infer<typeof TelemetryState>;

export const telemetryMethods = {
  "telemetry.get": deferMethod({
    params: () => z.object({}).strict(),
    result: () => TelemetryState,
    effect: false,
    access: "human",
  }),
  /** The owner's answer on usage statistics (the first one also sends the `consent` step). */
  "telemetry.set": deferMethod({
    params: () =>
      z
        .object({
          usage: z.boolean(),
        })
        .strict(),
    result: () => TelemetryState,
    effect: true,
    access: "human",
  }),
  /** The panel opened on this install: sends the `opened` step the first time. */
  "telemetry.seen": deferMethod({
    params: () => z.object({}).strict(),
    result: () =>
      z.object({
        ok: z.literal(true),
      }),
    effect: true,
    access: "human",
  }),
  /**
   * Something the panel did that the usage report counts (only after the owner's yes; otherwise nothing is kept). A
   * Marketplace search says only how many it found, never what was typed.
   */
  "telemetry.note": deferMethod({
    params: () =>
      z
        .object({
          event: z.literal("marketplace_search"),
          results: z.number().int().min(0),
        })
        .strict(),
    result: () =>
      z.object({
        ok: z.literal(true),
      }),
    effect: true,
    access: "human",
  }),
} as const;
