import { type Agent, MAX_MODEL_FALLBACKS, type ModelChoice } from "@apx/protocol";
import { agentChoiceLabel, setAgentModelChoice, useModels } from "../../data/models.ts";
import { useT } from "../../i18n/index.ts";
import { ModelChoicePicker } from "./ModelPickers.tsx";
import { ModelRefList } from "./ModelRefList.tsx";

/** An agent's model choice, labelled with its effective choice; "Install default" clears it (model_choice: null). */
export function AgentModelPicker({ agent, chip = false }: { agent: Agent; chip?: boolean }) {
  const t = useT();
  const config = useModels((s) => s.config);
  const catalog = useModels((s) => s.catalog);
  const own = Boolean(agent.model_choice);
  return (
    <ModelChoicePicker
      label={t("agents.modelOf", { name: agent.name })}
      value={agent.model_choice ?? null}
      text={agentChoiceLabel(agent.model_choice, config, catalog)}
      className={chip ? `chip chip--mono chipbtn${own ? " is-own" : ""}` : undefined}
      onChange={(choice) => void setAgentModelChoice(agent.id, keepFallbacks(choice, agent.model_choice))}
    />
  );
}

/** A new main model keeps the fallbacks behind it (less itself); the router alone or the default has none. */
function keepFallbacks(next: ModelChoice | null, cur: ModelChoice | undefined): ModelChoice | null {
  const fallbacks = cur?.fallbacks?.filter((r) => r !== next?.model);
  return next?.model && fallbacks?.length ? { ...next, fallbacks } : next;
}

/** The models an agent with a model of its own goes on with, in order, when that one is at its limit or fails. */
export function AgentFallbacks({ agent }: { agent: Agent }) {
  const t = useT();
  const choice = agent.model_choice;
  if (!choice?.model) return null;
  const main = choice.model;
  return (
    <div className="agentfallbacks">
      <ModelRefList
        refs={choice.fallbacks ?? []}
        taken={[main]}
        max={MAX_MODEL_FALLBACKS}
        addLabel={t("agentedit.addFallback")}
        removeLabel={t("agentedit.removeFallback")}
        onChange={(fallbacks) => void setAgentModelChoice(agent.id, { ...choice, fallbacks })}
      />
    </div>
  );
}
