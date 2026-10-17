// v1's model engines (config.json `engines`) as v2's: model APIs become providers with their key in the secret store
// (v2's built-in gemini, anthropic and openai just get theirs), Ollama a keyless local one, and the ChatGPT plan v2's
// built-in `chatgpt`. v1's main model and its fallback chain become the install default and the router's chain.
// v1's folder is only read.
import path from "node:path";
import { ModelRef, type RouterConfig } from "@apx/protocol";
import { harnessOf } from "../domain/refs.ts";
import type { Store } from "../domain/store.ts";
import { modelSettings } from "../models/choice.ts";
import { NO_KEY } from "../providers/llm.ts";
import type { ProviderEntry, ProviderRegistry } from "../providers/registry.ts";
import type { Secrets } from "../secrets.ts";
import { jsonFile } from "./v1-data.ts";

type V1Engine = {
  engine?: unknown;
  api_key?: unknown;
  api_keys?: unknown;
  base_url?: unknown;
  label?: unknown;
  is_active?: unknown;
};

/** What v2 makes of one v1 engine: a model API, or the ChatGPT plan (v2's built-in `chatgpt`, signed in from APX). */
type Plan =
  | { slug: string; kind: "plan"; id: "chatgpt" }
  | { slug: string; kind: "provider"; id: string; entry: Omit<ProviderEntry, "id">; key?: string | undefined };

/** v1 adapters that speak OpenAI's chat API, with v1's own default address for each. */
const OPENAI_COMPAT: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  cerebras: "https://api.cerebras.ai/v1",
  zen: "https://opencode.ai/zen/v1",
  ollama: "http://127.0.0.1:11434",
  custom: "",
};
/**
 * v1's ChatGPT plan engine. Its Claude plan has no v2 counterpart: the Claude subscription runs only in Claude Code,
 * an external session (DECISIONS.md#d-043).
 */
const CHATGPT_PLAN = "codex-plus";
const CLAUDE_PLAN = "claude-subscription";
/** The panel's preset for each v1 adapter (the provider card's look). */
const PRESET: Record<string, string> = { zen: "opencode-zen" };
const LABEL: Record<string, string> = {
  zen: "OpenCode Zen",
  groq: "Groq",
  openrouter: "OpenRouter",
  cerebras: "Cerebras",
  ollama: "Ollama",
};
/** Zen answers without an account on v1's built-in public key. */
const ZEN_PUBLIC_KEY = "public";
const EFFORTS = new Set(["minimal", "low", "medium", "high", "xhigh", "max"]);
const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
/** Engine ids v2 keeps for itself: a provider of that name could not be addressed. */
const RESERVED = new Set(["claude", "codex", "native", "acp", "aider", "antigravity"]);

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

