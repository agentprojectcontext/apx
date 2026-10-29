// A chat opened from the Flow editor: each of the owner's turns there says which Flow it draws (DECISIONS.md#d-175).
import type { Store } from "../domain/store.ts";
import { inlineName } from "../tools/result.ts";

/** The `[flow editor]` line of the turn's input, while the chat is bound to an open editor; undefined otherwise. */
export function flowEditorBlock(store: Store, thread: string): string | undefined {
  const at = store.threads.context(thread).flow_editor;
  const project = at ? store.projects.get(at.project) : undefined;
  if (!at || !project) return undefined;
  const where = `the project "${inlineName(project.name)}" (id ${project.id})`;
  const flow = at.flow ? store.flows.get(at.flow) : undefined;
  if (!flow)
    return `The owner is starting a new flow in ${where} in the Flow editor; it isn't made yet. Make it there (apx_flow, flows.create): the editor opens it as soon as it exists.`;
  const version = store.flowGraphs.get(flow.id).draftVersion;
  return `The owner has the flow "${inlineName(flow.name)}" (id ${flow.id}) of ${where} open in the Flow editor${version === null ? "" : `, its draft at version ${version}`}, watching. Change its draft there (apx_flow): each save shows on their screen, and nothing runs until they save it in the editor.`;
}
