import assert from "node:assert/strict";
import { test } from "node:test";
import type { CatalogEntry, ExtensionInfo, McpServerStatus } from "@apx/protocol";
import {
  buildItems,
  filterItems,
  groupByCategory,
  groupMine,
  type Integration,
  isMine,
  kindOf,
  listed,
  newer,
  pageItem,
  serviceName,
} from "./extensionItems.ts";

const integration = (id: string, extra: Partial<Integration> = {}): Integration => ({
  id,
  label: id.toUpperCase(),
  description: `${id} things`,
  fields: [],
  connected: false,
  coming: false,
  off_in: [],
  ...extra,
});
const entry = (id: string, version: string, extra: Partial<CatalogEntry> = {}): CatalogEntry => ({
  id,
  name: id,
  description: `${id} from the catalog`,
  categories: [],
  version,
  provenance: "official",
  url: `https://dl.example.com/${id}-${version}.apxext`,
  brings: ["tools"],
  needs: [],
  ...extra,
});
const ext = (id: string, extra: Partial<ExtensionInfo> = {}): ExtensionInfo => ({
  id,
  name: id,
  version: "1.0.0",
  description: "",
  enabled: true,
  hash: "0123456789abcdef",
  source: `${id}.apxext`,
  skills: [],
  mcp: [],
  routines: [],
  secrets: [],
  runs_code: false,
  installed_at: "2026-11-17",
  provenance: "official",
  brings: ["tools", "skills"],
  needs: ["code"],
  hosts: [],
  settings: [],
  agents: [],
  pages: [],
  apps: [],
  ...extra,
});
const server = (name: string, status: McpServerStatus["status"]) =>
  ({ name, scope: "global", status }) as McpServerStatus;

const sources = {
  integrations: [
    integration("gmail", { own: true, oauth: { redirect_uri: "x" } }),
    integration("github", { connected: true, off_in: ["p2"] }),
    integration("notion"),
    // Its package is in the catalog: the package stands for it while it is not connected.
    integration("trello"),
    integration("slack", { connected: true }),
  ],
  channels: [{ kind: "telegram", name: "Telegram", description: "Bots.", connected: true }],
  browser: { name: "Browser", description: "Browse." },
  catalog: [
    entry("weather", "1.1.0", { category: "data" }),
    entry("trello", "1.0.1", { category: "productivity" }),
    entry("hubspot", "1.0.0", { category: "sales-customers", brings: ["accounts"] }),
    entry("github", "1.0.0", { category: "development" }),
  ],
  installed: [
    ext("weather"),
    ext("hubspot", { secrets: [{ name: "token", label: "Token", set: false }], version: "1.0.0" }),
    ext("camera", { provenance: "third_party" }),
  ],
  servers: [server("slack", "needs-sign-in")],
};
const items = buildItems({ ...sources, project: "p1" });
const byKey = (k: string) => items.find((i) => i.key === k);

test("included ones have APX code of their own; APX's data accounts give way to their package unless connected", () => {
  assert.deepEqual(
    items.map((i) => i.key),
    [
      "included:gmail",
      "account:github",
      "account:notion",
      "account:slack",
      "channel:telegram",
      "included:browser",
      "ext:weather",
      "ext:hubspot",
      "ext:camera",
      "catalog:trello",
    ],
  );
  assert.equal(byKey("included:gmail")?.origin, "included");
  assert.equal(byKey("account:notion")?.origin, "catalog");
  assert.equal(byKey("ext:weather")?.update, "1.1.0");
  assert.equal(byKey("ext:camera")?.origin, "own");
  assert.equal(byKey("account:slack")?.attention, "sign-in");
  assert.equal(byKey("ext:hubspot")?.attention, "keys");
  assert.deepEqual(
    items.filter(isMine).map((i) => i.id),
    ["github", "slack", "browser", "weather", "hubspot", "camera"],
  );
});

test("browse groups: every category with its included ones, the channels together, then accounts not filed yet", () => {
  assert.deepEqual(
    groupByCategory(items).map((g) => `${g.id}:${g.items.length}`),
    ["productivity:3", "data:1", "sales-customers:1", "channels:1", "accounts:3", "other:1"],
  );
});

