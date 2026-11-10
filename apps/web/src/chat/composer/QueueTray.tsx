// The owner's messages in line for the agent's next turn, above the composer: each on one line, in the order they will
// run, dragged by its handle (or moved with ↑ ↓) into another place, sent now, edited or removed.
import "../../styles/queue.css";
import type { Message as Msg } from "@apx/protocol";
import { Button, IconButton, Icons, Textarea } from "@apx/ui";
import { type KeyboardEvent, type PointerEvent, useMemo, useRef, useState } from "react";
import { useData } from "../../data/state.ts";
import { editInLine, inLine, moveInLine, unsend } from "../../data/waiting.ts";
import { useT } from "../../i18n/index.ts";
import { SendNowButton } from "../WaitingMessage.tsx";

const EMPTY: Msg[] = [];
const textOf = (m: Msg) => m.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n\n");
const filesOf = (m: Msg) => m.parts.filter((p) => p.type === "file" || p.type === "image").length;

/** A row held by its handle: where it started, how far it moved and the place it would land in. */
type Drag = { id: string; from: number; dy: number; to: number; step: number };

export function QueueTray({ thread, agent }: { thread: string; agent: string }) {
  const t = useT();
  const all = useData((s) => s.messages[thread] ?? EMPTY);
  const line = useMemo(() => inLine(all), [all]);
  const [open, setOpen] = useState(true);
  const [drag, setDrag] = useState<Drag>();
  // The order just asked for, shown until the core's answer replaces it.
  const [order, setOrder] = useState<{ ids: string[]; for: Msg[] }>();
  const shown = order?.for === line ? order.ids.flatMap((id) => line.filter((m) => m.id === id)) : line;

  const move = (message: Msg, to: number) => {
    const ids = shown.map((m) => m.id).filter((id) => id !== message.id);
    ids.splice(to, 0, message.id);
    setOrder({ ids, for: line });
    void moveInLine(shown, message, to);
  };

  if (!line.length) return null;
  const title = t("waiting.lineTitle", { name: agent });
  return (
    <section className={open ? "queue" : "queue is-closed"} aria-label={title}>
      <header className="queue__head">
        <Icons.Clock size={13} className="queue__icon" />
        <span className="queue__title">{t("waiting.queue")}</span>
        <span className="queue__count">{line.length}</span>
        <span className="queue__sub">{t("waiting.lineFor", { name: agent })}</span>
        <span className="queue__spacer" />
        <IconButton
          size="sm"
          className="queue__fold"
          label={open ? t("waiting.hide") : t("waiting.show")}
          icon={open ? <Icons.ChevronDown size={14} /> : <Icons.ChevronUp size={14} />}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        />
      </header>
      {open && (
        <ol className="queue__list">
          {shown.map((m, i) => (
            <QueueRow
              key={m.id}
              message={m}
              index={i}
              count={shown.length}
              drag={drag}
              onDrag={setDrag}
              onMove={(to) => move(m, to)}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

/** Where each row sits while one is dragged: the held one follows the pointer, the ones it passed make room. */
function offset(drag: Drag | undefined, id: string, index: number): number {
  if (!drag) return 0;
  if (drag.id === id) return drag.dy;
  if (drag.from < drag.to && index > drag.from && index <= drag.to) return -drag.step;
  if (drag.to < drag.from && index >= drag.to && index < drag.from) return drag.step;
  return 0;
}

function QueueRow({
  message,
  index,
  count,
  drag,
  onDrag,
  onMove,
}: {
  message: Msg;
  index: number;
  count: number;
  drag: Drag | undefined;
  onDrag: (d: Drag | undefined) => void;
  onMove: (to: number) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<string>();
  const row = useRef<HTMLLIElement>(null);
  const start = useRef(0);
  const text = textOf(message);
  const files = filesOf(message);
  const held = drag?.id === message.id;

  const save = async () => {
    const next = draft?.trim();
    if (!next || next === text.trim()) return setDraft(undefined);
    if (await editInLine(message, next)) setDraft(undefined);
  };

  const grab = (e: PointerEvent<HTMLButtonElement>) => {
    if (count < 2 || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = e.clientY;
    const step = (row.current?.getBoundingClientRect().height ?? 34) + 2;
    onDrag({ id: message.id, from: index, dy: 0, to: index, step });
  };
  const follow = (e: PointerEvent<HTMLButtonElement>) => {
    if (!held || !drag) return;
    const dy = e.clientY - start.current;
    const to = Math.max(0, Math.min(count - 1, index + Math.round(dy / drag.step)));
    onDrag({ ...drag, dy, to });
  };
  const drop = () => {
    if (!held || !drag) return;
    onDrag(undefined);
    if (drag.to !== index) onMove(drag.to);
  };
  const keys = (e: KeyboardEvent<HTMLButtonElement>) => {
    const to = e.key === "ArrowUp" ? index - 1 : e.key === "ArrowDown" ? index + 1 : -1;
    if (to < 0 || to >= count) return;
    e.preventDefault();
    onMove(to);
  };

  if (draft !== undefined)
    return (
      <li className="queue__row is-editing">
        <Textarea
          autoFocus
          rows={Math.min(8, Math.max(2, draft.split("\n").length))}
          value={draft}
          aria-label={t("waiting.edit")}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setDraft(undefined);
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void save();
            }
          }}
        />
        <div className="queue__editbar">
          <Button size="sm" variant="secondary" onClick={() => setDraft(undefined)}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" disabled={!draft.trim()} onClick={() => void save()}>
            {t("waiting.save")}
          </Button>
        </div>
      </li>
    );
  const dy = offset(drag, message.id, index);
  return (
    <li
      ref={row}
      className={`queue__row${held ? " is-held" : ""}${drag && !held ? " is-moving" : ""}`}
      style={dy ? { transform: `translateY(${dy}px)` } : undefined}
    >
      {count > 1 && (
        <IconButton
          size="sm"
          className="queue__grip"
          label={t("waiting.move")}
          tooltip={t("waiting.moveHint")}
          icon={<Icons.GripVertical size={14} />}
          onPointerDown={grab}
          onPointerMove={follow}
          onPointerUp={drop}
          onPointerCancel={() => onDrag(undefined)}
          onKeyDown={keys}
        />
      )}
      <span className="queue__text" title={text}>
        {files > 0 && (
          <span className="queue__files">
            <Icons.Paperclip size={12} />
            {files}
          </span>
        )}
        {text}
      </span>
      <span className="queue__acts">
        <SendNowButton message={message} iconOnly />
        <IconButton
          size="sm"
          className="waiting__act"
          label={t("waiting.edit")}
          icon={<Icons.Pencil size={13} />}
          onClick={() => setDraft(text)}
        />
        <IconButton
          size="sm"
          className="waiting__act"
          label={t("waiting.remove")}
          icon={<Icons.Trash2 size={13} />}
          onClick={() => void unsend(message)}
        />
      </span>
    </li>
  );
}
