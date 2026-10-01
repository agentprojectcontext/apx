// apx2 models / apx2 agents model: which models each engine offers, the install default, the router, and each
// agent's choice. Every value is data in the core; nothing here knows a model name.
import type { ModelChoice, RouterConfig } from "@apx/protocol";
import type { ApxClient } from "@apx/protocol/client";

const show = (c: ModelChoice) => (c.model ? `${c.model}${c.router ? " → router" : ""}` : "router");

/** "router" | "default" | "<engine>[/<model>]" (+ --router) → a choice; "default" → null. */
function parseChoice(arg: string | undefined, router: boolean): ModelChoice | null {
  if (!arg) throw new Error("say a model (<engine>/<model> or <engine>), router or default");
  if (arg === "default") return null;
  if (arg === "router") return { router: true };
  return { model: arg, router };
}

export async function models(client: ApxClient, [sub, ...args]: string[], o: { refresh?: boolean; router?: boolean }) {
  if (!sub || sub === "list") {
    const { engines } = await client.call("models.list", { refresh: o.refresh ?? false });
    for (const e of engines) {
      console.log(`${e.id} — ${e.label}${e.available ? "" : " (not available)"}${e.detail ? ` · ${e.detail}` : ""}`);
      for (const m of e.models.filter((x) => x.chat).slice(0, 40))
        console.log(`  ${e.id}/${m.id}${m.name !== m.id ? `  ${m.name}` : ""}`);
      const more = e.models.filter((x) => x.chat).length - 40;
      if (more > 0) console.log(`  … ${more} more`);
    }
    return;
  }
  const cfg = await client.call("models.config", {});
  if (sub === "config") {
    console.log(`default: ${show(cfg.default)}`);
    console.log(`router chain: ${cfg.router.chain.join(" → ") || "(empty)"}`);
    for (const r of cfg.router.rules)
      console.log(`  rule ${JSON.stringify(r.when)} → ${r.model}${r.note ? `  # ${r.note}` : ""}`);
    return;
  }
  if (sub === "default") {
    const choice = parseChoice(args[0], o.router ?? false) ?? { router: true };
    const out = await client.call("models.set_config", { default: choice });
    console.log(`default: ${show(out.default)}`);
    return;
  }
  if (sub === "chain") {
    if (!args.length) throw new Error("usage: apx2 models chain <ref> [<ref>…]");
    const router: RouterConfig = { ...cfg.router, chain: args };
    const out = await client.call("models.set_config", { router });
    console.log(`router chain: ${out.router.chain.join(" → ")}`);
    return;
  }
  if (sub === "rules") {
    // Rules are a JSON array on stdin: [{"when": {...}, "model": "<ref>"}].
    let raw = "";
    for await (const chunk of process.stdin) raw += String(chunk);
    const out = await client.call("models.set_config", { router: { ...cfg.router, rules: JSON.parse(raw) } });
    console.log(`${out.router.rules.length} rules`);
    return;
  }
  throw new Error(`unknown models command: ${sub}`);
}

export async function agentModel(client: ApxClient, [agent, ref]: string[], o: { router?: boolean }) {
  if (!agent) throw new Error("usage: apx2 agents model <agent> <ref|router|default> [--router]");
  const a = await client.call("agents.update", { agent, model_choice: parseChoice(ref, o.router ?? false) });
  console.log(`${a.name}: ${a.model_choice ? show(a.model_choice) : "install default"}`);
}
