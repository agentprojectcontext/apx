import { Button, CatalogRow, Icons } from "@apx/ui";
import type { ReactNode } from "react";
import { type MessageKey, useLanguage, useT } from "../i18n/index.ts";
import type { Item } from "../resources/extensionItems.ts";
import { type Count, countsOf } from "./brings.ts";
import { ItemIcon } from "./ConnectHead.tsx";
import { ItemLabel } from "./ItemLabel.tsx";
import { fromText, kindText, waitReason } from "./itemText.ts";
import "@apx/ui/catalog-row.css";

// One extension in a list: its icon, name and label, one line, what it is and who from with small icons for what it
// brings, and on the right one thing: Add (or Connect), why it waits, or that it is working.

const COUNT: Record<Count["kind"], { icon: ReactNode; one: MessageKey; many: MessageKey; some: MessageKey }> = {
  connector: {
    icon: <Icons.Plug size={12} />,
    one: "mkt.count.connectorOne",
    many: "mkt.count.connectorN",
    some: "mkt.count.connectorOne",
  },
  skills: {
    icon: <Icons.BookOpen size={12} />,
    one: "mkt.count.skillOne",
    many: "mkt.count.skillN",
    some: "mkt.count.skills",
  },
  agents: {
    icon: <Icons.Bot size={12} />,
    one: "mkt.count.agentOne",
    many: "mkt.count.agentN",
    some: "mkt.count.agents",
  },
  device: {
    icon: <Icons.Smartphone size={12} />,
    one: "mkt.count.device",
    many: "mkt.count.device",
    some: "mkt.count.device",
  },
  widgets: {
    icon: <Icons.LayoutGrid size={12} />,
    one: "mkt.count.widgetOne",
    many: "mkt.count.widgetN",
    some: "mkt.count.widgetOne",
  },
};

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
  const lang = useLanguage();
  const why = waitReason(i, t);
  // A device's app is one; a lone connector needs no number beside its plug.
  const counts = countsOf(i, lang).map(({ kind, n }) => {
    const c = COUNT[kind];
    return {
      icon: c.icon,
      count: kind === "device" || (kind === "connector" && n === 1) ? undefined : n,
      label: t(n === undefined ? c.some : n === 1 ? c.one : c.many, { n: n ?? 0 }),
    };
  });
  const meta = [kindText(i, t), fromText(i, t)].filter(Boolean).join(" · ");
  const mine = i.state !== "available" && i.state !== "coming";
  const connects = Boolean(i.origin === "included" || i.integration || i.channel);
  return (
    <CatalogRow
      leading={<ItemIcon item={i} size={36} />}
      title={i.name}
      badge={<ItemLabel label={i.label} />}
      description={line}
      meta={meta || undefined}
      counts={counts}
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
