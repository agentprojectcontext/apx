import { Button, Icons } from "@apx/ui";
import type { ReactNode } from "react";
import { useT } from "../i18n/index.ts";
import type { Item } from "../resources/extensionItems.ts";
import { ItemIcon } from "./ConnectHead.tsx";
import { ItemLabel } from "./ItemLabel.tsx";
import { bringsText, fromText, waitReason } from "./itemText.ts";

// One extension in a list, as compact as Claude's: its icon, name and label, one line, what it brings and who from,
// and on the right one thing: Add (or Connect), why it waits, or that it is working.

export function ItemRow({
  item: i,
  line,
  onOpen,
  onAct,
  trailing,
}: {
  item: Item;
  line?: string | undefined;
  onOpen(): void;
  /** Its button when it is not the owner's yet: Add, or Connect for one included with APX. */
  onAct?: (() => void) | undefined;
  /** In place of the default right side. */
  trailing?: ReactNode;
}) {
  const t = useT();
  const why = waitReason(i, t);
  const meta = [bringsText(i, t), fromText(i, t)].filter(Boolean).join(" · ");
  const mine = i.state !== "available" && i.state !== "coming";
  const connects = Boolean(i.origin === "included" || i.integration || i.channel);
  return (
    // biome-ignore lint/a11y/useSemanticElements: a row holds its own button, which a <button> cannot contain
    <div
      className="mkt-row"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        onOpen();
      }}
    >
      <ItemIcon item={i} size={36} />
      <span className="mkt-row__main">
        <span className="mkt-row__title">
          <b className="mkt-row__name">{i.name}</b>
          <ItemLabel label={i.label} />
        </span>
        {line && <span className="mkt-row__line">{line}</span>}
        {meta && <span className="mkt-row__meta">{meta}</span>}
      </span>
      <span className="mkt-row__act">
        {trailing ??
          (i.state === "coming" ? (
            <span className="mkt-row__state">{t("mkt.step.coming")}</span>
          ) : !mine ? (
            <Button
              size="sm"
              variant="secondary"
              leadingIcon={connects ? undefined : <Icons.Plus size={14} />}
              onClick={(e) => {
                e.stopPropagation();
                (onAct ?? onOpen)();
              }}
            >
              {t(connects ? "mkt.step.connect" : "mkt.step.add")}
            </Button>
          ) : why ? (
            <span className="mkt-row__state mkt-row__state--wait">
              <span className="mkt-dot mkt-dot--wait" aria-hidden="true" />
              {why}
            </span>
          ) : (
            <span className="mkt-row__state">
              <Icons.Check size={14} />
              {t(connects ? "mkt.step.connected" : "mkt.added")}
            </span>
          ))}
      </span>
    </div>
  );
}
