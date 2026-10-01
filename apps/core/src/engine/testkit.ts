// Shared test helpers: a temp home, a scripted model and a way to wait for a thread to settle.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Message } from "@apx/protocol";
import { ApxClient } from "@apx/protocol/client";
import { testConfig } from "../config.ts";
import type { Harness } from "../harness/index.ts";
import type { Llm, LlmRequest } from "../providers/llm.ts";
import type { AssistantItem, Completion } from "../providers/types.ts";
import { createCore } from "../server.ts";

export type Script = (
  req: LlmRequest,
  ctx: { system: string; said: string; afterTool: boolean },
) => Promise<Partial<Completion> & { message: AssistantItem }> | (Partial<Completion> & { message: AssistantItem });

export function scriptedLlm(script: Script): Llm & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    calls,
    label: () => "fake/fake-1",
    async complete(req) {
      calls.push({ ...req, messages: [...req.messages] });
      const system = String(req.messages[0]?.content ?? "");
      // What was said in the last user item, without the per-turn context header (time, roster).
      const raw = String([...req.messages].reverse().find((m) => m.role === "user")?.content ?? "");
      const said = raw.startsWith("[context:") ? raw.slice(raw.indexOf("\n\n") + 2) : raw;
      const afterTool = req.messages.at(-1)?.role === "tool";
      const out = await script(req, { system, said, afterTool });
      if (out.message.content) req.onText?.(String(out.message.content));
      return { model: "fake/fake-1", finish: out.message.tool_calls?.length ? "tool_calls" : "stop", ...out };
    },
  };
}

export const say = (content: string): { message: AssistantItem } => ({ message: { role: "assistant", content } });
export const callTool = (id: string, name: string, args: object): { message: AssistantItem } => ({
  message: {
    role: "assistant",
    content: null,
    tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
  },
});

export async function startCore(opts: {
  llm: Llm;
  home?: string;
  harnesses?: Partial<Record<"native" | "claude" | "codex", Harness>>;
}) {
  const home = opts.home ?? fs.mkdtempSync(path.join(os.tmpdir(), "apx2-engine-"));
  const core = await createCore(testConfig({ home }), {
    quiet: true,
    llm: opts.llm,
    ...(opts.harnesses ? { harnesses: opts.harnesses } : {}),
  });
  // Tests choose their model like an owner would: through the settings, never through code defaults.
  if (!core.store.settings.get("model_default"))
    core.store.settings.set("model_default", JSON.stringify({ model: "fake/fake-1", router: false }));
  const client = new ApxClient({ url: core.url });
  const settle = async (
    thread: string,
    ms = 5000,
  ): Promise<{ messages: Message[]; runs: Awaited<ReturnType<typeof client.call<"threads.get">>>["runs"] }> => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const t = await client.call("threads.get", { thread });
      if (t.runs.length && t.runs.every((r) => r.ended_at)) return t;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`thread ${thread} never settled`);
  };
  return { core, client, home, settle, cleanup: () => fs.rmSync(home, { recursive: true, force: true }) };
}

export const texts = (messages: Message[]) =>
  messages.flatMap((m) => m.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])));
