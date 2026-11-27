import assert from "node:assert/strict";
import { test } from "node:test";
import { ExtensionSetting } from "./extensions.ts";

const setting = { name: "account", label: "Account", description: "Choose an account.", type: "string" };

test("extension setting translations are optional and preserve English fallback copy", () => {
  assert.equal(ExtensionSetting.parse(setting).locales, undefined);
  for (const es of [{ label: "Cuenta" }, { description: "Elegí una cuenta." }, {}]) {
    const parsed = ExtensionSetting.parse({ ...setting, locales: { es } });
    assert.deepEqual(parsed.locales, { es });
    assert.equal(parsed.label, setting.label);
    assert.equal(parsed.description, setting.description);
  }
});

test("extension setting translations enforce the same copy bounds and reject unknown keys", () => {
  for (const locales of [
    { es: { label: " " } },
    { es: { label: "x".repeat(121) } },
    { es: { description: "x".repeat(301) } },
    { es: { sensitive: false } },
    { fr: { label: "Compte" } },
  ]) {
    assert.equal(ExtensionSetting.safeParse({ ...setting, locales }).success, false);
  }
  const parsed = ExtensionSetting.parse({ ...setting, locales: { es: { label: " Cuenta " } } });
  assert.equal(parsed.locales?.es?.label, "Cuenta");
});
