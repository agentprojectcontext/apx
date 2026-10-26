// What the model received on a run's first call, kept for the owner's "what it received" view (runs.context).
import type { PromptPart } from "@apx/protocol";
import type { RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import type { ChatItem } from "../providers/types.ts";
import { modelSpec, type Tool, toSpec } from "../tools/types.ts";
import { type InputBlock, inputSizes } from "./context.ts";

const chars = (items: ChatItem[]) => items.reduce((n, m) => n + JSON.stringify(m).length, 0);

export function keepContext(
  store: Store,
  t: {
    run: RunRecord;
    system: { text: string; parts: PromptPart[] };
    input: ChatItem & { role: "user" };
    blocks: InputBlock[];
    tools: Tool[];
    history: ChatItem[];
  },
): void {
  const input = String(t.input.content ?? "");
  // A block list that does not spell this input (a resumed turn) is told as one message.
  const parts = inputSizes(t.blocks);
  const sizes =
    parts.reduce((n, p) => n + p.chars, 0) === input.length ? parts : [{ name: "message", chars: input.length }];
  store.runContexts.add({
    run_id: t.run.id,
    system: t.system.text,
    input,
    tools: t.tools.map((x) => x.name),
    sizes: {
      system: t.system.parts,
      input: sizes,
      tools: JSON.stringify(t.tools.map((x) => modelSpec(toSpec(x)))).length,
      history: { items: t.history.length, chars: chars(t.history) },
    },
  });
}
