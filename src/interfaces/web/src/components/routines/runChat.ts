import type { ChatMsg, ChatPart, ToolPart } from "../../hooks/useChat";

type TraceItem = {
  tool?: string;
  args?: Record<string, unknown>;
  result?: unknown;
};

/** Rebuild a chat turn from a routine run's stored result (trace + reply).
 *  Older runs that leaked DeepSeek DSML as the "answer" are parsed into
 *  tool parts so the preview looks like a chat instead of XML. */
export function routineRunToChatMsgs(
  result: Record<string, unknown> | null | undefined,
  ts: string,
): ChatMsg[] {
  if (!result) return [];
  const reply = String(result.reply ?? result.text ?? result.stdout ?? "");
  const trace = Array.isArray(result.trace) ? (result.trace as TraceItem[]) : [];
  const parts: ChatPart[] = [];

  if (trace.length) {
    for (let i = 0; i < trace.length; i++) {
      const item = trace[i];
      if (!item?.tool) continue;
      parts.push(toolPart(`run-${i}`, item.tool, item.args, item.result));
    }
    if (reply.trim()) parts.push({ kind: "text", text: reply.trim() });
  } else {
    const dsml = parseDsmlForDisplay(reply);
    parts.push(...dsml.tools);
    if (dsml.text.trim()) parts.push({ kind: "text", text: dsml.text.trim() });
  }

  if (!parts.length) return [];
  const agent = typeof result.agent_slug === "string" ? result.agent_slug : undefined;
  return [{
    role: "assistant",
    parts,
    ts,
    agent,
    agentId: agent,
  }];
}

export function parseDsmlForDisplay(text: string): { tools: ToolPart[]; text: string } {
  if (!text || !/DSML/i.test(text)) return { tools: [], text };
  const tools: ToolPart[] = [];
  const openRe = /<\|{1,2}DSML\|{1,2}invoke\s+name="([^"]+)"\s*>/gi;
  let m: RegExpExecArray | null;
  let cleaned = text;
  let seq = 0;
  while ((m = openRe.exec(text)) !== null) {
    const name = m[1];
    const start = m.index;
    const afterOpen = start + m[0].length;
    const closeRe = /<\/\|{1,2}DSML\|{1,2}invoke>/i;
    const closeMatch = closeRe.exec(text.slice(afterOpen));
    const innerEnd = closeMatch ? afterOpen + closeMatch.index : text.length;
    const end = closeMatch ? innerEnd + closeMatch[0].length : innerEnd;
    const inner = text.slice(afterOpen, innerEnd);
    const args: Record<string, unknown> = {};
    const paramRe =
      /<\|{1,2}DSML\|{1,2}parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/\|{1,2}DSML\|{1,2}parameter>/gi;
    let p: RegExpExecArray | null;
    while ((p = paramRe.exec(inner)) !== null) args[p[1]] = p[2].trim();
    tools.push(toolPart(`dsml-${seq++}`, name, args, undefined));
    cleaned = cleaned.replace(text.slice(start, end), "");
  }
  cleaned = cleaned.replace(/<\/?\|{1,2}DSML\|{1,2}[^>]*>/gi, "");
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  return { tools, text: cleaned };
}

function toolPart(
  id: string,
  tool: string,
  args: Record<string, unknown> | undefined,
  result: unknown,
): ToolPart {
  const err = result && typeof result === "object" && "error" in (result as object)
    ? Boolean((result as { error?: unknown }).error)
    : false;
  return {
    kind: "tool",
    id,
    tool,
    args,
    result,
    status: err ? "error" : "done",
  };
}
