import assert from "node:assert/strict";
import { test } from "node:test";
import { ExtensionContents, ExtensionManifest } from "@apx/protocol";
import { contentsOf } from "./summary.ts";

test("catalog contents keep translated required setting labels without values or optional settings", () => {
  const manifest = ExtensionManifest.parse({
    id: "acme",
    name: "Acme",
    version: "1.0.0",
    settings: [
      {
        name: "workspace",
        label: "Workspace",
        type: "string",
        required: true,
        locales: { es: { label: "Espacio de trabajo" } },
      },
      { name: "region", label: "Region", type: "string", required: true },
      { name: "optional", label: "Optional", type: "string" },
      { name: "preset", label: "Preset", type: "string", required: true, default: "preset-value" },
      { name: "private", label: "Private key", type: "string", required: true, sensitive: true },
    ],
  });
  const contents = ExtensionContents.parse(contentsOf(manifest, "0123456789abcdef", undefined));
  assert.deepEqual(contents.settings, ["Workspace", "Region"]);
  assert.deepEqual(contents.setting_labels, [
    { label: "Workspace", locales: { es: { label: "Espacio de trabajo" } } },
    { label: "Region" },
  ]);
  assert.deepEqual(contents.keys, ["Private key"]);
});

test("catalog contents without translations preserve the legacy labels", () => {
  const manifest = ExtensionManifest.parse({
    id: "acme",
    name: "Acme",
    version: "1.0.0",
    settings: [{ name: "workspace", label: "Workspace", type: "string", required: true }],
  });
  const contents = contentsOf(manifest, "0123456789abcdef", undefined);
  assert.deepEqual(contents.settings, ["Workspace"]);
  assert.equal(contents.setting_labels, undefined);
});
