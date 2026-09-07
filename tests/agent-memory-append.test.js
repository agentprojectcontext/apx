// `appendAgentMemory` — the one place a project agent's memory grows a line.
//
// THE FAILURE THIS FIXES, from a real install (v1.89.2): magui's memory carried
// a hand-decorated heading, `## Recent context · estado 2026-08-19`. Detection
// and insertion were two different regexes and disagreed about it — detection
// matched the bare words anywhere in the file, so the section counted as
// present; insertion demanded a newline right after "context" and matched
// nothing. `String.replace` with no match returns the body unchanged, so the
// file was rewritten byte-identical while `apx memory magui --append` printed
// "appended to magui memory: …". Every note written that way was lost, and a
// diff against a backup showed nothing to explain it.
//
// So the assertions that matter are: a DECORATED heading still takes the note,
// and nothing here can ever report success over an unchanged file again.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-agentmem-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx"); // HOME alone is overridden by the runner's APX_HOME

const { appendAgentMemory, readAgentMemory, writeAgentMemory } =
  await import("#core/agent/memory.js");

let n = 0;
// A registry-shaped project: `storagePath` short-circuits apx-id lookup, so the
// test needs no .apc/ scaffold and no shared home.
const project = () => ({ path: TMP_HOME, storagePath: path.join(TMP_HOME, "store", String(n++)) });
const NOW = new Date("2026-09-07T10:00:00Z");

