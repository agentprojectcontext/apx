// Extensions: the manifest an extension brings, what the owner sees of one, and what the catalogs list.
import { z } from "zod";
import { EXTENSION_ARCHIVE_MAX } from "./constants.ts";
import { Schedule } from "./office.ts";
import { schemaFields } from "./schema-fields.ts";

/** Events a plugin may watch. */
export const PluginEvent = z.enum([
  "thread.updated",
  "message.created",
  "run.updated",
  "task.updated",
  "notification.updated",
]);
export type PluginEvent = z.infer<typeof PluginEvent>;

/** An extension's id. */
const ExtId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,19}$/);
/** Names inside an extension (MCP servers, secrets): no "-", so `<id>-<name>` always splits one way. */
const ExtName = z.string().regex(/^[a-z0-9][a-z0-9_]{0,19}$/);

/**
 * `apx-extension.json`: what an extension brings, readable without running anything. Paths are relative to its
 * folder; `secret://name` in an MCP server means the extension's own secret `name`, declared under `secrets`.
 */
export const ExtensionManifest = z
  .object(
    schemaFields({
      id: () => ExtId,
      name: () => z.string().trim().min(1).max(80),
      version: () => z.string().max(40),
      description: () => z.string().max(500).default(""),
      /** A folder of skill folders (each with a SKILL.md). */
      skills: () => z.string().max(200).optional(),
      mcp: () =>
        z
          .record(
            ExtName,
            z
              .object(
                schemaFields({
                  command: () => z.string().max(200).optional(),
                  args: () => z.array(z.string().max(500)).max(40).default([]),
                  env: () => z.record(z.string(), z.string().max(500)).default({}),
                  url: () => z.string().max(500).optional(),
                  headers: () => z.record(z.string(), z.string().max(500)).default({}),
                }),
              )
              .strict(),
          )
          .default({}),
      /** Routines the owner can add from it (they pick the agent). */
      routines: () =>
        z
          .array(
            z
              .object(
                schemaFields({
                  name: () => z.string().max(120),
                  schedule: () => Schedule,
                  prompt: () => z.string().max(20_000),
                }),
              )
              .strict(),
          )
          .max(20)
          .default([]),
      secrets: () =>
        z
          .array(
            z
              .object(
                schemaFields({
                  name: () => ExtName,
                  label: () => z.string().max(120),
                  url: () => z.string().max(500).optional(),
                }),
              )
              .strict(),
          )
          .max(10)
          .default([]),
      /**
       * Code that runs beside APX in a separate process (it reads only its folder and writes only its data folder). It
       * can watch the events it names and add context to the owner's turns; it never calls APX.
       */
      plugin: () =>
        z
          .object(
            schemaFields({
              entry: () => z.string().max(200),
              observe: () => z.array(PluginEvent).max(10).default([]),
              context: () => z.boolean().default(false),
              /** Whether it may reach the internet (never this machine). */
              network: () => z.boolean().default(false),
              /** Whether it may also reach the local network and the owner's tailnet (a home device, a NAS). */
              local_network: () => z.boolean().default(false),
            }),
          )
          .strict()
          .optional(),
    }),
  )
  .strict();
export type ExtensionManifest = z.infer<typeof ExtensionManifest>;

/**
 * One thing an extension may do, to compare two versions: an MCP server (its command or address in `detail`), a host it
 * reaches, a secret it asks for, a routine, its plugin and what that plugin may reach or watch.
 */
export const ExtensionPower = z.object(
  schemaFields({
    kind: () =>
      z.enum(["mcp", "host", "secret", "routine", "plugin", "internet", "local_network", "context", "observe"]),
    name: () => z.string(),
    detail: () => z.string().optional(),
  }),
);
export type ExtensionPower = z.infer<typeof ExtensionPower>;

/** Where an extension came from by its fingerprint: the official APX catalog lists these exact files, or not. */
export const ExtensionProvenance = z.enum(["official", "third_party"]);
export type ExtensionProvenance = z.infer<typeof ExtensionProvenance>;

/** What to read an extension from: exactly one of a folder on the core's computer, an `.apxext` file or an https URL. */
export const ExtensionSource = {
  path: () => z.string().min(1).max(1000).optional(),
  file: () =>
    z
      .object({
        name: z.string().max(200),
        data: z
          .string()
          .min(1)
          .max(Math.ceil(EXTENSION_ARCHIVE_MAX / 3) * 4 + 100),
      })
      .strict()
      .optional(),
  url: () => z.string().min(9).max(2000).startsWith("https://").optional(),
};

/** What an extension brings, to filter by: an account it connects, tools, skills, ready-made agents, a device. */
export const ExtensionBrings = z.enum(["accounts", "tools", "skills", "agents", "devices"]);
export type ExtensionBrings = z.infer<typeof ExtensionBrings>;

/** What it needs or does that the owner should know before installing: a Mac, an app on a phone or TV, code, cost. */
export const ExtensionNeeds = z.enum(["mac", "phone", "tv", "code", "cost"]);
export type ExtensionNeeds = z.infer<typeof ExtensionNeeds>;

/** Where a listing files it; the marketplace writes the id or its label (English or Spanish). */
export const ExtensionCategory = z.enum([
  "productivity",
  "communication",
  "docs-notes",
  "files",
  "development",
  "data",
  "design-media",
  "sales-customers",
  "finance",
  "marketing",
  "devices-home",
  "search-research",
  "business-systems",
]);
export type ExtensionCategory = z.infer<typeof ExtensionCategory>;

