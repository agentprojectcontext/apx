import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { type TempDir, tempDir } from "../testkit/platform.ts";
import { compareVersions } from "./catalog-packages.ts";
import { readArchive } from "./package.ts";
import { zipFiles } from "./zip.test-support.ts";

const CATALOG = "https://catalog.example.com/index.json";
const served = new Map<string, Buffer | string>();
const asked: string[] = [];

const listing = {
  schema: 1,
  id: "weather",
  summary: "Forecasts for a place you choose.",
  features: ["Up to 7 days"],
  requirements: ["Pick a usage plan"],
  limits: ["No alerts"],
  authentication: "secret",
  billing: "usage",
  pricing: "Open-Meteo's plan.",
  privacy: "Coordinates go to Open-Meteo.",
  locales: {
    es: {
      summary: "Pronósticos.",
      features: ["Hasta 7 días"],
      requirements: [],
      limits: [],
      pricing: "Plan de Open-Meteo.",
      privacy: "Las coordenadas van a Open-Meteo.",
    },
  },
};
const weather = zipFiles({
  "apx-extension.json": JSON.stringify({
    id: "weather",
    name: "Weather",
    version: "1.1.0",
    skills: "skills",
    mcp: { forecast: { command: "node", args: ["./server.mjs"], env: { KEY: "secret://key" } } },
    secrets: [{ name: "key", label: "API key" }],
  }),
  "server.mjs": "export {};",
  "skills/weather/SKILL.md": "---\nname: weather\ndescription: Weather.\n---\nAsk.\n",
  "apx-listing.json": JSON.stringify(listing),
});
const notes = zipFiles({ "apx-extension.json": JSON.stringify({ id: "notes", name: "Notes", version: "2.0.0" }) });
// A listing in schema 2: tagline, long description, category by its Spanish label, icon and screenshots in the package,
// example requests, how it connects, links, a publisher that says it is verified, and Spanish text with captions.
const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>';
const notch = zipFiles({
  "apx-extension.json": JSON.stringify({ id: "notch", name: "Notch", version: "0.1.0", skills: "skills" }),
  "skills/notch/SKILL.md": "---\nname: notch\ndescription: Notch.\n---\nShow it.\n",
  "icon.svg": ICON,
  "shots/island.png": Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  "apx-listing.json": JSON.stringify({
    schema: 2,
    id: "notch",
    summary: "An island over your Mac's screen.",
    tagline: "Your agent above the menu bar",
    description: "## What it does\nShows what your agent does.",
    category: "Dispositivos y hogar",
    icon: "icon.svg",
    screenshots: [{ file: "shots/island.png", caption: "The island" }],
    prompts: ["Show me what you are doing"],
    connection: "pairing",
    links: { website: "https://example.com/notch", privacy: "https://example.com/privacy" },
    publisher: { name: "APX", verified: true },
    features: ["See your agent"],
    requirements: [],
    limits: [],
    pricing: "Free.",
    privacy: "Stays on this Mac.",
    locales: {
      es: {
        summary: "Una isla arriba de la pantalla.",
        tagline: "Tu agente arriba de la barra",
        prompts: ["Mostrame qué estás haciendo"],
        screenshots: [{ caption: "La isla" }],
        features: ["Ver a tu agente"],
        pricing: "Gratis.",
        privacy: "Queda en esta Mac.",
      },
    },
  }),
});
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const version = (b: Buffer, url: string, extra: Record<string, unknown> = {}) => ({
  version: readArchive(b).manifest.version,
  content_hash: readArchive(b).hash,
  apx: "2.0.0",
  archive: { url, sha256: sha(b) },
  ...extra,
});

let env: Awaited<ReturnType<typeof startCore>>;
let home: TempDir;

