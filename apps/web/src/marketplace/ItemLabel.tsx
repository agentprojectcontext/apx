import { Badge, Icons, Tooltip } from "@apx/ui";
import { type MessageKey, useT } from "../i18n/index.ts";
import type { Label } from "../resources/extensionItems.ts";

// Review is separate from authorship: compact in lists, spelled out on pages and in the add box.

export function ItemLabel({ label, compact = true }: { label: Label; compact?: boolean }) {
  const t = useT();
  const hint = t(`mkt.label.${label}.hint` as MessageKey);
  if (label === "third") return null;
  return (
    <Tooltip content={hint}>
      {label === "official" && compact ? (
        <span className="mkt-verified" role="img" aria-label={t("mkt.label.official")}>
          <Icons.BadgeCheck size={14} />
        </span>
      ) : (
        <Badge tone="neutral">
          {label === "official" && <Icons.BadgeCheck size={12} aria-hidden="true" />}
          {t(`mkt.label.${label}` as MessageKey)}
        </Badge>
      )}
    </Tooltip>
  );
}
