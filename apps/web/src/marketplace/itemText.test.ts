import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionInfo, McpServerStatus } from "@apx/protocol";
import type { Item } from "../resources/extensionItems.ts";
import { accessLines, authText, kindText, nameFor, newest, nextStep, waitReason } from "./itemText.ts";

// The key with its values, so a test reads what the screen would say without the dictionaries.
const t = (key: string, vars?: Record<string, string | number>) =>
  vars ? `${key}(${Object.values(vars).join(",")})` : key;

const item = (extra: Partial<Item> = {}): Item => ({
  key: "catalog:x",
  id: "x",
  name: "X",
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
const ext = (extra: Partial<ExtensionInfo> = {}): ExtensionInfo =>
  ({
    id: "x",
    name: "X",
    version: "1.0.0",
    enabled: true,
    secrets: [],
    settings: [],
    skills: [],
    mcp: [],
    routines: [],
    agents: [],
    apps: [],
    hosts: [],
    runs_code: false,
    ...extra,
  }) as ExtensionInfo;

test("one next step per state: add, connect, pair a device, then done", () => {
  assert.equal(nextStep(item()), "add");
  assert.equal(nextStep(item({ origin: "included" })), "connect");
  assert.equal(nextStep(item({ state: "off", ext: ext({ enabled: false }) })), "connect");
  const tv = ext({ companion: { name: "APX TV", platform: "android-tv", steps: [], pairing: { with: "apx" } } });
  assert.equal(nextStep(item({ state: "off", ext: { ...tv, enabled: false } })), "pair");
  assert.equal(nextStep(item({ state: "on", ext: tv })), "pair");
  assert.equal(nextStep(item({ state: "attention", attention: "keys", ext: ext() })), "keys");
  assert.equal(nextStep(item({ state: "off", attention: "update-waits", ext: ext({ enabled: false }) })), "review");
  assert.equal(nextStep(item({ state: "on", ext: ext() })), "done");
});

test("why one of the owner's own waits, and nothing for one that works", () => {
  assert.equal(waitReason(item({ state: "on", update: "1.0.2" }), t), "mkt.why.update(1.0.2)");
  assert.equal(waitReason(item({ state: "off", ext: ext() }), t), "mkt.why.off");
  assert.equal(waitReason(item({ state: "attention", attention: "error" }), t), "mkt.why.error");
  assert.equal(waitReason(item({ state: "on" }), t), undefined);
});

test("a connector with skills is a connector; what it reaches and how it signs in come from its data only", () => {
  const e = ext({
    skills: ["a"],
    hosts: ["api.hubapi.com"],
    runs_code: true,
    secrets: [{ name: "k", label: "Key", set: true }],
  });
  const hub = item({ brings: ["accounts"], ext: e, state: "on" });
  // A server with skills to use it is a connector all the same.
  assert.equal(kindText(hub, t), "mkt.kind.connector");
  assert.deepEqual(accessLines(hub, t), ["mkt.access.hosts(api.hubapi.com)", "mkt.access.code"]);
  assert.equal(authText(hub, t), "mkt.auth.key");
  // An account APX ships with no keys: unknown until connected, then said by how its server is reached.
  const account = (server?: Partial<McpServerStatus>) =>
    item({
      integration: { id: "d", label: "D", description: "", fields: [], connected: !!server, coming: false, off_in: [] },
      ...(server ? { server: server as McpServerStatus } : {}),
    });
  assert.equal(authText(account(), t), undefined);
  assert.equal(authText(account({ transport: "http", target: "https://mcp.d.example/mcp" }), t), "mkt.auth.none");
  assert.equal(authText(account({ transport: "stdio", target: "npx" }), t), "mkt.auth.signIn");
});

test("new ones stand out only while most of the catalog is not new", () => {
  const now = Date.parse("2026-11-18T12:00:00Z");
  const at = (id: string, published: string) => item({ id, key: id, published });
  const old = Array.from({ length: 5 }, (_, n) => at(`old${n}`, "2026-01-01T00:00:00Z"));
  assert.deepEqual(
    newest([...old, at("b", "2026-11-10T00:00:00Z"), at("a", "2026-11-17T00:00:00Z")], now).map((i) => i.id),
    ["a", "b"],
  );
  // A catalog published all at once has nothing new to point at.
  assert.deepEqual(newest([at("a", "2026-11-17T00:00:00Z"), at("b", "2026-11-17T00:00:00Z")], now), []);
});

test("an address gets a short free name from its host", () => {
  assert.equal(nameFor("https://mcp.acme.example/mcp", []), "acme");
  assert.equal(nameFor("https://mcp.acme.example/mcp", ["acme"]), "acme-2");
  assert.equal(nameFor("https://api.northwind.test/v1", []), "northwind");
});
