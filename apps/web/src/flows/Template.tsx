// A step's template field: TemplateField with what this step can insert in it (values.ts).
import { TemplateField, type TemplateFieldProps, type TemplateGroup } from "@apx/ui";
import { useMemo } from "react";
import { useT } from "../i18n/index.ts";
import { SECRET_PATTERN, TEMPLATE_PATTERN, type TemplateFieldKind } from "./values.ts";

/** What a step's fields can insert, by field: secrets only where the step reads them itself. */
export type Values = (field: TemplateFieldKind) => TemplateGroup[];

const literally = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function Template({
  values,
  field,
  ...rest
}: Omit<TemplateFieldProps, "groups" | "pattern" | "secretPattern" | "pickLabel"> & {
  values: Values;
  field: TemplateFieldKind;
}) {
  const t = useT();
  const groups = values(field);
  // A variable that holds a secret reads as one, like the reference it holds.
  const held = groups.flatMap((g) => g.values.filter((v) => v.secret && v.insert.startsWith("$")).map((v) => v.insert));
  const key = held.join(" ");
  // biome-ignore lint/correctness/useExhaustiveDependencies: rebuilt only when the secret variables change
  const secret = useMemo(
    () => (held.length ? new RegExp(`^(secret://|(${held.map(literally).join("|")})$)`) : SECRET_PATTERN),
    [key],
  );
  return (
    <TemplateField
      {...rest}
      groups={groups}
      pattern={TEMPLATE_PATTERN}
      secretPattern={secret}
      pickLabel={t("flow.v.pick")}
      emptyText={t("flow.v.none")}
    />
  );
}
