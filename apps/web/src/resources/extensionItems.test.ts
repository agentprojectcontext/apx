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

test("the owner's own: what waits first, then what is on here, then the rest", () => {
  assert.deepEqual(
    groupMine(items, "p1").map((g) => [g.id, g.items.map((i) => i.id)]),
    [
      ["attention", ["slack", "weather", "hubspot"]],
      ["here", ["github", "telegram", "browser", "camera"]],
    ],
  );
  assert.deepEqual(
    groupMine(buildItems({ ...sources, project: "p2" }), "p2")
      .find((g) => g.id === "active")
      ?.items.map((i) => i.id),
    ["github"],
  );
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
