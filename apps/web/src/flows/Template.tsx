// A step's template field: TemplateField with what this step can insert in it (values.ts).
import { TemplateField, type TemplateFieldProps, type TemplateGroup } from "@apx/ui";
import { useT } from "../i18n/index.ts";
import { SECRET_PATTERN, TEMPLATE_PATTERN, type TemplateFieldKind } from "./values.ts";

/** What a step's fields can insert, by field: secrets only where the step reads them itself. */
export type Values = (field: TemplateFieldKind) => TemplateGroup[];

export function Template({
  values,
  field,
  ...rest
}: Omit<TemplateFieldProps, "groups" | "pattern" | "secretPattern" | "pickLabel"> & {
  values: Values;
  field: TemplateFieldKind;
}) {
  const t = useT();
  return (
    <TemplateField
      {...rest}
      groups={values(field)}
      pattern={TEMPLATE_PATTERN}
      secretPattern={SECRET_PATTERN}
      pickLabel={t("flow.v.pick")}
      emptyText={t("flow.v.none")}
    />
  );
}
