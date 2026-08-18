import { useMemo } from "react";
import { Combobox } from "./Combobox";
import { t } from "../i18n";

// Model picker: a plain string list on top of the shared <Combobox>. Typing a
// model id that is not in the catalog is always allowed — provider catalogs
// move faster than ours.
export function ModelCombobox({
  value,
  onChange,
  onPick,
  options,
  placeholder = t("shared_ui.model_combobox_ph"),
  invalid,
  invalidHint,
  className,
  emptyHint,
}: {
  value: string;
  onChange: (v: string) => void;
  onPick?: (v: string) => void;
  options: string[];
  placeholder?: string;
  invalid?: boolean;
  invalidHint?: string;
  className?: string;
  emptyHint?: string;
}) {
  const opts = useMemo(() => options.map((o) => ({ value: o })), [options]);
  return (
    <Combobox
      value={value}
      onChange={onChange}
      onPick={onPick}
      options={opts}
      placeholder={placeholder}
      invalid={invalid}
      invalidHint={invalidHint}
      className={className}
      emptyHint={emptyHint}
    />
  );
}
