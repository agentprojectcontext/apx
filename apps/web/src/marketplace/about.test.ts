import assert from "node:assert/strict";
import { test } from "node:test";
import type { CatalogEntry, ExtensionInfo } from "@apx/protocol";
import { aboutEntry, aboutExtension, connectText, originOf, refusalOf, toolsLine } from "./about.ts";

// The key with its values, so a test reads what the add box would say without the dictionaries.
const t = (key: string, vars?: Record<string, string | number>) =>
  vars ? `${key}(${Object.values(vars).join(",")})` : key;

const ext = (extra: Partial<ExtensionInfo> = {}): ExtensionInfo => ({
  id: "billing",
  name: "Northwind Billing",
  version: "1.0.0",
  description: "Invoices.",
  enabled: false,
  hash: "ab0d00ddb82cb2e3",
  source: "https://marketplace.example.com/billing-1.0.0.apxext",
  skills: [],
  mcp: ["billing-service"],
  routines: [],
  secrets: [{ name: "token", label: "Billing token", set: false }],
  runs_code: true,
  installed_at: "",
  provenance: "official",
  brings: ["accounts", "tools"],
  needs: ["code"],
  hosts: ["mcp.billing.example.com"],
  settings: [],
  agents: [],
  pages: [],
  apps: [],
  ...extra,
});

test("an inspected package: its files' provenance, its keys, and its tools by its listing until its servers ran", () => {
  const listing = {
    summary: "Invoices.",
    features: [],
    requirements: ["A billing account"],
    limits: [],
    pricing: "",
    privacy: "",
    prompts: [],
    captions: [],
    screenshots: [],
    tools: [{ name: "list_invoices" }, { name: "get_payment" }],
  };
  const a = aboutExtension(ext({ listing }), "en", { label: "official" });
  assert.equal(a.files, "official");
  assert.deepEqual(a.keys, ["Billing token"]);
  assert.deepEqual(a.tools, { names: ["list_invoices", "get_payment"], real: false });
  assert.deepEqual(a.requirements, ["A billing account"]);
  // Once its server answered, the real ones count.
  const ran = aboutExtension(ext({ listing }), "en", { label: "official", tools: ["search", "get"] });
  assert.deepEqual(ran.tools, { names: ["search", "get"], real: true });
  // Third-party files say so; the catalog not reached says it can't tell; one's own folder says nothing.
  assert.equal(aboutExtension(ext({ provenance: "third_party" }), "en", { label: "third" }).files, "third");
  assert.equal(aboutExtension(ext({ catalog: "unreachable" }), "en", { label: "third" }).files, "unknown");
  assert.equal(aboutExtension(ext(), "en", { label: "own" }).files, undefined);
});

test("a catalog entry not added yet shows what its package holds", () => {
  const entry: CatalogEntry = {
    id: "billing",
    name: "Northwind Billing",
    description: "Invoices.",
    categories: [],
    version: "1.0.0",
    provenance: "official",
    contents: {
      hosts: ["mcp.billing.example.com"],
      runs_code: true,
      servers: 1,
      keys: [],
      skills: ["billing"],
      agents: [],
      routines: ["Monday 9:00"],
      hash: "ab0d00ddb82cb2e3",
    },
  };
  const a = aboutEntry(entry, "en");
  assert.equal(a.origin?.kind, "apx");
  assert.deepEqual(
    [a.hosts, a.runsCode, a.skills, a.routines],
    [["mcp.billing.example.com"], true, ["billing"], ["Monday 9:00"]],
  );
  assert.equal(a.files, "official");
  // Before APX read its package, nothing is guessed but what the catalog says it brings.
  const unread = aboutEntry({ ...entry, contents: undefined, brings: ["tools"], needs: ["code"] }, "en");
  assert.deepEqual([unread.hosts, unread.runsCode, unread.servers, unread.hash], [[], true, 1, undefined]);
});

test("the add box preserves declared authorship without inferring it from provenance", () => {
  const listing = {
    summary: "Community connector.",
    publisher: { name: "Northwind", verified: false },
    features: [],
    requirements: [],
    limits: [],
    pricing: "",
    privacy: "",
    prompts: [],
    captions: [],
    screenshots: [],
    tools: [],
  };
  assert.equal(aboutExtension(ext({ listing }), "en", { label: "official" }).publisher, "Northwind");
  assert.equal(aboutExtension(ext(), "en", { label: "official" }).publisher, undefined);
  assert.equal(aboutExtension(ext(), "en", { label: "own", look: { listing } }).publisher, "Northwind");
  const entry: CatalogEntry = {
    id: "billing",
    name: "Acme Billing",
    description: "Invoices.",
    categories: [],
    version: "1.0.0",
    provenance: "official",
    publisher: "Northwind",
    github: "acme",
  };
  assert.equal(aboutEntry(entry, "en").publisher, "Northwind");
  assert.equal(aboutEntry({ ...entry, listing }, "en").publisher, "Northwind");
  assert.equal(aboutEntry({ ...entry, publisher: undefined }, "en").publisher, undefined);
});

test("where it comes from, how it connects and its tools, in a few words", () => {
  assert.deepEqual(originOf("~/work/crm"), { kind: "folder", path: "~/work/crm" });
  assert.deepEqual(originOf("https://dl.example.com/crm.apxext"), { kind: "url", host: "dl.example.com" });
  assert.deepEqual(originOf("crm · Acme plugins"), { kind: "catalog", name: "Acme plugins" });
  assert.deepEqual(originOf("crm.apxext"), { kind: "file", name: "crm.apxext" });
  const a = aboutExtension(ext(), "en", { label: "official" });
  assert.equal(connectText(a, t), "Billing token");
  assert.equal(connectText({ ...a, connection: "oauth" }, t), "box.how.signIn(Northwind Billing)");
  assert.equal(connectText({ ...a, keys: [], runsCode: false }, t), "box.how.nothing");
  assert.equal(toolsLine(["list_invoices", "get_payment"], t), "list invoices mkt.and get payment");
  assert.equal(toolsLine(["a", "b", "c"], t, 2), "box.andMore(a, b,1)");
});

test("a refusal's reason comes from the error's detail; any other error has none", () => {
  assert.deepEqual(refusalOf({ detail: { reason: "newer_apx", needs: "2.18.0" } }), {
    reason: "newer_apx",
    needs: "2.18.0",
  });
  assert.equal(refusalOf(new Error("boom")), undefined);
  assert.equal(refusalOf({ detail: "text" }), undefined);
});
