// The owner's memory settings: how notes are searched and how long chats are kept small. The auxiliary model keeps
// its own setting key ("model_aux", read by the upkeep).
import { type MemorySettings, MemorySettings as Schema } from "@apx/protocol";
import type { Store } from "./store.ts";

const DEFAULTS: MemorySettings = { mode: "notes", auto_compact: true };

export function memorySettings(store: Store): MemorySettings {
  let saved: Partial<MemorySettings> = {};
  try {
    saved = JSON.parse(store.settings.get("memory") ?? "{}") as Partial<MemorySettings>;
  } catch {}
  const aux = store.settings.get("model_aux");
  const parsed = Schema.safeParse({ ...DEFAULTS, ...saved, ...(aux ? { aux_model: aux } : {}) });
  return parsed.success ? parsed.data : DEFAULTS;
}

export function saveMemorySettings(store: Store, s: MemorySettings): MemorySettings {
  const { aux_model, ...rest } = s;
  store.settings.set("memory", JSON.stringify(rest));
  store.settings.set("model_aux", aux_model ?? "");
  return memorySettings(store);
}