test("its kind comes from what it brings: a channel, an integration, a connector, agents or skills", () => {
  const kinds = buildItems({
    ...sources,
    installed: [
      ext("tv", { companion: { name: "APX TV", platform: "android-tv" } } as Partial<ExtensionInfo>),
      ext("docs", { brings: ["tools", "skills"], mcp: ["docs-server"], skills: ["docs-guide"] }),
      ext("guide", { brings: ["skills"], skills: ["guide"] }),
      ext("crew", { brings: ["agents"], agents: [{ name: "Scout" }] } as Partial<ExtensionInfo>),
    ],
  });
  const kind = (k: string) => {
    const i = kinds.find((x) => x.key === k);
    return i && kindOf(i);
  };
  assert.equal(kind("channel:telegram"), "channel");
  assert.equal(kind("included:gmail"), "native");
  assert.equal(kind("included:browser"), "native");
  assert.equal(kind("account:github"), "connector");
  assert.equal(kind("ext:tv"), "integration");
  // A server with skills to use it is a connector all the same.
  assert.equal(kind("ext:docs"), "connector");
  assert.equal(kind("ext:guide"), "skills");
  assert.equal(kind("ext:crew"), "agents");
});

test("the owner's own: what waits on them first, then what works; channels stay in Channels", () => {
  assert.deepEqual(
    groupMine(items).map((g) => [g.id, g.items.map((i) => i.id)]),
    [
      ["attention", ["slack", "weather", "hubspot"]],
      ["active", ["github", "browser", "camera"]],
    ],
  );
});

test("each one says where it comes from: included, official, third party or the owner's own", () => {
  const own = buildItems({
    ...sources,
    installed: [
      ...sources.installed,
      ext("tv", { provenance: "third_party", source: "~/work/acme-tv" }),
      ext("acme-docs", { mcp: ["acme-docs-remote"] }),
    ],
    servers: [
      ...sources.servers,
      {
        ...server("docs", "ready"),
        transport: "http",
        target: "https://mcp.acme.example/mcp",
        enabled: true,
        definition: { url: "https://mcp.acme.example/mcp", args: [], env: {}, headers: {} },
      },
      // An extension's own server and an account's are shown as that extension or account, never alone.
      { ...server("acme-docs-remote", "ready"), definition: { args: [], env: {}, headers: {} } },
      { ...server("github", "ready"), definition: { args: [], env: {}, headers: {} } },
    ] as McpServerStatus[],
  });
  const label = (k: string) => own.find((i) => i.key === k)?.label;
  assert.equal(label("included:gmail"), "included");
  assert.equal(label("account:github"), "official");
  assert.equal(label("ext:weather"), "official");
  assert.equal(label("ext:camera"), "third");
  assert.equal(label("ext:tv"), "own");
  // A server the owner wrote in Resources is theirs there, not an extension: the Marketplace never lists it.
  assert.deepEqual(
    own.filter((i) => ["docs", "acme-docs-remote"].includes(i.id)),
    [],
  );
  assert.equal(label("ext:acme-docs"), "official");
  assert.equal(own.find((i) => i.key === "ext:weather")?.publisher, undefined);
});

test("review does not imply authorship, and creators survive installation and local ownership", () => {
  const listing = { publisher: { name: "Northwind", verified: true } } as CatalogEntry["listing"];
  const catalog = [entry("community", "1.0.0", { listing }), entry("unknown", "1.0.0")];
  const offered = buildItems({ ...sources, catalog, installed: [] });
  assert.equal(offered.find((i) => i.id === "community")?.publisher, "Northwind");
  assert.equal(offered.find((i) => i.id === "community")?.label, "official");
  assert.equal(offered.find((i) => i.id === "unknown")?.publisher, undefined);
  const installed = buildItems({
    ...sources,
    catalog,
    installed: [
      ext("community", { listing }),
      ext("unknown"),
      ext("local", {
        listing,
        provenance: "third_party",
        source: "/work/local",
      }),
    ],
  });
  assert.equal(installed.find((i) => i.id === "community")?.publisher, "Northwind");
  assert.equal(installed.find((i) => i.id === "unknown")?.publisher, undefined);
  assert.equal(installed.find((i) => i.id === "local")?.publisher, "Northwind");
  assert.equal(installed.find((i) => i.id === "local")?.label, "own");
  assert.equal(installed.find((i) => i.channel)?.publisher, "APX");
});