before(async () => {
  home = tempDir("apx-catalog-browse-");
  served.set("https://dl.example.com/weather-1.1.0.apxext", weather);
  served.set("https://dl.example.com/notes.apxext", notes);
  served.set("https://dl.example.com/notch.apxext", notch);
  served.set(
    "https://catalog.example.com/listings/linked.json",
    JSON.stringify({
      schema: 2,
      id: "linked",
      tagline: "Listed from the index",
      summary: "Its page, before its package.",
    }),
  );
  served.set("https://catalog.example.com/icons/linked.svg", ICON);
  served.set(
    CATALOG,
    JSON.stringify({
      schema: 1,
      entries: [
        {
          kind: "extension",
          id: "weather",
          name: "Weather",
          description: "Forecasts.",
          categories: ["data"],
          tier: "official",
          versions: [
            { version: "1.0.0", content_hash: "0000000000000000", apx: "2.0.0" },
            version(weather, "https://dl.example.com/weather-1.1.0.apxext"),
            { version: "9.0.0", content_hash: "1111111111111111", apx: "2.0.0", yanked: "broken" },
          ],
        },
        // Its archive does not hash to what the catalog says: listed, but nothing is read from it.
        {
          kind: "extension",
          id: "notes",
          name: "Notes",
          description: "Notes.",
          tier: "official",
          versions: [
            {
              ...version(notes, "https://dl.example.com/notes.apxext"),
              archive: { url: "https://dl.example.com/notes.apxext", sha256: "0".repeat(64) },
            },
          ],
        },
        {
          kind: "extension",
          id: "notch",
          name: "Notch",
          description: "An island.",
          tagline: "Your agent above the menu bar",
          category: "Dispositivos y hogar",
          tier: "community",
          versions: [version(notch, "https://dl.example.com/notch.apxext")],
        },
        // No card and a package that cannot be read: its page and icon come from the addresses the index gives.
        {
          kind: "extension",
          id: "linked",
          name: "Linked",
          description: "Linked.",
          category: "sales-customers",
          listing: "https://catalog.example.com/listings/linked.json",
          icon: "https://catalog.example.com/icons/linked.svg",
          tier: "official",
          versions: [{ version: "1.0.0", content_hash: "2222222222222222", apx: "2.0.0" }],
        },
        { kind: "integration", id: "github", name: "GitHub", description: "Repos." },
      ],
    }),
  );
  env = await startCore({
    llm: scriptedLlm(() => say("ok")),
    home: home.path,
    marketplaceIndex: CATALOG,
    extensionFetch: (async (url: string | URL) => {
      asked.push(String(url));
      const body = served.get(String(url));
      return body === undefined ? new Response("missing", { status: 404 }) : new Response(body);
    }) as typeof fetch,
  });
});
after(async () => {
  await env.core.close();
  await home.remove();
});

test("the catalog lists each extension at its newest version, with what its own package brings and its page", async () => {
  const { entries, catalog } = await env.client.call("extensions.catalog", {});
  assert.equal(catalog, undefined);
  assert.deepEqual(
    entries.map((e) => `${e.id}@${e.version}`),
    ["weather@1.1.0", "notes@2.0.0", "notch@0.1.0", "linked@1.0.0"],
  );
  const w = entries[0];
  assert.equal(w?.provenance, "official");
  assert.equal(w?.url, "https://dl.example.com/weather-1.1.0.apxext");
  assert.deepEqual(w?.brings, ["accounts", "tools", "skills"]);
  assert.deepEqual(w?.needs, ["code", "cost"]);
  assert.equal(w?.listing?.summary, "Forecasts for a place you choose.");
  assert.equal(w?.listing?.es?.summary, "Pronósticos.");
  // What its package holds, to show before adding it: code that runs here, the key it asks for, its skills by name.
  assert.deepEqual(
    { ...w?.contents, hash: undefined },
    {
      hosts: [],
      runs_code: true,
      servers: 1,
      keys: ["API key"],
      skills: ["weather"],
      skill_lines: { weather: "Weather." },
      agents: [],
      routines: [],
      hash: undefined,
      connectors: [{ name: "forecast", runs_here: true }],
    },
  );
  assert.match(w?.contents?.hash ?? "", /^[0-9a-f]{16}$/);
  // A package that is not what the catalog says is never read: no brings, nothing kept.
  assert.equal(entries[1]?.brings, undefined);

  // Read once: a second look downloads only the catalog's packages it could not trust before.
  const before = asked.filter((u) => u.includes("weather")).length;
  await env.client.call("extensions.catalog", { refresh: true });
  assert.equal(asked.filter((u) => u.includes("weather")).length, before);
});

