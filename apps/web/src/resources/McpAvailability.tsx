import { Select } from "@apx/ui";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { useVariableNames } from "./useVariableNames.ts";

export function McpAvailability({
  value,
  onChange,
  values,
}: {
  value: string;
  onChange(value: string): void;
  values: string[];
}) {
  const t = useT();
  const projects = useData((s) => s.projects);
  const references = [
    ...new Set(values.flatMap((text) => [...text.matchAll(/secret:\/\/([a-zA-Z0-9_.-]+)/g)].map((m) => m[1] ?? ""))),
  ];
  const { names } = useVariableNames(references.length > 0, value === "global" ? undefined : value);
  const missing = names ? references.filter((name) => !names.includes(name)) : [];
  return (
    <div className="pform__field">
      <span className="pform__label">{t("res.mcpAvailable")}</span>
      <Select
        label={t("res.mcpAvailable")}
        value={value}
        onValueChange={(next) => next && onChange(next)}
        options={[
          { value: "global", label: t("res.mcpEverywhere") },
          ...projects.filter((p) => p.registered !== false).map((p) => ({ value: p.id, label: p.name })),
        ]}
      />
      {missing.length > 0 && (
        <p role="status" className="resd__note">
          {t("res.mcpMissingVariables", { names: missing.join(", ") })}
        </p>
      )}
    </div>
  );
}
