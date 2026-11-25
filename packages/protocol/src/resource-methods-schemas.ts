import { z } from "zod";
import { SecretFieldKind } from "./browser.ts";
import { CALENDAR_LEAD, CHECK_EVERY } from "./constants.ts";
import { Id } from "./domain.ts";
import { schemaFields } from "./schema-fields.ts";

/** Google Calendar tells the owner of an event this many minutes before it starts, while it is on. */
export const CalendarReminders = z.object(
  schemaFields({
    enabled: () => z.boolean(),
    lead_min: () => z.number().int().min(CALENDAR_LEAD.min).max(CALENDAR_LEAD.max),
    /** How often Calendar is looked at; never less often than the lead time, so no event is missed. */
    every_min: () => z.number().int().min(CHECK_EVERY.min).max(CHECK_EVERY.max),
  }),
);
export type CalendarReminders = z.infer<typeof CalendarReminders>;
/** Gmail's mail check: whether new mail is looked at, how often, and whether only what Gmail marks important. */
export const MailCheck = z.object(
  schemaFields({
    enabled: () => z.boolean(),
    every_min: () => z.number().int().min(CHECK_EVERY.min).max(CHECK_EVERY.max),
    important_only: () => z.boolean(),
  }),
);
export type MailCheck = z.infer<typeof MailCheck>;
/** A Google Calendar event, or a whole recurring series, whose reminders the owner turned off. */
export const MutedEvent = z.object(
  schemaFields({
    /** The series' id (Google's recurringEventId), or the event's own id for a single event. */
    series: () => z.string().min(1).max(1024),
    title: () => z.string().max(300),
    at: () => z.string(),
  }),
);
export type MutedEvent = z.infer<typeof MutedEvent>;
/** An integration's own settings; only the ones it has are present. */
export const IntegrationSettings = z.object(
  schemaFields({
    reminders: () => CalendarReminders.optional(),
    /** Google Calendar's events the owner is not reminded of. */
    muted: () => z.array(MutedEvent).optional(),
    mail: () => MailCheck.optional(),
  }),
);

export const McpTarget = z
  .object(
    schemaFields({
      scope: () => z.enum(["global", "project"]),
      server: () => z.string(),
      project: () => Id.optional(),
    }),
  )
  .strict();

export const SkillName = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/);

/**
 * Where a skill's files live. apx: comes with APX (how to change APX itself; always on, read-only); owner: APX home
 * `skills/`; project: `.apx/skills/`; extension; claude, codex, cursor, agents: that app's own skills folder (in the
 * home or the project), read where it is, or linked into APX's.
 */
export const SkillSource = z.enum(["apx", "owner", "project", "extension", "claude", "codex", "cursor", "agents"]);
export type SkillSource = z.infer<typeof SkillSource>;

export const SkillInfo = z.object(
  schemaFields({
    name: () => z.string(),
    description: () => z.string(),
    scope: () => z.enum(["global", "project"]),
    project_id: () => Id.optional(),
    source: () => SkillSource,
    /** On where it was asked about (the project, or everywhere). */
    on: () => z.boolean(),
    /** Projects where the owner turned it off: any, for a global skill; a project's own, that project or its subprojects. */
    off_in: () => z.array(Id).default([]),
    /** Turned off everywhere: a project cannot turn it back on for itself. */
    off_everywhere: () => z.boolean().default(false),
    editable: () => z.boolean(),
    /** Where its SKILL.md lives, home shortened to ~. */
    path: () => z.string(),
    /** The same name found in other folders, hidden behind this one; `same` when that SKILL.md is identical. */
    copies: () =>
      z
        .array(
          z.object(
            schemaFields({
              source: () => SkillSource,
              scope: () => z.enum(["global", "project"]),
              path: () => z.string(),
              same: () => z.boolean(),
            }),
          ),
        )
        .default([]),
  }),
);
export type SkillInfo = z.infer<typeof SkillInfo>;

/** A zip is sent whole, as base64: skills are small. */
export const SKILL_ZIP_MAX = 8 * 1024 * 1024;