/** How it connects: nothing to do, a key typed once, a sign-in in the browser, a paired app, or something on this computer. */
export const ExtensionConnection = z.enum(["none", "key", "oauth", "pairing", "local"]);
export type ExtensionConnection = z.infer<typeof ExtensionConnection>;

const ListingCopy = {
  summary: () => z.string(),
  /** One short line (at most 60 characters). */
  tagline: () => z.string().optional(),
  /** The long description, in Markdown. */
  description: () => z.string().optional(),
  features: () => z.array(z.string()),
  requirements: () => z.array(z.string()),
  limits: () => z.array(z.string()),
  pricing: () => z.string(),
  privacy: () => z.string(),
  /** Things to ask it, as the owner would. */
  prompts: () => z.array(z.string()),
  /** One caption per screenshot, in order. */
  captions: () => z.array(z.string()),
};
/**
 * Its page (`apx-listing.json`, or the catalog's card of it): what it does, needs and does not, cost, privacy, its
 * icon and screenshots (files in the package), example requests and links, in English and Spanish.
 */
export const ExtensionListing = z.object(
  schemaFields({
    ...ListingCopy,
    category: () => ExtensionCategory.optional(),
    connection: () => ExtensionConnection.optional(),
    icon: () => z.string().optional(),
    screenshots: () => z.array(z.string()),
    links: () =>
      z
        .object(
          schemaFields({
            website: () => z.string().optional(),
            privacy: () => z.string().optional(),
            terms: () => z.string().optional(),
            docs: () => z.string().optional(),
          }),
        )
        .optional(),
    publisher: () => z.object(schemaFields({ name: () => z.string(), verified: () => z.boolean() })).optional(),
    es: () => z.object(schemaFields(ListingCopy)).optional(),
  }),
);
export type ExtensionListing = z.infer<typeof ExtensionListing>;

/** One extension a catalog offers, at its newest version. */
export const CatalogEntry = z.object(
  schemaFields({
    id: () => z.string(),
    name: () => z.string(),
    description: () => z.string(),
    categories: () => z.array(z.string()),
    /** As the index copies them from its listing, to show it before its package is read. */
    tagline: () => z.string().optional(),
    category: () => ExtensionCategory.optional(),
    /** The index's icon for it (an https address), shown before its package is read. */
    icon_url: () => z.string().optional(),
    version: () => z.string(),
    /** Official when listed by APX's catalog under the official tier; every other catalog's are third party. */
    provenance: () => ExtensionProvenance,
    /** The .apxext to install it from. */
    url: () => z.string().optional(),
    /** From the package's own manifest, once APX read it (absent while it could not). */
    brings: () => z.array(ExtensionBrings).optional(),
    needs: () => z.array(ExtensionNeeds).optional(),
    listing: () => ExtensionListing.optional(),
  }),
);
export type CatalogEntry = z.infer<typeof CatalogEntry>;

/** An installed extension as the owner sees it: what it brings and whether it is on. */
export const ExtensionInfo = z.object(
  schemaFields({
    id: () => z.string(),
    name: () => z.string(),
    version: () => z.string(),
    description: () => z.string(),
    enabled: () => z.boolean(),
    /** Fingerprint of its files: turning it on approves exactly these. */
    hash: () => z.string(),
    /** The folder it was installed from. */
    source: () => z.string(),
    skills: () => z.array(z.string()),
    mcp: () => z.array(z.string()),
    routines: () => ExtensionManifest.shape.routines,
    secrets: () =>
      z.array(
        z.object(
          schemaFields({
            name: () => z.string(),
            label: () => z.string(),
            url: () => z.string().optional(),
            set: () => z.boolean(),
          }),
        ),
      ),
    plugin: () =>
      z
        .object(
          schemaFields({
            observe: () => z.array(PluginEvent),
            context: () => z.boolean(),
            network: () => z.boolean(),
            local_network: () => z.boolean(),
            status: () => z.enum(["off", "running", "error"]),
            error: () => z.string().optional(),
          }),
        )
        .optional(),
    /** It brings code that runs on this computer (an MCP command or a plugin): turning it on trusts its author. */
    runs_code: () => z.boolean(),
    installed_at: () => z.string(),
    provenance: () => ExtensionProvenance,
    brings: () => z.array(ExtensionBrings),
    needs: () => z.array(ExtensionNeeds),
    /** The hosts its servers connect to. */
    hosts: () => z.array(z.string()),
    listing: () => ExtensionListing.optional(),
    /** Why the official catalog could not be asked: none reachable now and none kept, or it needs a newer APX. */
    catalog: () => z.enum(["unreachable", "needs_update"]).optional(),
    /**
     * Against another version: on an installed one, the previous version kept to go back to; when inspecting, the
     * version installed now. `keeps_on`: installing it leaves an extension that is on still on.
     */
    update: () =>
      z
        .object(
          schemaFields({
            from: () => z.string(),
            adds: () => z.array(ExtensionPower),
            removes: () => z.array(ExtensionPower),
            keeps_on: () => z.boolean().optional(),
          }),
        )
        .optional(),
  }),
);
export type ExtensionInfo = z.infer<typeof ExtensionInfo>;
