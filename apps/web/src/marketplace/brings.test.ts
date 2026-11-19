import assert from "node:assert/strict";
import { test } from "node:test";
import type { CatalogEntry, ExtensionInfo, McpServerStatus } from "@apx/protocol";
import type { Item } from "../resources/extensionItems.ts";
import { bringsOf, countsOf, shortLine } from "./brings.ts";

// What an extension's page and its list row say it brings, before adding it (from its catalog entry) and after.

const item = (extra: Partial<Item> = {}): Item => ({
  key: "catalog:acme",
  id: "acme",
  name: "Acme",
  description: "",
  origin: "catalog",
  label: "official",
  provenance: "official",
  brings: [],
  needs: [],
  state: "available",
  here: false,
  ...extra,
});

const entry = (contents: CatalogEntry["contents"], extra: Partial<CatalogEntry> = {}): CatalogEntry => ({
  id: "acme",
  name: "Acme",
  description: "",
  categories: [],
  version: "1.0.0",
  provenance: "official",
  contents,
  ...extra,
});

const contents = (extra: Partial<NonNullable<CatalogEntry["contents"]>> = {}) => ({
  hosts: ["mcp.acme.example"],
  runs_code: true,
  servers: 1,
  keys: [],
  agents: [],
  routines: [],
  hash: "0123456789abcdef",
  ...extra,
});

test("before adding it, its page shows each connector's address, its skills and agents with their lines, and what it asks", () => {
  const b = bringsOf(
    item({
      connection: "oauth",
      entry: entry(
        contents({
          connectors: [{ name: "service", url: "https://mcp.acme.example/mcp", runs_here: true }],
          skills: ["deals", "reports"],
          skill_lines: { deals: "Finds and updates deals." },
          agents: ["Closer"],
          agent_lines: { Closer: "Follows up on open deals." },
          keys: ["API key"],
          settings: ["Workspace"],
        }),
      ),
    }),
    [],
    "en",
  );
  assert.equal(b.known, true);
  // One connector reads as the extension's own, with the address its program bridges to.
  assert.deepEqual(
    b.connectors.map((c) => [c.name, c.address, c.runsHere, c.auth]),
    [["Acme", "https://mcp.acme.example/mcp", true, "signIn"]],
  );
  assert.equal(b.connectors[0]?.tools, undefined);
  assert.deepEqual(b.skills, [
    { name: "deals", line: "Finds and updates deals." },
    { name: "reports", line: undefined },
  ]);
  assert.deepEqual(b.agents, [{ name: "Closer", line: "Follows up on open deals." }]);
  assert.deepEqual([b.keys, b.settings], [["API key"], ["Workspace"]]);
});

test("the tools its listing names show before connecting; several connectors go by their own names", () => {
  const listing = { tools: [{ name: "list_deals" }, { name: "get_deal" }] } as unknown as Item["listing"];
  const one = bringsOf(item({ listing, entry: entry(contents()) }), [], "en");
  assert.deepEqual(one.connectors[0]?.tools, { names: ["list_deals", "get_deal"], real: false });
  // Kept by an older APX: no addresses, still one connector per server.
  assert.equal(one.connectors[0]?.address, undefined);
  const two = bringsOf(
    item({
      listing,
      entry: entry(
        contents({
          servers: 2,
          connectors: [
            { name: "crm", url: "https://crm.acme.example/mcp", runs_here: false },
            { name: "microsoft_365", owner_url: true, runs_here: false },
          ],
        }),
      ),
    }),
    [],
    "en",
  );
  assert.deepEqual(
    two.connectors.map((c) => [c.name, c.mark, c.address, c.ownerAddress, c.tools]),
    [
      ["Crm", "crm", "https://crm.acme.example/mcp", false, undefined],
      ["Microsoft 365", "microsoft-365", undefined, true, undefined],
    ],
  );
});

test("once added, its servers' state gives the real tools, beside the same address and skills", () => {
  const e = {
    id: "acme",
    mcp: ["acme-service"],
    connectors: [{ name: "service", url: "https://mcp.acme.example/mcp", runs_here: true }],
    skills: ["deals"],
    skill_lines: { deals: "Finds and updates deals." },
    agents: [],
    routines: [],
    apps: [],
    secrets: [{ name: "key", label: "API key", set: true }],
    settings: [],
  } as unknown as ExtensionInfo;
  const server = {
    scope: "global",
    name: "acme-service",
    status: "ready",
    transport: "stdio",
    target: "npx",
    tools: 2,
    tool_names: ["list_deals", "get_deal"],
  } as unknown as McpServerStatus;
  const b = bringsOf(item({ key: "ext:acme", state: "on", ext: e }), [server], "en");
  assert.deepEqual(b.connectors[0]?.tools, { names: ["list_deals", "get_deal"], real: true });
  assert.equal(b.connectors[0]?.address, "https://mcp.acme.example/mcp");
  assert.equal(b.connectors[0]?.server?.status, "ready");
  assert.deepEqual(b.skills, [{ name: "deals", line: "Finds and updates deals." }]);
});

test("one whose files were not read says so instead of guessing; a remote plugin's server is still a connector", () => {
  const unread = bringsOf(item(), [], "en");
  assert.deepEqual([unread.known, unread.connectors.length, unread.skills], [false, 0, undefined]);
  const remote = bringsOf(item({ brings: ["tools"], entry: entry(undefined, { catalog: "c1" }) }), [], "en");
  assert.deepEqual([remote.known, remote.connectors.length, remote.skills], [false, 1, undefined]);
});

test("a list row marks what it brings by kind and count, leaving a count out when it is not known", () => {
  const full = item({
    entry: entry(
      contents({ skills: ["a", "b", "c"], agents: ["Closer"], companion: { name: "Acme TV", platform: "android-tv" } }),
    ),
  });
  assert.deepEqual(countsOf(full, "en"), [
    { kind: "connector", n: 1 },
    { kind: "skills", n: 3 },
    { kind: "agents", n: 1 },
    { kind: "device" },
  ]);
  // Only what its catalog says: skills, how many unknown.
  assert.deepEqual(countsOf(item({ brings: ["skills"] }), "en"), [{ kind: "skills" }]);
  // A channel and APX's own integrations are what they are, with nothing to count.
  assert.deepEqual(countsOf(item({ channel: "telegram", brings: ["accounts"] }), "en"), []);
});

test("a skill's line on the page is its first sentence, cut at a word when even that runs long", () => {
  assert.equal(shortLine("Finds deals. Use when the user asks for a deal."), "Finds deals.");
  assert.equal(shortLine("  Many\n spaces  "), "Many spaces");
  const long = `${"word ".repeat(60)}end.`;
  const cut = shortLine(long, 40) ?? "";
  assert.ok(cut.endsWith("…") && cut.length <= 41 && !cut.includes(" …"));
  assert.equal(shortLine(undefined), undefined);
});
