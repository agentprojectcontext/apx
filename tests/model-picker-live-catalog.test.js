// The model picker offers the models of the ACTIVE providers, asked for by name.
//
// The picker in the chat composer — also the one that sets the compaction model
// in Settings › Memory — built its own list from `GET /engines`. That endpoint
// returns the ADAPTER ids this build ships (anthropic, openai, groq, ollama,
// mock…), not the providers the user configured, and three things followed from
// the confusion, none of which printed an error:
//
//   • It probed each one with `{ engine }` alone. The daemon looks the stored
//     api_key up by PROVIDER SLUG, and `base_url` is the only way to say WHERE
//     the server is — so Ollama was asked at 127.0.0.1 while this install runs
//     it on another machine. Empty list, 502 swallowed, nothing to see.
//   • It probed providers the user had switched off, and could never probe one
//     configured under a slug of its own (`my-groq` → engine `groq`).
//   • It prefixed `<engine>:` only when the model id had no colon of its own.
//     Every Ollama id has one, so `gemma3:4b` was offered whole — and read back
//     by resolveProvider() as the provider "gemma3", which is nothing.
//
// The fix is one catalog (components/agents/modelCatalog) over one probe
// (hooks/useProviderModels), shared by every picker in the panel.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.join(ROOT, "src/interfaces/web/src");
const read = (p) => fs.readFileSync(path.join(WEB, p), "utf8");

const probe = read("hooks/useProviderModels.ts");
const catalog = read("components/agents/modelCatalog.ts");
const picker = read("components/chat/ModelPicker.tsx");

test("the probe tells the daemon which provider, and where it lives", () => {
  const call = probe.slice(probe.indexOf("Engines.models("));
  const args = call.slice(0, call.indexOf(";"));
  assert.match(args, /slug:\s*t\.slug/, "the api_key is stored under the slug, not the adapter id");
  assert.match(args, /base_url:\s*t\.base_url/, "Ollama is routinely not on localhost");
  assert.match(args, /engine:\s*t\.engine \|\| t\.slug/, "adapter id, defaulting to the slug like the daemon does");
});

test("only the providers the user left switched on are offered", () => {
  assert.match(catalog, /is_active !== false/, "the probe targets skip a provider that is off");
  assert.match(catalog, /is_active === false/, "and so does the list built from them");
});

test("a provider that answers wins over the curated offline list", () => {
  // core/engines/presets.js says so in as many words, and Ollama's known_models
  // is empty on purpose — the catalog only exists on the machine.
  assert.match(
    catalog,
    /probed\.length \? probed : \(catalog\[engine\]\?\.known_models \?\? \[\]\)/,
    "live (or last cached) list first, curated presets only as the fallback",
  );
});

test("every option is a whole <provider>:<model> id", () => {
  assert.match(picker, /`\$\{p\.slug\}:\$\{m\}`/, "the slug always leads");
  assert.doesNotMatch(
    picker,
    /includes\(":"\)\s*\?/,
    "a colon in the model half means nothing about the provider half",
  );
});

test("the chat picker does not keep its own catalog", () => {
  assert.match(picker, /useModelCatalog\(\{ enabled: open \}\)/, "shared, and only once opened");
  assert.doesNotMatch(picker, /Engines\.list\(\)/, "adapter ids are not configured providers");
});

test("one place asks the daemon for a provider's models", () => {
  const callers = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && fs.readFileSync(p, "utf8").includes("Engines.models("))
        callers.push(path.relative(WEB, p));
    }
  };
  walk(WEB);
  assert.deepEqual(callers.sort(), [
    // The provider form probes a provider that is not saved yet, with a key
    // typed into the field — nothing the shared cache could answer for.
    "components/settings/providers/ProviderModal.tsx",
    "hooks/useProviderModels.ts",
  ]);
});
