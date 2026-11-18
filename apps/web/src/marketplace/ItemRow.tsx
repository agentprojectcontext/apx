import { Button, CatalogRow, Icons } from "@apx/ui";
import { useT } from "../i18n/index.ts";
import type { Item } from "../resources/extensionItems.ts";
import { ItemIcon } from "./ConnectHead.tsx";
import { ItemLabel } from "./ItemLabel.tsx";
import { bringsText, fromText, waitReason } from "./itemText.ts";
import "@apx/ui/catalog-row.css";

// One extension in a list: its icon, name and label, one line, what it brings and who from, and on the right one
// thing: Add (or Connect), why it waits, or that it is working.

export function ItemRow({
  item: i,
  line,
  onOpen,
  onAct,
}: {
  item: Item;
  line?: string | undefined;
  onOpen(): void;
  /** Its button when it is not the owner's yet: Add, or Connect for one included with APX. */
  onAct?: (() => void) | undefined;
}) {
  const t = useT();
  const why = waitReason(i, t);
  const meta = [bringsText(i, t), fromText(i, t)].filter(Boolean).join(" · ");
  const mine = i.state !== "available" && i.state !== "coming";
  const connects = Boolean(i.origin === "included" || i.integration || i.channel);
  return (
    <CatalogRow
      leading={<ItemIcon item={i} size={36} />}
      title={i.name}
      badge={<ItemLabel label={i.label} />}
      description={line}
      meta={meta || undefined}
      onOpen={onOpen}
      action={
        mine || i.state === "coming" ? undefined : (
          <Button
            size="sm"
            variant="secondary"
            leadingIcon={connects ? undefined : <Icons.Plus size={14} />}
            onClick={() => (onAct ?? onOpen)()}
          >
            {t(connects ? "mkt.step.connect" : "mkt.step.add")}
          </Button>
        )
      }
      status={
        i.state === "coming"
          ? { label: t("mkt.step.coming") }
          : !mine
            ? undefined
            : why
              ? { label: why, tone: "waiting" }
              : { label: t(connects ? "mkt.step.connected" : "mkt.added"), tone: "done" }
      }
    />
  );
}
