import assert from "node:assert/strict";
import { test } from "node:test";
import type { AutoDecisionNote } from "@apx/protocol";
import { esChat } from "../../i18n/es-chat.ts";
import type { T } from "../../i18n/index.ts";
import { decisionDetail, decisionVerdict } from "./autoDecision.ts";

const texts = esChat as Record<string, string>;
const t: T = (key, vars) => (texts[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? ""));

const note = (n: Partial<AutoDecisionNote>): AutoDecisionNote => ({
  id: "adl_1",
  kind: "action",
  verdict: "run",
  by: "judge",
  reasons: ["url_data"],
  items: ["Leyó support.google.com"],
  ...n,
});

test("the line says only that Auto approved it; it opens to the model and its why, or the fixed rule", () => {
  const judged = note({ model: "chatgpt/gpt-6-luna", why: "lo pediste vos" });
  assert.equal(decisionVerdict(judged, t), "Auto lo aprobó");
  assert.equal(decisionDetail(judged, t, "GPT-6-Luna"), "GPT-6-Luna · lo pediste vos");
  assert.equal(decisionDetail(note({ model: "chatgpt/gpt-6-luna" }), t, "GPT-6-Luna"), "GPT-6-Luna");
  assert.equal(decisionDetail(note({ kind: "deletion", by: "rule", reasons: ["output"] }), t), "Regla fija");
  // In the owner's list, what waited for them.
  const asked = note({ verdict: "ask" });
  assert.deepEqual(
    [decisionVerdict(asked, t), decisionDetail(asked, t)],
    ["Auto te preguntó", "Sin respuesta del modelo"],
  );
});