test("a package kept by an older APX is read once more, so its page names its skills' lines", async () => {
  const w = (await env.client.call("extensions.catalog", {})).entries.find((e) => e.id === "weather");
  const kept = path.join(home.path, "marketplace", "packages", `${w?.contents?.hash}.json`);
  const raw = JSON.parse(fs.readFileSync(kept, "utf8")) as Record<string, unknown>;
  fs.writeFileSync(kept, JSON.stringify({ manifest: raw.manifest, listing: raw.listing, skills: raw.skills }));
  const before = asked.filter((u) => u.includes("weather-1.1.0")).length;
  const again = (await env.client.call("extensions.catalog", { refresh: true })).entries.find(
    (e) => e.id === "weather",
  );
  assert.equal(asked.filter((u) => u.includes("weather-1.1.0")).length, before + 1);
  assert.deepEqual(again?.contents?.skill_lines, { weather: "Weather." });
});

test("an installed extension shows what it brings and its page from its own folder", async () => {
  const info = await env.client.call("extensions.install", {
    file: { name: "weather.apxext", data: weather.toString("base64") },
  });
  assert.equal(info.provenance, "official");
  assert.deepEqual(info.brings, ["accounts", "tools", "skills"]);
  assert.equal(info.listing?.features[0], "Up to 7 days");
  // Its server and its skills' lines, for the page of one already added.
  assert.deepEqual(info.connectors, [{ name: "forecast", runs_here: true }]);
  assert.deepEqual(info.skill_lines, { weather: "Weather." });
  const listed = (await env.client.call("extensions.list", {})).extensions[0];
  assert.equal(listed?.listing?.privacy, "Coordinates go to Open-Meteo.");
});

test("versions compare by number, a pre-release before its release", () => {
  assert.ok(compareVersions("1.10.0", "1.9.2") > 0);
  assert.ok(compareVersions("2.0.0-beta.1", "2.0.0") < 0);
  assert.equal(compareVersions("1.0", "1.0.0"), 0);
});

test("a schema 2 listing gives the page its tagline, category, images, requests, links and Spanish text", async () => {
  const { entries } = await env.client.call("extensions.catalog", {});
  const n = entries.find((e) => e.id === "notch");
  assert.equal(n?.tagline, "Your agent above the menu bar");
  assert.equal(n?.category, "devices-home");
  assert.deepEqual(n?.brings, ["devices", "skills"]);
  const l = n?.listing;
  assert.equal(l?.connection, "pairing");
  assert.equal(l?.icon, "icon.svg");
  assert.deepEqual(l?.screenshots, ["shots/island.png"]);
  assert.deepEqual(l?.captions, ["The island"]);
  assert.deepEqual(l?.prompts, ["Show me what you are doing"]);
  assert.equal(l?.links?.website, "https://example.com/notch");
  assert.equal(l?.description?.startsWith("## What it does"), true);
  assert.deepEqual(l?.es?.captions, ["La isla"]);
  assert.equal(l?.es?.tagline, "Tu agente arriba de la barra");
  // Not listed as official: its own claim to be verified does not count.
  assert.deepEqual(l?.publisher, { name: "APX", verified: false });
  // Its images come from the package read before, nothing else.
  const icon = await env.client.call("extensions.asset", { id: "notch", file: "icon.svg" });
  assert.equal(icon.mime, "image/svg+xml");
  assert.equal(Buffer.from(icon.data ?? "", "base64").toString(), ICON);
  assert.deepEqual(await env.client.call("extensions.asset", { id: "notch", file: "apx-extension.json" }), {});
  assert.deepEqual(await env.client.call("extensions.asset", { id: "notch", file: "../../../etc/x.png" }), {});
});

test("the index's own listing and icon addresses show an entry before its package is read", async () => {
  const { entries } = await env.client.call("extensions.catalog", {});
  const l = entries.find((e) => e.id === "linked");
  assert.equal(l?.category, "sales-customers");
  assert.equal(l?.listing?.tagline, "Listed from the index");
  assert.equal(l?.icon_url, "https://catalog.example.com/icons/linked.svg");
  const icon = await env.client.call("extensions.asset", { id: "linked", file: "@icon" });
  assert.equal(icon.mime, "image/svg+xml");
  assert.equal(Buffer.from(icon.data ?? "", "base64").toString(), ICON);
});
