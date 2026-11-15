import { z } from "zod";
import { Id } from "./domain-projects.ts";
import { schemaFields } from "./schema-fields.ts";

export const OutboxState = z.enum(["queued", "sending", "sent", "uncertain", "failed"]);
export const OutboxItem = z.object(
  schemaFields({
    id: () => Id,
    channel: () => z.string(),
    conversation: () => z.string(),
    thread_id: () => Id.optional(),
    kind: () => z.enum(["reply", "notice", "pairing", "input"]),
    text: () => z.string(),
    state: () => OutboxState,
    attempts: () => z.number().int(),
    error: () => z.string().optional(),
    /** A sticker that went out: what it shows ("" when it has no name). */
    sticker: () => z.string().optional(),
    /** An emoji the agent put on a message there. */
    reaction: () => z.string().optional(),
    created_at: () => z.string(),
    updated_at: () => z.string(),
  }),
);
export type OutboxItem = z.infer<typeof OutboxItem>;

/** An MCP server an agent may use: the owner's own, or one a project's `.apc/mcps.json` names. */
export const McpServerStatus = z.object(
  schemaFields({
    name: () => z.string(),
    scope: () => z.enum(["global", "project"]),
    project_id: () => Id.optional(),
    transport: () => z.enum(["stdio", "http"]),
    /** The command line or URL (no secret values: those are references). */
    target: () => z.string(),
    enabled: () => z.boolean(),
    /** A project's server runs only after the owner approved this exact definition. */
    trusted: () => z.boolean(),
    /** needs-sign-in: it asked the owner to sign in in their browser and is not started again until they do. */
    status: () => z.enum(["off", "needs-approval", "disabled", "starting", "ready", "error", "needs-sign-in"]),
    /** The page it asked the owner to open, while it still waits for them there. */
    sign_in_url: () => z.string().optional(),
    tools: () => z.number().int(),
    /** Tool names once it has started. */
    tool_names: () => z.array(z.string()).default([]),
    /** Owner-wide grants for the current tool contracts; unknown until tools have been loaded. */
    tool_permission_mode: () => z.enum(["unknown", "ask", "all", "some"]).default("unknown"),
    /** Stored secrets its definition names (`secret://NAME`), and whether each has a value. */
    vars: () =>
      z
        .array(
          z.object(
            schemaFields({
              name: () => z.string(),
              set: () => z.boolean(),
            }),
          ),
        )
        .default([]),
    /** One of the owner's servers that runs only in its project (`project_id`), like v1's per-project servers. */
    only: () => z.boolean().default(false),
    /** A global server turned off inside the project asked about. */
    off_here: () => z.boolean().default(false),
    /** A global server: the projects it is turned off in (every other project gets it). */
    off_in: () => z.array(Id).default([]),
    /**
     * As it is defined, to edit it: one the owner added in APX (values hold secret:// references, never the secrets) or
     * a project's file. Absent for an extension's servers (they come with the extension).
     */
    definition: () =>
      z
        .object(
          schemaFields({
            command: () => z.string().optional(),
            args: () => z.array(z.string()),
            env: () => z.record(z.string(), z.string()),
            url: () => z.string().optional(),
            headers: () => z.record(z.string(), z.string()),
          }),
        )
        .optional(),
    error: () => z.string().optional(),
  }),
);
export type McpServerStatus = z.infer<typeof McpServerStatus>;

/** One primitive for widgets, sidebar panels and fullscreen apps. */
/** A widget's state: JSON values by key. */
export const SurfaceState = z.record(z.string().min(1).max(100), z.unknown());
export type SurfaceState = z.infer<typeof SurfaceState>;
/** An origin a widget may read live data from: https or wss, a host and maybe a port, nothing else. */
export const SurfaceOrigin = z
  .string()
  .max(200)
  .regex(/^(https|wss):\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?$/);

