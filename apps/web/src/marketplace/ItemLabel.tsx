import { Badge, Icons } from "@apx/ui";
import { type MessageKey, useT } from "../i18n/index.ts";
import type { Label } from "../resources/extensionItems.ts";

// Where an extension comes from, in one word: Included, Official, Third party or Yours.

const TONE = { included: "neutral", official: "info", third: "warning", own: "violet" } as const;

export function ItemLabel({ label }: { label: Label }) {
  const t = useT();
  return (
    <Badge tone={TONE[label]} title={t(`mkt.label.${label}.hint` as MessageKey)}>
      {label === "official" && <Icons.Check size={11} />}
      {t(`mkt.label.${label}` as MessageKey)}
    </Badge>
  );
}
