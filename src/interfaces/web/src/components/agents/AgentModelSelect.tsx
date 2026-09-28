import { useMemo } from "react";
import { UiSelect } from "../UiSelect";
import { INHERIT_MODEL, isInheritedModel, splitModelId, useModelCatalog } from "./modelCatalog";
import { EffortChips, carryEffort, splitEffort, withEffort } from "./modelEffort";
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
//
// The reasoning effort is picked beside the model, not as a model of its own:
// the list holds bare ids and the chips under it set the `@effort` suffix (see
// ./modelEffort). Listing `chatgpt-codex:gpt-6-luna@high` as-is used to read
// as an unlisted model, and there was no way to set one from here at all.
export function AgentModelSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { providers } = useModelCatalog();
  const { base, effort } = splitEffort(isInheritedModel(value) ? "" : value);
  const selected = base || INHERIT_MODEL;
  const engineOf = (id: string) => {
    const slug = splitModelId(id).provider;
    return providers.find((p) => p.slug === slug)?.engine || slug;
  };

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
    <div className="flex flex-col gap-2">
      <UiSelect
        value={selected}
        onChange={(v) => onChange(isInheritedModel(v) ? v : carryEffort(v, effort, engineOf(v)))}
        options={options}
        placeholder={t("project.agent_detail.model_router_default")}
      />
      {base && <EffortChips engine={engineOf(base)} value={effort} onChange={(e) => onChange(withEffort(base, e))} />}
    </div>
  );
}
