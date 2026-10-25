import type { ModelRef } from "@apx/protocol";
import { Popover } from "@apx/ui";
import { Suspense, useState } from "react";
import { inCatalog, refLabel, useModels } from "../../data/models.ts";
import { useT } from "../../i18n/index.ts";
import { ModelList } from "../../lazy.ts";
import { trigger } from "./ModelPickers.tsx";

/** One model ref from the catalog (router chain, rule targets). Without `value` it shows `placeholder`. */
export function ModelRefPicker(props: {
  value?: ModelRef;
  onChange: (ref: ModelRef) => void;
  label: string;
  placeholder?: string;
}) {
  const t = useT();
  const catalog = useModels((s) => s.catalog);
  const [open, setOpen] = useState(false);
  const { value } = props;
  const text = value ? refLabel(value, catalog) : (props.placeholder ?? props.label);
  const warn = Boolean(value) && catalog.length > 0 && !inCatalog(value ?? "", catalog);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      width={560}
      label={props.label}
      trigger={trigger({ text, label: props.label, warn, warnText: t("models.notInCatalog") })}
    >
      <Suspense fallback={null}>
        <ModelList
          value={value}
          onPick={(ref) => {
            // An add button has no current model whose effort could be edited here.
            if (!value) setOpen(false);
            props.onChange(ref);
          }}
          onEffort={props.onChange}
        />
      </Suspense>
    </Popover>
  );
}
