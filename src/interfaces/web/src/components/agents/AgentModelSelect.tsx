import { useMemo } from "react";
import { UiSelect } from "../UiSelect";
import { INHERIT_MODEL, isInheritedModel, useModelCatalog } from "./modelCatalog";
import { t } from "../../i18n";

// Model override for one agent, offered as a list instead of a free-text field.
//
// The options are built from the providers actually configured in this install
// (config.engines): for each active provider we offer its default model plus
// the curated known_models for its engine, emitted as the `<provider>:<model>`
// id the router parses.
//
// The first option is `inherit` — the stored marker for "no override". An
// agent file with no `Model:` at all selects it too, so the empty and the
// explicit form read the same in the form.
//
// A value already stored that no longer matches a configured provider is kept
// as its own option, so opening the form never silently drops it.
export function AgentModelSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { providers } = useModelCatalog();
  const selected = isInheritedModel(value) ? INHERIT_MODEL : value;

  const options = useMemo(() => {
    const seen = new Set<string>();
    const out: { value: string; label: string; description?: string }[] = [
      { value: INHERIT_MODEL, label: t("project.agent_detail.model_router_default") },
    ];
    for (const prov of providers) {
      for (const m of prov.models) {
        const id = `${prov.slug}:${m}`;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({
          value: id,
          label: id,
          description: prov.defaultModel === m
            ? t("project.agent_detail.model_provider_default", { provider: prov.name })
            : prov.name,
        });
      }
    }
    // Keep an unknown stored value selectable rather than dropping it.
    if (selected !== INHERIT_MODEL && !seen.has(selected)) {
      out.push({ value: selected, label: selected, description: t("project.agent_detail.model_unlisted") });
    }
    return out;
  }, [providers, selected]);

  return (
    <UiSelect
      value={selected}
      onChange={onChange}
      options={options}
      placeholder={t("project.agent_detail.model_router_default")}
    />
  );
}
