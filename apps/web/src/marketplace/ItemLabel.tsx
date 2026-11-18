import { Badge, Icons, Tooltip } from "@apx/ui";
import { type MessageKey, useT } from "../i18n/index.ts";
import type { Label } from "../resources/extensionItems.ts";

// Where an extension comes from, marked as little as possible (as Claude marks its connectors): Official is a check
// after the name, Included and Yours a small word; Third party has no mark, its line under the name says it. What
// each means shows in a tooltip.

export function ItemLabel({ label }: { label: Label }) {
  const t = useT();
  const hint = t(`mkt.label.${label}.hint` as MessageKey);
  if (label === "third") return null;
  return (
    <Tooltip content={hint}>
      {label === "official" ? (
        <span className="mkt-verified" role="img" aria-label={t("mkt.label.official")}>
          <Icons.BadgeCheck size={14} />
        </span>
      ) : (
        <Badge tone="neutral">{t(`mkt.label.${label}` as MessageKey)}</Badge>
      )}
    </Tooltip>
  );
}
