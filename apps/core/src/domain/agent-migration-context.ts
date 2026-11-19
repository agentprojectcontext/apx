import type { ThreadContext } from "./threads.ts";

/** Keep local preferences and provenance, not the old team's routing, compacted prompt or grants. */
export function migrationContext(old: ThreadContext): ThreadContext {
  const {
    model_choice,
    voice_replies,
    titled,
    worker,
    memory_family,
    memory_cutoff,
    imported,
    digest,
    close_reported,
    owner_unread,
    progress_at,
    documents_checked,
    commit_checked,
  } = old;
  return {
    model_choice,
    voice_replies,
    titled,
    worker,
    memory_family,
    memory_cutoff,
    imported,
    digest,
    close_reported,
    owner_unread,
    progress_at,
    documents_checked,
    commit_checked,
  };
}