test("filters by words and by what it brings", () => {
  assert.deepEqual(
    filterItems(items, "trello", "tools").map((i) => i.id),
    ["trello"],
  );
  assert.ok(newer("1.10.0", "1.9.9"));
  assert.ok(!newer("1.0.0", "1.0.0"));
  assert.ok(newer("2.0.0", "2.0.0-rc.1"));
});

test("an added catalog's entries go in APX's categories; one with none stays under it, last", () => {
  const withAdded = buildItems({
    ...sources,
    catalog: [
      ...sources.catalog,
      entry("notes", "0.4.0", { catalog: "c1", provenance: "third_party" }),
      entry("tasks", "1.0.0", { catalog: "c1", provenance: "third_party", category: "productivity" }),
    ],
  });
  assert.equal(withAdded.find((i) => i.id === "notes")?.key, "added:c1:notes");
  const groups = groupByCategory(withAdded);
  // Beside APX's own in its category, still saying it is third party.
  const productivity = groups.find((g) => g.id === "productivity")?.items ?? [];
  assert.deepEqual(
    productivity.filter((i) => i.entry?.catalog).map((i) => [i.id, i.label]),
    [["tasks", "third"]],
  );
  assert.equal(groups.at(-1)?.id, "added:c1");
  assert.deepEqual(
    groups.at(-1)?.items.map((i) => i.id),
    ["notes"],
  );
});

test("an added catalog's entry that repeats one of APX's is that one's other version, not listed apart", () => {
  const website = (url: string) => ({ links: { website: url } }) as CatalogEntry["listing"];
  const third = { catalog: "c1", provenance: "third_party" as const };
  const withAdded = buildItems({
    ...sources,
    catalog: [
      ...sources.catalog,
      entry("maps", "1.0.0", { listing: website("https://maps.example.com") }),
      // The same id as APX's package, the same name as an account, the same site as a package, the same as a channel.
      entry("trello", "9.0.0", third),
      entry("slack-tools", "1.0.0", { ...third, name: "Slack MCP" }),
      entry("geo", "1.0.0", { ...third, homepage: "https://www.maps.example.com/claude" }),
      entry("telegram", "1.0.0", third),
      // Its code on GitHub says nothing of which service it is; nor does a name APX has nothing under.
      entry("gh-notes", "1.0.0", { ...third, homepage: "https://github.com/acme/notes" }),
    ],
  });
  const twin = (key: string) => withAdded.find((i) => i.key === key)?.twin;
  assert.equal(withAdded.find((i) => i.id === "trello")?.version, "1.0.1", "APX's comes first");
  assert.equal(twin("added:c1:trello"), "catalog:trello");
  assert.equal(twin("added:c1:slack-tools"), "account:slack");
  assert.equal(twin("added:c1:geo"), "catalog:maps");
  assert.equal(twin("added:c1:telegram"), "channel:telegram");
  assert.equal(twin("added:c1:gh-notes"), undefined);
  assert.deepEqual(
    withAdded.filter((i) => i.entry?.catalog && listed(i)).map((i) => i.id),
    ["gh-notes"],
  );
  assert.equal(serviceName("Acme Notes plugin"), "acmenotes");
});

test("an added catalog's entry is the kind its contents say; one whose files were not read reads as skills", () => {
  const contents = { hosts: [], runs_code: true, servers: 1, keys: [], agents: [], routines: [], hash: "h" };
  const [connector, unknown] = buildItems({
    integrations: [],
    catalog: [
      entry("db", "1.0.0", { catalog: "c1", provenance: "third_party", brings: [], contents }),
      entry("tips", "1.0.0", { catalog: "c1", provenance: "third_party", brings: undefined }),
    ],
    installed: [],
    servers: [],
  });
  assert.deepEqual([connector && kindOf(connector), unknown && kindOf(unknown)], ["connector", "skills"]);
});

test("one installed from an added catalog stays under it; a namesake from elsewhere does not, and 0.0.0 is no version", () => {
  const catalog = [
    entry("notes", "0.0.0", { catalog: "c1", provenance: "third_party", name: "Notes" }),
    entry("todo", "0.0.0", { catalog: "c1", provenance: "third_party", name: "Todo" }),
  ];
  const items = buildItems({
    ...sources,
    catalog,
    installed: [
      ext("notes", {
        provenance: "third_party",
        source: "Acme plugins · Notes",
        source_catalog: { catalog: "c1", entry: "notes" },
        version: "0.0.0",
      }),
      ext("todo", { provenance: "third_party", source: "~/work/todo" }),
    ],
  });
  const notes = items.find((i) => i.id === "notes");
  assert.equal(notes?.entry?.catalog, "c1");
  assert.equal(notes?.version, undefined);
  assert.equal(items.find((i) => i.id === "todo")?.entry, undefined);
  assert.ok(
    groupByCategory(items)
      .find((g) => g.id === "added:c1")
      ?.items.some((i) => i.id === "notes"),
  );
});

