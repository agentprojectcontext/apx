// What a step receives: what arrived, all of it or one field, or the result of a step before it.
import { Field, Input, Select } from "@apx/ui";
import { useT } from "../i18n/index.ts";
import { dotted, type FlowBinding, type FlowGraph, type FlowNode } from "./steps.tsx";
import { earlier, RESULT } from "./values.ts";

/** What a step receives: what arrived (all of it or one field), or the result of a step before it. */
export function InputPicker({
  label,
  graph,
  n,
  value,
  onChange,
}: {
  label: string;
  graph: FlowGraph;
  n: FlowNode;
  value: FlowBinding;
  onChange: (b: FlowBinding) => void;
}) {
  const t = useT();
  const before = earlier(graph, n.id);
  const from = value.kind === "node" ? value.node : "event";
  return (
    <>
      <Field label={label}>
        {() => (
          <Select
            label={label}
            value={from}
            onValueChange={(v) => {
              const step = before.find((x) => x.id === v);
              onChange(
                step ? { kind: "node", node: step.id, path: RESULT[step.kind] ?? [] } : { kind: "event", path: [] },
              );
            }}
            options={[
              { value: "event", label: t("flow.f.fromEvent") },
              ...before.map((x) => ({ value: x.id, label: t("flow.f.fromStep", { step: x.label }) })),
            ]}
          />
        )}
      </Field>
      {value.kind === "event" && (
        <Field label={t("flow.f.part")} hint={t("flow.f.partHint")}>
          {(id) => (
            <Input
              id={id}
              value={dotted(value.path)}
              className="fe-mono"
              placeholder={t("flow.f.partAll")}
              onChange={(e) =>
                onChange({
                  kind: "event",
                  path: e.target.value
                    .split(".")
                    .map((x) => x.trim())
                    .filter(Boolean)
                    .slice(0, 16),
                })
              }
            />
          )}
        </Field>
      )}
    </>
  );
}
