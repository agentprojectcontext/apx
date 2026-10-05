// Which model runs a turn. An agent's choice (or the install default) gives a model, the router, or both; the
// router adds its first matching rule and its fallback chain. The result is an ordered list of model refs the turn
// tries until one engine answers. Nothing here names a model: they all come from settings.
import type { ModelChoice, ModelRef, RouterConfig, RouterRule } from "@apx/protocol";
import type { AgentRecord } from "../domain/agents.ts";
import { type EngineIds, isCliRef, parseRef } from "../domain/refs.ts";
import type { Store } from "../domain/store.ts";

export type TurnFeatures = {
  text: string;
  context_chars: number;
  has_image: boolean;
  channel: string;
  trigger: string;
  agent_kind: AgentRecord["kind"];
};

export function modelSettings(store: Store) {
  return {
    /** The install default. Before one was saved, the engine picked in Settings → Engines and models, with the router behind it. */
    defaultChoice(): ModelChoice {
      const saved = store.settings.read("model_default");
      // A CLI saved before D-043 is not a default any more: the router decides.
      if (saved) return saved.model && isCliRef(saved.model) ? { router: true } : saved;
      return { router: true };
    },
    /** The router as saved, without the CLIs an older APX let it name (they run only in their own sessions). */
    router(): RouterConfig {
      const r = store.settings.read("model_router");
      return { rules: r.rules.filter((x) => !isCliRef(x.model)), chain: r.chain.filter((x) => !isCliRef(x)) };
    },
    save(p: { default?: ModelChoice | undefined; router?: RouterConfig | undefined }): void {
      if (p.default) store.settings.write("model_default", p.default);
      if (p.router) store.settings.write("model_router", p.router);
    },
  };
}

export function ruleMatches(rule: RouterRule, f: TurnFeatures): boolean {
  const w = rule.when;
  if (w.has_image !== undefined && w.has_image !== f.has_image) return false;
  if (w.min_chars !== undefined && f.text.length < w.min_chars) return false;
  if (w.max_chars !== undefined && f.text.length > w.max_chars) return false;
  if (w.min_context_chars !== undefined && f.context_chars < w.min_context_chars) return false;
  if (w.channels?.length && !w.channels.includes(f.channel)) return false;
  if (w.triggers?.length && !w.triggers.includes(f.trigger)) return false;
  if (w.agent_kinds?.length && !w.agent_kinds.includes(f.agent_kind)) return false;
  if (w.keywords?.length) {
    const low = f.text.toLowerCase();
    if (!w.keywords.some((k) => low.includes(k.toLowerCase()))) return false;
  }
  return true;
}

/** The models to try for this turn, in order, without repeats. */
export function candidates(choice: ModelChoice, router: RouterConfig, f: TurnFeatures): ModelRef[] {
  const out: ModelRef[] = [];
  if (choice.model) out.push(choice.model);
  if (choice.router || !choice.model) {
    const rule = router.rules.find((r) => ruleMatches(r, f));
    if (rule) out.push(rule.model);
    out.push(...router.chain);
  }
  return [...new Set(out)];
}

/**
 * Why a ref cannot run, or undefined when it can: the engine must exist, and a provider needs the model named
 * (only the CLIs have a default model of their own). A CLI runs only in its own sessions, and a session (`session`,
 * the CLI it belongs to) runs nothing else.
 */
export function refProblem(ref: string, engines: EngineIds, session?: string): string | undefined {
  const { engine, model } = parseRef(ref);
  if (session) return engine === session ? undefined : `this chat is a ${session} session: it runs ${session} only`;
  if (engines.harness.has(engine))
    return `${engine} runs only in its own sessions (Sessions › ${engine}); agents and the router use model APIs`;
  if (!engines.providers.has(engine)) return `unknown engine "${engine}" in ${ref}`;
  if (!model) return `say which ${engine} model (${engine}/<model>)`;
  return undefined;
}
