import assert from "node:assert/strict";
import { test } from "node:test";
import { ExtensionSetting } from "@apx/protocol";
import { settingText } from "./settingText.ts";

const setting = { name: "project", label: "Cloud project", description: "Choose a project.", type: "string" };

test("setting copy follows the language with independent English fallbacks", () => {
  const s = ExtensionSetting.parse({ ...setting, locales: { es: { label: "Proyecto en la nube" } } });
  assert.deepEqual(settingText(s, "es"), { label: "Proyecto en la nube", description: "Choose a project." });
  assert.deepEqual(settingText(s, "en"), { label: "Cloud project", description: "Choose a project." });
  assert.deepEqual(settingText(s, "fr"), settingText(s, "en"));
  assert.deepEqual(settingText(ExtensionSetting.parse(setting), "es"), settingText(s, "en"));
  const hint = ExtensionSetting.parse({ ...setting, locales: { es: { description: "Elegí un proyecto." } } });
  assert.deepEqual(settingText(hint, "es"), { label: "Cloud project", description: "Elegí un proyecto." });
  assert.equal(s.name, "project");
});

test("setting translations obey strict copy-only bounds", () => {
  for (const locales of [
    { es: { label: " " } },
    { es: { label: "x".repeat(121) } },
    { es: { description: "x".repeat(301) } },
    { es: { name: "other" } },
    { es: { default: "other" } },
    { fr: { label: "Projet" } },
  ])
    assert.equal(ExtensionSetting.safeParse({ ...setting, locales }).success, false);
});
