import assert from "node:assert/strict";
import { test } from "node:test";
import { enFlow } from "../i18n/flow-en.ts";
import type { MessageKey } from "../i18n/index.ts";
import { entryLabel, type HistoryEntry, kindLabel, whoSaved } from "./history.ts";

/** The English words, filled in as the panel does. */
const t = (key: MessageKey, vars: Record<string, string | number> = {}) =>
  String(enFlow[key as keyof typeof enFlow] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));

const entry = (over: Partial<HistoryEntry>): HistoryEntry => ({
  entry: 3,
  at: "2026-10-29T14:02:00.000Z",
  kind: "draft",
  by: null,
  byName: null,
  restoredFrom: null,
  revision: null,
  steps: 4,
  ...over,
});

test("a version says what it was and who saved it, in words", () => {
  assert.equal(kindLabel(entry({}), t), "Draft saved");
  assert.equal(kindLabel(entry({ kind: "published", revision: 2 }), t), "Published");
  assert.equal(kindLabel(entry({ kind: "restored", restoredFrom: 1 }), t), "Restored from #1");
  assert.equal(whoSaved(entry({}), t), "You");
  assert.equal(whoSaved(entry({ by: "agent-1", byName: "Roby" }), t), "Roby");
  // An agent that is gone is still not shown by its id.
  assert.equal(whoSaved(entry({ by: "agent-1" }), t), "An agent");
  // The owner brings versions back, even one an agent drew.
  assert.equal(whoSaved(entry({ kind: "restored", restoredFrom: 2, by: "agent-1", byName: "Roby" }), t), "You");
  assert.equal(entryLabel(entry({}), t, "14:02"), "Version #3 · 14:02 · You");
});
