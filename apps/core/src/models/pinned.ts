// The only model ids APX names in code: defaults for services that call one fixed model (voice, embeddings).
// Agent and router models are never named here; they come from each provider's own list (catalog.ts).
// Kept by hand: a provider retiring one of these ids needs a release. See rules/MODEL_CATALOGS.md.

export type PinnedModel = {
  /** The catalog engine whose list must still name it ("gemini", "openai"). */
  provider: string;
  id: string;
  use: "speech" | "transcription" | "embedding";
  /** Where the provider says when it retires. */
  source: string;
};

export const PINNED = {
  geminiSpeech: {
    provider: "gemini",
    id: "gemini-3.8-flash-tts",
    use: "speech",
    source: "https://ai.google.dev/gemini-api/docs/deprecations",
  },
  geminiEmbedding: {
    provider: "gemini",
    id: "gemini-embedding-001",
    use: "embedding",
    source: "https://ai.google.dev/gemini-api/docs/deprecations",
  },
  openaiSpeech: {
    provider: "openai",
    id: "tts-1",
    use: "speech",
    source: "https://platform.openai.com/docs/deprecations",
  },
  openaiTranscription: {
    provider: "openai",
    id: "whisper-1",
    use: "transcription",
    source: "https://platform.openai.com/docs/deprecations",
  },
  openaiEmbedding: {
    provider: "openai",
    id: "text-embedding-3-small",
    use: "embedding",
    source: "https://platform.openai.com/docs/deprecations",
  },
} as const satisfies Record<string, PinnedModel>;

/**
 * Pinned defaults a provider no longer lists. Only providers whose list was read count (`lists` by engine id): a
 * provider APX could not ask says nothing either way.
 */
export function missingPinned(
  lists: Readonly<Record<string, ReadonlyArray<{ id: string }> | undefined>>,
  pinned: ReadonlyArray<PinnedModel> = Object.values(PINNED),
): PinnedModel[] {
  return pinned.filter((p) => {
    const list = lists[p.provider];
    return list !== undefined && !list.some((m) => m.id === p.id);
  });
}
