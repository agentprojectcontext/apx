// Whether a service answers, why not when it does not, and the models it offers: what "Test connection" shows.
import type { ServiceTest } from "@apx/protocol";
import { joinUrl, type ServiceConfig } from "./types.ts";

type Fetch = typeof fetch;

/** How long the owner's own "Test connection" waits: a LAN server that drops packets says nothing at all. */
export const TEST_TIMEOUT_MS = 5000;

/** The headers a service reads its key from: Gemini its own, the rest a bearer token (or x-api-key). */
export function keyHeaders(s: Pick<ServiceConfig, "dialect">, key: string | undefined): Record<string, string> {
  if (!key) return {};
  return s.dialect.startsWith("gemini-")
    ? { "x-goog-api-key": key }
    : { authorization: `Bearer ${key}`, "x-api-key": key };
}

const EMBED_HINT = /embed|bge|e5|gte|minilm|nomic|arctic|mxbai/i;

/** The models in a listing (Ollama's tags, an OpenAI-compatible /models, Gemini's), embedding ones first. */
export function modelNames(s: Pick<ServiceConfig, "dialect" | "kind">, body: unknown): string[] | undefined {
  const b = body as {
    models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
    data?: Array<{ id?: string }>;
  };
  let names: string[] | undefined;
  if (s.dialect.startsWith("ollama")) names = b?.models?.map((m) => m.name?.replace(/:latest$/, "") ?? "");
  else if (s.dialect.startsWith("gemini-"))
    names = b?.models
      ?.filter((m) => s.kind !== "embedding" || m.supportedGenerationMethods?.includes("embedContent"))
      .map((m) => m.name?.replace(/^models\//, "") ?? "");
  else if (Array.isArray(b?.data)) names = b.data.map((m) => m.id ?? "");
  if (!names) return undefined;
  const clean = [...new Set(names.filter(Boolean))];
  return s.kind === "embedding"
    ? [...clean.filter((n) => EMBED_HINT.test(n)), ...clean.filter((n) => !EMBED_HINT.test(n))]
    : clean;
}

function failure(err: unknown): Pick<ServiceTest, "problem" | "detail"> {
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return { problem: "timeout" };
  const code = e?.cause?.code;
  if (code === "ECONNREFUSED") return { problem: "refused" };
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return { problem: "name" };
  if (code === "EHOSTUNREACH" || code === "ENETUNREACH" || code === "ETIMEDOUT") return { problem: "timeout" };
  // fetch's own "fetch failed" says nothing: its cause does.
  return { problem: "other", detail: String(code ?? e?.cause?.message ?? e?.message ?? err).slice(0, 200) };
}

/** Asks the service's listing path: answers, refuses the key, or cannot be reached (and why). */
export async function reach(
  s: ServiceConfig,
  path: string,
  key: string | undefined,
  f: Fetch = fetch,
  timeoutMs = TEST_TIMEOUT_MS,
): Promise<ServiceTest> {
  try {
    const res = await f(joinUrl(s.base_url, path), {
      headers: keyHeaders(s, key),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      await res.body?.cancel();
      return {
        ok: false,
        problem: res.status === 401 || res.status === 403 ? "key" : "http",
        detail: `HTTP ${res.status}`,
      };
    }
    const models = modelNames(s, await res.json().catch(() => undefined));
    return models ? { ok: true, models } : { ok: true };
  } catch (err) {
    return { ok: false, ...failure(err) };
  }
}
