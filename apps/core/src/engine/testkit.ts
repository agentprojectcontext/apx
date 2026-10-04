// Shared test helpers: a temp home, a scripted model and a way to wait for a thread to settle.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Message } from "@apx/protocol";
import { ApxClient } from "@apx/protocol/client";
import type { AdapterFactory } from "../channels/types.ts";
import { type ProviderConfig, testConfig } from "../config.ts";
import type { DesktopOps } from "../desktop.ts";
import type { Harness } from "../harness/index.ts";
import type { IMessageOps } from "../imessage.ts";
import type { Llm, LlmRequest } from "../providers/llm.ts";
import type { AssistantItem, Completion } from "../providers/types.ts";
import { createCore } from "../server.ts";
import type { Tool } from "../tools/types.ts";

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
  extraTools?: Tool[];
  /** Lets the scripted model also answer auxiliary calls (titles, summaries); off by default. */
  aux?: boolean;
  channelAdapters?: Record<string, AdapterFactory>;
  channelRetryMs?: readonly number[];
  roomBurstMs?: number;
  desktop?: DesktopOps;
  /** Messages on a Mac; none by default, so a test never reads the machine's own. */
  imessage?: IMessageOps | null;
  clock?: () => Date;
  /** Built-in model APIs beside "fake" (as config.ts gives a real install). */
  providers?: ProviderConfig[];
}) {
  const home = opts.home ?? fs.mkdtempSync(path.join(os.tmpdir(), "apx2-engine-"));
  // A provider named "fake" so refs like "fake/fake-1" are valid; the scripted model answers for it.
  const providers = [
    { id: "fake", transport: "openai-chat" as const, base_url: "http://fake.test", key: "env:NONE", models: [] },
    ...(opts.providers ?? []),
  ];
  const core = await createCore(testConfig({ home, providers }), {
    quiet: true,
    llm: opts.llm,
    ...(opts.harnesses ? { harnesses: opts.harnesses } : {}),
    ...(opts.extraTools ? { extraTools: opts.extraTools } : {}),
    ...(opts.channelAdapters ? { channelAdapters: opts.channelAdapters } : {}),
    ...(opts.channelRetryMs ? { channelRetryMs: opts.channelRetryMs } : {}),
    ...(opts.roomBurstMs !== undefined ? { roomBurstMs: opts.roomBurstMs } : {}),
    ...(opts.desktop ? { desktop: opts.desktop } : {}),
    imessage: opts.imessage ?? null,
    ...(opts.clock ? { clock: opts.clock } : {}),
  });
  // Tests choose their model like an owner would: through the settings, never through code defaults.
  if (!core.store.settings.get("model_default"))
    core.store.settings.set("model_default", JSON.stringify({ model: "fake/fake-1", router: false }));
  if (!opts.aux && !core.store.settings.get("model_aux")) core.store.settings.set("model_aux", "off");
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
