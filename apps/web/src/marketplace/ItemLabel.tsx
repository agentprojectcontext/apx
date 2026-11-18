import { Badge, Icons } from "@apx/ui";
import { type MessageKey, useT } from "../i18n/index.ts";
import type { Label } from "../resources/extensionItems.ts";

// Where an extension comes from, marked as little as possible (as Claude marks its connectors): Official is a check
// after the name, Included and Yours a small word; Third party has no mark, its line under the name says it.

export function ItemLabel({ label }: { label: Label }) {
  const t = useT();
  const hint = t(`mkt.label.${label}.hint` as MessageKey);
  if (label === "third") return null;
  if (label === "official")
    return (
      <span className="mkt-verified" title={hint} role="img" aria-label={t("mkt.label.official")}>
        <Icons.CircleCheck size={14} />
      </span>
    );
  return (
    <Badge tone="neutral" title={hint}>
      {t(`mkt.label.${label}` as MessageKey)}
    </Badge>
  );
}
