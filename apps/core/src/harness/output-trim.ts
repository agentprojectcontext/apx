// Older tool output, cleared so a long turn's context stays small: what a call returned is kept whole for the newest
// calls and stubbed for older ones, which the model can run again. The model log keeps every result in full.
import type { ChatItem } from "../providers/types.ts";

/** Shorter results stay as they are: a stub would save little and lose a fact. */
const SHORT = 400;

export const outputStub = (tool: string, chars: number) =>
  `[earlier output of ${tool} omitted: ${chars} chars; call it again if you need it]`;

/**
 * `items` with tool results older than the newest ones stubbed, keeping whole the newest results that fit in `keep`
 * characters (and at least `min` of them). Calls and results stay paired; the same input gives the same output.
 */
export function clearOlderOutput(items: readonly ChatItem[], keep: number, min = 2): ChatItem[] {
  const names = new Map<string, string>();
  for (const m of items)
    if (m.role === "assistant") for (const c of m.tool_calls ?? []) names.set(c.id, c.function.name);
  let used = 0;
  let kept = 0;
  let full = false;
  const out = [...items];
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i];
    if (m?.role !== "tool" || m.content.length <= SHORT) continue;
    // Once one does not fit, every older one goes too: the kept part is one recent stretch.
    full ||= kept >= min && used + m.content.length > keep;
    if (!full) {
      used += m.content.length;
      kept++;
      continue;
    }
    out[i] = { ...m, content: outputStub(names.get(m.tool_call_id) ?? "a tool", m.content.length) };
  }
  return out;
}

/** Characters of tool output `items` carry. */
export const outputChars = (items: readonly ChatItem[]) =>
  items.reduce((n, m) => n + (m.role === "tool" ? m.content.length : 0), 0);
