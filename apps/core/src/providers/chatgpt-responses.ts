// The ChatGPT plan's models through the Responses API it serves for Codex (chatgpt.com/backend-api/codex): streamed
// only, `store: false`, the system prompt as `instructions`. Its encrypted reasoning rides on the assistant item and
// goes back with the next round, to the same model only, so it keeps its plan across tool calls.
import { createHash } from "node:crypto";
import {
  type AssistantItem,
  type ChatItem,
  type Completion,
  type Finish,
  ProviderError,
  post,
  resetOf,
  sseData,
  type ToolCall,
  type Transport,
  type Usage,
} from "./types.ts";

/** Encrypted reasoning kept on an assistant item, with the model that wrote it. */
type Reasoning = { model: string; summary: unknown[]; encrypted_content: string };
const REASONING = "responses_reasoning";

type Event = {
  type?: string;
  delta?: string;
  item_id?: string;
  item?: {
    id?: string;
    type?: string;
    call_id?: string;
    name?: string;
    arguments?: string;
    summary?: unknown[];
    encrypted_content?: string;
    content?: Array<{ type?: string; text?: string; refusal?: string }>;
  };
  response?: {
    status?: string;
    incomplete_details?: { reason?: string };
    usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
    error?: { message?: string };
  };
  error?: { message?: string };
  message?: string;
};

/** Why a round came back with nothing, so the owner sees more than "empty stream". */
function emptyWhy(ended: Event["response"] | undefined): string {
  if (!ended) return "empty stream: it ended before the response finished";
  const reason = ended.incomplete_details?.reason;
  if (ended.status && ended.status !== "completed")
    return `empty stream: the response ended ${ended.status}${reason ? ` (${reason})` : ""}`;
  return "empty stream";
}

const text = (role: "user" | "assistant", t: string) => ({
  type: "message",
  role,
  content: [{ type: role === "user" ? "input_text" : "output_text", text: t }],
});

/** Our chat items as Responses input; the first system item becomes `instructions`, later ones developer notes. */
export function toInput(messages: ChatItem[], model: string): { instructions: string; input: unknown[] } {
  const first = messages[0];
  const instructions = first?.role === "system" ? first.content : "You are a helpful assistant.";
  const input: unknown[] = [];
  for (const [i, m] of messages.entries()) {
    if (m.role === "system") {
      if (i > 0 && m.content)
        input.push({ type: "message", role: "developer", content: [{ type: "input_text", text: m.content }] });
    } else if (m.role === "tool") {
      input.push({ type: "function_call_output", call_id: m.tool_call_id, output: m.content });
    } else if (m.role === "user") {
      const images = (m.images ?? []).flatMap((im) =>
        im.data ? [{ type: "input_image", image_url: `data:${im.mime};base64,${im.data}` }] : [],
      );
      input.push(
        images.length
          ? { type: "message", role: "user", content: [{ type: "input_text", text: m.content }, ...images] }
          : text("user", m.content),
      );
    } else {
      for (const r of (m[REASONING] as Reasoning[] | undefined) ?? [])
        if (r.model === model)
          input.push({ type: "reasoning", summary: r.summary, encrypted_content: r.encrypted_content });
      if (m.content) input.push(text("assistant", m.content));
      for (const c of m.tool_calls ?? [])
        input.push({
          type: "function_call",
          call_id: c.id,
          name: c.function.name,
          arguments: c.function.arguments || "{}",
        });
    }
  }
  return { instructions, input };
}