function readConfig(home: string): Record<string, unknown> {
  try {
    const v = jsonFile(path.join(home, "config.json"));
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function keyOf(e: V1Engine): string | undefined {
  const many = Array.isArray(e.api_keys) ? e.api_keys.map(str).find(Boolean) : undefined;
  return str(e.api_key) ?? many;
}

/** What v2 can take of one v1 engine, or undefined when it lacks what it needs (a key, an address). */
function planOne(slug: string, e: V1Engine): Plan | undefined {
  const adapter = (str(e.engine) ?? slug).toLowerCase();
  if (adapter === CHATGPT_PLAN) return { slug, kind: "plan", id: "chatgpt" };
  if (adapter === CLAUDE_PLAN) return undefined;
  const id = slug.toLowerCase().replaceAll("_", "-");
  if (!ID.test(id) || RESERVED.has(id)) return undefined;
  const key = keyOf(e);
  const anthropic = adapter === "anthropic";
  if (!anthropic && !(adapter in OPENAI_COMPAT)) return undefined;
  let base = (str(e.base_url) ?? (anthropic ? "https://api.anthropic.com" : OPENAI_COMPAT[adapter]) ?? "").replace(
    /\/+$/,
    "",
  );
  if (!/^https?:\/\//.test(base)) return undefined;
  // v1 called Ollama's own API; v2 talks to its OpenAI-compatible one.
  if (adapter === "ollama" && !base.endsWith("/v1")) base = `${base}/v1`;
  const keyless = adapter === "ollama";
  const secret = keyless ? undefined : (key ?? (adapter === "zen" ? ZEN_PUBLIC_KEY : undefined));
  if (!keyless && !secret) return undefined;
  return {
    slug,
    kind: "provider",
    id,
    key: secret,
    entry: {
      transport: anthropic ? "anthropic-messages" : "openai-chat",
      base_url: base,
      key: keyless ? NO_KEY : `secret://${id}`,
      models: [],
      label: str(e.label) ?? LABEL[adapter] ?? slug,
      preset: PRESET[adapter] ?? (adapter === "custom" ? "custom" : adapter),
      enabled: e.is_active !== false,
    },
  };
}

function plans(config: Record<string, unknown>): Plan[] {
  const engines = config.engines;
  if (!engines || typeof engines !== "object") return [];
  const out: Plan[] = [];
  for (const [slug, e] of Object.entries(engines as Record<string, unknown>)) {
    if (!e || typeof e !== "object") continue;
    const p = planOne(slug, e as V1Engine);
    if (p) out.push(p);
  }
  return out;
}

/** How many of v1's engines v2 can take. */
export const v1EngineCount = (home: string): number => plans(readConfig(home)).length;

/**
 * A v1 model ref ("ollama:gemma4:31b-cloud", "chatgpt-codex:gpt-x@high", "claude-haiku-4-5") as v2's, through
 * `engines` (v1 slug → v2 engine id); undefined for an engine v2 does not have.
 */
export function v1Ref(ref: string, engines: ReadonlyMap<string, string>): string | undefined {
  const s = ref.trim();
  const i = s.indexOf(":");
  let slug: string;
  let model: string;
  if (i > 0) {
    slug = s.slice(0, i).toLowerCase();
    model = s.slice(i + 1);
  } else {
    // v1 read a bare model name by its family.
    slug = /^claude/i.test(s)
      ? "anthropic"
      : /^(gpt|o1|o3|o4)/i.test(s)
        ? "openai"
        : /^gemini/i.test(s)
          ? "gemini"
          : "";
    model = s;
  }
  const engine = engines.get(slug);
  if (!engine) return undefined;
  const at = model.lastIndexOf("@");
  const effort = at > 0 && EFFORTS.has(model.slice(at + 1).toLowerCase()) ? model.slice(at + 1).toLowerCase() : "";
  if (effort) model = model.slice(0, at);
  // Our own loop cannot run a provider without a model; of v1's engines only the ChatGPT plan takes an effort.
  if (!model) return undefined;
  const out = `${engine}/${model}${effort && engine === "chatgpt" ? `#${effort}` : ""}`;
  return ModelRef.safeParse(out).success ? out : undefined;
}

export type EngineImportDeps = {
  store: Store;
  secrets: Pick<Secrets, "set" | "listed">;
  providers: Pick<ProviderRegistry, "all" | "set">;
};

/**
 * Brings v1's engines in and makes its main model and fallback chain v2's default and router chain. A provider v2
 * already has (same id) and a key it already holds stay as they are, so a second import changes nothing. Returns how
 * many engines are now usable from v1's list.
 */
export function importV1Engines(deps: EngineImportDeps, home: string): number {
  const config = readConfig(home);
  /** v1 slug → v2 engine id, for the ones v2 can run now. */
  const usable = new Map<string, string>();
  for (const p of plans(config)) {
    if (p.kind === "plan") {
      usable.set(p.slug.toLowerCase(), p.id);
      continue;
    }
    const have = deps.providers.all().find((x) => x.id === p.id);
    // A built-in (gemini, anthropic, openai) or one added before only gets the key it still lacks.
    const own = `secret://${p.id}`;
    if (p.key && (!have || have.key === own) && !deps.secrets.listed(p.id)) deps.secrets.set(p.id, p.key);
    if (!have) deps.providers.set(p.id, p.entry);
    // A switched-off provider cannot be in the chain: the router would refuse it.
    if ((have ?? p.entry).enabled !== false) usable.set(p.slug.toLowerCase(), p.id);
  }
  saveChain(deps.store, config, usable);
  saveOwnModel(deps.store, config, usable);
  saveAuxModel(deps.store, config, usable);
  return usable.size;
}

/**
 * v1's compaction model, its fallback and (as v1 always ended there) the main model become v2's auxiliary model chain,
 * only with engines v2 now has and never a CLI harness (an auxiliary call is one prompt, not an agent turn). With none
 * named, v2's own default (the agent's API models) is kept; one the owner already set in v2 stays.
 */
function saveAuxModel(store: Store, config: Record<string, unknown>, usable: ReadonlyMap<string, string>): void {
  if (store.settings.get("model_aux")) return;
  const mem = (config.memory ?? {}) as { compact_model?: unknown; compact_fallback_model?: unknown };
  const sa = (config.super_agent ?? {}) as { model?: unknown };
  const api = (r: string | undefined) => {
    const ref = r ? v1Ref(r, usable) : undefined;
    return ref && harnessOf(ref) === "native" ? ref : undefined;
  };
  const own = [api(str(mem.compact_model)), api(str(mem.compact_fallback_model))];
  if (!own.some(Boolean)) return;
  const refs = [...new Set([...own, api(str(sa.model))].filter((r): r is string => Boolean(r)))];
  store.settings.set("model_aux", refs.join(","));
}

/** v1's main model first, then its fallbacks (when on), as v2's default and router chain. */
function saveChain(store: Store, config: Record<string, unknown>, usable: ReadonlyMap<string, string>): void {
  const sa = (config.super_agent ?? {}) as {
    model?: unknown;
    model_fallback?: { enabled?: unknown; models?: unknown };
  };
  const fb = sa.model_fallback;
  const refs = [str(sa.model), ...(fb?.enabled !== false && Array.isArray(fb?.models) ? fb.models.map(str) : [])]
    .filter((r): r is string => Boolean(r))
    .map((r) => v1Ref(r, usable))
    .filter((r): r is string => Boolean(r));
  const [first, ...rest] = [...new Set(refs)];
  if (!first) return;
  const models = modelSettings(store);
  const router: RouterConfig = { ...models.router(), chain: rest };
  models.save({ default: { model: first, router: rest.length > 0 }, router });
}

/** v1's own model for the super-agent (self_model) becomes its model choice, on the router when v1 fell back. */
function saveOwnModel(store: Store, config: Record<string, unknown>, usable: ReadonlyMap<string, string>): void {
  const sa = (config.super_agent ?? {}) as { self_model?: unknown; self_model_fallback?: unknown };
  const raw = str(sa.self_model);
  const model = raw ? v1Ref(raw, usable) : undefined;
  const id = store.agents.list().find((a) => a.kind === "secretary")?.id;
  const boss = id ? store.agents.get(id) : undefined;
  // One the owner already chose in v2 stays.
  if (!model || !boss || boss.model_choice) return;
  const { harness: _h, ...rest } = boss;
  store.agents.upsert({ ...rest, model_choice: { model, router: sa.self_model_fallback !== false } });
}
