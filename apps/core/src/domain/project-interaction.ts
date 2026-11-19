import type { Store } from "./store.ts";

/** A protected project's work cannot be relayed through a teammate outside that project. */
export function canInteractAcrossProjects(
  store: Store,
  from: { id: string; thread_id: string },
  to: { id: string; thread_id: string },
) {
  const sender = store.agents.get(from.id);
  const recipient = store.agents.get(to.id);
  if (sender?.kind === "secretary" || recipient?.kind === "secretary") return true;
  const source = store.threads.get(from.thread_id)?.project_id ?? sender?.project_id;
  const destination = store.threads.get(to.thread_id)?.project_id ?? recipient?.project_id;
  return (
    source === destination ||
    !store.projectProtection.list().some((p) => p.project === source || p.project === destination)
  );
}
