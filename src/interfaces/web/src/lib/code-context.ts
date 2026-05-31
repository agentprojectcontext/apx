// Context metrics + breakdown for the Code module's Context tab.
//
// Real token totals come from the last assistant turn's `usage` (emitted by the
// super-agent's `final` event). The per-category breakdown is a char/4 estimate
// (ported from OpenCode's session-context-breakdown) — good enough to visualise
// where the conversation's weight sits (user vs assistant vs tool I/O).
import type { CodeTurn } from "./api/code";

const estTokens = (s: string): number => (s ? Math.ceil(s.length / 4) : 0);

function turnText(turn: CodeTurn, kinds: { text?: boolean; tool?: boolean }): number {
  let chars = 0;
  for (const p of turn.parts || []) {
    if (p.kind === "text" && kinds.text) chars += p.text.length;
    if (p.kind === "tool" && kinds.tool) {
      if (p.args) chars += JSON.stringify(p.args).length;
      if (p.result !== undefined) chars += JSON.stringify(p.result).length;
    }
  }
  return Math.ceil(chars / 4);
}

export interface CtxMetrics {
  model: string | null;
  input: number;
  output: number;
  total: number;
  hasUsage: boolean;
  messages: number;
  userMsgs: number;
  assistantMsgs: number;
}

export function computeMetrics(turns: CodeTurn[]): CtxMetrics {
  let lastUsage: { input?: number; output?: number; model?: string | null } | null = null;
  let userMsgs = 0;
  let assistantMsgs = 0;
  for (const t of turns) {
    if (t.role === "user") userMsgs++;
    else assistantMsgs++;
    if (t.role === "assistant" && t.usage) {
      lastUsage = { input: t.usage.input_tokens, output: t.usage.output_tokens, model: t.model };
    }
  }
  const input = lastUsage?.input ?? 0;
  const output = lastUsage?.output ?? 0;
  return {
    model: lastUsage?.model ?? null,
    input,
    output,
    total: input + output,
    hasUsage: !!lastUsage,
    messages: turns.length,
    userMsgs,
    assistantMsgs,
  };
}

export interface CtxSegment {
  key: "user" | "assistant" | "tool";
  tokens: number;
  percent: number;
}

export function computeBreakdown(turns: CodeTurn[]): CtxSegment[] {
  let user = 0;
  let assistant = 0;
  let tool = 0;
  for (const t of turns) {
    if (t.role === "user") user += turnText(t, { text: true });
    else assistant += turnText(t, { text: true });
    tool += turnText(t, { tool: true });
  }
  const total = user + assistant + tool || 1;
  const seg = (key: CtxSegment["key"], tokens: number): CtxSegment => ({
    key,
    tokens,
    percent: Math.round((tokens / total) * 100),
  });
  return [seg("user", user), seg("assistant", assistant), seg("tool", tool)].filter(
    (s) => s.tokens > 0,
  );
}
