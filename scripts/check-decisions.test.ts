import assert from "node:assert/strict";
import { test } from "node:test";
import { checkCitations, checkRecord } from "./check-decisions.ts";

// Built here so the real gate, which scans this file too, does not read the fixtures as links.
const DOC = ["DECISIONS", "md"].join(".");

const entry = (n: string, anchor = `d-${n}`) =>
  `<a id="${anchor}"></a>\n## D-${n} — 2026-11-12 — Acme does a thing\nWhy.\n`;
const problems = (text: string) => checkRecord(text).problems.map((p) => p.problem);

test("a record in order, each decision under its anchor, passes", () => {
  assert.deepEqual(problems(["# Decisions\n", entry("001"), entry("002")].join("\n")), []);
});

test("a decision without its anchor, a duplicate and a gap are found", () => {
  const anchorless = `${entry("001")}\n## D-002 — 2026-11-12 — No anchor\n`;
  assert.match(problems(anchorless).join(), /D-002 has no <a id="d-002">/);
  assert.match(problems([entry("001"), entry("001")].join("\n")).join(), /anchor d-001 appears twice/);
  assert.match(problems([entry("001"), entry("003")].join("\n")).join(), /D-002 is missing/);
  assert.match(problems([entry("002"), entry("001")].join("\n")).join(), /D-001 comes after D-002/);
});

test("a number two entries share passes when one keeps a suffixed anchor", () => {
  assert.deepEqual(problems([entry("001", "d-001-routines"), entry("001"), entry("002")].join("\n")), []);
});

test("an anchor separated from its heading, or a heading off the format, is found", () => {
  assert.match(problems('<a id="d-001"></a>\n\n## D-001 — 2026-11-12 — Title\n').join(), /not right before/);
  assert.match(problems('<a id="d-001"></a>\n## D-001 - Title\n').join(), /not "D-NNN — YYYY-MM-DD — title"/);
});

test("links and mentions resolve only to decisions that exist", () => {
  const { anchors, numbers } = checkRecord([entry("001", "d-001-routines"), entry("001"), entry("002")].join("\n"));
  const cite = (text: string) => checkCitations("apps/acme.ts", text, anchors, numbers).map((p) => p.problem);
  assert.deepEqual(cite(`// See ${DOC}#d-001, #d-002 and ${DOC}#d-001-routines (D-002).`), []);
  assert.deepEqual(cite(`// See ${DOC}#d-003.`), ["links to missing #d-003"]);
  assert.deepEqual(cite("// Since D-009 this is so."), ["names D-009, which does not exist"]);
  assert.deepEqual(cite("// A page anchor elsewhere: README.md#d-003."), []);
});
