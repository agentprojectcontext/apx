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
  newer,
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
    ["github", "slack", "telegram", "browser", "weather", "hubspot", "camera"],
  );
});

test("browse groups: included first, the catalog by category, then accounts not filed yet, then the rest", () => {
  assert.deepEqual(
    groupByCategory(items).map((g) => `${g.id}:${g.items.length}`),
    ["included:3", "data:1", "productivity:1", "sales-customers:1", "accounts:3", "other:1"],
  );
});

test("the owner's own: what waits on them first, then what works", () => {
  assert.deepEqual(
    groupMine(items).map((g) => [g.id, g.items.map((i) => i.id)]),
    [
      ["attention", ["slack", "weather", "hubspot"]],
      ["active", ["github", "telegram", "browser", "camera"]],
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
  assert.equal(label("mcp:docs"), "own");
  assert.equal(own.find((i) => i.key === "mcp:docs")?.state, "on");
  assert.deepEqual(
    own.filter((i) => i.key.startsWith("mcp:")).map((i) => i.id),
    ["docs"],
  );
  assert.equal(own.find((i) => i.key === "ext:weather")?.publisher, "APX");
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

test("an added catalog's entries stay under it, after APX's own, and APX's entry wins an id both list", () => {
  const withAdded = buildItems({
    ...sources,
    catalog: [
      ...sources.catalog,
      entry("trello", "9.0.0", { catalog: "c1", provenance: "third_party" }),
      entry("notes", "0.4.0", { catalog: "c1", provenance: "third_party" }),
    ],
  });
  assert.equal(withAdded.find((i) => i.id === "trello")?.version, "1.0.1");
  assert.equal(withAdded.find((i) => i.id === "notes")?.key, "added:c1:notes");
  assert.equal(groupByCategory(withAdded).at(-1)?.id, "added:c1");
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
      ext("notes", { provenance: "third_party", source: "Acme plugins · Notes", version: "0.0.0" }),
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
