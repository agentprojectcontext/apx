import type { CatalogEngine, ModelRef } from "@apx/protocol";
import { Select, type SelectOption } from "@apx/ui";
import { baseRef, effortLabel, modelOf, splitRef, useModels, withEffort } from "../../data/models.ts";
import { useT } from "../../i18n/index.ts";

/** The models one chain entry can be: its engine's own default, then each chat model the engine offers. */
export function modelOptions(
  ref: ModelRef,
  catalog: readonly CatalogEngine[],
  ownDefault: (engine: string) => string,
): SelectOption[] {
  const { engine } = splitRef(ref);
  const base = baseRef(ref);
  const e = catalog.find((x) => x.id === engine);
  const options: SelectOption[] = [
    { value: engine, label: ownDefault(e?.label ?? engine) },
    ...(e?.models ?? [])
      .filter((m) => m.chat)
      .map((m) => ({ value: `${engine}/${m.id}`, label: m.name, ...(m.name !== m.id ? { hint: m.id } : {}) })),
  ];
  // A model the catalog does not list (yet) stays choosable as it is.
  return options.some((o) => o.value === base) ? options : [...options, { value: base, label: base }];
}

/**
 * One entry of a model chain: which of its engine's models, and (when that model takes it) how hard it reasons.
 * The effort travels in the ref ("codex/gpt-6-sol#high").
 */
export function RefSelect({ value, onChange }: { value: ModelRef; onChange(ref: ModelRef): void }) {
  const t = useT();
  const catalog = useModels((s) => s.catalog);
  const model = modelOf(value, catalog);
  const { effort } = splitRef(value);
  const efforts = model?.efforts ?? [];
  return (
    <span className="refselect">
      <Select
        size="sm"
        className="refselect__model"
        label={t("setup.engines.model")}
        value={baseRef(value)}
        options={modelOptions(value, catalog, (engine) => t("models.engineDefault", { engine }))}
        // Another model starts from its own default effort.
        onValueChange={(v) => v && v !== baseRef(value) && onChange(v)}
      />
      {efforts.length > 0 && (
        <Select
          size="sm"
          className="refselect__effort"
          label={t("models.effort")}
          value={effort ?? ""}
          options={[
            {
              value: "",
              label: model?.default_effort
                ? t("models.effortDefaultIs", { effort: effortLabel(model.default_effort) })
                : t("models.effortDefault"),
            },
            ...efforts.map((e) => ({ value: e, label: effortLabel(e) })),
          ]}
          onValueChange={(v) => onChange(withEffort(value, v || undefined))}
        />
      )}
    </span>
  );
}

/** Below a model list: the effort of the model picked, when it takes one. */
export function EffortRow({ value, onChange }: { value: ModelRef; onChange(ref: ModelRef): void }) {
  const t = useT();
  const catalog = useModels((s) => s.catalog);
  const model = modelOf(value, catalog);
  if (!model?.efforts?.length) return null;
  const { effort } = splitRef(value);
  return (
    <div className="mlist__effort">
      <span>{t("models.effort")}</span>
      <Select
        size="sm"
        label={t("models.effort")}
        value={effort ?? ""}
        options={[
          {
            value: "",
            label: model.default_effort
              ? t("models.effortDefaultIs", { effort: effortLabel(model.default_effort) })
              : t("models.effortDefault"),
          },
          ...model.efforts.map((e) => ({ value: e, label: effortLabel(e) })),
        ]}
        onValueChange={(v) => onChange(withEffort(value, v || undefined))}
      />
    </div>
  );
}
