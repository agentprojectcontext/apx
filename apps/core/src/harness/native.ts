// The built-in loop: our model call, our tools, bounded steps. What the model says and every tool result are
// logged as they happen.
import type { Llm } from "../providers/llm.ts";
import type { ChatItem, ModelFailure, Usage } from "../providers/types.ts";
import type { Harness } from "./types.ts";

const MAX_STEPS = 14;
const MAX_CONTINUATIONS = 2;
/** Same tool with the same arguments this many times = stuck. */
const REPEAT_LIMIT = 3;

/**
 * A note from APX to the model mid-turn. Sent as a tagged user item: some providers fold every system item into
 * the system prompt, which would move it out of order and break the cached prefix.
 */
export const systemNote = (content: string): ChatItem => ({
  role: "user",
  content: `<system_note>\n${content}\n</system_note>`,
});

export function nativeHarness(llm: Llm): Harness {
  return {
    id: "native",
    async run(io) {
      const messages: ChatItem[] = [{ role: "system", content: io.system }, ...io.history, io.input];
      const push = (...items: ChatItem[]) => {
        messages.push(...items);
        io.log(items);
      };
      const usage: Usage = { input: 0, output: 0 };
      const seen = new Map<string, number>();
      let model = "";
      let effort: string | undefined;
      const failed = new Map<string, ModelFailure>();
      let text = "";
      let prefix = "";
      let toolsOff = false;
      let continuations = 0;

      const step = async (tools: boolean) => {
        const c = await llm.complete({
          models: io.models,
          messages,
          tools: tools && !toolsOff ? io.tools : [],
          signal: io.signal,
          onText: (s) => io.onText(prefix + s),
        });
        io.signal.throwIfAborted();
        model = c.model;
        effort = c.effort;
        for (const f of c.failed ?? []) if (!failed.has(f.model)) failed.set(f.model, f);
        usage.input += c.usage?.input ?? 0;
        usage.output += c.usage?.output ?? 0;
        if (c.usage?.input) usage.context = c.usage.input;
        push(c.message);
        if (c.message.content) text = prefix + c.message.content;
        return c;
      };

      for (let i = 0; i < MAX_STEPS; i++) {
        // The owner's words added while we work go in after the last tool results, before the next model call.
        for (const t of io.takeSteered?.() ?? [])
          push({ role: "user", content: `[The owner adds, while you work]\n${t}` });
        const c = await step(true);
        const calls = c.message.tool_calls ?? [];
        if (!calls.length) {
          // A cut answer is not a finished one: ask for the rest instead of presenting half of it.
          if (c.finish === "length" && continuations++ < MAX_CONTINUATIONS) {
            prefix = text;
            push(
              systemNote(
                "Your answer was cut off by the length limit. Continue exactly where it stopped, without repeating.",
              ),
            );
            continue;
          }
          return { text, model, effort, finish: c.finish, usage, failed: [...failed.values()] };
        }
        prefix = "";
        let stuck: string | undefined;
        for (const call of calls) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
          } catch {}
          const out = await io.execute(call.id, call.function.name, args);
          push({ role: "tool", tool_call_id: call.id, content: out.text });
          const sig = `${call.function.name}:${call.function.arguments}`;
          seen.set(sig, (seen.get(sig) ?? 0) + 1);
          if ((seen.get(sig) ?? 0) >= REPEAT_LIMIT) stuck = call.function.name;
        }
        // After all results: a note between a call and its results would break the pairing providers require.
        if (stuck && !toolsOff) {
          toolsOff = true;
          push(
            systemNote(
              `You called ${stuck} with the same arguments ${REPEAT_LIMIT} times. Stop calling tools and answer with what you have.`,
            ),
          );
        }
      }
      // Out of steps: one last call without tools so the owner gets an honest summary, never silence.
      push(
        systemNote(
          "You ran out of steps for this turn. Do not call tools. Tell the owner what you did and what is left.",
        ),
      );
      const c = await step(false);
      return { text, model, effort, finish: c.finish, usage, failed: [...failed.values()] };
    },
  };
}
