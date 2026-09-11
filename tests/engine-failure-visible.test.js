// When an engine falls over, you have to be able to find out why.
//
// WHAT HAPPENED. A project agent's turn fell from `zen:big-pickle` to
// `gemini:gemini-3.5-flash-lite`. The bubble said, in full:
//
//   ⚠ engine zen:big-pickle failed → gemini:gemini-3.5-flash-lite
//
// and that was every record that existed. Not in the ledger — this event is
// never persisted. Not in the daemon log — only the super-agent and Telegram
// paths wrote it, and this was neither. And the note itself dropped `ev.reason`
// while the case immediately below it in the same switch printed its own.
//
// So answering "why does big-pickle fail?" took a hand-written HTTP call to the
// provider. It was `429 FreeUsageLimitError` — an account quota, nothing to fix
// in the code — which is exactly the kind of answer that should have taken one
// glance at the screen.
//
// TWO ENDS, because either alone still leaves a hole: the note is what you read
// while it happens, and the log is what survives the reload.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

test("the bubble's note says why, not just that", () => {
  const hook = read("src/interfaces/web/src/hooks/useChat.ts");
  const branch = hook.slice(hook.indexOf('case "engine_failed":'), hook.indexOf('case "model_retry":'));
  assert.match(branch, /ev\.reason/, "the reason is in the event and has to reach the note");
  assert.match(branch, /failed \(\$\{ev\.reason\}\)/, "shown inline, the way Telegram already logs it");
  // A turn that genuinely has no reason still reads as a sentence rather than
  // as "failed (undefined)".
  assert.match(branch, /ev\.reason\s*\n?\s*\?/, "falls back when there is no reason");
});

test("every chat route writes run-level decisions to the log", () => {
  // `engine_failed` reaches no store: the ledger does not carry it and the
  // panel's note dies with the page. The log is the only place it can survive,
  // so a route that skips it is a route whose failures cannot be explained
  // afterwards. Telegram has always had its own; these four had nothing but the
  // super-agent.
  for (const route of ["super-agent.js", "exec.js", "conversations.js", "groups.js"]) {
    const src = read("src/host/daemon/api", route);
    assert.match(src, /from "\.\/turn-log\.js"/, `${route} must use the shared turn logger`);
    assert.match(src, /logTurnEvent\(|withTurnLog\(/, `${route} must actually call it`);
  }
});

test("the logger is one implementation, and the reason is the point of it", () => {
  const src = read("src/host/daemon/api/turn-log.js");
  assert.match(src, /event\.type === "engine_failed"/);
  assert.match(src, /reason: event\.reason/, "a line without the reason says nothing new");
  // The other two run-level decisions travel with it — same class of fact, same
  // problem if they are only logged on one surface.
  assert.match(src, /tools_suppressed/);
  assert.match(src, /model_routed/);
});

test("super-agent.js no longer keeps a private copy", () => {
  // It was the only route that logged this, which is why it was the only route
  // where a fallback could be explained. Moving it out is what made the other
  // three possible; leaving a duplicate behind is how they drift again.
  const src = read("src/host/daemon/api/super-agent.js");
  const wrapper = src.slice(src.indexOf("function wrapOnEventForLog"), src.indexOf("if (send) send(event);"));
  assert.doesNotMatch(wrapper, /log\.warn\(/, "the spelled-out logging moved to turn-log.js");
  assert.match(wrapper, /logTurnEvent\(event/);
});