test("an enabled extension awaiting its own server login is not shown as connected", () => {
  const connector = ext("linear", { mcp: ["linear-main"] });
  const pending = buildItems({
    ...sources,
    installed: [connector],
    servers: [server("linear-main", "needs-sign-in")],
  }).find((i) => i.ext?.id === "linear");
  assert.equal(pending?.state, "attention");
  assert.equal(pending?.attention, "sign-in");
  const other = buildItems({
    ...sources,
    installed: [connector],
    servers: [server("other-main", "needs-sign-in")],
  }).find((i) => i.ext?.id === "linear");
  assert.equal(other?.state, "on");
  const off = buildItems({
    ...sources,
    installed: [{ ...connector, enabled: false }],
    servers: [server("linear-main", "needs-sign-in")],
  }).find((i) => i.ext?.id === "linear");
  assert.equal(off?.state, "off");
});

test("a third-party installation never inherits an official namesake's listing or update", () => {
  const catalog = [
    entry("linear", "1.0.1", {
      listing: { tagline: "Official only", publisher: { name: "APX" } } as CatalogEntry["listing"],
    }),
    entry("linear", "0.0.0", { catalog: "c1", provenance: "third_party", name: "Linear" }),
    entry("linear", "0.0.0", { catalog: "c2", provenance: "third_party", name: "Linear" }),
  ];
  const installed = ext("linear", {
    provenance: "third_party",
    source: "Other · Linear",
    version: "0.0.0",
    source_catalog: { catalog: "c2", entry: "linear" },
  });
  const item = buildItems({ ...sources, catalog, installed: [installed] }).find((i) => i.ext?.id === "linear");
  assert.equal(item?.entry?.catalog, "c2");
  assert.equal(item?.listing?.tagline, undefined);
  assert.equal(item?.update, undefined);
  const legacy = buildItems({ ...sources, catalog, installed: [{ ...installed, source_catalog: undefined }] }).find(
    (i) => i.ext?.id === "linear",
  );
  assert.equal(legacy?.entry, undefined);
  assert.equal(legacy?.update, undefined);
});

test("a legacy catalog installation shows its matching entry only when its label is unambiguous", () => {
  const catalog = [entry("notes", "2.0.0", { catalog: "c1", catalog_name: "Northwind", name: "Notes" })];
  const legacy = ext("notes", { provenance: "third_party", source: "Northwind · Notes", version: "1.0.0" });
  const item = buildItems({ ...sources, catalog, installed: [legacy] }).find((i) => i.ext?.id === "notes");
  assert.equal(item?.entry?.catalog, "c1");
  const ambiguous = buildItems({
    ...sources,
    catalog: [...catalog, entry("notes", "2.0.0", { catalog: "c2", catalog_name: "Northwind", name: "Notes" })],
    installed: [legacy],
  }).find((i) => i.ext?.id === "notes");
  assert.equal(ambiguous?.entry, undefined);
});

test("a page opened on a catalog's entry keeps showing it once added, as the owner's", () => {
  const before = buildItems({ ...sources, installed: [] });
  assert.equal(pageItem(before, "catalog:weather")?.state, "available");
  // Added: the catalog no longer lists it apart, and the same page shows the owner's, now with Connect.
  const after = buildItems({ ...sources, installed: [ext("weather", { enabled: false })] });
  assert.equal(pageItem(after, "catalog:weather")?.key, "ext:weather");
  assert.equal(pageItem(after, "catalog:weather")?.state, "off");
  // An added catalog's entry goes the same way, and a link that names only the id still finds it.
  const added = buildItems({
    ...sources,
    catalog: [...sources.catalog, entry("acme", "1.0.0", { catalog: "c1", catalog_name: "Northwind" })],
    installed: [ext("acme", { source: "acme · acme" })],
  });
  assert.equal(pageItem(added, "added:c1:acme")?.key, "ext:acme");
  assert.equal(pageItem(after, "weather")?.key, "ext:weather");
});
