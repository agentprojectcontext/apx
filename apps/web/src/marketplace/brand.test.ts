import assert from "node:assert/strict";
import { test } from "node:test";
import type { CatalogEntry, ExtensionInfo } from "@apx/protocol";
import { iconFiles, officialMcpProvider } from "./brand.ts";

const entry: CatalogEntry = {
  id: "acme",
  name: "Acme",
  description: "",
  categories: [],
  version: "1.0.0",
  provenance: "official",
  mcp_provider: "Acme",
  icon_url: "https://example.com/avatar-v1.svg",
};

test("the official avatar stays separate from the neutral package icon", () => {
  const item = { entry, listing: { icon: "icon.svg" } };
  // Only the icon matters to this selection; the listing's copy has no role here.
  const files = iconFiles({ entry, listing: { ...item.listing } as NonNullable<CatalogEntry["listing"]> });
  assert.equal(files.file, "@icon");
  assert.equal(files.fallback, "icon.svg");
  assert.equal(officialMcpProvider({ entry }), "Acme");
  assert.notEqual(
    files.revision,
    iconFiles({ entry: { ...entry, icon_url: "https://example.com/avatar-v2.svg" } }).revision,
  );
  assert.notEqual(files.revision, iconFiles({ entry: { ...entry, version: "1.0.1" } }).revision);
});

test("an added catalog cannot claim APX attribution even if it claims official provenance", () => {
  assert.equal(officialMcpProvider({ entry: { ...entry, catalog: "added" } }), undefined);
  assert.equal(officialMcpProvider({ entry: { ...entry, provenance: "third_party" } }), undefined);
  assert.equal(officialMcpProvider({ entry: { ...entry, mcp_provider: undefined } }), undefined);
});

test("an installed third-party copy cannot inherit official brand attribution or avatar preference", () => {
  const ext = { id: "acme", provenance: "third_party", hash: "other" } as ExtensionInfo;
  const listing = { icon: "own.svg" } as NonNullable<CatalogEntry["listing"]>;
  assert.equal(officialMcpProvider({ entry, ext }), undefined);
  assert.equal(iconFiles({ entry, ext, listing }).file, "own.svg");
  assert.equal(iconFiles({ entry, ext }).file, undefined);
  const official = { ...ext, provenance: "official" } as ExtensionInfo;
  assert.equal(officialMcpProvider({ entry, ext: official }), "Acme");
  assert.equal(officialMcpProvider({ entry, ext: { ...official, id: "other" } }), undefined);
  assert.equal(iconFiles({ entry, ext: official, listing }).file, "@icon");
  assert.equal(iconFiles({ listing }).file, "own.svg");
  assert.equal(iconFiles({ entry: { ...entry, icon_url: undefined }, listing }).file, "own.svg");
});
