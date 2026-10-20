// One-time cleanup of notes the first automatic capture saved without its durability check. A data migration:
// remove it once no install older than that check remains. See HISTORY.md#memory-capture-cleanup.
import { durableMemory, factSupported } from "./memory-content.ts";
import type { Store } from "./store.ts";

const DONE = "memory_capture_cleanup";
/** The history reason; the panel shows it as "Retired by capture cleanup". */
export const CAPTURE_CLEANUP_REASON = "capture-cleanup";

/**
 * Retires each untouched captured note whose evidence today's capture would refuse (a request, a question, a
 * passing remark) or no longer supports. Deterministic and offline; runs once per install, `undefined` after that.
 */
export function cleanUpCapturedNotes(store: Store): { retired: number; kept: number } | undefined {
  if (store.settings.get(DONE)) return undefined;
  let retired = 0;
  let kept = 0;
  store.tx(() => {
    for (const note of store.memories.untouchedCaptures()) {
      const quote = (note.evidence ?? []).map((e) => e.quote).join("\n");
      if (durableMemory(quote) && factSupported(note.text, quote)) kept++;
      else if (store.memories.retireCapture({ id: note.id, revision: note.revision ?? 1 }, CAPTURE_CLEANUP_REASON))
        retired++;
    }
    store.settings.set(DONE, new Date().toISOString());
  });
  return { retired, kept };
}
