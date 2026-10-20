// The owner's memory settings: how notes are searched and how long chats are kept small. The auxiliary model keeps
// its own setting key ("model_aux", read by the upkeep).
import { type MemorySettings, MemorySettings as Schema } from "@apx/protocol";
import type { Store } from "./store.ts";

const DEFAULTS: MemorySettings = {
  mode: "notes",
  skill_picker: true,
  auto_compact: true,
  auto_recall: true,
  auto_capture: true,
  auto_dream: true,
  daily_memory_calls: 20,
};

export function memorySettings(store: Store): MemorySettings {
  const saved = store.settings.read("memory");
  const aux = store.settings.get("model_aux");
  const parsed = Schema.safeParse({ ...DEFAULTS, ...saved, ...(aux ? { aux_model: aux } : {}) });
  return parsed.success ? parsed.data : DEFAULTS;
}

export function saveMemorySettings(store: Store, s: MemorySettings): MemorySettings {
  const { aux_model, ...rest } = s;
  store.settings.write("memory", { ...store.settings.read("memory"), ...rest });
  store.settings.set("model_aux", aux_model ?? "");
  return memorySettings(store);
}

export const memoryGeneration = (store: Store) => Number(store.settings.get("memory_generation") ?? 0);
export const bumpMemoryGeneration = (store: Store) =>
  store.settings.set("memory_generation", String(memoryGeneration(store) + 1));
