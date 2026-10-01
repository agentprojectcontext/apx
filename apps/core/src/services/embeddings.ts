// Embedding dialects: turn texts into vectors so notes can be found by meaning. Ollama runs them on this machine
// (bge-m3, embeddinggemma…); Gemini and OpenAI-compatible APIs in the cloud.
import { errorMessage } from "../errors.ts";
import { joinUrl, type ServiceConfig, ServiceError } from "./types.ts";

type Fetch = typeof fetch;

/** An embedding call is short; a slow engine must not hold a turn (search falls back to words). */
export const EMBED_TIMEOUT_MS = 20_000;

async function postJson(f: Fetch, url: string, body: object, headers: Record<string, string>, signal: AbortSignal) {
  const res = await f(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as Record<string, unknown>;
}

async function ollama(s: ServiceConfig, texts: string[], _key: string | undefined, signal: AbortSignal, f: Fetch) {
  const j = await postJson(
    f,
    joinUrl(s.base_url, "/api/embed"),
    { model: s.model || "bge-m3", input: texts },
    {},
    signal,
  );
  return j.embeddings as number[][];
}

async function gemini(s: ServiceConfig, texts: string[], key: string | undefined, signal: AbortSignal, f: Fetch) {
  if (!key) throw new Error("needs a Gemini API key");
  const model = s.model || "gemini-embedding-001";
  // The key goes in a header, never in the URL (URLs end up in logs).
  const j = await postJson(
    f,
    joinUrl(s.base_url, `/v1beta/models/${encodeURIComponent(model)}:batchEmbedContents`),
    { requests: texts.map((t) => ({ model: `models/${model}`, content: { parts: [{ text: t }] } })) },
    { "x-goog-api-key": key },
    signal,
  );
  return (j.embeddings as Array<{ values: number[] }>).map((e) => e.values);
}

async function openai(s: ServiceConfig, texts: string[], key: string | undefined, signal: AbortSignal, f: Fetch) {
  const j = await postJson(
    f,
    joinUrl(s.base_url, "/v1/embeddings"),
    { model: s.model || "text-embedding-3-small", input: texts },
    key ? { authorization: `Bearer ${key}` } : {},
    signal,
  );
  return (j.data as Array<{ embedding: number[] }>).map((d) => d.embedding);
}

const DIALECTS = { "ollama-embed": ollama, "gemini-embed": gemini, "openai-embed": openai } as const;

export async function embed(
  s: ServiceConfig,
  texts: string[],
  key: string | undefined,
  signal: AbortSignal,
  f: Fetch = fetch,
): Promise<Float32Array[]> {
  const dialect = DIALECTS[s.dialect as keyof typeof DIALECTS];
  if (!dialect) throw new ServiceError(s.label, `not an embedding service (${s.dialect})`);
  try {
    const out = await dialect(s, texts, key, AbortSignal.any([signal, AbortSignal.timeout(EMBED_TIMEOUT_MS)]), f);
    if (!Array.isArray(out) || out.length !== texts.length) throw new Error("the engine returned a different count");
    return out.map((v) => Float32Array.from(v));
  } catch (err) {
    throw new ServiceError(s.label, errorMessage(err));
  }
}

export const EMBED_PROBE: Record<string, string> = {
  "ollama-embed": "/api/tags",
  "gemini-embed": "/v1beta/models",
  "openai-embed": "/v1/models",
};
