// One-time data migration: notes the v1 import saved as the owner's are marked as brought over from v1. Remove it
// once no install imported with the older setup remains. See HISTORY.md#v1-imported-notes.
import path from "node:path";
import type { Store } from "../domain/store.ts";
import { v1AgentNotes } from "./v1-chats.ts";
import { v1Notes, v1Projects } from "./v1-data.ts";
import { globalNotes } from "./v1-setup.ts";

const DONE = "memory_v1_marked";
/** How an earlier setup prefixed the notes of a v1 project it had no v2 project for. */
const V1_PREFIX = "[v1 · ";

/** Every note text APX v1 has, as the setup's import saved it. */
function v1NoteTexts(home: string): Set<string> {
  const texts = new Set<string>();
  for (const { file } of globalNotes(home)) for (const text of v1Notes(file)) texts.add(text.slice(0, 2000));
  for (const p of v1Projects(home)) for (const text of v1Notes(path.join(p.storage, "memory.md"))) texts.add(text);
  for (const { file } of v1AgentNotes(home)) for (const text of v1Notes(file)) texts.add(text);
  return texts;
}

/** Runs once per install; `undefined` after that. Reads v1's files only, offline. */
export function markV1Notes(store: Store, v1Home: string): { marked: number } | undefined {
  if (store.settings.get(DONE)) return undefined;
  const texts = v1NoteTexts(v1Home);
  const marked = store.tx(() => {
    const n = store.memories.markImported(texts, V1_PREFIX);
    store.settings.set(DONE, new Date().toISOString());
    return n;
  });
  return { marked };
}
