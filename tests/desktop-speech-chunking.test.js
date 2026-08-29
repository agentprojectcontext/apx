// The desktop starts synthesizing the first sentence while the model is still
// streaming (renderer.js firstSpeechChunk), and main.js later claims that audio
// by exact text when it splits the finished reply (splitForSpeech). The whole
// optimization rests on one invariant: given any prefix that ends on a sentence
// boundary, the chunk the renderer pre-makes is byte-identical to the first
// chunk the splitter asks for. A mismatch is not merely wasted work — the
// stray synthesis holds the voice engine's lock while the wanted chunk queues
// behind it, making the reply slower than doing nothing at all.
//
// Neither function is exported (one is browser-side, the other lives in an
// Electron main process that can't be imported here), so both are read out of
// their source files and evaluated. That keeps the two definitions honest: edit
// either one alone and this test fails.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "interfaces", "desktop");

function extractFn(file, name) {
  const src = fs.readFileSync(path.join(DIR, file), "utf8");
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found in ${file} — was it renamed?`);
  // The parameter list destructures options, so its own braces have to be
  // skipped: find the body brace by first closing the parameter parens.
  let i = src.indexOf("(", start), pdepth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "(") pdepth++;
    else if (src[i] === ")" && --pdepth === 0) break;
  }
  const open = src.indexOf("{", i);
  let depth = 0, end = -1;
  for (i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) { end = i + 1; break; }
  }
  assert.ok(end > 0, `could not bracket-match ${name}`);
  return new Function(`${src.slice(start, end)}; return ${name};`)();
}

const splitForSpeech    = extractFn("main.js", "splitForSpeech");
const firstSpeechChunk  = extractFn("renderer.js", "firstSpeechChunk");

// Replies of the shape Roby actually produces on the desktop.
const REPLIES = [
  "Listo, te escucho perfecto. Probá de nuevo cuando quieras.",
  "Hola. Todo bien por acá, contame qué necesitás.",
  "Dale. Ya lo miro.",
  "Sí, anda. ¿Querés que lo deje corriendo?",
  "Estuve revisando el daemon y encontré que el proceso de voz se estaba reiniciando solo, cosa que explica la demora. Ya está arreglado.",
  "Che, esto es una sola oración larguísima que se pasa holgadamente de los ochenta caracteres y por lo tanto el splitter la tiene que cortar por cláusulas, a ver si coincide.",
  "Uno, dos, tres.",
  "¡Hola! ¿Cómo va todo por allá? Te cuento que terminé.",
];

test("firstSpeechChunk matches splitForSpeech's first chunk on every prefix", () => {
  for (const reply of REPLIES) {
    const expected = splitForSpeech(reply)[0];
    // Every prefix that ends at a sentence boundary, as the stream would see it.
    let sawOne = false;
    for (let i = 1; i <= reply.length; i++) {
      const buf = reply.slice(0, i);
      const complete = buf.match(/^[\s\S]*[.!?…](?=\s)/);
      if (!complete) continue;
      const got = firstSpeechChunk(complete[0].trim());
      if (got == null) continue;   // not enough text yet — the renderer waits
      sawOne = true;
      assert.equal(got, expected, `prefix ${JSON.stringify(buf)} of ${JSON.stringify(reply)}`);
    }
    // Whether this particular reply pre-warms at all is asserted separately —
    // here the only claim is that when it does, it pre-warms the right chunk.
    void sawOne;
  }
});

// Not every reply can pre-warm, and the ones that can't must stay silent rather
// than guess. The rule is structural: a chunk has to *close* inside text the
// stream has already finished, and the final sentence never counts (nothing
// follows it yet, so it may still be growing).
test("pre-warm fires exactly when a chunk closes before the last sentence", () => {
  const fires = (reply) => {
    for (let i = 1; i <= reply.length; i++) {
      const complete = reply.slice(0, i).match(/^[\s\S]*[.!?…](?=\s)/);
      if (complete && firstSpeechChunk(complete[0].trim()) != null) return true;
    }
    return false;
  };
  // Two sentences, the first long enough to be a chunk on its own → the common
  // case, and the one worth optimizing.
  assert.equal(fires("Listo, te escucho perfecto. Probá de nuevo cuando quieras."), true);
  // One sentence: nothing is ever complete-and-followed-by-space. No pre-warm,
  // but these are also the replies that were already fast.
  assert.equal(fires("Dale, ya lo miro."), false);
  // A short opener gets packed with the sentence after it, so no chunk closes
  // until the reply is over — pre-warming "Hola." would build the wrong chunk.
  assert.equal(fires("Hola. Todo bien por acá, contame qué necesitás."), false);
});

test("firstSpeechChunk returns null until a chunk has actually closed", () => {
  // Below the splitter's `min`, a sentence is packed with the next one — so on
  // its own it is not yet a chunk and must not be pre-made.
  assert.equal(firstSpeechChunk("Hola."), null);
  assert.equal(splitForSpeech("Hola. Todo bien.")[0], "Hola. Todo bien.");
  assert.equal(firstSpeechChunk("Hola. Todo bien."), "Hola. Todo bien.");
});

test("a long first sentence is pre-made as its first clause, not whole", () => {
  const long = "Estuve revisando el daemon y encontré que el proceso de voz se reiniciaba solo, cosa que explica la demora.";
  const expected = splitForSpeech(long)[0];
  assert.ok(expected.length <= 80, "splitter must break past its limit");
  assert.notEqual(expected, long);
  // The renderer only sees this sentence once it is terminated and followed by
  // whitespace, which is what the daemon's stream produces mid-reply.
  assert.equal(firstSpeechChunk(long), expected);
});
