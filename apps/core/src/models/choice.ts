// Which model runs a turn. An agent's choice (or the install default) gives a model, the router, or both; the
// router adds its first matching rule and its fallback chain. The result is an ordered list of model refs the turn
// tries until one engine answers. Nothing here names a model: they all come from settings.
import type { ModelChoice, ModelRef, RouterConfig, RouterRule } from "@apx/protocol";
import type { AgentRecord } from "../domain/agents.ts";
import type { Store } from "../domain/store.ts";

export type TurnFeatures = {
  text: string;
  context_chars: number;
  has_image: boolean;
  channel: string;
  trigger: string;
  agent_kind: AgentRecord["kind"];
};

const EMPTY_ROUTER: RouterConfig = { rules: [], chain: [] };

export function modelSettings(store: Store) {
  return {
    /** The install default. Before one was saved, the engine picked in Config → Motores, with the router behind it. */
    defaultChoice(): ModelChoice {
      const raw = store.settings.get("model_default");
      if (raw) return JSON.parse(raw) as ModelChoice;
      const legacy = store.settings.get("default_harness");
      return legacy && legacy !== "native" ? { model: legacy, router: true } : { router: true };
    },
    router(): RouterConfig {
      const raw = store.settings.get("model_router");
      return raw ? (JSON.parse(raw) as RouterConfig) : EMPTY_ROUTER;
    },
    save(p: { default?: ModelChoice | undefined; router?: RouterConfig | undefined }): void {
      if (p.default) store.settings.set("model_default", JSON.stringify(p.default));
      if (p.router) store.settings.set("model_router", JSON.stringify(p.router));
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
