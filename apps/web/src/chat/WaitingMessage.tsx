// The owner's words their agent has not taken yet: "Send now" and "Remove" under a message sent while it works, and
// the messages in line for its next turn, below the chat, each with its controls in sight (a phone has no hover).
import type { Message as Msg } from "@apx/protocol";
import { Button, IconButton, Icons, Message, Textarea } from "@apx/ui";
import { type ReactNode, useState } from "react";
import { editInLine, moveInLine, sendNow, unsend } from "../data/waiting.ts";
import { useT } from "../i18n/index.ts";

const textOf = (m: Msg) => m.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n\n");

const seenWaiting = new Set<string>();

/** Whether the agent has taken a message the owner saw waiting: it carries a mark saying so, "Now". */
export function useTaken(message: Msg): boolean {
  if (message.waiting) seenWaiting.add(message.id);
  return !message.waiting && seenWaiting.has(message.id);
}

/** Under a message the agent has taken while it worked: two ticks and "Now", as a chat app marks a delivered one. */
export function TakenMark() {
  const t = useT();
  return (
    <span className="waiting__taken">
      <Icons.CheckCheck size={12} />
      {t("waiting.taken")}
    </span>
  );
}

/** The agent takes this message at once: the step it is on stops. */
export function SendNowButton({ message }: { message: Msg }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      className="waiting__now"
      leadingIcon={<Icons.Zap size={13} />}
      loading={busy}
      onClick={async () => {
        setBusy(true);
        await sendNow(message);
        setBusy(false);
      }}
    >
      {t("waiting.sendNow")}
    </Button>
  );
}

/** Takes the message back before the agent reads it. */
export function UnsendButton({ message }: { message: Msg }) {
  const t = useT();
  return (
    <IconButton
      size="sm"
      label={t("waiting.remove")}
      icon={<Icons.Trash2 size={13} />}
      onClick={() => void unsend(message)}
    />
  );
}

/** The messages in line for the agent's next turn, in the order they will run. */
export function InLine({
  line,
  agentName,
  body,
}: {
  line: Msg[];
  agentName: string;
  /** The message's words and files, as the chat shows the owner's messages. */
  body: (m: Msg) => ReactNode;
}) {
  const t = useT();
  if (!line.length) return null;
  return (
    <section className="waiting__line" aria-label={t("waiting.lineTitle", { name: agentName })}>
      <div className="waiting__label">
        <Icons.Clock size={12} />
        {t("waiting.lineTitle", { name: agentName })}
      </div>
      {line.map((m, i) => (
        <InLineMessage key={m.id} message={m} line={line} index={i}>
          {body(m)}
        </InLineMessage>
      ))}
    </section>
  );
}

function InLineMessage({
  message,
  line,
  index,
  children,
}: {
  message: Msg;
  line: Msg[];
  index: number;
  children: ReactNode;
}) {
  const t = useT();
  const [draft, setDraft] = useState<string>();
  const save = async () => {
    const next = draft?.trim();
    if (!next || next === textOf(message).trim()) return setDraft(undefined);
    if (await editInLine(message, next)) setDraft(undefined);
  };
  if (draft !== undefined)
    return (
      <Message from="user" variant="bare" className="is-editing">
        <div className="rewind__edit">
          <Textarea
            autoFocus
            rows={Math.min(10, Math.max(2, draft.split("\n").length))}
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
          <div className="rewind__bar">
            <Button size="sm" variant="secondary" onClick={() => setDraft(undefined)}>
              {t("common.cancel")}
            </Button>
            <Button size="sm" disabled={!draft.trim()} onClick={() => void save()}>
              {t("waiting.save")}
            </Button>
          </div>
        </div>
      </Message>
    );
  return (
    <Message
      from="user"
      waiting
      className="waiting__msg"
      // Always in sight: the meta line, not the controls that open on hover.
      meta={
        <>
          <SendNowButton message={message} />
          <IconButton
            size="sm"
            label={t("waiting.edit")}
            icon={<Icons.Pencil size={13} />}
            onClick={() => setDraft(textOf(message))}
          />
          {line.length > 1 && (
            <>
              <IconButton
                size="sm"
                label={t("waiting.up")}
                icon={<Icons.ArrowUp size={13} />}
                disabled={index === 0}
                onClick={() => void moveInLine(line, message, -1)}
              />
              <IconButton
                size="sm"
                label={t("waiting.down")}
                icon={<Icons.ArrowDown size={13} />}
                disabled={index === line.length - 1}
                onClick={() => void moveInLine(line, message, 1)}
              />
            </>
          )}
          <UnsendButton message={message} />
        </>
      }
    >
      {children}
    </Message>
  );
}