/** A chat's id as the UUID Codex would send for a conversation: the same chat, the same one. */
export function sessionUuid(key: string): string {
  const h = createHash("sha256").update(key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((Number.parseInt(h[16] ?? "0", 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const chatgptResponses: Transport = async (req) => {
  const { instructions, input } = toInput(req.messages, req.model);
  const { res, touch, done } = await post(
    req,
    `${req.baseUrl.replace(/\/$/, "")}/responses`,
    {
      authorization: `Bearer ${req.key}`,
      accept: "text/event-stream",
      ...req.headers,
      ...(req.cacheKey ? { session_id: sessionUuid(req.cacheKey) } : {}),
    },
    {
      model: req.model,
      instructions,
      input,
      store: false,
      ...(req.maxOutputTokens ? { max_output_tokens: req.maxOutputTokens } : {}),
      stream: true,
      // Codex sends its conversation id here and as the session_id header: the plan's prompt cache follows both.
      ...(req.cacheKey ? { prompt_cache_key: sessionUuid(req.cacheKey) } : {}),
      include: ["reasoning.encrypted_content"],
      ...(req.effort ? { reasoning: { effort: req.effort, summary: "auto" } } : {}),
      ...(req.tools.length
        ? {
            tools: req.tools.map((t) => ({
              type: "function",
              name: t.function.name,
              description: t.function.description,
              parameters: t.function.parameters,
              // Keep optional arguments optional; APX validates each call at execution time.
              strict: false,
            })),
            tool_choice: "auto",
            parallel_tool_calls: true,
          }
        : {}),
    },
  );
  try {
    let out = "";
    let finish: Finish = "stop";
    let usage: Usage | undefined;
    const calls: ToolCall[] = [];
    const args = new Map<string, { call_id: string; name: string; arguments: string }>();
    const reasoning: Reasoning[] = [];
    // A model may send its message only whole (no deltas), or a refusal: both still answer the turn.
    let whole = "";
    let refusal = "";
    let ended: Event["response"] | undefined;
    for await (const data of sseData(res, touch)) {
      let ev: Event;
      try {
        ev = JSON.parse(data) as Event;
      } catch {
        continue;
      }
      const it = ev.item;
      switch (ev.type) {
        case "response.output_text.delta":
          out += ev.delta ?? "";
          req.onText?.(out);
          break;
        case "response.output_item.added":
          if (it?.type === "function_call" && it.id)
            args.set(it.id, { call_id: it.call_id ?? it.id, name: it.name ?? "", arguments: it.arguments ?? "" });
          break;
        case "response.function_call_arguments.delta": {
          const a = ev.item_id ? args.get(ev.item_id) : undefined;
          if (a) a.arguments += ev.delta ?? "";
          break;
        }
        case "response.refusal.delta":
          refusal += ev.delta ?? "";
          break;
        case "response.output_item.done":
          if (it?.type === "message")
            whole += (it.content ?? []).map((c) => (c.type === "refusal" ? c.refusal : c.text) ?? "").join("");
          else if (it?.type === "reasoning" && it.encrypted_content)
            reasoning.push({ model: req.model, summary: it.summary ?? [], encrypted_content: it.encrypted_content });
          else if (it?.type === "function_call") {
            const a = it.id ? args.get(it.id) : undefined;
            const id = it.call_id ?? a?.call_id ?? it.id ?? `call_${calls.length}`;
            if (!calls.some((c) => c.id === id))
              calls.push({
                id,
                type: "function",
                function: { name: it.name ?? a?.name ?? "", arguments: it.arguments ?? a?.arguments ?? "{}" },
              });
          }
          break;
        case "response.completed":
        case "response.incomplete": {
          const u = ev.response?.usage;
          const cached = u?.input_tokens_details?.cached_tokens;
          if (u) usage = { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, ...(cached ? { cached } : {}) };
          if (ev.type === "response.incomplete" || ev.response?.status === "incomplete") finish = "length";
          ended = ev.response ?? {};
          break;
        }
        case "response.failed":
        case "error": {
          const why = ev.response?.error?.message ?? ev.error?.message ?? ev.message ?? "the model failed";
          const limit = /limit|quota|usage/i.test(why);
          throw new ProviderError(limit ? "quota" : "overloaded", why, limit ? resetOf(data) : undefined);
        }
      }
    }
    out ||= whole || refusal;
    if (!out && !calls.length) throw new ProviderError("empty", emptyWhy(ended));
    const message: AssistantItem = {
      role: "assistant",
      content: out || null,
      ...(calls.length ? { tool_calls: calls } : {}),
      ...(reasoning.length ? { [REASONING]: reasoning } : {}),
    };
    return {
      message,
      model: req.model,
      finish: calls.length ? "tool_calls" : finish,
      ...(usage ? { usage } : {}),
    } satisfies Completion;
  } finally {
    done();
  }
};
