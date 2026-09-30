// The chat row says whether a hand-off waited for its answer or was left
// running — the owner could not tell, and a background job looked like a step
// that had simply finished.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { handOffMode } = await import(path.join(ROOT, "src/interfaces/web/src/lib/tool-mode.ts"));

test("a hand-off left running reads as background, one that returned an answer as waited", () => {
  assert.equal(handOffMode({ tool: "send_to_agent", status: "done", args: { background: true }, result: { ok: true, job_id: "bgjob_1" } }), "background");
  assert.equal(handOffMode({ tool: "send_to_agent", status: "running", args: { background: true } }), "background");
  assert.equal(handOffMode({ tool: "call_agent", status: "done", result: { text: "listo" } }), "waited");
  // From a one-shot `apx exec` the background request waits: no job id comes back.
  assert.equal(handOffMode({ tool: "send_to_agent", status: "done", args: { background: true }, result: { text: "ok" } }), "waited");
  assert.equal(handOffMode({ tool: "run_shell", status: "done", args: { background: true }, result: { job_id: "bgjob_2" } }), "background");
  assert.equal(handOffMode({ tool: "run_shell", status: "done", result: { exit_code: 0 } }), null, "an ordinary command is no hand-off");
  assert.equal(handOffMode({ tool: "read_file", status: "done" }), null);
});
