// The panel must offer an engine that core registered and this build predates.
//
// It used not to. `loadEnginePresets()` hydrated the catalog by looking each
// engine up in the bundled ENGINE_PRESETS and `continue`-ing when it was
// absent, so an adapter added in src/core/engines/ reached the daemon, got
// served by GET /engines/presets, and was then dropped on the floor by the very
// function whose job was to pick it up. The engine was live in the CLI and
// invisible in the provider dialog — with no error anywhere, because skipping
// was the intended path for an id the panel did not recognise.
//
// This test would have failed before that fix: it feeds the loader an engine
// name typeStyles.ts has never heard of and asserts the dropdown grew.
//
// Front end asserted from the backend suite, same as web-guardrails.test.js —
// esbuild is already a devDep and this suite already runs in preflight.
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
const TYPE_STYLES = path.join(
  __dirname, "..", "src", "interfaces", "web", "src",
  "components", "settings", "providers", "typeStyles.ts"
);

/**
 * typeStyles.ts, loaded with its two outside reaches redirected: the icon pack
 * (React components we never render) and the daemon client, which is the point
 * of control — it hands back the catalog the test wants the loader to see.
 *
 * The redirect is done by rewriting the import specifiers to absolute paths in
 * a throwaway entry file, not by esbuild's `external` or `alias`. `external`
 * leaves a live `import()` that never reaches a stubbed `require` — and the
 * loader swallows that failure by design, so the test would pass vacuously —
 * while `alias` rejects a relative specifier outright.
 */
const WEB_SRC = path.join(__dirname, "..", "src", "interfaces", "web", "src");
const STUB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "apx-engines-stub-"));
const STUB = path.join(STUB_DIR, "engines-stub.ts");
fs.writeFileSync(
  STUB,
  "export const Engines = { presets: async () => ({ presets: globalThis.__APX_TEST_PRESETS__ }) };\n"
);

/** Load typeStyles.ts fresh, with the daemon serving `presets`. */
function loadTypeStyles(presets) {
  globalThis.__APX_TEST_PRESETS__ = presets;
  const entry = path.join(STUB_DIR, "entry.ts");
  fs.writeFileSync(
    entry,
    fs
      .readFileSync(TYPE_STYLES, "utf8")
      .replaceAll('"../../../lib/api/engines"', JSON.stringify(STUB))
      .replaceAll('"../../../lib/tone"', JSON.stringify(path.join(WEB_SRC, "lib", "tone")))
  );
  const built = buildSync({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
    logLevel: "silent",
    external: ["lucide-react", "react"],
  });
  const stub = (id) => {
    if (id === "lucide-react") return new Proxy({}, { get: () => function Icon() {} });
    if (id === "react") return {};
    return require(id);
  };
  const mod = { exports: {} };
  new Function("module", "exports", "require", built.outputFiles[0].text)(mod, mod.exports, stub);
  return mod.exports;
}

test("an engine the panel does not ship is adopted, not skipped", async () => {
  const m = loadTypeStyles({
    // Deliberately not a real adapter: the guarantee is about ANY id core adds
    // later, not about whichever one happened to be new when this was written.
    northwind: {
      base_url: "https://api.northwind.example/v1",
      default_model: "northwind-fast",
      api_key_env: "NORTHWIND_API_KEY",
      known_models: ["northwind-fast", "northwind-large"],
    },
  });

  assert.ok(
    !m.ENGINE_OPTIONS.some((o) => o.value === "northwind"),
    "precondition: the bundled dropdown must not already know this engine"
  );

  await m.loadEnginePresets();

  const option = m.ENGINE_OPTIONS.find((o) => o.value === "northwind");
  assert.ok(option, "an engine served by the daemon must reach the provider dropdown");
  assert.equal(option.label, "Northwind", "an unlabelled engine gets a display name derived from its id");

  const preset = m.ENGINE_PRESETS.northwind;
  assert.ok(preset, "its preset must be stored so the form can auto-fill");
  assert.equal(preset.base_url, "https://api.northwind.example/v1");
  assert.equal(preset.api_key_env, "NORTHWIND_API_KEY");
  assert.deepEqual(preset.known_models, ["northwind-fast", "northwind-large"]);
});

test("an engine the panel does ship keeps its own label and gains the daemon's models", async () => {
  const m = loadTypeStyles({
    groq: { base_url: "", default_model: "", api_key_env: "", known_models: ["brand-new-model"] },
  });

  await m.loadEnginePresets();

  const groq = m.ENGINE_OPTIONS.filter((o) => o.value === "groq");
  assert.equal(groq.length, 1, "a known engine must not be appended twice");
  assert.equal(groq[0].label, "Groq", "its curated label survives hydration");
  assert.ok(
    m.ENGINE_PRESETS.groq.known_models.includes("brand-new-model"),
    "models merge rather than replace"
  );
  assert.ok(
    m.ENGINE_PRESETS.groq.base_url,
    "an empty value from the daemon must not blank a curated one"
  );
});

test("styling falls back to the generic look for an engine with no palette", () => {
  const m = loadTypeStyles({});
  assert.equal(m.engineStyle(m.ENGINE_GRADIENTS, "northwind"), m.ENGINE_GRADIENTS.custom);
  assert.equal(m.engineStyle(m.ENGINE_GRADIENTS, "groq"), m.ENGINE_GRADIENTS.groq);
  assert.ok(m.engineStyle(m.ENGINE_ICONS, "northwind"), "an unknown engine still gets an icon");
});
