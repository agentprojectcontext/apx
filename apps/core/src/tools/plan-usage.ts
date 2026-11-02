import { z } from "zod";
import { untrusted } from "./result.ts";
import { defineTool, type Tool } from "./types.ts";

export function planUsageTools(enabled: () => boolean): Tool[] {
  return [
    defineTool({
      name: "plan_usage",
      description:
        "Read account quota for all usage-enabled plans, not just your current model. Optional query filters by provider/plan name or engine id (Claude, Codex, ChatGPT, Cursor). Returns reported percentages, windows, resets and check time; unavailable is not zero. Uses the AI usage menu's source and preferences; cannot enable checks or read credentials.",
      args: z.object({
        query: z.string().trim().min(1).max(100).optional().describe("provider/plan name or engine id; omit for all"),
      }),
      when: enabled,
      effect: "none",
      deadlineMs: 40_000,
      title: () => "Checked plan usage",
      async run({ query }, ctx) {
        const report = await ctx.call("engines.usage", {});
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
            note: "Account quotas, not chat tokens or API costs. Shared AI usage cache (up to 60 seconds). Only usage-enabled engines are included. An empty list or unmatched query does not mean zero usage: the account may be unknown, unsupported or disabled. Plan tiers and multiple accounts per engine are not identified by this source. Unavailable/not_available cannot distinguish a failed check from missing data. Missing windows or reset times are unknown, not zero.",
          }),
        );
      },
    }),
  ];
}
