// What an extension brings and needs, read from its manifest and its listing (`apx-listing.json` v1 or v2, or the
// catalog's card of it): the Marketplace's filters, tags and page. Nothing here runs or fetches anything.
// See DECISIONS.md#d-241
import type {
  ExtensionBrings,
  ExtensionCategory,
  ExtensionConnection,
  ExtensionContents,
  ExtensionListing,
  ExtensionManifest,
  ExtensionNeeds,
} from "@apx/protocol";
import { z } from "zod";
import { connectorsOf, hostsOf } from "./package.ts";

const Text = z.string().trim().min(1).max(600);
const Long = z.string().trim().max(20_000);
/** A file in the package (an icon, a screenshot): relative, inside it, an image. */
const File = z
  .string()
  .max(200)
  .regex(/^(?![/\\])(?!.*\.\.)[\w./-]+\.(png|webp|svg|jpg|jpeg)$/i);
const Https = z.string().max(500).startsWith("https://");
const Shot = z.object({ file: File, caption: Text.optional() });
const Copy = z.object({
  summary: Text.optional(),
  tagline: z.string().trim().max(60).optional(),
  description: Long.optional(),
  features: z.array(Text).max(12).default([]),
  requirements: z.array(Text).max(12).default([]),
  limits: z.array(Text).max(12).default([]),
  pricing: Text.default(""),
  privacy: Text.default(""),
  prompts: z.array(Text).max(12).default([]),
  /** The tools it brings, named so the owner sees them before adding it (a Spanish copy translates descriptions). */
  tools: z
    .array(z.object({ name: z.string().trim().min(1).max(80), description: Text.optional() }))
    .max(100)
    .default([]),
  /** Spanish captions come as the same screenshots with their caption. */
  screenshots: z
    .array(z.object({ file: File.optional(), caption: Text.optional() }))
    .max(10)
    .default([]),
});
/** A package's listing (schema 1 or 2), as the marketplace writes it; unknown fields are ignored. */
const Listing = Copy.extend({
  screenshots: z.array(Shot).max(10).default([]),
  category: z.string().max(60).optional(),
  connection: z.enum(["none", "key", "oauth", "pairing", "local"]).optional(),
  icon: File.optional(),
  links: z
    .object({
      website: Https.optional(),
      privacy: Https.optional(),
      terms: Https.optional(),
      docs: z.string().max(500).optional(),
    })
    .optional(),
  publisher: z.object({ name: z.string().trim().min(1).max(80), verified: z.boolean().default(false) }).optional(),
  authentication: z.string().optional(),
  billing: z.string().optional(),
  locales: z.object({ es: Copy.optional() }).optional(),
});
export type ListingFile = z.infer<typeof Listing>;

/** The listing in a file's or card's shape, or undefined when it does not read as one. */
export function readListing(raw: unknown): ListingFile | undefined {
  const p = Listing.safeParse(raw);
  return p.success && (p.data.summary || p.data.tagline) ? p.data : undefined;
}

/** A category by its id or its label in English or Spanish; older and other catalogs' categories map to the closest. */
const CATEGORY: Record<string, ExtensionCategory> = {
  productivity: "productivity",
  productividad: "productivity",
  communication: "communication",
  comunicación: "communication",
  "docs-notes": "docs-notes",
  "documents and notes": "docs-notes",
  "documentos y notas": "docs-notes",
  files: "files",
  archivos: "files",
  development: "development",
  dev: "development",
  desarrollo: "development",
  data: "data",
  datos: "data",
  "design-media": "design-media",
  media: "design-media",
  "design and media": "design-media",
  "diseño y medios": "design-media",
  "sales-customers": "sales-customers",
  sales: "sales-customers",
  "sales and customers": "sales-customers",
  "ventas y clientes": "sales-customers",
  finance: "finance",
  finanzas: "finance",
  marketing: "marketing",
  "devices-home": "devices-home",
  devices: "devices-home",
  "devices and home": "devices-home",
  "dispositivos y hogar": "devices-home",
  "search-research": "search-research",
  "search and research": "search-research",
  "búsqueda e investigación": "search-research",
  "business-systems": "business-systems",
  enterprise: "business-systems",
  "business systems": "business-systems",
  "sistemas de empresa": "business-systems",
  // Claude Code catalogs' own words (DECISIONS.md#d-253); learning, location and math fit none of ours.
  database: "data",
  monitoring: "data",
  security: "development",
  deployment: "development",
  testing: "development",
  migration: "development",
  design: "design-media",
  automation: "productivity",
};
export const categoryOf = (v: string | undefined): ExtensionCategory | undefined =>
  v ? CATEGORY[v.trim().toLowerCase()] : undefined;

/** How it connects, said by its listing or read from what it asks for. */
function connectionOf(m: ExtensionManifest, l?: ListingFile): ExtensionConnection {
  if (l?.connection) return l.connection;
  if (l?.authentication === "oauth") return "oauth";
  if (l?.authentication === "secret") return "key";
  if (l?.authentication === "local-permission") return "local";
  if (m.secrets.length || m.settings.some((s) => s.sensitive)) return "key";
  if (Object.values(m.mcp).some((s) => s.command === "npx" && s.args.includes("mcp-remote"))) return "oauth";
  return "none";
}

