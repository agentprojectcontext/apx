// A turn that got stuck on a character must not be able to take a surface down.
//
// On 2026-09-20 a reply ended a normal paragraph with one 😅 and then wrote that
// emoji several thousand times. Three things broke off that one tail: Telegram
// refused the send (4096-char limit), so the answer never reached the channel
// the owner was reading; the web transcript FROZE, because a colour-font glyph
// is an image and laying out tens of thousands of them stops the tab; and the
// row went to the ledger at full length, so every later read of that thread
// froze again. "No sale el mensaje raro o no se ve el chat mejor dicho el
// thread" — Manu, that afternoon.
//
// `stuck-detector.js` is this idea one level up: it watches the TOOL loop
// repeat itself. It cannot see this one — a turn that calls no tools and writes
// one emoji forever is, to the loop, a turn that answered.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clampRunawayText, MAX_RUN } from "#core/agent/runaway-text.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("a runaway run is clipped, counted, and still readable", () => {
  const tail = "😅".repeat(5000);
  const out = clampRunawayText(`Listo, cerrado el análisis. ${tail}`);
  assert.ok(out.length < 400, `a message a browser can paint, got ${out.length}`);
  assert.match(out, /^Listo, cerrado el análisis\./, "what the turn actually said survives intact");
  assert.match(out, /\[×5000\]/, "and the reader is told what the model did");
  // Clipped, not deleted: the run is still visibly a run.
  assert.equal([...out].filter((c) => c === "😅").length, MAX_RUN);
});

test("it never cuts an emoji in half", () => {
  // By code point, not by UTF-16 unit. Counting halves would leave a lone
  // surrogate — a replacement glyph in place of the bug being avoided.
  const out = clampRunawayText("😅".repeat(4000));
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(out), "no orphaned high surrogate");
  assert.ok(!/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(out), "no orphaned low surrogate");
});

test("it catches a repeating PHRASE, not only a repeating character", () => {
  const out = clampRunawayText("ja ".repeat(600));
  assert.ok(out.length < 200);
  assert.match(out, /\[×600\]/);
});

test("things people write on purpose are left exactly as they are", () => {
  // The thresholds sit well above anything anybody types. A clamp that edits
  // ordinary prose would be a worse bug than the one it fixes.
  for (const ok of [
    "Jajajaja, buenísimo.",
    "✅ hecho ✅ revisado ✅ publicado",
    "Listo:\n- uno\n- dos\n- tres\n".repeat(20),
    "—".repeat(MAX_RUN - 1),
    "",
    "corto",
  ]) {
    assert.equal(clampRunawayText(ok), ok, JSON.stringify(ok.slice(0, 40)));
  }
});

test("clipping a pathological message is fast enough to be on the turn path", () => {
  const started = Date.now();
  clampRunawayText("😅".repeat(200000));
  clampRunawayText("lorem ipsum dolor sit amet ".repeat(8000));
  assert.ok(Date.now() - started < 500, "this runs on every turn; it cannot be the slow part");
});

test("every turn's text goes through it", () => {
  // The seam: `settleTurnText` is what run-agent applies to a turn's text, and
  // it is the only place both the greeting guard and this clamp are applied —
  // so a new caller cannot pick up one and miss the other.
  const src = fs.readFileSync(path.join(ROOT, "src/core/agent/run-agent.js"), "utf8");
  assert.match(src, /clampRunawayText\(greetingGuard\.apply\(text\)\)/);
  assert.match(src, /text: settleTurnText\(lastText\)/, "…including the text the turn returns");
});

test("the transcript survives a message written before the clamp existed", () => {
  // Everything already on disk is still full length and is still opened every
  // time that thread is, so the surface has to hold on its own.
  const src = fs.readFileSync(
    path.join(ROOT, "src/interfaces/web/src/components/chat/MessageBubble.tsx"), "utf8",
  );
  assert.match(src, /const LONG_TEXT_CAP = \d+/, "a bubble has a ceiling");
  assert.match(src, /safeSlice\(full, LONG_TEXT_CAP\)/, "clipped without splitting a surrogate");
  assert.match(src, /long_clipped/, "…and it says so, with the rest one click away");
  assert.match(src, /setShowAll\(true\)/, "nothing is hidden for good");
});
