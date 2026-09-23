// Reasoning effort is a setting of a model, not another model.
//
// The panel used to show `chatgpt-codex:gpt-5.6-luna@high` as if `@high` were a
// model of its own, picked from the same list as the model — so "luna high" and
// "luna medium" read as two models. The storage stays one string (the suffix
// every place that holds a model already carries); what these pin is that every
// model picker edits the effort on its own control, and that the id is SHOWN as
// "model · effort".
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ENGINE_PRESETS } from "#core/engines/presets.js";
import { CODEX_EFFORTS, splitModelEffort } from "#core/engines/codex-plus.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const web = (...p) => fs.readFileSync(path.join(__dirname, "..", "src", "interfaces", "web", "src", ...p), "utf8");

test("the efforts the panel offers are the ones the engine reads", () => {
  assert.deepEqual([...CODEX_EFFORTS], ENGINE_PRESETS["codex-plus"].efforts);
  // The offline fallback in the panel mirrors the served presets.
  const styles = web("components", "settings", "providers", "typeStyles.ts");
  assert.match(styles, /efforts: \["minimal", "low", "medium", "high", "xhigh"\]/);
  // And the suffix the panel writes is the one the adapter splits off.
  assert.deepEqual(splitModelEffort("gpt-5.6-luna@high"), { model: "gpt-5.6-luna", effort: "high" });
});

test("every model picker edits the effort on its own control", () => {
  for (const file of [
    ["components", "chat", "ModelPicker.tsx"],
    ["components", "settings", "providerPicker.tsx"],
    ["components", "agents", "AgentModelBadge.tsx"],
  ]) {
    const src = web(...file);
    assert.match(src, /<EffortChips\b/, `${file.at(-1)} has no effort control`);
    assert.match(src, /splitEffort\(/, `${file.at(-1)} lists the model with its effort glued on`);
  }
});

test("a stored id is shown as model · effort", () => {
  const helper = web("components", "agents", "modelEffort.tsx");
  assert.match(helper, /`\$\{base\} · \$\{effort\}`/);
  for (const file of [
    ["components", "chat", "MessageBubble.tsx"],
    ["components", "settings", "DefaultRouterCard.tsx"],
    ["components", "agents", "AgentModelBadge.tsx"],
    ["components", "chat", "ModelPicker.tsx"],
  ]) {
    assert.match(web(...file), /modelLabel\(/, `${file.at(-1)} prints the raw @suffix`);
  }
});