/**
 * The page copy the panel shows (English, with Spanish when the package has it). A package cannot vouch for itself:
 * its publisher's check counts only when the official catalog lists these exact files.
 */
export function listingCopy(l: ListingFile, m: ExtensionManifest | undefined, official: boolean): ExtensionListing {
  const pick = (c: z.infer<typeof Copy>, base?: z.infer<typeof Copy>) => ({
    summary: c.summary ?? c.tagline ?? base?.summary ?? "",
    ...(c.tagline ? { tagline: c.tagline } : {}),
    ...(c.description ? { description: c.description } : {}),
    features: c.features,
    requirements: c.requirements,
    limits: c.limits,
    pricing: c.pricing,
    privacy: c.privacy,
    prompts: c.prompts,
    // A translation that names no tools keeps the base list.
    tools: (c.tools.length ? c.tools : (base?.tools ?? [])).map((x) => ({
      name: x.name,
      ...(x.description ? { description: x.description } : {}),
    })),
    captions: (base?.screenshots ?? c.screenshots).map((s, i) => c.screenshots[i]?.caption ?? s.caption ?? ""),
  });
  const category = categoryOf(l.category);
  return {
    ...pick(l),
    ...(category ? { category } : {}),
    connection: m ? connectionOf(m, l) : (l.connection ?? "none"),
    ...(l.icon ? { icon: l.icon } : {}),
    screenshots: l.screenshots.map((s) => s.file),
    ...(l.links ? { links: l.links } : {}),
    ...(l.publisher ? { publisher: { name: l.publisher.name, verified: official && l.publisher.verified } } : {}),
    ...(l.locales?.es ? { es: pick(l.locales.es, l) } : {}),
  };
}

/** What a package holds, from its manifest (and its skills' names and lines when they were kept), to show before adding it. */
export function contentsOf(
  m: ExtensionManifest,
  hash: string,
  skills: { names: string[]; lines?: Record<string, string> | undefined } | undefined,
): ExtensionContents {
  const agentLines = Object.fromEntries(m.agents.filter((a) => a.description).map((a) => [a.name, a.description]));
  const settings = m.settings.filter((s) => s.required && !s.sensitive && !s.generate && s.default === undefined);
  const keys = [...m.secrets, ...m.settings.filter((s) => s.sensitive)];
  return {
    hosts: hostsOf(m),
    runs_code: Boolean(m.plugin) || Object.values(m.mcp).some((s) => s.command),
    servers: Object.keys(m.mcp).length,
    keys: keys.map((s) => s.label),
    ...(keys.some((s) => s.locales)
      ? { key_labels: keys.map(({ label, locales }) => ({ label, ...(locales ? { locales } : {}) })) }
      : {}),
    ...(skills ? { skills: skills.names } : {}),
    ...(skills?.lines && Object.keys(skills.lines).length ? { skill_lines: skills.lines } : {}),
    agents: m.agents.map((a) => a.name),
    ...(Object.keys(agentLines).length ? { agent_lines: agentLines } : {}),
    routines: m.routines.map((r) => r.name),
    ...(m.companion ? { companion: { name: m.companion.name, platform: m.companion.platform } } : {}),
    hash,
    connectors: connectorsOf(m),
    ...(settings.length ? { settings: settings.map((s) => s.label) } : {}),
    ...(settings.some((s) => s.locales)
      ? { setting_labels: settings.map(({ label, locales }) => ({ label, ...(locales ? { locales } : {}) })) }
      : {}),
    ...(m.apps.length ? { apps: m.apps.length } : {}),
  };
}

/** What it brings, from what the manifest declares (and how it connects, when its listing says). */
export function bringsOf(m: ExtensionManifest, l?: ListingFile): ExtensionBrings[] {
  const out = new Set<ExtensionBrings>();
  const connection = connectionOf(m, l);
  if (connection === "key" || connection === "oauth") out.add("accounts");
  if (connection === "pairing") out.add("devices");
  if (Object.keys(m.mcp).length || m.plugin) out.add("tools");
  if (m.skills) out.add("skills");
  if (m.agents.length) out.add("agents");
  if (m.companion) out.add("devices");
  if (m.apps.length) out.add("apps");
  return [...out];
}

/** What the owner should know first: code that runs here, and a cost of its own beyond the account's plan. */
export function needsOf(m: ExtensionManifest, l?: ListingFile): ExtensionNeeds[] {
  const out = new Set<ExtensionNeeds>();
  if (m.plugin || Object.values(m.mcp).some((s) => s.command)) out.add("code");
  if (l?.billing === "usage" || l?.billing === "paid-app") out.add("cost");
  // An app on a device it needs, and a system it runs on only.
  const device = m.companion?.platform;
  if (device === "android-tv") out.add("tv");
  else if (device === "android" || device === "ios") out.add("phone");
  else if (device === "macos" || (m.platforms?.length === 1 && m.platforms[0] === "darwin")) out.add("mac");
  return [...out];
}
