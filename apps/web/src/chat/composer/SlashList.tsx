// The composer's "/", "$" and "@" menus as drawn (SlashMenu.tsx keeps what they hold and the keys): loaded when one
// first opens.
import { Icons } from "@apx/ui";
import type { ReactNode } from "react";
import { type MessageKey, useT } from "../../i18n/index.ts";
import type { CommandId } from "./slash.ts";
import type { Item } from "./slashItem.ts";

const ICON: Record<CommandId, ReactNode> = {
  new: <Icons.SquarePen size={14} />,
  compact: <Icons.Layers size={14} />,
  model: <Icons.Sparkles size={14} />,
  effort: <Icons.Brain size={14} />,
  stop: <Icons.Square size={14} />,
  usage: <Icons.Activity size={14} />,
  skills: <Icons.BookOpen size={14} />,
};

const KIND: Record<Item["kind"], MessageKey> = {
  command: "slash.kind.command",
  skill: "slash.kind.skill",
  model: "slash.kind.model",
  effort: "slash.kind.effort",
  mcp: "slash.kind.mcp",
  agent: "slash.kind.agent",
};

export function SlashList({
  id,
  items,
  active,
  dollar,
  optId,
  onHover,
  onPick,
}: {
  id: string;
  items: Item[];
  active: number;
  dollar: boolean;
  optId: (i: number) => string;
  onHover: (i: number) => void;
  onPick: (item: Item) => void;
}) {
  const t = useT();
  return (
    <div className="slash" id={`${id}-list`} role="listbox" aria-label={t("slash.label")}>
      {items.map((item, i) => (
        <div
          key={rowKey(item)}
          id={optId(i)}
          role="option"
          aria-selected={i === active}
          tabIndex={-1}
          className={`slash__row${i === active ? " is-active" : ""}`}
          onMouseEnter={() => onHover(i)}
          // Keep the focus in the field: the pick happens on mouse down, before the blur.
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(item);
          }}
        >
          <Row item={item} dollar={dollar} />
          <span className="slash__kind">{t(KIND[item.kind])}</span>
        </div>
      ))}
    </div>
  );
}

const rowKey = (i: Item) =>
  i.kind === "command"
    ? `c:${i.id}`
    : i.kind === "skill"
      ? `s:${i.name}`
      : i.kind === "mcp" || i.kind === "agent"
        ? `${i.kind}:${i.name}`
        : i.kind === "model"
          ? i.ref
          : i.effort;

function Row({ item, dollar }: { item: Item; dollar: boolean }) {
  const t = useT();
  if (item.kind === "mcp" || item.kind === "agent")
    return (
      <>
        <span className="slash__icon">
          {item.kind === "agent" ? <Icons.AtSign size={14} /> : <Icons.Layers size={14} />}
        </span>
        <span className="slash__name">{item.name}</span>
        <span className="slash__desc">{item.description}</span>
      </>
    );
  if (item.kind === "command")
    return (
      <>
        <span className="slash__icon">{ICON[item.id]}</span>
        <span className="slash__name">/{item.id}</span>
        <span className="slash__desc">{t(`slash.${item.id}` as MessageKey)}</span>
      </>
    );
  if (item.kind === "skill")
    return (
      <>
        <span className="slash__icon">
          <Icons.BookOpen size={14} />
        </span>
        <span className="slash__name">{dollar ? item.name : `/${item.name}`}</span>
        <span className="slash__desc">{item.description || t("slash.skill")}</span>
      </>
    );
  const name = item.kind === "model" ? item.label : item.effort;
  const desc = item.kind === "model" ? item.ref : t("slash.effortRow");
  return (
    <>
      <span className="slash__icon">{item.current ? <Icons.Check size={14} /> : null}</span>
      <span className="slash__name">{name}</span>
      <span className="slash__desc">{desc}</span>
    </>
  );
}
