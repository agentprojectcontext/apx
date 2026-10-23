// A core whose scripted model calls apx_settings with what the owner wrote, as JSON: each test says the call, the
// owner approves or declines it, and reads the card and the answer.
import assert from "node:assert/strict";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";

export async function settingsCore(opts: Omit<Parameters<typeof startCore>[0] & object, "llm"> = {}) {
  const llm = scriptedLlm((req, { said, afterTool }) => {
    if (afterTool) return say(String(req.messages.at(-1)?.content));
    return said.startsWith("{") ? callTool("c1", "apx_settings", JSON.parse(said)) : say("ok");
  });
  const env = await startCore({ ...opts, llm });

  /** The owner asks for `call`; `decision` answers the confirmation it waits on. Returns the card and the answer. */
  async function ask(call: object | string, decision?: "approve" | "deny", agent = "roby") {
    const thread = await env.client.call("threads.create", { kind: "loose", agent_id: agent, title: "Settings" });
    await env.client.call("threads.send", {
      thread: thread.id,
      text: typeof call === "string" ? call : JSON.stringify(call),
    });
    let detail: string | undefined;
    if (decision) {
      let pending: Array<{ id: string; tool?: string | undefined; detail?: string | undefined }> = [];
      for (let i = 0; i < 100 && !pending.length; i++) {
        pending = (await env.client.call("runs.pending", { thread: thread.id })).inputs;
        if (!pending.length) await new Promise((r) => setTimeout(r, 20));
      }
      assert.equal(pending[0]?.tool, "apx_settings");
      detail = pending[0]?.detail;
      await env.client.call("runs.respond", { input: pending[0]?.id ?? "", decision });
    }
    await env.settle(thread.id);
    return { answer: String(llm.calls.at(-1)?.messages.at(-1)?.content), detail: detail ?? "", thread: thread.id };
  }

  return { env, llm, ask };
}
