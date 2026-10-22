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
import type { ReleaseSource } from "../release-notes.ts";
import { createCore } from "../server.ts";
import type { TelemetrySink } from "../telemetry-sink.ts";
import { scratchRoot } from "../tools/folders.ts";
import type { Tool } from "../tools/types.ts";
import type { RunTimers } from "./engine.ts";
import type { InputWaits } from "./inputs.ts";

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
      // What was said in the last user item, without the per-turn context header (time, roster). APX's own notes
      // mid-turn (a picture of the screen after a tool) are not the owner speaking.
      const note = (m: (typeof req.messages)[number]) =>
        m.role === "user" && String(m.content).startsWith("<system_note>");
      const raw = String([...req.messages].reverse().find((m) => m.role === "user" && !note(m))?.content ?? "");
      const said = raw.startsWith("[context:") ? raw.slice(raw.indexOf("\n\n") + 2) : raw;
      const lastReal = req.messages.findLast((m) => !note(m));
      const afterTool = lastReal?.role === "tool";
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
  /** Known port for browser fixtures whose origin must be allowed before the core starts. */
  port?: number;
  harnesses?: Partial<Record<Harness["id"], Harness>>;
  extraTools?: Tool[];
  /** Lets the scripted model also answer auxiliary calls (titles, summaries); off by default. */
  aux?: boolean;
  /** Enable background extraction and consolidation only in tests that exercise them. */
  memoryMaintenance?: boolean;
  channelAdapters?: Record<string, AdapterFactory>;
  channelRetryMs?: readonly number[];
  roomBurstMs?: number;
  suggestBurstMs?: number;
  inputWaits?: InputWaits;
  engineIdleMs?: number;
  turnIdleMs?: number;
  a2aCapMs?: number;
  runTimers?: RunTimers;
  desktop?: DesktopOps;
  /** Messages on a Mac; none by default, so a test never reads the machine's own. */
  imessage?: IMessageOps | null;
  clock?: () => Date;
  unseenAfterMs?: number;
  /** Where push notices go (a stand-in Expo push service). */
  expoPushUrl?: string;
  /** Built-in model APIs beside "fake" (as config.ts gives a real install). */
  providers?: ProviderConfig[];
  /** A stand-in Google (sign-in and REST APIs under one address). */
  googleApi?: string;
  /** The Google OAuth client the core ships, as `client_id:client_secret` (none: a build without one). */
  googleClient?: string;
  asanaFetch?: typeof fetch;
  /** Where telemetry goes (a recorder); none sends nothing, like any test core. */
  telemetrySink?: TelemetrySink;
  /** The release this core starts on and its notes; none tells nothing. */
  releases?: ReleaseSource;
}) {
  const home = opts.home ?? fs.mkdtempSync(path.join(os.tmpdir(), "apx-engine-"));
  // A provider named "fake" so refs like "fake/fake-1" are valid; the scripted model answers for it.
  const providers = [
    { id: "fake", transport: "openai-chat" as const, base_url: "http://fake.test", key: "env:NONE", models: [] },
    ...(opts.providers ?? []),
  ];
  const core = await createCore(
    testConfig({
      home,
      providers,
      ...(opts.port !== undefined ? { port: opts.port } : {}),
      ...(opts.googleApi ? { googleApi: opts.googleApi } : {}),
      ...(opts.googleClient ? { googleClient: opts.googleClient } : {}),
      ...(opts.expoPushUrl ? { expoPushUrl: opts.expoPushUrl } : {}),
    }),
    {
      quiet: true,
      ...(opts.asanaFetch ? { asanaFetch: opts.asanaFetch } : {}),
      llm: opts.llm,
      ...(opts.harnesses ? { harnesses: opts.harnesses } : {}),
      ...(opts.extraTools ? { extraTools: opts.extraTools } : {}),
      ...(opts.channelAdapters ? { channelAdapters: opts.channelAdapters } : {}),
      ...(opts.channelRetryMs ? { channelRetryMs: opts.channelRetryMs } : {}),
      ...(opts.roomBurstMs !== undefined ? { roomBurstMs: opts.roomBurstMs } : {}),
      ...(opts.suggestBurstMs !== undefined ? { suggestBurstMs: opts.suggestBurstMs } : {}),
      ...(opts.inputWaits ? { inputWaits: opts.inputWaits } : {}),
      ...(opts.engineIdleMs ? { engineIdleMs: opts.engineIdleMs } : {}),
      ...(opts.turnIdleMs ? { turnIdleMs: opts.turnIdleMs } : {}),
      ...(opts.a2aCapMs ? { a2aCapMs: opts.a2aCapMs } : {}),
      ...(opts.runTimers ? { runTimers: opts.runTimers } : {}),
      ...(opts.desktop ? { desktop: opts.desktop } : {}),
      imessage: opts.imessage ?? null,
      ...(opts.clock ? { clock: opts.clock } : {}),
      ...(opts.unseenAfterMs !== undefined ? { unseenAfterMs: opts.unseenAfterMs } : {}),
      ...(opts.telemetrySink ? { telemetrySink: opts.telemetrySink } : {}),
      ...(opts.releases ? { releases: opts.releases } : {}),
    },
  );
  // Tests choose their model like an owner would: through the settings, never through code defaults.
  if (!core.store.settings.get("model_default"))
    core.store.settings.set("model_default", JSON.stringify({ model: "fake/fake-1", router: false }));
  if (!opts.aux && !core.store.settings.get("model_aux")) core.store.settings.set("model_aux", "off");
  core.store.settings.write("memory", {
    ...core.store.settings.read("memory"),
    auto_capture: opts.memoryMaintenance ?? false,
    auto_dream: opts.memoryMaintenance ?? false,
  });
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
  const cleanup = () => {
    // Retry transient filesystem locks; persistent cleanup failures still fail the test.
    const options = { recursive: true, force: true, maxRetries: 10, retryDelay: 50 };
    fs.rmSync(home, options);
    fs.rmSync(scratchRoot(home), options);
  };
  return { core, client, home, settle, cleanup };
}

export const texts = (messages: Message[]) =>
  messages.flatMap((m) => m.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])));
