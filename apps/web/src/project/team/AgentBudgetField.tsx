import type { AgentBudget } from "@apx/protocol";
import { Input } from "@apx/ui";
import { useEffect, useState } from "react";
import { client } from "../../data/client.ts";
import { useT } from "../../i18n/index.ts";

type Key = keyof AgentBudget;
/** Tokens are typed in thousands, as in Settings › Agents. */
const SCALE: Record<Key, number> = { runs: 1, tokens: 1000 };
const MAX: Record<Key, number> = { runs: 10_000, tokens: 1_000_000 };

/**
 * One agent's own budget of turns and tokens without the owner, inside the chat's limits: past it this agent waits
 * while the others go on. Empty fields: none of its own.
 */
export function AgentBudgetField({ agentId }: { agentId: string }) {
  const t = useT();
  const [budget, setBudget] = useState<AgentBudget>();
  const [draft, setDraft] = useState<Partial<Record<Key, string>>>({});
  useEffect(() => {
    let live = true;
    void client
      .call("agents.limits", {})
      .then((r) => live && setBudget(r.agents[agentId] ?? {}))
      .catch(() => live && setBudget(undefined));
    return () => {
      live = false;
    };
  }, [agentId]);
  if (!budget) return null;
  const field = (key: Key) => {
    const own = budget[key];
    const shown = draft[key] ?? (own ? String(Math.round(own / SCALE[key])) : "");
    const commit = () => {
      const typed = draft[key];
      setDraft((d) => ({ ...d, [key]: undefined }));
      if (typed === undefined) return;
      const n = Math.round(Number(typed) || 0);
      const next = { ...budget, [key]: n > 0 ? Math.min(MAX[key], n) * SCALE[key] : 0 };
      setBudget(next);
      void client
        .call("agents.set_agent_limits", { agent: agentId, limits: next.runs || next.tokens ? next : null })
        .then((r) => setBudget(r.agents[agentId] ?? {}))
        .catch(() => setBudget(budget));
    };
    return (
      <span className="tgquiet__word teambudget__field">
        <Input
          aria-label={t(`team.budget.${key}`)}
          type="number"
          min={0}
          max={MAX[key]}
          className="nudge__num"
          placeholder={t("limits.none")}
          value={shown}
          onChange={(e) => {
            const typed = e.currentTarget.value;
            setDraft((d) => ({ ...d, [key]: typed }));
          }}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
        />
        {t(`team.budget.${key}Unit`)}
      </span>
    );
  };
  return (
    <div className="teambudget" title={t("team.budget.hint")}>
      {field("runs")}
      {field("tokens")}
    </div>
  );
}
