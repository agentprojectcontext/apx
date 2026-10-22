import assert from "node:assert/strict";
import { test } from "node:test";
import { prefs } from "../data/prefs.ts";
import { startI18n } from "../i18n/index.ts";
import { formatCompact } from "./compact.ts";

prefs.set({ language: "en" });
await startI18n();

test("a count at a glance: as is under a thousand, then K and M", () => {
  assert.equal(formatCompact(950), "950");
  assert.equal(formatCompact(1250), "1.3K");
  assert.equal(formatCompact(12_400), "12K");
  assert.equal(formatCompact(2_430_000), "2.4M");
});
