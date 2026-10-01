import type { Agent } from "@apx/protocol";
import { agentChoiceLabel, setAgentModelChoice, useModels } from "../../data/models.ts";
import { useT } from "../../i18n/index.ts";
import { ModelChoicePicker } from "./ModelPickers.tsx";

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
      inherit={agentChoiceLabel(undefined, config, catalog)}
      className={chip ? `chip chip--mono chipbtn${own ? " is-own" : ""}` : undefined}
      onChange={(choice) => void setAgentModelChoice(agent.id, choice)}
    />
  );
}
