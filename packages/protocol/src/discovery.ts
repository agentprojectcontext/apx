import { z } from "zod";
import { deferMethod } from "./defer-method.ts";
import { schemaFields } from "./schema-fields.ts";

const PublicPage = z
  .string()
  .url()
  .max(2000)
  .refine((raw) => {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
  }, "Use a public HTTPS page without credentials or query parameters");

export const DiscoverySource = z
  .object(
    schemaFields({
      project: () => z.string().min(1).optional(),
      label: () => z.string().trim().min(1).max(120),
      public_terms: () => z.string().trim().max(120),
      pages: () => z.array(PublicPage).min(1).max(8),
    }),
  )
  .strict();

export const DiscoverySettings = z
  .object(
    schemaFields({
      enabled: () => z.boolean(),
      projects: () => z.enum(["all", "selected"]),
      project_ids: () => z.array(z.string().min(1)).max(500),
      sources: () => z.array(DiscoverySource).max(100),
      project_context: () => z.boolean(),
      project_websites: () => z.boolean(),
      interest_news: () => z.boolean(),
      interests: () => z.array(z.string().trim().min(1).max(120)).max(30),
      location: () => z.string().trim().max(120),
      deep_every_days: () => z.number().int().min(1).max(14),
      timezone: () =>
        z
          .string()
          .min(1)
          .max(100)
          .refine((zone) => {
            try {
              new Intl.DateTimeFormat("en", { timeZone: zone }).format();
              return true;
            } catch {
              return false;
            }
          }, "Choose a valid time zone"),
      report_routine: () => z.string().nullable(),
      max_model_calls: () => z.number().int().min(1).max(20),
      max_pages: () => z.number().int().min(2).max(40),
      max_seconds: () => z.number().int().min(30).max(600),
      cooldown_days: () => z.number().int().min(1).max(90),
    }),
  )
  .strict();
export type DiscoverySettings = z.infer<typeof DiscoverySettings>;

export const DiscoveryEvidence = z.object(
  schemaFields({
    url: () => z.string().url(),
    title: () => z.string().max(300),
    quote: () => z.string().min(12).max(1200),
    read_at: () => z.string().datetime(),
  }),
);
export const DiscoveryFinding = z.object(
  schemaFields({
    id: () => z.string(),
    topic: () => z.string().max(200),
    fingerprint: () => z.string().optional(),
    project: () => z.string().optional(),
    title: () => z.string().max(180),
    summary: () => z.string().max(1600),
    action: () => z.string().max(600),
    uncertainty: () => z.string().max(800),
    evidence: () => z.array(DiscoveryEvidence).min(1).max(4),
    found_at: () => z.string().datetime(),
    expires_at: () => z.string().datetime(),
    included_at: () => z.string().datetime().optional(),
    reserved_at: () => z.string().datetime().optional(),
    feedback: () => z.enum(["useful", "not_useful", "mute"]).optional(),
  }),
);
export type DiscoveryFinding = z.infer<typeof DiscoveryFinding>;

export const DiscoverySourceFailure = z.object({
  url: z.string(),
  reason: z.string().max(200),
  kind: z.enum(["unreadable", "changed_site", "search_unavailable", "unverified"]),
});
export type DiscoverySourceFailure = z.infer<typeof DiscoverySourceFailure>;

export const DiscoveryStatus = z.object(
  schemaFields({
    settings: () => DiscoverySettings,
    available: () => z.boolean(),
    state: () => z.enum(["waiting", "working", "completed", "failed", "uncertain", "cancelled"]),
    next_at: () => z.string().datetime().optional(),
    deep_next_at: () => z.string().datetime().optional(),
    last_at: () => z.string().datetime().optional(),
    coverage: () =>
      z.array(
        z.object({
          project: z.string(),
          reviewed_at: z.string().datetime().optional(),
          planned_at: z.string().datetime().optional(),
          researched_at: z.string().datetime().optional(),
        }),
      ),
    findings: () => z.array(DiscoveryFinding).max(100),
    muted_topics: () => z.array(z.object({ id: z.string(), title: z.string() })).max(500),
    inaccessible: () => z.array(DiscoverySourceFailure).max(40),
  }),
);
export type DiscoveryStatus = z.infer<typeof DiscoveryStatus>;

export const discoveryMethods = {
  "discovery.settings": deferMethod({
    params: () => z.object({}).strict(),
    result: () => DiscoveryStatus,
    effect: false,
    access: "human",
  }),
  "discovery.configure": deferMethod({
    params: () => DiscoverySettings.partial().extend({ expected: DiscoverySettings.optional() }).strict(),
    result: () => DiscoveryStatus,
    effect: true,
    access: "human",
  }),
  "discovery.feedback": deferMethod({
    params: () =>
      z.object({ finding: z.string().min(1), feedback: z.enum(["useful", "not_useful", "mute", "unmute"]) }).strict(),
    result: () => DiscoveryStatus,
    effect: true,
    access: "human",
  }),
} as const;