test("a decorated Recent context heading still takes the note", () => {
  const p = project();
  writeAgentMemory(p, "magui", [
    "# Memory — magui",
    "",
    "## Long-term facts",
    "- three daily routines",
    "",
    "## Recent context · estado 2026-08-19",
    "- owner pendientes acumulados",
    "",
  ].join("\n"));

  appendAgentMemory(p, "magui", "voice.json: dominios fonéticos, sin \"com\"", { now: NOW });

  const mem = readAgentMemory(p, "magui");
  assert.match(mem, /- 2026-09-07: voice\.json: dominios fonéticos/);
  // …directly under that heading, not appended to the end of the file.
  assert.match(mem, /## Recent context · estado 2026-08-19\n- 2026-09-07: voice\.json/);
  assert.match(mem, /- owner pendientes acumulados/, "existing notes survive");
});

test("with several dated sections the note lands under the newest", () => {
  const p = project();
  writeAgentMemory(p, "magui", [
    "## Recent context · estado 2026-08-19",
    "- older",
    "",
    "## Recent context · 2026-09-07 · reels 129/130",
    "- newer",
    "",
    "## Cómo leer esta memoria",
    "- las secciones se apilan",
    "",
  ].join("\n"));

  appendAgentMemory(p, "magui", "landed", { now: NOW });

  const mem = readAgentMemory(p, "magui");
  assert.match(mem, /## Recent context · 2026-09-07 · reels 129\/130\n- 2026-09-07: landed\n- newer/);
  assert.doesNotMatch(mem, /estado 2026-08-19\n- 2026-09-07: landed/, "not the stale section");
  assert.match(mem, /## Cómo leer esta memoria/, "later sections untouched");
});

test("the plain template heading still works", () => {
  const p = project();
  appendAgentMemory(p, "coach", "taught the grip", { now: NOW });
  const mem = readAgentMemory(p, "coach");
  assert.match(mem, /## Recent context\n- 2026-09-07: taught the grip/);
});

test("no Recent context section at all: one is created", () => {
  const p = project();
  writeAgentMemory(p, "coach", "# Memory — coach\n\n## Identity\n- a coach\n");
  appendAgentMemory(p, "coach", "first note", { now: NOW });
  const mem = readAgentMemory(p, "coach");
  assert.match(mem, /## Recent context\n- 2026-09-07: first note/);
  assert.match(mem, /- a coach/);
});

test("a heading with no trailing newline still takes the note", () => {
  const p = project();
  writeAgentMemory(p, "coach", "# Memory\n\n## Recent context · hoy");
  appendAgentMemory(p, "coach", "at the very end", { now: NOW });
  assert.match(readAgentMemory(p, "coach"), /## Recent context · hoy\n- 2026-09-07: at the very end/);
});

test("`$&` in the note is stored literally, not expanded", () => {
  const p = project();
  appendAgentMemory(p, "coach", "regex hint: $& and $1 are replacement patterns", { now: NOW });
  assert.match(readAgentMemory(p, "coach"), /- 2026-09-07: regex hint: \$& and \$1 are replacement patterns/);
});

test("the file actually changes — an append is never a silent no-op", () => {
  const p = project();
  writeAgentMemory(p, "magui", "# Memory\n\n## Recent context · estado 2026-08-19\n- one\n");
  const before = readAgentMemory(p, "magui");
  const file = appendAgentMemory(p, "magui", "two", { now: NOW });
  const after = fs.readFileSync(file, "utf8");
  assert.notEqual(after, before, "byte-identical rewrite is the bug this file exists for");
  assert.ok(after.length > before.length);
});

// The exact file that failed in the wild: ONE heading, decorated, nothing else
// to fall back on. Nine invocations printed "appended" against this shape and
// wrote nothing; it only started working once a SECOND heading was added by
// hand, which is what made the two-regex disagreement visible.
test("the wild case: a single decorated heading and nothing else", () => {
  const p = project();
  writeAgentMemory(p, "magui", "# Memory — magui\n\n## Recent context · estado 2026-08-19\n- owner pendientes\n");
  const before = readAgentMemory(p, "magui");
  const file = appendAgentMemory(p, "magui", "nota nueve", { now: NOW });
  const after = fs.readFileSync(file, "utf8");
  assert.notEqual(after, before);
  assert.match(after, /## Recent context · estado 2026-08-19\n- 2026-09-07: nota nueve\n- owner pendientes/);
});

// Every heading shape an agent has actually written, and a few it might. Each
// one has to take the note; none may return quietly with the file unchanged.
const HEADINGS = [
  "## Recent context",
  "## Recent Context",
  "### Recent context",
  "#### Recent context",
  "##\tRecent context",
  "##   Recent context",
  "## Recent context · estado 2026-08-19",
  "## Recent context · 2026-09-07 · reels 129/130 (sesión del owner)",
  "## Recent context — 2026-09-07",
  "## Recent context (últimos 30 días)",
  "## Recent context: 2026-09",
];

for (const heading of HEADINGS) {
  test(`heading takes the note: ${JSON.stringify(heading)}`, () => {
    const p = project();
    writeAgentMemory(p, "a", `# Memory\n\n${heading}\n- previous\n`);
    const before = readAgentMemory(p, "a");
    const file = appendAgentMemory(p, "a", "landed", { now: NOW });
    const after = fs.readFileSync(file, "utf8");
    assert.notEqual(after, before, "returned without changing the file");
    assert.match(after, /- 2026-09-07: landed/);
    assert.ok(after.includes(`${heading}\n- 2026-09-07: landed`), "not directly under the heading");
    assert.match(after, /- previous/, "existing note lost");
  });
}

// Whatever the file looks like, append either writes or throws. It may never
// return a path to a file it did not change — that is the whole bug.
test("append never returns quietly over an unchanged file", () => {
  const bodies = [
    "",
    "# Memory\n",
    "# Memory\n\n## Identity\n- x\n",
    "## Recent context",                                   // no trailing newline
    "## Recent context · hoy",                             // decorated, no newline
    "## Recent context\n\n\n",                            // blank lines under it
    "## Recent contexto · mal escrito\n- x\n",            // not a match at all
    "texto suelto sin ningún heading\n",
    "## recent context · minúsculas\n",
    "## Recent context · a\n- 1\n\n## Recent context · b\n- 2\n",
  ];
  for (const body of bodies) {
    const p = project();
    if (body) writeAgentMemory(p, "a", body);
    const before = (() => { try { return readAgentMemory(p, "a"); } catch { return ""; } })();
    let file, threw = null;
    try { file = appendAgentMemory(p, "a", "nota", { now: NOW }); }
    catch (e) { threw = e; }
    if (threw) {
      assert.match(threw.message, /nothing was written/, `threw the wrong error for ${JSON.stringify(body)}`);
      continue;
    }
    const after = fs.readFileSync(file, "utf8");
    assert.notEqual(after, before, `silent no-op for ${JSON.stringify(body)}`);
    assert.match(after, /- 2026-09-07: nota/, `note missing for ${JSON.stringify(body)}`);
  }
});

test("an empty note is refused", () => {
  const p = project();
  assert.throws(() => appendAgentMemory(p, "coach", "   "), /note required/);
});
