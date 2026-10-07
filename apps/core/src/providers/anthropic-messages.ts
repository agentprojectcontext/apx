// Anthropic Messages API. Converts the canonical OpenAI-shaped items: leading system items become `system`,
// later system notes become user text, assistant tool calls become tool_use blocks and tool results tool_result.
import {
  type AssistantItem,
  type ChatItem,
  type Finish,
  ProviderError,
  post,
  sseData,
  type ToolCall,
  type Transport,
  type Usage,
} from "./types.ts";

type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };
type Msg = { role: "user" | "assistant"; content: Block[] };
const EPHEMERAL = { type: "ephemeral" } as const;

/**
 * Anthropic caches only what a request marks: the system prompt (with the tools before it) and the conversation up to
 * its last block, so each step of a turn reads the earlier ones from the cache.
 */
function withCache(system: string, messages: Msg[]) {
  const last = messages.at(-1);
  const tail = last?.content.at(-1);
  const marked =
    last && tail
      ? [
          ...messages.slice(0, -1),
          { role: last.role, content: [...last.content.slice(0, -1), { ...tail, cache_control: EPHEMERAL }] },
        ]
      : messages;
  return { system: system ? [{ type: "text", text: system, cache_control: EPHEMERAL }] : undefined, messages: marked };
}

const MAX_TOKENS = 16_000;

export function toAnthropic(items: ChatItem[]): { system: string; messages: Msg[] } {
  const system: string[] = [];
  const messages: Msg[] = [];
  const push = (role: Msg["role"], block: Block) => {
    const last = messages.at(-1);
    if (last?.role === role) last.content.push(block);
    else messages.push({ role, content: [block] });
  };
  for (const [i, m] of items.entries()) {
    if (m.role === "system") {
      if (messages.length === 0 && i === system.length) system.push(m.content);
      else push("user", { type: "text", text: `<system_note>\n${m.content}\n</system_note>` });
    } else if (m.role === "user") {
      push("user", { type: "text", text: m.content });
      for (const img of m.images ?? [])
        if (img.data) push("user", { type: "image", source: { type: "base64", media_type: img.mime, data: img.data } });
    } else if (m.role === "tool")
      push("user", { type: "tool_result", tool_use_id: m.tool_call_id, content: m.content });
    else if (m.role === "assistant") {
      if (m.content) push("assistant", { type: "text", text: m.content });
      for (const c of m.tool_calls ?? []) {
        let input: unknown = {};
        try {
          input = JSON.parse(c.function.arguments || "{}");
        } catch {}
        push("assistant", { type: "tool_use", id: c.id, name: c.function.name, input });
      }
    }
  }
  return { system: system.join("\n\n"), messages };
}

type Event = {
  type: string;
  index?: number;
  message?: {
    usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  };
  content_block?: { type: string; id?: string; name?: string; text?: string };
  delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string };
  usage?: { output_tokens?: number };
  error?: { type?: string; message?: string };
};

const finishOf = (r: string | undefined): Finish =>
  r === "end_turn" || r === "stop_sequence"
    ? "stop"
    : r === "tool_use"
      ? "tool_calls"
      : r === "max_tokens"
        ? "length"
        : "other";

export const anthropicMessages: Transport = async (req) => {
  const plain = toAnthropic(req.messages);
  const { system, messages } = withCache(plain.system, plain.messages);
  const { res, touch, done } = await post(
    req,
    `${req.baseUrl.replace(/\/$/, "")}/v1/messages`,
    { "x-api-key": req.key, "anthropic-version": "2023-06-01" },
    {
      model: req.model,
      max_tokens: MAX_TOKENS,
      ...(system ? { system } : {}),
      messages,
      ...(req.tools.length
        ? {
            tools: req.tools.map((t) => ({
              name: t.function.name,
              description: t.function.description,
              input_schema: t.function.parameters,
            })),
          }
        : {}),
      stream: true,
    },
  );
  try {
    let text = "";
    let finish: Finish = "other";
    const usage: Usage = { input: 0, output: 0 };
    const calls: ToolCall[] = [];
    const byIndex = new Map<number, ToolCall>();
    for await (const data of sseData(res, touch)) {
      let ev: Event;
      try {
        ev = JSON.parse(data) as Event;
      } catch {
        continue;
      }
      if (ev.type === "error") {
        const kind = ev.error?.type === "overloaded_error" ? "overloaded" : "bad_request";
        throw new ProviderError(kind, `stream error: ${ev.error?.message ?? "unknown"}`);
      }
      if (ev.type === "message_start") {
        // Anthropic counts cached tokens apart; `input` is every prompt token, as other providers report it.
        const u = ev.message?.usage;
        const cached = u?.cache_read_input_tokens ?? 0;
        usage.input = (u?.input_tokens ?? 0) + cached + (u?.cache_creation_input_tokens ?? 0);
        if (cached) usage.cached = cached;
      } else if (ev.type === "content_block_start" && ev.content_block?.type === "tool_use") {
        const call: ToolCall = {
          id: ev.content_block.id ?? `call_${calls.length}`,
          type: "function",
          function: { name: ev.content_block.name ?? "", arguments: "" },
        };
        calls.push(call);
        byIndex.set(ev.index ?? -1, call);
      } else if (ev.type === "content_block_delta") {
        if (ev.delta?.type === "text_delta" && ev.delta.text) {
          text += ev.delta.text;
          req.onText?.(text);
        } else if (ev.delta?.type === "input_json_delta") {
          const call = byIndex.get(ev.index ?? -1);
          if (call) call.function.arguments += ev.delta.partial_json ?? "";
        }
      } else if (ev.type === "message_delta") {
        finish = finishOf(ev.delta?.stop_reason);
        usage.output = ev.usage?.output_tokens ?? usage.output;
      }
    }
    if (!text && !calls.length) throw new ProviderError("empty", "empty stream");
    const message: AssistantItem = {
      role: "assistant",
      content: text || null,
      ...(calls.length
        ? {
            tool_calls: calls.map((c) => ({
              ...c,
              function: { ...c.function, arguments: c.function.arguments || "{}" },
            })),
          }
        : {}),
    };
    return { message, model: req.model, finish, usage };
  } finally {
    done();
  }
};
