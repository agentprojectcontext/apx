// Methods for extensions: read one from a folder, file or URL, install it, turn it on, go back a version, give it its
// secrets, and browse the catalogs.
import { z } from "zod";
import { deferMethod } from "./defer-method.ts";
import { ArtifactBundle } from "./domain-artifacts.ts";
import { Agent } from "./domain-models.ts";
import { CatalogEntry, ExtensionCatalog, ExtensionInfo, ExtensionSource } from "./extensions.ts";

/** An extension is read from exactly one place. */
const oneSource = (p: { path?: unknown; file?: unknown; url?: unknown; entry?: unknown; server?: unknown }) =>
  [p.path, p.file, p.url, p.entry, p.server].filter((v) => v !== undefined).length === 1;
const SOURCE_MESSAGE = "give one of path, file, url or entry";
const INSTALL_MESSAGE = "give one of path, file, url, entry or server";

const SettingValue = z.union([z.string().max(10_000), z.number(), z.boolean()]).nullable();

const CatalogId = z.object({ id: z.string().max(40) }).strict();

export const extensionMethods = {
  /** The catalogs the owner added, and public ones to add with one click. */
  "extensions.catalogs": deferMethod({
    params: () => z.object({}).strict(),
    result: () =>
      z.object({
        catalogs: z.array(ExtensionCatalog),
        suggested: z.array(z.object({ source: z.string(), name: z.string(), description: z.string() })),
      }),
    effect: false,
    access: "human",
  }),
  /**
   * Adds a catalog for the owner (a GitHub owner/repo, a git address, an index's https address or a folder) and reads
   * it. Everything from it is third party. `background` answers at once while it is read (`reading`, then
   * `extensions.catalog_reading` events and `extensions.changed` when done).
   */
  "extensions.catalog_add": deferMethod({
    params: () => z.object({ source: z.string().trim().min(3).max(500), background: z.boolean().optional() }).strict(),
    result: () => ExtensionCatalog,
    effect: true,
    access: "human",
  }),
  /** Reads an added catalog again at its newest commit (`background` as for adding one). */
  "extensions.catalog_sync": deferMethod({
    params: () => CatalogId.extend({ background: z.boolean().optional() }).strict(),
    result: () => ExtensionCatalog,
    effect: true,
    access: "human",
  }),
  "extensions.catalog_remove": deferMethod({
    params: () => CatalogId,
    result: () => z.object({ removed: z.boolean() }),
    effect: true,
    access: "human",
  }),
  /** Sets some of an extension's settings (null clears one); a sensitive one goes to the secret store. */
  "extensions.settings": deferMethod({
    params: () =>
      z
        .object({
          id: z.string().max(40),
          values: z.record(z.string().max(40), SettingValue),
        })
        .strict(),
    result: () => ExtensionInfo,
    effect: true,
    access: "human",
  }),
  /** One of an installed extension's pages: its HTML, to show in a sandboxed frame. */
  "extensions.page": deferMethod({
    params: () =>
      z
        .object({
          id: z.string().max(40),
          page: z.string().max(40),
        })
        .strict(),
    result: () => z.object({ title: z.string(), html: z.string() }),
    effect: false,
    access: "human",
  }),
  /** The companion app an installed extension carries (an .apk), to save and put on the device. */
  "extensions.companion_file": deferMethod({
    params: () => z.object({ id: z.string().max(40) }).strict(),
    result: () => z.object({ name: z.string(), data: z.string() }),
    effect: false,
    access: "human",
  }),
  /** One of the widgets or apps an installed extension carries, as an artifact bundle to add to Apps. */
  "extensions.app_bundle": deferMethod({
    params: () => z.object({ id: z.string().max(40), file: z.string().max(200) }).strict(),
    result: () => ArtifactBundle,
    effect: false,
    access: "human",
  }),
  /** An image of an extension's listing (its icon, a screenshot), installed or in APX's catalog; none when missing. */
  "extensions.asset": deferMethod({
    params: () =>
      z
        .object({
          id: z.string().max(40),
          file: z.string().min(1).max(200),
        })
        .strict(),
    result: () =>
      z.object({
        mime: z.string().optional(),
        data: z.string().optional(),
      }),
    effect: false,
    access: "human",
  }),
  /**
   * What APX's catalog offers, each with what it brings and its page. Read from the catalog's kept copy unless it is
   * older than a few minutes or `refresh`; each package's own manifest is read once and kept by its fingerprint.
   */
  "extensions.catalog": deferMethod({
    params: () =>
      z
        .object({
          refresh: z.boolean().optional(),
        })
        .strict(),
    result: () =>
      z.object({
        entries: z.array(CatalogEntry),
        catalog: z.enum(["unreachable", "needs_update"]).optional(),
      }),
    effect: false,
    access: "human",
  }),
  "extensions.list": deferMethod({
    params: () => z.object({}).strict(),
    result: () =>
      z.object({
        extensions: z.array(ExtensionInfo),
      }),
    effect: false,
    access: "human",
  }),
  /** Reads an extension (a folder, an .apxext file or an https URL) without writing or running anything. */
  /** A folder (on the core's computer) packed as an .apxext: checked, and the same extension when read back. */
  "extensions.pack": deferMethod({
    params: () => z.object({ path: ExtensionSource.path().unwrap() }).strict(),
    result: () =>
      z.object({
        /** `<id>-<version>.apxext`. */
        name: z.string(),
        /** The file, base64. */
        data: z.string(),
        hash: z.string(),
        size: z.number(),
      }),
    effect: false,
    access: "human",
  }),
  "extensions.inspect": deferMethod({
    params: () =>
      z
        .object({
          path: ExtensionSource.path(),
          file: ExtensionSource.file(),
          url: ExtensionSource.url(),
          entry: ExtensionSource.entry(),
        })
        .strict()
        .refine(oneSource, SOURCE_MESSAGE),
    result: () => ExtensionInfo,
    effect: false,
    access: "human",
  }),
  /**
   * Copies the extension into APX's home, off. Installing another version keeps the one before to go back to; it
   * stays on only when official and asking for nothing more. `hash`: refuse unless the files are the ones inspected.
   */
  "extensions.install": deferMethod({
    params: () =>
      z
        .object({
          path: ExtensionSource.path(),
          file: ExtensionSource.file(),
          url: ExtensionSource.url(),
          entry: ExtensionSource.entry(),
          /** An MCP server by its address: installed as the owner's own connector with that server inside (D-249). */
          server: z
            .object({ name: z.string().trim().min(1).max(60), url: z.string().min(9).max(2000).startsWith("https://") })
            .strict()
            .optional(),
          hash: z
            .string()
            .regex(/^[0-9a-f]{16}$/)
            .optional(),
        })
        .strict()
        .refine(oneSource, INSTALL_MESSAGE),
    result: () => ExtensionInfo,
    effect: true,
    access: "human",
  }),
  /** Goes back to the version installed before this one (and forward again), each as it was approved. */
  "extensions.rollback": deferMethod({
    params: () =>
      z
        .object({
          id: z.string().max(40),
        })
        .strict(),
    result: () => ExtensionInfo,
    effect: true,
    access: "human",
  }),
  "extensions.enable": deferMethod({
    params: () =>
      z
        .object({
          id: z.string().max(40),
          enabled: z.boolean(),
          /** Atomically claim a first activation; a stale connection attempt must not adopt another's. */
          only_if_disabled: z.literal(true).optional(),
          /** Undo only the activation identified by this receipt; a later change makes it a no-op. */
          rollback_token: z.string().uuid().optional(),
        })
        .strict()
        .refine((p) => (!p.only_if_disabled || p.enabled) && (!p.rollback_token || !p.enabled)),
    result: () => ExtensionInfo.extend({ activation_token: z.string().uuid().optional() }),
    effect: true,
    access: "human",
  }),
  "extensions.remove": deferMethod({
    params: () =>
      z
        .object({
          id: z.string().max(40),
        })
        .strict(),
    result: () =>
      z.object({
        removed: z.boolean(),
        /** The agents added from it, archived with it, by name; `kept`: those still answering a channel. */
        archived: z.array(z.string()).default([]),
        kept: z.array(z.string()).default([]),
      }),
    effect: true,
    access: "human",
  }),
  /** Adds one of its ready-made agents to the owner's team; removing the extension archives it (DECISIONS.md#d-254). */
  "extensions.add_agent": deferMethod({
    params: () => z.object({ id: z.string().max(40), agent: z.string().max(40) }).strict(),
    result: () => Agent,
    effect: true,
    access: "human",
  }),
  /** Stores (or with null, deletes) one of the secrets an extension declares. */
  /** Asks the extension's plugin for context on a sample text, as a turn would: what it adds, or why not. */
  "extensions.test": deferMethod({
    params: () =>
      z
        .object({
          id: z.string().min(1).max(80),
          text: z.string().trim().min(1).max(2000),
        })
        .strict(),
    result: () =>
      z.object({
        ok: z.boolean(),
        ms: z.number().int(),
        context: z.string().optional(),
        error: z.string().optional(),
      }),
    effect: false,
    access: "human",
  }),
  "extensions.set_secret": deferMethod({
    params: () =>
      z
        .object({
          id: z.string().max(40),
          name: z.string().max(40),
          value: z.string().max(10000).nullable(),
        })
        .strict(),
    result: () => ExtensionInfo,
    effect: true,
    access: "human",
  }),
};
