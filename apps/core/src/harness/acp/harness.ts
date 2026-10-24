// Any CLI that speaks the Agent Client Protocol as a harness: one process per turn in the thread's folder, its own
// session resumed when the agent can, APX tools through the per-run MCP proxy, its permission requests through our
// policy, its own tool calls shown as cards.
import { engineOf } from "../../domain/refs.ts";
import type { Usage } from "../../providers/types.ts";
import type { McpCommand } from "../codex.ts";
import { type Harness, modelPart, type TurnIO, type TurnOutcome } from "../types.ts";
import { type AcpAgent, acpEngine, openSession } from "./agents.ts";
import { RpcError } from "./rpc.ts";

const CANCEL_GRACE_MS = 3_000;

type PermissionOption = { optionId: string; kind: string; name?: string };
type ToolUpdate = {
  toolCallId?: string;
  title?: string;
  kind?: string;
  status?: string;
  rawInput?: unknown;
  content?: Array<{ type?: string; content?: { type?: string; text?: string } }>;
};

const textOf = (u: ToolUpdate) =>
  (u.content ?? [])
    .map((c) => c.content?.text ?? "")
    .join("\n")
    .trim()
    .slice(0, 300) || undefined;

export function acpHarness(opts: {
  agents: () => AcpAgent[];
  binary: (agent: AcpAgent) => Promise<string>;
  cwd: (io: TurnIO) => string;
  gate(io: TurnIO): { command: McpCommand; close(): void };
}): Harness {
  return {
    id: "acp",
    async run(io: TurnIO): Promise<TurnOutcome> {
      const engine = engineOf(io.models[0] ?? "");
      const agent = opts.agents().find((a) => acpEngine(a) === engine);
      if (!agent) throw new Error(`no ACP agent "${engine}" is configured`);
      const binary = await opts.binary(agent);
      const wanted = modelPart(io.models[0]);
      const gate = opts.gate(io);
      let text = "";
      // What it says since its last tool call: the display starts a new text part after each card.
      let said = "";
      // A loaded session replays its history as updates: only what comes after our prompt is this turn.
      let prompting = false;
      const titles = new Map<string, { title: string; kind: string }>();
      // How full its context is, when the agent says (`usage_update`).
      let context: { used?: number; size?: number } = {};
      const session = await openSession(agent, {
        apxAgent: io.agent.id,
        binary,
        cwd: opts.cwd(io),
        resume: io.sessionId,
        signal: io.signal,
        mcpServers: [
          {
            name: "apx",
            command: gate.command.command,
            args: gate.command.args,
            env: Object.entries(gate.command.env).map(([name, value]) => ({ name, value })),
          },
        ],
        onUpdate(u) {
          if (!prompting) return;
          io.alive?.();
          const kind = String(u.sessionUpdate ?? "");
          if (kind === "agent_message_chunk") {
            const c = u.content as { type?: string; text?: string } | undefined;
            if (c?.type === "text" && c.text) {
              text += c.text;
              said += c.text;
              io.onText(said);
            }
          } else if (kind === "usage_update") {
            context = u as { used?: number; size?: number };
          } else if (kind === "tool_call" || kind === "tool_call_update") {
            if (kind === "tool_call") said = "";
            const t = u as ToolUpdate;
            if (!t.toolCallId) return;
            const known = titles.get(t.toolCallId);
            const title = t.title ?? known?.title ?? "tool";
            const tk = t.kind ?? known?.kind ?? "other";
            titles.set(t.toolCallId, { title, kind: tk });
            const status = t.status === "completed" ? "ok" : t.status === "failed" ? "error" : "running";
            io.observe({ callId: t.toolCallId, title, kind: tk, status, ...(textOf(t) ? { detail: textOf(t) } : {}) });
          }
        },
        async onRequest(method, params) {
          if (method !== "session/request_permission") throw new RpcError(-32601, `${method} is not offered`);
          const p = params as { toolCall?: ToolUpdate; options?: PermissionOption[] };
          const call = p.toolCall ?? {};
          const known = call.toolCallId ? titles.get(call.toolCallId) : undefined;
          const ok = await io.approve({
            callId: call.toolCallId ?? `perm-${Date.now()}`,
            title: call.title ?? known?.title ?? "an action",
            kind: call.kind ?? known?.kind ?? "other",
            detail: call.rawInput === undefined ? undefined : JSON.stringify(call.rawInput, null, 1),
            input: call.rawInput,
          });
          const options = p.options ?? [];
          // Once, never "always": an approval is for this call, not one the agent may store.
          const pick =
            options.find((o) => o.kind === (ok ? "allow_once" : "reject_once")) ??
            (ok ? undefined : options.find((o) => o.kind.startsWith("reject")));
          return pick
            ? { outcome: { outcome: "selected", optionId: pick.optionId } }
            : { outcome: { outcome: "cancelled" } };
        },
      });
      try {
        let model = session.currentModel;
        if (wanted && wanted !== model) {
          if (!session.models.some((m) => m.id === wanted))
            throw new Error(`${agent.label} does not offer the model ${wanted}`);
          if (await session.setModel(wanted)) model = wanted;
        }
        const onAbort = () => session.rpc.notify("session/cancel", { sessionId: session.sessionId });
        io.signal.throwIfAborted();
        io.signal.addEventListener("abort", onAbort, { once: true });
        prompting = true;
        try {
          const r = await Promise.race([
            session.rpc.request<{ stopReason?: string; usage?: AcpUsage }>(
              "session/prompt",
              { sessionId: session.sessionId, prompt: [{ type: "text", text: io.input.content }] },
              // The engine's run deadline ends the turn; this only guards a silent process.
              24 * 60 * 60_000,
            ),
            new Promise<never>((_, reject) => {
              const stop = () => setTimeout(() => reject(io.signal.reason ?? new Error("canceled")), CANCEL_GRACE_MS);
              if (io.signal.aborted) stop();
              io.signal.addEventListener("abort", stop, { once: true });
            }),
          ]);
          io.signal.throwIfAborted();
          if (r.stopReason === "refusal") throw new Error(`${agent.label} refused to answer`);
          return {
            // The answer is what it said last; the earlier segments are already above their tool cards.
            text: said || text,
            model: `${engine}/${model ?? "default"}`,
            sessionId: session.sessionId,
            ...(r.stopReason === "max_tokens" ? { finish: "length" as const } : {}),
            ...(r.usage ? { usage: usageOf(r.usage, context) } : {}),
          };
        } finally {
          io.signal.removeEventListener("abort", onAbort);
        }
      } finally {
        await session.close();
        gate.close();
      }
    },
  };
}

/** A prompt's tokens as ACP reports them; cache reads and writes may be counted apart from `inputTokens`. */
type AcpUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cachedReadTokens?: number;
  cachedWriteTokens?: number;
  totalTokens?: number;
};

/** `input` counts every prompt token: the cached ones are added when the agent's total says they were left out. */
export function usageOf(u: AcpUsage, context: { used?: number; size?: number }): Usage {
  const read = u.cachedReadTokens ?? 0;
  const cache = read + (u.cachedWriteTokens ?? 0);
  const input = u.inputTokens ?? 0;
  const output = u.outputTokens ?? 0;
  const apart = cache > 0 && (u.totalTokens ?? 0) >= input + output + cache;
  return {
    input: apart ? input + cache : input,
    output,
    ...(read ? { cached: read } : {}),
    ...(context.used ? { context: context.used } : {}),
    ...(context.size ? { window: context.size } : {}),
  };
}
