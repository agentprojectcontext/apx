// What a step receives: one `{}` field, like every other value of a step (DECISIONS.md#d-180): everything that arrived,
// a field of it, an earlier step's result or a variable, picked or typed; empty is everything that arrived.
import { Field } from "@apx/ui";
import { useT } from "../i18n/index.ts";
import type { FlowBinding, FlowGraph } from "./steps.tsx";
import { Template, type Values } from "./Template.tsx";
import { bindingOfTemplate, templateOfBinding } from "./values.ts";

/** What a step receives, kept as the binding its `{}` field stands for. */
export function InputPicker({
  label,
  graph,
  values,
  value,
  onChange,
}: {
  label: string;
  graph: FlowGraph;
  values: Values;
  value: FlowBinding;
  onChange: (b: FlowBinding) => void;
}) {
  const t = useT();
  return (
    <Field label={label} hint={t("flow.f.receivesHint")}>
      {(id) => (
        <Template
          id={id}
          field="whole"
          values={values}
          singleLine
          spellCheck={false}
          maxLength={8000}
          value={templateOfBinding(value, graph)}
          placeholder="$trigger"
          onValueChange={(v) => onChange(bindingOfTemplate(v, graph))}
        />
      )}
    </Field>
  );
}
