// Memory by meaning on this machine: Ollama (when it runs here) has the embedding models; APX lists them, says which
// fits the machine and pulls it through Ollama's own API. Ollama itself is never installed by APX.
import os from "node:os";
import { errorMessage } from "../errors.ts";

/** Embedding models Ollama has in its library, with their download size, for the owner to choose. */
export const EMBED_MODELS = [
  { id: "bge-m3", mb: 1200, quality: "great" },
  { id: "embeddinggemma", mb: 620, quality: "good" },
  { id: "nomic-embed-text", mb: 274, quality: "basic" },
] as const;

/** Notes are written in any language: multilingual bge-m3 with memory to spare, the lighter embeddinggemma otherwise. */
export function recommendEmbedder(memoryGb = os.totalmem() / 2 ** 30): string {
  return memoryGb >= 16 ? "bge-m3" : "embeddinggemma";
}

/** Names that are embedding models, for an Ollama too old to say so itself. */
const EMBED_NAME = /(embed|bge|minilm|e5-|gte-|arctic|nomic)/i;

export type OllamaState = {
  url: string;
  running: boolean;
  version?: string;
  /** Embedding models already pulled (Ollama's names, "bge-m3:latest"). */
  models: Array<{ name: string; mb: number }>;
};
export type Pull = { model: string; completed: number; total: number; error?: string };

const TIMEOUT_MS = 3000;

export function createLocalEmbeddings(deps: {
  url: string;
  fetchImpl?: typeof fetch;
  /** A pulled model is ready: set the embedding service up with it. */
  onReady: (model: string) => void;
}) {
  const f = deps.fetchImpl ?? fetch;
  const base = deps.url.replace(/\/$/, "");
  let pull: Pull | undefined;

  const json = async (path: string, body?: object) => {
    const res = await f(`${base}${path}`, {
      method: body ? "POST" : "GET",
      ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  };

  /** Whether a pulled model embeds: Ollama's own word when it has one, else its name. */
  async function embeds(name: string): Promise<boolean> {
    const caps = await json("/api/show", { model: name })
      .then((r) => r.capabilities)
      .catch(() => undefined);
    return Array.isArray(caps) ? caps.includes("embedding") : EMBED_NAME.test(name);
  }

  async function state(): Promise<OllamaState> {
    try {
      const version = await json("/api/version").then((r) => (typeof r.version === "string" ? r.version : undefined));
      const listed = ((await json("/api/tags")).models ?? []) as Array<{ name?: string; size?: number }>;
      const named = listed.filter((m): m is { name: string; size?: number } => typeof m.name === "string");
      const kept = await Promise.all(named.map(async (m) => ((await embeds(m.name)) ? m : undefined)));
      return {
        url: base,
        running: true,
        ...(version ? { version } : {}),
        models: kept
          .filter((m) => m !== undefined)
          .map((m) => ({ name: m.name, mb: Math.round((m.size ?? 0) / 2 ** 20) })),
      };
    } catch {
      return { url: base, running: false, models: [] };
    }
  }

  /** Streams Ollama's pull, keeping its progress; once it is done the model is set up. */
  async function pullNow(model: string): Promise<void> {
    try {
      const res = await f(`${base}/api/pull`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, stream: true }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let rest = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        rest += value;
        const lines = rest.split("\n");
        rest = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const r = JSON.parse(line) as { status?: string; completed?: number; total?: number; error?: string };
          if (r.error) throw new Error(r.error);
          if (typeof r.total === "number") pull = { model, total: r.total, completed: r.completed ?? 0 };
        }
      }
      pull = undefined;
      deps.onReady(model);
    } catch (err) {
      pull = { model, completed: pull?.completed ?? 0, total: pull?.total ?? 0, error: errorMessage(err, 300) };
    }
  }

  return {
    state,
    progress: (): Pull | undefined => pull,
    /** Sets a pulled model up at once; otherwise pulls it in the background (one at a time). */
    async install(model: string): Promise<void> {
      const have = (await state()).models.some((m) => m.name === model || m.name === `${model}:latest`);
      if (have) return deps.onReady(model);
      if (pull && !pull.error) throw new Error(`already pulling ${pull.model}`);
      pull = { model, completed: 0, total: 0 };
      void pullNow(model);
    },
  };
}

export type LocalEmbeddings = ReturnType<typeof createLocalEmbeddings>;
