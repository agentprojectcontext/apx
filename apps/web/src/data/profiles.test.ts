import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import type { ProfileInfo } from "@apx/protocol";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProfilesState } from "./profiles.ts";

const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { location: { origin: "http://panel.example.test" } },
});
const profiles = await import("./profiles.ts");
if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
else Reflect.deleteProperty(globalThis, "window");
const { activeProfileName, loadProfiles, localized, setProfile, useProfiles } = profiles;

const secretary: ProfileInfo = {
  id: "secretary",
  name: { en: "Secretary", es: "Secretaria" },
  description: { en: "Chief of staff" },
  version: "1",
  prompt: "",
  settings: [],
  routines: [],
  source: "apx",
};
const listed = (id: string | null): ProfilesState => ({
  profiles: [secretary],
  active: { id, values: {} },
  routines: [],
  changed: [],
});

function mockRpc(t: TestContext, handlers: Record<string, unknown>) {
  t.mock.method(globalThis, "fetch", async (url: string) => {
    const result = handlers[url.split("/").at(-1) ?? ""];
    assert.ok(result, `unexpected RPC ${url}`);
    return Response.json({ ok: true, result });
  });
}

function Named() {
  return createElement("b", null, useProfiles((s) => activeProfileName(s, "es")) ?? "none");
}
/** What a screen that names the profile renders now. */
const shown = () => renderToStaticMarkup(createElement(Named)).replace(/<\/?b>/g, "");

test("the active profile is named in the owner's language, English when it has no translation", () => {
  assert.equal(activeProfileName({ profiles: listed("secretary"), failed: false }, "es"), "Secretaria");
  assert.equal(activeProfileName({ profiles: listed("secretary"), failed: false }, "pt"), "Secretary");
  assert.equal(localized(undefined, "es"), "");
});

test("no profile is null; not read yet is undefined, and a failed read counts as none", () => {
  assert.equal(activeProfileName({ profiles: listed(null), failed: false }, "es"), null);
  assert.equal(activeProfileName({ profiles: listed("gone"), failed: false }, "es"), null);
  assert.equal(activeProfileName({ failed: false }, "es"), undefined);
  assert.equal(activeProfileName({ failed: true }, "es"), null);
});

test("a switch from one screen reaches every screen that reads the shared profile", async (t) => {
  mockRpc(t, { "profiles.list": listed(null) });
  await loadProfiles();
  assert.equal(shown(), "none");
  mockRpc(t, { "profiles.set": { active: { id: "secretary", values: {} }, routines: [], changed: [] } });
  await setProfile("secretary", {});
  assert.equal(shown(), "Secretaria");
});
