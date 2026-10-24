// agent_limits: how far agents may go on their own before the chain pauses (engine/breaker.ts), read by the agent that
// orchestrates the work, and changed or let go on only with the owner's OK. Without it an agent guessed at the pause and
// took it for the notice budget, and "raise it" stayed an empty promise. Offered only in a conversation where agents work
// together (sub-threads, task chats), the only place the limits apply, so a plain chat's prompt stays as small.
import { z } from "zod";
import type { Store } from "../domain/store.ts";
import { budgetLeft, tree, tripped } from "../engine/breaker.ts";
import { MAX_UNATTENDED_RUNS, MAX_UNATTENDED_TOKENS, unattendedLimits } from "../engine/limits.ts";
import { defineTool, type Tool } from "./types.ts";

const k = (n: number) => (n ? `${Math.round(n / 1000)}k fresh tokens` : "no token limit");
const turns = (n: number) => (n ? `${n} turns` : "no turn limit");

export function limitTools(store: Store): Tool[] {
  return [
    defineTool({
      name: "agent_limits",
      description:
        "How far agents may go on their own (delegations, results waking you) since the owner last wrote in this conversation before it pauses, what they spent, and whether it is paused now. This is not the owner's notice budget. Only when the owner asks: runs/tokens change the limit for every chat (0: none), go_on lets this paused conversation go on (reset: a fresh budget; release: no limit until the owner writes here again). Each change waits for the owner's OK.",
      args: z.object({
        runs: z.number().int().min(0).max(10_000).optional().describe("turns without the owner"),
        tokens: z.number().int().min(0).max(1_000_000_000).optional().describe("fresh tokens without the owner"),
        go_on: z.enum(["reset", "release"]).optional(),
      }),
      when: (thread) => tree(store, thread.id).length > 1,
      effect: "local",
      confirm: (a) => (a.runs !== undefined || a.tokens !== undefined || a.go_on ? "always" : "never"),
      // How far agents go without the owner is theirs to change, on their card in every mode (DECISIONS.md#d-143).
      ownerSetting: (a) => a.runs !== undefined || a.tokens !== undefined || Boolean(a.go_on),
      deadlineMs: 15_000,
      title: (a) =>
        a.go_on
          ? "Let the agents go on"
          : a.runs !== undefined || a.tokens !== undefined
            ? "Changed the agents' limits"
            : "Looked at the agents' limits",
      async run(a, ctx) {
        const changes = a.runs !== undefined || a.tokens !== undefined;
        if ((changes || a.go_on) && !ctx.callAsOwner) return "not run: the owner did not approve it";
        const done: string[] = [];
        if (changes && ctx.callAsOwner) {
          const now = unattendedLimits(store);
          const set = await ctx.callAsOwner("agents.set_limits", {
            runs: a.runs ?? now.runs,
            tokens: a.tokens ?? now.tokens,
          });
          done.push(`limits now: ${turns(set.runs)}, ${k(set.tokens)}`);
        }
        if (a.go_on && ctx.callAsOwner) {
          const { started } = await ctx.callAsOwner("threads.go_on", { thread: ctx.thread.id, mode: a.go_on });
          done.push(`went on (${a.go_on}); ${started} held turn${started === 1 ? "" : "s"} started`);
        }
        const max = unattendedLimits(store);
        const used = budgetLeft(store, ctx.thread.id, []).all;
        const paused = tripped(store, ctx.thread.id);
        return [
          ...done,
          `limits: ${turns(max.runs)}, ${k(max.tokens)} (defaults ${MAX_UNATTENDED_RUNS} turns, ${k(MAX_UNATTENDED_TOKENS)}); input read from a provider's cache does not count`,
          used ? `spent here since the owner last wrote: ${used}` : "nothing limits this conversation now",
          paused ? `paused: ${paused}` : "not paused",
        ].join("\n");
      },
    }),
  ];
}
