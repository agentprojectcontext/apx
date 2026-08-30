// QVox: the local Qwen3-TTS voice server (Apple Silicon / MLX).
//
// Kept apart from the card that renders it so the rule can be tested on its
// own, and so anything else that needs to know whether a local voice is
// already set up asks in one place.

export const QVOX_REPO = "https://github.com/tecnomanu/qwen3-tts-api";

/** Port QVox listens on by default; the tell that a custom endpoint is one. */
export const QVOX_PORT_HINT = ":5111";

export type ProviderLike = { id: string; note?: string };

/**
 * Whether QVox is still missing. The card is shown either way — it is the
 * pointer to the project, not only an install prompt — but a machine that
 * already runs it must not be told to go and install it, so this decides
 * which half of the card to render.
 */
export function shouldSuggestQvox(engines: ProviderLike[]): boolean {
  return !engines.some(
    (e) => e.id === "custom:qvox" || (e.note || "").includes(QVOX_PORT_HINT)
  );
}