/** Where an installed artifact came from: who made it, and where, as its file said. Absent for one made here. */
export const ArtifactOrigin = z.object(
  schemaFields({
    /** The person whose APX it was exported from. */
    author: () => z.string().max(80).optional(),
    /** The agent that made it there. */
    agent: () => z.string().max(80).optional(),
    /** The project it belonged to there. */
    project: () => z.string().max(120).optional(),
    /** Its version when exported. */
    version: () => z.number().int().min(1).optional(),
    exported_at: () => z.string().max(40).optional(),
    installed_at: () => z.string().max(40),
  }),
);
export type ArtifactOrigin = z.infer<typeof ArtifactOrigin>;
export const Surface = z.object(
  schemaFields({
    id: () => Id,
    /** Stable name an agent updates by ("ventas-mes"). Unique per project (or globally when no project). */
    name: () => z.string(),
    title: () => z.string(),
    html: () => z.string(),
    version: () => z.number().int(),
    pinned: () => z.boolean(),
    /** What it is: an app (fullscreen, its own navigation), decided when it is made; otherwise a widget or a page. */
    app: () => z.boolean(),
    /** A web page: shown as a browser shows it (its own styles, no kit or memory), with its code and an editor. */
    page: () => z.boolean().optional(),
    /** Where it is listed: in Apps in the sidebar. An app made is; a widget is when the owner puts it there. */
    in_apps: () => z.boolean().optional(),
    project_id: () => Id.optional(),
    thread_id: () => Id.optional(),
    created_by: () => Id,
    updated_at: () => z.string(),
    /** Path of the public link (/a/<token>) when published; absent when private. */
    share_path: () => z.string().optional(),
    /** Origins it may connect to for live data (shown to the owner); absent: no network at all. */
    connect: () => z.array(SurfaceOrigin).max(5).optional(),
    /** What it remembers (APX.state): kept across openings and new versions, read and written by it and its agent. */
    state: () => SurfaceState.optional(),
    /** Installed from a file: who made it and where. */
    origin: () => ArtifactOrigin.optional(),
  }),
);
export type Surface = z.infer<typeof Surface>;
export const SurfaceSummary = Surface.omit({ html: true, state: true });
export type SurfaceSummary = z.infer<typeof SurfaceSummary>;

/** Most an artifact's store (APX.store) may hold, as JSON bytes of every value together. */
export const ARTIFACT_STORE_MAX = 5_000_000;
/** Largest an artifact's database file (APX.db) may grow. */
export const ARTIFACT_DB_MAX = 50_000_000;
/** An artifact's own secret key (its full name is `artifact.<name>.<key>`). */
export const ArtifactSecretKey = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9][a-z0-9_-]*$/);
/** What an artifact is, as a bundle names it: enough to install it again without its owner's data. */
export const ArtifactManifest = z.object(
  schemaFields({
    name: () =>
      z
        .string()
        .min(1)
        .max(60)
        .regex(/^[a-z0-9][a-z0-9-]*$/),
    title: () => z.string().min(1).max(120),
    kind: () => z.enum(["widget", "app"]),
    version: () => z.number().int().min(1),
    /** The kit version its HTML loads (/_apx/kit@<version>.js). */
    kit: () => z.string().max(40).optional(),
    connect: () => z.array(SurfaceOrigin).max(5).optional(),
    /** Secret keys it expects, never their values. */
    secrets: () => z.array(ArtifactSecretKey).max(20).optional(),
    live: () => z.boolean().optional(),
    /** Schema version of its database, for future migrations. */
    data_version: () => z.number().int().min(0).optional(),
    source: () =>
      z
        .object(
          schemaFields({
            framework: () => z.enum(["preact", "html"]).optional(),
            built_at: () => z.string().optional(),
          }),
        )
        .optional(),
    /** Who made it: the person whose APX exported it, its agent and its project there (kept through later exports). */
    author: () => z.string().max(80).optional(),
    agent: () => z.string().max(80).optional(),
    project: () => z.string().max(120).optional(),
    exported_at: () => z.string().max(40).optional(),
  }),
);
export type ArtifactManifest = z.infer<typeof ArtifactManifest>;
/** One artifact as a file: its page and, only when asked, its memory (state, store, base64 database). */
export const ArtifactBundle = z.object(
  schemaFields({
    format: () => z.literal("apx-artifact@1"),
    manifest: () => ArtifactManifest,
    html: () => z.string().min(1).max(400_000),
    state: () => SurfaceState.optional(),
    store: () => z.record(z.string(), z.unknown()).optional(),
    db: () => z.string().optional(),
  }),
);
export type ArtifactBundle = z.infer<typeof ArtifactBundle>;
/** A value bound to an artifact's SQL: what SQLite takes as a parameter. */
export const ArtifactSqlParam = z.union([z.string(), z.number(), z.null(), z.boolean()]);
/** What an artifact remembers, sizes only (its contents stay with it). */
export const ArtifactMemory = z.object(
  schemaFields({
    state_chars: () => z.number().int(),
    store: () =>
      z.object(
        schemaFields({
          keys: () => z.array(z.string()),
          bytes: () => z.number().int(),
        }),
      ),
    db: () =>
      z.object(
        schemaFields({
          bytes: () => z.number().int(),
          tables: () =>
            z.array(
              z.object(
                schemaFields({
                  name: () => z.string(),
                  rows: () => z.number().int(),
                }),
              ),
            ),
        }),
      ),
    /** The origin each of its secrets was first sent to; it is sent nowhere else until the owner resets the pins. */
    secrets: () =>
      z.array(
        z.object(
          schemaFields({
            key: () => z.string(),
            origin: () => z.string(),
          }),
        ),
      ),
  }),
);
export type ArtifactMemory = z.infer<typeof ArtifactMemory>;
