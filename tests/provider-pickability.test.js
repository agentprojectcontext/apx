// What makes a provider unpickable — and what must not.
//
// The rule, stated once so both halves stay honest:
//
//   RED (not selectable)   the user switched it off, or it was never
//                          configured. Both are states the user owns and can
//                          fix, and neither can ever produce an answer.
//   YELLOW (selectable)    it did not answer the last check. A sleeping Ollama
//                          box, a rate limit, an exhausted monthly budget — all
//                          circumstantial, most of them self-healing.
//
// The picker used to collapse those into one `connected` flag, so an engine
// that was merely rate-limited could not be placed in the chain at all. That is
// backwards: a fallback chain exists precisely to hold entries that are not
// answering right now, and refusing the row is what makes the chain useless the
// moment a provider has a bad minute.
//
// Front end asserted from the backend suite — same pattern as
// engine-catalog-adoption.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const WEB_SRC = path.join(__dirname, "..", "src", "interfaces", "web", "src");
const PICKER = path.join(WEB_SRC, "components", "settings", "providerPicker.tsx");
const STUB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "apx-picker-"));

/** The picker's React/UI neighbours, which these pure functions never touch. */
const INERT = path.join(STUB_DIR, "inert.tsx");
fs.writeFileSync(
  INERT,
  "export const Combobox = () => null;\nexport const ModelCombobox = () => null;\n" +
    "export const useMemo = (f) => f();\nexport default {};\n"
);

/** Class-name helpers the pure functions under test never call. */
const PANEL_ONLY = ["clsx", "tailwind-merge"];

const picker = (() => {
  const entry = path.join(STUB_DIR, "entry.tsx");
  fs.writeFileSync(
    entry,
    fs
      .readFileSync(PICKER, "utf8")
      .replace('from "react"', `from ${JSON.stringify(INERT)}`)
      .replace('from "../Combobox"', `from ${JSON.stringify(INERT)}`)
      .replace('from "../ModelCombobox"', `from ${JSON.stringify(INERT)}`)
      .replaceAll('"./providers/typeStyles"', JSON.stringify(path.join(WEB_SRC, "components", "settings", "providers", "typeStyles")))
      .replaceAll('"../../i18n"', JSON.stringify(path.join(WEB_SRC, "i18n")))
      .replaceAll('"../agents/modelEffort"', JSON.stringify(path.join(WEB_SRC, "components", "agents", "modelEffort")))
  );
  const built = buildSync({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
    logLevel: "silent",
    loader: { ".tsx": "tsx", ".ts": "ts" },
    jsx: "transform",
    // clsx / tailwind-merge arrive through modelEffort → lib/cn.ts and live
    // only in the panel's own node_modules. The release job installs the root
    // alone, so resolving them failed there and blocked every publish from
    // v1.117.1 on — while `verify`, which installs the panel, stayed green.
    external: ["lucide-react", "react", "react/jsx-runtime", ...PANEL_ONLY],
  });
  const stub = (id) => {
    if (id.startsWith("react") || id === "lucide-react" || PANEL_ONLY.includes(id)) {
      return new Proxy({}, { get: () => function Stub() {} });
    }
    return require(id);
  };
  const mod = { exports: {} };
  new Function("module", "exports", "require", built.outputFiles[0].text)(mod, mod.exports, stub);
  return mod.exports;
})();

const { providersFromEngines, rowProblem, providerTargetsOf, modelOptionsFor } = picker;

/** Shorthand: build the provider list for one engines map. */
const build = (engines, ollamaOnline = {}) => providersFromEngines(engines, ollamaOnline);
const bySlug = (list, slug) => list.find((p) => p.slug === slug);

test("an engine that ships its own credential is configured with no api key", () => {
  // Zen answers on a built-in "public" key and Ollama needs none at all. Asking
  // them for one and calling them "not connected" was wrong on both counts.
  const list = build({
    zen: { engine: "zen" },
    ollama: { engine: "ollama" },
    anthropic: { engine: "anthropic" },
  });
  assert.equal(bySlug(list, "zen").configured, true, "zen has a built-in key");
  assert.equal(bySlug(list, "ollama").configured, true, "ollama needs no key");
  assert.equal(bySlug(list, "anthropic").configured, false, "a normal engine still needs one");
});

test("an unreachable provider stays configured — health is not configuration", () => {
  const list = build({ ollama: { engine: "ollama" } }, { ollama: false });
  const p = bySlug(list, "ollama");
  assert.equal(p.reachable, false, "the probe failed and that is reported");
  assert.equal(p.configured, true, "but it is still a usable row");
  assert.equal(rowProblem("ollama", list), "unreachable", "surfaced as a warning, not a block");
});

test("a provider still being probed is not reported as down", () => {
  // `undefined` means the probe has not answered yet. Treating that as failure
  // made the list flicker to a warning on every first paint.
  const list = build({ ollama: { engine: "ollama" } }, {});
  assert.equal(bySlug(list, "ollama").reachable, true);
  assert.equal(rowProblem("ollama", list), null);
});

test("only the switch and missing configuration are blocking problems", () => {
  const list = build({
    off: { engine: "groq", api_key: "k", is_active: false },
    nokey: { engine: "groq" },
    down: { engine: "ollama" },
    fine: { engine: "groq", api_key: "k" },
  }, { down: false });

  assert.equal(rowProblem("off", list), "off");
  assert.equal(rowProblem("nokey", list), "unconfigured");
  assert.equal(rowProblem("down", list), "unreachable");
  assert.equal(rowProblem("fine", list), null);
  assert.equal(rowProblem("never-heard-of-it", list), "missing");
});

test("custom points somewhere on either a key or a base_url", () => {
  const list = build({
    url_only: { engine: "custom", base_url: "https://api.northwind.example/v1" },
    key_only: { engine: "custom", api_key: "k" },
    neither: { engine: "custom" },
  });
  assert.equal(bySlug(list, "url_only").configured, true);
  assert.equal(bySlug(list, "key_only").configured, true);
  assert.equal(bySlug(list, "neither").configured, false);
});

// Regression: the chain editors (router + project models) only probed Ollama,
// so a cloud provider showed the curated `known_models` while the chat picker
// showed what that provider actually lists live — a new model appeared in one
// and not the other.
test("the chain probes every active provider, not only Ollama", () => {
  const targets = providerTargetsOf({
    box: { engine: "ollama", base_url: "http://box.example:11434" },
    cloud: { engine: "openai", api_key: "k" },
    off: { engine: "groq", api_key: "k", is_active: false },
  });
  assert.deepEqual(targets.map((t) => t.slug).sort(), ["box", "cloud"]);
  assert.equal(targets.find((t) => t.slug === "cloud").engine, "openai");
  assert.equal(targets.find((t) => t.slug === "box").base_url, "http://box.example:11434");
});

test("a live model list replaces the curated one; curated is only the offline fallback", () => {
  const [cloud] = build({ cloud: { engine: "openai", api_key: "k", default_model: "acme-base" } });

  const live = modelOptionsFor(cloud, { cloud: ["acme-next", "acme-base"] });
  assert.deepEqual(live, ["acme-base", "acme-next"], "default first, then only what the provider listed");

  const offline = modelOptionsFor(cloud, {});
  assert.ok(offline.length > 1, "no live answer falls back to known_models");
  assert.ok(!offline.includes("acme-next"));

  const [box] = build({ box: { engine: "ollama" } });
  assert.deepEqual(modelOptionsFor(box, {}), [], "Ollama has no curated list");
  assert.deepEqual(modelOptionsFor(box, { box: ["tiny:1b"] }), ["tiny:1b"]);
});
