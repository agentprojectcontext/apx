// The model catalog: what each engine can run, asked to the engine itself (never a list in code).
// - providers (built-in harness): GET <base>/models (OpenAI-compatible) or /v1/models (Anthropic);
// - Claude Code: the Agent SDK's supportedModels();
// - Codex: `codex debug models`;
// - ACP agents (OpenCode, Qwen Code…): the models a fresh session offers.
// Results are cached in settings for a day; a refresh asks again.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { CatalogEngine as CatalogEngineSchema } from "@apx/protocol";
import type { ProviderConfig } from "../config.ts";
import type { Store } from "../domain/store.ts";
import { errorMessage } from "../errors.ts";
import { type AcpAgent, acpAgents, acpEngine, openSession } from "../harness/acp/agents.ts";
import { which } from "../harness/detect.ts";
import { harnessEnv } from "../harness/env.ts";
import { NO_KEY } from "../providers/llm.ts";
import type { Secrets } from "../secrets.ts";

const run = promisify(execFile);
const TTL_MS = 24 * 3600_000;

export type CatalogModel = { id: string; name: string; description?: string; chat: boolean };
export type CatalogEngine = {
  /** "claude", "codex", or a provider id ("gemini", "anthropic", …). */
  id: string;
  kind: "harness" | "provider";
  label: string;
  available: boolean;
  /** Why it is not available, or why the list may be stale. */
  detail?: string;
  models: CatalogModel[];
  fetched_at?: string;
};

/** An engine's last fetched model list, kept per engine (`catalog:<id>`); none when unset or unreadable. */
export function cachedCatalog(store: Store, id: string): CatalogEngine | undefined {
  const raw = store.settings.get(`catalog:${id}`);
  if (!raw) return undefined;
  try {
    const r = CatalogEngineSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : undefined;
  } catch {
    return undefined;
  }
}

// Ids that name non-chat models (speech, embeddings, images…); they stay listed but are not offered for agents.
const NOT_CHAT = /(embed|tts|audio|speech|transcri|whisper|image|imagen|veo|dall-e|moderation|aqa|realtime)/i;

