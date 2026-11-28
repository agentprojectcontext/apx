// Where Settings › Voice and calls says the greeting is being made again: next to the voice it is made with.
import type { VoiceStatus } from "@apx/protocol";

/** How calls speak and hear: APX's own voice, or the owner's services (where APX's voice can't run, always those). */
export const callEngine = (s: VoiceStatus): "native" | "services" =>
  s.call_engine ?? (s.tier === "none" ? "services" : "native");

/**
 * `voice`: beside APX's voice picker; `calls`: beside the call's services. Nothing while the greeting is ready or calls
 * are off.
 */
export function greetingNoteAt(s: VoiceStatus): "voice" | "calls" | undefined {
  if (s.greeting !== "preparing" || !s.calls) return undefined;
  return callEngine(s) === "native" && s.installed && s.enabled ? "voice" : "calls";
}