/** What to import skills from: a folder on the core's computer, a .zip, or a git repository (https or ssh). */
export const SkillImportSource = z.discriminatedUnion("kind", [
  z
    .object(
      schemaFields({
        kind: () => z.literal("folder"),
        path: () => z.string().min(1).max(1000),
      }),
    )
    .strict(),
  z
    .object(
      schemaFields({
        kind: () => z.literal("zip"),
        name: () => z.string().max(200).optional(),
        data: () =>
          z
            .string()
            .min(1)
            .max(Math.ceil(SKILL_ZIP_MAX / 3) * 4),
      }),
    )
    .strict(),
  z
    .object(
      schemaFields({
        kind: () => z.literal("repo"),
        url: () => z.string().min(1).max(500),
      }),
    )
    .strict(),
]);
export type SkillImportSource = z.infer<typeof SkillImportSource>;

/** A skill found in what is being imported, read without running anything. */
export const SkillCandidate = z.object(
  schemaFields({
    /** Its folder inside the source ("." for the root): what `skills.import` picks it by. */
    id: () => z.string(),
    name: () => z.string(),
    description: () => z.string(),
    /** The folder it lands in, in APX's skills or the project's `.apx/skills/`. */
    folder: () => z.string(),
    files: () =>
      z.array(
        z.object(
          schemaFields({
            path: () => z.string(),
            bytes: () => z.number().int(),
          }),
        ),
      ),
    /**
     * scripts: files an agent could run (they never run on import); app_only: frontmatter only another app reads
     * (`allowed-tools`…), kept but ignored; skipped: links, oversized or extra files left out.
     */
    notes: () =>
      z.array(
        z.object(
          schemaFields({
            kind: () => z.enum(["scripts", "app_only", "skipped"]),
            items: () => z.array(z.string()),
          }),
        ),
      ),
    /** new; exists: that folder is taken (kept unless replaced); reserved: one of APX's own names; invalid: no usable name. */
    status: () => z.enum(["new", "exists", "reserved", "invalid"]),
  }),
);
export type SkillCandidate = z.infer<typeof SkillCandidate>;

export const ImportTarget = {
  /** `global`: APX's skills; `project`: that project's `.apx/skills/`. */
  target: z.enum(["global", "project"]),
  project: Id.optional(),
};

/**
 * A site where agents may put a stored secret into a sign-in field: an exact origin (`https://app.acme.com`), or `*`
 * for any https site (http only on this computer).
 */
export const SecretSite = z.object(
  schemaFields({
    origin: () => z.union([z.literal("*"), z.string().url().max(4096)]),
    kind: () => SecretFieldKind,
  }),
);
export type SecretSite = z.infer<typeof SecretSite>;

/**
 * What a stored variable is for, when the owner said: a username, a password, a one-time code seed, or a sign-in
 * (`login`: a username and a password kept together, each filled into its own field). Unset: a plain variable.
 */
export const SecretField = z.enum(["username", "password", "otp", "login"]);
export type SecretField = z.infer<typeof SecretField>;

export const SecretInfo = z.object(
  schemaFields({
    name: () => z.string(),
    /** A project's own value: it wins over the global one of the same name for that project's MCP servers. */
    project_id: () => Id.optional(),
    updated_at: () => z.string(),
    /** The last four characters, kept only for values long enough that they give nothing away ("••••1a2b"). */
    hint: () => z.string().optional(),
    /** Where it is named: "mcp:github", "provider:openai", "service:qvox", "channel:telegram". */
    used_in: () => z.array(z.string()).default([]),
    /** APX keeps it for itself (a provider's key, a channel's token, a sign-in it holds); the screen it names manages it. */
    system: () => z.boolean().optional(),
    /** What it is for, when the owner said (a password, a username and password…). */
    field: () => SecretField.optional(),
    /** Sites where agents may sign in with it, and into which field (DECISIONS.md#d-193). */
    sites: () => z.array(SecretSite).default([]),
    /** The last sign-in an agent made with it. */
    last_used: () =>
      z
        .object(
          schemaFields({
            origin: () => z.string(),
            at: () => z.string(),
            agent: () => z.string().optional(),
          }),
        )
        .optional(),
  }),
);
export type SecretInfo = z.infer<typeof SecretInfo>;