async function providerModels(p: ProviderConfig, key: string, fetchImpl: typeof fetch): Promise<CatalogModel[]> {
  const base = p.base_url.replace(/\/$/, "");
  const res =
    p.transport === "anthropic-messages"
      ? await fetchImpl(`${base}/v1/models?limit=100`, {
          headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
          signal: AbortSignal.timeout(10_000),
        })
      : await fetchImpl(`${base}/models`, {
          headers: { authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(10_000),
        });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { data?: Array<{ id: string; display_name?: string }> };
  return (body.data ?? []).map((m) => {
    const id = m.id.replace(/^models\//, "");
    return { id, name: m.display_name ?? id, chat: !NOT_CHAT.test(id) };
  });
}

async function claudeModels(): Promise<CatalogModel[]> {
  const bin = await which("claude");
  if (!bin) throw new Error("not installed");
  const ac = new AbortController();
  // Streaming-input mode with no message: the session starts, answers the catalog question and is closed.
  const idle = (async function* () {
    await new Promise<void>((resolve) => ac.signal.addEventListener("abort", () => resolve(), { once: true }));
  })();
  const q = query({
    prompt: idle as AsyncIterable<never>,
    options: { abortController: ac, pathToClaudeCodeExecutable: bin, settingSources: [], env: harnessEnv() },
  });
  try {
    const list = await Promise.race([
      q.supportedModels(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 30_000)),
    ]);
    // `value` is what the SDK accepts (an alias like "default" or a model id); the resolved id goes in the description.
    return list.map((m) => ({
      id: m.value,
      name: m.displayName,
      ...(m.description || m.resolvedModel
        ? {
            description: [m.description, m.resolvedModel && m.resolvedModel !== m.value ? `→ ${m.resolvedModel}` : ""]
              .filter(Boolean)
              .join(" "),
          }
        : {}),
      chat: true,
    }));
  } finally {
    ac.abort();
  }
}

async function codexModels(): Promise<CatalogModel[]> {
  const bin = await which("codex");
  if (!bin) throw new Error("not installed");
  const { stdout } = await run(bin, ["debug", "models"], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
  const body = JSON.parse(stdout) as {
    models?: Array<{
      slug: string;
      display_name?: string;
      description?: string;
      visibility?: string;
      priority?: number;
    }>;
  };
  return (body.models ?? [])
    .filter((m) => m.visibility !== "hide")
    .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
    .map((m) => ({
      id: m.slug,
      name: m.display_name ?? m.slug,
      ...(m.description ? { description: m.description } : {}),
      chat: true,
    }));
}

/** Opens a session in an empty folder only to read the models it offers, then closes it. */
async function acpModels(agent: AcpAgent, home: string): Promise<CatalogModel[]> {
  const binary = await which(agent.command);
  if (!binary) throw new Error("not installed");
  const cwd = path.join(home, "work");
  fs.mkdirSync(cwd, { recursive: true });
  const s = await openSession(agent, { binary, cwd });
  try {
    return s.models.map((m) => ({ id: m.id, name: m.name, chat: true }));
  } finally {
    s.close();
  }
}

export type Catalog = ReturnType<typeof createCatalog>;

export function createCatalog(deps: {
  store: Store;
  secrets: Secrets;
  providers: () => ProviderConfig[];
  home: string;
  fetchImpl?: typeof fetch;
  /** Tests replace the CLI-backed lists. */
  harnessLists?: Partial<Record<"claude" | "codex", () => Promise<CatalogModel[]>>>;
  acpList?: (agent: AcpAgent) => Promise<CatalogModel[]>;
}) {
  const { store, secrets } = deps;
  const inflight = new Map<string, Promise<CatalogEngine>>();

  const cached = (id: string) => cachedCatalog(store, id);

  async function load(base: Omit<CatalogEngine, "models" | "available">, list: () => Promise<CatalogModel[]>) {
    try {
      const models = await list();
      const entry: CatalogEngine = { ...base, available: true, models, fetched_at: new Date().toISOString() };
      store.settings.set(`catalog:${base.id}`, JSON.stringify(entry));
      return entry;
    } catch (err) {
      const prev = cached(base.id);
      const why = errorMessage(err);
      // A failed refresh keeps the last good list, marked stale.
      return prev?.models.length
        ? { ...prev, detail: `could not refresh (${why}); showing the list from ${prev.fetched_at}` }
        : { ...base, available: false, detail: why, models: [] };
    }
  }

  function engines(): Array<{
    base: Omit<CatalogEngine, "models" | "available">;
    list: () => Promise<CatalogModel[]>;
  }> {
    const out: Array<{ base: Omit<CatalogEngine, "models" | "available">; list: () => Promise<CatalogModel[]> }> = [
      {
        base: { id: "claude", kind: "harness", label: "Claude Code" },
        list: deps.harnessLists?.claude ?? claudeModels,
      },
      { base: { id: "codex", kind: "harness", label: "Codex" }, list: deps.harnessLists?.codex ?? codexModels },
      ...acpAgents(store).map((a) => ({
        base: { id: acpEngine(a), kind: "harness" as const, label: a.label },
        list: () => (deps.acpList ? deps.acpList(a) : acpModels(a, deps.home)),
      })),
    ];
    for (const p of deps.providers()) {
      out.push({
        base: { id: p.id, kind: "provider", label: (p as { label?: string }).label || p.id },
        list: async () => {
          const key = p.key === NO_KEY ? "" : secrets.resolve(p.key);
          if (key === undefined || (key === "" && p.key !== NO_KEY)) throw new Error(`no key (${p.key})`);
          // A provider configured with an explicit list (e.g. a local gateway) is taken as given.
          if (p.models.length) return p.models.map((id) => ({ id, name: id, chat: true }));
          return providerModels(p, key, deps.fetchImpl ?? fetch);
        },
      });
    }
    return out;
  }

  return {
    /** Every engine with its models. Uses the cache unless `refresh` or the cache is older than a day. */
    async list(refresh = false): Promise<CatalogEngine[]> {
      return Promise.all(
        engines().map(({ base, list }) => {
          const hit = cached(base.id);
          const fresh = hit?.fetched_at && Date.now() - Date.parse(hit.fetched_at) < TTL_MS;
          if (!refresh && fresh && hit) return hit;
          const key = base.id;
          const running = inflight.get(key);
          if (running) return running;
          const p = load(base, list).finally(() => inflight.delete(key));
          inflight.set(key, p);
          return p;
        }),
      );
    },
  };
}
