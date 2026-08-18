import { useMemo } from "react";
import useSWR from "swr";
import { Admin } from "../../lib/api/admin";
import { Engines } from "../../lib/api/engines";
import { UiSelect } from "../UiSelect";
import { t } from "../../i18n";

// Model override for one agent, offered as a list instead of a free-text field.
//
// The options are built from the providers actually configured in this install
// (config.engines): for each active provider we offer its default model plus
// the curated known_models for its engine, emitted as the `<provider>:<model>`
// id the router parses. Empty = fall through to the router default.
//
// A value already stored that no longer matches a configured provider is kept
// as its own option, so opening the form never silently drops it.
export function AgentModelSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const cfg = useSWR("/api/admin/config", () => Admin.config.get());
  const presets = useSWR("/api/engines/presets", () => Engines.presets());

  const options = useMemo(() => {
    const engines = cfg.data?.config?.engines ?? {};
    const catalog = presets.data?.presets ?? {};
    const seen = new Set<string>();
    const out: { value: string; label: string; description?: string }[] = [
      { value: "", label: t("project.agent_detail.model_router_default") },
    ];
    for (const [slug, prov] of Object.entries(engines)) {
      if (prov?.is_active === false) continue;
      const engine = prov?.engine || slug;
      const models = [
        ...(prov?.default_model ? [prov.default_model] : []),
        ...(catalog[engine]?.known_models ?? []),
      ];
      for (const m of models) {
        const id = `${slug}:${m}`;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({
          value: id,
          label: id,
          description: prov?.default_model === m
            ? t("project.agent_detail.model_provider_default", { provider: prov?.name || slug })
            : (prov?.name || slug),
        });
      }
    }
    // Keep an unknown stored value selectable rather than dropping it.
    if (value && !seen.has(value)) out.push({ value, label: value, description: t("project.agent_detail.model_unlisted") });
    return out;
  }, [cfg.data, presets.data, value]);

  return (
    <UiSelect
      value={value}
      onChange={onChange}
      options={options}
      placeholder={t("project.agent_detail.model_router_default")}
    />
  );
}
