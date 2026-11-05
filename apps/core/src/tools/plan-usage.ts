import { z } from "zod";
import { untrusted } from "./result.ts";
import type { Setting } from "./settings-kit.ts";
import type { ToolContext } from "./types.ts";

const ARGS = z.object({ query: z.string().trim().min(1).max(100).optional() }).strict();

/** Every detected engine's plan quotas, matched by engine id or provider/plan name. */
export async function planUsage(query: string | undefined, call: ToolContext["call"]): Promise<string> {
  const report = await call("engines.usage", { all: true });
  const needle = query?.toLowerCase();
  const engines = report.engines.filter((engine) => {
    if (!needle) return true;
    const names = [engine.id, engine.label];
    if (engine.id === "codex") names.push("ChatGPT", "OpenAI");
    if (engine.id === "claude") names.push("Anthropic", "Claude Auto");
    return names.some((name) => name.toLowerCase().includes(needle));
  });
  return untrusted(
    "plan_usage",
    {},
    JSON.stringify({
      checked_at: report.checked_at,
      engines,
      ...(query ? { query, matched: engines.length > 0 } : {}),
      note: "Account quotas, not chat tokens or API costs. Shared AI usage cache (up to 60 seconds). Every engine detected on this computer is included, also those the owner keeps out of the top bar. An empty list or unmatched query does not mean zero usage: the account may be unknown, unsupported or not installed. Plan tiers and multiple accounts per engine are not identified by this source. Unavailable/not_available cannot distinguish a failed check from missing data. Missing windows or reset times are unknown, not zero.",
    }),
  );
}

/** Read through apx_settings, so it costs the prompt nothing until the owner asks (rules/PROMPT_SIZE.md). */
export const USAGE: Readonly<Record<string, Setting>> = {
  "engines.usage": {
    does: "Read the quotas, windows and reset times left on the owner's AI plans (Claude, ChatGPT/Codex and any other engine detected), whatever the top bar shows; query filters by engine or provider/plan name. Read it when the owner asks, not on your own.",
    own: {
      reads: true,
      confirm: "never",
      args: ARGS,
      run: (p, _d, ctx) => planUsage(ARGS.parse(p).query, ctx.call),
    },
  },
};
