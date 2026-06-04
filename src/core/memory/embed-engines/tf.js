// Offline term-frequency fallback embedder. Deterministic, dependency-free,
// always available. NOT as good as a real embedding model, but it keeps the
// retriever working when no provider is reachable — the memory system must
// degrade gracefully, never throw into the daemon's request path. This is the
// guaranteed final link in the chain (the embeddings analogue of TTS "mock").

import { tfEmbed } from "../embeddings.js";

export default {
  id: "tf",

  async isAvailable() {
    return true;
  },

  async embed({ text }) {
    const vector = tfEmbed(text);
    return { vector, embedder: "tf", dim: vector.length };
  },
};
