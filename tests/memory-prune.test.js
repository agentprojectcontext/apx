// Pruning the notebook: sixty days of weather is zero facts.
//
// consolidate.js guards what gets IN; prune.js looks BACK. These tests pin the
// two judgements (series by opener, near-duplicates by similarity) and the two
// safety rails (dry by default, backup on write, prose untouched).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-prune-"));
process.env.HOME = TMP_HOME;

const { planPrune, pruneSelfMemory } = await import("#core/memory/prune.js");
const { SELF_MEMORY_PATH, appendSelfMemory, readSelfMemory } = await import("#core/agent/self-memory.js");

beforeEach(() => {
  fs.rmSync(SELF_MEMORY_PATH, { force: true });
  fs.rmSync(path.dirname(SELF_MEMORY_PATH), { recursive: true, force: true });
});

const WEATHER_NOTEBOOK = `# Roby's notebook

## 2026-08-01
- [11:00][routine] Hoy en Bariloche hace -6°C con sensación de -10°C y neblina.
- [12:00][telegram] Manu decidió que el deploy de APX corre siempre desde main.

## 2026-08-02
- [11:01][routine] Hoy en Bariloche hace 1°C con sensación de -3°C y nevadas fuertes.

## 2026-08-03
- [11:00][routine] Hoy en Bariloche hace -1°C con sensación de -4°C y nieve moderada.

## 2026-08-04
- [11:00][routine] Hoy en Bariloche hace -2°C con sensación de -6°C y nevadas fuertes.
- [15:00][web] Los mensajes de Roby se están cortando en Telegram, necesita ser más conciso.

## 2026-08-05
- [09:00][telegram] Los mensajes de Roby se están cortando en Telegram, necesita ser más conciso.
`;

// --------------------------------------------------------------------------
// the plan: what goes, what stays
// --------------------------------------------------------------------------

test("a daily series keeps only its newest entry", () => {
  const { removed, kept } = planPrune(WEATHER_NOTEBOOK);
  const removedTexts = removed.map((e) => e.text);
  // Three of the four weather bullets go; the 08-04 one (newest) survives.
  assert.equal(removedTexts.filter((t) => t.includes("Hoy en Bariloche")).length, 3);
  assert.ok(!removedTexts.some((t) => t.includes("-2°C con sensación de -6°C")));
  assert.ok(kept >= 3);
});

test("varying temperatures never break a series match", () => {
  // The middle of each line differs (-6°C / 1°C / -1°C…); the opener is the
  // series. If digits leaked into the signature nothing would ever collapse.
  const { removed } = planPrune(WEATHER_NOTEBOOK);
  assert.ok(removed.some((e) => e.text.includes("-6°C con sensación de -10°C")));
});

test("the same fact said twice keeps only the newest copy", () => {
  const { removed } = planPrune(WEATHER_NOTEBOOK);
  const cortando = removed.filter((e) => e.text.includes("cortando en Telegram"));
  assert.equal(cortando.length, 1);
  assert.equal(cortando[0].date, "2026-08-04", "the older copy is the one removed");
});

test("a durable one-off fact is never touched", () => {
  const { removed } = planPrune(WEATHER_NOTEBOOK);
  assert.ok(!removed.some((e) => e.text.includes("deploy de APX")));
});

test("same opener, different facts: never collapsed", () => {
  // Three MCP installations open identically and are three facts. The opener
  // alone must not make them a series — only a shared template does.
  // The middle two share their ENTIRE template ("global 'X' y se inicializó la
  // variable global 'Y'…") — only the quoted identifiers say they are two
  // different MCPs. From the real notebook that motivated the quote guard.
  const mcps = `# n

## 2026-06-30
- [telegram] Se agregó el MCP 'atlassian-mcp' al scope apc (shared) del proyecto iacrm v2.
- [telegram] Se agregó el MCP global 'dokploy-mcp' y se inicializó la variable global 'DOKPLOY_API_KEY' en ~/.apx/vars.json para que el usuario la edite.

## 2026-07-01
- [telegram] Se agregó el MCP global 'brightbean-mcp' de tipo HTTP y se inicializó la variable global 'brightbeanToken' en ~/.apx/vars.json para que el usuario la edite.

## 2026-07-02
- [telegram] Se agregó el MCP 'obsidian-mcp' apuntando al vault personal de Manu.
`;
  assert.equal(planPrune(mcps).removed.length, 0);
});

test("below series_min, similar-opener entries all stay", () => {
  const two = `# n\n\n## 2026-08-01\n- [routine] Hoy en Bariloche hace -6°C con neblina.\n\n## 2026-08-02\n- [routine] Hoy en Bariloche hace 1°C con sol.\n`;
  // Two occurrences: not yet a habit, and not similar enough to be near-dupes.
  assert.equal(planPrune(two).removed.length, 0);
});

// --------------------------------------------------------------------------
// the write: dry by default, backed up, line-precise
// --------------------------------------------------------------------------

function seedNotebook(body) {
  fs.mkdirSync(path.dirname(SELF_MEMORY_PATH), { recursive: true });
  fs.writeFileSync(SELF_MEMORY_PATH, body);
}

test("without apply nothing is written", () => {
  seedNotebook(WEATHER_NOTEBOOK);
  const r = pruneSelfMemory();
  assert.equal(r.applied, false);
  assert.ok(r.removed.length > 0);
  assert.equal(readSelfMemory(), WEATHER_NOTEBOOK);
});

test("apply removes the bullets, keeps a backup, strips empty days", () => {
  seedNotebook(WEATHER_NOTEBOOK);
  const r = pruneSelfMemory({ apply: true });
  assert.equal(r.applied, true);
  assert.ok(fs.existsSync(r.backup));
  assert.equal(fs.readFileSync(r.backup, "utf8"), WEATHER_NOTEBOOK);

  const body = readSelfMemory();
  assert.equal(body.match(/Hoy en Bariloche/g).length, 1, "one weather line survives");
  assert.match(body, /deploy de APX/);
  assert.match(body, /## 2026-08-01/, "the day with the durable fact stays");
  assert.doesNotMatch(body, /## 2026-08-02/, "a day left empty loses its heading");
  // Still parseable by the same machinery that feeds the prompt slice.
  assert.doesNotMatch(body, /\n{3,}/);
});

test("prose and the file header survive a prune untouched", () => {
  const withProse = WEATHER_NOTEBOOK + "\nSome hand-written paragraph that is not a bullet.\n";
  seedNotebook(withProse);
  pruneSelfMemory({ apply: true });
  const body = readSelfMemory();
  assert.match(body, /^# Roby's notebook/);
  assert.match(body, /hand-written paragraph/);
});

test("an empty notebook is a no-op, not an error", () => {
  const r = pruneSelfMemory({ apply: true });
  assert.equal(r.removed.length, 0);
  assert.equal(r.applied, false);
});

test("a clean notebook written by appendSelfMemory stays clean", () => {
  appendSelfMemory("Manu prefiere respuestas cortas", { channel: "telegram" });
  appendSelfMemory("El daemon corre desde el checkout principal", { channel: "web" });
  const r = pruneSelfMemory({ apply: true });
  assert.equal(r.removed.length, 0);
});
